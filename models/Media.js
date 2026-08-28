const mongoose = require('mongoose');

const MediaSchema = new mongoose.Schema(
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
    filename: {
      type: String,
      required: [true, 'Filename is required'],
      trim: true
    },
    originalName: {
      type: String,
      trim: true,
      default: ''
    },
    mimeType: {
      type: String,
      trim: true,
      default: 'application/octet-stream'
    },
    fileType: {
      type: String,
      enum: ['image', 'video', 'audio', 'document', 'other'],
      default: 'other'
    },
    size: {
      type: Number,
      default: 0
    },
    url: {
      type: String,
      required: [true, 'URL is required']
    },
    path: {
      type: String,
      default: ''
    },
    key: {
      type: String,
      default: ''
    },
    isPublic: {
      type: Boolean,
      default: true
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

MediaSchema.index({ userId: 1, createdAt: -1 });
MediaSchema.index({ fileType: 1 });

module.exports = mongoose.model('Media', MediaSchema);