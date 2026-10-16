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

router.use(protect);

// Unread counts
router.get("/unread-count", getUnreadMessageCount);
router.get("/unread", getUnreadMessageCount);

// Read individual messages
router.put("/messages/:messageId/read", markMessageAsRead);
router.patch("/messages/:messageId/read", markMessageAsRead);

// Conversation collection
router.get("/", getConversations);
router.post("/", createConversation);

// Conversation messages
router.get("/:id/messages", getConversationMessages);
router.post("/:id/messages", sendConversationMessage);

// Mark conversation messages as read
router.put("/:id/read", markAsRead);
router.patch("/:id/read", markAsRead);

// Single conversation
router.get("/:id", getConversation);
router.put("/:id", updateConversation);
router.patch("/:id", updateConversation);
router.delete("/:id", deleteConversation);

module.exports = router;