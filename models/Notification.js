const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema(
  {
    // ==========================================
    // NOTIFICATION OWNER
    // ==========================================
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
      index: true
    },

    // ==========================================
    // NOTIFICATION TYPE
    // ==========================================
    type: {
      type: String,
      enum: [
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
      ],
      default: 'system',
      index: true
    },

    // ==========================================
    // TITLE
    // ==========================================
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true
    },

    // ==========================================
    // MESSAGE
    // ==========================================
    message: {
      type: String,
      required: [true, 'Message is required'],
      trim: true
    },

    // ==========================================
    // READ STATUS
    // ==========================================
    isRead: {
      type: Boolean,
      default: false,
      index: true
    },

    readAt: {
      type: Date,
      default: null
    },

    // ==========================================
    // RELATED RECORD
    // ==========================================
    relatedId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    },

    relatedType: {
      type: String,
      enum: [
        'Task',
        'Message',
        'LeaveRequest',
        'User',
        'System',
        'Call',
        'Appointment',
        'Event',
        'Attendance',
        null
      ],
      default: null
    },

    // ==========================================
    // ACTION URL
    // ==========================================
    actionUrl: {
      type: String,
      default: ''
    },

    // ==========================================
    // ATTENDANCE ACTION DATA
    // ==========================================
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

// ==========================================
// INDEXES
// ==========================================

// User notifications
NotificationSchema.index({
  user: 1,
  createdAt: -1
});

// Unread notifications
NotificationSchema.index({
  user: 1,
  isRead: 1
});

// Attendance notifications
NotificationSchema.index({
  user: 1,
  type: 1,
  createdAt: -1
});

// ==========================================
// EXPORT
// ==========================================
module.exports = mongoose.model(
  'Notification',
  NotificationSchema
);