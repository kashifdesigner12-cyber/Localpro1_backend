const mongoose = require('mongoose');

const ContactSchema = new mongoose.Schema(
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
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    name: {
      type: String,
      required: [true, 'Contact name is required'],
      trim: true
    },
    firstName: {
      type: String,
      trim: true,
      default: ''
    },
    lastName: {
      type: String,
      trim: true,
      default: ''
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: ''
    },
    phone: {
      type: String,
      trim: true,
      default: ''
    },
    company: {
      type: String,
      trim: true,
      default: ''
    },
    jobTitle: {
      type: String,
      trim: true,
      default: ''
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'lead', 'customer', 'contacted', 'qualified', 'proposal', 'won', 'lost'],
      default: 'lead'
    },
    leadStatus: {
      type: String,
      enum: ['New', 'Contacted', 'Qualified', 'Proposal', 'Won', 'Lost', 'None', ''],
      default: 'New'
    },
    source: {
      type: String,
      enum: ['manual', 'sms', 'call', 'email', 'web', 'import', 'referral', 'other'],
      default: 'manual'
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    tags: [
      {
        type: String,
        trim: true
      }
    ],
    notes: {
      type: String,
      trim: true,
      default: ''
    },
    address: {
      type: String,
      trim: true,
      default: ''
    },
    city: {
      type: String,
      trim: true,
      default: ''
    },
    state: {
      type: String,
      trim: true,
      default: ''
    },
    country: {
      type: String,
      trim: true,
      default: ''
    },
    zipCode: {
      type: String,
      trim: true,
      default: ''
    },
    avatar: {
      type: String,
      default: null
    },
    avatarColor: {
      type: String
    },
    lastContactedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

ContactSchema.index({ userId: 1, phone: 1 });
ContactSchema.index({ userId: 1, email: 1 });
ContactSchema.index({ userId: 1, name: 'text' });
ContactSchema.index({ userId: 1, status: 1 });
ContactSchema.index({ userId: 1, leadStatus: 1 });
ContactSchema.index({ userId: 1, assignedTo: 1 });
ContactSchema.index({ createdAt: -1 });

ContactSchema.pre('save', function (next) {
  // Sync name with firstName/lastName
  if (this.firstName || this.lastName) {
    if (!this.name || this.isModified('firstName') || this.isModified('lastName')) {
      this.name = `${this.firstName || ''} ${this.lastName || ''}`.trim() || this.name;
    }
  } else if (this.name && (!this.firstName && !this.lastName)) {
    const parts = this.name.trim().split(/\s+/);
    this.firstName = parts[0] || '';
    this.lastName = parts.slice(1).join(' ') || '';
  }

  // Set user alias if needed
  if (!this.user && this.userId) this.user = this.userId;
  if (!this.createdBy && this.userId) this.createdBy = this.userId;

  // Set random avatar color if none
  if (!this.avatarColor) {
    const colors = ['#2563EB', '#171B3A', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];
    this.avatarColor = colors[Math.floor(Math.random() * colors.length)];
  }
  next();
});

module.exports = mongoose.model('Contact', ContactSchema);