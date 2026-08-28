const express = require('express');
const {
  getOverviewAnalytics,
  getTaskAnalytics,
  getLeadAnalytics,
  getCallAnalytics,
  getConversationAnalytics
} = require('../controllers/analyticsController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/', getOverviewAnalytics);
router.get('/overview', getOverviewAnalytics);
router.get('/dashboard', getOverviewAnalytics);
router.get('/tasks', getTaskAnalytics);
router.get('/leads', getLeadAnalytics);
router.get('/calls', getCallAnalytics);
router.get('/conversations', getConversationAnalytics);

module.exports = router;