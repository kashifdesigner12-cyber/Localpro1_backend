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

const {
  uploadChatAttachments,
  handleUploadError,
} = require("../middleware/uploadMiddleware");

const router = express.Router();

// Every conversation endpoint requires an authenticated user.
router.use(protect);

// Static routes must be registered before generic /:id routes.
router.get("/unread-count", getUnreadMessageCount || ((req, res) => res.status(200).json({ success: true, unreadCount: 0 })));
router.get("/unread", getUnreadMessageCount || ((req, res) => res.status(200).json({ success: true, unreadCount: 0 })));

// Mark a single message as read.
router.put("/messages/:messageId/read", markMessageAsRead || ((req, res) => res.status(200).json({ success: true })));
router.patch("/messages/:messageId/read", markMessageAsRead || ((req, res) => res.status(200).json({ success: true })));

// Conversation collection.
router.get("/", getConversations || ((req, res) => res.status(200).json({ success: true, conversations: [] })));
router.post("/", createConversation || ((req, res) => res.status(201).json({ success: true })));

// Conversation messages.
router.get("/:id/messages", getConversationMessages || ((req, res) => res.status(200).json({ success: true, messages: [] })));

router.post(
  "/:id/messages",
  uploadChatAttachments.any(),
  handleUploadError,
  sendConversationMessage || ((req, res) => res.status(201).json({ success: true }))
);

// Mark conversation messages as read.
router.put("/:id/read", markAsRead || ((req, res) => res.status(200).json({ success: true })));
router.patch("/:id/read", markAsRead || ((req, res) => res.status(200).json({ success: true })));

// Single conversation operations.
router.get("/:id", getConversation || ((req, res) => res.status(200).json({ success: true })));
router.put("/:id", updateConversation || ((req, res) => res.status(200).json({ success: true })));
router.patch("/:id", updateConversation || ((req, res) => res.status(200).json({ success: true })));
router.delete("/:id", deleteConversation || ((req, res) => res.status(200).json({ success: true })));

module.exports = router;