import path from "node:path";
import fs from "node:fs";
import mongoose from "mongoose";

import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import User from "../models/User.js";

// ----------------------------------------------------
// HELPERS
// ----------------------------------------------------

const toObjectId = (id) => {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  if (
    typeof id === "string" &&
    mongoose.Types.ObjectId.isValid(id) &&
    String(new mongoose.Types.ObjectId(id)) === id
  ) {
    return new mongoose.Types.ObjectId(id);
  }
  return null;
};

const getCurrentUserId = (req) =>
  String(req.user?._id || req.user?.id || "");

const getIO = (req) => {
  return (
    req?.app?.get?.("io") ||
    req?.app?.locals?.io ||
    globalThis.__localProNotificationIO ||
    null
  );
};

const getUserRoom = (userId) => `user:${String(userId)}`;
const getConversationRoom = (conversationId) => `conv:${String(conversationId)}`;

const uniqueIds = (ids = []) => [
  ...new Set(
    ids
      .filter(Boolean)
      .map((id) => String(id._id || id))
  ),
];

const emitToUsers = (req, userIds, event, payload) => {
  const io = getIO(req);
  if (!io) return;
  for (const userId of uniqueIds(userIds)) {
    io.to(getUserRoom(userId)).emit(event, payload);
  }
};

const emitMessageToConversation = (req, conversation, message) => {
  const io = getIO(req);
  if (!io || !conversation || !message) return;

  const conversationId = String(conversation._id);
  const participants = (conversation.participants || []).map((p) =>
    String(p._id || p)
  );

  const updatePayload = {
    conversationId,
    lastMessage: message,
    lastMessageAt: message.createdAt,
  };

  for (const participantId of participants) {
    io.to(getUserRoom(participantId)).emit("message:new", message);
    io.to(getUserRoom(participantId)).emit("conversation:updated", updatePayload);
  }

  io.to(getConversationRoom(conversationId)).emit("message:new", message);
};

const emitConversationToUsers = (req, conversation, event = "conversation:new") => {
  if (!conversation) return;
  emitToUsers(req, conversation.participants, event, conversation);
};

const emitReadReceipt = (req, conversation, readerId) => {
  const io = getIO(req);
  if (!io || !conversation) return;

  const payload = {
    conversationId: String(conversation._id),
    readerId: String(readerId),
    userId: String(readerId),
  };

  for (const participantId of uniqueIds(conversation.participants)) {
    io.to(getUserRoom(participantId)).emit("chat:read", payload);
    io.to(getUserRoom(participantId)).emit("message:read", payload);
  }

  io.to(getConversationRoom(conversation._id)).emit("chat:read", payload);
  io.to(getConversationRoom(conversation._id)).emit("message:read", payload);
};

const getUnreadCountsMap = async (conversationIds, userObjId) => {
  if (!Array.isArray(conversationIds) || !conversationIds.length || !userObjId) {
    return {};
  }

  try {
    const validConvIds = conversationIds.map(toObjectId).filter(Boolean);
    if (!validConvIds.length) return {};

    const counts = await Message.aggregate([
      {
        $match: {
          conversation: { $in: validConvIds },
          sender: { $ne: userObjId },
          readBy: { $nin: [userObjId] },
          deletedFor: { $nin: [userObjId] },
          isDeletedForEveryone: { $ne: true },
        },
      },
      {
        $group: {
          _id: "$conversation",
          count: { $sum: 1 },
        },
      },
    ]);

    const map = {};
    for (const item of counts) {
      if (item._id) {
        map[String(item._id)] = item.count;
      }
    }
    return map;
  } catch (err) {
    console.error("[GET UNREAD COUNTS ERROR]", err);
    return {};
  }
};

const isAdmin = (user) =>
  String(user?.role || "").toLowerCase() === "admin";

const findAccessibleConversation = async (conversationId, userId) => {
  const convId = toObjectId(conversationId);
  const userObjId = toObjectId(userId);
  if (!convId || !userObjId) return null;

  return Conversation.findOne({
    _id: convId,
    participants: userObjId,
  }).exec();
};

// Fast and safe flat populate (NO circular or deep nesting)
const populateMessage = (query) =>
  query
    .populate("sender", "_id name username role")
    .populate("replyTo", "_id text sender")
    .lean();

const populateConversation = (query) =>
  query
    .populate("participants", "_id name username email role department")
    .populate("groupAdmin", "_id name username role")
    .populate({
      path: "lastMessage",
      select: "_id text sender createdAt isDeletedForEveryone",
    })
    .lean();

const getUploadedFiles = (req) => {
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === "object") {
    return [
      ...(req.files.attachments || []),
      ...(req.files.attachment || []),
      ...(req.files.files || []),
    ];
  }
  return req.file ? [req.file] : [];
};

const getAttachmentData = (files) =>
  files.map((file) => ({
    name: file.originalname || file.filename || "Attachment",
    path: `uploads/chat/${path.basename(file.filename || file.path)}`,
    type: file.mimetype || "",
    size: Number(file.size) || 0,
  }));

const isValidClientMsgId = (value) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.trim().length <= 150;

const sendError = (res, status, message) =>
  res.status(status).json({
    success: false,
    message,
  });

// ----------------------------------------------------
// 1. CHAT BOOTSTRAP (FAST, ALL REAL USERS & ADMINS)
// ----------------------------------------------------

export const getChatBootstrap = async (req, res) => {
  try {
    const currentUserId = getCurrentUserId(req);
    const userObjId = toObjectId(currentUserId);

    if (!userObjId) {
      return sendError(res, 401, "Invalid user authentication.");
    }

    const conversationsPromise = Conversation.find({
      participants: userObjId,
      deletedBy: { $ne: userObjId },
    })
      .select("_id participants isGroup groupName groupAdmin lastMessage lastMessageAt updatedAt")
      .populate("participants", "_id name username email role department")
      .populate({
        path: "lastMessage",
        select: "_id text sender createdAt isDeletedForEveryone",
      })
      .sort({ lastMessageAt: -1 })
      .lean();

    const usersPromise = User.find({ _id: { $ne: userObjId } })
      .select("_id name username email role department")
      .sort({ name: 1 })
      .lean();

    const [rawConversations, users] = await Promise.all([
      conversationsPromise,
      usersPromise,
    ]);

    const convIds = (rawConversations || []).map((c) => c._id);
    const unreadMap = await getUnreadCountsMap(convIds, userObjId);

    const conversations = (rawConversations || []).map((c) => ({
      ...c,
      unreadCount: unreadMap[String(c._id)] || 0,
    }));

    return res.status(200).json({
      success: true,
      conversations: conversations || [],
      users: users || [],
      currentUserId,
    });
  } catch (error) {
    console.error("[CHAT BOOTSTRAP ERROR]", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load chat bootstrap data.",
      error: error.message,
    });
  }
};

// ----------------------------------------------------
// 2. GET MESSAGES (FAST, FLAT POPULATE)
// ----------------------------------------------------

export const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const currentUserId = getCurrentUserId(req);
    const userObjId = toObjectId(currentUserId);
    const convObjId = toObjectId(conversationId);

    if (!convObjId || !userObjId) {
      return sendError(res, 400, "Invalid conversation ID.");
    }

    const conversation = await Conversation.findOne({
      _id: convObjId,
      participants: userObjId,
      deletedBy: { $ne: userObjId },
    })
      .select("_id")
      .lean();

    if (!conversation) {
      return sendError(res, 403, "You do not have access to this conversation.");
    }

    const messages = await Message.find({
      conversation: convObjId,
      deletedFor: { $ne: userObjId },
    })
      .select(
        "conversation sender clientMsgId text attachments replyTo reactions readBy isEdited editedAt isPinned pinnedBy createdAt isDeletedForEveryone"
      )
      .populate("sender", "_id name username role")
      .populate("replyTo", "_id text sender")
      .sort({ createdAt: 1 })
      .limit(100)
      .lean();

    return res.status(200).json({
      success: true,
      messages: messages || [],
    });
  } catch (error) {
    console.error("[GET CHAT MESSAGES ERROR]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// 3. GET OR CREATE DIRECT CONVERSATION
// ----------------------------------------------------

export const getOrCreateConversation = async (req, res) => {
  try {
    const { recipientId } = req.body;
    const currentUserId = getCurrentUserId(req);
    const currentObjId = toObjectId(currentUserId);
    const recipientObjId = toObjectId(recipientId);

    if (
      !currentObjId ||
      !recipientObjId ||
      String(recipientObjId) === currentUserId
    ) {
      return sendError(res, 400, "Invalid recipient ID.");
    }

    const recipient = await User.findById(recipientObjId)
      .select("_id")
      .lean();

    if (!recipient) {
      return sendError(res, 404, "Recipient not found.");
    }

    let conversation = await Conversation.findOne({
      isGroup: false,
      participants: {
        $all: [currentObjId, recipientObjId],
        $size: 2,
      },
    });

    let isNew = false;
    if (conversation) {
      if (
        (conversation.deletedBy || []).some(
          (id) => String(id) === currentUserId
        )
      ) {
        await Conversation.updateOne(
          { _id: conversation._id },
          { $pull: { deletedBy: currentObjId } }
        );
        conversation = await Conversation.findById(conversation._id);
      }
    } else {
      conversation = await Conversation.create({
        participants: [currentObjId, recipientObjId],
        isGroup: false,
        lastMessageAt: new Date(),
      });
      isNew = true;
    }

    const populatedConversation = await populateConversation(
      Conversation.findById(conversation._id)
    );

    if (isNew) {
      emitConversationToUsers(req, populatedConversation, "conversation:new");
    }

    return res.status(200).json({
      success: true,
      conversation: populatedConversation,
    });
  } catch (error) {
    console.error("[GET OR CREATE CHAT ERROR]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// 4. SEND MESSAGE (REAL-TIME TWO-WAY EMISSION)
// ----------------------------------------------------

export const sendMessage = async (req, res) => {
  try {
    const {
      conversationId,
      text = "",
      replyTo = null,
      clientMsgId = null,
      priority = "standard",
    } = req.body;

    const currentUserId = getCurrentUserId(req);
    const userObjId = toObjectId(currentUserId);
    const convObjId = toObjectId(conversationId);

    const cleanText = typeof text === "string" ? text.trim() : "";
    const files = getUploadedFiles(req);

    if (!userObjId || !convObjId) {
      return sendError(res, 400, "Invalid conversation ID.");
    }

    if (!cleanText && files.length === 0) {
      return sendError(res, 400, "Message text or attachment is required.");
    }

    const conversation = await Conversation.findOne({
      _id: convObjId,
      participants: userObjId,
    });

    if (!conversation) {
      return sendError(res, 403, "You do not have access to this conversation.");
    }

    const attachments = getAttachmentData(files);

    const message = await Message.create({
      conversation: convObjId,
      sender: userObjId,
      clientMsgId: isValidClientMsgId(clientMsgId) ? clientMsgId.trim() : null,
      text: cleanText,
      attachments,
      replyTo: toObjectId(replyTo),
      readBy: [userObjId],
      priority: ["important", "urgent"].includes(priority) ? priority : "standard",
    });

    await Conversation.findByIdAndUpdate(convObjId, {
      $set: {
        lastMessage: message._id,
        lastMessageAt: new Date(),
        deletedBy: [],
      },
    });

    const populatedMessage = await Message.findById(message._id)
      .select(
        "conversation sender clientMsgId text priority attachments replyTo reactions readBy isEdited editedAt isPinned pinnedBy createdAt updatedAt isDeletedForEveryone"
      )
      .populate("sender", "_id name username role")
      .populate("replyTo", "_id text sender")
      .lean();

    const participants = (conversation.participants || []).map((p) =>
      String(p._id || p)
    );

    const io = getIO(req);
    if (io) {
      const updatePayload = {
        conversationId: String(convObjId),
        lastMessage: populatedMessage,
        lastMessageAt: populatedMessage.createdAt,
      };

      participants.forEach((pId) => {
        io.to(`user:${pId}`).emit("message:new", populatedMessage);
        io.to(`user:${pId}`).emit("conversation:updated", updatePayload);
      });

      io.to(`conv:${String(convObjId)}`).emit("message:new", populatedMessage);
    }

    return res.status(201).json({
      success: true,
      message: populatedMessage,
    });
  } catch (error) {
    console.error("[SEND CHAT MESSAGE ERROR]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// 5. GET CONVERSATIONS
// ----------------------------------------------------

export const getConversations = async (req, res) => {
  try {
    const userObjId = toObjectId(getCurrentUserId(req));

    if (!userObjId) {
      return sendError(res, 401, "Invalid user authentication.");
    }

    const rawConversations = await Conversation.find({
      participants: userObjId,
      deletedBy: { $ne: userObjId },
    })
      .select("_id participants isGroup groupName groupAdmin lastMessage lastMessageAt updatedAt")
      .populate("participants", "_id name username email role department")
      .populate({
        path: "lastMessage",
        select: "_id text sender createdAt isDeletedForEveryone",
      })
      .sort({ lastMessageAt: -1 })
      .lean();

    const convIds = (rawConversations || []).map((c) => c._id);
    const unreadMap = await getUnreadCountsMap(convIds, userObjId);

    const conversations = (rawConversations || []).map((c) => ({
      ...c,
      unreadCount: unreadMap[String(c._id)] || 0,
    }));

    return res.status(200).json({
      success: true,
      conversations: conversations || [],
    });
  } catch (error) {
    console.error("[GET CONVERSATIONS ERROR]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// 6. CREATE GROUP
// ----------------------------------------------------

export const createGroupConversation = async (req, res) => {
  try {
    const { name, participantIds } = req.body;
    const currentUserId = getCurrentUserId(req);
    const currentObjId = toObjectId(currentUserId);

    if (!isAdmin(req.user)) {
      return sendError(res, 403, "Only an admin can create groups.");
    }

    if (
      !currentObjId ||
      typeof name !== "string" ||
      !name.trim() ||
      !Array.isArray(participantIds) ||
      participantIds.length === 0
    ) {
      return sendError(res, 400, "Group name and members are required.");
    }

    const uniqueParticipantIds = [
      ...new Set([currentUserId, ...participantIds.map(String)]),
    ];

    const participantObjIds = uniqueParticipantIds.map(toObjectId);

    const conversation = await Conversation.create({
      participants: participantObjIds,
      isGroup: true,
      groupName: name.trim(),
      groupAdmin: currentObjId,
      lastMessageAt: new Date(),
    });

    const populatedConversation = await populateConversation(
      Conversation.findById(conversation._id)
    );

    emitConversationToUsers(req, populatedConversation, "conversation:new");

    return res.status(201).json({
      success: true,
      conversation: populatedConversation,
    });
  } catch (error) {
    console.error("[CREATE CHAT GROUP ERROR]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// 6a. GET GROUP MEMBERS
// ----------------------------------------------------

export const getGroupMembers = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const currentUserId = getCurrentUserId(req);
    const userObjId = toObjectId(currentUserId);
    const convObjId = toObjectId(conversationId);

    if (!convObjId || !userObjId) {
      return sendError(res, 400, "Invalid conversation ID.");
    }

    const conversation = await Conversation.findOne({
      _id: convObjId,
      isGroup: true,
      participants: userObjId,
    })
      .select("participants groupName groupAdmin isGroup")
      .populate("participants", "_id name username email role department status")
      .populate("groupAdmin", "_id name username role")
      .lean();

    if (!conversation) {
      return sendError(res, 404, "Group conversation not found or access denied.");
    }

    return res.status(200).json({
      success: true,
      members: conversation.participants || [],
      groupAdmin: conversation.groupAdmin,
      groupName: conversation.groupName,
    });
  } catch (error) {
    console.error("[GET GROUP MEMBERS ERROR]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// 6b. REMOVE GROUP MEMBER
// ----------------------------------------------------

export const removeGroupMember = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { memberId, userId } = req.body;
    const targetUserId = memberId || userId;
    const currentUserId = getCurrentUserId(req);
    const userObjId = toObjectId(currentUserId);
    const convObjId = toObjectId(conversationId);
    const targetObjId = toObjectId(targetUserId);

    if (!convObjId || !userObjId || !targetObjId) {
      return sendError(res, 400, "Invalid conversation or member ID.");
    }

    const conversation = await Conversation.findOne({
      _id: convObjId,
      isGroup: true,
    });

    if (!conversation) {
      return sendError(res, 404, "Group conversation not found.");
    }

    const isGroupAdmin = String(conversation.groupAdmin) === currentUserId;
    const isSystemAdmin = isAdmin(req.user);

    if (!isGroupAdmin && !isSystemAdmin) {
      return sendError(res, 403, "Only the group admin can remove members.");
    }

    if (String(conversation.groupAdmin) === String(targetUserId)) {
      return sendError(res, 400, "Cannot remove the group admin from the group.");
    }

    const wasParticipant = conversation.participants.some(
      (p) => String(p) === String(targetUserId)
    );

    if (!wasParticipant) {
      return sendError(res, 400, "User is not a member of this group.");
    }

    conversation.participants = conversation.participants.filter(
      (p) => String(p) !== String(targetUserId)
    );

    await conversation.save();

    const populatedConversation = await populateConversation(
      Conversation.findById(convObjId)
    );

    const io = getIO(req);
    if (io) {
      io.to(getUserRoom(targetUserId)).emit("conversation:deleted", {
        conversationId: String(convObjId),
      });
      io.to(getUserRoom(targetUserId)).emit("group:member_removed", {
        conversationId: String(convObjId),
        memberId: String(targetUserId),
      });

      const remaining = conversation.participants.map((p) => String(p));
      for (const pId of remaining) {
        io.to(getUserRoom(pId)).emit("group:member_removed", {
          conversationId: String(convObjId),
          memberId: String(targetUserId),
        });
        io.to(getUserRoom(pId)).emit("conversation:updated", populatedConversation);
      }
      io.to(getConversationRoom(convObjId)).emit("group:member_removed", {
        conversationId: String(convObjId),
        memberId: String(targetUserId),
      });
    }

    return res.status(200).json({
      success: true,
      message: "Member removed successfully.",
      conversation: populatedConversation,
    });
  } catch (error) {
    console.error("[REMOVE GROUP MEMBER ERROR]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// 6c. DELETE GROUP CONVERSATION (ADMIN / CREATOR)
// ----------------------------------------------------

export const deleteGroupConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const currentUserId = getCurrentUserId(req);
    const userObjId = toObjectId(currentUserId);
    const convObjId = toObjectId(conversationId);

    if (!convObjId || !userObjId) {
      return sendError(res, 400, "Invalid conversation ID.");
    }

    const conversation = await Conversation.findOne({
      _id: convObjId,
      isGroup: true,
    });

    if (!conversation) {
      return sendError(res, 404, "Group conversation not found.");
    }

    const isGroupAdmin = String(conversation.groupAdmin) === currentUserId;
    const isSystemAdmin = isAdmin(req.user);

    if (!isGroupAdmin && !isSystemAdmin) {
      return sendError(res, 403, "Only the group admin can delete this group.");
    }

    const participantIds = (conversation.participants || []).map((p) => String(p));

    await Message.deleteMany({ conversation: convObjId });
    await Conversation.findByIdAndDelete(convObjId);

    const io = getIO(req);
    if (io) {
      for (const pId of participantIds) {
        io.to(getUserRoom(pId)).emit("conversation:deleted", {
          conversationId: String(convObjId),
        });
      }
      io.to(getConversationRoom(convObjId)).emit("conversation:deleted", {
        conversationId: String(convObjId),
      });
    }

    return res.status(200).json({
      success: true,
      message: "Group deleted successfully.",
    });
  } catch (error) {
    console.error("[DELETE GROUP CONVERSATION ERROR]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getAccessibleMessage = async (messageId, userId) => {
  const msgObjId = toObjectId(messageId);
  const userObjId = toObjectId(userId);
  if (!msgObjId || !userObjId) return null;

  const message = await Message.findOne({
    _id: msgObjId,
    deletedFor: { $ne: userObjId },
  });

  if (!message) return null;

  const conversation = await findAccessibleConversation(
    message.conversation,
    userId
  );

  if (!conversation) return null;

  return { message, conversation };
};

// ----------------------------------------------------
// 7. EDIT MESSAGE
// ----------------------------------------------------

export const editMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { text } = req.body;
    const currentUserId = getCurrentUserId(req);

    if (typeof text !== "string" || !text.trim()) {
      return sendError(res, 400, "Message text is required.");
    }

    const result = await getAccessibleMessage(messageId, currentUserId);
    if (!result) return sendError(res, 404, "Message not found.");

    const { message, conversation } = result;

    if (String(message.sender) !== currentUserId || message.isDeletedForEveryone) {
      return sendError(res, 403, "You cannot edit this message.");
    }

    message.text = text.trim();
    message.isEdited = true;
    message.editedAt = new Date();

    await message.save();

    const populatedMessage = await populateMessage(Message.findById(message._id));

    emitToUsers(req, conversation.participants, "message:edited", {
      conversationId: String(message.conversation),
      message: populatedMessage,
      messageId: String(message._id),
      text: message.text,
      isEdited: true,
      editedAt: message.editedAt,
    });

    return res.status(200).json({ success: true, message: populatedMessage });
  } catch (error) {
    console.error("[EDIT CHAT MESSAGE ERROR]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// 8. REACTION TOGGLE
// ----------------------------------------------------

export const toggleReaction = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const currentUserId = getCurrentUserId(req);
    const userObjId = toObjectId(currentUserId);

    if (!userObjId || typeof emoji !== "string" || !emoji.trim()) {
      return sendError(res, 400, "A valid emoji is required.");
    }

    const result = await getAccessibleMessage(messageId, currentUserId);
    if (!result) return sendError(res, 404, "Message not found.");

    const { message, conversation } = result;

    if (message.isDeletedForEveryone) {
      return sendError(res, 400, "Cannot react to a deleted message.");
    }

    const cleanEmoji = emoji.trim();
    if (!Array.isArray(message.reactions)) message.reactions = [];

    const existingIndex = message.reactions.findIndex(
      (reaction) => String(reaction.user) === currentUserId
    );

    if (existingIndex > -1) {
      if (message.reactions[existingIndex].emoji === cleanEmoji) {
        message.reactions.splice(existingIndex, 1);
      } else {
        message.reactions[existingIndex].emoji = cleanEmoji;
      }
    } else {
      message.reactions.push({ user: userObjId, emoji: cleanEmoji });
    }

    await message.save();

    emitToUsers(req, conversation.participants, "message:reaction", {
      messageId: String(message._id),
      conversationId: String(message.conversation),
      reactions: message.reactions,
    });

    return res.status(200).json({ success: true, reactions: message.reactions });
  } catch (error) {
    console.error("[CHAT REACTION ERROR]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// 9. PIN / UNPIN MESSAGE
// ----------------------------------------------------

export const togglePinMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const currentUserId = getCurrentUserId(req);
    const userObjId = toObjectId(currentUserId);

    const result = await getAccessibleMessage(messageId, currentUserId);
    if (!result) return sendError(res, 404, "Message not found.");

    const { message, conversation } = result;

    if (message.isDeletedForEveryone) {
      return sendError(res, 400, "Cannot pin a deleted message.");
    }

    message.isPinned = !message.isPinned;
    message.pinnedBy = message.isPinned ? userObjId : null;

    await message.save();

    emitToUsers(req, conversation.participants, "message:pinned", {
      messageId: String(message._id),
      conversationId: String(message.conversation),
      isPinned: message.isPinned,
      pinnedBy: message.pinnedBy,
    });

    return res.status(200).json({ success: true, isPinned: message.isPinned });
  } catch (error) {
    console.error("[CHAT PIN ERROR]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// 10. FORWARD MESSAGE
// ----------------------------------------------------

export const forwardMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { targetConversationIds, priority = "standard" } = req.body;
    const currentUserId = getCurrentUserId(req);
    const userObjId = toObjectId(currentUserId);

    if (!userObjId || !Array.isArray(targetConversationIds) || targetConversationIds.length === 0) {
      return sendError(res, 400, "Select at least one target conversation.");
    }

    const sourceResult = await getAccessibleMessage(messageId, currentUserId);
    if (!sourceResult) return sendError(res, 404, "Source message not found.");

    const original = sourceResult.message;
    const targetObjectIds = targetConversationIds.map(toObjectId).filter(Boolean);

    const conversations = await Conversation.find({
      _id: { $in: targetObjectIds },
      participants: userObjId,
    });

    const results = await Promise.all(
      conversations.map(async (conversation) => {
        const forwardedMessage = await Message.create({
          conversation: conversation._id,
          sender: userObjId,
          text: original.text,
          attachments: original.attachments || [],
          readBy: [userObjId],
      priority: ["important", "urgent"].includes(priority) ? priority : "standard",
        });

        await Conversation.findByIdAndUpdate(conversation._id, {
          $set: {
            lastMessage: forwardedMessage._id,
            lastMessageAt: new Date(),
            deletedBy: [],
          },
        });

        const populated = await populateMessage(Message.findById(forwardedMessage._id));
        emitMessageToConversation(req, conversation, populated);
        return populated;
      })
    );

    return res.status(200).json({
      success: true,
      message: "Forwarded successfully.",
      messages: results,
    });
  } catch (error) {
    console.error("[FORWARD CHAT MESSAGE ERROR]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// 11. DELETE MESSAGE
// ----------------------------------------------------

export const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { type = "me" } = req.body;
    const currentUserId = getCurrentUserId(req);
    const userObjId = toObjectId(currentUserId);
    const msgObjId = toObjectId(messageId);

    if (!msgObjId || !userObjId) return sendError(res, 400, "Invalid message ID.");

    const message = await Message.findById(msgObjId);
    if (!message) return sendError(res, 404, "Message not found.");

    if (type === "everyone") {
      if (String(message.sender) !== currentUserId) {
        return sendError(res, 403, "Only the sender can delete this message for everyone.");
      }

      message.isDeletedForEveryone = true;
      message.text = "This message was deleted";
      message.attachments = [];
      await message.save();

      const conversation = await Conversation.findById(message.conversation);
      if (conversation) {
        emitToUsers(req, conversation.participants, "message:deleted", {
          messageId: String(message._id),
          conversationId: String(message.conversation),
          isDeletedForEveryone: true,
          text: "This message was deleted",
          attachments: [],
        });
      }
    } else {
      await Message.findByIdAndUpdate(msgObjId, {
        $addToSet: { deletedFor: userObjId },
      });

      emitToUsers(req, [currentUserId], "message:deleted_for_me", {
        messageId: String(message._id),
        conversationId: String(message.conversation),
      });
    }

    return res.status(200).json({ success: true, message: "Deleted" });
  } catch (error) {
    console.error("[DELETE CHAT MESSAGE ERROR]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// 12. DELETE CONVERSATION
// ----------------------------------------------------

export const deleteConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const currentUserId = getCurrentUserId(req);
    const userObjId = toObjectId(currentUserId);
    const convObjId = toObjectId(conversationId);

    if (!convObjId || !userObjId) return sendError(res, 400, "Invalid conversation ID.");

    const conversation = await Conversation.findOneAndUpdate(
      { _id: convObjId, participants: userObjId },
      { $addToSet: { deletedBy: userObjId } },
      { new: true }
    );

    if (!conversation) return sendError(res, 404, "Conversation not found.");

    await Message.updateMany(
      { conversation: convObjId, deletedFor: { $ne: userObjId } },
      { $addToSet: { deletedFor: userObjId } }
    );

    emitToUsers(req, [currentUserId], "conversation:deleted", {
      conversationId: String(convObjId),
    });

    return res.status(200).json({ success: true, message: "Chat deleted" });
  } catch (error) {
    console.error("[DELETE CONVERSATION ERROR]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// 13. MARK CONVERSATION AS READ
// ----------------------------------------------------

export const markConversationAsRead = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const currentUserId = getCurrentUserId(req);
    const userObjId = toObjectId(currentUserId);
    const convObjId = toObjectId(conversationId);

    if (!convObjId || !userObjId) return sendError(res, 400, "Invalid conversation ID.");

    const conversation = await Conversation.findOne({
      _id: convObjId,
      participants: userObjId,
      deletedBy: { $ne: userObjId },
    })
      .select("_id participants")
      .lean();

    if (!conversation) {
      return sendError(res, 403, "You do not have access to this conversation.");
    }

    const updateResult = await Message.updateMany(
      {
        conversation: convObjId,
        sender: { $ne: userObjId },
        readBy: { $nin: [userObjId] },
        deletedFor: { $nin: [userObjId] },
        isDeletedForEveryone: { $ne: true },
      },
      { $addToSet: { readBy: userObjId } }
    );

    emitReadReceipt(req, conversation, currentUserId);

    return res.status(200).json({
      success: true,
      message: "Read acknowledgement updated.",
    });
  } catch (error) {
    console.error("[MARK CHAT READ ERROR]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// 14. DOWNLOAD ATTACHMENT
// ----------------------------------------------------

export const downloadAttachment = async (req, res) => {
  try {
    const { messageId, attachmentIndex } = req.params;
    const currentUserId = getCurrentUserId(req);
    const msgObjId = toObjectId(messageId);
    const index = Number.parseInt(attachmentIndex, 10);

    if (!msgObjId || !Number.isInteger(index) || index < 0) {
      return sendError(res, 400, "Invalid attachment request.");
    }

    const message = await Message.findOne({
      _id: msgObjId,
      deletedFor: { $ne: toObjectId(currentUserId) },
      isDeletedForEveryone: false,
    })
      .select("conversation attachments deletedFor isDeletedForEveryone")
      .lean();

    if (!message) return sendError(res, 404, "Message not found.");

    const conversation = await findAccessibleConversation(
      message.conversation,
      currentUserId
    );

    if (!conversation) {
      return sendError(res, 403, "You do not have access to this attachment.");
    }

    const attachment = message.attachments?.[index];
    if (!attachment?.path) return sendError(res, 404, "Attachment not found.");

    const filePath = path.resolve(process.cwd(), attachment.path);

    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      return sendError(res, 404, "File not found on server.");
    }

    const fileName = path.basename(attachment.name || filePath);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(fileName)}"`
    );
    if (attachment.type) {
      res.setHeader("Content-Type", attachment.type);
    }

    return res.download(filePath, fileName);
  } catch (error) {
    console.error("[CHAT DOWNLOAD ERROR]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
