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
const upload = require("../middleware/uploadMiddleware");

const router = express.Router();

// All message endpoints require authentication.
router.use(protect);

// Static routes must be declared before generic ID routes.
router.get("/unread-count", getUnreadMessageCount);
router.get("/unread", getUnreadMessageCount);
router.get("/single/:id", getMessageById);
router.get("/detail/:id", getMessageById);

// Send endpoints kept for current and legacy frontend compatibility.
// The client should call only one endpoint for each send action.
router.post("/", upload.any(), sendMessage);
router.post("/send", upload.any(), sendMessage);

// Mark all unread messages in a conversation as read.
router.put("/read/:conversationId", markMessagesAsRead);
router.patch("/read/:conversationId", markMessagesAsRead);

// Mark an individual message as read.
router.put("/messages/:messageId/read", markSingleMessageAsRead);
router.patch("/messages/:messageId/read", markSingleMessageAsRead);
router.put("/:id/read", markSingleMessageAsRead);
router.patch("/:id/read", markSingleMessageAsRead);

// Add or update a reaction; expected body: { emoji: "👍" }.
router.post("/:id/reactions", reactToMessage);

// Delete a message only for the authenticated user.
router.post("/:id/delete-for-me", deleteMessageForMe);
router.patch("/:id/delete-for-me", deleteMessageForMe);
router.delete("/:id/me", deleteMessageForMe);

// Delete a message for all participants.
router.post("/:id/delete-for-everyone", deleteMessageForEveryone);
router.patch("/:id/delete-for-everyone", deleteMessageForEveryone);
router.delete("/:id/everyone", deleteMessageForEveryone);

// Fetch messages for a conversation. Message detail routes use explicit
// /single/:id or /detail/:id paths to avoid ambiguity with conversation IDs.
router.get("/:conversationId", getMessages);

// Update or delete an individual message.
router.put("/:id", updateMessage);
router.patch("/:id", updateMessage);
router.delete("/:id", deleteMessage);

module.exports = router;
