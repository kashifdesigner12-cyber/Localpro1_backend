"use strict";

/**
 * Shared Socket.IO event names for LocalPro1 chat and notifications.
 * Keep existing legacy event names available while migrating clients.
 */
const EVENTS = Object.freeze({
  CONNECTION: "connection",
  DISCONNECT: "disconnect",
  ERROR: "error",

  // Presence
  USER_JOIN: "user_join",
  USER_STATUS_UPDATE: "update_user_status",

  // Conversation rooms
  JOIN_ROOM: "join_room",
  LEAVE_ROOM: "leave_room",

  // Message lifecycle
  MESSAGE_SEND: "message:send",
  MESSAGE_NEW: "message:new",
  MESSAGE_UPDATED: "message:updated",
  MESSAGE_DELETED: "message:deleted",

  // Delivery/read receipts
  MESSAGE_DELIVERED: "message:delivered",
  MESSAGE_READ: "message:read",
  TYPING_START: "typing:start",
  TYPING_STOP: "typing:stop",

  // Notifications
  NOTIFICATION_NEW: "notification:new",
  NOTIFICATION_READ: "notification:read",

  // Optional acknowledgement event name for client-side conventions
  OPERATION_ERROR: "operation:error",
});

module.exports = EVENTS;