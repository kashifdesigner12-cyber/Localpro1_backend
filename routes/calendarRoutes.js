const express = require('express');

const {
  getCalendarTasks,
  getCalendarMonth,
  getCalendarDay,
} = require('../controllers/calendarController');

const {
  createEvent,
  getEvents,
  getEventById,
  updateEvent,
  cancelEvent,
  deleteEvent,
  getEventStats,
} = require('../controllers/eventController');

const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

// =====================================================
// CALENDAR TASK ROUTES
// =====================================================

router.get('/tasks', getCalendarTasks);

router.get('/month', getCalendarMonth);

router.get('/day/:date', getCalendarDay);

// =====================================================
// EVENT / APPOINTMENT ROUTES
// =====================================================

router.get('/stats', getEventStats);

router.get('/upcoming', (req, res) => {
  req.query.upcoming = 'true';
  return getEvents(req, res);
});

router.get('/', getEvents);

router.post('/', createEvent);

router.get('/:id', getEventById);

router.put('/:id', updateEvent);

router.patch('/:id', updateEvent);

router.put('/:id/cancel', cancelEvent);

router.patch('/:id/cancel', cancelEvent);

router.delete('/:id', deleteEvent);

module.exports = router;