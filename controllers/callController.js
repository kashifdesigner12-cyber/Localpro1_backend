const mongoose = require('mongoose');
const Call = require('../models/Call');
const Contact = require('../models/Contact');
const User = require('../models/User');
const { createNotification } = require('./notificationController');

const isValidObjectId = (id) =>
  Boolean(id) && mongoose.Types.ObjectId.isValid(id);

const VALID_DIRECTIONS = ['inbound', 'outbound'];
const VALID_STATUSES = [
  'initiated',
  'ringing',
  'in-progress',
  'answered',
  'completed',
  'busy',
  'no-answer',
  'canceled',
  'failed',
  'missed',
  'voicemail'
];

// Helper to format safe user reference without heavy Base64 payload
const safeUserRef = (u) => {
  if (!u) return null;
  if (typeof u === 'object' && u._id) {
    let cleanAvatar = u.avatar || null;
    if (typeof cleanAvatar === 'string' && cleanAvatar.startsWith('data:image') && cleanAvatar.length > 1000) {
      cleanAvatar = null;
    }

    return {
      id: u._id,
      _id: u._id,
      name: u.name || '',
      email: u.email || '',
      phone: u.phone !== undefined ? u.phone : undefined,
      role: u.role || '',
      avatar: cleanAvatar
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
      company: c.company || undefined,
      status: c.status || undefined
    };
  }
  return c;
};

// Safe call response serializer
const safeCall = (c) => {
  if (!c) return null;
  const user = safeUserRef(c.userId || c.user);
  const contact = safeContactRef(c.contactId || c.contact);

  return {
    id: c._id,
    _id: c._id,
    userId: user ? user.id : (c.userId || c.user),
    user,
    contactId: contact ? contact.id : (c.contactId || c.contact),
    contact,
    conversationId: c.conversationId || null,
    callSid: c.callSid || null,
    from: c.from || '',
    to: c.to || '',
    phoneNumber: c.phoneNumber || c.to || c.from || '',
    direction: c.direction || 'outbound',
    status: c.status || 'initiated',
    duration: c.duration || 0,
    notes: c.notes || '',
    recordingUrl: c.recordingUrl || '',
    startedAt: c.startedAt || null,
    endedAt: c.endedAt || null,
    metadata: c.metadata || {},
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  };
};

// ─── CALL CONTROLLER ENDPOINTS ──────────────────────────────────────────────

// POST /api/calls or POST /api/calls/log (authenticated user)
const createCall = async (req, res) => {
  try {
    const {
      contactId,
      contact,
      phoneNumber,
      from,
      to,
      direction,
      status,
      duration,
      notes,
      recordingUrl,
      startedAt,
      endedAt,
      metadata
    } = req.body;

    const targetContactId = contactId || contact || null;
    if (targetContactId && !isValidObjectId(targetContactId)) {
      return res.status(400).json({ success: false, message: 'Invalid contact ID.' });
    }

    if (targetContactId) {
      const contactExists = await Contact.findById(targetContactId).select('_id').lean();
      if (!contactExists) {
        return res.status(404).json({ success: false, message: 'Contact not found.' });
      }
    }

    const resolvedDirection = direction ? direction.toLowerCase() : 'outbound';
    if (!VALID_DIRECTIONS.includes(resolvedDirection)) {
      return res.status(400).json({
        success: false,
        message: `Invalid direction. Allowed: ${VALID_DIRECTIONS.join(', ')}.`
      });
    }

    const resolvedStatus = status ? status.toLowerCase() : 'completed';
    if (!VALID_STATUSES.includes(resolvedStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}.`
      });
    }

    const resolvedPhone = phoneNumber || to || from || '';
    const now = new Date();
    const parsedStart = startedAt ? new Date(startedAt) : now;
    const parsedEnd = endedAt ? new Date(endedAt) : (duration ? new Date(parsedStart.getTime() + duration * 1000) : null);

    const callRecord = await Call.create({
      userId: req.user._id,
      user: req.user._id,
      contactId: targetContactId,
      contact: targetContactId,
      from: from || (resolvedDirection === 'outbound' ? (req.user.phone || '') : resolvedPhone),
      to: to || (resolvedDirection === 'outbound' ? resolvedPhone : (req.user.phone || '')),
      phoneNumber: resolvedPhone,
      direction: resolvedDirection,
      status: resolvedStatus,
      duration: parseInt(duration, 10) || 0,
      notes: notes ? notes.trim() : '',
      recordingUrl: recordingUrl || '',
      startedAt: isNaN(parsedStart.getTime()) ? now : parsedStart,
      endedAt: parsedEnd && !isNaN(parsedEnd.getTime()) ? parsedEnd : null,
      metadata: metadata || {}
    });

    const populated = await Call.findById(callRecord._id)
      .populate('userId', 'name email role phone avatar')
      .populate('contactId', 'name firstName lastName email phone company status')
      .lean();

    // Trigger notification non-blocking
    if (resolvedStatus === 'missed' || resolvedDirection === 'inbound') {
      (async () => {
        try {
          await createNotification({
            userId: req.user._id,
            type: 'call',
            title: resolvedStatus === 'missed' ? 'Missed Call' : 'Call Logged',
            message: `${resolvedDirection === 'inbound' ? 'Inbound' : 'Outbound'} call ${resolvedPhone ? 'with ' + resolvedPhone : ''} (${resolvedStatus}).`,
            relatedId: callRecord._id,
            relatedType: 'Call',
            actionUrl: '/dashboard/calls',
            metadata: { callId: callRecord._id, status: resolvedStatus, direction: resolvedDirection }
          });
        } catch (notifErr) {
          console.error('Call notification error:', notifErr.message);
        }
      })();
    }

    const formatted = safeCall(populated);

    return res.status(201).json({
      success: true,
      message: 'Call logged successfully.',
      call: formatted,
      data: formatted
    });
  } catch (error) {
    console.error('createCall error:', error);
    return res.status(500).json({ success: false, message: 'Server error logging call.' });
  }
};

// GET /api/calls (authenticated user - user scoped unless admin/manager)
const getCalls = async (req, res) => {
  try {
    const {
      direction,
      status,
      user,
      userId,
      agent,
      contact,
      contactId,
      search,
      startDate,
      endDate,
      sort = '-createdAt',
      page = 1,
      limit = 50
    } = req.query;

    const filter = {};
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';

    if (!isAdminOrManager) {
      filter.$or = [{ userId: req.user._id }, { user: req.user._id }];
    } else {
      const targetUser = user || userId || agent;
      if (targetUser) {
        if (!isValidObjectId(targetUser)) {
          return res.status(400).json({ success: false, message: 'Invalid user/agent ID filter.' });
        }
        filter.$or = [{ userId: targetUser }, { user: targetUser }];
      }
    }

    if (direction) {
      if (!VALID_DIRECTIONS.includes(direction.toLowerCase())) {
        return res.status(400).json({
          success: false,
          message: `Invalid direction filter. Allowed: ${VALID_DIRECTIONS.join(', ')}.`
        });
      }
      filter.direction = direction.toLowerCase();
    }

    if (status) {
      if (!VALID_STATUSES.includes(status.toLowerCase())) {
        return res.status(400).json({
          success: false,
          message: `Invalid status filter. Allowed: ${VALID_STATUSES.join(', ')}.`
        });
      }
      filter.status = status.toLowerCase();
    }

    const targetContact = contact || contactId;
    if (targetContact) {
      if (!isValidObjectId(targetContact)) {
        return res.status(400).json({ success: false, message: 'Invalid contact filter ID.' });
      }
      filter.$and = filter.$and || [];
      filter.$and.push({ $or: [{ contactId: targetContact }, { contact: targetContact }] });
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) filter.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) filter.createdAt.$lte = end;
      }
    }

    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { phoneNumber: regex },
          { from: regex },
          { to: regex },
          { notes: regex }
        ]
      });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    let sortOption = { createdAt: -1 };
    if (sort === 'oldest') sortOption = { createdAt: 1 };
    else if (sort === 'duration') sortOption = { duration: -1 };
    else if (sort === 'startedAt') sortOption = { startedAt: -1 };

    const [calls, total] = await Promise.all([
      Call.find(filter)
        .populate('userId', 'name email role phone avatar')
        .populate('contactId', 'name firstName lastName email phone company status')
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Call.countDocuments(filter)
    ]);

    const formattedCalls = calls.map(safeCall);

    return res.status(200).json({
      success: true,
      calls: formattedCalls,
      data: formattedCalls,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 0
      }
    });
  } catch (error) {
    console.error('getCalls error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving calls.' });
  }
};

// GET /api/calls/stats (authenticated user)
const getCallStats = async (req, res) => {
  try {
    const filter = {};
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';

    if (!isAdminOrManager) {
      filter.$or = [{ userId: req.user._id }, { user: req.user._id }];
    }

    const [
      total,
      inbound,
      outbound,
      answered,
      missed,
      voicemail,
      durationStats,
      byStatus
    ] = await Promise.all([
      Call.countDocuments(filter),
      Call.countDocuments({ ...filter, direction: 'inbound' }),
      Call.countDocuments({ ...filter, direction: 'outbound' }),
      Call.countDocuments({ ...filter, status: { $in: ['answered', 'completed'] } }),
      Call.countDocuments({ ...filter, status: 'missed' }),
      Call.countDocuments({ ...filter, status: 'voicemail' }),
      Call.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalDuration: { $sum: '$duration' },
            avgDuration: { $avg: '$duration' }
          }
        }
      ]),
      Call.aggregate([
        { $match: filter },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ])
    ]);

    const totalDuration = durationStats[0] ? durationStats[0].totalDuration : 0;
    const avgDuration = durationStats[0] ? Math.round(durationStats[0].avgDuration) : 0;

    const stats = {
      total,
      inbound,
      outbound,
      answered,
      missed,
      voicemail,
      totalDuration,
      avgDuration,
      byStatus
    };

    return res.status(200).json({
      success: true,
      stats,
      data: stats
    });
  } catch (error) {
    console.error('getCallStats error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving call stats.' });
  }
};

// GET /api/calls/:id (authenticated user)
const getCall = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid call ID.' });
    }

    const call = await Call.findById(req.params.id)
      .populate('userId', 'name email role phone avatar')
      .populate('contactId', 'name firstName lastName email phone company status')
      .lean();

    if (!call) {
      return res.status(404).json({ success: false, message: 'Call not found.' });
    }

    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    const isOwner = (call.userId && (call.userId._id ? call.userId._id.toString() : call.userId.toString()) === req.user._id.toString()) ||
      (call.user && (call.user._id ? call.user._id.toString() : call.user.toString()) === req.user._id.toString());

    if (!isAdminOrManager && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view this call.'
      });
    }

    const formatted = safeCall(call);

    return res.status(200).json({
      success: true,
      call: formatted,
      data: formatted
    });
  } catch (error) {
    console.error('getCall error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving call.' });
  }
};

// PUT /api/calls/:id or PATCH /api/calls/:id (authenticated user)
const updateCall = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid call ID.' });
    }

    const call = await Call.findById(req.params.id);
    if (!call) {
      return res.status(404).json({ success: false, message: 'Call not found.' });
    }

    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    const isOwner = (call.userId && call.userId.toString() === req.user._id.toString()) ||
      (call.user && call.user.toString() === req.user._id.toString());

    if (!isAdminOrManager && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to update this call.'
      });
    }

    const {
      status,
      duration,
      notes,
      recordingUrl,
      startedAt,
      endedAt,
      metadata,
      contactId,
      contact
    } = req.body;

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status.toLowerCase())) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}.`
        });
      }
      call.status = status.toLowerCase();
    }

    if (duration !== undefined) call.duration = parseInt(duration, 10) || 0;
    if (notes !== undefined) call.notes = notes ? notes.trim() : '';
    if (recordingUrl !== undefined) call.recordingUrl = recordingUrl;

    if (startedAt !== undefined) {
      const parsedStart = new Date(startedAt);
      if (!isNaN(parsedStart.getTime())) call.startedAt = parsedStart;
    }

    if (endedAt !== undefined) {
      const parsedEnd = new Date(endedAt);
      if (!isNaN(parsedEnd.getTime())) call.endedAt = parsedEnd;
    }

    const targetContact = contactId !== undefined ? contactId : contact;
    if (targetContact !== undefined) {
      if (targetContact === null || targetContact === '') {
        call.contactId = null;
        call.contact = null;
      } else {
        if (!isValidObjectId(targetContact)) {
          return res.status(400).json({ success: false, message: 'Invalid contact ID.' });
        }
        call.contactId = targetContact;
        call.contact = targetContact;
      }
    }

    if (metadata !== undefined) {
      call.metadata = { ...call.metadata, ...metadata };
    }

    await call.save();

    const populated = await Call.findById(call._id)
      .populate('userId', 'name email role phone avatar')
      .populate('contactId', 'name firstName lastName email phone company status')
      .lean();

    const formatted = safeCall(populated);

    return res.status(200).json({
      success: true,
      message: 'Call updated successfully.',
      call: formatted,
      data: formatted
    });
  } catch (error) {
    console.error('updateCall error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating call.' });
  }
};

// DELETE /api/calls/:id (authenticated user)
const deleteCall = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid call ID.' });
    }

    const call = await Call.findById(req.params.id).select('userId user').lean();
    if (!call) {
      return res.status(404).json({ success: false, message: 'Call not found.' });
    }

    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    const isOwner = (call.userId && call.userId.toString() === req.user._id.toString()) ||
      (call.user && call.user.toString() === req.user._id.toString());

    if (!isAdminOrManager && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to delete this call.'
      });
    }

    await Call.findByIdAndDelete(req.params.id);

    return res.status(200).json({
      success: true,
      message: 'Call record deleted successfully.'
    });
  } catch (error) {
    console.error('deleteCall error:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting call.' });
  }
};

// POST /api/calls/token (generate browser token for dialer client)
const generateBrowserToken = async (req, res) => {
  try {
    const identity = `user_${req.user._id}`;
    let token = null;

    if (
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_API_KEY &&
      process.env.TWILIO_API_SECRET
    ) {
      try {
        const twilio = require('twilio');
        const AccessToken = twilio.jwt.AccessToken;
        const VoiceGrant = AccessToken.VoiceGrant;

        const voiceGrant = new VoiceGrant({
          outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID,
          incomingAllow: true
        });

        const accessToken = new AccessToken(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_API_KEY,
          process.env.TWILIO_API_SECRET,
          { identity }
        );
        accessToken.addGrant(voiceGrant);
        token = accessToken.toJwt();
      } catch (err) {
        console.warn('Twilio token generation warning:', err.message);
      }
    }

    return res.status(200).json({
      success: true,
      identity,
      token: token || 'mock_token_' + req.user._id,
      message: 'Browser token generated.'
    });
  } catch (error) {
    console.error('generateBrowserToken error:', error);
    return res.status(500).json({ success: false, message: 'Server error generating call token.' });
  }
};

module.exports = {
  createCall,
  logCall: createCall,
  getCalls,
  getCall,
  getCallById: getCall,
  updateCall,
  deleteCall,
  getCallStats,
  generateBrowserToken
};