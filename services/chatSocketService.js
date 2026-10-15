"use strict";

const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");

function normalizeObjectId(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const raw =
    value._id ||
    value.id ||
    value;

  const id = String(raw).trim();

  return mongoose.Types.ObjectId.isValid(id) ? id : null;
}

function getParticipantId(value) {
  return normalizeObjectId(value);
}

function getSocketIdentity(socket) {
  const userId = normalizeObjectId(socket?.data?.userId);
  const role = String(socket?.data?.role || "").trim().toLowerCase();

  return userId ? { userId, role } : null;
}

async function canSocketAccessConversation(
  userId,
  role,
  conversationId
) {
  const normalizedUserId = normalizeObjectId(userId);
  const normalizedConversationId =
    normalizeObjectId(conversationId);

  if (!normalizedUserId || !normalizedConversationId) {
    return false;
  }

  const conversation = await Conversation.findById(
    normalizedConversationId
  )
    .select("participants userId isGroup")
    .lean();

  if (!conversation) {
    return false;
  }

  const participants = Array.isArray(conversation.participants)
    ? conversation.participants.map(getParticipantId).filter(Boolean)
    : [];

  if (participants.includes(normalizedUserId)) {
    return true;
  }

  // Backward compatibility for legacy conversations.
  if (
    getParticipantId(conversation.userId) === normalizedUserId
  ) {
    return true;
  }

  // A privileged role alone does not grant access to a chat room.
  return false;
}

function joinPrivateUserRoom(socket) {
  const identity = getSocketIdentity(socket);

  if (!identity) {
    return false;
  }

  // Always derive the private room from the authenticated socket identity.
  socket.join(identity.userId);

  return true;
}

async function joinAuthorizedConversationRoom(
  socket,
  conversationId
) {
  const identity = getSocketIdentity(socket);
  const normalizedConversationId =
    normalizeObjectId(conversationId);

  if (!identity || !normalizedConversationId) {
    return {
      success: false,
      message: "A valid conversation ID is required.",
    };
  }

  const allowed = await canSocketAccessConversation(
    identity.userId,
    identity.role,
    normalizedConversationId
  );

  if (!allowed) {
    return {
      success: false,
      message: "Conversation not found or access denied.",
    };
  }

  await socket.join(normalizedConversationId);

  return {
    success: true,
    roomId: normalizedConversationId,
  };
}

async function leaveConversationRoom(socket, conversationId) {
  const identity = getSocketIdentity(socket);
  const normalizedConversationId =
    normalizeObjectId(conversationId);

  if (!identity || !normalizedConversationId) {
    return {
      success: false,
      message: "A valid conversation ID is required.",
    };
  }

  if (normalizedConversationId === identity.userId) {
    return {
      success: false,
      message: "Cannot leave the private user room.",
    };
  }

  await socket.leave(normalizedConversationId);

  return {
    success: true,
    roomId: normalizedConversationId,
  };
}

function emitToUser(io, userId, eventName, payload) {
  const normalizedUserId = normalizeObjectId(userId);

  if (
    !io ||
    !normalizedUserId ||
    typeof eventName !== "string" ||
    !eventName.trim()
  ) {
    return false;
  }

  io.to(normalizedUserId).emit(eventName, payload);

  return true;
}

function emitToConversation(
  io,
  conversationId,
  eventName,
  payload
) {
  const normalizedConversationId =
    normalizeObjectId(conversationId);

  if (
    !io ||
    !normalizedConversationId ||
    typeof eventName !== "string" ||
    !eventName.trim()
  ) {
    return false;
  }

  io.to(normalizedConversationId).emit(eventName, payload);

  return true;
}

module.exports = {
  canSocketAccessConversation,
  joinPrivateUserRoom,
  joinAuthorizedConversationRoom,
  leaveConversationRoom,
  emitToUser,
  emitToConversation,
};