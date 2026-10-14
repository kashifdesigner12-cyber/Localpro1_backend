const express = require("express");

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
  deleteMessageForEveryone,
} = require("../controllers/messageController");

const { protect } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Authentication
|--------------------------------------------------------------------------
| Every message route requires authentication.
*/
router.use(protect);

/*
|--------------------------------------------------------------------------
| Unread message count
|--------------------------------------------------------------------------
*/
router.get("/unread-count", getUnreadMessageCount);
router.get("/unread", getUnreadMessageCount);

/*
|--------------------------------------------------------------------------
| Message details
|--------------------------------------------------------------------------
| These static routes must be declared before generic ID routes.
*/
router.get("/single/:id", getMessageById);
router.get("/detail/:id", getMessageById);

/*
|--------------------------------------------------------------------------
| Send message
|--------------------------------------------------------------------------
| Main frontend endpoint:
| POST /api/messages
|
| Legacy-compatible endpoint:
| POST /api/messages/send
|
| Both endpoints use the same controller. The frontend should call
| only one endpoint per send action.
*/
router.post("/", upload.any(), sendMessage);
router.post("/send", upload.any(), sendMessage);

/*
|--------------------------------------------------------------------------
| Mark messages as read
|--------------------------------------------------------------------------
*/
router.put("/read/:conversationId", markMessagesAsRead);
router.patch("/read/:conversationId", markMessagesAsRead);

/*
|--------------------------------------------------------------------------
| Mark one message as read
|--------------------------------------------------------------------------
*/
router.put("/messages/:messageId/read", markSingleMessageAsRead);
router.patch("/messages/:messageId/read", markSingleMessageAsRead);

router.put("/:id/read", markSingleMessageAsRead);
router.patch("/:id/read", markSingleMessageAsRead);

/*
|--------------------------------------------------------------------------
| Delete message for the current user
|--------------------------------------------------------------------------
*/
router.post("/:id/delete-for-me", deleteMessageForMe);
router.patch("/:id/delete-for-me", deleteMessageForMe);
router.delete("/:id/me", deleteMessageForMe);

/*
|--------------------------------------------------------------------------
| Delete message for everyone
|--------------------------------------------------------------------------
*/
router.post("/:id/delete-for-everyone", deleteMessageForEveryone);
router.patch("/:id/delete-for-everyone", deleteMessageForEveryone);
router.delete("/:id/everyone", deleteMessageForEveryone);

/*
|--------------------------------------------------------------------------
| Get messages for a conversation
|--------------------------------------------------------------------------
| GET /api/messages/:conversationId
|
| Note: Message details use /single/:id or /detail/:id because a generic
| /:id route cannot distinguish a message ID from a conversation ID.
*/
router.get("/:conversationId", getMessages);

/*
|--------------------------------------------------------------------------
| Update or delete a message
|--------------------------------------------------------------------------
*/
router.put("/:id", updateMessage);
router.patch("/:id", updateMessage);
router.delete("/:id", deleteMessage);

module.exports = router;