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

// Existing Multer middleware
const upload = require("../middleware/uploadMiddleware");

const router = express.Router();

// ============================================================================
// FALLBACK HANDLERS
// ============================================================================

const handleAttachmentDelete =
  deleteTaskAttachment || removeAttachment;

const handleAttachmentUpload =
  uploadTaskAttachment || updateTask;

// ============================================================================
// AUTHENTICATION
// ============================================================================

// Apply authentication to all task routes
router.use(protect);

// ============================================================================
// STATIC TASK ROUTES
// IMPORTANT: These routes must come before /:id
// ============================================================================

// GET /api/tasks/my
router.get("/my", getMyTasks);

// GET /api/tasks/stats
router.get("/stats", getTaskStats);

// ============================================================================
// MAIN TASK ROUTES
// ============================================================================

// GET /api/tasks
router.get("/", getAllTasks);

// ============================================================================
// CREATE TASK
// POST /api/tasks
//
// Supports:
// - normal task creation
// - file
// - files
// - attachments
// ============================================================================

router.post(
  "/",
  upload.fields([
    {
      name: "file",
      maxCount: 1,
    },
    {
      name: "files",
      maxCount: 10,
    },
    {
      name: "attachments",
      maxCount: 10,
    },
  ]),
  createTask
);

// ============================================================================
// TASK ATTACHMENTS
// ============================================================================

// POST /api/tasks/:id/attachments
//
// Upload attachment to an existing task
router.post(
  "/:id/attachments",
  upload.fields([
    {
      name: "file",
      maxCount: 1,
    },
    {
      name: "files",
      maxCount: 10,
    },
    {
      name: "attachments",
      maxCount: 10,
    },
  ]),
  handleAttachmentUpload
);

// DELETE /api/tasks/:id/attachments/:attachmentId
router.delete(
  "/:id/attachments/:attachmentId",
  handleAttachmentDelete
);

// ============================================================================
// TASK COMMENTS
// ============================================================================

// GET /api/tasks/:id/comments
router.get(
  "/:id/comments",
  getComments
);

// POST /api/tasks/:id/comments
router.post(
  "/:id/comments",
  addComment
);

// DELETE /api/tasks/:id/comments/:commentId
router.delete(
  "/:id/comments/:commentId",
  deleteComment
);

// ============================================================================
// SINGLE TASK
// ============================================================================

// GET /api/tasks/:id
router.get(
  "/:id",
  getTaskById
);

// ============================================================================
// UPDATE TASK
// Supports file attachments
// ============================================================================

// PUT /api/tasks/:id
router.put(
  "/:id",
  upload.fields([
    {
      name: "file",
      maxCount: 1,
    },
    {
      name: "files",
      maxCount: 10,
    },
    {
      name: "attachments",
      maxCount: 10,
    },
  ]),
  updateTask
);

// PATCH /api/tasks/:id
router.patch(
  "/:id",
  upload.fields([
    {
      name: "file",
      maxCount: 1,
    },
    {
      name: "files",
      maxCount: 10,
    },
    {
      name: "attachments",
      maxCount: 10,
    },
  ]),
  updateTask
);

// ============================================================================
// TASK STATUS
// ============================================================================

// PATCH /api/tasks/:id/status
router.patch(
  "/:id/status",
  updateTask
);

// PUT /api/tasks/:id/status
router.put(
  "/:id/status",
  updateTask
);

// ============================================================================
// TASK PRIORITY
// ============================================================================

// PATCH /api/tasks/:id/priority
router.patch(
  "/:id/priority",
  updateTask
);

// PUT /api/tasks/:id/priority
router.put(
  "/:id/priority",
  updateTask
);

// ============================================================================
// TASK ASSIGNMENT
// ============================================================================

// PATCH /api/tasks/:id/assign
router.patch(
  "/:id/assign",
  updateTask
);

// PUT /api/tasks/:id/assign
router.put(
  "/:id/assign",
  updateTask
);

// ============================================================================
// DELETE TASK
// ============================================================================

// DELETE /api/tasks/:id
router.delete(
  "/:id",
  deleteTask
);

// ============================================================================
// EXPORT
// ============================================================================

module.exports = router;

