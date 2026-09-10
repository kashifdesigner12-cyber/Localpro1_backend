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

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);

// ==========================================
// PROTECTED AUTH ROUTES
// ==========================================

router.get("/me", protect, getMe);
router.put("/me", protect, updateProfile);
router.put("/profile", protect, updateProfile);

router.patch("/change-password", protect, changePassword);
router.put("/change-password", protect, changePassword);

// ==========================================
// EXPORT
// ==========================================
module.exports = router;