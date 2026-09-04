const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { sendWelcomeEmail } = require("../utils/sendEmail");

// ==========================================
// Build Safe User Object
// Includes schedule & preferences data
// ==========================================
const safeUser = (user) => ({
  id: user._id,
  _id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone || "",
  role: user.role,
  status: user.status,
  avatar: user.avatar || null,
  business: user.business || {},
  preferences: user.preferences || {},
  attendanceSettings: user.attendanceSettings || {},
  attendanceSchedule:
    user.attendanceSchedule ||
    user?.preferences?.attendanceSchedule ||
    null,
  workSchedule:
    user.workSchedule ||
    user?.preferences?.workSchedule ||
    null,
  notificationPreferences: user.notificationPreferences || {},
  integrations: user.integrations || {},
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

// ==========================================
// Generate JWT Token
// ==========================================
const generateToken = (id, role) =>
  jwt.sign(
    {
      id,
      role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    }
  );

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

// ==========================================
// POST /api/auth/register
// Register New User
// ==========================================
const register = async (req, res) => {
  try {
    const { name, email, password, phone, role } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required.",
      });
    }

    // Normalize email
    const emailNormalized = email.trim().toLowerCase();

    // Check if user already exists
    const existingUser = await User.findOne({
      email: emailNormalized,
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    // Create user
    const user = await User.create({
      name: name.trim(),
      email: emailNormalized,
      password,
      phone: phone ? phone.trim() : "",
      role: role || "user",
    });

    // Send Welcome Email with credentials
    try {
      await sendWelcomeEmail(user.email, user.name, password);
    } catch (emailError) {
      console.error("Failed to send welcome email:", emailError);
    }

    return res.status(201).json({
      success: true,
      message: "Registration successful. Credentials email sent to user.",
      user: safeUser(user),
    });
  } catch (error) {
    console.error("Register error:", error);

    // MongoDB duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    // Mongoose validation error
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map(
        (err) => err.message
      );

      return res.status(400).json({
        success: false,
        message: messages.join(" "),
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
    const { email, password } = req.body;

    // Validate fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    // Normalize email
    const emailNormalized = email.trim().toLowerCase();

    // Password is select:false in User model,
    // so explicitly select it here.
    const user = await User.findOne({
      email: emailNormalized,
    }).select("+password");

    // User not found
    // This also covers permanently deleted users.
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    // Extra protection for soft-deleted users
    if (user.isDeleted === true) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    // Check account status
    if (user.status === "Pending") {
      return res.status(403).json({
        success: false,
        message: "Your account is pending approval.",
      });
    }

    if (
      user.status === "Blocked" ||
      user.status === "Inactive"
    ) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated or blocked.",
      });
    }

    // Check isActive flag
    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated.",
      });
    }

    // Compare password
    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    // Generate JWT
    const token = generateToken(user._id, user.role);

    // Store JWT inside HttpOnly cookie
    res.cookie("token", token, getCookieOptions());

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      token,
      user: safeUser(user),
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
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated.",
      });
    }

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // Prevent deleted/deactivated users from continuing
    if (user.isDeleted === true || user.isActive === false) {
      return res.status(401).json({
        success: false,
        message: "Your account is no longer active.",
      });
    }

    if (
      user.status === "Blocked" ||
      user.status === "Inactive"
    ) {
      return res.status(401).json({
        success: false,
        message: "Your account is no longer active.",
      });
    }

    return res.status(200).json({
      success: true,
      user: safeUser(user),
      data: safeUser(user),
    });
  } catch (error) {
    console.error("Get me error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// ==========================================
// PUT /api/auth/profile
// PUT /api/auth/me
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
    } = req.body;

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // Update basic info
    if (name !== undefined) {
      if (!name || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Name cannot be empty.",
        });
      }

      user.name = name.trim();
    }

    if (phone !== undefined) {
      user.phone = phone ? phone.trim() : "";
    }

    if (avatar !== undefined) {
      user.avatar = avatar;
    }

    // Update preferences
    if (
      preferences !== undefined &&
      typeof preferences === "object"
    ) {
      user.preferences = {
        ...(user.preferences || {}),
        ...preferences,
      };
    }

    // Update attendance schedule
    if (attendanceSchedule !== undefined) {
      user.attendanceSchedule = attendanceSchedule;

      user.preferences = {
        ...(user.preferences || {}),
        attendanceSchedule,
      };
    }

    // Update work schedule
    if (workSchedule !== undefined) {
      user.workSchedule = workSchedule;

      user.preferences = {
        ...(user.preferences || {}),
        workSchedule,
      };
    }

    // Update attendance settings
    if (
      attendanceSettings !== undefined &&
      typeof attendanceSettings === "object"
    ) {
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
      const messages = Object.values(error.errors).map(
        (err) => err.message
      );

      return res.status(400).json({
        success: false,
        message: messages.join(" "),
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// ==========================================
// PATCH /api/auth/change-password
// PUT /api/auth/change-password
// Change Password
// ==========================================
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message:
          "Current password and new password are required.",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "New password must be at least 6 characters.",
      });
    }

    const user = await User.findById(req.user._id).select(
      "+password"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (user.isDeleted === true || user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Your account is no longer active.",
      });
    }

    const isMatch =
      await user.comparePassword(currentPassword);

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

    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// ==========================================
// POST /api/auth/logout
// Logout User
// ==========================================
const logout = (req, res) => {
  res.clearCookie("token", getCookieOptions());

  return res.status(200).json({
    success: true,
    message: "Logout successful.",
  });
};

// ==========================================
// Export Controllers
// ==========================================
module.exports = {
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
  logout,
};