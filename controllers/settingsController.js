import WorkspaceSettings from "../models/WorkspaceSettings.js";

const QUERY_TIMEOUT_MS = 10000;

const DEFAULT_SETTINGS = {
  workspaceName: "",
  timezone: "Asia/Karachi",
  dateFormat: "DD/MM/YYYY",
  workStart: "09:00",
  workEnd: "17:00",
  lateGracePeriod: 10,
  emailNotifications: true,
  attendanceReminders: true,
  securityAlerts: true,
  requireStrongPasswords: true,
  attendanceGpsEnabled: false,
  officeLatitude: null,
  officeLongitude: null,
  attendanceRadiusMeters: 200,
};

const ALLOWED_FIELDS = Object.keys(DEFAULT_SETTINGS);

const BOOLEAN_FIELDS = [
  "emailNotifications",
  "attendanceReminders",
  "securityAlerts",
  "requireStrongPasswords",
  "attendanceGpsEnabled",
];

const isValidTime = (value) =>
  typeof value === "string" &&
  /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);

const isValidCoordinate = (value, min, max) => {
  if (value === null || value === "") return true;

  if (
    typeof value !== "number" &&
    typeof value !== "string"
  ) {
    return false;
  }

  if (typeof value === "string" && value.trim() === "") {
    return false;
  }

  const number = Number(value);

  return Number.isFinite(number) && number >= min && number <= max;
};

const serializeSettings = (settings) => {
  const plainSettings = settings?.toObject
    ? settings.toObject()
    : settings;

  return {
    ...DEFAULT_SETTINGS,
    ...(plainSettings || {}),
  };
};

const getOrCreateSettings = async (userId) => {
  let settings = await WorkspaceSettings.findOne()
    .maxTimeMS(QUERY_TIMEOUT_MS)
    .exec();

  if (settings) return settings;

  try {
    settings = await WorkspaceSettings.create({
      ...DEFAULT_SETTINGS,
      updatedBy: userId,
    });

    return settings;
  } catch (error) {
    // Another request may have created the settings simultaneously.
    if (error.code === 11000) {
      const existing = await WorkspaceSettings.findOne()
        .maxTimeMS(QUERY_TIMEOUT_MS)
        .exec();

      if (existing) return existing;
    }

    throw error;
  }
};

export const getSettings = async (req, res, next) => {
  try {
    const settings = await getOrCreateSettings(req.user._id);

    return res.status(200).json({
      success: true,
      data: serializeSettings(settings),
    });
  } catch (error) {
    return next(error);
  }
};

export const updateSettings = async (req, res, next) => {
  try {
    if (
      !req.body ||
      typeof req.body !== "object" ||
      Array.isArray(req.body)
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide valid settings.",
      });
    }

    const updates = {};

    for (const field of ALLOWED_FIELDS) {
      if (req.body[field] === undefined) continue;

      const value = req.body[field];

      if (BOOLEAN_FIELDS.includes(field)) {
        if (typeof value !== "boolean") {
          return res.status(400).json({
            success: false,
            message: `${field} must be true or false.`,
          });
        }

        updates[field] = value;
        continue;
      }

      if (field === "lateGracePeriod") {
        if (
          value === "" ||
          value === null ||
          (typeof value !== "number" && typeof value !== "string")
        ) {
          return res.status(400).json({
            success: false,
            message: "Late grace period must be between 0 and 180 minutes.",
          });
        }

        const number = Number(value);

        if (!Number.isInteger(number) || number < 0 || number > 180) {
          return res.status(400).json({
            success: false,
            message: "Late grace period must be between 0 and 180 minutes.",
          });
        }

        updates[field] = number;
        continue;
      }

      if (field === "attendanceRadiusMeters") {
        if (
          value === "" ||
          value === null ||
          (typeof value !== "number" && typeof value !== "string")
        ) {
          return res.status(400).json({
            success: false,
            message: "Attendance radius must be between 10 and 10000 meters.",
          });
        }

        const number = Number(value);

        if (!Number.isFinite(number) || number < 10 || number > 10000) {
          return res.status(400).json({
            success: false,
            message: "Attendance radius must be between 10 and 10000 meters.",
          });
        }

        updates[field] = number;
        continue;
      }

      if (field === "officeLatitude" || field === "officeLongitude") {
        const isLatitude = field === "officeLatitude";
        const min = isLatitude ? -90 : -180;
        const max = isLatitude ? 90 : 180;

        if (!isValidCoordinate(value, min, max)) {
          return res.status(400).json({
            success: false,
            message: `${field} is outside the valid coordinate range.`,
          });
        }

        updates[field] =
          value === null || value === "" ? null : Number(value);

        continue;
      }

      if (field === "workStart" || field === "workEnd") {
        if (!isValidTime(value)) {
          return res.status(400).json({
            success: false,
            message: `${field} must be a valid 24-hour time.`,
          });
        }

        updates[field] = value;
        continue;
      }

      if (field === "workspaceName") {
        if (typeof value !== "string" || value.trim().length > 150) {
          return res.status(400).json({
            success: false,
            message: "Workspace name must be text with at most 150 characters.",
          });
        }

        updates[field] = value.trim();
        continue;
      }

      if (field === "timezone") {
        const allowed = [
          "Asia/Karachi",
          "Asia/Dubai",
          "Asia/Kolkata",
          "Europe/London",
          "America/New_York",
          "UTC",
        ];

        if (!allowed.includes(value)) {
          return res.status(400).json({
            success: false,
            message: "Invalid timezone.",
          });
        }

        updates[field] = value;
        continue;
      }

      if (field === "dateFormat") {
        const allowed = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"];

        if (!allowed.includes(value)) {
          return res.status(400).json({
            success: false,
            message: "Invalid date format.",
          });
        }

        updates[field] = value;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one valid setting.",
      });
    }

    const currentSettings = await WorkspaceSettings.findOne()
      .select(
        "attendanceGpsEnabled officeLatitude officeLongitude"
      )
      .maxTimeMS(QUERY_TIMEOUT_MS)
      .lean()
      .exec();

    const finalGpsEnabled =
      updates.attendanceGpsEnabled ??
      currentSettings?.attendanceGpsEnabled ??
      DEFAULT_SETTINGS.attendanceGpsEnabled;

    const finalLatitude =
      updates.officeLatitude !== undefined
        ? updates.officeLatitude
        : currentSettings?.officeLatitude ?? DEFAULT_SETTINGS.officeLatitude;

    const finalLongitude =
      updates.officeLongitude !== undefined
        ? updates.officeLongitude
        : currentSettings?.officeLongitude ?? DEFAULT_SETTINGS.officeLongitude;

    if (
      finalGpsEnabled &&
      (finalLatitude === null ||
        finalLongitude === null ||
        finalLatitude === undefined ||
        finalLongitude === undefined)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Set both office latitude and longitude before enabling attendance GPS.",
      });
    }

    updates.updatedBy = req.user._id;

    const settings = await WorkspaceSettings.findOneAndUpdate(
      {},
      { $set: updates },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
        maxTimeMS: QUERY_TIMEOUT_MS,
      }
    ).exec();

    return res.status(200).json({
      success: true,
      message: "Settings saved successfully.",
      data: serializeSettings(settings),
    });
  } catch (error) {
    return next(error);
  }
};