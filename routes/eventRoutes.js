const express = require('express');
const {
  createEvent,
  getEvents,
  getEventById,
  updateEvent,
  cancelEvent,
  deleteEvent,
  getEventStats
} = require('../controllers/eventController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Apply auth middleware to all event/calendar/appointment routes
router.use(protect);

// ── Static routes ───────────────────────────────────────────────────────────
router.get('/stats', getEventStats);
router.get('/upcoming', (req, res) => {
  req.query.upcoming = 'true';
  return getEvents(req, res);
});

// ── Event Collection Routes ─────────────────────────────────────────────────
router.get('/', getEvents);
router.post('/', createEvent);

// ── Single Event Routes ─────────────────────────────────────────────────────
router.get('/:id', getEventById);
router.put('/:id', updateEvent);
router.patch('/:id', updateEvent);
router.put('/:id/cancel', cancelEvent);
router.patch('/:id/cancel', cancelEvent);
router.delete('/:id', deleteEvent);

module.exports = router;