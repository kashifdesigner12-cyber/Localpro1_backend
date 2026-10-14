const mongoose = require('mongoose');

const ConversationSchema = new mongoose.Schema(
  {
    participants: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true
        }
      ],
      default: [],
      validate: {
        validator: function (participants) {
          if (this.isGroup) {
            return participants.length >= 2;
          }

          return participants.length >= 2;
        },
        message: 'A conversation must have at least two participants.'
      }
    },

    isGroup: {
      type: Boolean,
      default: false
    },

    groupName: {
      type: String,
      default: '',
      trim: true
    },

    groupAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    lastMessage: {
      type: String,
      default: ''
    },

    lastMessageType: {
      type: String,
      enum: [
        'text',
        'image',
        'file',
        'document',
        'video',
        'audio',
        'system'
      ],
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
      default: 0,
      min: 0
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

// Indexes for conversation lookup and sorting
ConversationSchema.index({
  participants: 1,
  lastMessageAt: -1
});

ConversationSchema.index({
  updatedAt: -1
});

ConversationSchema.index({
  lastMessageAt: -1
});

// Keep conversation metadata updated whenever a document is saved
ConversationSchema.pre('save', function (next) {
  if (this.lastMessageAt && this.lastMessageAt > this.updatedAt) {
    this.updatedAt = this.lastMessageAt;
  }

  next();
});

module.exports = mongoose.model(
  'Conversation',
  ConversationSchema
);