
import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },

    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },

    type: {
      type: String,
      enum: ["task", "attendance", "approval", "user", "system", "leave", "chat"],
      default: "system",
    },

    link: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    isRead: {
      type: Boolean,
      default: false,
    },

    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Optimize notification lists sorted by newest first.
notificationSchema.index({
  recipient: 1,
  createdAt: -1,
});

// Optimize unread notification filtering and counts.
notificationSchema.index({
  recipient: 1,
  isRead: 1,
});

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
