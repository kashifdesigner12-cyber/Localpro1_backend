import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

import {
  getChatBootstrap,
  getConversations,
  getOrCreateConversation,
  createGroupConversation,
  getGroupMembers,
  removeGroupMember,
  deleteGroupConversation,
  getMessages,
  markConversationAsRead,
  sendMessage,
  editMessage,
  toggleReaction,
  togglePinMessage,
  forwardMessage,
  deleteMessage,
  deleteConversation,
  downloadAttachment,
} from "../controllers/chatController.js";

import { protect } from "../middleware/authMiddleware.js";

// ----------------------------------------------------
// CHAT UPLOAD DIRECTORY
// ----------------------------------------------------

const uploadDir = path.resolve(process.cwd(), "uploads", "chat");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ----------------------------------------------------
// MULTER STORAGE
// ----------------------------------------------------

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path
      .extname(file.originalname || "")
      .toLowerCase()
      .slice(0, 20);
    const filename = `chat-${Date.now()}-${randomUUID()}${ext}`;
    cb(null, filename);
  },
});

// ----------------------------------------------------
// UPLOAD CONFIGURATION (Up to 25MB per file)
// ----------------------------------------------------

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 10,
  },
});

const chatUploadFields = upload.fields([
  { name: "attachments", maxCount: 10 },
  { name: "attachment", maxCount: 10 },
  { name: "files", maxCount: 10 },
]);

// ----------------------------------------------------
// UPLOAD ERROR HANDLER
// ----------------------------------------------------

const handleChatUpload = (req, res, next) => {
  chatUploadFields(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error instanceof multer.MulterError) {
      let message = "Chat attachment upload failed.";

      if (error.code === "LIMIT_FILE_SIZE") {
        message = "File size cannot exceed 25 MB.";
      }

      if (
        error.code === "LIMIT_FILE_COUNT" ||
        error.code === "LIMIT_UNEXPECTED_FILE"
      ) {
        message = "Maximum 10 attachments are allowed per message.";
      }

      return res.status(400).json({
        success: false,
        message,
        code: error.code,
      });
    }

    console.error("[CHAT UPLOAD ERROR]", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to upload chat attachments.",
    });
  });
};

// ----------------------------------------------------
// ROUTER
// ----------------------------------------------------

const router = Router();

// All chat endpoints require authentication
router.use(protect);

// ----------------------------------------------------
// 1. BOOTSTRAP & CORE ENDPOINTS
// ----------------------------------------------------

router.get("/bootstrap", getChatBootstrap);

router.get("/conversations", getConversations);
router.post("/conversations", getOrCreateConversation);
router.post("/groups", createGroupConversation);
router.get("/groups/:conversationId/members", getGroupMembers);
router.put("/groups/:conversationId/members/remove", removeGroupMember);
router.delete("/groups/:conversationId", deleteGroupConversation);

// ----------------------------------------------------
// 2. ATTACHMENT DOWNLOAD
// ----------------------------------------------------

router.get(
  "/attachments/:messageId/:attachmentIndex/download",
  downloadAttachment
);

// ----------------------------------------------------
// 3. SEND MESSAGE
// ----------------------------------------------------

router.post("/messages", handleChatUpload, sendMessage);

// ----------------------------------------------------
// 4. MESSAGE LEVEL ACTIONS
// ----------------------------------------------------

router.put("/messages/:messageId", editMessage);
router.post("/messages/:messageId/reactions", toggleReaction);
router.post("/messages/:messageId/pin", togglePinMessage);
router.post("/messages/:messageId/forward", forwardMessage);
router.delete("/messages/:messageId", deleteMessage);

// ----------------------------------------------------
// 5. CONVERSATION SPECIFIC ACTIONS
// ----------------------------------------------------

router.get("/:conversationId/messages", getMessages);
router.post("/:conversationId/read", markConversationAsRead);
router.delete("/:conversationId", deleteConversation);

export default router;
