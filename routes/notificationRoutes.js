const express = require('express');

const {
  getNotifications,
  getUnreadCount,
  getNotificationById,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteReadNotifications
} = require('../controllers/notificationController');

const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Apply authentication middleware to all notification routes
router.use(protect);

// ── Static Routes ───────────────────────────────────────────────────────────

// Must be defined before /:id to prevent route shadowing
router.get('/unread-count', getUnreadCount);
router.get('/unread', getUnreadCount);

router.put('/read-all', markAllAsRead);
router.patch('/read-all', markAllAsRead);

router.put('/mark-all-read', markAllAsRead);
router.patch('/mark-all-read', markAllAsRead);

router.delete('/read', deleteReadNotifications);

// ── Notification Routes ────────────────────────────────────────────────────

router.get('/', getNotifications);

router.get('/:id', getNotificationById);

router.put('/:id/read', markAsRead);
router.patch('/:id/read', markAsRead);

// Compatibility route
router.patch('/:id', markAsRead);

router.delete('/:id', deleteNotification);

module.exports = router;