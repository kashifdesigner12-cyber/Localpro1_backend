const mongoose = require('mongoose');
const Notification = require('../models/Notification');

const isValidObjectId = (id) =>
  Boolean(id) && mongoose.Types.ObjectId.isValid(id);

// ============================================================
// VALID NOTIFICATION TYPES
// ============================================================

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
  'attendance'
];

// ============================================================
// VALID RELATED TYPES
// ============================================================

const VALID_RELATED_TYPES = [
  'Task',
  'Message',
  'LeaveRequest',
  'User',
  'System',
  'Call',
  'Appointment',
  'Event',
  'Attendance'
];

// ============================================================
// SAFE NOTIFICATION RESPONSE
// ============================================================

const safeNotification = (notification) => {
  if (!notification) {
    return null;
  }

  return {
    id: notification._id,

    userId: notification.user,

    type: notification.type,

    title: notification.title,

    message: notification.message,

    isRead: notification.isRead,

    readAt: notification.readAt || null,

    relatedId:
      notification.relatedId || null,

    relatedType:
      notification.relatedType || null,

    actionUrl:
      notification.actionUrl || '',

    metadata:
      notification.metadata || {},

    createdAt:
      notification.createdAt,

    updatedAt:
      notification.updatedAt
  };
};

// ============================================================
// INTERNAL CREATE NOTIFICATION
// ============================================================

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
    let payload = {};

    if (
      paramsOrUserId &&
      typeof paramsOrUserId === 'object' &&
      !paramsOrUserId._bsontype &&
      !paramsOrUserId._id
    ) {
      payload = {
        user:
          paramsOrUserId.userId ||
          paramsOrUserId.user ||
          null,

        type:
          paramsOrUserId.type ||
          'system',

        title:
          paramsOrUserId.title ||
          '',

        message:
          paramsOrUserId.message ||
          '',

        relatedId:
          paramsOrUserId.relatedId ||
          null,

        relatedType:
          paramsOrUserId.relatedType ||
          null,

        actionUrl:
          paramsOrUserId.actionUrl ||
          '',

        metadata:
          paramsOrUserId.metadata ||
          {}
      };
    } else {
      payload = {
        user:
          paramsOrUserId &&
          paramsOrUserId._id
            ? paramsOrUserId._id
            : paramsOrUserId,

        type:
          argType ||
          'system',

        title:
          argTitle ||
          '',

        message:
          argMessage ||
          '',

        relatedId:
          argRelatedId ||
          null,

        relatedType:
          argRelatedType ||
          null,

        actionUrl:
          argActionUrl ||
          '',

        metadata:
          argMetadata ||
          {}
      };
    }

    if (!payload.user) {
      console.error(
        'createNotification: user is required'
      );
      return null;
    }

    if (
      !isValidObjectId(
        payload.user
      )
    ) {
      console.error(
        'createNotification: invalid user ID'
      );
      return null;
    }

    if (
      !VALID_TYPES.includes(
        payload.type
      )
    ) {
      console.error(
        `createNotification: Invalid notification type "${payload.type}"`
      );
      return null;
    }

    if (
      !payload.title ||
      !String(payload.title).trim()
    ) {
      console.error(
        'createNotification: title is required'
      );
      return null;
    }

    if (
      !payload.message ||
      !String(payload.message).trim()
    ) {
      console.error(
        'createNotification: message is required'
      );
      return null;
    }

    if (
      payload.relatedType &&
      !VALID_RELATED_TYPES.includes(
        payload.relatedType
      )
    ) {
      console.error(
        `createNotification: Invalid relatedType "${payload.relatedType}"`
      );
      return null;
    }

    const notification =
      await Notification.create({
        user:
          payload.user,

        type:
          payload.type,

        title:
          String(
            payload.title
          ).trim(),

        message:
          String(
            payload.message
          ).trim(),

        isRead:
          false,

        relatedId:
          payload.relatedId,

        relatedType:
          payload.relatedType,

        actionUrl:
          payload.actionUrl,

        metadata:
          payload.metadata
      });

    return notification;
  } catch (error) {
    console.error(
      'createNotification error:',
      error.message
    );
    return null;
  }
};

// ============================================================
// ATTENDANCE NOTIFICATION
// ============================================================

const createAttendanceNotification = async ({
  userId,
  attendanceId = null,
  title = 'Attendance Required',
  message =
    'Your attendance time has started. Please mark your attendance.',
  actionUrl = '/user/attendance',
  metadata = {}
}) => {
  try {
    if (!userId) {
      return null;
    }

    return await createNotification({
      userId,

      type: 'attendance',

      title,

      message,

      relatedId:
        attendanceId,

      relatedType:
        'Attendance',

      actionUrl,

      metadata
    });
  } catch (error) {
    console.error(
      'createAttendanceNotification error:',
      error.message
    );
    return null;
  }
};

// ============================================================
// ATTENDANCE MARKED NOTIFICATION
// ============================================================

const notifyAttendanceMarked = async ({
  recipientId,
  userId,
  attendanceId = null,
  userName = 'User',
  status = 'present',
  checkInTime = null
}) => {
  try {
    if (!recipientId) {
      return null;
    }

    let formattedStatus =
      String(status || 'present')
        .toLowerCase();

    if (
      ![
        'present',
        'late',
        'absent',
        'half day',
        'leave'
      ].includes(
        formattedStatus
      )
    ) {
      formattedStatus =
        'present';
    }

    return await createNotification({
      userId:
        recipientId,

      type:
        'attendance',

      title:
        'Attendance Marked',

      message:
        `${userName} has marked attendance as ${formattedStatus}.`,

      relatedId:
        attendanceId,

      relatedType:
        'Attendance',

      actionUrl:
        '/admin/attendance',

      metadata: {
        attendanceUserId:
          userId || null,

        userName,

        status:
          formattedStatus,

        checkInTime
      }
    });
  } catch (error) {
    console.error(
      'notifyAttendanceMarked error:',
      error.message
    );
    return null;
  }
};

// ============================================================
// GET ALL NOTIFICATIONS
// GET /api/notifications
// ============================================================

const getNotifications = async (
  req,
  res
) => {
  try {
    const {
      isRead,
      type,
      search,
      page = 1,
      limit = 20
    } = req.query;

    const currentUserId = req.user._id;

    const filter = {
      user: currentUserId
    };

    if (isRead !== undefined) {
      if (
        isRead !== 'true' &&
        isRead !== 'false'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'isRead must be true or false.'
        });
      }

      filter.isRead =
        isRead === 'true';
    }

    if (type) {
      if (
        !VALID_TYPES.includes(
          type
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid type filter. Allowed: ${VALID_TYPES.join(', ')}.`
        });
      }

      filter.type =
        type;
    }

    if (
      search &&
      search.trim()
    ) {
      const regex =
        new RegExp(
          search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          'i'
        );

      filter.$or = [
        {
          title: regex
        },
        {
          message: regex
        }
      ];
    }

    const pageNum =
      Math.max(
        1,
        parseInt(page, 10) || 1
      );

    const limitNum =
      Math.min(
        100,
        Math.max(
          1,
          parseInt(limit, 10) || 20
        )
      );

    const skip =
      (pageNum - 1) *
      limitNum;

    // Optimized: Run find with lean and parallelize unread count
    const [
      notifications,
      total,
      unreadCount
    ] =
      await Promise.all([
        Notification.find(
          filter
        )
          .sort({
            createdAt: -1
          })
          .skip(skip)
          .limit(limitNum)
          .lean(),

        Notification.countDocuments(
          filter
        ),

        Notification.countDocuments({
          user: currentUserId,
          isRead: false
        })
      ]);

    const formattedNotifications =
      notifications.map(
        safeNotification
      );

    return res.status(200).json({
      success: true,

      notifications:
        formattedNotifications,

      data:
        formattedNotifications,

      unreadCount,

      pagination: {
        page:
          pageNum,

        limit:
          limitNum,

        total,

        pages:
          Math.ceil(
            total /
              limitNum
          ) || 0
      }
    });
  } catch (error) {
    console.error(
      'getNotifications error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving notifications.'
    });
  }
};

// ============================================================
// GET UNREAD COUNT
// GET /api/notifications/unread-count
// ============================================================

const getUnreadCount = async (
  req,
  res
) => {
  try {
    const unreadCount =
      await Notification.countDocuments({
        user:
          req.user._id,

        isRead:
          false
      });

    return res.status(200).json({
      success: true,

      unreadCount
    });
  } catch (error) {
    console.error(
      'getUnreadCount error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving unread count.'
    });
  }
};

// ============================================================
// GET NOTIFICATION BY ID
// GET /api/notifications/:id
// ============================================================

const getNotificationById =
  async (
    req,
    res
  ) => {
    try {
      const {
        id
      } = req.params;

      if (
        !isValidObjectId(id)
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid notification ID.'
        });
      }

      const notification =
        await Notification.findById(
          id
        ).lean();

      if (!notification) {
        return res.status(404).json({
          success: false,
          message:
            'Notification not found.'
        });
      }

      if (
        notification.user.toString() !==
        req.user._id.toString()
      ) {
        return res.status(403).json({
          success: false,
          message:
            'Access denied. You can only view your own notifications.'
        });
      }

      return res.status(200).json({
        success: true,

        notification:
          safeNotification(
            notification
          )
      });
    } catch (error) {
      console.error(
        'getNotificationById error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Server error retrieving notification.'
      });
    }
  };

// ============================================================
// MARK SINGLE NOTIFICATION AS READ
// ============================================================

const markAsRead = async (
  req,
  res
) => {
  try {
    const {
      id
    } = req.params;

    if (
      !isValidObjectId(id)
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid notification ID.'
      });
    }

    const notification =
      await Notification.findOneAndUpdate(
        {
          _id: id,
          user: req.user._id
        },
        {
          $set: {
            isRead: true,
            readAt: new Date()
          }
        },
        { new: true }
      ).lean();

    if (!notification) {
      // Check if it exists for another user or doesn't exist
      const exists = await Notification.exists({ _id: id });
      if (!exists) {
        return res.status(404).json({
          success: false,
          message: 'Notification not found.'
        });
      }

      return res.status(403).json({
        success: false,
        message:
          'Access denied. You can only update your own notifications.'
      });
    }

    return res.status(200).json({
      success: true,

      message:
        'Notification marked as read.',

      notification:
        safeNotification(
          notification
        )
    });
  } catch (error) {
    console.error(
      'markAsRead error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error marking notification as read.'
    });
  }
};

// ============================================================
// MARK ALL AS READ
// ============================================================

const markAllAsRead = async (
  req,
  res
) => {
  try {
    const now =
      new Date();

    const result =
      await Notification.updateMany(
        {
          user:
            req.user._id,

          isRead:
            false
        },
        {
          $set: {
            isRead:
              true,

            readAt:
              now
          }
        }
      );

    const modifiedCount =
      Number(
        result.modifiedCount
      ) ||
      Number(
        result.nModified
      ) ||
      0;

    return res.status(200).json({
      success: true,

      message:
        'All notifications marked as read.',

      modifiedCount
    });
  } catch (error) {
    console.error(
      'markAllAsRead error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error marking all notifications as read.'
    });
  }
};

// ============================================================
// DELETE SINGLE NOTIFICATION
// DELETE /api/notifications/:id
// ============================================================

const deleteNotification =
  async (
    req,
    res
  ) => {
    try {
      const {
        id
      } = req.params;

      if (
        !isValidObjectId(id)
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid notification ID.'
        });
      }

      const notification =
        await Notification.findById(
          id
        ).select('user').lean();

      if (!notification) {
        return res.status(404).json({
          success: false,
          message:
            'Notification not found.'
        });
      }

      if (
        notification.user.toString() !==
        req.user._id.toString()
      ) {
        return res.status(403).json({
          success: false,
          message:
            'Access denied. You can only delete your own notifications.'
        });
      }

      await Notification.findByIdAndDelete(
        id
      );

      return res.status(200).json({
        success: true,

        message:
          'Notification deleted successfully.'
      });
    } catch (error) {
      console.error(
        'deleteNotification error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Server error deleting notification.'
      });
    }
  };

// ============================================================
// DELETE ALL READ NOTIFICATIONS
// DELETE /api/notifications/read
// ============================================================

const deleteReadNotifications =
  async (
    req,
    res
  ) => {
    try {
      const result =
        await Notification.deleteMany({
          user:
            req.user._id,

          isRead:
            true
        });

      return res.status(200).json({
        success: true,

        message:
          'Read notifications deleted successfully.',

        deletedCount:
          result.deletedCount
      });
    } catch (error) {
      console.error(
        'deleteReadNotifications error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Server error deleting read notifications.'
      });
    }
  };

// ============================================================
// EXPORTS
// ============================================================

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

  deleteReadNotifications
};