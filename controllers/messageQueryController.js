"use strict";

const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const { isValidObjectId, canAccessConversation, getUserRole } = require("../utils/messageHelpers");

// Retrieve messages for a specific conversation with pagination and security checks
const getMessages = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const conversationId = String(req.params.conversationId || req.params.id || req.query.conversationId || "").trim();
    if (!isValidObjectId(conversationId)) {
      return res.status(400).json({ success: false, message: "Invalid conversation ID." });
    }

    const conversation = await Conversation.findById(conversationId).select("participants userId").lean();
    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found." });
    }

    if (!canAccessConversation(conversation, req.user._id, getUserRole(req.user))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limitNum = Math.min(100, parseInt(req.query.limit, 10) || 50);
    const skip = (page - 1) * limitNum;

    const filter = { conversation: conversationId, deletedFor: { $ne: req.user._id } };

    const [messages, total] = await Promise.all([
      Message.find(filter)
        .populate("sender recipient deletedBy", "name fullName email role avatar profileImage")
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Message.countDocuments(filter),
    ]);

    messages.reverse();

    return res.status(200).json({
      success: true,
      messages,
      data: messages,
      pagination: { page, limit: limitNum, total, pages: Math.ceil(total / limitNum) || 0 },
    });
  } catch (error) {
    console.error("[Messages] getMessages error:", error);
    return res.status(500).json({ success: false, message: "Server error retrieving messages." });
  }
};

// Retrieve unread message count for the authenticated user
const getUnreadMessageCount = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const unreadCount = await Message.countDocuments({
      recipient: req.user._id,
      isRead: false,
      deletedFor: { $ne: req.user._id },
    });
    return res.status(200).json({ success: true, unreadCount });
  } catch (error) {
    console.error("[Messages] getUnreadMessageCount error:", error);
    return res.status(500).json({ success: false, message: "Server error retrieving unread count." });
  }
};

module.exports = { getMessages, getUnreadMessageCount };