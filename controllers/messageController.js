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
  Boolean(id) && mongoose.Types.ObjectId.isValid(id);

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
    let avatar = user.avatar || null;

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

  return {
    id: msg._id,
    _id: msg._id,
    conversationId: msg.conversation,
    sender: safeUserRef(msg.sender),
    recipient: safeUserRef(msg.recipient),
    body,
    message: body,
    messageType: deletedForEveryone
      ? "text"
      : msg.messageType || "text",
    attachments: deletedForEveryone
      ? []
      : Array.isArray(msg.attachments)
        ? msg.attachments
        : [],
    isRead: Boolean(msg.isRead),
    readAt: msg.readAt || null,
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
    console.error(`[Socket.IO] ${eventName} failed:`, error.message);
  }
};

const canAccessConversation = (conversation, userId, role) => {
  const isParticipant =
    Array.isArray(conversation.participants) &&
    conversation.participants.some(
      (participant) => String(participant?._id || participant) === String(userId)
    );

  const isLegacyUser =
    conversation.userId &&
    String(conversation.userId?._id || conversation.userId) === String(userId);

  return (
    isParticipant ||
    isLegacyUser ||
    role === "admin" ||
    role === "manager"
  );
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

// =====================================================
// GET CONVERSATION MESSAGES
// =====================================================

const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;

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

    const currentUserId = String(req.user._id);
    const role = String(req.user?.role || "").toLowerCase();

    if (!canAccessConversation(conversation, currentUserId, role)) {
      return res.status(403).json({
        success: false,
        message: "You are not a participant in this conversation.",
      });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const filter = {
      conversation: conversationId,
      deletedFor: { $ne: req.user._id },
    };

    const [messages, total] = await Promise.all([
      Message.find(filter)
        .populate("sender", "name email role avatar")
        .populate("recipient", "name email role avatar")
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

    const msg = await Message.findById(id)
      .populate("sender", "name email role avatar")
      .populate("recipient", "name email role avatar")
      .populate("deletedBy", "name email role")
      .lean();

    if (!msg) {
      return res.status(404).json({
        success: false,
        message: "Message not found.",
      });
    }

    const currentUserId = String(req.user._id);
    const role = String(req.user?.role || "").toLowerCase();

    const deletedForUser =
      Array.isArray(msg.deletedFor) &&
      msg.deletedFor.some((uid) => String(uid) === currentUserId);

    if (deletedForUser) {
      return res.status(404).json({
        success: false,
        message: "Message not found.",
      });
    }

    if (
      toId(msg.sender) !== currentUserId &&
      toId(msg.recipient) !== currentUserId &&
      role !== "admin" &&
      role !== "manager"
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
    const role = String(req.user?.role || "").toLowerCase();

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
        url: `/uploads/${file.filename}`,
        filename: file.filename,
        originalName: file.originalname,
        fileType: String(file.mimetype || "").split("/")[0] || "file",
        mimeType: file.mimetype,
        size: file.size,
      });
    }

    const seen = new Set();

    attachments = attachments.filter((attachment) => {
      const key = attachment?.url || attachment?.filename;
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const text = String(body ?? message ?? content ?? "").trim();

    if (!text && attachments.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Message text or an attachment is required.",
      });
    }

    let conversation = null;
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

      if (!canAccessConversation(conversation, currentUserId, role)) {
        return res.status(403).json({
          success: false,
          message: "You are not a participant in this conversation.",
        });
      }
    } else {
      const targetId = recipientId || to;

      if (!targetId || !isValidObjectId(targetId)) {
        return res.status(400).json({
          success: false,
          message: "A valid recipientId or conversationId is required.",
        });
      }

      if (String(targetId) === currentUserId) {
        return res.status(400).json({
          success: false,
          message: "Cannot send a message to yourself.",
        });
      }

      recipientUser = await User.findById(targetId)
        .select("_id name email role avatar")
        .lean();

      if (!recipientUser) {
        return res.status(404).json({
          success: false,
          message: "Recipient user not found.",
        });
      }

      if (role !== "admin" && role !== "manager") {
        const targetRole = String(recipientUser.role || "").toLowerCase();

        if (
          targetRole !== "admin" &&
          targetRole !== "manager" &&
          targetRole !== "support"
        ) {
          return res.status(403).json({
            success: false,
            message: "Regular users can only message Admin or Support.",
          });
        }
      }

      conversation = await Conversation.findOne({
        participants: {
          $all: [req.user._id, targetId],
          $size: 2,
        },
      });

      if (!conversation) {
        conversation = await Conversation.create({
          participants: [req.user._id, targetId],
          status: "open",
          channel: "chat",
        });
      }
    }

    // Resolve the recipient from the conversation participants.
    // This is the user who should receive this message, not the sender.
    const participantIds = Array.isArray(conversation.participants)
      ? conversation.participants.map((participant) =>
          String(participant?._id || participant)
        )
      : [];

    let resolvedRecipientId = participantIds.find(
      (participantId) => participantId !== currentUserId
    );

    if (
      !resolvedRecipientId &&
      conversation.userId &&
      String(conversation.userId?._id || conversation.userId) !== currentUserId
    ) {
      resolvedRecipientId = String(
        conversation.userId?._id || conversation.userId
      );
    }

    // Explicit recipient is only a fallback when the conversation
    // does not provide another participant.
    if (!resolvedRecipientId && (recipientId || to)) {
      const targetId = String(recipientId || to);

      if (targetId !== currentUserId) {
        resolvedRecipientId = targetId;
      }
    }

    if (!resolvedRecipientId) {
      return res.status(400).json({
        success: false,
        message: "Could not resolve the other participant in this conversation.",
      });
    }

    if (!isValidObjectId(resolvedRecipientId)) {
      return res.status(400).json({
        success: false,
        message: "The recipient ID in this conversation is invalid.",
      });
    }

    if (resolvedRecipientId === currentUserId) {
      return res.status(400).json({
        success: false,
        message: "Cannot send a message to yourself.",
      });
    }

    if (!recipientUser) {
      recipientUser = await User.findById(resolvedRecipientId)
        .select("_id name email role avatar")
        .lean();
    }

    if (!recipientUser) {
      return res.status(404).json({
        success: false,
        message: "Conversation recipient was not found.",
      });
    }

    const calculatedMessageType =
      attachments.length > 0
        ? determineMessageType(
            attachments,
            messageType && messageType !== "text" ? messageType : "file"
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

    const senderPayload = {
      _id: req.user._id,
      name: req.user.name || "",
      email: req.user.email || "",
      role: req.user.role || "",
      avatar: req.user.avatar || null,
      status: req.user.status,
    };

    const recipientPayload = {
      _id: recipientUser._id,
      name: recipientUser.name || "",
      email: recipientUser.email || "",
      role: recipientUser.role || "",
      avatar: recipientUser.avatar || null,
    };

    const formattedMessage = safeMessage(
      {
        ...createdMessage.toObject(),
        sender: senderPayload,
        recipient: recipientPayload,
      },
      req.user._id
    );

    const io = getIo(req);

    // Emit the saved message to everyone in the same conversation.
    if (io) {
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

      // Deliver to the recipient's other tabs/devices if they
      // are not currently joined to this conversation room.
      emitToUserOutsideConversation(
        io,
        resolvedRecipientId,
        conversationIdString,
        "receive_message",
        formattedMessage
      );

      emitToUserOutsideConversation(
        io,
        resolvedRecipientId,
        conversationIdString,
        "new_message",
        formattedMessage
      );

      const senderName =
        req.user.name || (role === "admin" ? "Admin" : "User");

      const notificationPayload = {
        type: "message",
        title: `New message from ${senderName}`,
        message: previewText,
        conversationId: conversationIdString,
        messageId: String(createdMessage._id),
        senderId: currentUserId,
        senderName,
        createdAt: now,
      };

      io.to(resolvedRecipientId).emit(
        "notification",
        notificationPayload
      );

      io.to(resolvedRecipientId).emit(
        "message_notification",
        notificationPayload
      );
    }

    // Update conversation preview asynchronously.
    Conversation.updateOne(
      { _id: conversation._id },
      {
        $set: {
          lastMessage: previewText,
          lastMessageType: calculatedMessageType,
          lastMessageAt: now,
          lastSender: req.user._id,
        },
      }
    )
      .exec()
      .catch((error) => {
        console.error(
          "[Messages] Conversation preview update failed:",
          error.message
        );
      });

    // Persistent notification and email are processed in the background.
    const senderName =
      req.user.name || (role === "admin" ? "Admin" : "User");

    setImmediate(() => {
      void (async () => {
        try {
          await createNotification({
            userId: resolvedRecipientId,
            type: "message",
            title: "New Message",
            message: `${senderName} sent you a message.`,
            relatedId: conversation._id,
            relatedType: "Message",
            actionUrl:
              role === "admin" || role === "manager"
                ? "/user/conversations"
                : "/admin/conversations",
            metadata: {
              conversationId: conversation._id,
              messageId: createdMessage._id,
              senderId: req.user._id,
              senderName,
            },
          });
        } catch (error) {
          console.error(
            "[Messages] Notification creation failed:",
            error.message
          );
        }

        try {
          if (recipientUser.email) {
            await sendMessageNotificationEmail(
              recipientUser.email,
              recipientUser.name || "User",
              senderName,
              previewText
            );
          }
        } catch (error) {
          console.error(
            "[Messages] Notification email failed:",
            error.message
          );
        }
      })();
    });

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
      return res.status(400).json({
        success: false,
        message: "Invalid message ID.",
      });
    }

    const msg = await Message.findById(id);

    if (!msg) {
      return res.status(404).json({
        success: false,
        message: "Message not found.",
      });
    }

    if (msg.isDeletedForEveryone) {
      return res.status(400).json({
        success: false,
        message: "Cannot edit a deleted message.",
      });
    }

    const role = String(req.user?.role || "").toLowerCase();

    if (
      String(msg.sender) !== String(req.user._id) &&
      role !== "admin"
    ) {
      return res.status(403).json({
        success: false,
        message: "You can only edit your own messages.",
      });
    }

    if (newText !== undefined) {
      const updatedText = String(newText).trim();

      if (
        !updatedText &&
        (!Array.isArray(msg.attachments) || msg.attachments.length === 0)
      ) {
        return res.status(400).json({
          success: false,
          message: "Message text cannot be empty.",
        });
      }

      msg.body = updatedText;
      msg.message = updatedText;
    }

    await msg.save();

    const populated = await Message.findById(msg._id)
      .populate("sender", "name email role avatar")
      .populate("recipient", "name email role avatar")
      .lean();

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
// UNREAD COUNT
// =====================================================

const getUnreadMessageCount = async (req, res) => {
  try {
    const unreadCount = await Message.countDocuments({
      recipient: req.user._id,
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

    const currentUserId = String(req.user._id);
    const role = String(req.user?.role || "").toLowerCase();

    if (!canAccessConversation(conversation, currentUserId, role)) {
      return res.status(403).json({
        success: false,
        message: "You are not a participant in this conversation.",
      });
    }

    const now = new Date();
    const filter = {
      conversation: conversationId,
      recipient: req.user._id,
      isRead: false,
    };

    const [sendersToNotify, result] = await Promise.all([
      Message.distinct("sender", filter),
      Message.updateMany(filter, {
        $set: { isRead: true, readAt: now },
      }),
    ]);

    const io = getIo(req);
    const payload = {
      conversationId: String(conversationId),
      readerId: currentUserId,
      readAt: now,
      modifiedCount: result.modifiedCount ?? result.nModified ?? 0,
    };

    if (io) {
      emitToConversation(io, conversationId, "messages_read", payload);

      for (const senderId of sendersToNotify) {
        if (String(senderId) !== currentUserId) {
          emitToUserOutsideConversation(
            io,
            senderId,
            conversationId,
            "messages_read",
            payload
          );
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: "Messages marked as read.",
      modifiedCount: payload.modifiedCount,
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

    if (!isValidObjectId(messageId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid message ID.",
      });
    }

    const msg = await Message.findById(messageId);

    if (!msg) {
      return res.status(404).json({
        success: false,
        message: "Message not found.",
      });
    }

    if (
      !msg.recipient ||
      String(msg.recipient) !== String(req.user._id)
    ) {
      return res.status(403).json({
        success: false,
        message: "You can only mark messages sent to you as read.",
      });
    }

    const deletedForUser =
      Array.isArray(msg.deletedFor) &&
      msg.deletedFor.some((uid) => String(uid) === String(req.user._id));

    if (deletedForUser) {
      return res.status(404).json({
        success: false,
        message: "Message not found.",
      });
    }

    if (!msg.isRead) {
      msg.isRead = true;
      msg.readAt = new Date();
      await msg.save();
    }

    const populated = await Message.findById(msg._id)
      .populate("sender", "name email role avatar")
      .populate("recipient", "name email role avatar")
      .lean();

    const formatted = safeMessage(populated, req.user._id);
    const io = getIo(req);
    const conversationId = String(msg.conversation);

    const payload = {
      conversationId,
      messageId: String(msg._id),
      readerId: String(req.user._id),
      readAt: msg.readAt || new Date(),
    };

    if (io) {
      emitToConversation(io, conversationId, "message_read", formatted);

      if (msg.sender) {
        emitToUserOutsideConversation(
          io,
          msg.sender,
          conversationId,
          "message_read",
          formatted
        );

        emitToUserOutsideConversation(
          io,
          msg.sender,
          conversationId,
          "messages_read",
          payload
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: "Message marked as read.",
      data: formatted,
    });
  } catch (error) {
    console.error("[Messages] markSingleMessageAsRead:", error);

    return res.status(500).json({
      success: false,
      message: "Server error marking message as read.",
    });
  }
};

// =====================================================
// DELETE MESSAGE FOR CURRENT USER
// =====================================================

const deleteMessageForMe = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid message ID.",
      });
    }

    const msg = await Message.findById(id).select("_id").lean();

    if (!msg) {
      return res.status(404).json({
        success: false,
        message: "Message not found.",
      });
    }

    await Message.updateOne(
      { _id: id },
      { $addToSet: { deletedFor: req.user._id } }
    );

    return res.status(200).json({
      success: true,
      message: "Message deleted for you successfully.",
      messageId: id,
    });
  } catch (error) {
    console.error("[Messages] deleteMessageForMe:", error);

    return res.status(500).json({
      success: false,
      message: "Server error deleting message for you.",
    });
  }
};

// =====================================================
// DELETE MESSAGE FOR EVERYONE
// =====================================================

const deleteMessageForEveryone = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid message ID.",
      });
    }

    const msg = await Message.findById(id);

    if (!msg) {
      return res.status(404).json({
        success: false,
        message: "Message not found.",
      });
    }

    const role = String(req.user?.role || "").toLowerCase();
    const isSender = String(msg.sender) === String(req.user._id);

    if (!isSender && role !== "admin" && role !== "manager") {
      return res.status(403).json({
        success: false,
        message:
          "Only the sender or an admin/manager can delete this message for everyone.",
      });
    }

    msg.isDeletedForEveryone = true;
    msg.deletedForEveryoneAt = new Date();
    msg.deletedBy = req.user._id;
    msg.body = "This message was deleted";
    msg.message = "This message was deleted";
    msg.attachments = [];

    await msg.save();

    Conversation.updateOne(
      {
        _id: msg.conversation,
        lastMessageAt: msg.createdAt,
      },
      { $set: { lastMessage: "This message was deleted" } }
    )
      .exec()
      .catch((error) => {
        console.error(
          "[Messages] Deleted-message preview update failed:",
          error.message
        );
      });

    const populated = await Message.findById(msg._id)
      .populate("sender", "name email role avatar")
      .populate("recipient", "name email role avatar")
      .populate("deletedBy", "name email role")
      .lean();

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
      message: "Message deleted for everyone successfully.",
      data: formatted,
    });
  } catch (error) {
    console.error("[Messages] deleteMessageForEveryone:", error);

    return res.status(500).json({
      success: false,
      message: "Server error deleting message for everyone.",
    });
  }
};

// =====================================================
// GENERIC DELETE ROUTE
// =====================================================

const deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid message ID.",
      });
    }

    const deleteType = String(
      req.query.type ||
        req.body?.type ||
        req.body?.deleteType ||
        ""
    ).toLowerCase();

    if (deleteType === "me" || deleteType === "for_me") {
      return deleteMessageForMe(req, res);
    }

    if (
      deleteType === "everyone" ||
      deleteType === "for_everyone"
    ) {
      return deleteMessageForEveryone(req, res);
    }

    const msg = await Message.findById(id).select("sender").lean();

    if (!msg) {
      return res.status(404).json({
        success: false,
        message: "Message not found.",
      });
    }

    const role = String(req.user?.role || "").toLowerCase();
    const isSender = String(msg.sender) === String(req.user._id);

    if (isSender || role === "admin" || role === "manager") {
      return deleteMessageForEveryone(req, res);
    }

    return deleteMessageForMe(req, res);
  } catch (error) {
    console.error("[Messages] deleteMessage:", error);

    return res.status(500).json({
      success: false,
      message: "Server error deleting message.",
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
};