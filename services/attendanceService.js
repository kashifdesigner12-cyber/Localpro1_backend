import mongoose from "mongoose";
import Attendance from "../models/Attendance.js";
import WorkspaceSettings from "../models/WorkspaceSettings.js";
import { createNotification } from "./notificationService.js";

export const getTodayDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const getDistanceInMeters = (lat1, lon1, lat2, lon2) => {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return (
    earthRadiusMeters *
    2 *
    Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  );
};

const verifyAttendanceLocation = async (latitude, longitude) => {
  const officeLatitude = Number(process.env.OFFICE_LATITUDE);
  const officeLongitude = Number(process.env.OFFICE_LONGITUDE);
  const radius = Number(process.env.OFFICE_RADIUS_METERS || 100);

  if (
    !process.env.OFFICE_LATITUDE?.trim() ||
    !process.env.OFFICE_LONGITUDE?.trim() ||
    !Number.isFinite(officeLatitude) ||
    !Number.isFinite(officeLongitude) ||
    officeLatitude < -90 ||
    officeLatitude > 90 ||
    officeLongitude < -180 ||
    officeLongitude > 180
  ) {
    throw new Error(
      "Office GPS location is not configured correctly in .env."
    );
  }

  if (!Number.isFinite(radius) || radius < 10 || radius > 10000) {
    throw new Error(
      "OFFICE_RADIUS_METERS must be between 10 and 10000."
    );
  }

  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error(
      "Location permission is required. Allow location access and try again."
    );
  }

  const distance = getDistanceInMeters(
    latitude,
    longitude,
    officeLatitude,
    officeLongitude
  );

  if (distance > radius) {
    throw new Error(
      `Attendance is allowed only within ${radius} meters of the office. You are approximately ${Math.round(distance)} meters away.`
    );
  }
};

const getTimeInMinutes = (date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value
  );

  return hour * 60 + minute;
};

const getAttendanceStatus = async (checkInTime) => {
  const settings = await WorkspaceSettings.findOne()
    .select("workStart lateGracePeriod")
    .lean();

  const workStart = settings?.workStart || "09:00";
  const gracePeriod = Number(settings?.lateGracePeriod ?? 10);
  const [hours, minutes] = workStart.split(":").map(Number);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    !Number.isFinite(gracePeriod) ||
    gracePeriod < 0
  ) {
    throw new Error("Workspace attendance settings are invalid.");
  }

  const allowedStartMinutes = hours * 60 + minutes + gracePeriod;
  const actualCheckInMinutes = getTimeInMinutes(checkInTime);

  return actualCheckInMinutes > allowedStartMinutes ? "late" : "present";
};

export const checkInUser = async ({
  userId,
  latitude = null,
  longitude = null,
  createdBy = userId,
}) => {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid user ID.");
  }

  await verifyAttendanceLocation(latitude, longitude);

  const date = getTodayDate();
  const checkInTime = new Date();
  const status = await getAttendanceStatus(checkInTime);

  try {
    const attendance = await Attendance.findOneAndUpdate(
      {
        user: userId,
        date,
        checkIn: null,
      },
      {
        $set: {
          checkIn: checkInTime,
          checkInLocation: { latitude, longitude },
          status,
          createdBy,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    ).lean();

    return attendance;
  } catch (error) {
    if (error.code === 11000) {
      const existing = await Attendance.findOne({ user: userId, date })
        .select("_id checkIn checkOut status")
        .lean();

      if (existing?.checkIn) {
        throw new Error("You have already checked in today.");
      }

      throw new Error("Attendance already exists for today.");
    }

    throw error;
  }
};

export const checkOutUser = async ({
  userId,
  latitude = null,
  longitude = null,
}) => {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid user ID.");
  }

  await verifyAttendanceLocation(latitude, longitude);

  const date = getTodayDate();
  const checkOutTime = new Date();

  const attendance = await Attendance.findOneAndUpdate(
    {
      user: userId,
      date,
      checkIn: { $ne: null },
      checkOut: null,
    },
    {
      $set: {
        checkOut: checkOutTime,
        checkOutLocation: { latitude, longitude },
      },
    },
    {
      new: true,
    }
  );

  if (attendance) {
    const hoursWorked =
      (new Date(attendance.checkOut).getTime() - new Date(attendance.checkIn).getTime()) /
      (1000 * 60 * 60);

    if (hoursWorked < 4 && attendance.status !== "leave") {
      attendance.status = "half_day";
      await attendance.save();
    }

    return attendance.toObject ? attendance.toObject() : attendance;
  }

  const existing = await Attendance.findOne({ user: userId, date })
    .select("_id checkIn checkOut")
    .lean();

  if (!existing?.checkIn) {
    throw new Error("You must check in before checking out.");
  }

  if (existing.checkOut) {
    throw new Error("You have already checked out today.");
  }

  throw new Error("Unable to complete checkout. Please try again.");
};

export const getUserAttendance = async ({
  userId,
  startDate,
  endDate,
  limit = 100,
}) => {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid user ID.");
  }

  const filter = { user: userId };

  if (startDate || endDate) {
    filter.date = {};

    if (startDate) filter.date.$gte = startDate;
    if (endDate) filter.date.$lte = endDate;
  }

  const safeLimit = Math.min(
    Math.max(Number.parseInt(limit, 10) || 100, 1),
    200
  );

  return Attendance.find(filter)
    .sort({ date: -1 })
    .limit(safeLimit)
    .lean();
};

export const notifyAttendanceEvent = async ({
  recipient,
  sender = null,
  title,
  message,
}) =>
  createNotification({
    recipient,
    sender,
    title,
    message,
    type: "attendance",
  });