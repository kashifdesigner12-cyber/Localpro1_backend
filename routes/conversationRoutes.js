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
const { upload } = require("../middleware/uploadMiddleware");

const router = express.Router();

// Every conversation endpoint requires an authenticated user.
router.use(protect);

// Static routes must be registered before the generic /:id routes.
router.get("/unread-count", getUnreadMessageCount);
router.get("/unread", getUnreadMessageCount); // Legacy compatibility alias.

// Mark one message as read.
router.put("/messages/:messageId/read", markMessageAsRead);
router.patch("/messages/:messageId/read", markMessageAsRead); // Compatibility alias.

// Conversation collection.
router.get("/", getConversations);
router.post("/", createConversation);

// Messages belonging to a conversation. Parse multipart requests so text and
// uploaded attachments are available to sendConversationMessage in req.body/files.
router.get("/:id/messages", getConversationMessages);
router.post("/:id/messages", upload.any(), sendConversationMessage);

// Mark unread messages in a conversation as read.
router.put("/:id/read", markAsRead);
router.patch("/:id/read", markAsRead); // Compatibility alias.

// Single-conversation operations.
router.get("/:id", getConversation);
router.put("/:id", updateConversation);
router.patch("/:id", updateConversation);
router.delete("/:id", deleteConversation);

module.exports = router;