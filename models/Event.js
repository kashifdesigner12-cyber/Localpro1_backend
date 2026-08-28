const mongoose = require('mongoose');

const EventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Event title is required'],
      trim: true,
      minlength: [1, 'Title cannot be empty']
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required']
    },
    endDate: {
      type: Date,
      required: [true, 'End date is required']
    },
    allDay: {
      type: Boolean,
      default: false
    },
    location: {
      type: String,
      trim: true,
      default: ''
    },
    type: {
      type: String,
      enum: ['meeting', 'task', 'reminder', 'call', 'holiday', 'appointment', 'other'],
      default: 'meeting'
    },
    eventType: {
      type: String,
      enum: ['meeting', 'task', 'reminder', 'call', 'holiday', 'appointment', 'other'],
      default: 'meeting'
    },
    color: {
      type: String,
      default: '#3B82F6'
    },
    startTime: {
      type: String,
      default: ''
    },
    endTime: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['scheduled', 'completed', 'cancelled'],
      default: 'scheduled'
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Created by is required']
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    contact: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contact',
      default: null
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contact',
      default: null
    },
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    ],
    attendees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    ]
  },
  { timestamps: true }
);

// Performance indexes
EventSchema.index({ createdBy: 1, startDate: 1 });
EventSchema.index({ assignedTo: 1, startDate: 1 });
EventSchema.index({ participants: 1, startDate: 1 });
EventSchema.index({ attendees: 1, startDate: 1 });
EventSchema.index({ contact: 1 });
EventSchema.index({ status: 1 });
EventSchema.index({ type: 1 });
EventSchema.index({ startDate: 1, endDate: 1 });

module.exports = mongoose.model('Event', EventSchema);