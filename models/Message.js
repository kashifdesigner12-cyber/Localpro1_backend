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
          default: "",
        },
        originalName: {
          type: String,
          default: "",
        },
        fileType: {
          type: String,
          default: "",
        },
        mimeType: {
          type: String,
          default: "",
        },
        size: {
          type: Number,
          default: 0,
          min: 0,
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

    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    isDeletedForEveryone: {
      type: Boolean,
      default: false,
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

/**
 * Keep body and message synchronized.
 * Allow attachment-only messages.
 */
MessageSchema.pre("validate", function (next) {
  if (this.isDeletedForEveryone) {
    return next();
  }

  const normalizedBody =
    typeof this.body === "string" ? this.body.trim() : "";

  const normalizedMessage =
    typeof this.message === "string" ? this.message.trim() : "";

  const hasAttachments =
    Array.isArray(this.attachments) && this.attachments.length > 0;

  if (normalizedBody && !normalizedMessage) {
    this.message = normalizedBody;
  } else if (normalizedMessage && !normalizedBody) {
    this.body = normalizedMessage;
  } else if (normalizedBody && normalizedMessage) {
    // Prefer body as the canonical text when both fields are supplied.
    this.body = normalizedBody;
    this.message = normalizedBody;
  }

  const hasText = Boolean(
    (this.body && this.body.trim()) ||
    (this.message && this.message.trim())
  );

  if (!hasText && !hasAttachments) {
    this.invalidate(
      "body",
      "Message text or at least one attachment is required."
    );
  }

  next();
});

/**
 * Query indexes.
 * These improve reads but intentionally do not enforce uniqueness:
 * users may legitimately send the same text more than once.
 */
MessageSchema.index({ conversation: 1, createdAt: 1 });
MessageSchema.index({ recipient: 1, isRead: 1 });
MessageSchema.index({ sender: 1, createdAt: -1 });
MessageSchema.index({ conversation: 1, deletedFor: 1 });

module.exports = mongoose.model("Message", MessageSchema);
