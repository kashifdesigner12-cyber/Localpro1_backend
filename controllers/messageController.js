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
    conversationId: toId(msg.conversation),
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
    reactions: Array.isArray(msg.reactions) && msg.reactions.length
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
    replyTo: msg.replyTo
      ? typeof msg.replyTo === "object" && msg.replyTo._id
        ? {
            id: String(msg.replyTo._id),
            _id: String(msg.replyTo._id),
            body: msg.replyTo.body || msg.replyTo.message || "",
            message: msg.replyTo.body || msg.replyTo.message || "",
            sender: safeUserRef(msg.replyTo.sender),
            createdAt: msg.replyTo.createdAt,
          }
        : msg.replyTo
      : null,
    clientMessageId: msg.clientMessageId || msg.metadata?.clientMessageId || null,
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

  if (mime.startsWith("image/") || mime === "image") return "image";
  if (mime.startsWith("video/") || mime === "video") return "video";
  if (mime.startsWith("audio/") || mime === "audio") return "audio";

  return defaultType === "document" ? "document" : "file";
};

const getIo = (req) => req.app.get("io");

const emitToConversation = (io, conversationId, eventName, payload) => {
  if (!io || !conversationId) return;

  io.to(String(conversationId)).emit(eventName, payload);
};

/**
 * Deliver to the user's connected sockets that have not joined
 * this conversation room.
 *
 * Sockets in the conversation room receive the room event, so they
 * should not receive the same event a second time.
 */
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

  // Match the existing administrative access policy.
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
    .populate("sender", "name email role avatar")
    .populate("recipient", "name email role avatar")
    .populate("deletedBy", "name email role")
    .populate({
      path: "replyTo",
      select: "_id body message sender createdAt",
      populate: { path: "sender", select: "name email role avatar" },
    });

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
    const rawConversationId =
      req.params.conversationId ||
      req.params.id ||
      req.query.conversationId ||
      req.query.conversation;

    const conversationId = String(rawConversationId || "").trim();

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

    // Read pagination from the request query. These values must be defined
    // before they are used below; otherwise this endpoint throws a ReferenceError.
    const page = req.query.page;
    const limit = req.query.limit;

    const parsedPage = Number.parseInt(page, 10);
    const parsedLimit = Number.parseInt(limit, 10);
    const pageNum = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const limitNum = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(100, parsedLimit)
      : 50;
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
        .populate({
          path: "replyTo",
          select: "_id body message sender createdAt",
          populate: { path: "sender", select: "name email role avatar" },
        })
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
      replyToId,
      replyTo,
      clientMessageId,
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

    const seenAttachments = new Set();

    attachments = attachments.filter((attachment) => {
      const key = attachment?.url || attachment?.filename;

      if (!key) return true;
      if (seenAttachments.has(key)) return false;

      seenAttachments.add(key);
      return true;
    });

    if (attachments.length > 20) {
      return res.status(400).json({
        success: false,
        message: "Maximum 20 attachments are allowed per message.",
      });
    }

    const text = String(body ?? message ?? content ?? "").trim();

    if (text.length > 20000) {
      return res.status(400).json({
        success: false,
        message: "Message exceeds the maximum allowed length.",
      });
    }

    if (!text && attachments.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Message text or an attachment is required.",
      });
    }

    let conversation;
    let recipientUser = null;

    // -------------------------------------------------
    // Existing conversation
    // -------------------------------------------------

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
      // -------------------------------------------------
      // Find or create a direct conversation
      // -------------------------------------------------

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
        .select("_id name email role avatar")
        .lean();

      if (!recipientUser) {
        return res.status(404).json({
          success: false,
          message: "Recipient user not found.",
        });
      }

      const targetRole = getUserRole(recipientUser);

      if (
        role !== "admin" &&
        role !== "manager" &&
        !["admin", "manager", "support"].includes(targetRole)
      ) {
        return res.status(403).json({
          success: false,
          message: "Regular users can only message Admin or Support.",
        });
      }

      const currentObjectId = new mongoose.Types.ObjectId(currentUserId);
      const targetObjectId = new mongoose.Types.ObjectId(targetId);

      // Never reuse a group as a direct conversation.
      conversation = await Conversation.findOne({
        isGroup: { $ne: true },
        participants: {
          $all: [currentObjectId, targetObjectId],
          $size: 2,
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

    // -------------------------------------------------
    // Resolve recipients
    // -------------------------------------------------

    const participantIds = getParticipantIds(conversation);
    let resolvedRecipientId = null;

    if (participantIds.length > 0) {
      const isParticipant = participantIds.includes(currentUserId);

      if (!isParticipant && role !== "admin" && role !== "manager") {
        return res.status(403).json({
          success: false,
          message: "You are not a participant in this conversation.",
        });
      }

      if (!conversation.isGroup) {
        resolvedRecipientId =
          participantIds.find((id) => id !== currentUserId) || null;
      }
    } else if (conversation.userId) {
      const legacyId = toId(conversation.userId);

      if (legacyId && legacyId !== currentUserId) {
        resolvedRecipientId = legacyId;
      }
    }

    // For direct chats, do not let a request override the conversation's
    // actual recipient.
    if (!conversation.isGroup && (recipientId || to)) {
      const requestedRecipientId = String(recipientId || to);

      if (
        resolvedRecipientId &&
        requestedRecipientId !== resolvedRecipientId
      ) {
        return res.status(400).json({
          success: false,
          message: "The recipient does not match this conversation.",
        });
      }
    }

    if (
      !conversation.isGroup &&
      (!resolvedRecipientId ||
        !isValidObjectId(resolvedRecipientId) ||
        resolvedRecipientId === currentUserId)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Could not resolve the other participant in this conversation.",
      });
    }

    if (resolvedRecipientId) {
      recipientUser =
        recipientUser ||
        (await User.findById(resolvedRecipientId)
          .select("_id name email role avatar")
          .lean());

      if (!recipientUser) {
        return res.status(404).json({
          success: false,
          message: "Conversation recipient was not found.",
        });
      }
    }

    // Group conversations notify all other participants.
    const recipientIds = conversation.isGroup
      ? participantIds.filter((id) => id !== currentUserId)
      : resolvedRecipientId
        ? [resolvedRecipientId]
        : [];

    const allowedMessageTypes = new Set([
      "text",
      "image",
      "file",
      "document",
      "video",
      "audio",
      "system",
    ]);

    if (messageType && !allowedMessageTypes.has(String(messageType))) {
      return res.status(400).json({
        success: false,
        message: "Invalid message type.",
      });
    }

    const calculatedMessageType =
      attachments.length > 0
        ? determineMessageType(
            attachments,
            messageType && messageType !== "text"
              ? messageType
              : "file"
          )
        : messageType || "text";

    // -------------------------------------------------
    // Persist message
    // -------------------------------------------------

    // Validate replies instead of silently dropping an invalid reply ID.
    // A reply must point to a visible message in this same conversation.
    const rawReplyToId = replyToId || replyTo || null;
    let resolvedReplyToId = null;

    if (rawReplyToId) {
      if (!isValidObjectId(rawReplyToId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid reply message ID.",
        });
      }

      const replyTarget = await Message.findById(rawReplyToId)
        .select("_id conversation isDeletedForEveryone deletedFor")
        .lean();

      if (
        !replyTarget ||
        String(replyTarget.conversation) !== String(conversation._id) ||
        replyTarget.isDeletedForEveryone ||
        getDeletedForUser(replyTarget, currentUserId)
      ) {
        return res.status(400).json({
          success: false,
          message: "The reply target is unavailable in this conversation.",
        });
      }

      resolvedReplyToId = new mongoose.Types.ObjectId(String(rawReplyToId));
    }

    const createdMessage = await Message.create({
      conversation: conversation._id,
      sender: req.user._id,
      recipient: resolvedRecipientId,
      replyTo: resolvedReplyToId,
      body: text,
      message: text,
      messageType: calculatedMessageType,
      attachments,
      isRead: false,
      readAt: null,
      metadata: clientMessageId ? { clientMessageId } : {},
    });

    const conversationIdString = String(conversation._id);
    const now = createdMessage.createdAt || new Date();
    const previewText = getPreviewText(text, calculatedMessageType);

    // Update the preview before notifying connected clients.
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

    const populatedCreated = await populateMessage(
      Message.findById(createdMessage._id)
    ).lean();

    // Keep the send response valid even if population unexpectedly returns null.
    const formattedMessage = {
      ...safeMessage(
        populatedCreated || {
          ...createdMessage.toObject(),
          sender: req.user,
          recipient: recipientUser,
        },
        currentUserId
      ),
      clientMessageId: clientMessageId || null,
    };

    // -------------------------------------------------
    // Real-time delivery
    // -------------------------------------------------

    const senderPayload = formattedMessage?.sender || {
      _id: req.user._id,
      name: req.user.name || "User",
      email: req.user.email || "",
      role: req.user.role || "",
      avatar: req.user.avatar || null,
    };

    const io = getIo(req);

    if (io) {
      /*
       * Canonical message events:
       * - message_sent: sender's acknowledgement / multi-tab synchronization
       * - receive_message: conversation room and recipient delivery
       */

      io.to(currentUserId).emit("message_sent", formattedMessage);

      emitToConversation(
        io,
        conversationIdString,
        "receive_message",
        formattedMessage
      );

      // Deliver to recipients whose sockets have not joined this room.
      for (const targetUserId of recipientIds) {
        emitToUserOutsideConversation(
          io,
          targetUserId,
          conversationIdString,
          "receive_message",
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

    // -------------------------------------------------
    // Persistent notifications and email
    // -------------------------------------------------

    const senderName = senderPayload.name || "User";
    const senderIdForNotification = currentUserId;
    const conversationIdForNotification = String(conversation._id);
    const messageIdForNotification = String(createdMessage._id);
    const roleForNotification = role;

    // Snapshot values before starting asynchronous work.
    const recipientsForNotification = recipientIds.map(String);

    setImmediate(() => {
      void (async () => {
        for (const targetUserId of recipientsForNotification) {
          try {
            await createNotification({
              userId: targetUserId,
              type: "message",
              title: "New Message",
              message: `${senderName} sent you a message.`,
              relatedId: conversation._id,
              relatedType: "Message",
              actionUrl:
                roleForNotification === "admin" ||
                roleForNotification === "manager"
                  ? "/user/conversations"
                  : "/admin/conversations",
              metadata: {
                conversationId: conversationIdForNotification,
                messageId: messageIdForNotification,
                senderId: senderIdForNotification,
                senderName,
              },
            });
          } catch (error) {
            console.error(
              `[Messages] Notification creation failed for ${targetUserId}:`,
              error.message
            );
          }

          try {
            let targetUser = null;

            if (
              recipientUser &&
              String(recipientUser._id) === targetUserId
            ) {
              targetUser = recipientUser;
            } else {
              targetUser = await User.findById(targetUserId)
                .select("name email")
                .lean();
            }

            if (targetUser?.email) {
              await sendMessageNotificationEmail(
                targetUser.email,
                targetUser.name || "User",
                senderName,
                previewText
              );
            }
          } catch (error) {
            console.error(
              `[Messages] Notification email failed for ${targetUserId}:`,
              error.message
            );
          }
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

    if (getDeletedForUser(msg, req.user._id)) {
      return res.status(404).json({
        success: false,
        message: "Message not found.",
      });
    }

    const role = getUserRole(req.user);

    if (
      String(msg.sender) !== String(req.user._id) &&
      role !== "admin"
    ) {
      return res.status(403).json({
        success: false,
        message: "You can only edit your own messages.",
      });
    }

    const conversation = await Conversation.findById(msg.conversation)
      .select("participants userId")
      .lean();

    if (
      !conversation ||
      !canAccessConversation(conversation, req.user._id, role)
    ) {
      return res.status(403).json({
        success: false,
        message: "You cannot access this conversation.",
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

    const now = new Date();

    const filter = {
      conversation: conversationId,
      recipient: req.user._id,
      isRead: false,
      deletedFor: { $ne: req.user._id },
    };

    const [sendersToNotify, result] = await Promise.all([
      Message.distinct("sender", filter),
      Message.updateMany(filter, {
        $set: {
          isRead: true,
          readAt: now,
        },
      }),
    ]);

    const io = getIo(req);

    const payload = {
      conversationId: String(conversationId),
      readerId: String(req.user._id),
      readAt: now,
      modifiedCount: result.modifiedCount ?? result.nModified ?? 0,
    };

    if (io) {
      emitToConversation(
        io,
        conversationId,
        "messages_read",
        payload
      );

      for (const senderId of sendersToNotify) {
        if (String(senderId) !== String(req.user._id)) {
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

    if (getDeletedForUser(msg, req.user._id)) {
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
        message: "You cannot access this conversation.",
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
    const conversationId = String(msg.conversation);

    const payload = {
      conversationId,
      messageId: String(msg._id),
      readerId: String(req.user._id),
      readAt: msg.readAt || new Date(),
    };

    if (io) {
      emitToConversation(
        io,
        conversationId,
        "message_read",
        formatted
      );

      if (msg.sender) {
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

    const msg = await Message.findById(id)
      .select("_id conversation sender recipient deletedFor")
      .lean();

    if (!msg) {
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
        message: "You cannot access this message.",
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

    const role = getUserRole(req.user);
    const isSender = String(msg.sender) === String(req.user._id);

    if (!isSender && role !== "admin" && role !== "manager") {
      return res.status(403).json({
        success: false,
        message:
          "Only the sender or an admin/manager can delete this message for everyone.",
      });
    }

    const conversation = await Conversation.findById(msg.conversation)
      .select("participants userId")
      .lean();

    if (
      !conversation ||
      !canAccessConversation(conversation, req.user._id, role)
    ) {
      return res.status(403).json({
        success: false,
        message: "You cannot access this conversation.",
      });
    }

    msg.isDeletedForEveryone = true;
    msg.deletedForEveryoneAt = new Date();
    msg.deletedBy = req.user._id;
    msg.body = "This message was deleted";
    msg.message = "This message was deleted";
    msg.attachments = [];

    await msg.save();

    await Conversation.updateOne(
      {
        _id: msg.conversation,
        lastMessageAt: msg.createdAt,
      },
      {
        $set: {
          lastMessage: "This message was deleted",
          lastMessageType: "text",
        },
      }
    );

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

      const participantIds = getParticipantIds(conversation);

      for (const participantId of participantIds) {
        emitToUserOutsideConversation(
          io,
          participantId,
          msg.conversation,
          "message_deleted",
          formatted
        );
      }
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

    const msg = await Message.findById(id)
      .select("sender")
      .lean();

    if (!msg) {
      return res.status(404).json({
        success: false,
        message: "Message not found.",
      });
    }

    const role = getUserRole(req.user);
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
// MESSAGE REACTIONS
// =====================================================

const reactToMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const emoji = String(req.body?.emoji || "").trim();

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid message ID.",
      });
    }

    // Limit reaction payloads to a single emoji (including joined emoji).
    if (!emoji || emoji.length > 32) {
      return res.status(400).json({
        success: false,
        message: "A valid emoji reaction is required.",
      });
    }

    const msg = await Message.findById(id);

    if (!msg || msg.isDeletedForEveryone || getDeletedForUser(msg, req.user._id)) {
      return res.status(404).json({
        success: false,
        message: "Message not found.",
      });
    }

    const role = getUserRole(req.user);
    const conversation = await Conversation.findById(msg.conversation)
      .select("participants userId")
      .lean();

    if (
      !conversation ||
      !canAccessConversation(conversation, req.user._id, role)
    ) {
      return res.status(403).json({
        success: false,
        message: "You cannot access this conversation.",
      });
    }

    const userId = String(req.user._id);
    // Persist reactions in the schema's canonical Message.reactions array.
    // The old implementation wrote only metadata.reactions, which could be
    // hidden by the schema's always-present (but empty) reactions array.
    const reactions = Array.isArray(msg.reactions)
      ? msg.reactions.map((item) => ({
          userId: String(item.userId),
          emoji: item.emoji,
          createdAt: item.createdAt,
        }))
      : [];

    const existingIndex = reactions.findIndex(
      (reaction) => String(reaction.userId) === userId
    );

    // Same emoji toggles off; a different emoji replaces the user's reaction.
    if (existingIndex >= 0 && reactions[existingIndex].emoji === emoji) {
      reactions.splice(existingIndex, 1);
    } else {
      const reaction = { userId, emoji, createdAt: new Date() };
      if (existingIndex >= 0) reactions[existingIndex] = reaction;
      else reactions.push(reaction);
    }

    msg.reactions = reactions;
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
      userId,
    };

    const io = getIo(req);
    if (io) {
      emitToConversation(
        io,
        msg.conversation,
        "message_reaction_updated",
        payload
      );

      const participantIds = getParticipantIds(conversation);
      for (const participantId of participantIds) {
        emitToUserOutsideConversation(
          io,
          participantId,
          msg.conversation,
          "message_reaction_updated",
          payload
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: "Reaction updated successfully.",
      data: formatted,
      reactions: formatted.reactions,
    });
  } catch (error) {
    console.error("[Messages] reactToMessage:", error);
    return res.status(500).json({
      success: false,
      message: "Server error updating message reaction.",
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