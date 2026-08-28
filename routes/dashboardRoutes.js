const express = require('express');
const {
  getStats,
  getSummary,
  getActivity,
  getChartData
} = require('../controllers/dashboardController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get(
  '/stats',
  authorize('admin', 'manager'),
  getStats
);

router.get(
  '/summary',
  getSummary
);

router.get(
  '/activity',
  authorize('admin', 'manager'),
  getActivity
);

router.get(
  '/chart-data',
  authorize('admin', 'manager'),
  getChartData
);

module.exports = router;