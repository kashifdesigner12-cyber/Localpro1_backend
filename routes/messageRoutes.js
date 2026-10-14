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

/*
|--------------------------------------------------------------------------
| Authentication
|--------------------------------------------------------------------------
| All message endpoints require an authenticated user.
*/
router.use(protect);

/*
|--------------------------------------------------------------------------
| Unread count
|--------------------------------------------------------------------------
| Keep static routes before dynamic /:conversationId routes.
*/
router.get('/unread-count', getUnreadMessageCount);
router.get('/unread', getUnreadMessageCount);

/*
|--------------------------------------------------------------------------
| Send message
|--------------------------------------------------------------------------
| Supports text messages and uploaded attachments.
| The controller should emit the Socket.IO event immediately after saving
| the message, without waiting for notifications or email.
*/
router.post('/', upload.any(), sendMessage);
router.post('/send', upload.any(), sendMessage);

/*
|--------------------------------------------------------------------------
| Mark messages as read
|--------------------------------------------------------------------------
*/
router.put('/messages/:messageId/read', markSingleMessageAsRead);
router.patch('/messages/:messageId/read', markSingleMessageAsRead);

router.put('/read/:conversationId', markMessagesAsRead);
router.patch('/read/:conversationId', markMessagesAsRead);

/*
|--------------------------------------------------------------------------
| Single message details
|--------------------------------------------------------------------------
| Explicit paths avoid conflicts with /:conversationId.
*/
router.get('/single/:id', getMessageById);
router.get('/detail/:id', getMessageById);

/*
|--------------------------------------------------------------------------
| Delete message for current user
|--------------------------------------------------------------------------
*/
router.post('/:id/delete-for-me', deleteMessageForMe);
router.patch('/:id/delete-for-me', deleteMessageForMe);
router.delete('/:id/me', deleteMessageForMe);

/*
|--------------------------------------------------------------------------
| Delete message for everyone
|--------------------------------------------------------------------------
*/
router.post('/:id/delete-for-everyone', deleteMessageForEveryone);
router.patch('/:id/delete-for-everyone', deleteMessageForEveryone);
router.delete('/:id/everyone', deleteMessageForEveryone);

/*
|--------------------------------------------------------------------------
| Update message read status
|--------------------------------------------------------------------------
| These routes must come before the generic conversation route.
*/
router.put('/:id/read', markSingleMessageAsRead);
router.patch('/:id/read', markSingleMessageAsRead);

/*
|--------------------------------------------------------------------------
| Get conversation messages
|--------------------------------------------------------------------------
| GET /api/messages/:conversationId
|
| Note: /:conversationId and /:id have the same URL pattern.
| Therefore, a generic GET /:id route cannot independently handle
| getMessageById. Use /single/:id or /detail/:id for message details.
*/
router.get('/:conversationId', getMessages);

/*
|--------------------------------------------------------------------------
| Update and delete a message
|--------------------------------------------------------------------------
*/
router.put('/:id', updateMessage);
router.patch('/:id', updateMessage);
router.delete('/:id', deleteMessage);

module.exports = router;