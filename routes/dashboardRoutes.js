const express = require('express');
const {
  getStats,
  getSummary,
  getActivity,
  getChartData
} = require('../controllers/dashboardController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

// OPTIMIZATION: Simple in-memory response cache for high-frequency admin dashboard endpoints 
// to bypass repetitive database queries and make dashboard load instantly (TTL: 15 seconds).
const dashboardCache = new Map();
const CACHE_TTL = 15000;

const cacheMiddleware = (req, res, next) => {
  if (req.method !== 'GET') {
    return next();
  }

  const key = `${req.originalUrl || req.url}_${req.user?._id || 'anon'}`;
  const cached = dashboardCache.get(key);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return res.status(200).json(cached.data);
  }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode === 200 && body?.success !== false) {
      dashboardCache.set(key, { data: body, timestamp: Date.now() });
    }
    return originalJson(body);
  };

  next();
};

router.use(protect);
router.use(cacheMiddleware);

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