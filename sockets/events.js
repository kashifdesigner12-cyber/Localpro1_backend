
"use strict";

/**
 * Shared Socket.IO event names for LocalPro1 chat and notifications.
 *
 * Keep event names consistent between:
 * - backend/socket handlers
 * - messageController.js
 * - conversationController.js
 * - notificationController.js
 * - frontend socket listeners
 *
 * Legacy event names are preserved for compatibility.
 */
const EVENTS = Object.freeze({
  // Connection lifecycle
  CONNECTION: "connection",
  CONNECT: "connect",
  DISCONNECT: "disconnect",
  ERROR: "error",
  CONNECT_ERROR: "connect_error",

  // Presence
  USER_JOIN: "user_join",
  USER_STATUS_UPDATE: "update_user_status",
  USER_ONLINE: "user:online",
  USER_OFFLINE: "user:offline",
  USER_STATUS_CHANGED: "user:status",

  // Conversation rooms
  JOIN_ROOM: "join_room",
  LEAVE_ROOM: "leave_room",
  CONVERSATION_JOIN: "conversation:join",
  CONVERSATION_LEAVE: "conversation:leave",
  CONVERSATION_UPDATED: "conversation:updated",
  CONVERSATION_DELETED: "conversation:deleted",

  // Message sending and receiving
  MESSAGE_SEND: "message:send",
  MESSAGE_NEW: "message:new",
  MESSAGE_RECEIVE: "receive_message",
  MESSAGE_SENT: "message_sent",
  NEW_MESSAGE: "new_message",

  // Message updates
  MESSAGE_UPDATED: "message:updated",
  MESSAGE_DELETED: "message:deleted",
  MESSAGE_DELETED_FOR_ME: "message:deleted_for_me",
  MESSAGE_DELETED_FOR_EVERYONE: "message:deleted_for_everyone",
  MESSAGE_REACTION: "message:reaction",
  MESSAGE_REACTED: "message:reacted",

  // Delivery and read receipts
  MESSAGE_DELIVERED: "message:delivered",
  MESSAGE_READ: "message:read",
  MESSAGES_READ: "messages:read",
  UNREAD_COUNT_UPDATED: "unread_count_updated",

  // Typing indicators
  TYPING_START: "typing:start",
  TYPING_STOP: "typing:stop",
  USER_TYPING: "user_typing",
  USER_STOPPED_TYPING: "user_stopped_typing",

  // Notifications
  NOTIFICATION_NEW: "notification:new",
  NOTIFICATION_READ: "notification:read",
  NOTIFICATION_UPDATED: "notification:updated",
  NOTIFICATION_DELETED: "notification:deleted",

  // Generic operation feedback
  OPERATION_ERROR: "operation:error",
});

module.exports = EVENTS;
