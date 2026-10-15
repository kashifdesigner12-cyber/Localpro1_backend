"use strict";

const express = require("express");

const {
  getConversations,
  getConversation,
  createConversation,
  updateConversation,
  getConversationMessages,
  sendConversationMessage,
  markAsRead,
  markMessageAsRead,
  getUnreadMessageCount,
  deleteConversation,
} = require("../controllers/conversationController");

const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// Every conversation endpoint requires an authenticated user.
router.use(protect);

// Static routes must be declared before routes containing :id.
router.get("/unread-count", getUnreadMessageCount);
router.get("/unread", getUnreadMessageCount);

// Mark an individual message as read.
router.put("/messages/:messageId/read", markMessageAsRead);
router.patch("/messages/:messageId/read", markMessageAsRead);

// Conversation collection.
router.get("/", getConversations);
router.post("/", createConversation);

// Messages belonging to a conversation. Keep these before /:id routes.
router.get("/:id/messages", getConversationMessages);
router.post("/:id/messages", sendConversationMessage);

// Mark all eligible messages in a conversation as read.
router.put("/:id/read", markAsRead);
router.patch("/:id/read", markAsRead);

// Single-conversation operations.
router.get("/:id", getConversation);
router.put("/:id", updateConversation);
router.patch("/:id", updateConversation);
router.delete("/:id", deleteConversation);

module.exports = router;
