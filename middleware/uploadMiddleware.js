"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const UPLOAD_ROOT = path.resolve(__dirname, "..", "uploads", "chat");
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 5;

const ALLOWED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif",
  ".pdf", ".txt", ".csv",
  ".doc", ".docx", ".xls", ".xlsx",
]);

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/pdf", "text/plain", "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination(req, file, callback) {
    callback(null, UPLOAD_ROOT);
  },
  filename(req, file, callback) {
    const extension = path.extname(file.originalname || "").toLowerCase();
    callback(null, `${Date.now()}-${crypto.randomBytes(16).toString("hex")}${extension}`);
  },
});

function fileFilter(req, file, callback) {
  const extension = path.extname(file.originalname || "").toLowerCase();
  const mimeType = String(file.mimetype || "").toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(extension) || !ALLOWED_MIME_TYPES.has(mimeType)) {
    const error = new Error("Unsupported attachment file type.");
    error.code = "CHAT_FILE_TYPE_NOT_ALLOWED";
    return callback(error);
  }

  return callback(null, true);
}

const uploadChatAttachments = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
    fields: 20,
    parts: MAX_FILES + 20,
  },
});

function handleUploadError(error, req, res, next) {
  if (!error) return next();

  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Attachment exceeds the 10 MB size limit."
      : error.code === "LIMIT_FILE_COUNT"
        ? `A maximum of ${MAX_FILES} attachments is allowed.`
        : "Attachment upload could not be completed.";

    return res.status(400).json({ success: false, message });
  }

  if (error.code === "CHAT_FILE_TYPE_NOT_ALLOWED") {
    return res.status(415).json({ success: false, message: error.message });
  }

  return next(error);
}

module.exports = {
  uploadChatAttachments,
  handleUploadError,
  MAX_FILE_SIZE,
  MAX_FILES,
  UPLOAD_ROOT,
};