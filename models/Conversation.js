"use strict";

const mongoose = require("mongoose");

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
      enum: [
        "text",
        "image",
        "file",
        "document",
        "video",
        "audio",
        "system",
      ],
      default: "text",
    },

    lastMessageAt: {
      type: Date,
      default: null,
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
    },

    channel: {
      type: String,
      enum: ["chat", "sms", "email", "call", "multi"],
      default: "chat",
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

ConversationSchema.index({
  participants: 1,
  lastMessageAt: -1,
});

ConversationSchema.index({
  updatedAt: -1,
});

ConversationSchema.index({
  lastMessageAt: -1,
});

ConversationSchema.pre("save", function (next) {
  if (
    this.lastMessageAt &&
    (!this.updatedAt || this.lastMessageAt > this.updatedAt)
  ) {
    this.updatedAt = this.lastMessageAt;
  }

  next();
});

module.exports = mongoose.model(
  "Conversation",
  ConversationSchema
);