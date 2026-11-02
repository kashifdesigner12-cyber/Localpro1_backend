import mongoose from "mongoose";

const isValidTime = (value) =>
  typeof value === "string" &&
  /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);

const workspaceSettingsSchema = new mongoose.Schema(
  {
    workspaceName: {
      type: String,
      trim: true,
      maxlength: 150,
      default: "",
    },

    timezone: {
      type: String,
      enum: [
        "Asia/Karachi",
        "Asia/Dubai",
        "Asia/Kolkata",
        "Europe/London",
        "America/New_York",
        "UTC",
      ],
      default: "Asia/Karachi",
    },

    dateFormat: {
      type: String,
      enum: ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"],
      default: "DD/MM/YYYY",
    },

    workStart: {
      type: String,
      default: "09:00",
      validate: {
        validator: isValidTime,
        message: "Work start time must use HH:mm format.",
      },
    },

    workEnd: {
      type: String,
      default: "17:00",
      validate: {
        validator: isValidTime,
        message: "Work end time must use HH:mm format.",
      },
    },

    lateGracePeriod: {
      type: Number,
      min: 0,
      max: 180,
      default: 10,
      validate: {
        validator: Number.isFinite,
        message: "Late grace period must be a valid number.",
      },
    },

    attendanceGpsEnabled: {
      type: Boolean,
      default: false,
    },

    officeLatitude: {
      type: Number,
      min: -90,
      max: 90,
      default: null,
    },

    officeLongitude: {
      type: Number,
      min: -180,
      max: 180,
      default: null,
    },

    attendanceRadiusMeters: {
      type: Number,
      min: 10,
      max: 10000,
      default: 200,
    },

    emailNotifications: {
      type: Boolean,
      default: true,
    },

    attendanceReminders: {
      type: Boolean,
      default: true,
    },

    securityAlerts: {
      type: Boolean,
      default: true,
    },

    requireStrongPasswords: {
      type: Boolean,
      default: true,
    },

    updatedBy: {
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

const WorkspaceSettings = mongoose.model(
  "WorkspaceSettings",
  workspaceSettingsSchema
);

export default WorkspaceSettings;