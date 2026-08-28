const express = require('express');
const {
  createLeaveRequest,
  getLeaveRequests,
  getMyLeaveRequests,
  getLeaveRequestById,
  updateLeaveRequest,
  cancelLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
  deleteLeaveRequest
} = require('../controllers/leaveRequestController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

// Apply auth middleware to all leave request routes
router.use(protect);

// ── Static routes (Must be defined before /:id) ─────────────────────────────
router.get('/my', getMyLeaveRequests);

// ── Main collection routes ──────────────────────────────────────────────────
router.get('/', getLeaveRequests);
router.post('/', createLeaveRequest);

// ── Single item & Update operations ─────────────────────────────────────────
router.get('/:id', getLeaveRequestById);
router.put('/:id', updateLeaveRequest);
router.patch('/:id', updateLeaveRequest);

// ── Status operations ───────────────────────────────────────────────────────
router.put('/:id/cancel', cancelLeaveRequest);
router.patch('/:id/cancel', cancelLeaveRequest);

// ── Admin / Management routes ───────────────────────────────────────────────
router.put('/:id/approve', authorize('admin', 'manager'), approveLeaveRequest);
router.patch('/:id/approve', authorize('admin', 'manager'), approveLeaveRequest);
router.put('/:id/reject', authorize('admin', 'manager'), rejectLeaveRequest);
router.patch('/:id/reject', authorize('admin', 'manager'), rejectLeaveRequest);

// ── Delete route ────────────────────────────────────────────────────────────
router.delete('/:id', deleteLeaveRequest);

module.exports = router;