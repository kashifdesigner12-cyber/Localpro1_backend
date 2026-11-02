
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import User from "../models/User.js";
import { invalidateUserAuthCache } from "../middleware/authMiddleware.js";

const PROFILE_PICTURE_MAX_LENGTH = 7_000_000;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const AUTH_COOKIE_MAX_AGE = 24 * 60 * 60 * 1000;

const COOKIE_NAME = process.env.COOKIE_NAME || "localpro_token";

const createToken = (userId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing from environment variables.");
  }

  return jwt.sign(
    { id: String(userId) },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "1d",
    }
  );
};

const getCookieOptions = () => {
  const sameSite = (
    process.env.COOKIE_SAME_SITE || "lax"
  ).toLowerCase();

  const validSameSite = ["strict", "lax", "none"].includes(sameSite)
    ? sameSite
    : "lax";

  const secure =
    process.env.COOKIE_SECURE === "true" ||
    validSameSite === "none" ||
    process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure,
    sameSite: validSameSite,
    path: "/",
  };
};

const setAuthCookie = (res, token) => {
  res.cookie(COOKIE_NAME, token, {
    ...getCookieOptions(),
    maxAge: AUTH_COOKIE_MAX_AGE,
  });
};

const getPublicUser = (user) => ({
  id: user._id,
  username: user.username,
  name: user.name || user.username,
  email: user.email || "",
  phone: user.phone || "",
  location: user.location || "",
  department: user.department || "",
  designation: user.jobTitle || "",
  jobTitle: user.jobTitle || "",
  profilePicture: user.profilePicture || "",
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
});

const getPreferences = (user) => ({
  emailNotifications: user.settings?.emailNotifications ?? true,
  taskNotifications: user.settings?.taskNotifications ?? true,
  attendanceNotifications:
    user.settings?.attendanceNotifications ?? true,
  appearance: user.settings?.appearance ?? "light",
});

const isValidEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const sendError = (res, status, message) =>
  res.status(status).json({
    success: false,
    message,
  });

// ----------------------------------------------------
// LOGIN
// ----------------------------------------------------

export const login = async (req, res, next) => {
  try {
    const username =
      typeof req.body?.username === "string"
        ? req.body.username.trim().toLowerCase()
        : "";

    const password = req.body?.password;

    if (!username || typeof password !== "string" || !password) {
      return sendError(
        res,
        400,
        "Username and password are required."
      );
    }

    const user = await User.findOne({ username })
      .select("+password")
      .lean()
      .exec();

    if (!user || !user.password) {
      return sendError(
        res,
        401,
        "Invalid username or password."
      );
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatches) {
      return sendError(
        res,
        401,
        "Invalid username or password."
      );
    }

    if (user.status !== "active") {
      return sendError(
        res,
        403,
        "Your account is not active. Contact an administrator."
      );
    }

    const token = createToken(user._id);

    // Set the authentication cookie before returning success.
    setAuthCookie(res, token);

    // Update login time without delaying the login response.
    User.updateOne(
      { _id: user._id },
      { $set: { lastLoginAt: new Date() } }
    ).catch((error) => {
      console.error("[AUTH] Could not update lastLoginAt:", error.message);
    });

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      user: getPublicUser(user),
    });
  } catch (error) {
    return next(error);
  }
};

// ----------------------------------------------------
// SETUP PASSWORD FROM INVITATION
// ----------------------------------------------------

export const setupPassword = async (req, res, next) => {
  try {
    const token =
      typeof req.body?.token === "string"
        ? req.body.token.trim()
        : "";

    const password = req.body?.password;

    if (!token || typeof password !== "string") {
      return sendError(
        res,
        400,
        "Invitation token and password are required."
      );
    }

    if (
      password.length < PASSWORD_MIN_LENGTH ||
      password.length > PASSWORD_MAX_LENGTH
    ) {
      return sendError(
        res,
        400,
        "Password must be between 8 and 128 characters."
      );
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const user = await User.findOne({
      invitationTokenHash: tokenHash,
      invitationExpiresAt: { $gt: new Date() },
      status: "pending",
    }).select("+invitationTokenHash");

    if (!user) {
      return sendError(
        res,
        400,
        "Invitation link is invalid or has expired."
      );
    }

    user.password = await bcrypt.hash(password, 10);
    user.status = "active";
    user.passwordChangedAt = new Date();
    user.invitationTokenHash = undefined;
    user.invitationExpiresAt = undefined;

    await user.save();

    invalidateUserAuthCache(user._id.toString());

    return res.status(200).json({
      success: true,
      message: "Password set successfully.",
    });
  } catch (error) {
    return next(error);
  }
};

// ----------------------------------------------------
// LOGOUT
// ----------------------------------------------------

export const logout = (req, res) => {
  res.clearCookie(COOKIE_NAME, getCookieOptions());

  return res.status(200).json({
    success: true,
    message: "Logout successful.",
  });
};

// ----------------------------------------------------
// CURRENT LOGGED-IN USER
// ----------------------------------------------------

export const getMe = async (req, res, next) => {
  try {
    if (!req.user) {
      return sendError(
        res,
        401,
        "Authentication required. Please log in."
      );
    }

    return res.status(200).json({
      success: true,
      user: getPublicUser(req.user),
    });
  } catch (error) {
    return next(error);
  }
};

// ----------------------------------------------------
// UPDATE PROFILE
// ----------------------------------------------------

export const updateMyProfile = async (req, res, next) => {
  try {
    const allowedFields = [
      "name",
      "email",
      "phone",
      "location",
      "department",
      "designation",
      "jobTitle",
      "profilePicture",
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (
        !Object.prototype.hasOwnProperty.call(
          req.body || {},
          field
        )
      ) {
        continue;
      }

      if (typeof req.body[field] !== "string") {
        return sendError(
          res,
          400,
          `${field} must be a string.`
        );
      }

      const value = req.body[field].trim();

      let maxLength = 254;

      if (field === "profilePicture") {
        maxLength = PROFILE_PICTURE_MAX_LENGTH;
      } else if (field === "name") {
        maxLength = 100;
      } else if (field === "phone") {
        maxLength = 30;
      } else if (field === "location" || field === "department") {
        maxLength = 150;
      } else if (field === "jobTitle" || field === "designation") {
        maxLength = 100;
      }

      if (value.length > maxLength) {
        return sendError(
          res,
          400,
          `${field} is too long.`
        );
      }

      if (field === "email" && value && !isValidEmail(value)) {
        return sendError(
          res,
          400,
          "Please enter a valid email address."
        );
      }

      if (field === "name") {
        updates.name = value;
      } else if (field === "designation" || field === "jobTitle") {
        updates.jobTitle = value;
      } else {
        updates[field] =
          field === "email" ? value.toLowerCase() : value;
      }
    }

    if (Object.keys(updates).length === 0) {
      return sendError(
        res,
        400,
        "Provide at least one profile field to update."
      );
    }

    if (updates.email) {
      const existingEmail = await User.findOne({
        email: updates.email,
        _id: { $ne: req.user._id },
      })
        .select("_id")
        .lean()
        .exec();

      if (existingEmail) {
        return sendError(
          res,
          409,
          "This email address is already in use."
        );
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      {
        new: true,
        runValidators: true,
      }
    )
      .lean()
      .exec();

    if (!user) {
      return sendError(res, 404, "User not found.");
    }

    invalidateUserAuthCache(user._id.toString());

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user: getPublicUser(user),
    });
  } catch (error) {
    if (error.code === 11000) {
      return sendError(
        res,
        409,
        "This email address or username is already in use."
      );
    }

    return next(error);
  }
};

// ----------------------------------------------------
// GET PREFERENCES
// ----------------------------------------------------

export const getMyPreferences = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .select("settings")
      .lean()
      .exec();

    if (!user) {
      return sendError(res, 404, "User not found.");
    }

    return res.status(200).json({
      success: true,
      preferences: getPreferences(user),
    });
  } catch (error) {
    return next(error);
  }
};

// ----------------------------------------------------
// UPDATE PREFERENCES
// ----------------------------------------------------

export const updateMyPreferences = async (req, res, next) => {
  try {
    const body = req.body || {};
    const updates = {};

    const booleanFields = [
      "emailNotifications",
      "taskNotifications",
      "attendanceNotifications",
    ];

    for (const field of booleanFields) {
      if (body[field] === undefined) {
        continue;
      }

      if (typeof body[field] !== "boolean") {
        return sendError(
          res,
          400,
          `${field} must be true or false.`
        );
      }

      updates[`settings.${field}`] = body[field];
    }

    if (body.appearance !== undefined) {
      if (!["light", "dark"].includes(body.appearance)) {
        return sendError(
          res,
          400,
          "Appearance must be light or dark."
        );
      }

      updates["settings.appearance"] = body.appearance;
    }

    if (Object.keys(updates).length === 0) {
      return sendError(
        res,
        400,
        "Provide at least one valid preference."
      );
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      {
        new: true,
        runValidators: true,
      }
    )
      .select("settings")
      .lean()
      .exec();

    if (!user) {
      return sendError(res, 404, "User not found.");
    }

    return res.status(200).json({
      success: true,
      message: "Preferences saved successfully.",
      preferences: getPreferences(user),
    });
  } catch (error) {
    return next(error);
  }
};

// ----------------------------------------------------
// CHANGE PASSWORD
// ----------------------------------------------------

export const changeMyPassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string" ||
      !currentPassword ||
      !newPassword
    ) {
      return sendError(
        res,
        400,
        "Current password and new password are required."
      );
    }

    if (
      newPassword.length < PASSWORD_MIN_LENGTH ||
      newPassword.length > PASSWORD_MAX_LENGTH
    ) {
      return sendError(
        res,
        400,
        "New password must be between 8 and 128 characters."
      );
    }

    if (currentPassword === newPassword) {
      return sendError(
        res,
        400,
        "New password must be different from the current password."
      );
    }

    const user = await User.findById(req.user._id)
      .select("+password")
      .exec();

    if (!user || !user.password) {
      return sendError(res, 404, "User not found.");
    }

    const matches = await bcrypt.compare(
      currentPassword,
      user.password
    );

    if (!matches) {
      return sendError(
        res,
        400,
        "Current password is incorrect."
      );
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordChangedAt = new Date();

    await user.save();

    invalidateUserAuthCache(user._id.toString());

    return res.status(200).json({
      success: true,
      message: "Password changed successfully.",
    });
  } catch (error) {
    return next(error);
  }
};
