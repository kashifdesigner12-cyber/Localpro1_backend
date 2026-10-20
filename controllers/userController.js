"use strict";

const mongoose = require("mongoose");
const User = require("../models/User");
const Attendance = require("../models/Attendance");
const Notification = require("../models/Notification");
const { sendWelcomeEmail } = require("../utils/sendEmail");

const VALID_ROLES = ["admin", "manager", "user"];
const VALID_STATUSES = ["Active", "Pending", "Blocked", "Inactive"];
const PAK_TIMEZONE = "Asia/Karachi";

// =====================================================
// HELPERS
// =====================================================

const normalizeUserId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === "object") {
    if (value._id) return normalizeUserId(value._id);
    if (value.id) return normalizeUserId(value.id);
    if (value.userId) return normalizeUserId(value.userId);
    return null;
  }
  if (typeof value === "string") {
    const id = value.trim();
    return id ? id : null;
  }
  return null;
};

const isValidObjectId = (id) => {
  const normalizedId = normalizeUserId(id);
  if (!normalizedId) return false;
  return mongoose.Types.ObjectId.isValid(normalizedId);
};

const getObjectId = (id) => {
  const normalizedId = normalizeUserId(id);
  if (!normalizedId || !mongoose.Types.ObjectId.isValid(normalizedId)) return null;
  return new mongoose.Types.ObjectId(normalizedId);
};

const getAuthenticatedUserId = (req) => {
  if (!req || !req.user) return null;
  return normalizeUserId(req.user._id || req.user.id || req.user.userId);
};

const sameUserId = (a, b) => {
  const first = normalizeUserId(a);
  const second = normalizeUserId(b);
  if (!first || !second) return false;
  return first === second;
};

const getPKTDateString = (date = new Date()) => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PAK_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

const getDayRange = (date = new Date()) => {
  const pktDateString = getPKTDateString(date);
  const start = new Date(`${pktDateString}T00:00:00+05:00`);
  const end = new Date(`${pktDateString}T23:59:59.999+05:00`);
  return { start, end };
};

const createScheduledDate = (date, time) => {
  if (!time || !/^\d{1,2}:\d{2}$/.test(String(time).trim())) return null;
  const pktDateString = getPKTDateString(date);
  const timeFormatted = String(time).trim().padStart(5, "0");
  const scheduled = new Date(`${pktDateString}T${timeFormatted}:00+05:00`);
  return Number.isNaN(scheduled.getTime()) ? null : scheduled;
};

const syncTodayAttendanceSchedule = async (user, schedule) => {
  if (!user || !schedule || typeof schedule !== "object") return;
  try {
    const now = new Date();
    const { start, end } = getDayRange(now);
    const startTime = schedule.startTime || user.attendanceSettings?.attendanceTime || "09:00";
    const windowStartStr = schedule.windowStart || "08:45";
    const windowEndStr = schedule.windowEnd || "09:30";

    const schedTimeObj = createScheduledDate(now, startTime);
    const winStartObj = createScheduledDate(now, windowStartStr);
    const winEndObj = createScheduledDate(now, windowEndStr);

    const existingAttendance = await Attendance.findOne({
      user: user._id,
      date: { $gte: start,$lte: end },
    }).lean();

    if (existingAttendance) {
      if (existingAttendance.status !== "Present" && !existingAttendance.checkIn) {
        await Attendance.updateOne(
          { _id: existingAttendance._id },
          {
            $set: {
              scheduledTime: schedTimeObj,
              windowStart: winStartObj,
              windowEnd: winEndObj,
              status: "Pending",
              markedAt: null,
            },
          }
        );
      }
    } else if (user.role === "user" && user.status === "Active") {
      await Attendance.create({
        user: user._id,
        date: new Date(`${getPKTDateString(now)}T00:00:00+05:00`),
        scheduledTime: schedTimeObj,
        windowStart: winStartObj,
        windowEnd: winEndObj,
        status: "Pending",
        checkIn: null,
        checkOut: null,
        notes: "",
      });
    }
  } catch (syncErr) {
    console.error("Attendance live sync error:", syncErr);
  }
};

// =====================================================
// SAFE USER & VALIDATION
// =====================================================

const safeUser = (user) => {
  if (!user) return null;
  const userId = normalizeUserId(user._id || user.id);
  let cleanAvatar = user.avatar || null;
  if (typeof cleanAvatar === "string" && cleanAvatar.startsWith("data:image") && cleanAvatar.length > 1000) {
    cleanAvatar = null;
  }

  return {
    id: userId,
    _id: userId,
    name: user.name || "",
    email: user.email || "",
    phone: user.phone || "",
    role: user.role || "user",
    status: user.status || "Active",
    isActive: user.isActive !== undefined ? user.isActive : true,
    avatar: cleanAvatar,
    twilioPhoneNumber: user.twilioPhoneNumber || "",
    business: user.business || {},
    preferences: user.preferences || {},
    attendanceSettings: user.attendanceSettings || {},
    attendanceSchedule: user.attendanceSchedule || user?.preferences?.attendanceSchedule || user.workSchedule || null,
    workSchedule: user.workSchedule || user?.preferences?.workSchedule || user.attendanceSchedule || null,
    notificationPreferences: user.notificationPreferences || {},
    integrations: user.integrations || {},
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const normalizeRole = (role) => (typeof role !== "string" ? "" : role.trim().toLowerCase());
const normalizeStatus = (status) => {
  if (typeof status !== "string") return "";
  const normalized = status.trim().toLowerCase();
  const statusMap = { active: "Active", pending: "Pending", blocked: "Blocked", inactive: "Inactive" };
  return statusMap[normalized] || "";
};

const parseSort = (sortParam, defaultSort = { createdAt: -1 }) => {
  if (!sortParam || typeof sortParam !== "string") return defaultSort;
  const sort = sortParam.trim();
  const predefinedSorts = {
    newest: { createdAt: -1 },
    "-createdAt": { createdAt: -1 },
    oldest: { createdAt: 1 },
    createdAt: { createdAt: 1 },
    name: { name: 1 },
    asc: { name: 1 },
    "-name": { name: -1 },
    desc: { name: -1 },
    email: { email: 1 },
    "-email": { email: -1 },
    role: { role: 1 },
    "-role": { role: -1 },
    status: { status: 1 },
    "-status": { status: -1 },
  };
  if (predefinedSorts[sort]) return predefinedSorts[sort];
  const allowedSortFields = ["createdAt", "name", "email", "role", "status"];
  const descending = sort.startsWith("-");
  const field = descending ? sort.substring(1) : sort;
  if (!allowedSortFields.includes(field)) return defaultSort;
  return { [field]: descending ? -1 : 1 };
};

// =====================================================
// CONTROLLER FUNCTIONS
// =====================================================

const getUsers = async (req, res) => {
  try {
    const { search, role, status, page = 1, limit = 20, sort = "-createdAt" } = req.query;
    const filter = {};

    if (typeof search === "string" && search.trim()) {
      const searchValue = search.trim();
      const escapedSearch = searchValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escapedSearch, "i");
      filter.$or = [{ name: regex }, { email: regex }, { phone: regex }];
    }

    if (role) {
      const normalizedRole = normalizeRole(role);
      if (!VALID_ROLES.includes(normalizedRole)) {
        return res.status(400).json({ success: false, message: `Invalid role filter.` });
      }
      filter.role = normalizedRole;
    }

    if (status) {
      const normalizedStatus = normalizeStatus(status);
      if (!VALID_STATUSES.includes(normalizedStatus)) {
        return res.status(400).json({ success: false, message: `Invalid status filter.` });
      }
      filter.status = normalizedStatus;
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;
    const sortOption = parseSort(sort);

    const [users, total] = await Promise.all([
      User.find(filter).select("-password").skip(skip).limit(limitNum).sort(sortOption).lean(),
      User.countDocuments(filter),
    ]);

    const safeUsersList = users.map(safeUser);

    return res.status(200).json({
      success: true,
      users: safeUsersList,
      data: safeUsersList,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) || 0 },
    });
  } catch (error) {
    console.error("getUsers error:", error);
    return res.status(500).json({ success: false, message: "Server error retrieving users." });
  }
};

const getUserStats = async (req, res) => {
  try {
    const [statsResult, byRoleResult] = await Promise.all([
      User.aggregate([
        {
          $facet: {
            total: [{ $count: "count" }],
            active: [{ $match: { status: "Active" } }, { $count: "count" }],
            pending: [{ $match: { status: "Pending" } }, { $count: "count" }],
            blocked: [{ $match: { status: "Blocked" } }, { $count: "count" }],
            inactive: [{ $match: { status: "Inactive" } }, { $count: "count" }],
          },
        },
      ]),
      User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),
    ]);

    const facet = statsResult[0] || {};
    const stats = {
      total: facet.total?.[0]?.count || 0,
      active: facet.active?.[0]?.count || 0,
      pending: facet.pending?.[0]?.count || 0,
      blocked: facet.blocked?.[0]?.count || 0,
      inactive: facet.inactive?.[0]?.count || 0,
      byRole: byRoleResult,
    };

    return res.status(200).json({ success: true, stats, data: stats });
  } catch (error) {
    console.error("getUserStats error:", error);
    return res.status(500).json({ success: false, message: "Server error retrieving user stats." });
  }
};

const getUserById = async (req, res) => {
  try {
    const userId = normalizeUserId(req.params.id);
    if (!userId || !isValidObjectId(userId)) {
      return res.status(400).json({ success: false, message: "Invalid or missing user ID." });
    }

    const user = await User.findById(getObjectId(userId)).select("-password").lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    const safeUserData = safeUser(user);
    return res.status(200).json({ success: true, user: safeUserData, data: safeUserData });
  } catch (error) {
    console.error("getUserById error:", error);
    return res.status(500).json({ success: false, message: "Server error retrieving user." });
  }
};

const createUser = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Authentication required." });

    const { name, email, phone, password, role, status, business, preferences, attendanceSchedule, workSchedule, attendanceSettings } = req.body;

    if (!name || !name.trim()) return res.status(400).json({ success: false, message: "Name is required." });
    if (!email || !isValidEmail(email.trim())) return res.status(400).json({ success: false, message: "Valid email is required." });
    if (!password || password.length < 6) return res.status(400).json({ success: false, message: "Password must be at least 6 chars." });

    const normalizedRole = normalizeRole(role);
    if (!VALID_ROLES.includes(normalizedRole)) return res.status(400).json({ success: false, message: "Invalid role." });

    if (req.user.role === "manager" && (normalizedRole === "admin" || normalizedRole === "manager")) {
      return res.status(403).json({ success: false, message: "Managers can only create standard user accounts." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await User.findOne({ email: normalizedEmail }).select("_id").lean();
    if (existingUser) return res.status(400).json({ success: false, message: "Email already in use." });

    const finalPreferences = {
      ...(preferences || {}),
      ...(attendanceSchedule ? { attendanceSchedule } : {}),
      ...(workSchedule ? { workSchedule } : {}),
    };

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      phone: phone ? phone.trim() : "",
      password,
      role: normalizedRole,
      status: normalizeStatus(status) || "Active",
      business: business || {},
      preferences: finalPreferences,
      attendanceSchedule,
      workSchedule,
      attendanceSettings,
    });

    try {
      await sendWelcomeEmail(user.email, user.name);
    } catch (emailErr) {
      console.error("Welcome email failed:", emailErr.message);
    }

    const safeUserData = safeUser(user);
    return res.status(201).json({ success: true, message: "User created successfully.", user: safeUserData, data: safeUserData });
  } catch (error) {
    console.error("createUser error:", error);
    if (error.code === 11000) return res.status(400).json({ success: false, message: "Email already in use." });
    return res.status(500).json({ success: false, message: "Server error creating user." });
  }
};

const updateUser = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Authentication required." });

    const userId = normalizeUserId(req.params.id);
    if (!userId || !isValidObjectId(userId)) return res.status(400).json({ success: false, message: "Invalid user ID." });

    const user = await User.findById(getObjectId(userId));
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    const authenticatedUserId = getAuthenticatedUserId(req);
    const isSelf = sameUserId(user._id, authenticatedUserId);
    const isAdmin = req.user.role === "admin";
    const isManager = req.user.role === "manager";

    if (!isAdmin && !isManager && !isSelf) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const { name, email, phone, role, status, avatar, business, preferences, attendanceSchedule, workSchedule, attendanceSettings, notificationPreferences, integrations, twilioPhoneNumber } = req.body;

    if (email !== undefined && !isSelf && !isAdmin) {
      return res.status(403).json({ success: false, message: "Access denied to update email." });
    }

    if (name !== undefined) user.name = name.trim();
    if (phone !== undefined) user.phone = phone.trim();
    if (avatar !== undefined) user.avatar = avatar || null;
    if (business) user.business = { ...(user.business || {}), ...business };

    let targetSchedulePayload = null;
    if (preferences) {
      user.preferences = { ...(user.preferences || {}), ...preferences };
      if (preferences.attendanceSchedule) targetSchedulePayload = preferences.attendanceSchedule;
    }
    if (attendanceSchedule) {
      user.attendanceSchedule = attendanceSchedule;
      targetSchedulePayload = attendanceSchedule;
    }
    if (workSchedule) {
      user.workSchedule = workSchedule;
      if (!targetSchedulePayload) targetSchedulePayload = workSchedule;
    }
    if (attendanceSettings) user.attendanceSettings = { ...(user.attendanceSettings || {}), ...attendanceSettings };

    await user.save();
    if (targetSchedulePayload) await syncTodayAttendanceSchedule(user, targetSchedulePayload);

    const safeUserData = safeUser(user);
    return res.status(200).json({ success: true, message: "User updated successfully.", user: safeUserData, data: safeUserData });
  } catch (error) {
    console.error("updateUser error:", error);
    return res.status(500).json({ success: false, message: "Server error updating user." });
  }
};

const updateUserStatus = async (req, res) => {
  try {
    if (!req.user || (req.user.role !== "admin" && req.user.role !== "manager")) {
      return res.status(403).json({ success: false, message: "Admin or Manager access required." });
    }
    const userId = normalizeUserId(req.params.id);
    const { status } = req.body;
    if (!userId || !isValidObjectId(userId)) return res.status(400).json({ success: false, message: "Invalid user ID." });

    const user = await User.findById(getObjectId(userId));
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    user.status = normalizeStatus(status) || user.status;
    await user.save();

    const safeUserData = safeUser(user);
    return res.status(200).json({ success: true, message: "Status updated.", user: safeUserData, data: safeUserData });
  } catch (error) {
    console.error("updateUserStatus error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

const updateUserRole = async (req, res) => {
  try {
    if (!req.user || req.user.role !== "admin") return res.status(403).json({ success: false, message: "Admin access required." });
    const userId = normalizeUserId(req.params.id);
    const { role } = req.body;
    if (!userId || !isValidObjectId(userId)) return res.status(400).json({ success: false, message: "Invalid user ID." });

    const user = await User.findById(getObjectId(userId));
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    user.role = normalizeRole(role) || user.role;
    await user.save();

    const safeUserData = safeUser(user);
    return res.status(200).json({ success: true, message: "Role updated.", user: safeUserData, data: safeUserData });
  } catch (error) {
    console.error("updateUserRole error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

const deleteUser = async (req, res) => {
  try {
    if (!req.user || req.user.role !== "admin") return res.status(403).json({ success: false, message: "Admin access required." });
    const userId = normalizeUserId(req.params.id);
    if (!userId || !isValidObjectId(userId)) return res.status(400).json({ success: false, message: "Invalid user ID." });

    const authenticatedUserId = getAuthenticatedUserId(req);
    if (sameUserId(userId, authenticatedUserId)) {
      return res.status(400).json({ success: false, message: "You cannot delete your own account." });
    }

    const user = await User.findById(getObjectId(userId)).select("_id").lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    await Promise.all([
      Attendance.deleteMany({ user: user._id }),
      Notification.deleteMany({ user: user._id }),
      User.findByIdAndDelete(getObjectId(userId)),
    ]);

    return res.status(200).json({ success: true, message: "User deleted successfully." });
  } catch (error) {
    console.error("deleteUser error:", error);
    return res.status(500).json({ success: false, message: "Server error deleting user." });
  }
};

const getProfile = async (req, res) => {
  try {
    const authenticatedUserId = getAuthenticatedUserId(req);
    if (!authenticatedUserId || !isValidObjectId(authenticatedUserId)) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    const user = await User.findById(getObjectId(authenticatedUserId)).select("-password").lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    const safeUserData = safeUser(user);
    return res.status(200).json({ success: true, user: safeUserData, data: safeUserData });
  } catch (error) {
    console.error("getProfile error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

const updateProfile = async (req, res) => {
  return updateUser({ ...req, params: { id: getAuthenticatedUserId(req) } }, res);
};

const changePassword = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Authentication required." });
    const { currentPassword, oldPassword, newPassword, password } = req.body;
    const currentPass = currentPassword || oldPassword;
    const newPass = newPassword || password;

    if (!currentPass || !newPass || newPass.length < 6) {
      return res.status(400).json({ success: false, message: "Valid current and new passwords required." });
    }

    const authenticatedUserId = getAuthenticatedUserId(req);
    const user = await User.findById(getObjectId(authenticatedUserId)).select("+password");
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    const isMatch = await user.comparePassword(currentPass);
    if (!isMatch) return res.status(401).json({ success: false, message: "Current password incorrect." });

    user.password = newPass;
    await user.save();

    return res.status(200).json({ success: true, message: "Password updated successfully." });
  } catch (error) {
    console.error("changePassword error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

module.exports = {
  getUsers,
  getUserStats,
  getUserById,
  createUser,
  updateUser,
  updateUserStatus,
  updateUserRole,
  deleteUser,
  getProfile,
  updateProfile,
  changePassword,
  normalizeUserId,
  isValidObjectId,
  getObjectId,
};