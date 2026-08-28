const express = require('express');
const {
  getEmails,
  getEmail,
  sendEmail,
  markAsRead,
  deleteEmail,
  getEmailStats,
  getEmailThread
} = require('../controllers/emailController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

// ── Static routes (Must be defined before /:id) ─────────────────────────────
router.get('/stats', getEmailStats);
router.post('/send', sendEmail);
router.get('/thread/:conversationId', getEmailThread);

// ── Collection routes ───────────────────────────────────────────────────────
router.get('/', getEmails);
router.post('/', sendEmail);

// ── Single email routes ─────────────────────────────────────────────────────
router.get('/:id', getEmail);
router.put('/:id/read', markAsRead);
router.patch('/:id/read', markAsRead);
router.delete('/:id', deleteEmail);

module.exports = router;