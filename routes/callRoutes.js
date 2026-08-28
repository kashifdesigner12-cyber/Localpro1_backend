const express = require('express');
const {
  getCalls,
  getCall,
  createCall,
  updateCall,
  deleteCall,
  getCallStats,
  generateBrowserToken
} = require('../controllers/callController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

// ── Static routes (Defined before /:id) ─────────────────────────────────────
router.get('/stats', getCallStats);
router.post('/token', generateBrowserToken);
router.post('/log', createCall);

// ── Collection routes ───────────────────────────────────────────────────────
router.get('/', getCalls);
router.post('/', createCall);

// ── Single call routes ──────────────────────────────────────────────────────
router.get('/:id', getCall);
router.put('/:id', updateCall);
router.patch('/:id', updateCall);
router.delete('/:id', deleteCall);

module.exports = router;