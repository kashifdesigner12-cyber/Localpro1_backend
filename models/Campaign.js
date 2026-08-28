const mongoose = require('mongoose');

const CampaignSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Campaign name is required'],
      trim: true
    },
    title: {
      type: String,
      trim: true
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    type: {
      type: String,
      enum: ['email', 'sms', 'social', 'call', 'multi-channel', 'custom'],
      default: 'email'
    },
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled'],
      default: 'draft'
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    audience: {
      segment: { type: String, default: 'all' },
      tags: [{ type: String, trim: true }],
      contactCount: { type: Number, default: 0 },
      filters: { type: mongoose.Schema.Types.Mixed, default: {} }
    },
    schedule: {
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null },
      sendTime: { type: String, default: '' },
      timezone: { type: String, default: 'UTC' },
      isRecurring: { type: Boolean, default: false },
      frequency: { type: String, enum: ['daily', 'weekly', 'monthly', 'once'], default: 'once' }
    },
    content: {
      subject: { type: String, default: '' },
      body: { type: String, default: '' },
      html: { type: String, default: '' },
      templateId: { type: String, default: '' },
      attachments: [{ type: mongoose.Schema.Types.Mixed }]
    },
    budget: {
      allocated: { type: Number, default: 0 },
      spent: { type: Number, default: 0 },
      currency: { type: String, default: 'USD' }
    },
    stats: {
      sent: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      opened: { type: Number, default: 0 },
      clicked: { type: Number, default: 0 },
      bounced: { type: Number, default: 0 },
      unsubscribed: { type: Number, default: 0 },
      conversions: { type: Number, default: 0 },
      revenue: { type: Number, default: 0 }
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

CampaignSchema.pre('save', function (next) {
  if (!this.title && this.name) {
    this.title = this.name;
  }
  if (!this.name && this.title) {
    this.name = this.title;
  }
  next();
});

CampaignSchema.index({ createdBy: 1, createdAt: -1 });
CampaignSchema.index({ status: 1 });
CampaignSchema.index({ type: 1 });

module.exports = mongoose.model('Campaign', CampaignSchema);