"use strict";

const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const { isValidObjectId, toId, getRole } = require("../utils/chatHelpers");
const { safeConversation, safeMessage } = require("../utils/formatters");

// Retrieve all conversations for the authenticated user with high performance & filtering deleted users
const getConversations = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const conversations = await Conversation.find({ participants: req.user._id })
      .populate("participants", "name fullName email role avatar profileImage status")
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .lean();

    // Filter out conversations where other participants no longer exist (deleted users)
    const validConversations = conversations.filter((c) => {
      if (c.isGroup) return true;
      const otherParticipants = c.participants?.filter((p) => String(p?._id || p) !== String(req.user._id)) || [];
      return otherParticipants.length > 0;
    });

    const result = validConversations.map((c) => safeConversation(c, 0));
    return res.status(200).json({ success: true, conversations: result, data: result });
  } catch (error) {
    console.error("getConversations error:", error);
    return res.status(500).json({ success: false, message: "Server error retrieving conversations." });
  }
};

module.exports = {
  getConversations,
};