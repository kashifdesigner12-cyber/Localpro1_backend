import mongoose from "mongoose";

const attendanceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },

    checkIn: {
      type: Date,
      default: null,
    },

    checkOut: {
      type: Date,
      default: null,
    },

    checkInLocation: {
      latitude: {
        type: Number,
        default: null,
      },
      longitude: {
        type: Number,
        default: null,
      },
    },

    checkOutLocation: {
      latitude: {
        type: Number,
        default: null,
      },
      longitude: {
        type: Number,
        default: null,
      },
    },

    status: {
      type: String,
      enum: ["present", "late", "absent", "half_day", "leave"],
      default: "present",
    },

    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },

    reminderSentAt: {
      type: Date,
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// One attendance record per user per date.
// Supports user-specific history and today's attendance queries.
attendanceSchema.index(
  { user: 1, date: 1 },
  { unique: true }
);

// Supports manager/admin attendance listings by date.
attendanceSchema.index({ date: -1, checkIn: -1 });

// Supports filtering attendance by date and status.
attendanceSchema.index({ date: 1, status: 1 });

const Attendance = mongoose.model("Attendance", attendanceSchema);

export default Attendance;