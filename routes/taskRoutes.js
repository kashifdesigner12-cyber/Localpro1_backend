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
const upload = require("../middleware/uploadMiddleware");

const router = express.Router();

// Fallback handlers
const handleAttachmentDelete =
  deleteTaskAttachment || removeAttachment;

const handleAttachmentUpload =
  uploadTaskAttachment || updateTask;

// Authentication applied to all routes
router.use(protect);

// ============================================================================
// STATIC TASK ROUTES (Must come before /:id)
// ============================================================================

router.get("/my", getMyTasks);
router.get("/stats", getTaskStats);

// ============================================================================
// MAIN TASK ROUTES
// ============================================================================

router.get("/", getAllTasks);

router.post(
  "/",
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "files", maxCount: 10 },
    { name: "attachments", maxCount: 10 },
  ]),
  createTask
);

// ============================================================================
// TASK ATTACHMENTS
// ============================================================================

router.post(
  "/:id/attachments",
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "files", maxCount: 10 },
    { name: "attachments", maxCount: 10 },
  ]),
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

router.put(
  "/:id",
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "files", maxCount: 10 },
    { name: "attachments", maxCount: 10 },
  ]),
  updateTask
);

router.patch(
  "/:id",
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "files", maxCount: 10 },
    { name: "attachments", maxCount: 10 },
  ]),
  updateTask
);

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