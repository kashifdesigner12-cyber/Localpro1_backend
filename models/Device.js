import mongoose from "mongoose";

const deviceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Device name is required"],
      trim: true,
      maxlength: 150,
    },

    deviceType: {
      type: String,
      enum: ["desktop", "laptop", "mobile", "tablet", "other"],
      default: "other",
    },

    serialNumber: {
      type: String,
      trim: true,
      maxlength: 150,
      default: "",
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    status: {
      type: String,
      enum: ["available", "assigned", "maintenance", "retired"],
      default: "available",
      index: true,
    },

    notes: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
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

deviceSchema.index({ serialNumber: 1 }, { sparse: true });

const Device = mongoose.model("Device", deviceSchema);

export default Device;