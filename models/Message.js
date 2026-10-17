"use strict";

const mongoose = require("mongoose");

const MESSAGE_TYPES = [
  "text",
  "image",
  "file",
  "document",
  "video",
  "audio",
  "system",
];

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

    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
      index: true,
    },

    body: {
      type: String,
      trim: true,
      default: "",
    },

    // `message` is retained as a compatibility alias for older clients.
    message: {
      type: String,
      trim: true,
      default: "",
    },

    messageType: {
      type: String,
      enum: MESSAGE_TYPES,
      default: "text",
    },

    attachments: [
      {
        url: {
          type: String,
          required: true,
          trim: true,
        },
        filename: {
          type: String,
          default: "",
          trim: true,
        },
        originalName: {
          type: String,
          default: "",
          trim: true,
        },
        fileType: {
          type: String,
          default: "",
          trim: true,
        },
        mimeType: {
          type: String,
          default: "",
          trim: true,
        },
        size: {
          type: Number,
          default: 0,
          min: 0,
        },
      },
    ],

    reactions: [
      {
        emoji: {
          type: String,
          required: true,
          trim: true,
          maxlength: 32,
        },
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
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

// Normalize body/message compatibility and reject empty messages, while
// allowing attachment-only messages and messages deleted for everyone.
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
    // Keep both fields synchronized for legacy clients.
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

// Query indexes for chronological history, unread counts, and sender history.
MessageSchema.index({ conversation: 1, createdAt: 1 });
MessageSchema.index({ conversation: 1, createdAt: -1 });
MessageSchema.index({ recipient: 1, isRead: 1 });
MessageSchema.index({ sender: 1, createdAt: -1 });
MessageSchema.index({ conversation: 1, deletedFor: 1 });

module.exports = mongoose.model("Message", MessageSchema);