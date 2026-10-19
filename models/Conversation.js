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

const CONVERSATION_STATUSES = ["open", "closed", "archived"];
const CONVERSATION_CHANNELS = ["chat", "sms", "email", "call", "multi"];

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
          if (!Array.isArray(participants) || participants.length < 2) {
            return false;
          }

          const participantIds = participants.map((participant) =>
            String(participant)
          );

          return (
            participantIds.every((id) => mongoose.Types.ObjectId.isValid(id)) &&
            new Set(participantIds).size === participantIds.length
          );
        },
        message:
          "A conversation requires at least two unique valid participants.",
      },
    },

    isGroup: {
      type: Boolean,
      default: false,
      index: true,
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
      enum: CONVERSATION_STATUSES,
      default: "open",
      index: true,
    },

    channel: {
      type: String,
      enum: CONVERSATION_CHANNELS,
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

// High-speed compound indexes for fast sorting and querying conversation lists
ConversationSchema.index({ participants: 1, lastMessageAt: -1 });
ConversationSchema.index({
  participants: 1,
  status: 1,
  lastMessageAt: -1,
});
ConversationSchema.index({ channel: 1, status: 1, lastMessageAt: -1 });
ConversationSchema.index({ updatedAt: -1 });
ConversationSchema.index({ lastMessageAt: -1 });

// Keep updatedAt aligned with newer message activity
ConversationSchema.pre("save", function syncUpdatedAtWithLastMessageAt(next) {
  if (
    this.lastMessageAt &&
    (!this.updatedAt || this.lastMessageAt.getTime() > this.updatedAt.getTime())
  ) {
    this.updatedAt = this.lastMessageAt;
  }

  next();
});

module.exports =
  mongoose.models.Conversation ||
  mongoose.model("Conversation", ConversationSchema);