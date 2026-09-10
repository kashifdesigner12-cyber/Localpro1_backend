const mongoose = require("mongoose");

const User = require("../models/User");
const Attendance = require("../models/Attendance");
const Notification = require("../models/Notification");
const { sendWelcomeEmail } = require("../utils/sendEmail");

const VALID_ROLES = ["admin", "manager", "user"];
const VALID_STATUSES = ["Active", "Pending", "Blocked", "Inactive"];
const PAK_TIMEZONE = "Asia/Karachi";

// =====================================================
// HELPERS
// =====================================================

const normalizeUserId = (value) => {
  if (!value) return null;

  if (value instanceof mongoose.Types.ObjectId) {
    return value.toString();
  }

  if (typeof value === "object") {
    if (value._id) {
      return normalizeUserId(value._id);
    }

    if (value.id) {
      return normalizeUserId(value.id);
    }

    if (value.userId) {
      return normalizeUserId(value.userId);
    }

    return null;
  }

  if (typeof value === "string") {
    const id = value.trim();

    if (!id) {
      return null;
    }

    return id;
  }

  return null;
};

const isValidObjectId = (id) => {
  const normalizedId = normalizeUserId(id);

  if (!normalizedId) {
    return false;
  }

  return mongoose.Types.ObjectId.isValid(normalizedId);
};

const getObjectId = (id) => {
  const normalizedId = normalizeUserId(id);

  if (!normalizedId) {
    return null;
  }

  if (!mongoose.Types.ObjectId.isValid(normalizedId)) {
    return null;
  }

  return new mongoose.Types.ObjectId(normalizedId);
};

const getAuthenticatedUserId = (req) => {
  if (!req || !req.user) {
    return null;
  }

  return normalizeUserId(
    req.user._id ||
      req.user.id ||
      req.user.userId
  );
};

const sameUserId = (a, b) => {
  const first = normalizeUserId(a);
  const second = normalizeUserId(b);

  if (!first || !second) {
    return false;
  }

  return first === second;
};

// =====================================================
// DATE & SCHEDULE SYNC HELPERS
// =====================================================

const getPKTDateString = (date = new Date()) => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PAK_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

const getDayRange = (date = new Date()) => {
  const pktDateString = getPKTDateString(date);
  const start = new Date(`${pktDateString}T00:00:00+05:00`);
  const end = new Date(`${pktDateString}T23:59:59.999+05:00`);
  return { start, end };
};

const createScheduledDate = (date, time) => {
  if (!time || !/^\d{1,2}:\d{2}$/.test(String(time).trim())) {
    return null;
  }
  const pktDateString = getPKTDateString(date);
  const timeFormatted = String(time).trim().padStart(5, "0");
  const scheduled = new Date(`${pktDateString}T${timeFormatted}:00+05:00`);
  if (Number.isNaN(scheduled.getTime())) {
    return null;
  }
  return scheduled;
};

const syncTodayAttendanceSchedule = async (user, schedule) => {
  if (!user || !schedule || typeof schedule !== "object") return;
  try {
    const now = new Date();
    const { start, end } = getDayRange(now);

    const startTime = schedule.startTime || user.attendanceSettings?.attendanceTime || "09:00";
    const windowStartStr = schedule.windowStart || "08:45";
    const windowEndStr = schedule.windowEnd || "09:30";

    const schedTimeObj = createScheduledDate(now, startTime);
    const winStartObj = createScheduledDate(now, windowStartStr);
    const winEndObj = createScheduledDate(now, windowEndStr);

    const existingAttendance = await Attendance.findOne({
      user: user._id,
      date: { $gte: start, $lte: end },
    });

    if (existingAttendance) {
      if (existingAttendance.status !== "Present" && !existingAttendance.checkIn) {
        existingAttendance.scheduledTime = schedTimeObj;
        existingAttendance.windowStart = winStartObj;
        existingAttendance.windowEnd = winEndObj;
        existingAttendance.status = "Pending";
        existingAttendance.markedAt = null;
        await existingAttendance.save();
      }
    } else if (user.role === "user" && user.status === "Active") {
      await Attendance.create({
        user: user._id,
        date: new Date(`${getPKTDateString(now)}T00:00:00+05:00`),
        scheduledTime: schedTimeObj,
        windowStart: winStartObj,
        windowEnd: winEndObj,
        status: "Pending",
        checkIn: null,
        checkOut: null,
        notes: "",
      });
    }
  } catch (syncErr) {
    console.error("Attendance live sync error:", syncErr);
  }
};

// =====================================================
// SAFE USER
// =====================================================

const safeUser = (user) => {
  if (!user) {
    return null;
  }

  const userId = normalizeUserId(
    user._id || user.id
  );

  // Prevent payload bloating from massive base64 image strings
  let cleanAvatar = user.avatar || null;
  if (typeof cleanAvatar === "string" && cleanAvatar.startsWith("data:image") && cleanAvatar.length > 1000) {
    cleanAvatar = null;
  }

  return {
    id: userId,
    _id: userId,

    name: user.name || "",
    email: user.email || "",
    phone: user.phone || "",

    role: user.role || "user",
    status: user.status || "Active",
    isActive: user.isActive !== undefined ? user.isActive : true,

    avatar: cleanAvatar,

    twilioPhoneNumber:
      user.twilioPhoneNumber || "",

    business:
      user.business || {},

    preferences:
      user.preferences || {},

    attendanceSettings:
      user.attendanceSettings || {},

    attendanceSchedule:
      user.attendanceSchedule ||
      user?.preferences?.attendanceSchedule ||
      user.workSchedule ||
      null,

    workSchedule:
      user.workSchedule ||
      user?.preferences?.workSchedule ||
      user.attendanceSchedule ||
      null,

    notificationPreferences:
      user.notificationPreferences || {},

    integrations:
      user.integrations || {},

    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

// =====================================================
// VALIDATION
// =====================================================

const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const normalizeRole = (role) => {
  if (typeof role !== "string") {
    return "";
  }

  return role.trim().toLowerCase();
};

const normalizeStatus = (status) => {
  if (typeof status !== "string") {
    return "";
  }

  const normalized = status.trim().toLowerCase();

  const statusMap = {
    active: "Active",
    pending: "Pending",
    blocked: "Blocked",
    inactive: "Inactive",
  };

  return statusMap[normalized] || "";
};

const parseSort = (
  sortParam,
  defaultSort = { createdAt: -1 }
) => {
  if (!sortParam || typeof sortParam !== "string") {
    return defaultSort;
  }

  const sort = sortParam.trim();

  const predefinedSorts = {
    newest: { createdAt: -1 },
    "-createdAt": { createdAt: -1 },

    oldest: { createdAt: 1 },
    createdAt: { createdAt: 1 },

    name: { name: 1 },
    asc: { name: 1 },
    "-name": { name: -1 },
    desc: { name: -1 },

    email: { email: 1 },
    "-email": { email: -1 },

    role: { role: 1 },
    "-role": { role: -1 },

    status: { status: 1 },
    "-status": { status: -1 },
  };

  if (predefinedSorts[sort]) {
    return predefinedSorts[sort];
  }

  const allowedSortFields = [
    "createdAt",
    "name",
    "email",
    "role",
    "status",
  ];

  const descending = sort.startsWith("-");

  const field = descending
    ? sort.substring(1)
    : sort;

  if (!allowedSortFields.includes(field)) {
    return defaultSort;
  }

  return {
    [field]: descending ? -1 : 1,
  };
};

// =====================================================
// GET ALL USERS
// GET /api/users
// =====================================================

const getUsers = async (req, res) => {
  try {
    const {
      search,
      role,
      status,
      page = 1,
      limit = 20,
      sort = "-createdAt",
    } = req.query;

    const filter = {};

    // SEARCH
    if (search && search.trim()) {
      const searchValue = search.trim();

      const escapedSearch = searchValue.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

      const regex = new RegExp(
        escapedSearch,
        "i"
      );

      filter.$or = [
        { name: regex },
        { email: regex },
        { phone: regex },
      ];
    }

    // ROLE
    if (role) {
      const normalizedRole =
        normalizeRole(role);

      if (!VALID_ROLES.includes(normalizedRole)) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid role filter. Allowed: ${VALID_ROLES.join(", ")}.`,
        });
      }

      filter.role = normalizedRole;
    }

    // STATUS
    if (status) {
      const normalizedStatus =
        normalizeStatus(status);

      if (!VALID_STATUSES.includes(normalizedStatus)) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid status filter. Allowed: ${VALID_STATUSES.join(", ")}.`,
        });
      }

      filter.status = normalizedStatus;
    }

    // PAGINATION
    const pageNum = Math.max(
      parseInt(page, 10) || 1,
      1
    );

    const limitNum = Math.min(
      Math.max(
        parseInt(limit, 10) || 20,
        1
      ),
      100
    );

    const skip =
      (pageNum - 1) * limitNum;

    const sortOption = parseSort(sort);

    // Parallel execution with .lean() to prevent memory lag
    const [users, total] =
      await Promise.all([
        User.find(filter)
          .select("-password")
          .skip(skip)
          .limit(limitNum)
          .sort(sortOption)
          .lean(),

        User.countDocuments(filter),
      ]);

    const safeUsersList =
      users.map(safeUser);

    return res.status(200).json({
      success: true,

      users: safeUsersList,
      data: safeUsersList,

      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages:
          Math.ceil(total / limitNum) || 0,
      },
    });
  } catch (error) {
    console.error(
      "getUsers error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error retrieving users.",
    });
  }
};

// =====================================================
// GET USER STATS
// GET /api/users/stats
// =====================================================

const getUserStats = async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      pendingUsers,
      blockedUsers,
      inactiveUsers,
      byRole,
    ] = await Promise.all([
      User.countDocuments(),

      User.countDocuments({
        status: "Active",
      }),

      User.countDocuments({
        status: "Pending",
      }),

      User.countDocuments({
        status: "Blocked",
      }),

      User.countDocuments({
        status: "Inactive",
      }),

      User.aggregate([
        {
          $group: {
            _id: "$role",
            count: {
              $sum: 1,
            },
          },
        },
      ]),
    ]);

    const stats = {
      total: totalUsers,
      active: activeUsers,
      pending: pendingUsers,
      blocked: blockedUsers,
      inactive: inactiveUsers,
      byRole,
    };

    return res.status(200).json({
      success: true,
      stats,
      data: stats,
    });
  } catch (error) {
    console.error(
      "getUserStats error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error retrieving user stats.",
    });
  }
};

// =====================================================
// GET USER BY ID
// GET /api/users/:id
// =====================================================

const getUserById = async (req, res) => {
  try {
    const userId = normalizeUserId(
      req.params.id
    );

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required.",
      });
    }

    if (!isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
        receivedId: userId,
      });
    }

    const user =
      await User.findById(
        getObjectId(userId)
      )
        .select("-password")
        .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const safeUserData =
      safeUser(user);

    return res.status(200).json({
      success: true,
      user: safeUserData,
      data: safeUserData,
    });
  } catch (error) {
    console.error(
      "getUserById error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error retrieving user.",
    });
  }
};

// =====================================================
// CREATE USER
// POST /api/users
// =====================================================

const createUser = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication required.",
      });
    }

    const {
      name,
      email,
      phone,
      password,
      role,
      status,
      business,
      preferences,
      attendanceSchedule,
      workSchedule,
      attendanceSettings,
    } = req.body;

    if (
      !name ||
      typeof name !== "string" ||
      !name.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Name is required.",
      });
    }

    if (
      !email ||
      typeof email !== "string" ||
      !email.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const normalizedEmail =
      email.trim().toLowerCase();

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide a valid email.",
      });
    }

    if (
      !password ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Password is required.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "Password must be at least 6 characters.",
      });
    }

    const normalizedRole =
      normalizeRole(role);

    if (!VALID_ROLES.includes(normalizedRole)) {
      return res.status(400).json({
        success: false,
        message:
          `Role must be ${VALID_ROLES.join(", ")}.`,
      });
    }

    let normalizedStatus =
      normalizeStatus(status);

    if (!normalizedStatus) {
      normalizedStatus = "Active";
    }

    if (
      req.user.role === "manager" &&
      (
        normalizedRole === "admin" ||
        normalizedRole === "manager"
      )
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Managers can only create standard user accounts.",
      });
    }

    const existingUser =
      await User.findOne({
        email: normalizedEmail,
      }).select("_id").lean();

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message:
          "Email already in use.",
      });
    }

    const finalPreferences = {
      ...(preferences && typeof preferences === "object" ? preferences : {}),
      ...(attendanceSchedule ? { attendanceSchedule } : {}),
      ...(workSchedule ? { workSchedule } : {}),
    };

    const user = await User.create({
      name: name.trim(),

      email: normalizedEmail,

      phone:
        typeof phone === "string"
          ? phone.trim()
          : "",

      password,

      role: normalizedRole,

      status: normalizedStatus,

      business:
        business &&
        typeof business === "object"
          ? business
          : {},

      preferences: finalPreferences,

      attendanceSchedule:
        attendanceSchedule ||
        preferences?.attendanceSchedule ||
        undefined,

      workSchedule:
        workSchedule ||
        preferences?.workSchedule ||
        undefined,

      attendanceSettings:
        attendanceSettings && typeof attendanceSettings === "object"
          ? attendanceSettings
          : undefined,
    });

    try {
      await sendWelcomeEmail(user.email, user.name, password);
    } catch (emailErr) {
      console.error("Failed to send welcome email to new user:", emailErr.message);
    }

    const safeUserData =
      safeUser(user);

    return res.status(201).json({
      success: true,
      message:
        "User created successfully and welcome email sent.",
      user: safeUserData,
      data: safeUserData,
    });
  } catch (error) {
    console.error(
      "createUser error:",
      error
    );

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message:
          "Email already in use.",
      });
    }

    if (
      error.name === "ValidationError"
    ) {
      const messages =
        Object.values(
          error.errors || {}
        ).map(
          (err) => err.message
        );

      return res.status(400).json({
        success: false,
        message:
          messages.length > 0
            ? messages.join(" ")
            : "User validation failed.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Server error creating user.",
    });
  }
};

// =====================================================
// UPDATE USER
// PUT /api/users/:id
// PATCH /api/users/:id
// =====================================================

const updateUser = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication required.",
      });
    }

    const userId = normalizeUserId(
      req.params.id
    );

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required.",
      });
    }

    if (!isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
        receivedId: userId,
      });
    }

    const user =
      await User.findById(
        getObjectId(userId)
      );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const authenticatedUserId =
      getAuthenticatedUserId(req);

    const isSelf = sameUserId(
      user._id,
      authenticatedUserId
    );

    const isAdmin =
      req.user.role === "admin";

    const isManager =
      req.user.role === "manager";

    if (
      !isAdmin &&
      !isManager &&
      !isSelf
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. You can only update your own account.",
      });
    }

    if (
      !isAdmin &&
      !isManager &&
      isSelf
    ) {
      if (
        req.body.role !== undefined
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Access denied. You cannot change your own role.",
        });
      }

      if (
        req.body.status !== undefined
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Access denied. You cannot change your own status.",
        });
      }

      if (
        req.body.email !== undefined
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Access denied. You cannot change your own email.",
        });
      }
    }

    if (
      isManager &&
      (
        user.role === "admin" ||
        (
          user.role === "manager" &&
          !isSelf
        )
      )
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Managers can only update standard user accounts.",
      });
    }

    if (
      isManager &&
      isSelf &&
      req.body.role !== undefined
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Managers cannot change their own role.",
      });
    }

    const {
      name,
      email,
      phone,
      role,
      status,
      avatar,
      business,
      preferences,
      attendanceSchedule,
      workSchedule,
      attendanceSettings,
      notificationPreferences,
      integrations,
      twilioPhoneNumber,
    } = req.body;

    // EMAIL
    if (email !== undefined) {
      if (!isAdmin && !isSelf) {
        return res.status(403).json({
          success: false,
          message:
            "Access denied to update email.",
        });
      }

      if (
        !email ||
        typeof email !== "string" ||
        !email.trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Email cannot be empty.",
        });
      }

      const normalizedEmail =
        email.trim().toLowerCase();

      if (!isValidEmail(normalizedEmail)) {
        return res.status(400).json({
          success: false,
          message:
            "Please provide a valid email.",
        });
      }

      if (
        normalizedEmail !== user.email
      ) {
        const existingUser =
          await User.findOne({
            email: normalizedEmail,
            _id: {
              $ne: user._id,
            },
          }).select("_id").lean();

        if (existingUser) {
          return res.status(400).json({
            success: false,
            message:
              "Email already in use.",
          });
        }

        user.email =
          normalizedEmail;
      }
    }

    // ROLE
    if (
      role !== undefined &&
      (isAdmin || isManager)
    ) {
      const normalizedRole =
        normalizeRole(role);

      if (
        !VALID_ROLES.includes(
          normalizedRole
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid role. Allowed: ${VALID_ROLES.join(", ")}.`,
        });
      }

      if (
        isManager &&
        (
          normalizedRole === "admin" ||
          normalizedRole === "manager"
        )
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Managers cannot assign admin or manager roles.",
        });
      }

      if (
        isSelf &&
        isAdmin &&
        normalizedRole !== "admin"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "You cannot remove admin privileges from your own account.",
        });
      }

      user.role =
        normalizedRole;
    }

    // STATUS
    if (
      status !== undefined &&
      (isAdmin || isManager)
    ) {
      const normalizedStatus =
        normalizeStatus(status);

      if (
        !VALID_STATUSES.includes(
          normalizedStatus
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid status. Allowed: ${VALID_STATUSES.join(", ")}.`,
        });
      }

      if (
        isSelf &&
        (
          normalizedStatus === "Blocked" ||
          normalizedStatus === "Inactive"
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "You cannot block or deactivate your own account.",
        });
      }

      user.status =
        normalizedStatus;
    }

    // NAME
    if (name !== undefined) {
      if (
        !name ||
        typeof name !== "string" ||
        !name.trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Name cannot be empty.",
        });
      }

      user.name =
        name.trim();
    }

    // PHONE
    if (phone !== undefined) {
      user.phone =
        typeof phone === "string"
          ? phone.trim()
          : "";
    }

    // AVATAR
    if (avatar !== undefined) {
      user.avatar =
        avatar || null;
    }

    // TWILIO
    if (
      twilioPhoneNumber !== undefined &&
      (isAdmin || isManager)
    ) {
      user.twilioPhoneNumber =
        typeof twilioPhoneNumber ===
        "string"
          ? twilioPhoneNumber.trim()
          : "";
    }

    // BUSINESS
    if (
      business !== undefined &&
      business !== null &&
      typeof business === "object"
    ) {
      user.business = {
        ...(user.business || {}),
        ...business,
      };
    }

    let targetSchedulePayload = null;

    // PREFERENCES
    if (
      preferences !== undefined &&
      preferences !== null &&
      typeof preferences === "object"
    ) {
      user.preferences = {
        ...(user.preferences || {}),
        ...preferences,
      };

      if (preferences.attendanceSchedule) {
        user.attendanceSchedule = preferences.attendanceSchedule;
        targetSchedulePayload = preferences.attendanceSchedule;
      }
      if (preferences.workSchedule) {
        user.workSchedule = preferences.workSchedule;
        if (!targetSchedulePayload) {
          targetSchedulePayload = preferences.workSchedule;
        }
      }
    }

    if (attendanceSchedule !== undefined) {
      user.attendanceSchedule = attendanceSchedule;
      user.preferences = {
        ...(user.preferences || {}),
        attendanceSchedule,
      };
      targetSchedulePayload = attendanceSchedule;
    }

    if (workSchedule !== undefined) {
      user.workSchedule = workSchedule;
      user.preferences = {
        ...(user.preferences || {}),
        workSchedule,
      };
      if (!targetSchedulePayload) {
        targetSchedulePayload = workSchedule;
      }
    }

    if (
      attendanceSettings !== undefined &&
      attendanceSettings !== null &&
      typeof attendanceSettings === "object"
    ) {
      user.attendanceSettings = {
        ...(user.attendanceSettings || {}),
        ...attendanceSettings,
      };
    }

    user.markModified("preferences");
    user.markModified("attendanceSchedule");
    user.markModified("workSchedule");
    user.markModified("attendanceSettings");
    user.markModified("business");

    if (
      notificationPreferences !==
        undefined &&
      notificationPreferences !==
        null &&
      typeof notificationPreferences ===
        "object"
    ) {
      user.notificationPreferences = {
        ...(user.notificationPreferences ||
          {}),
        ...notificationPreferences,
      };
    }

    if (
      integrations !== undefined &&
      integrations !== null &&
      typeof integrations === "object"
    ) {
      user.integrations = {
        ...(user.integrations || {}),
        ...integrations,
      };
    }

    await user.save();

    if (targetSchedulePayload) {
      await syncTodayAttendanceSchedule(user, targetSchedulePayload);
    }

    const safeUserData =
      safeUser(user);

    return res.status(200).json({
      success: true,
      message:
        "User updated successfully.",
      user: safeUserData,
      data: safeUserData,
    });
  } catch (error) {
    console.error(
      "updateUser error:",
      error
    );

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message:
          "Email already in use.",
      });
    }

    if (
      error.name === "ValidationError"
    ) {
      const messages =
        Object.values(
          error.errors || {}
        ).map(
          (err) => err.message
        );

      return res.status(400).json({
        success: false,
        message:
          messages.length > 0
            ? messages.join(" ")
            : "User validation failed.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Server error updating user.",
    });
  }
};

// =====================================================
// UPDATE USER STATUS
// PUT /api/users/:id/status
// PATCH /api/users/:id/status
// =====================================================

const updateUserStatus = async (
  req,
  res
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication required.",
      });
    }

    if (
      req.user.role !== "admin" &&
      req.user.role !== "manager"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Only admins and managers can update user status.",
      });
    }

    const userId =
      normalizeUserId(
        req.params.id
      );

    const { status } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required.",
      });
    }

    if (!isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
        receivedId: userId,
      });
    }

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required.",
      });
    }

    const normalizedStatus =
      normalizeStatus(status);

    if (
      !VALID_STATUSES.includes(
        normalizedStatus
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          `Invalid status. Allowed: ${VALID_STATUSES.join(", ")}.`,
      });
    }

    const user =
      await User.findById(
        getObjectId(userId)
      );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const authenticatedUserId =
      getAuthenticatedUserId(req);

    if (
      sameUserId(
        user._id,
        authenticatedUserId
      ) &&
      (
        normalizedStatus === "Blocked" ||
        normalizedStatus === "Inactive"
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "You cannot block or deactivate your own account.",
      });
    }

    if (
      req.user.role === "manager" &&
      (
        user.role === "admin" ||
        user.role === "manager"
      )
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Managers can only change status for standard users.",
      });
    }

    user.status =
      normalizedStatus;

    await user.save();

    const safeUserData =
      safeUser(user);

    return res.status(200).json({
      success: true,
      message:
        "User status updated successfully.",
      user: safeUserData,
      data: safeUserData,
    });
  } catch (error) {
    console.error(
      "updateUserStatus error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error updating user status.",
    });
  }
};

// =====================================================
// UPDATE USER ROLE
// PUT /api/users/:id/role
// PATCH /api/users/:id/role
// =====================================================

const updateUserRole = async (
  req,
  res
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication required.",
      });
    }

    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message:
          "Only admins can update user roles.",
      });
    }

    const userId =
      normalizeUserId(
        req.params.id
      );

    const { role } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required.",
      });
    }

    if (!isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
        receivedId: userId,
      });
    }

    if (!role) {
      return res.status(400).json({
        success: false,
        message: "Role is required.",
      });
    }

    const normalizedRole =
      normalizeRole(role);

    if (
      !VALID_ROLES.includes(
        normalizedRole
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          `Invalid role. Allowed: ${VALID_ROLES.join(", ")}.`,
      });
    }

    const user =
      await User.findById(
        getObjectId(userId)
      );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const authenticatedUserId =
      getAuthenticatedUserId(req);

    if (
      sameUserId(
        user._id,
        authenticatedUserId
      ) &&
      normalizedRole !== "admin"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "You cannot remove admin privileges from your own account.",
      });
    }

    user.role =
      normalizedRole;

    await user.save();

    const safeUserData =
      safeUser(user);

    return res.status(200).json({
      success: true,
      message:
        "User role updated successfully.",
      user: safeUserData,
      data: safeUserData,
    });
  } catch (error) {
    console.error(
      "updateUserRole error:",
      error
    );

    if (
      error.name === "ValidationError"
    ) {
      const messages =
        Object.values(
          error.errors || {}
        ).map(
          (err) => err.message
        );

      return res.status(400).json({
        success: false,
        message:
          messages.length > 0
            ? messages.join(" ")
            : "User validation failed.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Server error updating user role.",
    });
  }
};

// =====================================================
// DELETE USER
// DELETE /api/users/:id
// =====================================================

const deleteUser = async (
  req,
  res
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication required.",
      });
    }

    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message:
          "Only admins can delete users.",
      });
    }

    const userId =
      normalizeUserId(
        req.params.id
      );

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required.",
      });
    }

    if (!isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
        receivedId: userId,
      });
    }

    const authenticatedUserId =
      getAuthenticatedUserId(req);

    if (
      sameUserId(
        userId,
        authenticatedUserId
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "You cannot delete your own account.",
      });
    }

    const user =
      await User.findById(
        getObjectId(userId)
      ).select("_id").lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // Parallel clean up
    try {
      await Promise.all([
        Attendance.deleteMany({ user: user._id }),
        Notification.deleteMany({ user: user._id }),
        User.findByIdAndDelete(getObjectId(userId)),
      ]);
    } catch (cleanupError) {
      console.error(
        "Cleanup error:",
        cleanupError
      );
      await User.findByIdAndDelete(getObjectId(userId));
    }

    return res.status(200).json({
      success: true,
      message:
        "User deleted successfully.",
    });
  } catch (error) {
    console.error(
      "deleteUser error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error deleting user.",
    });
  }
};

// =====================================================
// GET PROFILE
// GET /api/users/profile
// =====================================================

const getProfile = async (
  req,
  res
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication required.",
      });
    }

    const authenticatedUserId = getAuthenticatedUserId(req);
    const user = await User.findById(getObjectId(authenticatedUserId))
      .select("-password")
      .lean();

    const safeUserData =
      safeUser(user || req.user);

    return res.status(200).json({
      success: true,
      user: safeUserData,
      data: safeUserData,
    });
  } catch (error) {
    console.error(
      "getProfile error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error retrieving profile.",
    });
  }
};

// =====================================================
// UPDATE PROFILE
// PUT /api/users/profile
// PATCH /api/users/profile
// =====================================================

const updateProfile = async (
  req,
  res
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication required.",
      });
    }

    const {
      name,
      phone,
      avatar,
      business,
      preferences,
      attendanceSchedule,
      workSchedule,
      attendanceSettings,
      notificationPreferences,
    } = req.body;

    const authenticatedUserId =
      getAuthenticatedUserId(req);

    if (
      !authenticatedUserId ||
      !isValidObjectId(
        authenticatedUserId
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid authenticated user ID.",
      });
    }

    const user =
      await User.findById(
        getObjectId(
          authenticatedUserId
        )
      );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (name !== undefined) {
      if (
        !name ||
        typeof name !== "string" ||
        !name.trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Name cannot be empty.",
        });
      }

      user.name =
        name.trim();
    }

    if (phone !== undefined) {
      user.phone =
        typeof phone === "string"
          ? phone.trim()
          : "";
    }

    if (avatar !== undefined) {
      user.avatar =
        avatar || null;
    }

    if (
      business !== undefined &&
      business !== null &&
      typeof business === "object"
    ) {
      user.business = {
        ...(user.business || {}),
        ...business,
      };
    }

    let targetSchedulePayload = null;

    if (
      preferences !== undefined &&
      preferences !== null &&
      typeof preferences === "object"
    ) {
      user.preferences = {
        ...(user.preferences || {}),
        ...preferences,
      };

      if (preferences.attendanceSchedule) {
        user.attendanceSchedule = preferences.attendanceSchedule;
        targetSchedulePayload = preferences.attendanceSchedule;
      }
      if (preferences.workSchedule) {
        user.workSchedule = preferences.workSchedule;
        if (!targetSchedulePayload) {
          targetSchedulePayload = preferences.workSchedule;
        }
      }
    }

    if (attendanceSchedule !== undefined) {
      user.attendanceSchedule = attendanceSchedule;
      user.preferences = {
        ...(user.preferences || {}),
        attendanceSchedule,
      };
      targetSchedulePayload = attendanceSchedule;
    }

    if (workSchedule !== undefined) {
      user.workSchedule = workSchedule;
      user.preferences = {
        ...(user.preferences || {}),
        workSchedule,
      };
      if (!targetSchedulePayload) {
        targetSchedulePayload = workSchedule;
      }
    }

    if (
      attendanceSettings !== undefined &&
      attendanceSettings !== null &&
      typeof attendanceSettings === "object"
    ) {
      user.attendanceSettings = {
        ...(user.attendanceSettings || {}),
        ...attendanceSettings,
      };
    }

    user.markModified("preferences");
    user.markModified("attendanceSchedule");
    user.markModified("workSchedule");
    user.markModified("attendanceSettings");
    user.markModified("business");

    if (
      notificationPreferences !==
        undefined &&
      notificationPreferences !==
        null &&
      typeof notificationPreferences ===
        "object"
    ) {
      user.notificationPreferences = {
        ...(user.notificationPreferences ||
          {}),
        ...notificationPreferences,
      };
    }

    await user.save();

    if (targetSchedulePayload) {
      await syncTodayAttendanceSchedule(user, targetSchedulePayload);
    }

    const safeUserData =
      safeUser(user);

    return res.status(200).json({
      success: true,
      message:
        "Profile updated successfully.",
      user: safeUserData,
      data: safeUserData,
    });
  } catch (error) {
    console.error(
      "updateProfile error:",
      error
    );

    if (
      error.name === "ValidationError"
    ) {
      const messages =
        Object.values(
          error.errors || {}
        ).map(
          (err) => err.message
        );

      return res.status(400).json({
        success: false,
        message:
          messages.length > 0
            ? messages.join(" ")
            : "Profile validation failed.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Server error updating profile.",
    });
  }
};

// =====================================================
// CHANGE PASSWORD
// =====================================================

const changePassword = async (
  req,
  res
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication required.",
      });
    }

    const {
      currentPassword,
      oldPassword,
      newPassword,
      password,
    } = req.body;

    const currentPass =
      currentPassword ||
      oldPassword;

    const newPass =
      newPassword ||
      password;

    if (
      !currentPass ||
      !newPass
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Current password and new password are required.",
      });
    }

    if (
      typeof newPass !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "New password must be a string.",
      });
    }

    if (newPass.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "New password must be at least 6 characters.",
      });
    }

    const authenticatedUserId =
      getAuthenticatedUserId(req);

    if (
      !authenticatedUserId ||
      !isValidObjectId(
        authenticatedUserId
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid authenticated user ID.",
      });
    }

    const user =
      await User.findById(
        getObjectId(
          authenticatedUserId
        )
      ).select("+password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (
      typeof user.comparePassword !==
      "function"
    ) {
      console.error(
        "User model does not have comparePassword method."
      );

      return res.status(500).json({
        success: false,
        message:
          "Password verification is not configured correctly.",
      });
    }

    const isMatch =
      await user.comparePassword(
        currentPass
      );

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message:
          "Current password is incorrect.",
      });
    }

    user.password =
      newPass;

    await user.save();

    return res.status(200).json({
      success: true,
      message:
        "Password updated successfully.",
    });
  } catch (error) {
    console.error(
      "changePassword error:",
      error
    );

    if (
      error.name === "ValidationError"
    ) {
      const messages =
        Object.values(
          error.errors || {}
        ).map(
          (err) => err.message
        );

      return res.status(400).json({
        success: false,
        message:
          messages.length > 0
            ? messages.join(" ")
            : "Password validation failed.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Server error updating password.",
    });
  }
};

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
  getUsers,
  getUserStats,
  getUserById,
  createUser,
  updateUser,
  updateUserStatus,
  updateUserRole,
  deleteUser,
  getProfile,
  updateProfile,
  changePassword,

  normalizeUserId,
  isValidObjectId,
  getObjectId,
};