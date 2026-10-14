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

// All conversation routes require authentication.
router.use(protect);

// --------------------------------------------------
// STATIC ROUTES — MUST COME BEFORE /:id
// --------------------------------------------------

router.get("/unread-count", getUnreadMessageCount);
router.get("/unread", getUnreadMessageCount);

// --------------------------------------------------
// MESSAGE READ ROUTES
// --------------------------------------------------

router.put(
  "/messages/:messageId/read",
  markMessageAsRead
);

router.patch(
  "/messages/:messageId/read",
  markMessageAsRead
);

// --------------------------------------------------
// CONVERSATION COLLECTION
// --------------------------------------------------

// GET /api/conversations
router.get("/", getConversations);

// POST /api/conversations
// Body: { recipientId: "USER_ID" }
// Use isGroup: true only when intentionally creating a group.
router.post("/", createConversation);

// --------------------------------------------------
// CONVERSATION MESSAGES
// Keep these before the single-conversation /:id routes.
// --------------------------------------------------

// GET /api/conversations/:id/messages
router.get("/:id/messages", getConversationMessages);

// POST /api/conversations/:id/messages
router.post("/:id/messages", sendConversationMessage);

// --------------------------------------------------
// CONVERSATION READ STATUS
// --------------------------------------------------

router.put("/:id/read", markAsRead);
router.patch("/:id/read", markAsRead);

// --------------------------------------------------
// SINGLE CONVERSATION
// --------------------------------------------------

router.get("/:id", getConversation);

router.put("/:id", updateConversation);
router.patch("/:id", updateConversation);

router.delete("/:id", deleteConversation);

module.exports = router;