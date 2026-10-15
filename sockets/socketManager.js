"use strict";

let ioInstance = null;

function isSocketServer(value) {
  return Boolean(
    value &&
    typeof value.to === "function" &&
    typeof value.emit === "function" &&
    typeof value.on === "function" &&
    typeof value.use === "function"
  );
}

/**
 * Register the application's Socket.IO server once during startup.
 * Example: setSocketServer(io)
 */
function setSocketServer(io) {
  if (!isSocketServer(io)) {
    throw new TypeError("A valid Socket.IO server instance is required.");
  }

  if (ioInstance && ioInstance !== io) {
    throw new Error("Socket.IO server has already been initialized.");
  }

  ioInstance = io;
  return ioInstance;
}

/**
 * Return the configured Socket.IO instance.
 * Throws a clear error if called before startup has registered it.
 */
function getSocketServer() {
  if (!ioInstance) {
    throw new Error("Socket.IO server is not initialized.");
  }

  return ioInstance;
}

function hasSocketServer() {
  return Boolean(ioInstance);
}

/**
 * Emit only to a validated private user room.
 * Callers must supply an authenticated/verified recipient ID.
 */
function emitToUser(userId, eventName, payload) {
  const id = String(userId || "").trim();

  if (!/^[a-f\d]{24}$/i.test(id)) {
    throw new TypeError("A valid user ID is required.");
  }
  if (typeof eventName !== "string" || !eventName.trim()) {
    throw new TypeError("A valid event name is required.");
  }

  getSocketServer().to(id).emit(eventName, payload);
}

/**
 * Emit to a conversation room after the caller has performed access checks.
 * Authorization is deliberately not inferred from the room name here.
 */
function emitToConversation(conversationId, eventName, payload) {
  const id = String(conversationId || "").trim();

  if (!/^[a-f\d]{24}$/i.test(id)) {
    throw new TypeError("A valid conversation ID is required.");
  }
  if (typeof eventName !== "string" || !eventName.trim()) {
    throw new TypeError("A valid event name is required.");
  }

  getSocketServer().to(id).emit(eventName, payload);
}

/**
 * Clear the registered instance in tests or after a controlled shutdown.
 * This does not close the Socket.IO server.
 */
function resetSocketServer() {
  ioInstance = null;
}

module.exports = {
  setSocketServer,
  getSocketServer,
  hasSocketServer,
  emitToUser,
  emitToConversation,
  resetSocketServer,
};