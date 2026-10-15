const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// ============================================================
// ATTENDANCE SCHEDULE SUB-SCHEMA
// ============================================================

const AttendanceScheduleSchema = new mongoose.Schema(
  {
    // 0 = Sunday, 1 = Monday, ... 6 = Saturday
    dayOfWeek: {
      type: Number,
      min: 0,
      max: 6,
    },

    enabled: {
      type: Boolean,
      default: false,
    },

    startTime: {
      type: String,
      trim: true,
      default: "09:00",
      match: [
        /^$|^([01]\d|2[0-3]):([0-5]\d)$/,
        "Start time must be in HH:mm format",
      ],
    },

    endTime: {
      type: String,
      trim: true,
      default: "17:00",
      match: [
        /^$|^([01]\d|2[0-3]):([0-5]\d)$/,
        "End time must be in HH:mm format",
      ],
    },

    windowStart: {
      type: String,
      trim: true,
      default: "08:45",
      match: [
        /^$|^([01]\d|2[0-3]):([0-5]\d)$/,
        "Window start time must be in HH:mm format",
      ],
    },

    windowEnd: {
      type: String,
      trim: true,
      default: "09:30",
      match: [
        /^$|^([01]\d|2[0-3]):([0-5]\d)$/,
        "Window end time must be in HH:mm format",
      ],
    },

    gracePeriodMinutes: {
      type: Number,
      default: 10,
      min: 1,
      max: 60,
    },

    timezone: {
      type: String,
      trim: true,
      default: "UTC",
    },
  },
  {
    _id: false,
  }
);

const defaultSchedule = () => ({
  startTime: "09:00",
  endTime: "17:00",
  windowStart: "08:45",
  windowEnd: "09:30",
});

// ============================================================
// USER SCHEMA
// ============================================================

const UserSchema = new mongoose.Schema(
  {
    // BASIC USER INFORMATION
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email"],
    },

    phone: {
      type: String,
      trim: true,
      default: "",
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      // Password is excluded from normal queries. Login code must use .select("+password").
      select: false,
    },

    // ROLE
    role: {
      type: String,
      enum: ["admin", "manager", "user"],
      default: "user",
      index: true,
    },

    // USER STATUS
    status: {
      type: String,
      enum: ["Active", "Pending", "Blocked", "Inactive"],
      default: "Active",
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    // SOFT DELETE STATUS
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    deletedAt: {
      type: Date,
      default: null,
    },

    // AVATAR
    avatar: {
      type: String,
      default: null,
    },

    // TWILIO
    twilioPhoneNumber: {
      type: String,
      trim: true,
      default: "",
    },

    // ATTENDANCE SETTINGS
    attendanceSettings: {
      enabled: {
        type: Boolean,
        default: false,
      },
      attendanceTime: {
        type: String,
        trim: true,
        default: "",
        match: [
          /^$|^([01]\d|2[0-3]):([0-5]\d)$/,
          "Attendance time must be in HH:mm format",
        ],
      },
      gracePeriodMinutes: {
        type: Number,
        default: 10,
        min: 1,
        max: 60,
      },
      timezone: {
        type: String,
        trim: true,
        default: "UTC",
      },
    },

    // Keep these as Mixed objects to preserve compatibility with existing
    // controllers that store a single schedule object rather than an array.
    attendanceSchedule: {
      type: mongoose.Schema.Types.Mixed,
      default: defaultSchedule,
    },

    workSchedule: {
      type: mongoose.Schema.Types.Mixed,
      default: defaultSchedule,
    },

    // BUSINESS INFORMATION
    business: {
      companyName: { type: String, default: "" },
      website: { type: String, default: "" },
      address: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      zipCode: { type: String, default: "" },
      country: { type: String, default: "" },
      taxId: { type: String, default: "" },
      industry: { type: String, default: "" },
    },

    // USER PREFERENCES
    preferences: {
      theme: {
        type: String,
        enum: ["light", "dark", "system"],
        default: "system",
      },
      language: {
        type: String,
        default: "en",
      },
      timezone: {
        type: String,
        trim: true,
        default: "UTC",
      },
      dateFormat: {
        type: String,
        default: "YYYY-MM-DD",
      },
      attendanceSchedule: {
        type: mongoose.Schema.Types.Mixed,
        default: defaultSchedule,
      },
      workSchedule: {
        type: mongoose.Schema.Types.Mixed,
        default: defaultSchedule,
      },
    },

    // NOTIFICATION PREFERENCES
    notificationPreferences: {
      emailNotifications: { type: Boolean, default: true },
      pushNotifications: { type: Boolean, default: true },
      taskUpdates: { type: Boolean, default: true },
      appointmentAlerts: { type: Boolean, default: true },
      messageAlerts: { type: Boolean, default: true },
    },

    // INTEGRATIONS
    integrations: {
      twilioEnabled: { type: Boolean, default: false },
      sendgridEnabled: { type: Boolean, default: false },
      googleCalendarConnected: { type: Boolean, default: false },
      webhookUrl: { type: String, default: "" },
    },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

// Keep the schema reference available for future schedule validation/use.
// Existing attendanceSchedule/workSchedule fields remain Mixed for compatibility.
void AttendanceScheduleSchema;

// ============================================================
// HASH PASSWORD BEFORE SAVE
// ============================================================

UserSchema.pre("save", async function (next) {
  try {
    if (!this.isModified("password")) {
      return next();
    }

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    return next();
  } catch (error) {
    return next(error);
  }
});

// ============================================================
// COMPARE PASSWORD
// ============================================================

UserSchema.methods.comparePassword = async function (candidatePassword) {
  if (typeof candidatePassword !== "string" || !this.password) {
    return false;
  }

  return bcrypt.compare(candidatePassword, this.password);
};

// ============================================================
// EXPORT
// ============================================================

module.exports = mongoose.model("User", UserSchema);
