const mongoose = require('mongoose');
const Notification = require('../models/Notification');

const VALID_TYPES = [
  'task', 'message', 'mention', 'alert', 'leave',
  'system', 'appointment', 'call', 'event', 'attendance'
];

const VALID_RELATED_TYPES = [
  'Task', 'Message', 'LeaveRequest', 'User', 'System',
  'Call', 'Appointment', 'Event', 'Attendance'
];

const isValidObjectId = (id) =>
  Boolean(id) && mongoose.Types.ObjectId.isValid(id);

const safeNotification = (notification) => {
  if (!notification) return null;

  return {
    id: notification._id,
    userId: notification.user,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    isRead: notification.isRead,
    readAt: notification.readAt || null,
    relatedId: notification.relatedId || null,
    relatedType: notification.relatedType || null,
    actionUrl: notification.actionUrl || '',
    metadata: notification.metadata || {},
    createdAt: notification.createdAt,
    updatedAt: notification.updatedAt,
  };
};

const normalizeNotificationPayload = (
  paramsOrUserId,
  argType,
  argTitle,
  argMessage,
  argRelatedId,
  argRelatedType,
  argActionUrl,
  argMetadata
) => {
  if (
    paramsOrUserId &&
    typeof paramsOrUserId === 'object' &&
    !paramsOrUserId._bsontype &&
    !paramsOrUserId._id
  ) {
    return {
      user: paramsOrUserId.userId || paramsOrUserId.user || null,
      type: paramsOrUserId.type || 'system',
      title: paramsOrUserId.title || '',
      message: paramsOrUserId.message || '',
      relatedId: paramsOrUserId.relatedId || null,
      relatedType: paramsOrUserId.relatedType || null,
      actionUrl: paramsOrUserId.actionUrl || '',
      metadata: paramsOrUserId.metadata || {},
    };
  }

  return {
    user: paramsOrUserId && paramsOrUserId._id
      ? paramsOrUserId._id
      : paramsOrUserId,
    type: argType || 'system',
    title: argTitle || '',
    message: argMessage || '',
    relatedId: argRelatedId || null,
    relatedType: argRelatedType || null,
    actionUrl: argActionUrl || '',
    metadata: argMetadata || {},
  };
};

const createNotification = async (
  paramsOrUserId,
  argType = 'system',
  argTitle = '',
  argMessage = '',
  argRelatedId = null,
  argRelatedType = null,
  argActionUrl = '',
  argMetadata = {}
) => {
  try {
    const payload = normalizeNotificationPayload(
      paramsOrUserId,
      argType,
      argTitle,
      argMessage,
      argRelatedId,
      argRelatedType,
      argActionUrl,
      argMetadata
    );

    if (!isValidObjectId(payload.user)) {
      console.warn('createNotification: invalid or missing user ID');
      return null;
    }

    if (!VALID_TYPES.includes(payload.type)) {
      console.warn('createNotification: invalid notification type');
      return null;
    }

    if (
      typeof payload.title !== 'string' ||
      !payload.title.trim() ||
      typeof payload.message !== 'string' ||
      !payload.message.trim()
    ) {
      console.warn('createNotification: title and message are required');
      return null;
    }

    if (
      payload.relatedType &&
      !VALID_RELATED_TYPES.includes(payload.relatedType)
    ) {
      console.warn('createNotification: invalid related type');
      return null;
    }

    if (
      payload.relatedId !== null &&
      payload.relatedId !== undefined &&
      !isValidObjectId(payload.relatedId)
    ) {
      console.warn('createNotification: invalid related ID');
      return null;
    }

    if (
      typeof payload.actionUrl !== 'string' ||
      payload.actionUrl.length > 2048 ||
      (payload.actionUrl && !payload.actionUrl.startsWith('/') &&
        !/^https?:\/\/[^\s]+$/i.test(payload.actionUrl))
    ) {
      console.warn('createNotification: invalid action URL');
      return null;
    }

    if (
      !payload.metadata ||
      typeof payload.metadata !== 'object' ||
      Array.isArray(payload.metadata)
    ) {
      console.warn('createNotification: metadata must be an object');
      return null;
    }

    const notification = await Notification.create({
      user: payload.user,
      type: payload.type,
      title: payload.title.trim().slice(0, 200),
      message: payload.message.trim().slice(0, 5000),
      isRead: false,
      readAt: null,
      relatedId: payload.relatedId || null,
      relatedType: payload.relatedType || null,
      actionUrl: payload.actionUrl || '',
      metadata: payload.metadata,
    });

    return notification;
  } catch (error) {
    console.error('createNotification error:', error.message);
    return null;
  }
};

const createAttendanceNotification = async ({
  userId,
  attendanceId = null,
  title = 'Attendance Required',
  message = 'Your attendance time has started. Please mark your attendance.',
  actionUrl = '/user/attendance',
  metadata = {},
}) => {
  return createNotification({
    userId,
    type: 'attendance',
    title,
    message,
    relatedId: attendanceId,
    relatedType: 'Attendance',
    actionUrl,
    metadata,
  });
};

const notifyAttendanceMarked = async ({
  recipientId,
  userId,
  attendanceId = null,
  userName = 'User',
  status = 'present',
  checkInTime = null,
}) => {
  if (!recipientId) return null;

  let formattedStatus = String(status || 'present').toLowerCase();
  if (!['present', 'late', 'absent', 'half day', 'leave'].includes(formattedStatus)) {
    formattedStatus = 'present';
  }

  const safeUserName = typeof userName === 'string'
    ? userName.trim().slice(0, 120)
    : 'User';

  return createNotification({
    userId: recipientId,
    type: 'attendance',
    title: 'Attendance Marked',
    message: `${safeUserName || 'User'} has marked attendance as ${formattedStatus}.`,
    relatedId: attendanceId,
    relatedType: 'Attendance',
    actionUrl: '/admin/attendance',
    metadata: {
      attendanceUserId: userId || null,
      userName: safeUserName || 'User',
      status: formattedStatus,
      checkInTime,
    },
  });
};

const getNotifications = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const { isRead, type, search, page = 1, limit = 20 } = req.query;
    const currentUserId = req.user._id;
    const filter = { user: currentUserId };

    if (isRead !== undefined) {
      if (isRead !== 'true' && isRead !== 'false') {
        return res.status(400).json({ success: false, message: 'isRead must be true or false.' });
      }
      filter.isRead = isRead === 'true';
    }

    if (type) {
      if (typeof type !== 'string' || !VALID_TYPES.includes(type)) {
        return res.status(400).json({
          success: false,
          message: `Invalid type filter. Allowed: ${VALID_TYPES.join(', ')}.`,
        });
      }
      filter.type = type;
    }

    if (search !== undefined && typeof search !== 'string') {
      return res.status(400).json({ success: false, message: 'Search must be a string.' });
    }

    if (search && search.trim()) {
      const escaped = search.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [{ title: regex }, { message: regex }];
    }

    const parsedPage = Number.parseInt(page, 10);
    const parsedLimit = Number.parseInt(limit, 10);
    const pageNum = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 1000000) : 1;
    const limitNum = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20;
    const skip = (pageNum - 1) * limitNum;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ user: currentUserId, isRead: false }),
    ]);

    const formatted = notifications.map(safeNotification);
    return res.status(200).json({
      success: true,
      notifications: formatted,
      data: formatted,
      unreadCount,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) || 0 },
    });
  } catch (error) {
    console.error('getNotifications error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error retrieving notifications.' });
  }
};

const getUnreadCount = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const unreadCount = await Notification.countDocuments({ user: req.user._id, isRead: false });
    return res.status(200).json({ success: true, unreadCount });
  } catch (error) {
    console.error('getUnreadCount error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error retrieving unread count.' });
  }
};

const getNotificationById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid notification ID.' });
    }

    const notification = await Notification.findOne({
      _id: id,
      user: req.user._id,
    }).lean();

    if (!notification) {
      // Do not disclose whether another user's notification exists.
      return res.status(404).json({ success: false, message: 'Notification not found.' });
    }

    return res.status(200).json({
      success: true,
      notification: safeNotification(notification),
      data: safeNotification(notification),
    });
  } catch (error) {
    console.error('getNotificationById error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error retrieving notification.' });
  }
};

const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid notification ID.' });
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: id, user: req.user._id },
      [{ $set: { isRead: true, readAt: { $ifNull: ['$readAt', '$$NOW'] } } }],
      { new: true }
    ).lean();

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Notification marked as read.',
      notification: safeNotification(notification),
    });
  } catch (error) {
    console.error('markAsRead error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error marking notification as read.' });
  }
};

const markAllAsRead = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const now = new Date();
    const result = await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { $set: { isRead: true, readAt: now } }
    );

    return res.status(200).json({
      success: true,
      message: 'All notifications marked as read.',
      modifiedCount: Number(result.modifiedCount ?? result.nModified ?? 0),
    });
  } catch (error) {
    console.error('markAllAsRead error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error marking all notifications as read.' });
  }
};

const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid notification ID.' });
    }

    const result = await Notification.deleteOne({ _id: id, user: req.user._id });
    if (!result.deletedCount) {
      return res.status(404).json({ success: false, message: 'Notification not found.' });
    }

    return res.status(200).json({ success: true, message: 'Notification deleted successfully.' });
  } catch (error) {
    console.error('deleteNotification error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error deleting notification.' });
  }
};

const deleteReadNotifications = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const result = await Notification.deleteMany({ user: req.user._id, isRead: true });
    return res.status(200).json({
      success: true,
      message: 'Read notifications deleted successfully.',
      deletedCount: Number(result.deletedCount || 0),
    });
  } catch (error) {
    console.error('deleteReadNotifications error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error deleting read notifications.' });
  }
};

module.exports = {
  createNotification,
  createAttendanceNotification,
  notifyAttendanceMarked,
  getNotifications,
  getUnreadCount,
  getNotificationById,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteReadNotifications,
};
