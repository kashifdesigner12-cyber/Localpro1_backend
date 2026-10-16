"use strict";

const mongoose = require("mongoose");
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const User = require("../models/User");

// =====================================================
// HELPERS
// =====================================================

const isValidObjectId = (id) =>
  Boolean(id) &&
  typeof id !== "object" &&
  mongoose.Types.ObjectId.isValid(String(id));

const toId = (value) => {
  if (!value) return null;
  return String(value._id || value);
};

const getUserRole = (user) =>
  String(user?.role || "").toLowerCase();

const isAdmin = (user) => getUserRole(user) === "admin";

const getIo = (req) => req.app.get("io");

const getParticipantIds = (conversation) => {
  const ids = Array.isArray(conversation?.participants)
    ? conversation.participants.map(toId).filter(Boolean)
    : [];

  if (conversation?.userId) {
    ids.push(toId(conversation.userId));
  }

  return [...new Set(ids)];
};

const safeUserRef = (user) => {
  if (!user) return null;

  if (typeof user !== "object" || !user._id) {
    return user;
  }

  let avatar =
    user.avatar || user.profileImage || user.image || null;

  if (
    typeof avatar === "string" &&
    avatar.startsWith("data:image") &&
    avatar.length > 1000
  ) {
    avatar = null;
  }

  return {
    id: user._id,
    _id: user._id,
    name: user.name || "",
    email: user.email || "",
    role: user.role || "",
    phone: user.phone,
    status: user.status,
    avatar,
  };
};

const safeMessage = (msg, currentUserId = null) => {
  if (!msg) return null;

  const deletedForEveryone = Boolean(msg.isDeletedForEveryone);

  const deletedFor = Array.isArray(msg.deletedFor)
    ? msg.deletedFor.map(String)
    : [];

  const body = deletedForEveryone
    ? "This message was deleted"
    : msg.body || msg.message || "";

  const attachments = deletedForEveryone
    ? []
    : (Array.isArray(msg.attachments) ? msg.attachments : []).map(
        (att) => {
          const item =
            typeof att.toObject === "function"
              ? att.toObject()
              : { ...att };

          if (
            typeof item.url === "string" &&
            !/^https?:\/\//i.test(item.url) &&
            !item.url.startsWith("blob:")
          ) {
            item.url = item.url.startsWith("/")
              ? item.url
              : `/${item.url}`;
          }

          return item;
        }
      );

  return {
    id: msg._id,
    _id: msg._id,
    conversationId: toId(msg.conversation),
    sender: safeUserRef(msg.sender),
    recipient: safeUserRef(msg.recipient),
    body,
    message: body,
    messageType: deletedForEveryone
      ? "text"
      : msg.messageType || "text",
    attachments,
    isRead: Boolean(msg.isRead),
    readAt: msg.readAt || null,
    reactions: Array.isArray(msg.reactions)
      ? msg.reactions
      : Array.isArray(msg.metadata?.reactions)
        ? msg.metadata.reactions
        : [],
    channel: msg.channel || "chat",
    direction: msg.direction || "internal",
    metadata: msg.metadata || {},
    isDeletedForEveryone: deletedForEveryone,
    isDeletedForMe: currentUserId
      ? deletedFor.includes(String(currentUserId))
      : false,
    deletedForEveryoneAt: msg.deletedForEveryoneAt || null,
    deletedBy: safeUserRef(msg.deletedBy),
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
  };
};

const determineMessageType = (
  attachments,
  defaultType = "text"
) => {
  if (!Array.isArray(attachments) || !attachments.length) {
    return defaultType;
  }

  const mime = String(
    attachments[0]?.mimeType ||
      attachments[0]?.fileType ||
      ""
  ).toLowerCase();

  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";

  return "file";
};

const getPreviewText = (text, type) => {
  if (text) return text;

  const previews = {
    image: "📷 Photo",
    video: "🎬 Video",
    audio: "🎤 Audio",
    file: "📎 Attachment",
  };

  return previews[type] || "📎 Attachment";
};

const populateMessage = (query) =>
  query
    .populate("sender", "name email role avatar profileImage")
    .populate("recipient", "name email role avatar profileImage")
    .populate("deletedBy", "name email role");

const getDeletedForUser = (msg, userId) =>
  Array.isArray(msg.deletedFor) &&
  msg.deletedFor.some((id) => String(id) === String(userId));

const emitToConversation = (
  io,
  conversationId,
  event,
  payload
) => {
  if (io && conversationId) {
    io.to(String(conversationId)).emit(event, payload);
  }
};

/*
 * Conversation security:
 * - Group conversations are not supported.
 * - Admin must be a participant in the conversation.
 * - A regular user can access only their own conversation with Admin.
 * - A user cannot access another user's conversation.
 */

const canAccessConversation = async (conversation, user) => {
  if (!conversation || !user || conversation.isGroup === true) {
    return false;
  }

  const currentUserId = String(user._id);
  const participantIds = getParticipantIds(conversation);

  if (!participantIds.includes(currentUserId)) {
    return false;
  }

  const otherIds = participantIds.filter(
    (id) => id !== currentUserId
  );

  if (otherIds.length !== 1) {
    return false;
  }

  const otherUsers = await User.find({
    _id: { $in: otherIds },
  })
    .select("_id role")
    .lean();

  if (otherUsers.length !== 1) {
    return false;
  }

  if (isAdmin(user)) {
    return getUserRole(otherUsers[0]) !== "admin";
  }

  return getUserRole(otherUsers[0]) === "admin";
};

const findAccessibleMessage = async (messageId, user) => {
  if (!isValidObjectId(messageId)) {
    return { error: "invalid" };
  }

  const msg = await Message.findById(messageId);

  if (!msg || getDeletedForUser(msg, user._id)) {
    return { error: "not_found" };
  }

  const conversation = await Conversation.findById(
    msg.conversation
  ).select("participants userId isGroup");

  if (!(await canAccessConversation(conversation, user))) {
    return { error: "forbidden" };
  }

  return { msg, conversation };
};

const sendError = (res, error) => {
  const responses = {
    invalid: [400, "Invalid ID."],
    not_found: [404, "Message or conversation not found."],
    forbidden: [
      403,
      "You are not allowed to access this conversation.",
    ],
  };

  const [status, message] = responses[error] || [
    500,
    "An unexpected error occurred.",
  ];

  return res.status(status).json({
    success: false,
    message,
  });
};

// =====================================================
// GET CONVERSATION MESSAGES
// FIX: Supports both query-string and route-parameter IDs.
// =====================================================

const getMessages = async (req, res) => {
  try {
    // Frontend request:
    // GET /api/messages?conversationId=...&limit=100
    //
    // Also supports the existing route:
    // GET /api/messages/:conversationId

    const conversationId =
      req.query?.conversationId ||
      req.params?.conversationId;

    if (
      typeof conversationId !== "string" ||
      !mongoose.isValidObjectId(conversationId)
    ) {
      return sendError(res, "invalid");
    }

    const conversation = await Conversation.findById(
      conversationId
    ).select("participants userId isGroup");

    if (!conversation) {
      return sendError(res, "not_found");
    }

    if (!(await canAccessConversation(conversation, req.user))) {
      return sendError(res, "forbidden");
    }

    const page = Math.max(
      1,
      parseInt(req.query.page, 10) || 1
    );

    const limit = Math.min(
      150,
      Math.max(1, parseInt(req.query.limit, 10) || 100)
    );

    const filter = {
      conversation: conversationId,
      deletedFor: { $ne: req.user._id },
    };

    const [messages, total] = await Promise.all([
      Message.find(filter)
        .populate(
          "sender",
          "name email role avatar profileImage"
        )
        .populate(
          "recipient",
          "name email role avatar profileImage"
        )
        .populate("deletedBy", "name email role")
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      Message.countDocuments(filter),
    ]);

    messages.reverse();

    const formatted = messages.map((msg) =>
      safeMessage(msg, req.user._id)
    );

    return res.status(200).json({
      success: true,
      messages: formatted,
      data: formatted,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("[Messages] getMessages:", error);

    return res.status(500).json({
      success: false,
      message: "Server error retrieving messages.",
    });
  }
};

// =====================================================
// GET SINGLE MESSAGE
// =====================================================

const getMessageById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await findAccessibleMessage(id, req.user);

    if (result.error) {
      return sendError(res, result.error);
    }

    const msg = await populateMessage(
      Message.findById(result.msg._id)
    ).lean();

    const formatted = safeMessage(msg, req.user._id);

    return res.status(200).json({
      success: true,
      message: formatted,
      data: formatted,
    });
  } catch (error) {
    console.error("[Messages] getMessageById:", error);

    return res.status(500).json({
      success: false,
      message: "Server error retrieving message.",
    });
  }
};

// =====================================================
// SEND MESSAGE
// =====================================================

const sendMessage = async (req, res) => {
  try {
    const {
      conversationId,
      recipientId,
      to,
      body,
      message,
      content,
      messageType,
    } = req.body;

    const currentUserId = String(req.user._id);

    let rawAttachments = req.body.attachments;

    if (typeof rawAttachments === "string") {
      try {
        rawAttachments = JSON.parse(rawAttachments);
      } catch {
        return res.status(400).json({
          success: false,
          message: "Invalid attachments format.",
        });
      }
    }

    const attachments = Array.isArray(rawAttachments)
      ? [...rawAttachments]
      : [];

    const incomingFiles = [];

    if (Array.isArray(req.files)) {
      incomingFiles.push(...req.files);
    } else if (req.files && typeof req.files === "object") {
      Object.values(req.files).forEach((files) => {
        if (Array.isArray(files)) {
          incomingFiles.push(...files);
        } else if (files) {
          incomingFiles.push(files);
        }
      });
    }

    if (req.file) {
      incomingFiles.push(req.file);
    }

    for (const file of incomingFiles) {
      attachments.push({
        url: `/uploads/chat/${file.filename}`,
        filename: file.filename,
        originalName: file.originalname,
        fileType:
          String(file.mimetype || "").split("/")[0] || "file",
        mimeType: file.mimetype,
        size: file.size,
      });
    }

    if (attachments.length > 20) {
      return res.status(400).json({
        success: false,
        message:
          "Maximum 20 attachments are allowed per message.",
      });
    }

    const text = String(
      body ?? message ?? content ?? ""
    ).trim();

    if (!text && attachments.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Message text or an attachment is required.",
      });
    }

    if (text.length > 20000) {
      return res.status(400).json({
        success: false,
        message: "Message exceeds the maximum allowed length.",
      });
    }

    let conversation;
    let recipientUser;

    // Existing conversation: both users must be authorized.
    if (conversationId) {
      if (!isValidObjectId(conversationId)) {
        return sendError(res, "invalid");
      }

      conversation = await Conversation.findById(conversationId);

      if (!conversation) {
        return sendError(res, "not_found");
      }

      if (!(await canAccessConversation(conversation, req.user))) {
        return sendError(res, "forbidden");
      }

      if (recipientId || to) {
        return res.status(400).json({
          success: false,
          message:
            "Do not override the recipient of an existing conversation.",
        });
      }

      const otherId = getParticipantIds(conversation).find(
        (id) => id !== currentUserId
      );

      recipientUser = await User.findById(otherId)
        .select("_id name email role avatar profileImage")
        .lean();

      if (!recipientUser) {
        return sendError(res, "not_found");
      }
    } else {
      // Only Admin can initiate a conversation.
      if (!isAdmin(req.user)) {
        return res.status(403).json({
          success: false,
          message:
            "Users can only reply to an existing Admin conversation.",
        });
      }

      const targetId = String(recipientId || to || "");

      if (
        !isValidObjectId(targetId) ||
        targetId === currentUserId
      ) {
        return res.status(400).json({
          success: false,
          message: "A valid user recipientId is required.",
        });
      }

      recipientUser = await User.findById(targetId)
        .select("_id name email role avatar profileImage")
        .lean();

      if (!recipientUser) {
        return sendError(res, "not_found");
      }

      if (getUserRole(recipientUser) === "admin") {
        return res.status(403).json({
          success: false,
          message:
            "Admin-to-admin conversations are not supported.",
        });
      }

      const ids = [
        new mongoose.Types.ObjectId(currentUserId),
        new mongoose.Types.ObjectId(targetId),
      ];

      conversation = await Conversation.findOne({
        isGroup: { $ne: true },
        participants: { $all: ids, $size: 2 },
      });

      if (!conversation) {
        conversation = await Conversation.create({
          participants: ids,
          isGroup: false,
          status: "open",
          channel: "chat",
        });
      }

      if (!(await canAccessConversation(conversation, req.user))) {
        return sendError(res, "forbidden");
      }
    }

    const recipientIdResolved = String(recipientUser._id);

    const type = determineMessageType(
      attachments,
      messageType || "text"
    );

    const createdMessage = await Message.create({
      conversation: conversation._id,
      sender: req.user._id,
      recipient: recipientUser._id,
      body: text,
      message: text,
      messageType: type,
      attachments,
      isRead: false,
      readAt: null,
    });

    const now = createdMessage.createdAt || new Date();
    const preview = getPreviewText(text, type);

    await Conversation.updateOne(
      { _id: conversation._id },
      {
        $set: {
          lastMessage: preview,
          lastMessageType: type,
          lastMessageAt: now,
          lastSender: req.user._id,
        },
      }
    );

    const senderPayload = {
      _id: req.user._id,
      name: req.user.name || "",
      email: req.user.email || "",
      role: req.user.role || "",
      avatar: req.user.avatar || req.user.profileImage || null,
    };

    const formatted = safeMessage(
      {
        ...createdMessage.toObject(),
        sender: senderPayload,
        recipient: recipientUser,
      },
      currentUserId
    );

    const io = getIo(req);
    const conversationIdString = String(conversation._id);

    if (io) {
      emitToConversation(
        io,
        conversationIdString,
        "receive_message",
        formatted
      );

      emitToConversation(
        io,
        conversationIdString,
        "new_message",
        formatted
      );

      io.to(recipientIdResolved).emit("notification", {
        type: "message",
        title: `New message from ${senderPayload.name || "Admin"}`,
        message: preview,
        conversationId: conversationIdString,
        messageId: String(createdMessage._id),
        senderId: currentUserId,
        senderName: senderPayload.name || "Admin",
        createdAt: now,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Message sent successfully.",
      data: formatted,
      messageData: formatted,
    });
  } catch (error) {
    console.error("[Messages] sendMessage:", error);

    return res.status(500).json({
      success: false,
      message: "Server error sending message.",
    });
  }
};

// =====================================================
// UPDATE MESSAGE
// =====================================================

const updateMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const newText =
      req.body.body ?? req.body.message ?? req.body.content;

    const result = await findAccessibleMessage(id, req.user);

    if (result.error) {
      return sendError(res, result.error);
    }

    const msg = result.msg;

    if (msg.isDeletedForEveryone) {
      return res.status(400).json({
        success: false,
        message: "Deleted messages cannot be edited.",
      });
    }

    if (String(msg.sender) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "You can only edit your own messages.",
      });
    }

    if (newText === undefined) {
      return res.status(400).json({
        success: false,
        message: "Updated message text is required.",
      });
    }

    const text = String(newText).trim();

    if (!text || text.length > 20000) {
      return res.status(400).json({
        success: false,
        message: "Message text is empty or too long.",
      });
    }

    msg.body = text;
    msg.message = text;

    await msg.save();

    const populated = await populateMessage(
      Message.findById(msg._id)
    ).lean();

    const formatted = safeMessage(populated, req.user._id);
    const io = getIo(req);

    if (io) {
      emitToConversation(
        io,
        msg.conversation,
        "message_updated",
        formatted
      );
    }

    return res.status(200).json({
      success: true,
      message: "Message updated successfully.",
      data: formatted,
    });
  } catch (error) {
    console.error("[Messages] updateMessage:", error);

    return res.status(500).json({
      success: false,
      message: "Server error updating message.",
    });
  }
};

// =====================================================
// UNREAD MESSAGE COUNT
// =====================================================

const getUnreadMessageCount = async (req, res) => {
  try {
    const unreadCount = await Message.countDocuments({
      recipient: req.user._id,
      sender: { $ne: req.user._id },
      isRead: false,
      deletedFor: { $ne: req.user._id },
    });

    return res.status(200).json({
      success: true,
      unreadCount,
    });
  } catch (error) {
    console.error("[Messages] getUnreadMessageCount:", error);

    return res.status(500).json({
      success: false,
      message: "Server error retrieving unread count.",
    });
  }
};

// =====================================================
// MARK CONVERSATION MESSAGES AS READ
// =====================================================

const markMessagesAsRead = async (req, res) => {
  try {
    const { conversationId } = req.params;

    if (!isValidObjectId(conversationId)) {
      return sendError(res, "invalid");
    }

    const conversation = await Conversation.findById(
      conversationId
    ).select("participants userId isGroup");

    if (!conversation) {
      return sendError(res, "not_found");
    }

    if (!(await canAccessConversation(conversation, req.user))) {
      return sendError(res, "forbidden");
    }

    const now = new Date();

    const filter = {
      conversation: conversationId,
      recipient: req.user._id,
      isRead: false,
      deletedFor: { $ne: req.user._id },
    };

    const result = await Message.updateMany(filter, {
      $set: { isRead: true, readAt: now },
    });

    const modifiedCount =
      result.modifiedCount ?? result.nModified ?? 0;

    const payload = {
      conversationId: String(conversationId),
      readerId: String(req.user._id),
      readAt: now,
      modifiedCount,
    };

    const io = getIo(req);

    if (io) {
      emitToConversation(
        io,
        conversationId,
        "messages_read",
        payload
      );
    }

    return res.status(200).json({
      success: true,
      message: "Messages marked as read.",
      modifiedCount,
    });
  } catch (error) {
    console.error("[Messages] markMessagesAsRead:", error);

    return res.status(500).json({
      success: false,
      message: "Server error marking messages as read.",
    });
  }
};

// =====================================================
// MARK SINGLE MESSAGE AS READ
// =====================================================

const markSingleMessageAsRead = async (req, res) => {
  try {
    const messageId = req.params.messageId || req.params.id;

    const result = await findAccessibleMessage(messageId, req.user);

    if (result.error) {
      return sendError(res, result.error);
    }

    const msg = result.msg;

    if (String(msg.recipient) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "You can only mark messages sent to you as read.",
      });
    }

    if (!msg.isRead) {
      msg.isRead = true;
      msg.readAt = new Date();
      await msg.save();
    }

    const populated = await populateMessage(
      Message.findById(msg._id)
    ).lean();

    const formatted = safeMessage(populated, req.user._id);
    const io = getIo(req);

    if (io) {
      emitToConversation(
        io,
        msg.conversation,
        "message_read",
        formatted
      );
    }

    return res.status(200).json({
      success: true,
      data: formatted,
    });
  } catch (error) {
    console.error(
      "[Messages] markSingleMessageAsRead:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Server error marking message as read.",
    });
  }
};

// =====================================================
// DELETE MESSAGE FOR ME
// =====================================================

const deleteMessageForMe = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await findAccessibleMessage(id, req.user);

    if (result.error) {
      return sendError(res, result.error);
    }

    await Message.updateOne(
      { _id: id },
      { $addToSet: { deletedFor: req.user._id } }
    );

    return res.status(200).json({
      success: true,
      message: "Message deleted for you.",
      messageId: id,
    });
  } catch (error) {
    console.error("[Messages] deleteMessageForMe:", error);

    return res.status(500).json({
      success: false,
      message: "Server error deleting message.",
    });
  }
};

// =====================================================
// DELETE MESSAGE FOR EVERYONE
// =====================================================

const deleteMessageForEveryone = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await findAccessibleMessage(id, req.user);

    if (result.error) {
      return sendError(res, result.error);
    }

    const msg = result.msg;

    if (
      String(msg.sender) !== String(req.user._id) &&
      !isAdmin(req.user)
    ) {
      return res.status(403).json({
        success: false,
        message: "You cannot delete this message for everyone.",
      });
    }

    msg.isDeletedForEveryone = true;
    msg.deletedForEveryoneAt = new Date();
    msg.deletedBy = req.user._id;
    msg.body = "This message was deleted";
    msg.message = "This message was deleted";
    msg.attachments = [];

    await msg.save();

    const populated = await populateMessage(
      Message.findById(msg._id)
    ).lean();

    const formatted = safeMessage(populated, req.user._id);
    const io = getIo(req);

    if (io) {
      emitToConversation(
        io,
        msg.conversation,
        "message_deleted",
        formatted
      );
    }

    return res.status(200).json({
      success: true,
      message: "Message deleted for everyone.",
      data: formatted,
    });
  } catch (error) {
    console.error(
      "[Messages] deleteMessageForEveryone:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Server error deleting message.",
    });
  }
};

const deleteMessage = async (req, res) => {
  const type = String(
    req.query.type || req.body?.type || ""
  ).toLowerCase();

  if (type === "me") {
    return deleteMessageForMe(req, res);
  }

  return deleteMessageForEveryone(req, res);
};

// =====================================================
// MESSAGE REACTIONS
// =====================================================

const reactToMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const emoji = String(req.body?.emoji || "").trim();

    if (!isValidObjectId(id) || !emoji) {
      return res.status(400).json({
        success: false,
        message: "A valid message ID and emoji are required.",
      });
    }

    if (emoji.length > 32) {
      return res.status(400).json({
        success: false,
        message: "Invalid reaction.",
      });
    }

    const result = await findAccessibleMessage(id, req.user);

    if (result.error) {
      return sendError(res, result.error);
    }

    const msg = result.msg;

    if (msg.isDeletedForEveryone) {
      return res.status(400).json({
        success: false,
        message: "Deleted messages cannot be reacted to.",
      });
    }

    const metadata = msg.metadata?.toObject
      ? msg.metadata.toObject()
      : { ...(msg.metadata || {}) };

    const reactions = Array.isArray(metadata.reactions)
      ? [...metadata.reactions]
      : [];

    const userId = String(req.user._id);

    const index = reactions.findIndex(
      (reaction) => String(reaction.userId) === userId
    );

    if (index >= 0 && reactions[index].emoji === emoji) {
      reactions.splice(index, 1);
    } else {
      const reaction = {
        userId,
        emoji,
        createdAt: new Date(),
      };

      if (index >= 0) {
        reactions[index] = reaction;
      } else {
        reactions.push(reaction);
      }
    }

    metadata.reactions = reactions;
    msg.metadata = metadata;
    msg.markModified("metadata");

    await msg.save();

    const populated = await populateMessage(
      Message.findById(msg._id)
    ).lean();

    const formatted = safeMessage(populated, req.user._id);

    const payload = {
      conversationId: String(msg.conversation),
      messageId: String(msg._id),
      reactions: formatted.reactions,
      message: formatted,
    };

    const io = getIo(req);

    if (io) {
      emitToConversation(
        io,
        msg.conversation,
        "message_reaction_updated",
        payload
      );
    }

    return res.status(200).json({
      success: true,
      data: formatted,
      reactions: formatted.reactions,
    });
  } catch (error) {
    console.error("[Messages] reactToMessage:", error);

    return res.status(500).json({
      success: false,
      message: "Server error updating reaction.",
    });
  }
};

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
  getMessages,
  getMessageById,
  sendMessage,
  updateMessage,
  getUnreadMessageCount,
  markMessagesAsRead,
  markSingleMessageAsRead,
  deleteMessage,
  deleteMessageForMe,
  deleteMessageForEveryone,
  reactToMessage,
};