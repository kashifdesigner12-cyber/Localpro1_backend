"use strict";

const express = require("express");

const {
  getMessages,
  getMessageById,
  sendMessage,
  updateMessage,
  getUnreadMessageCount,
  markMessagesAsRead,
  markSingleMessageAsRead,
  deleteMessage,
  deleteMessageForMe,
  deleteMessageForEveryone,
  reactToMessage,
} = require("../controllers/messageController");

const { protect } = require("../middleware/authMiddleware");

const {
  uploadChatAttachments,
  handleUploadError,
} = require("../middleware/uploadMiddleware");

const router = express.Router();

// All message routes require authentication.
router.use(protect);

// Unread message count.
router.get("/unread-count", getUnreadMessageCount);
router.get("/unread", getUnreadMessageCount);

// Message details.
router.get("/single/:id", getMessageById);
router.get("/detail/:id", getMessageById);

// Send messages and attachments.
// Role and conversation permissions are enforced in messageController.
router.post(
  "/",
  uploadChatAttachments.any(),
  handleUploadError,
  sendMessage
);

router.post(
  "/send",
  uploadChatAttachments.any(),
  handleUploadError,
  sendMessage
);

// Mark conversation messages as read.
router.put("/read/:conversationId", markMessagesAsRead);
router.patch("/read/:conversationId", markMessagesAsRead);

// Mark individual messages as read.
router.put("/messages/:messageId/read", markSingleMessageAsRead);
router.patch("/messages/:messageId/read", markSingleMessageAsRead);
router.put("/:id/read", markSingleMessageAsRead);
router.patch("/:id/read", markSingleMessageAsRead);

// Message reactions.
router.post("/:id/reactions", reactToMessage);

// Delete a message for the current user.
router.post("/:id/delete-for-me", deleteMessageForMe);
router.patch("/:id/delete-for-me", deleteMessageForMe);
router.delete("/:id/me", deleteMessageForMe);

// Delete a message for everyone.
router.post("/:id/delete-for-everyone", deleteMessageForEveryone);
router.patch("/:id/delete-for-everyone", deleteMessageForEveryone);
router.delete("/:id/everyone", deleteMessageForEveryone);

// Fetch conversation messages.
router.get("/", getMessages);
router.get("/:conversationId", getMessages);

// Update or delete an individual message.
router.put("/:id", updateMessage);
router.patch("/:id", updateMessage);
router.delete("/:id", deleteMessage);

module.exports = router;