
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const uploadDir = path.resolve("uploads", "tasks");

fs.mkdirSync(uploadDir, { recursive: true });

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const allowedExtensions = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".txt",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".zip",
]);

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },

  filename(req, file, cb) {
    const extension = path.extname(file.originalname).toLowerCase();

    // Generate a unique filename; never use the supplied filename as a path.
    cb(null, `${crypto.randomUUID()}${extension}`);
  },
});

const fileFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname || "").toLowerCase();

  if (!allowedExtensions.has(extension)) {
    return cb(
      new multer.MulterError(
        "LIMIT_UNEXPECTED_FILE",
        "Only PDF, Office documents, CSV, TXT, images, and ZIP files are allowed."
      )
    );
  }

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
    fields: 30,
    fieldSize: 1 * 1024 * 1024,
  },
});

export default upload;
