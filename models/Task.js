const mongoose = require('mongoose');

const TaskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Task title is required'],
      trim: true,
      minlength: [1, 'Title cannot be empty'],
    },

    description: {
      type: String,
      trim: true,
      default: '',
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Created by is required'],
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Assigned to is required'],
    },

    contact: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contact',
      default: null,
    },

    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contact',
      default: null,
    },

    category: {
      type: String,
      trim: true,
      default: 'General',
    },

    priority: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Urgent'],
      default: 'Medium',
    },

    status: {
      type: String,
      enum: ['Pending', 'In Progress', 'Completed', 'Cancelled'],
      default: 'Pending',
    },

    dueDate: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    attachments: [
      {
        url: {
          type: String,
          trim: true,
          required: true,
        },

        filename: {
          type: String,
          trim: true,
        },

        originalName: {
          type: String,
          trim: true,
        },

        fileType: {
          type: String,
          trim: true,
        },

        size: {
          type: Number,
          min: 0,
        },

        uploadedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },

        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    comments: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },

        text: {
          type: String,
          required: true,
          trim: true,
        },

        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    activity: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },

        action: {
          type: String,
          required: true,
        },

        details: {
          type: String,
          default: '',
        },

        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

/*
 * =========================================================
 * PERFORMANCE INDEXES
 * =========================================================
 */

// Dashboard / recent tasks
TaskSchema.index({
  createdAt: -1,
});

// User-specific task lists
TaskSchema.index({
  assignedTo: 1,
  createdAt: -1,
});

TaskSchema.index({
  createdBy: 1,
  createdAt: -1,
});

// Contact-based task lookups
TaskSchema.index({
  contact: 1,
});

TaskSchema.index({
  contactId: 1,
});

// Task filtering
TaskSchema.index({
  status: 1,
});

TaskSchema.index({
  priority: 1,
});

TaskSchema.index({
  dueDate: 1,
});

module.exports = mongoose.model('Task', TaskSchema);