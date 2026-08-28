const express = require('express');

const {
  createSignupRequest,
  getSignupRequests,
  getSignupRequestById,
  approveSignupRequest,
  rejectSignupRequest,
  deleteSignupRequest
} = require('../controllers/signupRequestController');

const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

// Public Signup Request
router.post('/', createSignupRequest);

// Admin / Manager only
router.get(
  '/',
  protect,
  authorize('admin', 'manager'),
  getSignupRequests
);

router.get(
  '/:id',
  protect,
  authorize('admin', 'manager'),
  getSignupRequestById
);

// Approve Signup Request
router.put(
  '/:id/approve',
  protect,
  authorize('admin', 'manager'),
  approveSignupRequest
);

router.patch(
  '/:id/approve',
  protect,
  authorize('admin', 'manager'),
  approveSignupRequest
);

// Reject Signup Request
router.put(
  '/:id/reject',
  protect,
  authorize('admin', 'manager'),
  rejectSignupRequest
);

router.patch(
  '/:id/reject',
  protect,
  authorize('admin', 'manager'),
  rejectSignupRequest
);

// Delete Signup Request
router.delete(
  '/:id',
  protect,
  authorize('admin', 'manager'),
  deleteSignupRequest
);

module.exports = router;