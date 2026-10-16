"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const UPLOAD_BASE = path.resolve(__dirname, "..", "uploads");
const UPLOAD_ROOT = path.join(UPLOAD_BASE, "chat");
const TASK_UPLOAD_ROOT = path.join(UPLOAD_BASE, "tasks");

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file
const MAX_FILES = 20; // Keep chat upload limit aligned with messageController
const MAX_TASK_FILES = 21; // task fields allow 1 file + 10 files + 10 attachments

const ALLOWED_EXTENSIONS = new Set([
  // Images
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",

  // Video
  ".mp4",
  ".webm",
  ".mov",
  ".ogv",

  // Audio
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".aac",

  // Documents and common files
  ".pdf",
  ".txt",
  ".csv",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
]);

const ALLOWED_MIME_TYPES = new Set([
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",

  // Video
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/ogg",

  // Audio
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
  "audio/aac",
  "audio/aacp",

  // Documents and common files
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

// Create both upload directories before Multer receives files.
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
fs.mkdirSync(TASK_UPLOAD_ROOT, { recursive: true });

function createStorage(destinationRoot) {
  return multer.diskStorage({
    destination(req, file, callback) {
      callback(null, destinationRoot);
    },

    filename(req, file, callback) {
      // Never use the user-supplied filename as the stored filename.
      const extension = path.extname(file.originalname || "").toLowerCase();
      const safeName = `${Date.now()}-${crypto.randomBytes(16).toString("hex")}${extension}`;
      callback(null, safeName);
    },
  });
}

function createFileFilter(codePrefix) {
  return function fileFilter(req, file, callback) {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const mimeType = String(file.mimetype || "").toLowerCase();

    if (
      !ALLOWED_EXTENSIONS.has(extension) ||
      !ALLOWED_MIME_TYPES.has(mimeType)
    ) {
      const error = new Error("Unsupported attachment file type.");
      error.code = `${codePrefix}_FILE_TYPE_NOT_ALLOWED`;
      return callback(error);
    }

    return callback(null, true);
  };
}

// Chat uploads are stored in uploads/chat.
// Supports up to 20 files per request, with a 10 MB per-file limit.
const uploadChatAttachments = multer({
  storage: createStorage(UPLOAD_ROOT),
  fileFilter: createFileFilter("CHAT"),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
    fields: 20,
    parts: MAX_FILES + 20,
  },
});

// Task uploads are stored separately in uploads/tasks.
// taskRoutes.js should use uploadTaskAttachments.fields([...]) for task routes.
const uploadTaskAttachments = multer({
  storage: createStorage(TASK_UPLOAD_ROOT),
  fileFilter: createFileFilter("TASK"),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_TASK_FILES,
    fields: 30,
    parts: MAX_TASK_FILES + 30,
  },
});

function handleUploadError(error, req, res, next) {
  if (!error) return next();

  if (error instanceof multer.MulterError) {
    let message = "Attachment upload could not be completed.";

    if (error.code === "LIMIT_FILE_SIZE") {
      message = "Attachment exceeds the 10 MB size limit.";
    } else if (error.code === "LIMIT_FILE_COUNT") {
      message = `Too many attachments were uploaded. Chat uploads allow up to ${MAX_FILES} files; task upload limits are controlled by the task route fields.`;
    } else if (error.code === "LIMIT_UNEXPECTED_FILE") {
      message =
        "An unexpected file field was submitted, or that field contains too many files.";
    } else if (error.code === "LIMIT_FIELD_COUNT") {
      message = "Too many form fields were submitted.";
    } else if (error.code === "LIMIT_PART_COUNT") {
      message = "Too many multipart form parts were submitted.";
    }

    return res.status(400).json({
      success: false,
      message,
      code: error.code,
    });
  }

  if (
    error.code === "CHAT_FILE_TYPE_NOT_ALLOWED" ||
    error.code === "TASK_FILE_TYPE_NOT_ALLOWED"
  ) {
    return res.status(415).json({
      success: false,
      message: error.message,
      code: error.code,
    });
  }

  return next(error);
}

module.exports = {
  uploadChatAttachments,
  uploadTaskAttachments,
  handleUploadError,
  MAX_FILE_SIZE,
  MAX_FILES,
  MAX_TASK_FILES,
  UPLOAD_ROOT,
  TASK_UPLOAD_ROOT,
};