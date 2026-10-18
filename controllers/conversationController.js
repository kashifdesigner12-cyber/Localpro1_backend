"use strict";

const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");

const isValidObjectId = (id) =>
  Boolean(id) && mongoose.Types.ObjectId.isValid(String(id));

const toId = (value) => {
  if (value && typeof value === "object" && value._id) return String(value._id);
  return value ? String(value) : null;
};

const getRole = (user) => String(user?.role || "").trim().toLowerCase();

const safeUserRef = (user) => {
  if (!user) return null;
  if (typeof user === "object" && user._id) {
    let avatar = user.avatar || user.profileImage || user.image || "";
    if (typeof avatar === "string" && avatar.startsWith("data:image") && avatar.length > 1000) {
      avatar = "";
    }
    return {
      id: String(user._id),
      _id: String(user._id),
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
    id: String(conversation._id),
    _id: String(conversation._id),
    isGroup: Boolean(conversation.isGroup),
    groupName: conversation.groupName || "",
    groupAvatar: conversation.groupAvatar || "",
    groupAdmin: safeUserRef(conversation.groupAdmin),
    participants: Array.isArray(conversation.participants)
      ? conversation.participants.map(safeUserRef)
      : [],
    lastMessage: conversation.lastMessage || "",
    lastMessageAt: conversation.lastMessageAt || conversation.updatedAt || null,
    lastMessageType: conversation.lastMessageType || "text",
    lastSender: safeUserRef(conversation.lastSender),
    unreadCount: Number(unreadCount) || 0,
    status: conversation.status || "open",
    isArchived: conversation.status === "archived",
    channel: conversation.channel || "chat",
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
};

const safeMessage = (message, currentUserId = null) => {
  if (!message) return null;
  const deletedFor = Array.isArray(message.deletedFor) ? message.deletedFor.map(String) : [];
  const deletedForMe = currentUserId != null && deletedFor.includes(String(currentUserId));
  const deletedForEveryone = Boolean(message.isDeletedForEveryone);
  const body = deletedForEveryone ? "This message was deleted" : message.body || message.message || "";
  return {
    id: String(message._id),
    _id: String(message._id),
    conversationId: toId(message.conversation),
    sender: safeUserRef(message.sender),
    recipient: safeUserRef(message.recipient),
    body,
    message: body,
    messageType: deletedForEveryone ? "text" : message.messageType || "text",
    attachments: deletedForEveryone ? [] : Array.isArray(message.attachments) ? message.attachments : [],
    isRead: Boolean(message.isRead),
    readAt: message.readAt || null,
    reactions: Array.isArray(message.reactions)
      ? message.reactions
      : Array.isArray(message.metadata?.reactions)
        ? message.metadata.reactions
        : [],
    isDeletedForEveryone: deletedForEveryone,
    isDeletedForMe: deletedForMe,
    deletedForEveryoneAt: message.deletedForEveryoneAt || null,
    deletedBy: safeUserRef(message.deletedBy),
    replyTo: message.replyTo
      ? typeof message.replyTo === "object" && message.replyTo._id
        ? {
            id: String(message.replyTo._id),
            _id: String(message.replyTo._id),
            body: message.replyTo.body || message.replyTo.message || "",
            message: message.replyTo.body || message.replyTo.message || "",
            sender: safeUserRef(message.replyTo.sender),
            createdAt: message.replyTo.createdAt,
          }
        : message.replyTo
      : null,
    clientMessageId: message.clientMessageId || message.metadata?.clientMessageId || null,
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
  const participants = Array.isArray(conversation.participants) ? conversation.participants : [];
  return (
    participants.some((participant) => toId(participant) === currentId) ||
    toId(conversation.userId) === currentId ||
    toId(conversation.user) === currentId
  );
};

/*
 * Admins can access all conversations. Other users must be participants.
 * Direct conversations are limited to Admin-user conversations; group
 * conversations are available to their actual participants.
 */
const canAccessConversation = async (conversation, req) => {
  if (!req.user || !conversation) return false;
  if (getRole(req.user) === "admin") return true;
  if (!isConversationParticipant(conversation, req.user._id)) return false;

  if (conversation.isGroup) return true;

  const participantIds = [
    ...new Set(
      (Array.isArray(conversation.participants) ? conversation.participants : [])
        .map(toId)
        .filter(Boolean)
    ),
  ];
  if (participantIds.length !== 2 || !participantIds.includes(String(req.user._id))) return false;

  const otherId = participantIds.find((participantId) => participantId !== String(req.user._id));
  if (!otherId) return false;
  const otherUser = await User.findById(otherId).select("role").lean();
  return getRole(otherUser) === "admin";
};

const getUnreadCount = async (conversationId, userId) =>
  Message.countDocuments({
    conversation: conversationId,
    recipient: userId,
    isRead: false,
    deletedFor: { $ne: userId },
    isDeletedForEveryone: { $ne: true },
  });

const populateConversation = (id) =>
  Conversation.findById(id)
    .populate("participants", "name email phone role status avatar profileImage image")
    .populate("lastSender", "name email phone role status avatar profileImage image")
    .populate("groupAdmin", "name email phone role status avatar profileImage image")
    .lean();

const populateMessage = (id) =>
  Message.findById(id)
    .populate("sender", "name email phone role status avatar profileImage image")
    .populate("recipient", "name email phone role status avatar profileImage image")
    .populate("deletedBy", "name email role")
    .populate({
      path: "replyTo",
      select: "_id body message sender createdAt",
      populate: { path: "sender", select: "name email role avatar" },
    })
    .lean();

const getAvailableContacts = async (req, search = "") => {
  if (!req.user) return [];
  const role = getRole(req.user);
  // Admin contact lists should include every active non-admin role, not just
  // manager/user/support. Non-admin users can still contact Admin only.
  const roleFilter = role === "admin"
    ? { $nin: ["admin", "Admin", "ADMIN"] }
    : { $in: ["admin", "Admin", "ADMIN"] };
  const filter = {
    _id: { $ne: req.user._id },
    role: roleFilter,
    isDeleted: { $ne: true },
    isActive: { $ne: false },
    $or: [
      { status: { $exists: false } },
      { status: { $nin: ["Blocked", "blocked", "Inactive", "inactive", "Pending", "pending"] } },
    ],
  };

  if (search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$and = [{
      $or: [
        { name: { $regex: escaped, $options: "i" } },
        { email: { $regex: escaped, $options: "i" } },
        { phone: { $regex: escaped, $options: "i" } },
      ],
    }];
  }

  const users = await User.find(filter)
    .select("_id name email phone role status avatar profileImage image")
    .sort({ name: 1 })
    .lean();
  return users.map(safeUserRef);
};

const getConversations = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Authentication required." });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const search = String(req.query.search || "");
    const skip = (page - 1) * limit;
    const isAdmin = getRole(req.user) === "admin";

    // Fetch every conversation the user belongs to, including group chats.
    // Legacy CRM conversations may use userId/user instead of participants,
    // so include those fields and enforce access again below.
    const filter = isAdmin
      ? {}
      : {
          $or: [
            { participants: req.user._id },
            { userId: req.user._id },
            { user: req.user._id },
          ],
        };

    const [conversations, contacts] = await Promise.all([
      Conversation.find(filter)
        .populate("participants", "name email phone role status avatar profileImage image")
        .populate("lastSender", "name email phone role status avatar profileImage image")
        .populate("groupAdmin", "name email phone role status avatar profileImage image")
        .sort({ lastMessageAt: -1, updatedAt: -1 })
        .lean(),
      getAvailableContacts(req, search),
    ]);

    let filtered = conversations;
    if (!isAdmin) {
      const results = await Promise.all(filtered.map(async (conversation) => ({
        conversation,
        allowed: await canAccessConversation(conversation, req),
      })));
      filtered = results.filter((item) => item.allowed).map((item) => item.conversation);
    }

    if (search.trim()) {
      const term = search.trim().toLowerCase();
      filtered = filtered.filter((conversation) =>
        (conversation.participants || []).some((participant) =>
          ["name", "email", "phone"].some((field) =>
            String(participant?.[field] || "").toLowerCase().includes(term)
          )
        )
      );
    }

    const total = filtered.length;
    const paginated = filtered.slice(skip, skip + limit);
    const ids = paginated.map((conversation) => conversation._id);
    const unreadMap = {};

    if (ids.length) {
      const unread = await Message.aggregate([
        {
          $match: {
            conversation: { $in: ids },
            recipient: req.user._id,
            isRead: false,
            deletedFor: { $ne: req.user._id },
            isDeletedForEveryone: { $ne: true },
          },
        },
        { $group: { _id: "$conversation", count: { $sum: 1 } } },
      ]);
      unread.forEach((item) => { unreadMap[String(item._id)] = item.count; });
    }

    const result = paginated.map((conversation) =>
      safeConversation(conversation, unreadMap[String(conversation._id)] || 0)
    );
    return res.status(200).json({
      success: true,
      conversations: result,
      data: result,
      contacts,
      users: contacts,
      availableUsers: contacts,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 0 },
    });
  } catch (error) {
    console.error("getConversations error:", error);
    return res.status(500).json({ success: false, message: "Server error retrieving conversations." });
  }
};

const getConversation = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid conversation ID." });
    const conversation = await populateConversation(id);
    if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });
    if (!(await canAccessConversation(conversation, req))) return res.status(403).json({ success: false, message: "Access denied." });
    const unreadCount = await getUnreadCount(id, req.user._id);
    const result = safeConversation(conversation, unreadCount);
    return res.status(200).json({ success: true, conversation: result, data: result });
  } catch (error) {
    console.error("getConversation error:", error);
    return res.status(500).json({ success: false, message: "Server error retrieving conversation." });
  }
};

const findOrCreateConversation = async (userId, contactId, channel = "chat") => {
  if (!isValidObjectId(userId) || !isValidObjectId(contactId)) throw new Error("Invalid conversation participant ID.");
  if (String(userId) === String(contactId)) throw new Error("Cannot create a conversation with yourself.");

  const filter = {
    isGroup: { $ne: true },
    participants: {
      $all: [new mongoose.Types.ObjectId(String(userId)), new mongoose.Types.ObjectId(String(contactId))],
      $size: 2,
    },
  };
  const existingConversation = await Conversation.findOne(filter);
  if (existingConversation) return existingConversation;

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
    if (!req.user) return res.status(401).json({ success: false, message: "Authentication required." });

    const { recipientId, userId, participantId, participants, isGroup, groupName } = req.body;
    const role = getRole(req.user);
    const wantsGroup = isGroup === true || isGroup === "true";
    if (wantsGroup && role !== "admin") {
      return res.status(403).json({ success: false, message: "Only Admin can create groups." });
    }

    let targetIds = [];
    if (wantsGroup) {
      if (!Array.isArray(participants)) return res.status(400).json({ success: false, message: "Group participants are required." });
      targetIds = participants.map(toId).filter(Boolean);
      const normalizedGroupName = String(groupName || "").trim();
      if (!normalizedGroupName) return res.status(400).json({ success: false, message: "Group name is required." });
      if (targetIds.some((id) => !isValidObjectId(id))) return res.status(400).json({ success: false, message: "Invalid group participant ID." });

      const uniqueTargetIds = [...new Set(targetIds.filter((id) => id !== String(req.user._id)))];
      if (uniqueTargetIds.length < 2) return res.status(400).json({ success: false, message: "A group must contain at least two other participants." });

      const validUsers = await User.find({
        _id: { $in: uniqueTargetIds },
        isDeleted: { $ne: true },
        isActive: { $ne: false },
        status: { $nin: ["Blocked", "blocked", "Inactive", "inactive", "Pending", "pending"] },
      }).select("_id").lean();
      if (validUsers.length !== uniqueTargetIds.length) {
        return res.status(400).json({ success: false, message: "One or more group participants are invalid or unavailable." });
      }
      targetIds = uniqueTargetIds;
    } else {
      const targetId = recipientId || userId || participantId;
      if (!targetId || !isValidObjectId(targetId)) return res.status(400).json({ success: false, message: "A valid recipient is required." });
      if (String(targetId) === String(req.user._id)) return res.status(400).json({ success: false, message: "Cannot create a conversation with yourself." });

      if (role !== "admin") {
        const existing = await Conversation.findOne({
          isGroup: { $ne: true },
          participants: { $all: [req.user._id, new mongoose.Types.ObjectId(String(targetId))], $size: 2 },
        }).lean();
        if (!existing || !(await canAccessConversation(existing, req))) {
          return res.status(403).json({ success: false, message: "You can only message Admins through an existing conversation." });
        }
      }

      const targetUser = await User.findById(targetId).select("_id role status isActive isDeleted").lean();
      const unavailable = !targetUser || targetUser.isDeleted === true || targetUser.isActive === false ||
        ["blocked", "inactive", "pending"].includes(String(targetUser?.status || "").toLowerCase());
      if (unavailable) return res.status(404).json({ success: false, message: "Recipient not found or unavailable." });
      if (role === "admin" && getRole(targetUser) === "admin") return res.status(403).json({ success: false, message: "Admin can start conversations with non-Admin users only." });
      if (role !== "admin" && getRole(targetUser) !== "admin") return res.status(403).json({ success: false, message: "You can only message Admins." });
      targetIds = [String(targetId)];
    }

    let conversation;
    if (!wantsGroup) {
      conversation = await findOrCreateConversation(req.user._id, targetIds[0], "chat");
    } else {
      conversation = await Conversation.create({
        participants: [...new Set([String(req.user._id), ...targetIds])],
        isGroup: true,
        groupName: String(groupName).trim(),
        groupAdmin: req.user._id,
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
      [...new Set([String(req.user._id), ...targetIds])].forEach((participantId) => {
        io.to(participantId).emit("conversation_created", formatted);
      });
    }
    return res.status(wantsGroup ? 201 : 200).json({
      success: true,
      message: wantsGroup ? "Group created successfully." : "Conversation retrieved or created successfully.",
      conversation: formatted,
      data: formatted,
    });
  } catch (error) {
    console.error("createConversation error:", error);
    if (error.message === "Invalid conversation participant ID." || error.message === "Cannot create a conversation with yourself.") {
      return res.status(400).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: "Server error starting conversation." });
  }
};

const getConversationMessages = async (req, res) => {
  try {
    const rawId = req.params.id || req.params.conversationId || req.query.conversationId || req.query.id;
    const id = String(rawId || "").trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 100));
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid conversation ID." });

    const conversation = await Conversation.findById(id).lean();
    if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });
    if (!(await canAccessConversation(conversation, req))) return res.status(403).json({ success: false, message: "Access denied." });

    const filter = {
      conversation: id,
      deletedFor: { $ne: req.user._id },
    };
    const skip = (page - 1) * limit;
    const [messages, total] = await Promise.all([
      Message.find(filter)
        .populate("sender", "name email phone role status avatar profileImage image")
        .populate("recipient", "name email phone role status avatar profileImage image")
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
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 0 },
    });
  } catch (error) {
    console.error("getConversationMessages error:", error);
    return res.status(500).json({ success: false, message: "Server error retrieving messages." });
  }
};

const inferMessageType = (attachments, requestedType) => {
  const allowed = ["text", "image", "file", "document", "video", "audio", "system"];
  if (Array.isArray(attachments) && attachments.length) {
    const type = String(attachments[0]?.mimeType || attachments[0]?.fileType || "").toLowerCase();
    if (type.startsWith("image/") || type === "image") return "image";
    if (type.startsWith("video/") || type === "video") return "video";
    if (type.startsWith("audio/") || type === "audio") return "audio";
    return "file";
  }
  return allowed.includes(String(requestedType || "").toLowerCase())
    ? String(requestedType).toLowerCase()
    : "text";
};

const sendConversationMessage = async (req, res) => {
  try {
    const rawId = req.params.id || req.params.conversationId || req.body.conversationId || req.body.id;
    const id = String(rawId || "").trim();
    const {
      body, message, content, messageType, attachments,
      replyToId, replyTo, clientMessageId,
    } = req.body;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid conversation ID." });

    const conversation = await Conversation.findById(id);
    if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });
    if (!(await canAccessConversation(conversation, req))) return res.status(403).json({ success: false, message: "Access denied." });

    let parsedAttachments = [];
    if (Array.isArray(attachments)) parsedAttachments = [...attachments];
    else if (typeof attachments === "string" && attachments.trim()) {
      try {
        const parsed = JSON.parse(attachments);
        if (Array.isArray(parsed)) parsedAttachments = parsed;
      } catch {
        return res.status(400).json({ success: false, message: "Attachments must be a valid array." });
      }
    }

    const files = Array.isArray(req.files) ? [...req.files] : req.files ? Object.values(req.files).flat() : [];
    if (req.file) files.push(req.file);
    files.forEach((file) => {
      if (!file?.filename) return;
      parsedAttachments.push({
        url: `/uploads/${file.filename}`,
        filename: file.filename,
        originalName: file.originalname || "",
        fileType: String(file.mimetype || "").split("/")[0] || "file",
        mimeType: file.mimetype || "",
        size: Number(file.size) || 0,
      });
    });

    parsedAttachments = parsedAttachments.filter((item) => item && typeof item === "object");
    if (parsedAttachments.length > 20) {
      return res.status(400).json({ success: false, message: "A maximum of 20 attachments is allowed per message." });
    }
    const cleanText = String(body ?? message ?? content ?? "").trim();
    if (cleanText.length > 20000) return res.status(400).json({ success: false, message: "Message cannot exceed 20000 characters." });
    if (!cleanText && !parsedAttachments.length) return res.status(400).json({ success: false, message: "Message content or attachment is required." });

    let recipientId = null;
    if (!conversation.isGroup) {
      const otherParticipant = (conversation.participants || []).find((participant) => String(toId(participant)) !== String(req.user._id));
      if (otherParticipant) recipientId = toId(otherParticipant);
      if (!recipientId) return res.status(400).json({ success: false, message: "Conversation recipient could not be determined." });
    }

    let resolvedReplyToId = null;
    const requestedReplyTo = replyToId || replyTo;
    if (requestedReplyTo) {
      if (!isValidObjectId(requestedReplyTo)) {
        return res.status(400).json({ success: false, message: "Invalid reply-to message ID." });
      }
      const replyMessage = await Message.findOne({
        _id: requestedReplyTo,
        conversation: conversation._id,
        deletedFor: { $ne: req.user._id },
        isDeletedForEveryone: { $ne: true },
      }).select("_id").lean();
      if (!replyMessage) {
        return res.status(400).json({ success: false, message: "Reply-to message was not found in this conversation." });
      }
      resolvedReplyToId = replyMessage._id;
    }

    const type = inferMessageType(parsedAttachments, messageType);
    const createdMessage = await Message.create({
      conversation: conversation._id,
      sender: req.user._id,
      recipient: recipientId,
      replyTo: resolvedReplyToId,
      body: cleanText,
      message: cleanText,
      messageType: type,
      attachments: parsedAttachments,
      isRead: false,
      readAt: null,
      metadata: clientMessageId ? { clientMessageId: String(clientMessageId).slice(0, 200) } : {},
    });

    conversation.lastMessage = cleanText || (type === "image" ? "📷 Photo" : type === "video" ? "🎬 Video" : type === "audio" ? "🎤 Audio" : "📎 Attachment");
    conversation.lastMessageType = type;
    conversation.lastMessageAt = createdMessage.createdAt || new Date();
    conversation.lastSender = req.user._id;
    await conversation.save();

    const populated = await populateMessage(createdMessage._id);
    const formatted = {
      ...safeMessage(populated, req.user._id),
      clientMessageId: clientMessageId ? String(clientMessageId).slice(0, 200) : null,
    };
    const io = req.app.get("io");
    if (io) {
      // Frontend must send through either REST or Socket.IO for one message, not both.
      io.to(String(req.user._id)).emit("message_sent", formatted);
      io.to(String(conversation._id)).emit("new_message", formatted);
      io.to(String(conversation._id)).emit("receive_message", formatted);
      if (conversation.isGroup) {
        (conversation.participants || []).map(toId).filter((participantId) => participantId && participantId !== String(req.user._id))
          .forEach((participantId) => io.to(participantId).emit("receive_message", formatted));
      } else if (recipientId) {
        io.to(String(recipientId)).emit("receive_message", formatted);
      }
    }

    return res.status(201).json({ success: true, message: "Message sent.", data: formatted, messageData: formatted });
  } catch (error) {
    console.error("sendConversationMessage error:", error);
    return res.status(500).json({ success: false, message: "Server error sending message." });
  }
};

const updateConversation = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid conversation ID." });
    const conversation = await Conversation.findById(id);
    if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });
    if (!(await canAccessConversation(conversation, req))) return res.status(403).json({ success: false, message: "Access denied." });

    const isAdmin = getRole(req.user) === "admin";
    const { status, isArchived, groupName, groupAvatar } = req.body;
    if (status !== undefined) {
      if (!["open", "closed", "archived"].includes(status)) return res.status(400).json({ success: false, message: "Invalid conversation status." });
      conversation.status = status;
    }
    if (isArchived !== undefined) conversation.status = isArchived === true || isArchived === "true" ? "archived" : "open";

    if (groupName !== undefined || groupAvatar !== undefined) {
      if (!isAdmin || !conversation.isGroup) return res.status(403).json({ success: false, message: "Only Admin can update group details." });
      if (groupName !== undefined) {
        const normalizedName = String(groupName).trim();
        if (!normalizedName) return res.status(400).json({ success: false, message: "Group name is required." });
        conversation.groupName = normalizedName;
      }
      if (groupAvatar !== undefined) conversation.groupAvatar = String(groupAvatar || "").trim();
    }

    await conversation.save();
    const populated = await populateConversation(conversation._id);
    const formatted = safeConversation(populated, await getUnreadCount(conversation._id, req.user._id));
    const io = req.app.get("io");
    if (io) {
      io.to(String(id)).emit("conversation_updated", formatted);
      (conversation.participants || []).map(toId).filter(Boolean).forEach((participantId) => {
        io.to(participantId).emit("conversation_updated", formatted);
      });
    }
    return res.status(200).json({ success: true, conversation: formatted, data: formatted });
  } catch (error) {
    console.error("updateConversation error:", error);
    return res.status(500).json({ success: false, message: "Server error updating conversation." });
  }
};

const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid ID." });
    const conversation = await Conversation.findById(id);
    if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });
    if (!(await canAccessConversation(conversation, req))) return res.status(403).json({ success: false, message: "Access denied." });

    const now = new Date();
    await Message.updateMany(
      {
        conversation: conversation._id,
        recipient: req.user._id,
        isRead: false,
        deletedFor: { $ne: req.user._id },
        isDeletedForEveryone: { $ne: true },
      },
      { $set: { isRead: true, readAt: now } }
    );
    const unreadCount = await getUnreadCount(conversation._id, req.user._id);
    conversation.unreadCount = unreadCount;
    await conversation.save();

    const io = req.app.get("io");
    if (io) {
      const payload = { conversationId: String(id), readerId: String(req.user._id), unreadCount, readAt: now };
      io.to(String(conversation._id)).emit("messages_read", payload);
      (conversation.participants || []).map(toId).filter(Boolean).forEach((participantId) => io.to(participantId).emit("messages_read", payload));
    }
    return res.status(200).json({ success: true, unreadCount });
  } catch (error) {
    console.error("markAsRead error:", error);
    return res.status(500).json({ success: false, message: "Server error marking messages as read." });
  }
};

const markMessageAsRead = async (req, res) => {
  try {
    const messageId = req.params.messageId || req.params.id;
    if (!isValidObjectId(messageId)) return res.status(400).json({ success: false, message: "Invalid ID." });
    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ success: false, message: "Message not found." });
    const conversation = await Conversation.findById(message.conversation);
    if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });
    if (!(await canAccessConversation(conversation, req))) return res.status(403).json({ success: false, message: "Access denied." });
    if (String(message.recipient) !== String(req.user._id)) return res.status(403).json({ success: false, message: "You can only mark messages sent to you as read." });

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
      if (message.sender) io.to(String(message.sender)).emit("message_read", formatted);
    }
    return res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    console.error("markMessageAsRead error:", error);
    return res.status(500).json({ success: false, message: "Server error marking message as read." });
  }
};

const getUnreadMessageCount = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Authentication required." });
    const unreadCount = await Message.countDocuments({
      recipient: req.user._id,
      isRead: false,
      deletedFor: { $ne: req.user._id },
      isDeletedForEveryone: { $ne: true },
    });
    return res.status(200).json({ success: true, unreadCount });
  } catch (error) {
    console.error("getUnreadMessageCount error:", error);
    return res.status(500).json({ success: false, message: "Server error retrieving unread count." });
  }
};

const deleteConversation = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid conversation ID." });
    if (getRole(req.user) !== "admin") return res.status(403).json({ success: false, message: "Access denied." });
    const conversation = await Conversation.findById(id).lean();
    if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });

    await Promise.all([Message.deleteMany({ conversation: id }), Conversation.findByIdAndDelete(id)]);
    const io = req.app.get("io");
    if (io) {
      const payload = { conversationId: String(id) };
      io.to(String(id)).emit("conversation_deleted", payload);
      [...new Set((conversation.participants || []).map(toId).filter(Boolean))].forEach((participantId) => io.to(participantId).emit("conversation_deleted", payload));
    }
    return res.status(200).json({ success: true, message: "Deleted successfully." });
  } catch (error) {
    console.error("deleteConversation error:", error);
    return res.status(500).json({ success: false, message: "Server error deleting conversation." });
  }
};

const getThread = async (req, res) => {
  try {
    const { contactId } = req.params;
    if (!isValidObjectId(contactId)) return res.status(400).json({ success: false, message: "Invalid contact ID." });
    const contact = await User.findById(contactId).select("_id role status isActive isDeleted").lean();
    if (!contact) return res.status(404).json({ success: false, message: "Contact not found." });
    if (contact.isDeleted === true || contact.isActive === false || ["blocked", "inactive", "pending"].includes(String(contact.status || "").toLowerCase())) {
      return res.status(404).json({ success: false, message: "Contact is unavailable." });
    }

    const isAdmin = getRole(req.user) === "admin";
    if ((!isAdmin && getRole(contact) !== "admin") || (isAdmin && getRole(contact) === "admin")) {
      return res.status(403).json({ success: false, message: "You can only access permitted Admin-user conversations." });
    }

    const conversation = await Conversation.findOne({
      isGroup: { $ne: true },
      participants: { $all: [new mongoose.Types.ObjectId(String(req.user._id)), new mongoose.Types.ObjectId(String(contactId))], $size: 2 },
    }).lean();

    if (!conversation) return res.status(200).json({ success: true, data: { messages: [], calls: [], emails: [] } });
    if (!(await canAccessConversation(conversation, req))) return res.status(403).json({ success: false, message: "Access denied." });

    const messages = await Message.find({
      conversation: conversation._id,
      deletedFor: { $ne: req.user._id },
    })
      .populate("sender recipient deletedBy", "name email phone role status avatar profileImage image")
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: { messages: messages.map((message) => safeMessage(message, req.user._id)), calls: [], emails: [] },
    });
  } catch (error) {
    console.error("getThread error:", error);
    return res.status(500).json({ success: false, message: "Server error retrieving thread." });
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