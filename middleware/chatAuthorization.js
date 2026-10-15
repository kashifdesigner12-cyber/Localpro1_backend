"use strict";

const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");

function normalizeId(value) {
  if (!value) return null;

  const raw =
    value._id ||
    value.id ||
    value.userId ||
    value;

  if (
    typeof raw !== "string" &&
    typeof raw !== "number" &&
    !(raw instanceof mongoose.Types.ObjectId)
  ) {
    return null;
  }

  const id = String(raw).trim();

  return mongoose.Types.ObjectId.isValid(id) ? id : null;
}

function getAuthenticatedUserId(user) {
  return normalizeId(user?._id || user?.id || user?.userId);
}

function getConversationId(req) {
  return (
    normalizeId(req?.params?.conversationId) ||
    normalizeId(req?.params?.id) ||
    normalizeId(req?.body?.conversationId) ||
    normalizeId(req?.body?.conversation) ||
    normalizeId(req?.query?.conversationId)
  );
}

function participantId(value) {
  return normalizeId(value);
}

async function canAccessConversation(user, conversationId) {
  const userId = getAuthenticatedUserId(user);
  const normalizedConversationId = normalizeId(conversationId);

  if (!userId || !normalizedConversationId) {
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

  const participantIds = Array.isArray(conversation.participants)
    ? conversation.participants.map(participantId).filter(Boolean)
    : [];

  // Only actual participants can access the conversation.
  if (participantIds.includes(userId)) {
    return true;
  }

  // Support legacy conversations that store their owner in userId.
  if (participantId(conversation.userId) === userId) {
    return true;
  }

  // Admin/manager roles do not automatically grant private chat access.
  return false;
}

function requireConversationAccess(options = {}) {
  const getId =
    typeof options.getConversationId === "function"
      ? options.getConversationId
      : getConversationId;

  return async function conversationAccessMiddleware(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
      }

      const conversationId = getId(req);

      if (!conversationId) {
        return res.status(400).json({
          success: false,
          message: "A valid conversation ID is required.",
        });
      }

      const allowed = await canAccessConversation(
        req.user,
        conversationId
      );

      if (!allowed) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found.",
        });
      }

      req.conversationId = conversationId;
      return next();
    } catch (error) {
      console.error(
        "[Chat Authorization] Access check failed:",
        error.message
      );

      return res.status(500).json({
        success: false,
        message: "Unable to verify conversation access.",
      });
    }
  };
}

module.exports = {
  canAccessConversation,
  requireConversationAccess,
  getConversationId,
};