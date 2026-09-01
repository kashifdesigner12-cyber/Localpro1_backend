const express = require('express');
const {
  getMessages,
  getMessageById,
  sendMessage,
  updateMessage,
  getUnreadMessageCount,
  markMessagesAsRead,
  markSingleMessageAsRead,
  deleteMessage,
  deleteMessageForMe,
  deleteMessageForEveryone
} = require('../controllers/messageController');
const { protect } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

const router = express.Router();

// Apply auth middleware to all message routes
router.use(protect);

// ── Static routes (Must be defined before /:id) ─────────────────────────────
router.get('/unread-count', getUnreadMessageCount);
router.get('/unread', getUnreadMessageCount);

// ── Send message (Supports text JSON + File uploads via multipart) ───────────
router.post('/', upload.array('files', 5), sendMessage);
router.post('/send', upload.array('files', 5), sendMessage);

// ── Read operations ─────────────────────────────────────────────────────────
router.put('/messages/:messageId/read', markSingleMessageAsRead);
router.patch('/messages/:messageId/read', markSingleMessageAsRead);
router.put('/read/:conversationId', markMessagesAsRead);
router.patch('/read/:conversationId', markMessagesAsRead);

// ── Single message detail ───────────────────────────────────────────────────
router.get('/single/:id', getMessageById);
router.get('/detail/:id', getMessageById);

// ── Delete for Me & Delete for Everyone Routes ──────────────────────────────
router.post('/:id/delete-for-me', deleteMessageForMe);
router.patch('/:id/delete-for-me', deleteMessageForMe);
router.delete('/:id/me', deleteMessageForMe);

router.post('/:id/delete-for-everyone', deleteMessageForEveryone);
router.patch('/:id/delete-for-everyone', deleteMessageForEveryone);
router.delete('/:id/everyone', deleteMessageForEveryone);

// ── Messages by Conversation ────────────────────────────────────────────────
router.get('/:conversationId', getMessages);

// ── Single message modification ─────────────────────────────────────────────
router.get('/:id', getMessageById);
router.put('/:id/read', markSingleMessageAsRead);
router.patch('/:id/read', markSingleMessageAsRead);
router.put('/:id', updateMessage);
router.patch('/:id', updateMessage);
router.delete('/:id', deleteMessage);

module.exports = router;