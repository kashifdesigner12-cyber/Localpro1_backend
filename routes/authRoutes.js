
import express from "express";

import {
  login,
  logout,
  getMe,
  setupPassword,
  updateMyProfile,
  getMyPreferences,
  updateMyPreferences,
  changeMyPassword,
} from "../controllers/authController.js";

import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Public authentication routes
router.post("/login", login);
router.post("/logout", logout);
router.post("/setup-password", setupPassword);

// Authenticated user routes
router.get("/me", protect, getMe);
router.patch("/me", protect, updateMyProfile);

router.get("/preferences", protect, getMyPreferences);
router.patch("/preferences", protect, updateMyPreferences);
router.patch("/change-password", protect, changeMyPassword);

export default router;
