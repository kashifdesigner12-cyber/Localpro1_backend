const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: [true, "Conversation is required"],
      index: true,
    },

    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Sender is required"],
      index: true,
    },

    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    body: {
      type: String,
      trim: true,
      default: "",
    },

    message: {
      type: String,
      trim: true,
      default: "",
    },

    messageType: {
      type: String,
      enum: ["text", "image", "file", "document", "video", "audio", "system"],
      default: "text",
    },

    attachments: [
      {
        url: {
          type: String,
          required: true,
        },
        filename: {
          type: String,
        },
        originalName: {
          type: String,
        },
        fileType: {
          type: String,
        },
        mimeType: {
          type: String,
        },
        size: {
          type: Number,
        },
      },
    ],

    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },

    readAt: {
      type: Date,
      default: null,
    },

    channel: {
      type: String,
      enum: ["chat", "sms", "email"],
      default: "chat",
    },

    direction: {
      type: String,
      enum: ["inbound", "outbound", "internal"],
      default: "internal",
    },

    /*
     * =========================================================
     * MESSAGE DELETION (DELETE FOR ME & DELETE FOR EVERYONE)
     * =========================================================
     *
     * deletedFor:
     *   Array of User ObjectIds who deleted this message for themselves.
     *
     * isDeletedForEveryone:
     *   Flag indicating if the message was retracted by the sender/admin.
     *
     * deletedForEveryoneAt:
     *   Timestamp when the message was deleted for everyone.
     *
     * deletedBy:
     *   The user who triggered delete for everyone.
     */

    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        index: true,
      },
    ],

    isDeletedForEveryone: {
      type: Boolean,
      default: false,
      index: true,
    },

    deletedForEveryoneAt: {
      type: Date,
      default: null,
    },

    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Custom validation: Message body or at least one attachment must exist
MessageSchema.pre("validate", function (next) {
  // If message is deleted for everyone, skip body requirement
  if (this.isDeletedForEveryone) {
    return next();
  }

  const hasBody = Boolean(this.body && this.body.trim().length > 0);
  const hasMessage = Boolean(this.message && this.message.trim().length > 0);
  const hasAttachments = Boolean(
    Array.isArray(this.attachments) && this.attachments.length > 0
  );

  if (!hasBody && !hasMessage && !hasAttachments) {
    this.invalidate("body", "Message text or an attachment file is required.");
  }

  // Ensure body and message match for compatibility
  if (hasBody && !hasMessage) {
    this.message = this.body;
  } else if (hasMessage && !hasBody) {
    this.body = this.message;
  }

  next();
});

MessageSchema.index({
  conversation: 1,
  createdAt: 1,
});

MessageSchema.index({
  recipient: 1,
  isRead: 1,
});

MessageSchema.index({
  sender: 1,
  createdAt: -1,
});

MessageSchema.index({
  deletedFor: 1,
});

MessageSchema.index({
  isDeletedForEveryone: 1,
});

module.exports = mongoose.model("Message", MessageSchema);