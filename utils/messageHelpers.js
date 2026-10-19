"use strict";
const mongoose = require("mongoose");

const isValidObjectId = (id) => Boolean(id) && mongoose.Types.ObjectId.isValid(String(id));

const toId = (value) => {
  if (!value) return null;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const safeUserRef = (user) => {
  if (!user) return null;
  if (typeof user === "object" && user._id) {
    let avatar = user.avatar || null;
    if (typeof avatar === "string" && avatar.startsWith("data:image") && avatar.length > 1000) {
      avatar = null;
    }
    return {
      id: user._id,
      _id: user._id,
      name: user.name || "",
      email: user.email || "",
      phone: user.phone,
      role: user.role || "",
      status: user.status,
      avatar,
    };
  }
  return user;
};

const canAccessConversation = (conversation, userId, role = "") => {
  if (!conversation || !userId) return false;
  const normalizedRole = String(role || "").toLowerCase();
  if (normalizedRole === "admin" || normalizedRole === "manager") return true;

  const participantIds = Array.isArray(conversation.participants)
    ? conversation.participants.map((p) => String(p?._id || p))
    : [];

  if (participantIds.includes(String(userId))) return true;
  const legacyUserId = conversation.userId ? String(conversation.userId?._id || conversation.userId) : null;
  return legacyUserId === String(userId);
};

const getUserRole = (user) => String(user?.role || "").toLowerCase();

module.exports = {
  isValidObjectId,
  toId,
  safeUserRef,
  canAccessConversation,
  getUserRole,
};