const mongoose = require('mongoose');

const ConversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      }
    ],

    lastMessage: {
      type: String,
      default: ''
    },

    lastMessageType: {
      type: String,
      enum: ['text', 'image', 'file', 'document', 'video', 'audio', 'system'],
      default: 'text'
    },

    lastMessageAt: {
      type: Date,
      default: null
    },

    lastSender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    unreadCount: {
      type: Number,
      default: 0
    },

    status: {
      type: String,
      enum: ['open', 'closed', 'archived'],
      default: 'open'
    },

    channel: {
      type: String,
      enum: ['chat', 'sms', 'email', 'call', 'multi'],
      default: 'chat'
    },

    // Legacy fields for backward compatibility
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contact',
      default: null
    }
  },
  {
    timestamps: true
  }
);

ConversationSchema.index({
  participants: 1,
  updatedAt: -1
});

ConversationSchema.index({
  updatedAt: -1
});

ConversationSchema.index({
  lastMessageAt: -1
});

module.exports = mongoose.model('Conversation', ConversationSchema);