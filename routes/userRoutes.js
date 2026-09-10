const express = require("express");

// =====================================================
// USER CONTROLLER
// =====================================================

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

// =====================================================
// ATTENDANCE CONTROLLER
// =====================================================

let getUserAttendanceSchedule = null;
let setUserAttendanceSchedule = null;

try {
  const attendanceController = require("../controllers/attendanceController");

  getUserAttendanceSchedule =
    attendanceController.getUserAttendanceSchedule;

  setUserAttendanceSchedule =
    attendanceController.setUserAttendanceSchedule;
} catch (e) {
  // If attendanceController doesn't export them,
  // fallback gracefully.
}

// Fallback handlers if attendance controller functions
// are not defined.
const handleGetSchedule =
  getUserAttendanceSchedule || getUserById;

const handleSetSchedule =
  setUserAttendanceSchedule || updateUser;

// =====================================================
// AUTH MIDDLEWARE
// =====================================================

const {
  protect,
  authorize,
} = require("../middleware/authMiddleware");

const router = express.Router();

// =====================================================
// AUTHENTICATION
// =====================================================

// All user routes require authentication.
router.use(protect);

// =====================================================
// PROFILE ROUTES
// IMPORTANT: BEFORE /:id
// =====================================================

router.get("/profile", getProfile);
router.put("/profile", updateProfile);
router.patch("/profile", updateProfile);

// =====================================================
// CHANGE PASSWORD
// =====================================================

router.put("/profile/password", changePassword);
router.patch("/profile/password", changePassword);

// =====================================================
// BACKWARD COMPATIBLE CHANGE PASSWORD
// =====================================================

router.put("/change-password", changePassword);
router.patch("/change-password", changePassword);

// =====================================================
// USER STATISTICS
// ADMIN + MANAGER
// =====================================================

router.get("/stats", authorize("admin", "manager"), getUserStats);

// =====================================================
// GET ALL USERS
// ADMIN + MANAGER
// =====================================================

router.get("/", authorize("admin", "manager"), getUsers);

// =====================================================
// CREATE USER
// ADMIN + MANAGER
// =====================================================

router.post("/", authorize("admin", "manager"), createUser);

// =====================================================
// ATTENDANCE SCHEDULE
// ADMIN + MANAGER
// =====================================================

router.get("/:id/attendance-schedule", authorize("admin", "manager"), handleGetSchedule);
router.put("/:id/attendance-schedule", authorize("admin", "manager"), handleSetSchedule);
router.patch("/:id/attendance-schedule", authorize("admin", "manager"), handleSetSchedule);

// =====================================================
// USER STATUS
// ADMIN + MANAGER
// =====================================================

router.put("/:id/status", authorize("admin", "manager"), updateUserStatus);
router.patch("/:id/status", authorize("admin", "manager"), updateUserStatus);

// =====================================================
// USER ROLE
// ADMIN ONLY
// =====================================================

router.put("/:id/role", authorize("admin"), updateUserRole);
router.patch("/:id/role", authorize("admin"), updateUserRole);

// =====================================================
// GET USER BY ID
// ADMIN + MANAGER
// =====================================================

router.get("/:id", authorize("admin", "manager"), getUserById);

// =====================================================
// UPDATE USER
// ADMIN + MANAGER
// =====================================================

router.put("/:id", authorize("admin", "manager"), updateUser);
router.patch("/:id", authorize("admin", "manager"), updateUser);

// =====================================================
// DELETE USER
// ADMIN ONLY
// =====================================================

router.delete("/:id", authorize("admin"), deleteUser);

// =====================================================
// EXPORT
// =====================================================

module.exports = router;