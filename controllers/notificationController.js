
const mongoose = require('mongoose');
const Notification = require('../models/Notification');

const VALID_TYPES = [
  'task',
  'message',
  'mention',
  'alert',
  'leave',
  'system',
  'appointment',
  'call',
  'event',
  'attendance',
];

const VALID_RELATED_TYPES = [
  'Task',
  'Message',
  'Conversation',
  'LeaveRequest',
  'User',
  'System',
  'Call',
  'Appointment',
  'Event',
  'Attendance',
];

const MAX_TITLE_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_ACTION_URL_LENGTH = 2048;
const MAX_SEARCH_LENGTH = 100;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const isValidObjectId = (id) => {
  if (!id) return false;

  const value =
    typeof id === 'object' && id._id
      ? id._id
      : id;

  return mongoose.Types.ObjectId.isValid(String(value));
};

const toObjectId = (id) => {
  if (!isValidObjectId(id)) return null;

  try {
    const value =
      typeof id === 'object' && id._id
        ? id._id
        : id;

    return new mongoose.Types.ObjectId(String(value));
  } catch {
    return null;
  }
};

const safeNotification = (notification) => {
  if (!notification) return null;

  const userId =
    notification.user &&
    typeof notification.user === 'object' &&
    notification.user._id
      ? notification.user._id
      : notification.user;

  return {
    id: notification._id,
    _id: notification._id,
    userId: userId || null,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    isRead: Boolean(notification.isRead),
    readAt: notification.readAt || null,
    relatedId: notification.relatedId || null,
    relatedType: notification.relatedType || null,
    actionUrl: notification.actionUrl || '',
    metadata:
      notification.metadata &&
      typeof notification.metadata === 'object' &&
      !Array.isArray(notification.metadata)
        ? notification.metadata
        : {},
    createdAt: notification.createdAt || null,
    updatedAt: notification.updatedAt || null,
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
  const isPayloadObject =
    paramsOrUserId &&
    typeof paramsOrUserId === 'object' &&
    !paramsOrUserId._bsontype &&
    !paramsOrUserId._id &&
    (
      Object.prototype.hasOwnProperty.call(paramsOrUserId, 'userId') ||
      Object.prototype.hasOwnProperty.call(paramsOrUserId, 'user') ||
      Object.prototype.hasOwnProperty.call(paramsOrUserId, 'type') ||
      Object.prototype.hasOwnProperty.call(paramsOrUserId, 'title') ||
      Object.prototype.hasOwnProperty.call(paramsOrUserId, 'message')
    );

  if (isPayloadObject) {
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
    user:
      paramsOrUserId && paramsOrUserId._id
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

const isValidActionUrl = (actionUrl) => {
  if (typeof actionUrl !== 'string') return false;
  if (actionUrl.length > MAX_ACTION_URL_LENGTH) return false;

  if (!actionUrl) return true;

  // Allow internal relative paths but reject protocol-relative URLs.
  if (actionUrl.startsWith('/')) {
    return (
      !actionUrl.startsWith('//') &&
      !actionUrl.startsWith('/\\') &&
      !actionUrl.includes('\\') &&
      !/[\r\n]/.test(actionUrl)
    );
  }

  try {
    const parsed = new URL(actionUrl);

    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      Boolean(parsed.hostname) &&
      !/[\r\n\s]/.test(actionUrl)
    );
  } catch {
    return false;
  }
};

const normalizeMetadata = (metadata) => {
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata)
  ) {
    return null;
  }

  return metadata;
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

    const userObjectId = toObjectId(payload.user);

    if (!userObjectId) {
      console.warn(
        'createNotification: invalid or missing user ID'
      );
      return null;
    }

    if (
      typeof payload.type !== 'string' ||
      !VALID_TYPES.includes(payload.type)
    ) {
      console.warn(
        'createNotification: invalid notification type'
      );
      return null;
    }

    if (
      typeof payload.title !== 'string' ||
      !payload.title.trim() ||
      typeof payload.message !== 'string' ||
      !payload.message.trim()
    ) {
      console.warn(
        'createNotification: title and message are required'
      );
      return null;
    }

    if (
      payload.relatedType &&
      (
        typeof payload.relatedType !== 'string' ||
        !VALID_RELATED_TYPES.includes(payload.relatedType)
      )
    ) {
      console.warn(
        'createNotification: invalid related type'
      );
      return null;
    }

    let relatedObjectId = null;

    if (
      payload.relatedId !== null &&
      payload.relatedId !== undefined &&
      payload.relatedId !== ''
    ) {
      relatedObjectId = toObjectId(payload.relatedId);

      if (!relatedObjectId) {
        console.warn(
          'createNotification: invalid related ID'
        );
        return null;
      }
    }

    if (!isValidActionUrl(payload.actionUrl)) {
      console.warn(
        'createNotification: invalid action URL'
      );
      return null;
    }

    const metadata = normalizeMetadata(payload.metadata);

    if (!metadata) {
      console.warn(
        'createNotification: metadata must be an object'
      );
      return null;
    }

    return await Notification.create({
      user: userObjectId,
      type: payload.type,
      title: payload.title.trim().slice(0, MAX_TITLE_LENGTH),
      message: payload.message.trim().slice(0, MAX_MESSAGE_LENGTH),
      isRead: false,
      readAt: null,
      relatedId: relatedObjectId,
      relatedType: payload.relatedType || null,
      actionUrl: payload.actionUrl || '',
      metadata,
    });
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
} = {}) => {
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
} = {}) => {
  if (!recipientId) return null;

  let formattedStatus = String(status || 'present')
    .trim()
    .toLowerCase();

  if (
    !['present', 'late', 'absent', 'half day', 'leave']
      .includes(formattedStatus)
  ) {
    formattedStatus = 'present';
  }

  const safeUserName =
    typeof userName === 'string'
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
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const {
      isRead,
      type,
      search,
      page = DEFAULT_PAGE,
      limit = DEFAULT_LIMIT,
    } = req.query;

    const currentUserId = toObjectId(req.user._id);

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authenticated user.',
      });
    }

    const filter = { user: currentUserId };

    if (isRead !== undefined) {
      if (isRead !== 'true' && isRead !== 'false') {
        return res.status(400).json({
          success: false,
          message: 'isRead must be true or false.',
        });
      }

      filter.isRead = isRead === 'true';
    }

    if (type !== undefined && type !== '') {
      if (
        typeof type !== 'string' ||
        !VALID_TYPES.includes(type)
      ) {
        return res.status(400).json({
          success: false,
          message: `Invalid type filter. Allowed: ${VALID_TYPES.join(', ')}.`,
        });
      }

      filter.type = type;
    }

    if (search !== undefined && typeof search !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Search must be a string.',
      });
    }

    if (search && search.trim()) {
      const escaped = search
        .trim()
        .slice(0, MAX_SEARCH_LENGTH)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const regex = new RegExp(escaped, 'i');

      filter.$or = [
        { title: regex },
        { message: regex },
      ];
    }

    const parsedPage = Number.parseInt(page, 10);
    const parsedLimit = Number.parseInt(limit, 10);

    const pageNum =
      Number.isFinite(parsedPage) && parsedPage > 0
        ? Math.min(parsedPage, 1000000)
        : DEFAULT_PAGE;

    const limitNum =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, MAX_LIMIT)
        : DEFAULT_LIMIT;

    const skip = (pageNum - 1) * limitNum;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),

      Notification.countDocuments(filter),

      Notification.countDocuments({
        user: currentUserId,
        isRead: false,
      }),
    ]);

    const formatted = notifications.map(safeNotification);

    return res.status(200).json({
      success: true,
      notifications: formatted,
      data: formatted,
      unreadCount,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 0,
      },
    });
  } catch (error) {
    console.error('getNotifications error:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Server error retrieving notifications.',
    });
  }
};

const getUnreadCount = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const currentUserId = toObjectId(req.user._id);

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authenticated user.',
      });
    }

    const unreadCount = await Notification.countDocuments({
      user: currentUserId,
      isRead: false,
    });

    return res.status(200).json({
      success: true,
      unreadCount,
    });
  } catch (error) {
    console.error('getUnreadCount error:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Server error retrieving unread count.',
    });
  }
};

const getNotificationById = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID.',
      });
    }

    const currentUserId = toObjectId(req.user._id);

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authenticated user.',
      });
    }

    const notification = await Notification.findOne({
      _id: toObjectId(id),
      user: currentUserId,
    }).lean();

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found.',
      });
    }

    const formatted = safeNotification(notification);

    return res.status(200).json({
      success: true,
      notification: formatted,
      data: formatted,
    });
  } catch (error) {
    console.error('getNotificationById error:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Server error retrieving notification.',
    });
  }
};

const markAsRead = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID.',
      });
    }

    const currentUserId = toObjectId(req.user._id);

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authenticated user.',
      });
    }

    const notification = await Notification.findOneAndUpdate(
      {
        _id: toObjectId(id),
        user: currentUserId,
      },
      [
        {
          $set: {
            isRead: true,
            readAt: {
              $ifNull: ['$readAt', '$$NOW'],
            },
          },
        },
      ],
      { new: true }
    ).lean();

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Notification marked as read.',
      notification: safeNotification(notification),
    });
  } catch (error) {
    console.error('markAsRead error:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Server error marking notification as read.',
    });
  }
};

const markAllAsRead = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const currentUserId = toObjectId(req.user._id);

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authenticated user.',
      });
    }

    const now = new Date();

    const result = await Notification.updateMany(
      {
        user: currentUserId,
        isRead: false,
      },
      {
        $set: {
          isRead: true,
          readAt: now,
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: 'All notifications marked as read.',
      modifiedCount: Number(
        result.modifiedCount ?? result.nModified ?? 0
      ),
    });
  } catch (error) {
    console.error('markAllAsRead error:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Server error marking all notifications as read.',
    });
  }
};

const deleteNotification = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID.',
      });
    }

    const currentUserId = toObjectId(req.user._id);

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authenticated user.',
      });
    }

    const result = await Notification.deleteOne({
      _id: toObjectId(id),
      user: currentUserId,
    });

    if (!result.deletedCount) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Notification deleted successfully.',
    });
  } catch (error) {
    console.error('deleteNotification error:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Server error deleting notification.',
    });
  }
};

const deleteReadNotifications = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const currentUserId = toObjectId(req.user._id);

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authenticated user.',
      });
    }

    const result = await Notification.deleteMany({
      user: currentUserId,
      isRead: true,
    });

    return res.status(200).json({
      success: true,
      message: 'Read notifications deleted successfully.',
      deletedCount: Number(result.deletedCount || 0),
    });
  } catch (error) {
    console.error('deleteReadNotifications error:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Server error deleting read notifications.',
    });
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
