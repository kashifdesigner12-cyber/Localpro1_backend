
"use strict";

const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const { createNotification } = require("./notificationController");

const isValidObjectId = (id) =>
  Boolean(id) && mongoose.Types.ObjectId.isValid(id);

const toId = (value) =>
  value && typeof value === "object" && value._id
    ? String(value._id)
    : value
      ? String(value)
      : null;

const getRole = (user) =>
  String(user?.role || "").trim().toLowerCase();

const safeUserRef = (user) => {
  if (!user) return null;

  if (typeof user === "object" && user._id) {
    let avatar = user.avatar || "";

    if (
      typeof avatar === "string" &&
      avatar.startsWith("data:image") &&
      avatar.length > 1000
    ) {
      avatar = "";
    }

    return {
      id: user._id,
      _id: user._id,
      name: user.name || "",
      email: user.email || "",
      phone: user.phone || "",
      role: user.role || "",
      status: user.status || "",
      avatar,
    };
  }

  return user;
};

const safeConversation = (conversation, unreadCount = 0) => {
  if (!conversation) return null;

  return {
    id: conversation._id,
    _id: conversation._id,
    isGroup: Boolean(conversation.isGroup),
    groupName: conversation.groupName || "",
    groupAdmin: safeUserRef(conversation.groupAdmin),
    participants: Array.isArray(conversation.participants)
      ? conversation.participants.map(safeUserRef)
      : [],
    lastMessage: conversation.lastMessage || "",
    lastMessageAt:
      conversation.lastMessageAt || conversation.updatedAt || null,
    lastSender: safeUserRef(conversation.lastSender),
    unreadCount,
    status: conversation.status || "open",
    isArchived: conversation.status === "archived",
    channel: conversation.channel || "chat",
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
};

const safeMessage = (message, currentUserId = null) => {
  if (!message) return null;

  const deletedFor = Array.isArray(message.deletedFor)
    ? message.deletedFor.map(String)
    : [];

  const deletedForMe =
    currentUserId != null &&
    deletedFor.includes(String(currentUserId));

  const deletedForEveryone = Boolean(message.isDeletedForEveryone);
  const body = deletedForEveryone
    ? "This message was deleted"
    : message.body || message.message || "";

  return {
    id: message._id,
    _id: message._id,
    conversationId: message.conversation,
    sender: safeUserRef(message.sender),
    recipient: safeUserRef(message.recipient),
    body,
    message: body,
    messageType: deletedForEveryone
      ? "text"
      : message.messageType || "text",
    attachments: deletedForEveryone
      ? []
      : Array.isArray(message.attachments)
        ? message.attachments
        : [],
    isRead: Boolean(message.isRead),
    readAt: message.readAt || null,
    isDeletedForEveryone: deletedForEveryone,
    isDeletedForMe: deletedForMe,
    deletedForEveryoneAt: message.deletedForEveryoneAt || null,
    deletedBy: safeUserRef(message.deletedBy),
    channel: message.channel || "chat",
    direction: message.direction || "internal",
    metadata: message.metadata || {},
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
};

const isConversationParticipant = (conversation, userId) => {
  if (!conversation || !userId) return false;

  const currentId = String(userId);
  const participants = Array.isArray(conversation.participants)
    ? conversation.participants
    : [];

  return (
    participants.some((participant) => toId(participant) === currentId) ||
    toId(conversation.userId) === currentId ||
    toId(conversation.user) === currentId
  );
};

// Admin can view all conversations.
// Other users must belong to the conversation.
const canAccessConversation = (conversation, req) => {
  if (!req.user) return false;
  if (getRole(req.user) === "admin") return true;

  return isConversationParticipant(conversation, req.user._id);
};

const getUnreadCount = async (conversationId, userId) =>
  Message.countDocuments({
    conversation: conversationId,
    recipient: userId,
    isRead: false,
    deletedFor: { $ne: userId },
  });

const populateConversation = (id) =>
  Conversation.findById(id)
    .populate("participants", "name email phone role status avatar")
    .populate("lastSender", "name email phone role status avatar")
    .populate("groupAdmin", "name email phone role status avatar")
    .lean();

const populateMessage = (id) =>
  Message.findById(id)
    .populate("sender", "name email phone role status avatar")
    .populate("recipient", "name email phone role status avatar")
    .populate("deletedBy", "name email role")
    .lean();

const getAvailableContacts = async (req, search = "") => {
  if (!req.user) return [];

  const role = getRole(req.user);

  let roles;
  if (role === "admin") {
    roles = ["manager", "user", "admin", "support"];
  } else if (role === "manager") {
    roles = ["user", "manager", "admin", "support"];
  } else {
    roles = ["admin", "manager", "support"];
  }

  const filter = {
    _id: { $ne: req.user._id },
    role: { $in: roles },
    $or: [
      { status: { $exists: false } },
      { status: { $nin: ["Blocked", "blocked"] } },
    ],
  };

  if (search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$and = [
      {
        $or: [
          { name: { $regex: escaped, $options: "i" } },
          { email: { $regex: escaped, $options: "i" } },
          { phone: { $regex: escaped, $options: "i" } },
          { role: { $regex: escaped, $options: "i" } },
        ],
      },
    ];
  }

  const users = await User.find(filter)
    .select("_id name email phone role status avatar")
    .sort({ name: 1 })
    .lean();

  return users.map(safeUserRef);
};

const getConversations = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const search = String(req.query.search || "");
    const skip = (page - 1) * limit;
    const currentUserId = req.user._id;
    const role = getRole(req.user);

    const filter =
      role === "admin"
        ? {}
        : {
            $or: [
              { participants: currentUserId },
              { userId: currentUserId },
              { user: currentUserId },
            ],
          };

    const [conversations, total, contacts] = await Promise.all([
      Conversation.find(filter)
        .populate("participants", "name email phone role status avatar")
        .populate("lastSender", "name email phone role status avatar")
        .populate("groupAdmin", "name email phone role status avatar")
        .sort({ lastMessageAt: -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Conversation.countDocuments(filter),
      getAvailableContacts(req, search),
    ]);

    let filtered = conversations;

    // Regular users only see conversations with Admin, Manager, or Support.
    if (role !== "admin" && role !== "manager") {
      filtered = filtered.filter((conversation) => {
        const participants = Array.isArray(conversation.participants)
          ? conversation.participants
          : [];

        return participants.some((participant) => {
          const participantId = toId(participant);
          const participantRole = getRole(participant);

          return (
            participantId !== String(currentUserId) &&
            ["admin", "manager", "support"].includes(participantRole)
          );
        });
      });
    }

    if (search.trim()) {
      const term = search.trim().toLowerCase();

      filtered = filtered.filter((conversation) => {
        if (
          conversation.isGroup &&
          String(conversation.groupName || "").toLowerCase().includes(term)
        ) {
          return true;
        }

        return (conversation.participants || []).some((participant) =>
          ["name", "email", "phone", "role"].some((field) =>
            String(participant?.[field] || "").toLowerCase().includes(term)
          )
        );
      });
    }

    const ids = filtered.map((conversation) => conversation._id);
    const unreadMap = {};

    if (ids.length) {
      const unread = await Message.aggregate([
        {
          $match: {
            conversation: { $in: ids },
            recipient: currentUserId,
            isRead: false,
            deletedFor: { $ne: currentUserId },
          },
        },
        { $group: { _id: "$conversation", count: { $sum: 1 } } },
      ]);

      unread.forEach((item) => {
        unreadMap[String(item._id)] = item.count;
      });
    }

    const result = filtered.map((conversation) =>
      safeConversation(conversation, unreadMap[String(conversation._id)] || 0)
    );

    return res.status(200).json({
      success: true,
      conversations: result,
      data: result,
      contacts,
      users: contacts,
      availableUsers: contacts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 0,
      },
    });
  } catch (error) {
    console.error("getConversations error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error retrieving conversations.",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const getConversation = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID.",
      });
    }

    const conversation = await populateConversation(id);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found.",
      });
    }

    if (!canAccessConversation(conversation, req)) {
      return res.status(403).json({
        success: false,
        message: "Access denied.",
      });
    }

    const unreadCount = await getUnreadCount(id, req.user._id);
    const result = safeConversation(conversation, unreadCount);

    return res.status(200).json({
      success: true,
      conversation: result,
      data: result,
    });
  } catch (error) {
    console.error("getConversation error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error retrieving conversation.",
    });
  }
};

// Find a direct chat by its exact two participants.
// Existing groups are never reused as direct conversations.
const findOrCreateConversation = async (userId, contactId, channel = "chat") => {
  if (!isValidObjectId(userId) || !isValidObjectId(contactId)) {
    throw new Error("Invalid conversation participant ID.");
  }

  if (String(userId) === String(contactId)) {
    throw new Error("Cannot create a conversation with yourself.");
  }

  const filter = {
    isGroup: { $ne: true },
    participants: {
      $all: [
        new mongoose.Types.ObjectId(String(userId)),
        new mongoose.Types.ObjectId(String(contactId)),
      ],
      $size: 2,
    },
  };

  let conversation = await Conversation.findOne(filter);

  if (conversation) return conversation;

  // Recheck immediately before insert to reduce duplicate creation races.
  conversation = await Conversation.findOne(filter);
  if (conversation) return conversation;

  return Conversation.create({
    participants: [userId, contactId],
    isGroup: false,
    groupName: "",
    groupAdmin: null,
    channel,
    status: "open",
    unreadCount: 0,
    lastMessage: "",
    lastMessageAt: null,
    lastSender: null,
  });
};

const createConversation = async (req, res) => {
  try {
    const { recipientId, userId, participantId, participants, isGroup, groupName } =
      req.body;

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const role = getRole(req.user);
    const wantsGroup = isGroup === true || isGroup === "true";

    let targetIds = [];

    if (wantsGroup) {
      // Creating groups is restricted to Admin/Manager.
      if (!["admin", "manager"].includes(role)) {
        return res.status(403).json({
          success: false,
          message: "Only Admin or Manager can create groups.",
        });
      }

      if (!Array.isArray(participants)) {
        return res.status(400).json({
          success: false,
          message: "Group participants are required.",
        });
      }

      targetIds = participants.map(toId).filter(Boolean);
    } else {
      const targetId = recipientId || userId || participantId;

      if (!targetId) {
        return res.status(400).json({
          success: false,
          message: "Recipient is required.",
        });
      }

      targetIds = [String(targetId)];
    }

    if (!targetIds.length) {
      return res.status(400).json({
        success: false,
        message: "Recipient or participants are required.",
      });
    }

    for (const id of targetIds) {
      if (!isValidObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid participant ID.",
        });
      }
    }

    const participantIds = [
      ...new Set([String(req.user._id), ...targetIds.map(String)]),
    ];

    if (!wantsGroup && participantIds.length !== 2) {
      return res.status(400).json({
        success: false,
        message: "A direct conversation requires exactly two participants.",
      });
    }

    if (participantIds.length < 2) {
      return res.status(400).json({
        success: false,
        message: "A conversation requires at least two participants.",
      });
    }

    if (!wantsGroup && role !== "admin" && role !== "manager") {
      const target = await User.findById(participantIds.find(
        (id) => id !== String(req.user._id)
      )).select("_id role");

      if (!target) {
        return res.status(404).json({
          success: false,
          message: "Recipient user not found.",
        });
      }

      if (!["admin", "manager", "support"].includes(getRole(target))) {
        return res.status(403).json({
          success: false,
          message: "Regular users can only message Admin, Manager, or Support.",
        });
      }
    }

    let conversation;

    if (!wantsGroup) {
      conversation = await findOrCreateConversation(
        req.user._id,
        participantIds.find((id) => id !== String(req.user._id)),
        "chat"
      );
    } else {
      const users = await User.find({
        _id: { $in: participantIds },
      }).select("_id");

      if (users.length !== participantIds.length) {
        return res.status(400).json({
          success: false,
          message: "One or more group participants do not exist.",
        });
      }

      conversation = await Conversation.create({
        participants: participantIds,
        isGroup: true,
        groupName: String(groupName || "Team Group").trim(),
        groupAdmin: req.user._id,
        lastMessage: "",
        lastMessageAt: null,
        lastSender: null,
        unreadCount: 0,
        status: "open",
        channel: "chat",
      });
    }

    const [populated, unreadCount] = await Promise.all([
      populateConversation(conversation._id),
      getUnreadCount(conversation._id, req.user._id),
    ]);

    const formatted = safeConversation(populated, unreadCount);
    const io = req.app.get("io");

    if (io && wantsGroup) {
      participantIds.forEach((participantId) => {
        io.to(String(participantId)).emit("conversation_created", formatted);
      });
    }

    return res.status(wantsGroup ? 201 : 200).json({
      success: true,
      message: wantsGroup
        ? "Group created successfully."
        : "Conversation retrieved or created successfully.",
      conversation: formatted,
      data: formatted,
    });
  } catch (error) {
    console.error("createConversation error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error starting conversation.",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const getConversationMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 100));

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID.",
      });
    }

    const conversation = await Conversation.findById(id)
      .select("participants userId user")
      .lean();

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found.",
      });
    }

    if (!canAccessConversation(conversation, req)) {
      return res.status(403).json({
        success: false,
        message: "Access denied.",
      });
    }

    const filter = {
      conversation: id,
      deletedFor: { $ne: req.user._id },
    };
    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      Message.find(filter)
        .populate("sender", "name email phone role status avatar")
        .populate("recipient", "name email phone role status avatar")
        .populate("deletedBy", "name email role")
        .sort({ createdAt: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Message.countDocuments(filter),
    ]);

    const result = messages.map((message) => safeMessage(message, req.user._id));

    return res.status(200).json({
      success: true,
      messages: result,
      data: result,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 0,
      },
    });
  } catch (error) {
    console.error("getConversationMessages error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error retrieving messages.",
    });
  }
};

const emitUserOutsideConversation = (io, userId, conversationId, event, payload) => {
  if (!io || !userId) return;

  const userRoom = String(userId);
  const conversationRoom = String(conversationId || "");
  const sockets = io.sockets?.sockets;

  if (sockets && typeof sockets.forEach === "function") {
    sockets.forEach((socket) => {
      if (
        socket.rooms?.has(userRoom) &&
        (!conversationRoom || !socket.rooms.has(conversationRoom))
      ) {
        socket.emit(event, payload);
      }
    });
    return;
  }

  io.to(userRoom).emit(event, payload);
};

const sendConversationMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      body,
      message,
      content,
      messageType,
      attachments,
      channel,
      direction,
      metadata,
    } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID.",
      });
    }

    const conversation = await Conversation.findById(id);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found.",
      });
    }

    if (!canAccessConversation(conversation, req)) {
      return res.status(403).json({
        success: false,
        message: "Access denied.",
      });
    }

    let parsedAttachments = Array.isArray(attachments) ? [...attachments] : [];

    if (typeof attachments === "string") {
      try {
        const parsed = JSON.parse(attachments);
        if (Array.isArray(parsed)) parsedAttachments = parsed;
      } catch {
        // Ignore malformed attachment JSON; uploaded files are still handled below.
      }
    }

    const files = Array.isArray(req.files)
      ? req.files
      : req.files && typeof req.files === "object"
        ? Object.values(req.files).flat()
        : [];

    if (req.file) files.push(req.file);

    for (const file of files) {
      parsedAttachments.push({
        url: `/uploads/${file.filename}`,
        filename: file.filename,
        originalName: file.originalname,
        fileType: String(file.mimetype || "").split("/")[0] || "file",
        mimeType: file.mimetype,
        size: file.size,
      });
    }

    const cleanText = String(body ?? message ?? content ?? "").trim();

    if (!cleanText && !parsedAttachments.length) {
      return res.status(400).json({
        success: false,
        message: "Message content or attachment is required.",
      });
    }

    let recipientId = null;

    if (!conversation.isGroup) {
      const otherParticipant = (conversation.participants || []).find(
        (participant) => String(participant) !== String(req.user._id)
      );

      if (otherParticipant) {
        recipientId = otherParticipant;
      } else if (
        conversation.userId &&
        String(conversation.userId) !== String(req.user._id)
      ) {
        recipientId = conversation.userId;
      }

      if (!recipientId) {
        return res.status(400).json({
          success: false,
          message: "Could not resolve the other participant.",
        });
      }
    }

    let calculatedType = messageType || "text";

    if (parsedAttachments.length && (!messageType || messageType === "text")) {
      const mime = String(
        parsedAttachments[0]?.mimeType ||
          parsedAttachments[0]?.fileType ||
          ""
      ).toLowerCase();

      calculatedType = mime.startsWith("image/")
        ? "image"
        : mime.startsWith("video/")
          ? "video"
          : mime.startsWith("audio/")
            ? "audio"
            : "file";
    }

    const createdMessage = await Message.create({
      conversation: conversation._id,
      sender: req.user._id,
      recipient: recipientId,
      body: cleanText,
      message: cleanText,
      messageType: calculatedType,
      attachments: parsedAttachments,
      isRead: false,
      readAt: null,
      channel: channel || "chat",
      direction: direction || "internal",
      metadata: metadata || {},
    });

    const preview = cleanText ||
      (calculatedType === "image"
        ? "📷 Photo"
        : calculatedType === "video"
          ? "🎬 Video"
          : calculatedType === "audio"
            ? "🎤 Audio"
            : "📎 Attachment");

    conversation.lastMessage = preview;
    conversation.lastMessageType = calculatedType;
    conversation.lastMessageAt = createdMessage.createdAt || new Date();
    conversation.lastSender = req.user._id;
    await conversation.save();

    const populated = await populateMessage(createdMessage._id);
    const formatted = safeMessage(populated, req.user._id);
    const io = req.app.get("io");
    const conversationId = String(conversation._id);

    if (io) {
      // Send the actual message on ONE canonical event only.
      io.to(conversationId).emit("new_message", formatted);

      // Deliver to recipient devices that have not joined this conversation.
      if (recipientId) {
        emitUserOutsideConversation(
          io,
          recipientId,
          conversationId,
          "new_message",
          formatted
        );
      }

      // Notifications are metadata, not message objects.
      const recipients = conversation.isGroup
        ? (conversation.participants || [])
            .filter((participant) => String(participant) !== String(req.user._id))
            .map(String)
        : recipientId
          ? [String(recipientId)]
          : [];

      recipients.forEach((targetId) => {
        io.to(targetId).emit("notification", {
          type: "message",
          title: `New message from ${req.user.name || "User"}`,
          message: preview,
          conversationId,
          messageId: String(createdMessage._id),
          senderId: String(req.user._id),
          senderName: req.user.name || "",
          createdAt: createdMessage.createdAt,
        });
      });
    }

    const recipientsForNotifications = conversation.isGroup
      ? (conversation.participants || [])
          .filter((participant) => String(participant) !== String(req.user._id))
          .map(String)
      : recipientId
        ? [String(recipientId)]
        : [];

    for (const targetId of recipientsForNotifications) {
      createNotification({
        userId: targetId,
        type: "message",
        title: conversation.isGroup
          ? `New message in ${conversation.groupName || "Group"}`
          : "New Message",
        message: `${req.user.name || "User"} sent you a message.`,
        relatedId: conversation._id,
        relatedType: "Message",
        actionUrl:
          getRole(req.user) === "admin"
            ? "/admin/conversations"
            : "/user/conversations",
        metadata: {
          conversationId: conversation._id,
          messageId: createdMessage._id,
          senderId: req.user._id,
          senderName: req.user.name || "",
        },
      }).catch((error) => {
        console.error("Message notification error:", error.message);
      });
    }

    return res.status(201).json({
      success: true,
      message: "Message sent successfully.",
      data: formatted,
      messageData: formatted,
    });
  } catch (error) {
    console.error("sendConversationMessage error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error sending message.",
    });
  }
};

const updateConversation = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID.",
      });
    }

    const conversation = await Conversation.findById(id);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found.",
      });
    }

    if (!canAccessConversation(conversation, req)) {
      return res.status(403).json({
        success: false,
        message: "Access denied.",
      });
    }

    const { status, isArchived, groupName } = req.body;

    if (status !== undefined) {
      if (!["open", "closed", "archived"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid conversation status.",
        });
      }
      conversation.status = status;
    }

    if (isArchived !== undefined) {
      conversation.status = isArchived ? "archived" : "open";
    }

    if (groupName !== undefined && conversation.isGroup) {
      conversation.groupName = String(groupName).trim();
    }

    await conversation.save();

    const [populated, unreadCount] = await Promise.all([
      populateConversation(conversation._id),
      getUnreadCount(conversation._id, req.user._id),
    ]);

    const formatted = safeConversation(populated, unreadCount);
    const io = req.app.get("io");

    if (io) {
      io.to(String(conversation._id)).emit("conversation_updated", formatted);
    }

    return res.status(200).json({
      success: true,
      message: "Conversation updated successfully.",
      conversation: formatted,
      data: formatted,
    });
  } catch (error) {
    console.error("updateConversation error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error updating conversation.",
    });
  }
};

const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID.",
      });
    }

    const conversation = await Conversation.findById(id);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found.",
      });
    }

    if (!canAccessConversation(conversation, req)) {
      return res.status(403).json({
        success: false,
        message: "Access denied.",
      });
    }

    const filter = {
      conversation: conversation._id,
      recipient: req.user._id,
      isRead: false,
    };

    const now = new Date();
    const result = await Message.updateMany(filter, {
      $set: { isRead: true, readAt: now },
    });

    const unreadCount = await getUnreadCount(conversation._id, req.user._id);
    conversation.unreadCount = unreadCount;
    await conversation.save();

    const payload = {
      conversationId: String(conversation._id),
      readerId: String(req.user._id),
      readAt: now,
      modifiedCount: result.modifiedCount ?? result.nModified ?? 0,
    };

    const io = req.app.get("io");
    if (io) {
      io.to(String(conversation._id)).emit("messages_read", payload);
    }

    return res.status(200).json({
      success: true,
      message: "Conversation marked as read.",
      modifiedCount: payload.modifiedCount,
      unreadCount,
    });
  } catch (error) {
    console.error("markAsRead error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error marking conversation as read.",
    });
  }
};

const markMessageAsRead = async (req, res) => {
  try {
    const messageId = req.params.messageId || req.params.id;

    if (!isValidObjectId(messageId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid message ID.",
      });
    }

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found.",
      });
    }

    // Only the recipient may mark a message as read.
    if (String(message.recipient) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "You can only mark messages sent to you as read.",
      });
    }

    if (
      Array.isArray(message.deletedFor) &&
      message.deletedFor.some((id) => String(id) === String(req.user._id))
    ) {
      return res.status(404).json({
        success: false,
        message: "Message not found.",
      });
    }

    if (!message.isRead) {
      message.isRead = true;
      message.readAt = new Date();
      await message.save();
    }

    const populated = await populateMessage(message._id);
    const formatted = safeMessage(populated, req.user._id);
    const io = req.app.get("io");

    if (io) {
      io.to(String(message.conversation)).emit("message_read", formatted);
    }

    return res.status(200).json({
      success: true,
      message: "Message marked as read successfully.",
      data: formatted,
      messageData: formatted,
      modifiedCount: 1,
    });
  } catch (error) {
    console.error("markMessageAsRead error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error marking message as read.",
    });
  }
};

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
      count: unreadCount,
      data: { unreadCount },
    });
  } catch (error) {
    console.error("getUnreadMessageCount error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error retrieving unread message count.",
    });
  }
};

const deleteConversation = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID.",
      });
    }

    const conversation = await Conversation.findById(id)
      .select("participants userId user")
      .lean();

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found.",
      });
    }

    if (getRole(req.user) !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only Admin can permanently delete a conversation.",
      });
    }

    await Promise.all([
      Message.deleteMany({ conversation: id }),
      Conversation.findByIdAndDelete(id),
    ]);

    const io = req.app.get("io");
    if (io) {
      io.to(String(id)).emit("conversation_deleted", {
        conversationId: String(id),
      });
    }

    return res.status(200).json({
      success: true,
      message: "Conversation deleted successfully.",
    });
  } catch (error) {
    console.error("deleteConversation error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error deleting conversation.",
    });
  }
};

const getThread = async (req, res) => {
  try {
    const { contactId } = req.params;

    if (!isValidObjectId(contactId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid contact ID.",
      });
    }

    const messages = await Message.find({
      $or: [
        { sender: req.user._id, recipient: contactId },
        { sender: contactId, recipient: req.user._id },
      ],
      deletedFor: { $ne: req.user._id },
    })
      .populate("sender", "name email phone role status avatar")
      .populate("recipient", "name email phone role status avatar")
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        messages: messages.map((message) => safeMessage(message, req.user._id)),
        calls: [],
        emails: [],
      },
    });
  } catch (error) {
    console.error("getThread error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

module.exports = {
  getConversations,
  getConversation,
  getConversationById: getConversation,
  createConversation,
  updateConversation,
  getConversationMessages,
  sendConversationMessage,
  markAsRead,
  markMessageAsRead,
  markSingleMessageAsRead: markMessageAsRead,
  getUnreadMessageCount,
  deleteConversation,
  getThread,
  findOrCreateConversation,
};
