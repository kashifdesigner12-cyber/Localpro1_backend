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

const ConversationSchema = new mongoose.Schema(
  {
    participants: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
      ],
      default: [],
      validate: {
        validator(participants) {
          return (
            Array.isArray(participants) &&
            participants.length >= 2 &&
            new Set(participants.map(String)).size === participants.length
          );
        },
        message: "A conversation requires at least two unique participants.",
      },
    },

    isGroup: {
      type: Boolean,
      default: false,
    },

    groupName: {
      type: String,
      default: "",
      trim: true,
      maxlength: 100,
    },

    groupAvatar: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2048,
    },

    groupAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    isFavorite: {
      type: Boolean,
      default: false,
      index: true,
    },

    isMuted: {
      type: Boolean,
      default: false,
    },

    lastMessage: {
      type: String,
      default: "",
      trim: true,
      maxlength: 5000,
    },

    lastMessageType: {
      type: String,
      enum: MESSAGE_TYPES,
      default: "text",
    },

    lastMessageAt: {
      type: Date,
      default: null,
      index: true,
    },

    lastSender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    unreadCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    status: {
      type: String,
      enum: ["open", "closed", "archived"],
      default: "open",
      index: true,
    },

    channel: {
      type: String,
      enum: ["chat", "sms", "email", "call", "multi"],
      default: "chat",
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

// Supports listing a user's conversations with the newest activity first.
ConversationSchema.index({ participants: 1, lastMessageAt: -1 });

// Supports general conversation-list sorting and legacy CRM conversation views.
ConversationSchema.index({ updatedAt: -1 });
ConversationSchema.index({ lastMessageAt: -1 });

// Supports channel/status filters used by CRM conversation lists.
ConversationSchema.index({ channel: 1, status: 1, lastMessageAt: -1 });

ConversationSchema.pre("save", function syncUpdatedAtWithLastMessageAt(next) {
  if (
    this.lastMessageAt &&
    (!this.updatedAt || this.lastMessageAt > this.updatedAt)
  ) {
    this.updatedAt = this.lastMessageAt;
  }

  next();
});

module.exports = mongoose.model("Conversation", ConversationSchema);