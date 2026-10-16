
"use strict";

let ioInstance = null;

const OBJECT_ID_REGEX = /^[a-f\d]{24}$/i;

function isValidObjectId(value) {
  return OBJECT_ID_REGEX.test(String(value || "").trim());
}

function normalizeId(value, label) {
  const id = String(value || "").trim();

  if (!isValidObjectId(id)) {
    throw new TypeError(`A valid ${label} is required.`);
  }

  return id;
}

function normalizeEventName(eventName) {
  if (typeof eventName !== "string" || !eventName.trim()) {
    throw new TypeError("A valid event name is required.");
  }

  return eventName.trim();
}

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
 *
 * Example:
 * setSocketServer(io);
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

/**
 * Check whether the Socket.IO server has been registered.
 */
function hasSocketServer() {
  return Boolean(ioInstance);
}

/**
 * Emit to a private user room.
 *
 * IMPORTANT:
 * The caller must verify that the recipient is authorized.
 * This function validates the ID format but does not perform authorization.
 */
function emitToUser(userId, eventName, payload) {
  const id = normalizeId(userId, "user ID");
  const event = normalizeEventName(eventName);

  getSocketServer().to(id).emit(event, payload);

  return true;
}

/**
 * Emit to a conversation room.
 *
 * IMPORTANT:
 * The caller must check conversation access and participant permissions
 * before calling this function. A valid conversation ID alone does not
 * grant permission to emit to that room.
 */
function emitToConversation(conversationId, eventName, payload) {
  const id = normalizeId(conversationId, "conversation ID");
  const event = normalizeEventName(eventName);

  getSocketServer().to(id).emit(event, payload);

  return true;
}

/**
 * Clear the registered instance in tests or during controlled shutdown.
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
