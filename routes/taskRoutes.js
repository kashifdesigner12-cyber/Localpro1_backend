const express = require('express');
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
  deleteComment
} = require('../controllers/taskController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Apply auth middleware to all task routes
router.use(protect);

// ── Static routes (Must be defined before /:id) ─────────────────────────────
router.get('/my', getMyTasks);
router.get('/stats', getTaskStats);

// ── Main Task Routes ────────────────────────────────────────────────────────
router.get('/', getAllTasks);
router.post('/', createTask);

// ── Task Comments ───────────────────────────────────────────────────────────
router.get('/:id/comments', getComments);
router.post('/:id/comments', addComment);
router.delete('/:id/comments/:commentId', deleteComment);

// ── Single Task Item ────────────────────────────────────────────────────────
router.get('/:id', getTaskById);
router.put('/:id', updateTask);
router.patch('/:id', updateTask);
router.patch('/:id/status', updateTask);
router.put('/:id/status', updateTask);
router.patch('/:id/priority', updateTask);
router.put('/:id/priority', updateTask);
router.patch('/:id/assign', updateTask);
router.put('/:id/assign', updateTask);
router.delete('/:id', deleteTask);

module.exports = router;