const mongoose = require('mongoose');
const Event = require('../models/Event');
const User = require('../models/User');
const { createNotification } = require('./notificationController');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const VALID_EVENT_TYPES = ['meeting', 'task', 'reminder', 'call', 'holiday', 'appointment', 'other'];
const VALID_EVENT_STATUSES = ['scheduled', 'completed', 'cancelled'];

// Helper to format safe user reference
const safeUserRef = (u) => {
  if (!u) return null;
  if (typeof u === 'object' && u._id) {
    return {
      id: u._id,
      _id: u._id,
      name: u.name,
      email: u.email,
      role: u.role,
      avatar: u.avatar !== undefined ? u.avatar : null
    };
  }
  return u;
};

// Helper to format safe contact reference
const safeContactRef = (c) => {
  if (!c) return null;
  if (typeof c === 'object' && c._id) {
    return {
      id: c._id,
      _id: c._id,
      name: c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim(),
      email: c.email || undefined,
      phone: c.phone || undefined,
      company: c.company || undefined
    };
  }
  return c;
};

// Safe event response serializer
const safeEvent = (e) => {
  if (!e) return null;
  const participants = Array.isArray(e.participants) && e.participants.length > 0
    ? e.participants.map(safeUserRef)
    : (Array.isArray(e.attendees) ? e.attendees.map(safeUserRef) : []);

  return {
    id: e._id,
    _id: e._id,
    title: e.title,
    description: e.description || '',
    notes: e.notes || '',
    startDate: e.startDate,
    endDate: e.endDate,
    startTime: e.startTime || '',
    endTime: e.endTime || '',
    allDay: e.allDay || false,
    location: e.location || '',
    type: e.type || e.eventType || 'meeting',
    eventType: e.eventType || e.type || 'meeting',
    color: e.color || '#3B82F6',
    status: e.status || 'scheduled',
    createdBy: safeUserRef(e.createdBy),
    assignedTo: safeUserRef(e.assignedTo),
    contact: safeContactRef(e.contact || e.contactId),
    contactId: e.contact ? (e.contact._id || e.contact) : (e.contactId ? (e.contactId._id || e.contactId) : null),
    participants,
    attendees: participants,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt
  };
};

// ─── EVENT & APPOINTMENT CONTROLLER ENDPOINTS ───────────────────────────────

// POST /api/events or POST /api/appointments (authenticated user)
const createEvent = async (req, res) => {
  try {
    const {
      title,
      description,
      notes,
      startDate,
      endDate,
      startTime,
      endTime,
      allDay,
      location,
      type,
      eventType,
      color,
      status,
      assignedTo,
      contact,
      contactId,
      participants,
      attendees
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Title is required.' });
    }

    if (!startDate) {
      return res.status(400).json({ success: false, message: 'Start date is required.' });
    }

    const start = new Date(startDate);
    if (isNaN(start.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid start date.' });
    }

    let end;
    if (endDate) {
      end = new Date(endDate);
      if (isNaN(end.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid end date.' });
      }
      if (end < start) {
        return res.status(400).json({ success: false, message: 'End date cannot be before start date.' });
      }
    } else {
      end = new Date(start.getTime() + 60 * 60 * 1000);
    }

    const resolvedType = eventType || type || 'meeting';
    if (resolvedType && !VALID_EVENT_TYPES.includes(resolvedType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid event type. Allowed: ${VALID_EVENT_TYPES.join(', ')}.`
      });
    }

    if (status && !VALID_EVENT_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${VALID_EVENT_STATUSES.join(', ')}.`
      });
    }

    let validAssignee = null;
    if (assignedTo) {
      if (!isValidObjectId(assignedTo)) {
        return res.status(400).json({ success: false, message: 'Invalid assignedTo user ID.' });
      }
      const userExists = await User.findById(assignedTo);
      if (!userExists) {
        return res.status(404).json({ success: false, message: 'Assigned user not found.' });
      }
      validAssignee = assignedTo;
    }

    const targetContactId = contact || contactId || null;
    if (targetContactId && !isValidObjectId(targetContactId)) {
      return res.status(400).json({ success: false, message: 'Invalid contact ID.' });
    }

    const rawParticipants = attendees || participants || [];
    let validParticipants = [];
    if (Array.isArray(rawParticipants) && rawParticipants.length > 0) {
      for (const p of rawParticipants) {
        const pId = typeof p === 'object' && p._id ? p._id : p;
        if (isValidObjectId(pId)) {
          validParticipants.push(pId);
        }
      }
    }

    const event = await Event.create({
      title: title.trim(),
      description: description ? description.trim() : '',
      notes: notes ? notes.trim() : '',
      startDate: start,
      endDate: end,
      startTime: startTime || '',
      endTime: endTime || '',
      allDay: Boolean(allDay),
      location: location ? location.trim() : '',
      type: resolvedType,
      eventType: resolvedType,
      color: color || '#3B82F6',
      status: status || 'scheduled',
      createdBy: req.user._id,
      assignedTo: validAssignee,
      contact: targetContactId,
      contactId: targetContactId,
      participants: validParticipants,
      attendees: validParticipants
    });

    const populated = await Event.findById(event._id)
      .populate('createdBy', 'name email role avatar')
      .populate('assignedTo', 'name email role avatar')
      .populate('participants', 'name email role avatar')
      .populate('attendees', 'name email role avatar')
      .populate('contact', 'name firstName lastName email phone company');

    // Send notifications to assignee and participants
    const notifyTargets = new Set();
    if (validAssignee && validAssignee.toString() !== req.user._id.toString()) {
      notifyTargets.add(validAssignee.toString());
    }
    for (const p of validParticipants) {
      if (p.toString() !== req.user._id.toString()) {
        notifyTargets.add(p.toString());
      }
    }

    for (const targetId of notifyTargets) {
      try {
        await createNotification({
          userId: targetId,
          type: 'event',
          title: 'Event/Appointment Invitation',
          message: `You were added to "${event.title}".`,
          relatedId: event._id,
          relatedType: 'Event',
          actionUrl: '/dashboard/calendar',
          metadata: { eventId: event._id, title: event.title, startDate: event.startDate }
        });
      } catch (notifErr) {
        console.error('Event notification error:', notifErr.message);
      }
    }

    const formattedEvent = safeEvent(populated);

    res.status(201).json({
      success: true,
      message: 'Event created successfully.',
      event: formattedEvent,
      appointment: formattedEvent,
      data: formattedEvent
    });
  } catch (error) {
    console.error('createEvent error:', error);
    res.status(500).json({ success: false, message: 'Server error creating event.' });
  }
};

// GET /api/events or GET /api/calendar or GET /api/appointments (authenticated user)
const getEvents = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      type,
      eventType,
      status,
      search,
      month,
      year,
      upcoming,
      contact,
      contactId,
      assignedTo,
      page = 1,
      limit = 100
    } = req.query;

    const filter = {};
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';

    if (!isAdminOrManager) {
      filter.$or = [
        { createdBy: req.user._id },
        { assignedTo: req.user._id },
        { participants: req.user._id },
        { attendees: req.user._id }
      ];
    } else if (assignedTo) {
      if (!isValidObjectId(assignedTo)) {
        return res.status(400).json({ success: false, message: 'Invalid assignedTo filter ID.' });
      }
      filter.assignedTo = assignedTo;
    }

    if (upcoming === 'true') {
      filter.startDate = { $gte: new Date() };
    } else if (startDate || endDate) {
      filter.startDate = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) filter.startDate.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) filter.startDate.$lte = end;
      }
    } else if (month && year) {
      const monthNum = parseInt(month) - 1;
      const yearNum = parseInt(year);
      const startOfMonth = new Date(Date.UTC(yearNum, monthNum, 1));
      const endOfMonth = new Date(Date.UTC(yearNum, monthNum + 1, 0, 23, 59, 59, 999));
      filter.startDate = { $gte: startOfMonth, $lte: endOfMonth };
    }

    const resolvedType = eventType || type;
    if (resolvedType) {
      if (!VALID_EVENT_TYPES.includes(resolvedType)) {
        return res.status(400).json({
          success: false,
          message: `Invalid event type filter. Allowed: ${VALID_EVENT_TYPES.join(', ')}.`
        });
      }
      filter.$and = filter.$and || [];
      filter.$and.push({ $or: [{ type: resolvedType }, { eventType: resolvedType }] });
    }

    if (status) {
      if (!VALID_EVENT_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid event status filter. Allowed: ${VALID_EVENT_STATUSES.join(', ')}.`
        });
      }
      filter.status = status;
    }

    const targetContact = contact || contactId;
    if (targetContact) {
      if (!isValidObjectId(targetContact)) {
        return res.status(400).json({ success: false, message: 'Invalid contact filter ID.' });
      }
      filter.$and = filter.$and || [];
      filter.$and.push({ $or: [{ contact: targetContact }, { contactId: targetContact }] });
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      if (filter.$or) {
        filter.$and = filter.$and || [];
        filter.$and.push({
          $or: [{ title: regex }, { description: regex }, { location: regex }, { notes: regex }]
        });
      } else {
        filter.$or = [{ title: regex }, { description: regex }, { location: regex }, { notes: regex }];
      }
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 100));
    const skip = (pageNum - 1) * limitNum;

    const [events, total] = await Promise.all([
      Event.find(filter)
        .populate('createdBy', 'name email role avatar')
        .populate('assignedTo', 'name email role avatar')
        .populate('participants', 'name email role avatar')
        .populate('attendees', 'name email role avatar')
        .populate('contact', 'name firstName lastName email phone company')
        .sort({ startDate: 1 })
        .skip(skip)
        .limit(limitNum),
      Event.countDocuments(filter)
    ]);

    const formatted = events.map(safeEvent);

    res.status(200).json({
      success: true,
      events: formatted,
      appointments: formatted,
      data: formatted,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 0
      }
    });
  } catch (error) {
    console.error('getEvents error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving events.' });
  }
};

// GET /api/events/stats or GET /api/appointments/stats
const getEventStats = async (req, res) => {
  try {
    const filter = {};
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';

    if (!isAdminOrManager) {
      filter.$or = [
        { createdBy: req.user._id },
        { assignedTo: req.user._id },
        { participants: req.user._id },
        { attendees: req.user._id }
      ];
    }

    const now = new Date();

    const [total, upcoming, completed, cancelled, byType, byStatus] = await Promise.all([
      Event.countDocuments(filter),
      Event.countDocuments({ ...filter, startDate: { $gte: now }, status: 'scheduled' }),
      Event.countDocuments({ ...filter, status: 'completed' }),
      Event.countDocuments({ ...filter, status: 'cancelled' }),
      Event.aggregate([{ $match: filter }, { $group: { _id: '$type', count: { $sum: 1 } } }]),
      Event.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }])
    ]);

    res.status(200).json({
      success: true,
      stats: {
        total,
        upcoming,
        completed,
        cancelled,
        byType,
        byStatus
      },
      data: {
        total,
        upcoming,
        completed,
        cancelled,
        byType,
        byStatus
      }
    });
  } catch (error) {
    console.error('getEventStats error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving event stats.' });
  }
};

// GET /api/events/:id (authenticated user)
const getEventById = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid event ID.' });
    }

    const event = await Event.findById(req.params.id)
      .populate('createdBy', 'name email role avatar')
      .populate('assignedTo', 'name email role avatar')
      .populate('participants', 'name email role avatar')
      .populate('attendees', 'name email role avatar')
      .populate('contact', 'name firstName lastName email phone company');

    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    const isCreator = event.createdBy && (event.createdBy._id ? event.createdBy._id.toString() : event.createdBy.toString()) === req.user._id.toString();
    const isAssignee = event.assignedTo && (event.assignedTo._id ? event.assignedTo._id.toString() : event.assignedTo.toString()) === req.user._id.toString();
    const isParticipant = (Array.isArray(event.participants) &&
      event.participants.some((p) => (p._id ? p._id.toString() : p.toString()) === req.user._id.toString())) ||
      (Array.isArray(event.attendees) &&
      event.attendees.some((p) => (p._id ? p._id.toString() : p.toString()) === req.user._id.toString()));

    if (!isAdminOrManager && !isCreator && !isAssignee && !isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view this event.'
      });
    }

    const formatted = safeEvent(event);

    res.status(200).json({
      success: true,
      event: formatted,
      appointment: formatted,
      data: formatted
    });
  } catch (error) {
    console.error('getEventById error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving event.' });
  }
};

// PUT /api/events/:id or PATCH /api/events/:id (authenticated user)
const updateEvent = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid event ID.' });
    }

    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    const isCreator = event.createdBy && event.createdBy.toString() === req.user._id.toString();

    if (!isAdminOrManager && !isCreator) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only the event creator or an admin can update this event.'
      });
    }

    const {
      title,
      description,
      notes,
      startDate,
      endDate,
      startTime,
      endTime,
      allDay,
      location,
      type,
      eventType,
      color,
      status,
      assignedTo,
      contact,
      contactId,
      participants,
      attendees
    } = req.body;

    if (title !== undefined) {
      if (!title || !title.trim()) {
        return res.status(400).json({ success: false, message: 'Event title cannot be empty.' });
      }
      event.title = title.trim();
    }

    if (description !== undefined) {
      event.description = description ? description.trim() : '';
    }

    if (notes !== undefined) {
      event.notes = notes ? notes.trim() : '';
    }

    if (startDate !== undefined) {
      const parsedStart = new Date(startDate);
      if (isNaN(parsedStart.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid start date.' });
      }
      event.startDate = parsedStart;
    }

    if (endDate !== undefined) {
      const parsedEnd = new Date(endDate);
      if (isNaN(parsedEnd.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid end date.' });
      }
      if (parsedEnd < event.startDate) {
        return res.status(400).json({ success: false, message: 'End date cannot be before start date.' });
      }
      event.endDate = parsedEnd;
    }

    if (startTime !== undefined) event.startTime = startTime;
    if (endTime !== undefined) event.endTime = endTime;
    if (allDay !== undefined) event.allDay = Boolean(allDay);
    if (location !== undefined) event.location = location ? location.trim() : '';
    if (color !== undefined) event.color = color;

    const resolvedType = eventType !== undefined ? eventType : type;
    if (resolvedType !== undefined) {
      if (!VALID_EVENT_TYPES.includes(resolvedType)) {
        return res.status(400).json({
          success: false,
          message: `Invalid event type. Allowed: ${VALID_EVENT_TYPES.join(', ')}.`
        });
      }
      event.type = resolvedType;
      event.eventType = resolvedType;
    }

    if (status !== undefined) {
      if (!VALID_EVENT_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid event status. Allowed: ${VALID_EVENT_STATUSES.join(', ')}.`
        });
      }
      event.status = status;
    }

    if (assignedTo !== undefined) {
      if (assignedTo === null || assignedTo === '') {
        event.assignedTo = null;
      } else {
        if (!isValidObjectId(assignedTo)) {
          return res.status(400).json({ success: false, message: 'Invalid assignedTo user ID.' });
        }
        event.assignedTo = assignedTo;
      }
    }

    const targetContact = contact !== undefined ? contact : contactId;
    if (targetContact !== undefined) {
      if (targetContact === null || targetContact === '') {
        event.contact = null;
        event.contactId = null;
      } else {
        if (!isValidObjectId(targetContact)) {
          return res.status(400).json({ success: false, message: 'Invalid contact ID.' });
        }
        event.contact = targetContact;
        event.contactId = targetContact;
      }
    }

    const rawParticipants = attendees !== undefined ? attendees : participants;
    if (rawParticipants !== undefined && Array.isArray(rawParticipants)) {
      const validP = [];
      for (const p of rawParticipants) {
        const pId = typeof p === 'object' && p._id ? p._id : p;
        if (isValidObjectId(pId)) validP.push(pId);
      }
      event.participants = validP;
      event.attendees = validP;
    }

    await event.save();

    const populated = await Event.findById(event._id)
      .populate('createdBy', 'name email role avatar')
      .populate('assignedTo', 'name email role avatar')
      .populate('participants', 'name email role avatar')
      .populate('attendees', 'name email role avatar')
      .populate('contact', 'name firstName lastName email phone company');

    const formatted = safeEvent(populated);

    res.status(200).json({
      success: true,
      message: 'Event updated successfully.',
      event: formatted,
      appointment: formatted,
      data: formatted
    });
  } catch (error) {
    console.error('updateEvent error:', error);
    res.status(500).json({ success: false, message: 'Server error updating event.' });
  }
};

// PUT /api/events/:id/cancel or PATCH /api/events/:id/cancel
const cancelEvent = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid event ID.' });
    }

    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    const isCreator = event.createdBy && event.createdBy.toString() === req.user._id.toString();

    if (!isAdminOrManager && !isCreator) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only the creator or an admin can cancel this event.'
      });
    }

    event.status = 'cancelled';
    await event.save();

    const populated = await Event.findById(event._id)
      .populate('createdBy', 'name email role avatar')
      .populate('assignedTo', 'name email role avatar')
      .populate('participants', 'name email role avatar')
      .populate('attendees', 'name email role avatar')
      .populate('contact', 'name firstName lastName email phone company');

    const formatted = safeEvent(populated);

    res.status(200).json({
      success: true,
      message: 'Event cancelled successfully.',
      event: formatted,
      appointment: formatted,
      data: formatted
    });
  } catch (error) {
    console.error('cancelEvent error:', error);
    res.status(500).json({ success: false, message: 'Server error cancelling event.' });
  }
};

// DELETE /api/events/:id (authenticated user)
const deleteEvent = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid event ID.' });
    }

    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    const isCreator = event.createdBy && event.createdBy.toString() === req.user._id.toString();

    if (!isAdminOrManager && !isCreator) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only the creator or an admin can delete this event.'
      });
    }

    await Event.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Event deleted successfully.'
    });
  } catch (error) {
    console.error('deleteEvent error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting event.' });
  }
};

module.exports = {
  createEvent,
  createAppointment: createEvent,
  getEvents,
  getAppointments: getEvents,
  getEventById,
  getAppointmentById: getEventById,
  updateEvent,
  updateAppointment: updateEvent,
  cancelEvent,
  cancelAppointment: cancelEvent,
  deleteEvent,
  deleteAppointment: deleteEvent,
  getEventStats,
  getAppointmentStats: getEventStats
};