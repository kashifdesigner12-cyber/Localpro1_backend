const mongoose = require("mongoose");

// =====================================================
// ATTENDANCE SCHEMA
// =====================================================

const AttendanceSchema = new mongoose.Schema(
  {
    // ===================================================
    // USER
    // ===================================================

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required"],
      index: true,
    },

    // ===================================================
    // ATTENDANCE DATE
    // ===================================================
    // Calendar day of attendance.
    // Normalized to calendar day start.
    // ===================================================

    date: {
      type: Date,
      required: [true, "Attendance date is required"],
      index: true,
    },

    // ===================================================
    // SCHEDULED ATTENDANCE TIME
    // ===================================================
    // Optional because manually created attendance
    // records may not have a schedule.
    // ===================================================

    scheduledTime: {
      type: Date,
      default: null,
      index: true,
    },

    // ===================================================
    // ATTENDANCE WINDOW
    // ===================================================

    windowStart: {
      type: Date,
      default: null,
    },

    windowEnd: {
      type: Date,
      default: null,
    },

    // ===================================================
    // CHECK IN
    // ===================================================

    checkIn: {
      type: Date,
      default: null,
    },

    // ===================================================
    // CHECK OUT
    // ===================================================

    checkOut: {
      type: Date,
      default: null,
    },

    // ===================================================
    // ATTENDANCE STATUS
    // ===================================================

    status: {
      type: String,
      enum: {
        values: [
          "Pending",
          "Present",
          "Absent",
          "Late",
          "Half Day",
          "Leave",
        ],
        message: "Invalid attendance status.",
      },
      default: "Pending",
      index: true,
    },

    // ===================================================
    // NOTIFICATION
    // ===================================================

    notificationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Notification",
      default: null,
    },

    notificationSentAt: {
      type: Date,
      default: null,
    },

    // ===================================================
    // ATTENDANCE MARKING INFORMATION
    // ===================================================

    markedAt: {
      type: Date,
      default: null,
    },

    // ===================================================
    // NOTES
    // ===================================================

    notes: {
      type: String,
      trim: true,
      default: "",
      maxlength: 1000,
    },
  },

  // =====================================================
  // SCHEMA OPTIONS
  // =====================================================

  {
    timestamps: true,

    // Automatically include virtual fields such as `id`
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        // MongoDB ObjectId -> normal string ID
        if (ret._id) {
          ret.id = ret._id.toString();
        }

        // Don't expose duplicate _id in normal API response
        delete ret._id;

        // Mongoose internal version field
        delete ret.__v;

        return ret;
      },
    },

    toObject: {
      virtuals: true,
      transform: function (doc, ret) {
        if (ret._id) {
          ret.id = ret._id.toString();
        }

        delete ret._id;
        delete ret.__v;

        return ret;
      },
    },
  }
);

// =====================================================
// ID VIRTUAL
// =====================================================
// This makes:
//
// attendance.id
//
// available everywhere as a string.
//
// MongoDB still internally uses:
//
// attendance._id
//
// =====================================================

AttendanceSchema.virtual("id").get(function () {
  return this._id ? this._id.toString() : null;
});

// =====================================================
// NORMALIZE DATE BEFORE SAVE
// =====================================================

AttendanceSchema.pre("validate", function (next) {
  if (this.date) {
    const normalizedDate = new Date(this.date);

    if (!Number.isNaN(normalizedDate.getTime())) {
      this.date = normalizedDate;
    }
  }

  next();
});

// =====================================================
// ATTENDANCE WINDOW VALIDATION
// =====================================================

AttendanceSchema.pre("validate", function (next) {
  // -----------------------------------------------------
  // Window end cannot be before window start
  // -----------------------------------------------------

  if (
    this.windowStart &&
    this.windowEnd &&
    this.windowEnd < this.windowStart
  ) {
    return next(
      new Error(
        "Attendance window end cannot be before window start."
      )
    );
  }

  // -----------------------------------------------------
  // Check-out cannot be before check-in
  // -----------------------------------------------------

  if (
    this.checkIn &&
    this.checkOut &&
    this.checkOut < this.checkIn
  ) {
    return next(
      new Error(
        "Check-out time cannot be before check-in time."
      )
    );
  }

  next();
});

// =====================================================
// UNIQUE ATTENDANCE PER USER PER DAY
// =====================================================

AttendanceSchema.index(
  {
    user: 1,
    date: 1,
  },
  {
    unique: true,
    name: "unique_user_attendance_per_day",
  }
);

// =====================================================
// USER ATTENDANCE HISTORY
// =====================================================

AttendanceSchema.index(
  {
    user: 1,
    date: -1,
  },
  {
    name: "user_attendance_history",
  }
);

// =====================================================
// ATTENDANCE BY DATE
// =====================================================

AttendanceSchema.index(
  {
    date: -1,
  },
  {
    name: "attendance_by_date",
  }
);

// =====================================================
// ATTENDANCE BY STATUS
// =====================================================

AttendanceSchema.index(
  {
    status: 1,
  },
  {
    name: "attendance_by_status",
  }
);

// =====================================================
// DATE + STATUS
// =====================================================

AttendanceSchema.index(
  {
    date: 1,
    status: 1,
  },
  {
    name: "attendance_date_status",
  }
);

// =====================================================
// PENDING ATTENDANCE WINDOW
// =====================================================

AttendanceSchema.index(
  {
    status: 1,
    windowEnd: 1,
  },
  {
    name: "pending_attendance_window",
  }
);

// =====================================================
// SCHEDULED ATTENDANCE
// =====================================================

AttendanceSchema.index(
  {
    scheduledTime: 1,
    status: 1,
  },
  {
    name: "scheduled_attendance_status",
  }
);

// =====================================================
// EXPORT MODEL
// =====================================================

module.exports =
  mongoose.models.Attendance ||
  mongoose.model(
    "Attendance",
    AttendanceSchema
  );