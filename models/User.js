
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "Username is required"],
      unique: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 50,
      match: [
        /^[a-z0-9._-]+$/,
        "Username can contain letters, numbers, dots, underscores and hyphens only",
      ],
    },

    name: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "",
    },

    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      default: undefined,
      validate: {
        validator(value) {
          return (
            value === undefined ||
            value === null ||
            value === "" ||
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
          );
        },
        message: "Invalid email address",
      },
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      select: false,
      minlength: 8,
    },

    role: {
      type: String,
      enum: ["admin", "manager", "user"],
      default: "user",
      required: true,
    },

    status: {
      type: String,
      enum: ["active", "pending", "blocked", "inactive"],
      default: "active",
      required: true,
    },

    profilePicture: {
      type: String,
      default: "",
    },

    jobTitle: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "",
    },

    department: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "",
    },

    phone: {
      type: String,
      trim: true,
      maxlength: 30,
      default: "",
    },

    location: {
      type: String,
      trim: true,
      maxlength: 150,
      default: "",
    },

    settings: {
      emailNotifications: {
        type: Boolean,
        default: true,
      },
      taskNotifications: {
        type: Boolean,
        default: true,
      },
      attendanceNotifications: {
        type: Boolean,
        default: true,
      },
      appearance: {
        type: String,
        enum: ["light", "dark"],
        default: "light",
      },
    },

    invitationTokenHash: {
      type: String,
      select: false,
      default: undefined,
    },

    invitationExpiresAt: {
      type: Date,
      default: undefined,
    },

    passwordChangedAt: {
      type: Date,
      default: undefined,
    },

    lastLoginAt: {
      type: Date,
      default: undefined,
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

// Fast filtering by role and account status.
userSchema.index({
  role: 1,
  status: 1,
});

// Fast chat contact filtering and alphabetical sorting.
userSchema.index({
  status: 1,
  name: 1,
  _id: 1,
});

// Existing user listing indexes.
userSchema.index({
  status: 1,
  createdAt: -1,
});

userSchema.index({
  createdAt: -1,
});

const User =
  mongoose.models.User || mongoose.model("User", userSchema);

export default User;
