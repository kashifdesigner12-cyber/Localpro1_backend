"use strict";
const mongoose = require("mongoose");
const User = require("../models/User");

const isValidObjectId = (id) => Boolean(id) && mongoose.Types.ObjectId.isValid(String(id));

const toId = (value) => {
  if (value && typeof value === "object" && value._id) return String(value._id);
  return value ? String(value) : null;
};

const getRole = (user) => String(user?.role || "").trim().toLowerCase();

const safeUserRef = (user) => {
  if (!user) return null;
  if (typeof user === "object" && user._id) {
    let avatar = user.avatar || user.profileImage || user.image || "";
    if (typeof avatar === "string" && avatar.startsWith("data:image") && avatar.length > 1000) {
      avatar = "";
    }
    return {
      id: String(user._id),
      _id: String(user._id),
      name: user.name || "",
      email: user.email || "",
      phone: user.phone || "",
      role: user.role || "",
      status: user.status || "",
      avatar,
    };
  }
  return user;
};

module.exports = { isValidObjectId, toId, getRole, safeUserRef };