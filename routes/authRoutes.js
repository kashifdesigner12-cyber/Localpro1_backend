const express = require("express");

const {
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
  logout,
} = require("../controllers/authController");

const {
  protect,
} = require("../middleware/authMiddleware");

const router = express.Router();

// ==========================================
// PUBLIC AUTH ROUTES
// ==========================================

// ==========================================
// POST /api/auth/register
// Register
// ==========================================
router.post(
  "/register",
  register
);

// ==========================================
// POST /api/auth/login
// Login
// ==========================================
router.post(
  "/login",
  login
);

// ==========================================
// POST /api/auth/logout
// Logout
// ==========================================
router.post(
  "/logout",
  logout
);

// ==========================================
// PROTECTED AUTH ROUTES
// ==========================================

// ==========================================
// GET /api/auth/me
// Get Current Logged-in User
// ==========================================
router.get(
  "/me",
  protect,
  getMe
);

// ==========================================
// PUT /api/auth/me
// Update Current User Profile
// ==========================================
router.put(
  "/me",
  protect,
  updateProfile
);

// ==========================================
// PUT /api/auth/profile
// Backward Compatibility
// ==========================================
router.put(
  "/profile",
  protect,
  updateProfile
);

// ==========================================
// PATCH /api/auth/change-password
// Change Password
// ==========================================
router.patch(
  "/change-password",
  protect,
  changePassword
);

// ==========================================
// PUT /api/auth/change-password
// Backward Compatibility
// ==========================================
router.put(
  "/change-password",
  protect,
  changePassword
);

// ==========================================
// EXPORT
// ==========================================
module.exports = router;