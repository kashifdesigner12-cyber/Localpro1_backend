const mongoose = require("mongoose");

const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");

const {
  createNotification,
} = require("./notificationController");

// ============================================================================
// HELPERS
// ============================================================================

const isValidObjectId = (id) =>
  Boolean(id) && mongoose.Types.ObjectId.isValid(id);

// ============================================================================
// SAFE USER
// ============================================================================

const safeUserRef = (user) => {
  if (!user) return null;

  if (
    typeof user === "object" &&
    user._id
  ) {
    let cleanAvatar = user.avatar || "";
    if (typeof cleanAvatar === "string" && cleanAvatar.startsWith("data:image") && cleanAvatar.length > 1000) {
      cleanAvatar = "";
    }

    return {
      id: user._id,
      _id: user._id,
      name: user.name || "",
      email: user.email || "",
      phone: user.phone || "",
      role: user.role || "",
      status: user.status || "",
      avatar: cleanAvatar,
    };
  }

  return user;
};

// ============================================================================
// SAFE CONVERSATION
// ============================================================================

const safeConversation = (
  conversation,
  unreadCount = 0
) => {
  return {
    id: conversation._id,
    _id: conversation._id,

    isGroup: Boolean(conversation.isGroup),
    groupName: conversation.groupName || "",
    groupAdmin: safeUserRef(conversation.groupAdmin),

    participants: Array.isArray(
      conversation.participants
    )
      ? conversation.participants.map(
          safeUserRef
        )
      : [],

    lastMessage:
      conversation.lastMessage || "",

    lastMessageAt:
      conversation.lastMessageAt ||
      conversation.updatedAt ||
      null,

    lastSender:
      safeUserRef(
        conversation.lastSender
      ),

    unreadCount,

    status:
      conversation.status || "open",

    isArchived:
      conversation.status === "archived",

    channel:
      conversation.channel || "chat",

    createdAt:
      conversation.createdAt,

    updatedAt:
      conversation.updatedAt,
  };
};

// ============================================================================
// SAFE MESSAGE
// ============================================================================

const safeMessage = (message) => {
  if (!message) return null;

  return {
    id: message._id,
    _id: message._id,

    conversationId:
      message.conversation,

    sender:
      safeUserRef(message.sender),

    recipient:
      safeUserRef(message.recipient),

    body:
      message.body ||
      message.message ||
      "",

    message:
      message.body ||
      message.message ||
      "",

    messageType:
      message.messageType || "text",

    attachments:
      Array.isArray(
        message.attachments
      )
        ? message.attachments
        : [],

    isRead:
      Boolean(message.isRead),

    readAt:
      message.readAt || null,

    channel:
      message.channel || "chat",

    direction:
      message.direction || "internal",

    metadata:
      message.metadata || {},

    createdAt:
      message.createdAt,

    updatedAt:
      message.updatedAt,
  };
};

// ============================================================================
// PARTICIPANT CHECK
// ============================================================================

const isConversationParticipant = (
  conversation,
  userId
) => {
  if (!conversation || !userId) {
    return false;
  }

  const currentUserId =
    userId.toString();

  const participants =
    Array.isArray(
      conversation.participants
    )
      ? conversation.participants
      : [];

  const participantMatch =
    participants.some(
      (participant) => {
        const participantId =
          participant?._id
            ? participant._id
            : participant;

        return (
          participantId &&
          participantId.toString() ===
            currentUserId
        );
      }
    );

  const legacyUserId =
    conversation.userId &&
    conversation.userId.toString() ===
      currentUserId;

  const legacyUser =
    conversation.user &&
    conversation.user.toString() ===
      currentUserId;

  return (
    participantMatch ||
    legacyUserId ||
    legacyUser
  );
};

// ============================================================================
// ACCESS
// ============================================================================

const canAccessConversation = (
  conversation,
  req
) => {
  if (!req.user) {
    return false;
  }

  if (
    req.user.role === "admin"
  ) {
    return true;
  }

  return isConversationParticipant(
    conversation,
    req.user._id
  );
};

// ============================================================================
// UNREAD
// ============================================================================

const getUnreadCount = async (
  conversationId,
  userId
) => {
  return Message.countDocuments({
    conversation:
      conversationId,

    recipient:
      userId,

    isRead: false,
  });
};

// ============================================================================
// POPULATE CONVERSATION
// ============================================================================

const populateConversation = (
  conversationId
) => {
  return Conversation.findById(
    conversationId
  )
    .populate(
      "participants",
      "name email phone role status avatar"
    )
    .populate(
      "lastSender",
      "name email phone role status avatar"
    )
    .populate(
      "groupAdmin",
      "name email phone role status avatar"
    )
    .lean();
};

// ============================================================================
// POPULATE MESSAGE
// ============================================================================

const populateMessage = (
  messageId
) => {
  return Message.findById(
    messageId
  )
    .populate(
      "sender",
      "name email phone role status avatar"
    )
    .populate(
      "recipient",
      "name email phone role status avatar"
    )
    .lean();
};

// ============================================================================
// GET AVAILABLE CONTACTS (Strict Admin-Only Privacy for regular users)
// ============================================================================

const getAvailableContacts = async (
  req,
  search = ""
) => {
  if (!req.user) {
    return [];
  }

  const currentUserId = req.user._id;
  let roles = [];

  if (req.user.role === "admin") {
    roles = ["manager", "user", "admin"];
  } else if (req.user.role === "manager") {
    roles = ["user", "manager", "admin"];
  } else {
    roles = ["admin", "manager", "support"]; // Regular users can ONLY see Admin / Support / Manager
  }

  const filter = {
    _id: {
      $ne: currentUserId,
    },
    role: {
      $in: roles,
    },
    $or: [
      {
        status: {
          $exists: false,
        },
      },
      {
        status: {
          $nin: [
            "Blocked",
            "blocked",
          ],
        },
      },
    ],
  };

  if (
    search &&
    search.trim()
  ) {
    const searchTerm =
      search.trim();

    filter.$and = [
      {
        $or: [
          {
            name: {
              $regex:
                searchTerm,
              $options: "i",
            },
          },
          {
            email: {
              $regex:
                searchTerm,
              $options: "i",
            },
          },
          {
            phone: {
              $regex:
                searchTerm,
              $options: "i",
            },
          },
          {
            role: {
              $regex:
                searchTerm,
              $options: "i",
            },
          },
        ],
      },
    ];
  }

  const users =
    await User.find(filter)
      .select(
        "_id name email phone role status avatar"
      )
      .sort({
        name: 1,
      })
      .lean();

  return users.map(
    safeUserRef
  );
};

// ============================================================================
// GET ALL CONVERSATIONS
// GET /api/conversations
// ============================================================================

const getConversations = async (
  req,
  res
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication required.",
      });
    }

    const {
      page = 1,
      limit = 100,
      search = "",
    } = req.query;

    const pageNum = Math.max(
      1,
      parseInt(page, 10) || 1
    );

    const limitNum = Math.min(
      100,
      Math.max(
        1,
        parseInt(limit, 10) || 100
      )
    );

    const skip =
      (pageNum - 1) *
      limitNum;

    const currentUserId =
      req.user._id;

    let conversationFilter = {};

    if (
      req.user.role !== "admin"
    ) {
      conversationFilter = {
        $or: [
          {
            participants:
              currentUserId,
          },
          {
            userId:
              currentUserId,
          },
          {
            user:
              currentUserId,
          },
        ],
      };
    }

    const [conversations, total, contacts] = await Promise.all([
      Conversation.find(
        conversationFilter
      )
        .populate(
          "participants",
          "name email phone role status avatar"
        )
        .populate(
          "lastSender",
          "name email phone role status avatar"
        )
        .populate(
          "groupAdmin",
          "name email phone role status avatar"
        )
        .sort({
          lastMessageAt: -1,
          updatedAt: -1,
        })
        .skip(skip)
        .limit(limitNum)
        .lean(),

      Conversation.countDocuments(
        conversationFilter
      ),

      getAvailableContacts(
        req,
        search
      ),
    ]);

    let filteredConversations = conversations;

    if (req.user.role !== "admin" && req.user.role !== "manager") {
      filteredConversations = filteredConversations.filter((conv) => {
        const parts = Array.isArray(conv.participants) ? conv.participants : [];
        return parts.some((p) => {
          const pId = p?._id || p;
          const pRole = String(p?.role || "").trim().toLowerCase();
          return String(pId) !== String(currentUserId) && (pRole === "admin" || pRole === "manager" || pRole === "support");
        });
      });
    }

    if (search && search.trim()) {
      const searchTerm = search.trim().toLowerCase();

      filteredConversations = filteredConversations.filter((conversation) => {
        if (conversation.isGroup && conversation.groupName && conversation.groupName.toLowerCase().includes(searchTerm)) {
          return true;
        }
        const participants = Array.isArray(conversation.participants)
          ? conversation.participants
          : [];

        return participants.some((participant) => {
          const name = (participant?.name || "").toLowerCase();
          const email = (participant?.email || "").toLowerCase();
          const phone = (participant?.phone || "").toLowerCase();
          const role = (participant?.role || "").toLowerCase();

          return (
            name.includes(searchTerm) ||
            email.includes(searchTerm) ||
            phone.includes(searchTerm) ||
            role.includes(searchTerm)
          );
        });
      });
    }

    const conversationIds = filteredConversations.map((c) => c._id);
    const unreadCountsMap = {};

    if (conversationIds.length > 0) {
      const unreadAgg = await Message.aggregate([
        {
          $match: {
            conversation: { $in: conversationIds },
            recipient: currentUserId,
            isRead: false,
          },
        },
        {
          $group: {
            _id: "$conversation",
            count: { $sum: 1 },
          },
        },
      ]);

      unreadAgg.forEach((item) => {
        unreadCountsMap[String(item._id)] = item.count;
      });
    }

    const formattedConversations = filteredConversations.map((conversation) => {
      const unreadCount = unreadCountsMap[String(conversation._id)] || 0;
      return safeConversation(conversation, unreadCount);
    });

    return res.status(200).json({
      success: true,
      conversations:
        formattedConversations,
      data:
        formattedConversations,
      contacts,
      users:
        contacts,
      availableUsers:
        contacts,
      pagination: {
        page: pageNum,
        limit:
          limitNum,
        total,
        pages:
          Math.ceil(
            total / limitNum
          ) || 0,
      },
    });
  } catch (error) {
    console.error(
      "getConversations error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error retrieving conversations.",
      error:
        process.env.NODE_ENV ===
        "development"
          ? error.message
          : undefined,
    });
  }
};

// ============================================================================
// GET SINGLE CONVERSATION
// ============================================================================

const getConversation = async (
  req,
  res
) => {
  try {
    const { id } =
      req.params;

    if (
      !isValidObjectId(id)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid conversation ID.",
      });
    }

    const [conversation, unreadCount] = await Promise.all([
      populateConversation(id),
      getUnreadCount(id, req.user._id),
    ]);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message:
          "Conversation not found.",
      });
    }

    if (
      !canAccessConversation(
        conversation,
        req
      )
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied.",
      });
    }

    const formatted =
      safeConversation(
        conversation,
        unreadCount
      );

    return res.status(200).json({
      success: true,
      conversation:
        formatted,
      data:
        formatted,
    });
  } catch (error) {
    console.error(
      "getConversation error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error retrieving conversation.",
    });
  }
};

// ============================================================================
// CREATE CONVERSATION
// ============================================================================

const createConversation = async (
  req,
  res
) => {
  try {
    const {
      recipientId,
      userId,
      participantId,
      participants,
      isGroup,
      groupName,
    } = req.body;

    let participantIds = [];

    if (isGroup && Array.isArray(participants)) {
      participantIds = participants.map(p => typeof p === 'object' && p._id ? p._id : p);
    } else {
      const targetUserId =
        recipientId ||
        userId ||
        participantId;

      if (targetUserId) {
        participantIds = [targetUserId];
      }
    }

    if (participantIds.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "Recipient or participants are required.",
      });
    }

    for (const pid of participantIds) {
      if (!isValidObjectId(pid)) {
        return res.status(400).json({
          success: false,
          message: "Invalid participant ID in list.",
        });
      }
      if (pid.toString() === req.user._id.toString() && !isGroup) {
        return res.status(400).json({
          success: false,
          message: "Cannot start a direct conversation with yourself.",
        });
      }
    }

    const allParticipantsSet = new Set([req.user._id.toString(), ...participantIds.map(id => id.toString())]);
    const finalParticipants = Array.from(allParticipantsSet);

    if (!isGroup && finalParticipants.length === 2) {
      const otherUserId = finalParticipants.find(id => id !== req.user._id.toString());
      let conversation =
        await Conversation.findOne({
          isGroup: { $ne: true },
          participants: {
            $all: [
              req.user._id,
              otherUserId,
            ],
            $size: 2,
          },
        }).lean();

      if (conversation) {
        const [populated, unreadCount] = await Promise.all([
          populateConversation(conversation._id),
          getUnreadCount(conversation._id, req.user._id),
        ]);

        const formatted =
          safeConversation(
            populated,
            unreadCount
          );

        return res.status(200).json({
          success: true,
          message:
            "Existing conversation retrieved.",
          conversation:
            formatted,
          data:
            formatted,
        });
      }
    }

    const createdConv =
      await Conversation.create({
        participants: finalParticipants,
        isGroup: Boolean(isGroup || finalParticipants.length > 2),
        groupName: isGroup ? (groupName || "Team Group") : "",
        groupAdmin: isGroup ? req.user._id : null,
        lastMessage: isGroup ? "Group created" : "",
        lastMessageAt: new Date(),
        lastSender: req.user._id,
        unreadCount: 0,
        status: "open",
        channel: "chat",
      });

    const populated =
      await populateConversation(
        createdConv._id
      );

    const formatted =
      safeConversation(
        populated,
        0
      );

    const io = req.app.get("io");
    if (io) {
      finalParticipants.forEach(pId => {
        io.to(pId.toString()).emit("conversation_created", formatted);
      });
    }

    return res.status(201).json({
      success: true,
      message:
        isGroup ? "Group created successfully." : "Conversation started successfully.",
      conversation:
        formatted,
      data:
        formatted,
    });
  } catch (error) {
    console.error(
      "createConversation error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error starting conversation.",
      error:
        process.env.NODE_ENV ===
        "development"
          ? error.message
          : undefined,
    });
  }
};

// ============================================================================
// GET MESSAGES
// ============================================================================

const getConversationMessages =
  async (req, res) => {
    try {
      const { id } =
        req.params;

      const {
        page = 1,
        limit = 100,
      } = req.query;

      if (
        !isValidObjectId(id)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid conversation ID.",
        });
      }

      const conversation =
        await Conversation.findById(
          id
        ).select("participants userId user").lean();

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message:
            "Conversation not found.",
        });
      }

      if (
        !canAccessConversation(
          conversation,
          req
        )
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Access denied.",
        });
      }

      const pageNum = Math.max(
        1,
        parseInt(page, 10) || 1
      );

      const limitNum = Math.min(
        100,
        Math.max(
          1,
          parseInt(limit, 10) || 100
        )
      );

      const skip =
        (pageNum - 1) *
        limitNum;

      const [
        messages,
        total,
      ] = await Promise.all([
        Message.find({
          conversation: id,
        })
          .populate(
            "sender",
            "name email phone role status avatar"
          )
          .populate(
            "recipient",
            "name email phone role status avatar"
          )
          .sort({
            createdAt: 1,
          })
          .skip(skip)
          .limit(limitNum)
          .lean(),

        Message.countDocuments({
          conversation: id,
        }),
      ]);

      const safeMessages =
        messages.map(
          safeMessage
        );

      return res.status(200).json({
        success: true,
        messages:
          safeMessages,
        data:
          safeMessages,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages:
            Math.ceil(
              total /
                limitNum
            ) || 0,
        },
      });
    } catch (error) {
      console.error(
        "getConversationMessages error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Server error retrieving messages.",
      });
    }
  };

// ============================================================================
// SEND MESSAGE
// ============================================================================

const sendConversationMessage =
  async (req, res) => {
    try {
      const { id } =
        req.params;

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

      let parsedAttachments = Array.isArray(attachments) ? [...attachments] : [];

      if (req.files && Array.isArray(req.files) && req.files.length > 0) {
        const uploadedList = req.files.map((file) => ({
          url: `/uploads/${file.filename}`,
          filename: file.filename,
          originalName: file.originalname,
          fileType: file.mimetype.split('/')[0] || 'file',
          mimeType: file.mimetype,
          size: file.size
        }));
        parsedAttachments = [...parsedAttachments, ...uploadedList];
      } else if (req.file) {
        parsedAttachments.push({
          url: `/uploads/${req.file.filename}`,
          filename: req.file.filename,
          originalName: req.file.originalname,
          fileType: req.file.mimetype.split('/')[0] || 'file',
          mimeType: req.file.mimetype,
          size: req.file.size
        });
      }

      const text =
        body ||
        message ||
        content ||
        "";

      const hasAttachments = parsedAttachments.length > 0;

      if (
        !isValidObjectId(id)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid conversation ID.",
        });
      }

      if (
        typeof text !==
        "string"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Message content must be text.",
        });
      }

      if (
        !text.trim() &&
        !hasAttachments
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Message content or attachment is required.",
        });
      }

      const conversation =
        await Conversation.findById(
          id
        );

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message:
            "Conversation not found.",
        });
      }

      if (
        !canAccessConversation(
          conversation,
          req
        )
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Access denied.",
        });
      }

      let recipientId = null;

      if (
        Array.isArray(
          conversation.participants
        ) && !conversation.isGroup
      ) {
        const other =
          conversation.participants.find(
            (participant) =>
              participant.toString() !==
              req.user._id.toString()
          );

        if (other) {
          recipientId = other;
        }
      }

      const cleanText =
        text.trim();

      const calculatedMsgType = messageType || (hasAttachments ? (parsedAttachments[0]?.mimeType?.startsWith('image/') ? 'image' : 'file') : 'text');

      const createdMessage =
        await Message.create({
          conversation:
            conversation._id,

          sender:
            req.user._id,

          recipient:
            recipientId,

          body:
            cleanText,

          message:
            cleanText,

          messageType: calculatedMsgType,

          attachments: parsedAttachments,

          isRead: false,

          readAt: null,

          channel:
            channel || "chat",

          direction:
            direction || "internal",

          metadata:
            metadata || {},
        });

      const now =
        new Date();

      const previewText = cleanText || (calculatedMsgType === 'image' ? '📷 Photo' : '📎 Attachment');

      conversation.lastMessage = previewText;
      conversation.lastMessageType = calculatedMsgType;
      conversation.lastMessageAt =
        now;

      conversation.lastSender =
        req.user._id;

      conversation.updatedAt =
        now;

      await conversation.save();

      const populated =
        await populateMessage(
          createdMessage._id
        );

      const formattedMessage =
        safeMessage(
          populated
        );

      const io = req.app.get("io");
      if (io) {
        io.to(conversation._id.toString()).emit("receive_message", formattedMessage);
        io.to(conversation._id.toString()).emit("new_message", formattedMessage);

        if (Array.isArray(conversation.participants)) {
          conversation.participants.forEach((participantId) => {
            if (participantId.toString() !== req.user._id.toString()) {
              io.to(participantId.toString()).emit("notification", {
                type: "message",
                title: `New message from ${req.user.name || "Admin / Support"}`,
                message: previewText,
                conversationId: conversation._id,
                messageId: formattedMessage._id
              });
            }
          });
        }
      }

      if (Array.isArray(conversation.participants)) {
        conversation.participants.forEach((participantId) => {
          if (participantId.toString() !== req.user._id.toString()) {
            (async () => {
              try {
                await createNotification({
                  userId: participantId,
                  type: "message",
                  title: conversation.isGroup ? `New message in ${conversation.groupName || 'Group'}` : "New Message",
                  message: `${req.user.name || "Admin"} sent a message.`,
                  relatedId: conversation._id,
                  relatedType: "Message",
                  actionUrl: req.user.role === 'admin' ? '/admin/conversations' : '/manager/conversations',
                  metadata: {
                    conversationId: conversation._id,
                    messageId: createdMessage._id,
                    senderId: req.user._id,
                    senderName: req.user.name,
                  },
                });
              } catch (notificationError) {
                console.error("Message notification error:", notificationError);
              }
            })();
          }
        });
      }

      return res.status(201).json({
        success: true,
        message:
          "Message sent successfully.",
        data:
          formattedMessage,
        messageData:
          formattedMessage,
      });
    } catch (error) {
      console.error(
        "sendConversationMessage error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Server error sending message.",
      });
    }
  };

// ============================================================================
// UPDATE CONVERSATION
// ============================================================================

const updateConversation =
  async (req, res) => {
    try {
      const { id } =
        req.params;

      const {
        status,
        channel,
        isArchived,
        groupName,
      } = req.body;

      if (
        !isValidObjectId(id)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid conversation ID.",
        });
      }

      const conversation =
        await Conversation.findById(
          id
        );

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message:
            "Conversation not found.",
        });
      }

      if (
        !canAccessConversation(
          conversation,
          req
        )
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Access denied.",
        });
      }

      if (
        status !== undefined
      ) {
        conversation.status =
          status;
      }

      if (
        isArchived !== undefined
      ) {
        conversation.status =
          isArchived
            ? "archived"
            : "open";
      }

      if (groupName !== undefined && conversation.isGroup) {
        conversation.groupName = groupName;
      }

      await conversation.save();

      const [populated, unreadCount] = await Promise.all([
        populateConversation(conversation._id),
        getUnreadCount(conversation._id, req.user._id),
      ]);

      const formatted =
        safeConversation(
          populated,
          unreadCount
        );

      const io = req.app.get("io");
      if (io) {
        io.to(conversation._id.toString()).emit("conversation_updated", formatted);
      }

      return res.status(200).json({
        success: true,
        message:
          "Conversation updated successfully.",
        conversation:
          formatted,
        data:
          formatted,
      });
    } catch (error) {
      console.error(
        "updateConversation error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Server error updating conversation.",
      });
    }
  };

// ============================================================================
// MARK CONVERSATION READ
// ============================================================================

const markAsRead = async (
  req,
  res
) => {
  try {
    const { id } =
      req.params;

    if (
      !isValidObjectId(id)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid conversation ID.",
      });
    }

    const conversation =
      await Conversation.findById(
        id
      );

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message:
          "Conversation not found.",
      });
    }

    if (
      !canAccessConversation(
        conversation,
        req
      )
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied.",
      });
    }

    const unreadFilter = {
      conversation:
        conversation._id,

      recipient:
        req.user._id,

      isRead: false,
    };

    const [unreadBefore, result] = await Promise.all([
      Message.countDocuments(unreadFilter),
      Message.updateMany(unreadFilter, {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      }),
    ]);

    const modifiedCount =
      Number(
        result.modifiedCount
      ) ||
      Number(
        result.nModified
      ) ||
      0;

    const unreadAfter =
      await getUnreadCount(
        conversation._id,
        req.user._id
      );

    conversation.unreadCount =
      unreadAfter;

    await conversation.save();

    const io = req.app.get("io");
    if (io) {
      io.to(conversation._id.toString()).emit("messages_read", { conversationId: conversation._id, readerId: req.user._id });
    }

    return res.status(200).json({
      success: true,
      message:
        "Conversation marked as read.",
      modifiedCount,
      unreadBefore,
      unreadAfter,
    });
  } catch (error) {
    console.error(
      "markAsRead error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error marking conversation as read.",
    });
  }
};

// ============================================================================
// MARK MESSAGE READ
// ============================================================================

const markMessageAsRead =
  async (req, res) => {
    try {
      const { messageId } =
        req.params;

      if (
        !isValidObjectId(
          messageId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid message ID.",
        });
      }

      const message =
        await Message.findById(
          messageId
        );

      if (!message) {
        return res.status(404).json({
          success: false,
          message:
            "Message not found.",
        });
      }

      const conversation =
        await Conversation.findById(
          message.conversation
        );

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message:
            "Conversation not found.",
        });
      }

      if (
        !isConversationParticipant(
          conversation,
          req.user._id
        )
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Access denied.",
        });
      }

      let modifiedCount = 0;

      if (!message.isRead) {
        message.isRead = true;

        message.readAt =
          new Date();

        await message.save();

        modifiedCount = 1;
      }

      const unreadAfter =
        await getUnreadCount(
          conversation._id,
          req.user._id
        );

      conversation.unreadCount =
        unreadAfter;

      await conversation.save();

      const populated =
        await populateMessage(
          message._id
        );

      const formatted =
        safeMessage(
          populated
        );

      const io = req.app.get("io");
      if (io) {
        io.to(conversation._id.toString()).emit("message_read", formatted);
      }

      return res.status(200).json({
        success: true,
        message:
          "Message marked as read successfully.",
        data:
          formatted,
        messageData:
          formatted,
        modifiedCount,
        unreadAfter,
      });
    } catch (error) {
      console.error(
        "markMessageAsRead error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Server error marking message as read.",
      });
    }
  };

// ============================================================================
// UNREAD COUNT
// ============================================================================

const getUnreadMessageCount =
  async (req, res) => {
    try {
      const unreadCount =
        await Message.countDocuments({
          recipient:
            req.user._id,

          isRead: false,
        });

      return res.status(200).json({
        success: true,
        unreadCount,
        count:
          unreadCount,
        data: {
          unreadCount,
        },
      });
    } catch (error) {
      console.error(
        "getUnreadMessageCount error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Server error retrieving unread message count.",
      });
    }
  };

// ============================================================================
// DELETE
// ============================================================================

const deleteConversation =
  async (req, res) => {
    try {
      const { id } =
        req.params;

      if (
        !isValidObjectId(id)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid conversation ID.",
        });
      }

      const conversation =
        await Conversation.findById(
          id
        ).select("participants userId user").lean();

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message:
            "Conversation not found.",
        });
      }

      if (
        !canAccessConversation(
          conversation,
          req
        )
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Access denied.",
        });
      }

      await Promise.all([
        Message.deleteMany({ conversation: id }),
        Conversation.findByIdAndDelete(id),
      ]);

      const io = req.app.get("io");
      if (io) {
        io.to(id).emit("conversation_deleted", { conversationId: id });
      }

      return res.status(200).json({
        success: true,
        message:
          "Conversation deleted successfully.",
      });
    } catch (error) {
      console.error(
        "deleteConversation error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Server error deleting conversation.",
      });
    }
  };

// ============================================================================
// LEGACY THREAD
// ============================================================================

const getThread = async (
  req,
  res
) => {
  try {
    const { contactId } =
      req.params;

    if (
      !isValidObjectId(
        contactId
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid contact ID.",
      });
    }

    const messages =
      await Message.find({
        $or: [
          {
            sender:
              req.user._id,

            recipient:
              contactId,
          },
          {
            sender:
              contactId,

            recipient:
              req.user._id,
          },
        ],
      })
        .populate(
          "sender",
          "name email phone role status avatar"
        )
        .populate(
          "recipient",
          "name email phone role status avatar"
        )
        .sort({
          createdAt: 1,
        })
        .lean();

    return res.status(200).json({
      success: true,
      data: {
        messages:
          messages.map(
            safeMessage
          ),
        calls: [],
        emails: [],
      },
    });
  } catch (error) {
    console.error(
      "getThread error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error.",
    });
  }
};

// ============================================================================
// FIND OR CREATE
// ============================================================================

const findOrCreateConversation =
  async (
    userId,
    contactId,
    channel = "chat"
  ) => {
    let conversation =
      await Conversation.findOne({
        isGroup: { $ne: true },
        participants: {
          $all: [            userId,            contactId,          ],$size: 2,
        },
      });

    if (!conversation) {
      conversation =
        await Conversation.create({
          participants: [
            userId,
            contactId,
          ],
          channel,
          status: "open",
          unreadCount: 0,
          lastMessage: "",
          lastMessageAt: null,
          lastSender: null,
        });
    }

    return conversation;
  };

// ============================================================================

module.exports = {
  getConversations,
  getConversation,
  getConversationById:
    getConversation,
  createConversation,
  updateConversation,
  getConversationMessages,
  sendConversationMessage,
  markAsRead,
  markMessageAsRead,
  markSingleMessageAsRead:
    markMessageAsRead,
  getUnreadMessageCount,
  deleteConversation,
  getThread,
  findOrCreateConversation,
};