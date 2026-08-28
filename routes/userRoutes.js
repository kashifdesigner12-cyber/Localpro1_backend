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
  getUserAttendanceSchedule = attendanceController.getUserAttendanceSchedule;
  setUserAttendanceSchedule = attendanceController.setUserAttendanceSchedule;
} catch (e) {
  // If attendanceController doesn't export them, fallback gracefully
}

// Fallback handlers if attendance controller functions are not defined
const handleGetSchedule = getUserAttendanceSchedule || getUserById;
const handleSetSchedule = setUserAttendanceSchedule || updateUser;

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

router.use(protect);

// =====================================================
// PROFILE ROUTES
// IMPORTANT: BEFORE /:id
// =====================================================

// GET /api/users/profile
router.get(
  "/profile",
  getProfile
);

// PUT /api/users/profile
router.put(
  "/profile",
  updateProfile
);

// PATCH /api/users/profile
router.patch(
  "/profile",
  updateProfile
);

// =====================================================
// CHANGE PASSWORD
// =====================================================

// PUT /api/users/profile/password
router.put(
  "/profile/password",
  changePassword
);

// PATCH /api/users/profile/password
router.patch(
  "/profile/password",
  changePassword
);

// =====================================================
// BACKWARD COMPATIBLE CHANGE PASSWORD
// =====================================================

// PUT /api/users/change-password
router.put(
  "/change-password",
  changePassword
);

// PATCH /api/users/change-password
router.patch(
  "/change-password",
  changePassword
);

// =====================================================
// USER STATISTICS
// ADMIN + MANAGER
// =====================================================

// GET /api/users/stats
router.get(
  "/stats",
  authorize("admin", "manager"),
  getUserStats
);

// =====================================================
// GET ALL USERS
// ADMIN + MANAGER
// =====================================================

// GET /api/users
router.get(
  "/",
  authorize("admin", "manager"),
  getUsers
);

// =====================================================
// CREATE USER
// ADMIN + MANAGER
// =====================================================

// POST /api/users
router.post(
  "/",
  authorize("admin", "manager"),
  createUser
);

// =====================================================
// ATTENDANCE SCHEDULE
// ADMIN + MANAGER
// =====================================================

// -----------------------------------------------------
// GET USER ATTENDANCE SCHEDULE
// GET /api/users/:id/attendance-schedule
// -----------------------------------------------------

router.get(
  "/:id/attendance-schedule",
  authorize("admin", "manager"),
  handleGetSchedule
);

// -----------------------------------------------------
// PUT USER ATTENDANCE SCHEDULE
// PUT /api/users/:id/attendance-schedule
// -----------------------------------------------------

router.put(
  "/:id/attendance-schedule",
  authorize("admin", "manager"),
  handleSetSchedule
);

// -----------------------------------------------------
// PATCH USER ATTENDANCE SCHEDULE
// PATCH /api/users/:id/attendance-schedule
// -----------------------------------------------------

router.patch(
  "/:id/attendance-schedule",
  authorize("admin", "manager"),
  handleSetSchedule
);

// =====================================================
// USER STATUS
// ADMIN + MANAGER
// =====================================================

// PUT /api/users/:id/status
router.put(
  "/:id/status",
  authorize("admin", "manager"),
  updateUserStatus
);

// PATCH /api/users/:id/status
router.patch(
  "/:id/status",
  authorize("admin", "manager"),
  updateUserStatus
);

// =====================================================
// USER ROLE
// ADMIN ONLY
// =====================================================

// PUT /api/users/:id/role
router.put(
  "/:id/role",
  authorize("admin"),
  updateUserRole
);

// PATCH /api/users/:id/role
router.patch(
  "/:id/role",
  authorize("admin"),
  updateUserRole
);

// =====================================================
// GET USER BY ID
// ADMIN + MANAGER
// =====================================================

// GET /api/users/:id
router.get(
  "/:id",
  authorize("admin", "manager"),
  getUserById
);

// =====================================================
// UPDATE USER
// ADMIN + MANAGER
// =====================================================

// PUT /api/users/:id
router.put(
  "/:id",
  authorize("admin", "manager"),
  updateUser
);

// PATCH /api/users/:id
router.patch(
  "/:id",
  authorize("admin", "manager"),
  updateUser
);

// =====================================================
// DELETE USER
// ADMIN ONLY
// =====================================================

// DELETE /api/users/:id
router.delete(
  "/:id",
  authorize("admin"),
  deleteUser
);

// =====================================================
// EXPORT
// =====================================================

module.exports = router;