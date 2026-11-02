
import { Router } from "express";

import {
  checkIn,
  checkOut,
  getAttendance,
  getTodayAttendance,
} from "../controllers/attendanceController.js";

import { protect } from "../middleware/authMiddleware.js";

const router = Router();

router.use(protect);

// Attendance records
router.get("/", getAttendance);

// Today's attendance
router.get("/today", getTodayAttendance);

// Check-in and check-out
router.post("/check-in", checkIn);
router.post("/check-out", checkOut);

export default router;
