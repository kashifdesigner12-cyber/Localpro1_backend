const express = require('express');

const {
  getNotifications,
  getUnreadCount,
  getNotificationById,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteReadNotifications,
} = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Every notification endpoint requires an authenticated user.
router.use(protect);

// Static routes must be registered before /:id.
router.get('/unread-count', getUnreadCount);
router.get('/unread', getUnreadCount); // Backward-compatible alias.

router.put('/read-all', markAllAsRead);
router.patch('/read-all', markAllAsRead);
router.put('/mark-all-read', markAllAsRead); // Backward-compatible alias.
router.patch('/mark-all-read', markAllAsRead);

router.delete('/read', deleteReadNotifications);

// Collection and individual notification routes.
router.get('/', getNotifications);
router.get('/:id', getNotificationById);

router.put('/:id/read', markAsRead);
router.patch('/:id/read', markAsRead);

// Backward-compatible endpoint: PATCH /:id marks that notification as read.
// Keep this after the more-specific /:id/read route.
router.patch('/:id', markAsRead);
router.delete('/:id', deleteNotification);

module.exports = router;
