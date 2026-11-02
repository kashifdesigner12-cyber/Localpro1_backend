import mongoose from "mongoose";
import Attendance from "../models/Attendance.js";
import {
  checkInUser,
  checkOutUser,
} from "../services/attendanceService.js";

const MAX_LIMIT = 100;

const isValidCoordinate = (value, min, max) =>
  value == null ||
  (typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max);

const readCoordinates = (body = {}) => {
  const { latitude, longitude } = body;

  if (
    !isValidCoordinate(latitude, -90, 90) ||
    !isValidCoordinate(longitude, -180, 180) ||
    ((latitude == null) !== (longitude == null))
  ) {
    return null;
  }

  return {
    latitude: latitude ?? null,
    longitude: longitude ?? null,
  };
};

const validDate = (value) => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
};

const getTodayInPakistan = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const parseLimit = (value, defaultValue = 50) => {
  if (value === undefined) return defaultValue;

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return null;
  }

  return Math.min(parsed, MAX_LIMIT);
};

const sendError = (res, status, message) =>
  res.status(status).json({ success: false, message });

export const checkIn = async (req, res, next) => {
  try {
    const coordinates = readCoordinates(req.body);

    if (!coordinates) {
      return sendError(
        res,
        400,
        "Valid latitude and longitude must be provided together."
      );
    }

    const attendance = await checkInUser({
      userId: req.user._id,
      ...coordinates,
      createdBy: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: "Checked in successfully.",
      attendance,
    });
  } catch (error) {
    if (
      error.code === 11000 ||
      error.message?.toLowerCase().includes("already checked in")
    ) {
      return sendError(
        res,
        409,
        error.message || "Attendance already exists for today."
      );
    }

    return next(error);
  }
};

export const checkOut = async (req, res, next) => {
  try {
    const coordinates = readCoordinates(req.body);

    if (!coordinates) {
      return sendError(
        res,
        400,
        "Valid latitude and longitude must be provided together."
      );
    }

    const attendance = await checkOutUser({
      userId: req.user._id,
      ...coordinates,
    });

    return res.status(200).json({
      success: true,
      message: "Checked out successfully.",
      attendance,
    });
  } catch (error) {
    const message = error.message || "";

    if (
      message.toLowerCase().includes("already checked out") ||
      message.toLowerCase().includes("must check in")
    ) {
      return sendError(res, 400, message);
    }

    return next(error);
  }
};

export const getAttendance = async (req, res, next) => {
  try {
    const isManager = ["admin", "manager"].includes(req.user.role);
    const { startDate, endDate, userId } = req.query;

    if (
      (startDate && !validDate(startDate)) ||
      (endDate && !validDate(endDate))
    ) {
      return sendError(res, 400, "Dates must use YYYY-MM-DD format.");
    }

    if (startDate && endDate && startDate > endDate) {
      return sendError(
        res,
        400,
        "Start date cannot be after end date."
      );
    }

    if (userId && !isManager) {
      return sendError(
        res,
        403,
        "You are not authorized to view other users' attendance."
      );
    }

    if (userId && !mongoose.isValidObjectId(userId)) {
      return sendError(res, 400, "Invalid user ID.");
    }

    const limit = parseLimit(req.query.limit);

    if (limit === null) {
      return sendError(res, 400, "Limit must be a positive integer.");
    }

    const filter = {};

    if (!isManager) {
      filter.user = req.user._id;
    } else if (userId) {
      filter.user = userId;
    }

    if (startDate || endDate) {
      filter.date = {};

      if (startDate) filter.date.$gte = startDate;
      if (endDate) filter.date.$lte = endDate;
    }

    // Ultra-optimized attendance fetch with lean
    const attendance = await Attendance.find(filter)
      .select("-__v")
      .populate({ path: "user", select: "name email role" })
      .sort({ date: -1, checkIn: -1 })
      .limit(limit)
      .lean()
      .exec();

    return res.status(200).json({
      success: true,
      count: attendance.length,
      attendance,
    });
  } catch (error) {
    return next(error);
  }
};

export const getTodayAttendance = async (req, res, next) => {
  try {
    const today = getTodayInPakistan();
    const isManager = ["admin", "manager"].includes(req.user.role);

    const filter = { date: today };

    if (!isManager) {
      filter.user = req.user._id;
    }

    // Ultra-optimized today's attendance fetch with lean
    const attendance = await Attendance.find(filter)
      .select("-__v")
      .populate({ path: "user", select: "name email role" })
      .sort({ createdAt: -1 })
      .limit(MAX_LIMIT)
      .lean()
      .exec();

    return res.status(200).json({
      success: true,
      date: today,
      count: attendance.length,
      attendance,
    });
  } catch (error) {
    return next(error);
  }
};