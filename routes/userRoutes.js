const express = require("express");

const {
  getUsers,
  getUserStats,
  getUserById,
  createUser,
  updateUser,
  updateUserStatus,
  updateUserRole,
  deleteUser,
  getProfile,
  updateProfile,
  changePassword,
} = require("../controllers/userController");

const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

// Every endpoint in this router requires a valid authenticated user.
router.use(protect);

// Profile routes must be declared before routes containing /:id.
router.get("/profile", getProfile);
router.put("/profile", updateProfile);
router.patch("/profile", updateProfile);

router.put("/profile/password", changePassword);
router.patch("/profile/password", changePassword);

// Backward-compatible aliases for clients using the older endpoint.
router.put("/change-password", changePassword);
router.patch("/change-password", changePassword);

// User listing and creation are restricted to admin/manager roles.
router.get("/stats", authorize("admin", "manager"), getUserStats);
router.get("/", authorize("admin", "manager"), getUsers);
router.post("/", authorize("admin", "manager"), createUser);

// Attendance schedules are optional until the attendance controller implements
// the dedicated handlers. Never substitute general user handlers here.
let attendanceController = {};

try {
  attendanceController = require("../controllers/attendanceController");
} catch (error) {
  // Only tolerate the controller itself being absent. Re-throw errors caused by
  // missing dependencies or bugs inside an existing attendance controller.
  const isMissingAttendanceController =
    error &&
    error.code === "MODULE_NOT_FOUND" &&
    typeof error.message === "string" &&
    error.message.includes("../controllers/attendanceController");

  if (!isMissingAttendanceController) {
    throw error;
  }
}

const unavailableScheduleHandler = (_req, res) =>
  res.status(501).json({
    success: false,
    message: "Attendance schedule endpoints are not configured.",
  });

const getUserAttendanceSchedule =
  typeof attendanceController.getUserAttendanceSchedule === "function"
    ? attendanceController.getUserAttendanceSchedule
    : unavailableScheduleHandler;

const setUserAttendanceSchedule =
  typeof attendanceController.setUserAttendanceSchedule === "function"
    ? attendanceController.setUserAttendanceSchedule
    : unavailableScheduleHandler;

// These specific routes must stay above router.get("/:id", ...).
router.get(
  "/:id/attendance-schedule",
  authorize("admin", "manager"),
  getUserAttendanceSchedule
);
router.put(
  "/:id/attendance-schedule",
  authorize("admin", "manager"),
  setUserAttendanceSchedule
);
router.patch(
  "/:id/attendance-schedule",
  authorize("admin", "manager"),
  setUserAttendanceSchedule
);

// Admin/manager can manage status; only admin can change roles or delete users.
router.put("/:id/status", authorize("admin", "manager"), updateUserStatus);
router.patch("/:id/status", authorize("admin", "manager"), updateUserStatus);

router.put("/:id/role", authorize("admin"), updateUserRole);
router.patch("/:id/role", authorize("admin"), updateUserRole);

router.get("/:id", authorize("admin", "manager"), getUserById);
router.put("/:id", authorize("admin", "manager"), updateUser);
router.patch("/:id", authorize("admin", "manager"), updateUser);

router.delete("/:id", authorize("admin"), deleteUser);

module.exports = router;