const mongoose = require('mongoose');

const EmailSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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
    subject: {
      type: String,
      trim: true,
      default: ''
    },
    body: {
      type: String,
      default: ''
    },
    html: {
      type: String,
      default: ''
    },
    attachments: [
      {
        filename: { type: String },
        contentType: { type: String },
        size: { type: Number },
        url: { type: String },
        storageKey: { type: String }
      }
    ],
    providerMessageId: {
      type: String,
      sparse: true
    },
    direction: {
      type: String,
      enum: ['inbound', 'outbound'],
      default: 'outbound'
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'failed', 'received', 'draft', 'queued'],
      default: 'sent'
    },
    isRead: {
      type: Boolean,
      default: false
    },
    readAt: {
      type: Date,
      default: null
    },
    isArchived: {
      type: Boolean,
      default: false
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

EmailSchema.pre('save', function (next) {
  if (!this.user && this.userId) this.user = this.userId;
  if (!this.userId && this.user) this.userId = this.user;
  if (!this.contact && this.contactId) this.contact = this.contactId;
  if (!this.contactId && this.contact) this.contactId = this.contact;
  next();
});

EmailSchema.index({ userId: 1, createdAt: -1 });
EmailSchema.index({ user: 1, createdAt: -1 });
EmailSchema.index({ contactId: 1, createdAt: -1 });
EmailSchema.index({ conversationId: 1 });
EmailSchema.index({ providerMessageId: 1 });
EmailSchema.index({ isRead: 1 });

module.exports = mongoose.model('Email', EmailSchema);