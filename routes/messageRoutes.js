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

/**
 * Every message endpoint requires an authenticated user.
 * Socket.IO handles real-time text delivery; these REST routes remain
 * available for history, uploads, read status, reactions, and deletions.
 */
router.use(protect);

/**
 * Keep static/specific routes before generic routes such as "/:id"
 * and "/:conversationId" so Express does not match them prematurely.
 */

// Unread message count (current route and legacy alias).
router.get("/unread-count", getUnreadMessageCount);
router.get("/unread", getUnreadMessageCount);

// Fetch a single message (current route and compatibility alias).
router.get("/single/:id", getMessageById);
router.get("/detail/:id", getMessageById);

// Send messages and uploaded attachments.
// Both paths are kept for compatibility; clients should call only one per send.
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

// Mark all unread messages in a conversation as read.
router.put("/read/:conversationId", markMessagesAsRead);
router.patch("/read/:conversationId", markMessagesAsRead);

// Mark one message as read (supported aliases).
router.put("/messages/:messageId/read", markSingleMessageAsRead);
router.patch("/messages/:messageId/read", markSingleMessageAsRead);
router.put("/:id/read", markSingleMessageAsRead);
router.patch("/:id/read", markSingleMessageAsRead);

// Message reactions.
router.post("/:id/reactions", reactToMessage);

// Delete a message only for the current user.
router.post("/:id/delete-for-me", deleteMessageForMe);
router.patch("/:id/delete-for-me", deleteMessageForMe);
router.delete("/:id/me", deleteMessageForMe);

// Delete a message for everyone.
router.post("/:id/delete-for-everyone", deleteMessageForEveryone);
router.patch("/:id/delete-for-everyone", deleteMessageForEveryone);
router.delete("/:id/everyone", deleteMessageForEveryone);

// Conversation message history.
// Supports both query-based lookup (GET /?conversationId=...) and
// path-based lookup (GET /:conversationId).
router.get("/", getMessages);
router.get("/:conversationId", getMessages);

// Update or permanently delete an individual message.
// Keep these generic ID routes last.
router.put("/:id", updateMessage);
router.patch("/:id", updateMessage);
router.delete("/:id", deleteMessage);

module.exports = router;