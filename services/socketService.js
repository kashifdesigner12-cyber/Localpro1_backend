"use strict";

const {
  emitToUser,
  emitToConversation,
  hasSocketServer,
} = require("../sockets/socketManager");
const EVENTS = require("../sockets/events");

function emitUserNotification(userId, notification) {
  emitToUser(userId, EVENTS.NOTIFICATION_NEW, notification);
}

function emitNewMessage(conversationId, message) {
  emitToConversation(conversationId, EVENTS.MESSAGE_NEW, message);
}

function emitMessageUpdated(conversationId, message) {
  emitToConversation(conversationId, EVENTS.MESSAGE_UPDATED, message);
}

function emitMessageDeleted(conversationId, payload) {
  emitToConversation(conversationId, EVENTS.MESSAGE_DELETED, payload);
}

function emitTyping(conversationId, payload, isTyping = true) {
  emitToConversation(
    conversationId,
    isTyping ? EVENTS.TYPING_START : EVENTS.TYPING_STOP,
    payload
  );
}

function emitReadReceipt(conversationId, payload) {
  emitToConversation(conversationId, EVENTS.MESSAGE_READ, payload);
}

function emitDeliveryReceipt(conversationId, payload) {
  emitToConversation(conversationId, EVENTS.MESSAGE_DELIVERED, payload);
}

module.exports = {
  hasSocketServer,
  emitUserNotification,
  emitNewMessage,
  emitMessageUpdated,
  emitMessageDeleted,
  emitTyping,
  emitReadReceipt,
  emitDeliveryReceipt,
};