const jwt = require("jsonwebtoken");
const User = require("../models/User");

// ==========================================
// Build Safe User Object
// ==========================================
const safeUser = (user) => {
  if (!user) return null;

  return {
    id: user._id,
    _id: user._id,
    name: user.name || "",
    email: user.email || "",
    phone: user.phone || "",
    role: user.role || "user",
    status: user.status || "Active",
    avatar: user.avatar || null,
    business: user.business || {},
    preferences: user.preferences || {},
    attendanceSettings: user.attendanceSettings || {},
    attendanceSchedule:
      user.attendanceSchedule || user?.preferences?.attendanceSchedule || null,
    workSchedule:
      user.workSchedule || user?.preferences?.workSchedule || null,
    notificationPreferences: user.notificationPreferences || {},
    integrations: user.integrations || {},
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

// ==========================================
// Generate JWT Token
// ==========================================
const generateToken = (id, role) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing from environment variables.");
  }

  return jwt.sign(
    { id: String(id), role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
};

// ==========================================
// Cookie Configuration
// ==========================================
const getCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/",
});

const isAccountInactive = (user) =>
  user.isDeleted === true ||
  user.isActive === false ||
  ["Blocked", "Inactive", "Pending"].includes(user.status);

// ==========================================
// POST /api/auth/register
// Register New User
// ==========================================
const register = async (req, res) => {
  try {
    const { name, email, password, phone } = req.body || {};

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string" ||
      !name.trim() ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters.",
      });
    }

    const emailNormalized = email.trim().toLowerCase();
    const existingUser = await User.findOne({ email: emailNormalized })
      .select("_id")
      .lean();

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    const user = await User.create({
      name: name.trim(),
      email: emailNormalized,
      password,
      phone: typeof phone === "string" ? phone.trim() : "",
      // Never accept privileged roles from public registration input.
      role: "user",
    });

    // Do not email raw passwords. A welcome email should only be added when
    // it uses a verified password-setup/reset flow.
    const safeUserData = safeUser(user.toObject ? user.toObject() : user);

    return res.status(201).json({
      success: true,
      message: "Registration successful. You can now sign in with your account.",
      user: safeUserData,
      data: safeUserData,
    });
  } catch (error) {
    console.error("Register error:", error);

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors || {}).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(" ") || "Invalid registration details.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error. Please try again.",
    });
  }
};

// ==========================================
// POST /api/auth/login
// Login User
// ==========================================
const login = async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is missing from environment variables.");
      return res.status(500).json({
        success: false,
        message: "Server authentication configuration error.",
      });
    }

    const emailNormalized = email.trim().toLowerCase();
    const user = await User.findOne({ email: emailNormalized }).select("+password");

    if (!user || user.isDeleted === true) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    if (isAccountInactive(user)) {
      const message = user.status === "Pending"
        ? "Your account is pending approval."
        : "Your account has been deactivated or blocked.";
      return res.status(403).json({ success: false, message });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const token = generateToken(user._id, user.role);
    res.cookie("token", token, getCookieOptions());

    const safeUserData = safeUser(user);
    return res.status(200).json({
      success: true,
      message: "Login successful.",
      token,
      user: safeUserData,
      data: safeUserData,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again.",
    });
  }
};

// ==========================================
// GET /api/auth/me
// Get Current Logged-in User
// ==========================================
const getMe = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: "Not authenticated." });
    }

    const user = await User.findById(req.user._id).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (isAccountInactive(user)) {
      return res.status(401).json({
        success: false,
        message: "Your account is no longer active.",
      });
    }

    const safeUserData = safeUser(user);
    return res.status(200).json({
      success: true,
      user: safeUserData,
      data: safeUserData,
    });
  } catch (error) {
    console.error("Get me error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// ==========================================
// PUT /api/auth/profile and PUT /api/auth/me
// Update User Profile
// ==========================================
const updateProfile = async (req, res) => {
  try {
    const {
      name,
      phone,
      avatar,
      preferences,
      attendanceSchedule,
      workSchedule,
      attendanceSettings,
    } = req.body || {};

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ success: false, message: "Name cannot be empty." });
      }
      user.name = name.trim();
    }

    if (phone !== undefined) {
      if (typeof phone !== "string") {
        return res.status(400).json({ success: false, message: "Phone must be a string." });
      }
      user.phone = phone.trim();
    }

    if (avatar !== undefined) {
      if (avatar !== null && typeof avatar !== "string") {
        return res.status(400).json({ success: false, message: "Avatar must be a URL/string or null." });
      }
      user.avatar = avatar;
    }

    if (preferences !== undefined) {
      if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
        return res.status(400).json({ success: false, message: "Preferences must be an object." });
      }
      user.preferences = { ...(user.preferences || {}), ...preferences };
    }

    if (attendanceSchedule !== undefined) {
      user.attendanceSchedule = attendanceSchedule;
      user.preferences = { ...(user.preferences || {}), attendanceSchedule };
    }

    if (workSchedule !== undefined) {
      user.workSchedule = workSchedule;
      user.preferences = { ...(user.preferences || {}), workSchedule };
    }

    if (attendanceSettings !== undefined) {
      if (!attendanceSettings || typeof attendanceSettings !== "object" || Array.isArray(attendanceSettings)) {
        return res.status(400).json({ success: false, message: "Attendance settings must be an object." });
      }
      user.attendanceSettings = {
        ...(user.attendanceSettings || {}),
        ...attendanceSettings,
      };
    }

    user.markModified("preferences");
    user.markModified("attendanceSchedule");
    user.markModified("workSchedule");
    user.markModified("attendanceSettings");

    await user.save();
    const safeUserData = safeUser(user);

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user: safeUserData,
      data: safeUserData,
    });
  } catch (error) {
    console.error("Update profile error:", error);

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors || {}).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(" ") || "Invalid profile details.",
      });
    }

    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// ==========================================
// PATCH/PUT /api/auth/change-password
// Change Password
// ==========================================
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string" ||
      !currentPassword ||
      !newPassword
    ) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required.",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters.",
      });
    }

    const user = await User.findById(req.user._id).select("+password");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (isAccountInactive(user)) {
      return res.status(403).json({
        success: false,
        message: "Your account is no longer active.",
      });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect.",
      });
    }

    user.password = newPassword;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password changed successfully.",
    });
  } catch (error) {
    console.error("Change password error:", error);

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors || {}).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(" ") || "Invalid password.",
      });
    }

    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// ==========================================
// POST /api/auth/logout
// Logout User
// ==========================================
const logout = (req, res) => {
  res.clearCookie("token", getCookieOptions());
  return res.status(200).json({ success: true, message: "Logout successful." });
};

module.exports = {
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
  logout,
};
