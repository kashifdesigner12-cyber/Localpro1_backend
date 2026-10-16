
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

// All notification routes require authentication.
router.use(protect);

// Static routes must be registered before /:id.
router.get('/unread-count', getUnreadCount);
router.get('/unread', getUnreadCount);

// Mark all notifications as read.
router.put('/read-all', markAllAsRead);
router.patch('/read-all', markAllAsRead);

// Backward-compatible aliases.
router.put('/mark-all-read', markAllAsRead);
router.patch('/mark-all-read', markAllAsRead);

// Delete all read notifications.
router.delete('/read', deleteReadNotifications);

// Get the current user's notification list.
router.get('/', getNotifications);

// Read or update an individual notification.
router.get('/:id', getNotificationById);
router.put('/:id/read', markAsRead);
router.patch('/:id/read', markAsRead);

// Backward-compatible endpoint: PATCH /:id marks it as read.
// Keep this after the more-specific /:id/read routes.
router.patch('/:id', markAsRead);

// Delete an individual notification.
router.delete('/:id', deleteNotification);

module.exports = router;
