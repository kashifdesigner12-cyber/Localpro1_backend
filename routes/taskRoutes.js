"use strict";

const express = require("express");

const {
  createTask,
  getAllTasks,
  getMyTasks,
  getTaskById,
  updateTask,
  deleteTask,
  getTaskStats,
  addComment,
  getComments,
  deleteComment,
  uploadTaskAttachment,
  deleteTaskAttachment,
  removeAttachment,
} = require("../controllers/taskController");

const { protect } = require("../middleware/authMiddleware");

const {
  uploadTaskAttachments,
  handleUploadError,
} = require("../middleware/uploadMiddleware");

const router = express.Router();

// Fallback handlers
const handleAttachmentDelete =
  deleteTaskAttachment || removeAttachment;

const handleAttachmentUpload =
  uploadTaskAttachment || updateTask;

// Authentication applied to all routes
router.use(protect);

// Task uploads use a separate Multer instance and uploads/tasks directory.
const taskUploadFields = uploadTaskAttachments.fields([
  { name: "file", maxCount: 1 },
  { name: "files", maxCount: 10 },
  { name: "attachments", maxCount: 10 },
]);

const taskUpload = [taskUploadFields, handleUploadError];

// ============================================================================
// STATIC TASK ROUTES (Must come before /:id)
// ============================================================================

router.get("/my", getMyTasks);
router.get("/stats", getTaskStats);

// ============================================================================
// MAIN TASK ROUTES
// ============================================================================

router.get("/", getAllTasks);

router.post("/", ...taskUpload, createTask);

// ============================================================================
// TASK ATTACHMENTS
// ============================================================================

router.post(
  "/:id/attachments",
  ...taskUpload,
  handleAttachmentUpload
);

router.delete(
  "/:id/attachments/:attachmentId",
  handleAttachmentDelete
);

// ============================================================================
// TASK COMMENTS
// ============================================================================

router.get("/:id/comments", getComments);
router.post("/:id/comments", addComment);
router.delete("/:id/comments/:commentId", deleteComment);

// ============================================================================
// SINGLE TASK
// ============================================================================

router.get("/:id", getTaskById);

// ============================================================================
// UPDATE TASK
// ============================================================================

router.put("/:id", ...taskUpload, updateTask);

router.patch("/:id", ...taskUpload, updateTask);

router.patch("/:id/status", updateTask);
router.put("/:id/status", updateTask);

router.patch("/:id/priority", updateTask);
router.put("/:id/priority", updateTask);

router.patch("/:id/assign", updateTask);
router.put("/:id/assign", updateTask);

// ============================================================================
// DELETE TASK
// ============================================================================

router.delete("/:id", deleteTask);

module.exports = router;