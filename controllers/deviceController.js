
import mongoose from "mongoose";
import Device from "../models/Device.js";

const validObjectId = (id) => mongoose.isValidObjectId(id);

const deviceTypes = ["desktop", "laptop", "mobile", "tablet", "other"];
const deviceStatuses = ["available", "assigned", "maintenance", "retired"];

const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const getDevices = async (req, res, next) => {
  try {
    const { status, type, deviceType, search } = req.query;
    const filter = {};
    const selectedType = deviceType || type;

    if (status && status !== "all") {
      if (!deviceStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid device status.",
        });
      }
      filter.status = status;
    }

    if (selectedType && selectedType !== "all") {
      if (!deviceTypes.includes(selectedType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid device type.",
        });
      }
      filter.deviceType = selectedType;
    }

    if (typeof search === "string" && search.trim()) {
      const regex = new RegExp(escapeRegex(search.trim()), "i");
      filter.$or = [
        { name: regex },
        { serialNumber: regex },
      ];
    }

    const devices = await Device.find(filter)
      .populate("assignedTo", "name email")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.json({
      success: true,
      count: devices.length,
      data: devices,
    });
  } catch (error) {
    next(error);
  }
};

export const createDevice = async (req, res, next) => {
  try {
    const {
      name,
      type,
      deviceType,
      serialNumber,
      status,
      assignedTo,
      notes,
    } = req.body;

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Device name is required.",
      });
    }

    const selectedType = deviceType || type || "other";
    const selectedStatus =
      status || (assignedTo ? "assigned" : "available");

    if (!deviceTypes.includes(selectedType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid device type.",
      });
    }

    if (!deviceStatuses.includes(selectedStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid device status.",
      });
    }

    if (assignedTo && !validObjectId(assignedTo)) {
      return res.status(400).json({
        success: false,
        message: "Invalid assigned user ID.",
      });
    }

    if (assignedTo && selectedStatus === "available") {
      return res.status(400).json({
        success: false,
        message: "An assigned device cannot have available status.",
      });
    }

    const device = await Device.create({
      name: name.trim(),
      deviceType: selectedType,
      serialNumber:
        typeof serialNumber === "string" ? serialNumber.trim() : "",
      status: selectedStatus,
      assignedTo: assignedTo || null,
      notes: typeof notes === "string" ? notes.trim() : "",
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    const populatedDevice = await Device.findById(device._id)
      .populate("assignedTo", "name email")
      .populate("createdBy", "name email")
      .lean();

    return res.status(201).json({
      success: true,
      message: "Device created successfully.",
      data: populatedDevice,
    });
  } catch (error) {
    next(error);
  }
};

export const updateDevice = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!validObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid device ID.",
      });
    }

    const {
      name,
      type,
      deviceType,
      serialNumber,
      status,
      assignedTo,
      notes,
    } = req.body;

    const updates = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Device name is required.",
        });
      }
      updates.name = name.trim();
    }

    const selectedType = deviceType ?? type;
    if (selectedType !== undefined) {
      if (!deviceTypes.includes(selectedType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid device type.",
        });
      }
      updates.deviceType = selectedType;
    }

    if (status !== undefined) {
      if (!deviceStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid device status.",
        });
      }
      updates.status = status;
    }

    if (assignedTo !== undefined) {
      if (assignedTo && !validObjectId(assignedTo)) {
        return res.status(400).json({
          success: false,
          message: "Invalid assigned user ID.",
        });
      }
      updates.assignedTo = assignedTo || null;
    }

    if (serialNumber !== undefined) {
      updates.serialNumber =
        typeof serialNumber === "string" ? serialNumber.trim() : "";
    }

    if (notes !== undefined) {
      updates.notes = typeof notes === "string" ? notes.trim() : "";
    }

    const existingDevice = await Device.findById(id);

    if (!existingDevice) {
      return res.status(404).json({
        success: false,
        message: "Device not found.",
      });
    }

    const finalAssignedTo =
      updates.assignedTo !== undefined
        ? updates.assignedTo
        : existingDevice.assignedTo;

    if (finalAssignedTo && updates.status === "available") {
      return res.status(400).json({
        success: false,
        message: "An assigned device cannot have available status.",
      });
    }

    if (updates.assignedTo === null && updates.status === undefined) {
      updates.status = "available";
    } else if (finalAssignedTo && updates.status === undefined) {
      updates.status = "assigned";
    }

    updates.updatedBy = req.user._id;

    const device = await Device.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    )
      .populate("assignedTo", "name email")
      .populate("createdBy", "name email")
      .lean();

    return res.json({
      success: true,
      message: "Device updated successfully.",
      data: device,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteDevice = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!validObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid device ID.",
      });
    }

    const device = await Device.findByIdAndDelete(id);

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found.",
      });
    }

    return res.json({
      success: true,
      message: "Device deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};
