"use strict";

const mongoose = require("mongoose");
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const User = require("../models/User");
const { createNotification } = require("./notificationController");
const { sendMessageNotificationEmail } = require("../utils/sendEmail");

// =====================================================
// HELPERS
// =====================================================

const isValidObjectId = (id) =>
  Boolean(id) && mongoose.Types.ObjectId.isValid(String(id));

const toId = (value) => {
  if (!value) return null;
  if (typeof value === "object" && value._id) {
    return String(value._id);
  }
  return String(value);
};

const safeUserRef = (user) => {
  if (!user) return null;

  if (typeof user === "object" && user._id) {
    let avatar = user.avatar || user.profileImage || user.image || null;

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
      phone: user.phone,
      role: user.role || "",
      status: user.status,
      avatar,
    };
  }

  return user;
};

const safeMessage = (msg, currentUserId = null) => {
  if (!msg) return null;

  const deletedForEveryone = Boolean(msg.isDeletedForEveryone);

  const deletedFor = Array.isArray(msg.deletedFor)
    ? msg.deletedFor.map(String)
    : [];

  const deletedForMe = currentUserId
    ? deletedFor.includes(String(currentUserId))
    : false;

  const body = deletedForEveryone
    ? "This message was deleted"
    : msg.body || msg.message || "";

  // Normalize attachment URLs so images load instantly like WhatsApp/Teams
  const attachments = deletedForEveryone
    ? []
    : Array.isArray(msg.attachments)
      ? msg.attachments.map((att) => ({
          ...att,
          url: att.url && !att.url.startsWith("http") && !att.url.startsWith("blob:") 
            ? (att.url.startsWith("/") ? att.url : `/${att.url}`) 
            : att.url
        }))
      : [];

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
    isDeletedForMe: deletedForMe,
    deletedForEveryoneAt: msg.deletedForEveryoneAt || null,
    deletedBy: safeUserRef(msg.deletedBy),
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
  };
};

const determineMessageType = (attachments, defaultType = "text") => {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return defaultType;
  }

  const mime = String(
    attachments[0]?.mimeType || attachments[0]?.fileType || ""
  ).toLowerCase();

  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";

  return "file";
};

const getIo = (req) => req.app.get("io");

const emitToConversation = (io, conversationId, eventName, payload) => {
  if (!io || !conversationId) return;
  io.to(String(conversationId)).emit(eventName, payload);
};

const emitToUserOutsideConversation = (
  io,
  userId,
  conversationId,
  eventName,
  payload
) => {
  if (!io || !userId || !eventName) return;

  const userRoom = String(userId);
  const conversationRoom = String(conversationId || "");

  try {
    const sockets = io.sockets?.sockets;

    if (sockets && typeof sockets.forEach === "function") {
      sockets.forEach((socket) => {
        if (
          socket.rooms?.has(userRoom) &&
          (!conversationRoom || !socket.rooms.has(conversationRoom))
        ) {
          socket.emit(eventName, payload);
        }
      });
      return;
    }

    let operator = io.to(userRoom);

    if (
      conversationRoom &&
      operator &&
      typeof operator.except === "function"
    ) {
      operator = operator.except(conversationRoom);
    }

    operator?.emit(eventName, payload);
  } catch (error) {
    console.error(
      `[Socket.IO] Failed to emit ${eventName}:`,
      error.message
    );
  }
};

const canAccessConversation = (
  conversation,
  userId,
  role = ""
) => {
  if (!conversation || !userId) return false;

  const normalizedRole = String(role || "").toLowerCase();

  if (normalizedRole === "admin" || normalizedRole === "manager") {
    return true;
  }

  const participantIds = Array.isArray(conversation.participants)
    ? conversation.participants.map((participant) =>
        String(participant?._id || participant)
      )
    : [];

  if (participantIds.includes(String(userId))) {
    return true;
  }

  const legacyUserId = conversation.userId
    ? String(conversation.userId?._id || conversation.userId)
    : null;

  return legacyUserId === String(userId);
};

const getPreviewText = (text, messageType) => {
  if (text) return text;

  switch (messageType) {
    case "image":
      return "📷 Photo";
    case "video":
      return "🎬 Video";
    case "audio":
      return "🎤 Audio";
    default:
      return "📎 Attachment";
  }
};

const populateMessage = (query) =>
  query
    .populate("sender", "name email role avatar profileImage")
    .populate("recipient", "name email role avatar profileImage")
    .populate("deletedBy", "name email role");

const getDeletedForUser = (msg, userId) =>
  Array.isArray(msg.deletedFor) &&
  msg.deletedFor.some((id) => String(id) === String(userId));

const getUserRole = (user) =>
  String(user?.role || "").toLowerCase();

const getParticipantIds = (conversation) =>
  Array.isArray(conversation?.participants)
    ? [
        ...new Set(
          conversation.participants
            .map((participant) => toId(participant))
            .filter(Boolean)
        ),
      ]
    : [];

// =====================================================
// GET CONVERSATION MESSAGES
// =====================================================

const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 100 } = req.query;

    if (!isValidObjectId(conversationId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID.",
      });
    }

    const conversation = await Conversation.findById(conversationId)
      .select("participants userId")
      .lean();

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found.",
      });
    }

    if (
      !canAccessConversation(
        conversation,
        req.user._id,
        getUserRole(req.user)
      )
    ) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to access this conversation.",
      });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(
      150,
      Math.max(1, parseInt(limit, 10) || 100)
    );
    const skip = (pageNum - 1) * limitNum;

    const filter = {
      conversation: conversationId,
      deletedFor: { $ne: req.user._id },
    };

    const [messages, total] = await Promise.all([
      Message.find(filter)
        .populate("sender", "name email role avatar profileImage")
        .populate("recipient", "name email role avatar profileImage")
        .populate("deletedBy", "name email role")
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limitNum)
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
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 0,
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

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid message ID.",
      });
    }

    const msg = await populateMessage(Message.findById(id)).lean();

    if (!msg || getDeletedForUser(msg, req.user._id)) {
      return res.status(404).json({
        success: false,
        message: "Message not found.",
      });
    }

    const conversation = await Conversation.findById(msg.conversation)
      .select("participants userId")
      .lean();

    if (
      !conversation ||
      !canAccessConversation(
        conversation,
        req.user._id,
        getUserRole(req.user)
      )
    ) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view this message.",
      });
    }

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
// SEND MESSAGE (INSTANT 1-SECOND OPTIMIZED)
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
    const role = getUserRole(req.user);

    let rawAttachments = req.body.attachments;

    if (typeof rawAttachments === "string") {
      try {
        rawAttachments = JSON.parse(rawAttachments);
      } catch {
        rawAttachments = [];
      }
    }

    let attachments = Array.isArray(rawAttachments)
      ? [...rawAttachments]
      : [];

    const incomingFiles = [];

    if (Array.isArray(req.files)) {
      incomingFiles.push(...req.files);
    } else if (req.files && typeof req.files === "object") {
      Object.values(req.files).forEach((fileList) => {
        if (Array.isArray(fileList)) {
          incomingFiles.push(...fileList);
        } else if (fileList) {
          incomingFiles.push(fileList);
        }
      });
    }

    if (req.file) incomingFiles.push(req.file);

    for (const file of incomingFiles) {
      attachments.push({
        url: `/uploads/chat/${file.filename}`,
        filename: file.filename,
        originalName: file.originalname,
        fileType: String(file.mimetype || "").split("/")[0] || "file",
        mimeType: file.mimetype,
        size: file.size,
      });
    }

    const text = String(body ?? message ?? content ?? "").trim();

    if (!text && attachments.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Message text or an attachment is required.",
      });
    }

    let conversation;
    let recipientUser = null;

    if (conversationId) {
      if (!isValidObjectId(conversationId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid conversation ID.",
        });
      }

      conversation = await Conversation.findById(conversationId);

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found.",
        });
      }

      if (
        !canAccessConversation(
          conversation,
          currentUserId,
          role
        )
      ) {
        return res.status(403).json({
          success: false,
          message: "You are not allowed to access this conversation.",
        });
      }
    } else {
      const targetId = String(recipientId || to || "");

      if (!isValidObjectId(targetId)) {
        return res.status(400).json({
          success: false,
          message: "A valid recipientId or conversationId is required.",
        });
      }

      if (targetId === currentUserId) {
        return res.status(400).json({
          success: false,
          message: "Cannot send a message to yourself.",
        });
      }

      recipientUser = await User.findById(targetId)
        .select("_id name email role avatar profileImage")
        .lean();

      if (!recipientUser) {
        return res.status(404).json({
          success: false,
          message: "Recipient user not found.",
        });
      }

      const currentObjectId = new mongoose.Types.ObjectId(currentUserId);
      const targetObjectId = new mongoose.Types.ObjectId(targetId);

      conversation = await Conversation.findOne({
        isGroup: { $ne: true },
        participants: {
          $all: [currentObjectId, targetObjectId],$size: 2,
        },
      });

      if (!conversation) {
        conversation = await Conversation.create({
          participants: [currentObjectId, targetObjectId],
          isGroup: false,
          status: "open",
          channel: "chat",
        });
      }
    }

    const participantIds = getParticipantIds(conversation);
    let resolvedRecipientId = null;

    if (participantIds.length > 0) {
      if (!conversation.isGroup) {
        resolvedRecipientId =
          participantIds.find((id) => id !== currentUserId) || null;
      }
    }

    if (resolvedRecipientId) {
      recipientUser =
        recipientUser ||
        (await User.findById(resolvedRecipientId)
          .select("_id name email role avatar profileImage")
          .lean());
    }

    const recipientIds = conversation.isGroup
      ? participantIds.filter((id) => id !== currentUserId)
      : resolvedRecipientId
        ? [resolvedRecipientId]
        : [];

    const calculatedMessageType =
      attachments.length > 0
        ? determineMessageType(
            attachments,
            messageType && messageType !== "text"
              ? messageType
              : "file"
          )
        : messageType || "text";

    const createdMessage = await Message.create({
      conversation: conversation._id,
      sender: req.user._id,
      recipient: resolvedRecipientId,
      body: text,
      message: text,
      messageType: calculatedMessageType,
      attachments,
      isRead: false,
      readAt: null,
    });

    const conversationIdString = String(conversation._id);
    const now = createdMessage.createdAt || new Date();
    const previewText = getPreviewText(text, calculatedMessageType);

    await Conversation.updateOne(
      { _id: conversation._id },
      {
        $set: {
          lastMessage: previewText,
          lastMessageType: calculatedMessageType,
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
      status: req.user.status,
    };

    const recipientPayload = recipientUser
      ? {
          _id: recipientUser._id,
          name: recipientUser.name || "",
          email: recipientUser.email || "",
          role: recipientUser.role || "",
          avatar: recipientUser.avatar || recipientUser.profileImage || null,
        }
      : null;

    const formattedMessage = safeMessage(
      {
        ...createdMessage.toObject(),
        sender: senderPayload,
        recipient: recipientPayload,
      },
      currentUserId
    );

    const io = getIo(req);

    if (io) {
      // Emit both receive_message and new_message to ensure instant client synchronization across WhatsApp/Teams layouts
      emitToConversation(
        io,
        conversationIdString,
        "receive_message",
        formattedMessage
      );
      emitToConversation(
        io,
        conversationIdString,
        "new_message",
        formattedMessage
      );

      for (const targetUserId of recipientIds) {
        emitToUserOutsideConversation(
          io,
          targetUserId,
          conversationIdString,
          "receive_message",
          formattedMessage
        );
        emitToUserOutsideConversation(
          io,
          targetUserId,
          conversationIdString,
          "new_message",
          formattedMessage
        );

        io.to(String(targetUserId)).emit("notification", {
          type: "message",
          title: `New message from ${senderPayload.name || "User"}`,
          message: previewText,
          conversationId: conversationIdString,
          messageId: String(createdMessage._id),
          senderId: currentUserId,
          senderName: senderPayload.name || "User",
          createdAt: now,
        });
      }
    }

    return res.status(201).json({
      success: true,
      message: "Message sent successfully.",
      data: formattedMessage,
      messageData: formattedMessage,
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
    const newText = req.body.body ?? req.body.message ?? req.body.content;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid message ID." });
    }

    const msg = await Message.findById(id);
    if (!msg || msg.isDeletedForEveryone) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }

    if (newText !== undefined) {
      msg.body = String(newText).trim();
      msg.message = String(newText).trim();
      await msg.save();
    }

    const populated = await populateMessage(Message.findById(msg._id)).lean();
    const formatted = safeMessage(populated, req.user._id);
    const io = getIo(req);

    if (io) {
      emitToConversation(io, msg.conversation, "message_updated", formatted);
    }

    return res.status(200).json({ success: true, message: "Message updated successfully.", data: formatted });
  } catch (error) {
    console.error("[Messages] updateMessage:", error);
    return res.status(500).json({ success: false, message: "Server error updating message." });
  }
};

// =====================================================
// UNREAD COUNT
// =====================================================

const getUnreadMessageCount = async (req, res) => {
  try {
    const unreadCount = await Message.countDocuments({
      recipient: req.user._id,
      isRead: false,
      deletedFor: { $ne: req.user._id },
    });
    return res.status(200).json({ success: true, unreadCount });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// =====================================================
// MARK CONVERSATION MESSAGES AS READ
// =====================================================

const markMessagesAsRead = async (req, res) => {
  try {
    const { conversationId } = req.params;
    if (!isValidObjectId(conversationId)) {
      return res.status(400).json({ success: false, message: "Invalid conversation ID." });
    }

    const now = new Date();
    const filter = {
      conversation: conversationId,
      recipient: req.user._id,
      isRead: false,
      deletedFor: { $ne: req.user._id },
    };

    const [sendersToNotify, result] = await Promise.all([
      Message.distinct("sender", filter),
      Message.updateMany(filter, { $set: { isRead: true, readAt: now } }),
    ]);

    const io = getIo(req);
    const payload = {
      conversationId: String(conversationId),
      readerId: String(req.user._id),
      readAt: now,
      modifiedCount: result.modifiedCount ?? result.nModified ?? 0,
    };

    if (io) {
      emitToConversation(io, conversationId, "messages_read", payload);
    }

    return res.status(200).json({ success: true, message: "Messages marked as read.", modifiedCount: payload.modifiedCount });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// =====================================================
// MARK SINGLE MESSAGE AS READ
// =====================================================

const markSingleMessageAsRead = async (req, res) => {
  try {
    const messageId = req.params.messageId || req.params.id;
    if (!isValidObjectId(messageId)) {
      return res.status(400).json({ success: false, message: "Invalid message ID." });
    }

    const msg = await Message.findById(messageId);
    if (!msg) return res.status(404).json({ success: false, message: "Message not found." });

    if (!msg.isRead) {
      msg.isRead = true;
      msg.readAt = new Date();
      await msg.save();
    }

    const populated = await populateMessage(Message.findById(msg._id)).lean();
    const formatted = safeMessage(populated, req.user._id);
    const io = getIo(req);

    if (io) {
      emitToConversation(io, msg.conversation, "message_read", formatted);
    }

    return res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// =====================================================
// DELETE MESSAGE FOR ME
// =====================================================

const deleteMessageForMe = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid ID." });

    await Message.updateOne({ _id: id }, { $addToSet: { deletedFor: req.user._id } });
    return res.status(200).json({ success: true, messageId: id });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// =====================================================
// DELETE MESSAGE FOR EVERYONE
// =====================================================

const deleteMessageForEveryone = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid ID." });

    const msg = await Message.findById(id);
    if (!msg) return res.status(404).json({ success: false, message: "Not found." });

    msg.isDeletedForEveryone = true;
    msg.deletedForEveryoneAt = new Date();
    msg.deletedBy = req.user._id;
    msg.body = "This message was deleted";
    msg.message = "This message was deleted";
    msg.attachments = [];
    await msg.save();

    const populated = await populateMessage(Message.findById(msg._id)).lean();
    const formatted = safeMessage(populated, req.user._id);
    const io = getIo(req);

    if (io) {
      emitToConversation(io, msg.conversation, "message_deleted", formatted);
    }

    return res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

const deleteMessage = async (req, res) => {
  const deleteType = String(req.query.type || req.body?.type || "").toLowerCase();
  if (deleteType === "me") return deleteMessageForMe(req, res);
  return deleteMessageForEveryone(req, res);
};

// =====================================================
// REACTIONS
// =====================================================

const reactToMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const emoji = String(req.body?.emoji || "").trim();
    if (!isValidObjectId(id) || !emoji) return res.status(400).json({ success: false, message: "Invalid request." });

    const msg = await Message.findById(id);
    if (!msg) return res.status(404).json({ success: false, message: "Not found." });

    const userId = String(req.user._id);
    const metadata = msg.metadata && typeof msg.metadata === "object" ? { ...msg.metadata } : {};
    let reactions = Array.isArray(metadata.reactions) ? [...metadata.reactions] : [];

    const existingIndex = reactions.findIndex((r) => String(r.userId) === userId);
    if (existingIndex >= 0 && reactions[existingIndex].emoji === emoji) {
      reactions.splice(existingIndex, 1);
    } else {
      const reaction = { userId, emoji, createdAt: new Date() };
      if (existingIndex >= 0) reactions[existingIndex] = reaction;
      else reactions.push(reaction);
    }

    metadata.reactions = reactions;
    msg.metadata = metadata;
    msg.markModified("metadata");
    await msg.save();

    const populated = await populateMessage(Message.findById(msg._id)).lean();
    const formatted = safeMessage(populated, req.user._id);
    const payload = { conversationId: String(msg.conversation), messageId: String(msg._id), reactions: formatted.reactions, message: formatted };

    const io = getIo(req);
    if (io) {
      emitToConversation(io, msg.conversation, "message_reaction_updated", payload);
    }

    return res.status(200).json({ success: true, data: formatted, reactions: formatted.reactions });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

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