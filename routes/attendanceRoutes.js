const express = require("express");

const {
  checkIn,
  checkOut,

  // Attendance flow
  markAttendance,
  getTodayAttendance,

  // Attendance history
  getMyAttendance,
  getAttendanceSummary,

  // Admin / Manager
  getAttendanceList,
  getAttendanceById,
  createManualAttendance,
  updateAttendance,
  deleteAttendance,

  // Admin attendance schedule
  setUserAttendanceSchedule,
  getUserAttendanceSchedule,
} = require("../controllers/attendanceController");

const {
  protect,
  authorize,
} = require("../middleware/authMiddleware");

const router = express.Router();

// ============================================================
// ALL ATTENDANCE ROUTES REQUIRE AUTHENTICATION
// ============================================================

router.use(protect);

// ============================================================
// USER ATTENDANCE
// ============================================================

// ------------------------------------------------------------
// MARK TODAY'S ATTENDANCE
// POST /api/attendance/mark
// ------------------------------------------------------------

router.post(
  "/mark",
  authorize("user", "admin", "manager"),
  markAttendance
);

// ------------------------------------------------------------
// GET TODAY'S ATTENDANCE
// GET /api/attendance/today
// ------------------------------------------------------------

router.get(
  "/today",
  authorize("user", "admin", "manager"),
  getTodayAttendance
);

// ------------------------------------------------------------
// GET CURRENT USER ATTENDANCE HISTORY
// GET /api/attendance/my
// ------------------------------------------------------------

router.get(
  "/my",
  authorize("user", "admin", "manager"),
  getMyAttendance
);

// ------------------------------------------------------------
// GET ATTENDANCE SUMMARY
// GET /api/attendance/summary
// ------------------------------------------------------------

router.get(
  "/summary",
  authorize("admin", "manager", "user"),
  getAttendanceSummary
);

// ============================================================
// CHECK-IN / CHECK-OUT
// ============================================================

// ------------------------------------------------------------
// CHECK IN
// POST /api/attendance/check-in
// ------------------------------------------------------------

router.post(
  "/check-in",
  authorize("user", "admin", "manager"),
  checkIn
);

// ------------------------------------------------------------
// CHECK OUT
// POST /api/attendance/check-out
// ------------------------------------------------------------

router.post(
  "/check-out",
  authorize("user", "admin", "manager"),
  checkOut
);

// ============================================================
// ADMIN & MANAGER: USER ATTENDANCE SCHEDULE
// ============================================================

// ------------------------------------------------------------
// SET / UPDATE USER ATTENDANCE SCHEDULE
// PUT /api/attendance/user/:userId/schedule
// ------------------------------------------------------------

router.put(
  "/user/:userId/schedule",
  authorize("admin", "manager"),
  setUserAttendanceSchedule
);

// ------------------------------------------------------------
// GET USER ATTENDANCE SCHEDULE
// GET /api/attendance/user/:userId/schedule
// ------------------------------------------------------------

router.get(
  "/user/:userId/schedule",
  authorize("admin", "manager"),
  getUserAttendanceSchedule
);

// ============================================================
// ADMIN / MANAGER ATTENDANCE LIST
// ============================================================

// ------------------------------------------------------------
// GET ALL ATTENDANCE RECORDS
// GET /api/attendance
// ------------------------------------------------------------

router.get(
  "/",
  authorize("admin", "manager"),
  getAttendanceList
);

// ------------------------------------------------------------
// CREATE MANUAL ATTENDANCE
// POST /api/attendance
// ------------------------------------------------------------

router.post(
  "/",
  authorize("admin", "manager"),
  createManualAttendance
);

// ============================================================
// SINGLE ATTENDANCE RECORD
// ============================================================

// ------------------------------------------------------------
// GET SINGLE ATTENDANCE
// GET /api/attendance/:id
// ------------------------------------------------------------

router.get(
  "/:id",
  authorize("admin", "manager", "user"),
  getAttendanceById
);

// ------------------------------------------------------------
// UPDATE ATTENDANCE
// PUT /api/attendance/:id
// ------------------------------------------------------------

router.put(
  "/:id",
  authorize("admin", "manager"),
  updateAttendance
);

// ------------------------------------------------------------
// PARTIAL UPDATE ATTENDANCE
// PATCH /api/attendance/:id
// ------------------------------------------------------------

router.patch(
  "/:id",
  authorize("admin", "manager"),
  updateAttendance
);

// ------------------------------------------------------------
// DELETE ATTENDANCE
// DELETE /api/attendance/:id
// ------------------------------------------------------------

router.delete(
  "/:id",
  authorize("admin", "manager"),
  deleteAttendance
);

// ============================================================
// EXPORT
// ============================================================

module.exports = router;