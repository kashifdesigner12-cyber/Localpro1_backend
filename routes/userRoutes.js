import { Router } from "express";
import mongoose from "mongoose";

import {
  createUser,
  getUsers,
  updateUser,
  deleteUser,
  updateUserStatus,
} from "../controllers/userController.js";

import { protect } from "../middleware/authMiddleware.js";
import allowRoles from "../middleware/roleMiddleware.js";

const router = Router();

const validateUserId = (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid user ID.",
    });
  }

  return next();
};

router.use(protect);

// Allow all authenticated users to fetch users list for chat contacts & task dropdowns
router.get("/", getUsers);

router.post("/", allowRoles("admin"), createUser);

router.patch(
  "/:id/status",
  allowRoles("admin"),
  validateUserId,
  updateUserStatus
);

router.patch(
  "/:id",
  allowRoles("admin"),
  validateUserId,
  updateUser
);

router.delete(
  "/:id",
  allowRoles("admin"),
  validateUserId,
  deleteUser
);

export default router;