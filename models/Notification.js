const mongoose = require("mongoose");

const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    // The authenticated user who owns this notification.
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required"],
    },

    relatedType: {
      type: String,
      enum: [
        "Task",
        "Message",
        "Conversation",
        "LeaveRequest",
        "User",
        "System",
        "Call",
        "Appointment",
        "Event",
        "Attendance",
        null,
      ],
      default: null,
    },

    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"],
    },

    message: {
      type: String,
      required: [true, "Message is required"],
      trim: true,
      maxlength: [5000, "Message cannot exceed 5000 characters"],
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
      enum: [
        "Task",
        "Message",
        "LeaveRequest",
        "User",
        "System",
        "Call",
        "Appointment",
        "Event",
        "Attendance",
        null,
      ],
      default: null,
    },

    actionUrl: {
      type: String,
      default: "",
      trim: true,
      maxlength: [2048, "Action URL cannot exceed 2048 characters"],
    },

    // Treat metadata as untrusted input. Validate and whitelist fields at the
    // controller/service boundary before storing or returning it to clients.
    metadata: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    strict: true,
  },
);

// Indexes are scoped by owner so notification reads can remain user-specific.
// The compound indexes support common list, unread-count, and type-filter queries.
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ user: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
