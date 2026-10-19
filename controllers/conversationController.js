"use strict";

const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const { isValidObjectId, toId, getRole } = require("../utils/chatHelpers");
const { safeConversation, safeMessage } = require("../utils/formatters");

// Retrieve all conversations for the authenticated user with high performance
const getConversations = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const conversations = await Conversation.find({ participants: req.user._id })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .lean();

    const result = conversations.map((c) => safeConversation(c, 0));
    return res.status(200).json({ success: true, conversations: result, data: result });
  } catch (error) {
    console.error("getConversations error:", error);
    return res.status(500).json({ success: false, message: "Server error retrieving conversations." });
  }
};

// Additional conversation controllers can be appended here or in separate modules following this standard pattern.

module.exports = {
  getConversations,
  // Attach other conversation controllers here as needed
};