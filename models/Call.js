const mongoose = require('mongoose');

const CallSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
      index: true
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contact',
      default: null,
      index: true
    },
    contact: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contact',
      default: null
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      default: null
    },
    callSid: {
      type: String,
      unique: true,
      sparse: true
    },
    from: {
      type: String,
      trim: true,
      default: ''
    },
    to: {
      type: String,
      trim: true,
      default: ''
    },
    phoneNumber: {
      type: String,
      trim: true,
      default: ''
    },
    direction: {
      type: String,
      enum: ['inbound', 'outbound'],
      default: 'outbound',
      index: true
    },
    status: {
      type: String,
      enum: [
        'initiated',
        'ringing',
        'in-progress',
        'answered',
        'completed',
        'busy',
        'no-answer',
        'canceled',
        'failed',
        'missed',
        'voicemail'
      ],
      default: 'initiated',
      index: true
    },
    duration: {
      type: Number,
      default: 0
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    },
    recordingUrl: {
      type: String,
      default: ''
    },
    recordingSid: {
      type: String,
      default: ''
    },
    startedAt: {
      type: Date,
      default: null
    },
    endedAt: {
      type: Date,
      default: null
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

CallSchema.index({ userId: 1, createdAt: -1 });
CallSchema.index({ user: 1, createdAt: -1 });
CallSchema.index({ contactId: 1, createdAt: -1 });
CallSchema.index({ contact: 1, createdAt: -1 });
CallSchema.index({ callSid: 1 });
CallSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Call', CallSchema);