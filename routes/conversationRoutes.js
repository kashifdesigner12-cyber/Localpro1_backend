const express = require("express");

const {
  getConversations,
  getConversation,
  createConversation,
  updateConversation,
  getConversationMessages,
  sendConversationMessage,
  markAsRead,
  markMessageAsRead,
  getUnreadMessageCount,
  deleteConversation,
} = require("../controllers/conversationController");

const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

/*
|--------------------------------------------------------------------------
| AUTHENTICATION
|--------------------------------------------------------------------------
| Every conversation route requires a logged-in user.
*/
router.use(protect);

/*
|--------------------------------------------------------------------------
| STATIC ROUTES
|--------------------------------------------------------------------------
| Keep these BEFORE /:id routes.
|--------------------------------------------------------------------------
*/

/*
 * GET /api/conversations/unread-count
 */
router.get(
  "/unread-count",
  getUnreadMessageCount
);

/*
 * GET /api/conversations/unread
 */
router.get(
  "/unread",
  getUnreadMessageCount
);

/*
|--------------------------------------------------------------------------
| MESSAGE READ ROUTES
|--------------------------------------------------------------------------
*/

/*
 * PUT /api/conversations/messages/:messageId/read
 */
router.put(
  "/messages/:messageId/read",
  markMessageAsRead
);

/*
 * PATCH /api/conversations/messages/:messageId/read
 */
router.patch(
  "/messages/:messageId/read",
  markMessageAsRead
);

/*
|--------------------------------------------------------------------------
| CONVERSATION COLLECTION
|--------------------------------------------------------------------------
*/

/*
 * GET /api/conversations
 *
 * Returns conversations available to the
 * authenticated user.
 *
 * Manager/admin logic for showing all users
 * is handled inside conversationController.
 */
router.get(
  "/",
  getConversations
);

/*
 * POST /api/conversations
 *
 * Start a conversation with another user.
 *
 * Body:
 * {
 *   "recipientId": "USER_ID"
 * }
 */
router.post(
  "/",
  createConversation
);

/*
|--------------------------------------------------------------------------
| COMPATIBILITY SEND ROUTE
|--------------------------------------------------------------------------
| Your current frontend uses:
|
| POST /api/messages/send
|
| The primary conversation API is:
|
| POST /api/conversations/:id/messages
|
| Keep the actual compatibility route in the
| messages router if one exists.
|
| DO NOT add /messages/send here because this
| router is mounted at /api/conversations.
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| CONVERSATION MESSAGES
|--------------------------------------------------------------------------
*/

/*
 * GET /api/conversations/:id/messages
 */
router.get(
  "/:id/messages",
  getConversationMessages
);

/*
 * POST /api/conversations/:id/messages
 */
router.post(
  "/:id/messages",
  sendConversationMessage
);

/*
|--------------------------------------------------------------------------
| MARK CONVERSATION AS READ
|--------------------------------------------------------------------------
*/

/*
 * PUT /api/conversations/:id/read
 */
router.put(
  "/:id/read",
  markAsRead
);

/*
 * PATCH /api/conversations/:id/read
 */
router.patch(
  "/:id/read",
  markAsRead
);

/*
|--------------------------------------------------------------------------
| SINGLE CONVERSATION
|--------------------------------------------------------------------------
*/

/*
 * GET /api/conversations/:id
 */
router.get(
  "/:id",
  getConversation
);

/*
 * PUT /api/conversations/:id
 */
router.put(
  "/:id",
  updateConversation
);

/*
 * PATCH /api/conversations/:id
 */
router.patch(
  "/:id",
  updateConversation
);

/*
 * DELETE /api/conversations/:id
 */
router.delete(
  "/:id",
  deleteConversation
);

module.exports = router;