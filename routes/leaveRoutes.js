import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  createLeaveRequest,
  getLeaves,
  updateLeaveStatus,
} from "../controllers/leaveController.js";

const router = express.Router();

// All leave routes require authentication
router.use(protect);

router.route("/").get(getLeaves).post(createLeaveRequest);
router.patch("/:id/status", updateLeaveStatus);

export default router;