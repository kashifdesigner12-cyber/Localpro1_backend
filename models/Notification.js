
const mongoose = require('mongoose');

const { Schema } = mongoose;

const NOTIFICATION_TYPES = [
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

const RELATED_TYPES = [
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

const notificationSchema = new Schema(
  {
    // User who owns this notification.
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
      index: false,
    },

    // Notification category used by filters and frontend UI.
    type: {
      type: String,
      enum: {
        values: NOTIFICATION_TYPES,
        message: 'Invalid notification type',
      },
      default: 'system',
      required: true,
      index: false,
    },

    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },

    message: {
      type: String,
      required: [true, 'Message is required'],
      trim: true,
      maxlength: [5000, 'Message cannot exceed 5000 characters'],
    },

    isRead: {
      type: Boolean,
      default: false,
      required: true,
    },

    readAt: {
      type: Date,
      default: null,
    },

    relatedId: {
      type: Schema.Types.ObjectId,
      default: null,
    },

    relatedType: {
      type: String,
      enum: {
        values: [...RELATED_TYPES, null],
        message: 'Invalid related notification type',
      },
      default: null,
    },

    actionUrl: {
      type: String,
      default: '',
      trim: true,
      maxlength: [
        2048,
        'Action URL cannot exceed 2048 characters',
      ],
    },

    // Store optional additional notification data.
    // Validate sensitive or client-facing metadata in the controller.
    metadata: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);

// Efficient user-specific notification lists.
notificationSchema.index({
  user: 1,
  createdAt: -1,
});

// Efficient unread-count and unread-list queries.
notificationSchema.index({
  user: 1,
  isRead: 1,
  createdAt: -1,
});

// Efficient filtering by notification type.
notificationSchema.index({
  user: 1,
  type: 1,
  createdAt: -1,
});

module.exports = mongoose.model(
  'Notification',
  notificationSchema
);
