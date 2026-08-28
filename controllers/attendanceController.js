const mongoose = require('mongoose');

const Attendance = require('../models/Attendance');
const User = require('../models/User');
const Notification = require('../models/Notification');

const isValidObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id);

const VALID_STATUSES = [
  'Pending',
  'Present',
  'Absent',
  'Late',
  'Half Day',
  'Leave'
];

const DEFAULT_GRACE_PERIOD = 10;
const PAK_TIMEZONE = 'Asia/Karachi';

// ============================================================
// GPS GEOFENCING / HAVERSINE DISTANCE HELPER
// ============================================================

function calculateDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const toRad = (value) => (Number(value) * Math.PI) / 180;

  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

// ============================================================
// DATE HELPERS
// ============================================================

const getPKTDateString = (date = new Date()) => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PAK_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

const getPKTCurrentMinutes = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PAK_TIMEZONE,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);

  const hours = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minutes = Number(parts.find((p) => p.type === 'minute')?.value || 0);

  return hours * 60 + minutes;
};

const parseTimeToMinutes = (timeStr) => {
  if (!timeStr) return null;
  const match = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h * 60 + m;
};

const getDayRange = (date = new Date()) => {
  const pktDateString = getPKTDateString(date);

  const start = new Date(`${pktDateString}T00:00:00+05:00`);
  const end = new Date(`${pktDateString}T23:59:59.999+05:00`);

  return {
    start,
    end,
    pktDateString
  };
};

const normalizeDate = (date = new Date()) => {
  const pktDateString = getPKTDateString(date);
  return new Date(`${pktDateString}T00:00:00+05:00`);
};

// ============================================================
// TIME HELPERS
// ============================================================

const createScheduledDate = (date, time) => {
  if (!time || !/^\d{1,2}:\d{2}$/.test(String(time).trim())) {
    return null;
  }

  const pktDateString = getPKTDateString(date);
  const timeFormatted = String(time).trim().padStart(5, '0');
  const scheduled = new Date(`${pktDateString}T${timeFormatted}:00+05:00`);

  if (Number.isNaN(scheduled.getTime())) {
    return null;
  }

  return scheduled;
};

// ============================================================
// SAFE SERIALIZER
// ============================================================

const safeAttendance = (attendance) => {
  if (!attendance) {
    return null;
  }

  return {
    id: attendance._id,

    user: attendance.user
      ? typeof attendance.user === 'object' &&
        attendance.user._id
        ? {
            id: attendance.user._id,
            name: attendance.user.name,
            email: attendance.user.email,
            role: attendance.user.role,
            avatar: attendance.user.avatar || null
          }
        : attendance.user
      : null,

    date: attendance.date,

    scheduledTime:
      attendance.scheduledTime || null,

    windowStart:
      attendance.windowStart || null,

    windowEnd:
      attendance.windowEnd || null,

    checkIn:
      attendance.checkIn || null,

    checkOut:
      attendance.checkOut || null,

    status:
      attendance.status || 'Pending',

    notificationId:
      attendance.notificationId || null,

    notificationSentAt:
      attendance.notificationSentAt || null,

    markedAt:
      attendance.markedAt || null,

    notes:
      attendance.notes || '',

    createdAt:
      attendance.createdAt,

    updatedAt:
      attendance.updatedAt
  };
};

// ============================================================
// CREATE TODAY'S ATTENDANCE FOR USER
// ============================================================

const createTodayAttendanceForUser = async (user) => {
  if (!user) {
    return null;
  }

  if (user.role !== 'user') {
    return null;
  }

  if (user.status !== 'Active') {
    return null;
  }

  const schedule =
    user.attendanceSchedule ||
    user.preferences?.attendanceSchedule ||
    user.workSchedule ||
    user.preferences?.workSchedule ||
    null;

  const scheduleTime =
    schedule?.startTime ||
    user.attendanceSettings?.attendanceTime ||
    '09:00';

  const windowStartStr = schedule?.windowStart || '08:45';
  const windowEndStr = schedule?.windowEnd || '09:30';

  const now = new Date();

  const {
    start,
    end
  } = getDayRange(now);

  // ----------------------------------------------------------
  // CHECK EXISTING RECORD
  // ----------------------------------------------------------

  const existing = await Attendance.findOne({
    user: user._id,
    date: {
      $gte: start,
      $lte: end
    }
  });

  if (existing) {
    return existing;
  }

  // ----------------------------------------------------------
  // CREATE SCHEDULED TIME
  // ----------------------------------------------------------

  const scheduledTime = createScheduledDate(
    now,
    scheduleTime
  );

  if (!scheduledTime) {
    console.error(
      `Invalid attendance time for user ${user._id}:`,
      scheduleTime
    );

    return null;
  }

  // ----------------------------------------------------------
  // GRACE PERIOD / WINDOW CALCULATION
  // ----------------------------------------------------------

  let windowStart = createScheduledDate(now, windowStartStr);
  let windowEnd = createScheduledDate(now, windowEndStr);

  if (!windowStart || !windowEnd) {
    const gracePeriod =
      Number(
        user.attendanceSettings?.gracePeriodMinutes
      ) || DEFAULT_GRACE_PERIOD;

    windowStart = new Date(scheduledTime);
    windowEnd = new Date(scheduledTime.getTime() + gracePeriod * 60 * 1000);
  }

  const currentPktMins = getPKTCurrentMinutes(now);
  const winEndMins =
    parseTimeToMinutes(windowEndStr) ||
    (parseTimeToMinutes(scheduleTime) + DEFAULT_GRACE_PERIOD);

  const initialStatus = currentPktMins > winEndMins ? 'Absent' : 'Pending';

  // ----------------------------------------------------------
  // CREATE RECORD
  // ----------------------------------------------------------

  try {
    const attendance = await Attendance.create({
      user: user._id,

      date: normalizeDate(now),

      scheduledTime,

      windowStart,

      windowEnd,

      checkIn: null,

      checkOut: null,

      status: initialStatus,

      notificationId: null,

      notificationSentAt: null,

      markedAt: initialStatus === 'Absent' ? now : null,

      notes: ''
    });

    return attendance;
  } catch (error) {
    // --------------------------------------------------------
    // DUPLICATE RECORD CREATED BY ANOTHER REQUEST
    // --------------------------------------------------------

    if (error.code === 11000) {
      return await Attendance.findOne({
        user: user._id,
        date: {
          $gte: start,
          $lte: end
        }
      });
    }

    throw error;
  }
};

// ============================================================
// CREATE ATTENDANCE NOTIFICATION
// ============================================================

const createAttendanceNotification = async (
  attendance
) => {
  if (!attendance) {
    return null;
  }

  if (attendance.notificationId) {
    return attendance.notificationId;
  }

  const user = await User.findById(
    attendance.user
  ).select(
    'name email attendanceSettings attendanceSchedule preferences workSchedule'
  );

  if (!user) {
    return null;
  }

  const gracePeriod =
    Number(
      user.attendanceSettings
        ?.gracePeriodMinutes
    ) || DEFAULT_GRACE_PERIOD;

  const notification =
    await Notification.create({
      user: attendance.user,

      type: 'attendance',

      title: 'Attendance Required',

      message:
        `Your attendance time has started. ` +
        `Please mark your attendance within ` +
        `${gracePeriod} minutes.`,

      isRead: false,

      relatedId: attendance._id,

      relatedType: 'Attendance',

      actionUrl: '/user/attendance',

      metadata: {
        attendanceId:
          attendance._id,

        attendanceDate:
          attendance.date,

        scheduledTime:
          attendance.scheduledTime,

        windowStart:
          attendance.windowStart,

        windowEnd:
          attendance.windowEnd,

        status: 'pending',

        gracePeriodMinutes:
          gracePeriod
      }
    });

  attendance.notificationId =
    notification._id;

  attendance.notificationSentAt =
    new Date();

  await attendance.save();

  return notification;
};

// ============================================================
// PROCESS ATTENDANCE NOTIFICATIONS (CRON SAFE - PKT MINUTES CHECK)
// ============================================================

const processAttendanceNotifications =
  async () => {
    try {
      const now = new Date();
      const currentPktMins = getPKTCurrentMinutes(now);

      const users = await User.find({
        role: 'user',
        status: 'Active',
      }).select(
        '_id name email role status attendanceSettings attendanceSchedule preferences workSchedule'
      );

      let created = 0;
      let notified = 0;
      let expired = 0;

      for (const user of users) {
        try {
          const {
            start,
            end
          } = getDayRange(now);

          let attendance =
            await Attendance.findOne({
              user: user._id,
              date: {
                $gte: start,
                $lte: end
              }
            });

          // Create record if not found
          if (!attendance) {
            attendance =
              await createTodayAttendanceForUser(
                user
              );

            if (attendance) {
              created++;
            }
          }

          if (!attendance) {
            continue;
          }

          // If already marked present, checkout, leave, etc., ignore
          if (attendance.status === 'Present' || attendance.checkIn) {
            continue;
          }

          // Calculate window in minutes
          const schedule =
            user.attendanceSchedule ||
            user.preferences?.attendanceSchedule ||
            user.workSchedule ||
            {};

          const wStartStr = schedule.windowStart || '08:45';
          const wEndStr = schedule.windowEnd || '09:30';

          const winStartMins = parseTimeToMinutes(wStartStr) || 0;
          const winEndMins = parseTimeToMinutes(wEndStr) || 1440;

          // If current time is before window, ensure status is Pending
          if (currentPktMins < winStartMins) {
            if (attendance.status === 'Absent') {
              attendance.status = 'Pending';
              attendance.markedAt = null;
              await attendance.save();
            }
            continue;
          }

          // If current time is inside window
          if (currentPktMins >= winStartMins && currentPktMins <= winEndMins) {
            if (attendance.status !== 'Pending') {
              attendance.status = 'Pending';
              attendance.markedAt = null;
              await attendance.save();
            }

            if (!attendance.notificationId) {
              await createAttendanceNotification(attendance);
              notified++;
            }
            continue;
          }

          // If current time is after window, only then mark Absent
          if (currentPktMins > winEndMins && attendance.status === 'Pending') {
            attendance.status = 'Absent';
            attendance.markedAt = now;
            await attendance.save();

            if (attendance.notificationId) {
              await Notification.findByIdAndUpdate(
                attendance.notificationId,
                {
                  $set: {
                    isRead: true,
                    readAt: now,
                    'metadata.status': 'expired'
                  }
                }
              );
            }

            expired++;
          }
        } catch (userError) {
          console.error(
            `Attendance processing error for user ${user._id}:`,
            userError
          );
        }
      }

      return {
        success: true,
        created,
        notified,
        expired
      };
    } catch (error) {
      console.error(
        'processAttendanceNotifications error:',
        error
      );
      throw error;
    }
  };

// ============================================================
// ADMIN: SET USER ATTENDANCE SCHEDULE
// ============================================================

// PUT /api/attendance/user/:userId/schedule
// PUT /api/users/:id/attendance-schedule

const setUserAttendanceSchedule =
  async (req, res) => {
    try {
      const userId = req.params.userId || req.params.id;

      if (
        !isValidObjectId(userId)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid user ID.'
        });
      }

      const user =
        await User.findById(
          userId
        );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found.'
        });
      }

      const {
        enabled = true,
        attendanceTime,
        startTime,
        endTime,
        windowStart,
        windowEnd,
        gracePeriodMinutes = DEFAULT_GRACE_PERIOD,
        timezone = 'Asia/Karachi'
      } = req.body || {};

      const finalStartTime = startTime || attendanceTime || '09:00';
      const finalEndTime = endTime || '17:00';
      const finalWindowStart = windowStart || '08:45';
      const finalWindowEnd = windowEnd || '09:30';

      const timeFormatRegex = /^$|^([01]\d|2[0-3]):([0-5]\d)$/;

      if (
        !timeFormatRegex.test(finalStartTime) ||
        !timeFormatRegex.test(finalEndTime) ||
        !timeFormatRegex.test(finalWindowStart) ||
        !timeFormatRegex.test(finalWindowEnd)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid time format. Use HH:mm format, for example 09:00.'
        });
      }

      const grace = Number(gracePeriodMinutes) || DEFAULT_GRACE_PERIOD;

      const scheduleObject = {
        startTime: finalStartTime,
        endTime: finalEndTime,
        windowStart: finalWindowStart,
        windowEnd: finalWindowEnd,
        gracePeriodMinutes: grace,
        timezone: 'Asia/Karachi'
      };

      user.attendanceSchedule = scheduleObject;
      user.workSchedule = scheduleObject;

      user.preferences = {
        ...(user.preferences || {}),
        attendanceSchedule: scheduleObject,
        workSchedule: scheduleObject,
        timezone: 'Asia/Karachi'
      };

      user.attendanceSettings = {
        enabled: Boolean(enabled),
        attendanceTime: finalStartTime,
        gracePeriodMinutes: grace,
        timezone: 'Asia/Karachi'
      };

      user.markModified('attendanceSchedule');
      user.markModified('workSchedule');
      user.markModified('preferences');
      user.markModified('attendanceSettings');

      await user.save();

      // Reset today's attendance record immediately based on new window
      const now = new Date();
      const { start, end } = getDayRange(now);

      const newWinStart = createScheduledDate(now, finalWindowStart);
      const newWinEnd = createScheduledDate(now, finalWindowEnd);
      const newSchedTime = createScheduledDate(now, finalStartTime);

      const currentPktMins = getPKTCurrentMinutes(now);
      const winEndMins = parseTimeToMinutes(finalWindowEnd) || (parseTimeToMinutes(finalStartTime) + grace);

      const targetStatus = currentPktMins <= winEndMins ? 'Pending' : 'Absent';

      const existingAttendance = await Attendance.findOne({
        user: user._id,
        date: { $gte: start, $lte: end }
      });

      if (existingAttendance) {
        if (existingAttendance.status !== 'Present') {
          existingAttendance.scheduledTime = newSchedTime;
          existingAttendance.windowStart = newWinStart;
          existingAttendance.windowEnd = newWinEnd;
          existingAttendance.status = targetStatus;
          existingAttendance.markedAt = targetStatus === 'Absent' ? now : null;
          await existingAttendance.save();
        }
      } else {
        await Attendance.create({
          user: user._id,
          date: normalizeDate(now),
          scheduledTime: newSchedTime,
          windowStart: newWinStart,
          windowEnd: newWinEnd,
          status: targetStatus,
          checkIn: null,
          checkOut: null,
          markedAt: targetStatus === 'Absent' ? now : null,
          notes: ''
        });
      }

      return res.status(200).json({
        success: true,
        message: enabled
          ? 'Attendance schedule assigned successfully.'
          : 'Attendance schedule disabled successfully.',
        attendanceSchedule: scheduleObject,
        attendanceSettings: user.attendanceSettings,
        data: {
          attendanceSchedule: scheduleObject,
          attendanceSettings: user.attendanceSettings
        }
      });
    } catch (error) {
      console.error(
        'setUserAttendanceSchedule error:',
        error
      );

      return res.status(500).json({
        success: false,
        message: 'Server error while setting attendance schedule.'
      });
    }
  };

// ============================================================
// ADMIN: GET USER ATTENDANCE SCHEDULE
// ============================================================

// GET /api/attendance/user/:userId/schedule
// GET /api/users/:id/attendance-schedule

const getUserAttendanceSchedule =
  async (req, res) => {
    try {
      const userId = req.params.userId || req.params.id;

      if (
        !isValidObjectId(userId)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid user ID.'
        });
      }

      const user =
        await User.findById(
          userId
        ).select(
          'name email role status attendanceSettings attendanceSchedule preferences workSchedule'
        );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found.'
        });
      }

      const schedule =
        user.attendanceSchedule ||
        user.preferences?.attendanceSchedule ||
        user.workSchedule ||
        user.preferences?.workSchedule || {
          startTime: user.attendanceSettings?.attendanceTime || '09:00',
          endTime: '17:00',
          windowStart: '08:45',
          windowEnd: '09:30',
          timezone: 'Asia/Karachi'
        };

      return res.status(200).json({
        success: true,

        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status
        },

        attendanceSchedule: schedule,

        attendanceSettings:
          user.attendanceSettings ||
          {
            enabled: false,
            attendanceTime: '',
            gracePeriodMinutes: DEFAULT_GRACE_PERIOD,
            timezone: 'Asia/Karachi'
          },

        data: {
          attendanceSchedule: schedule,
          attendanceSettings: user.attendanceSettings
        }
      });
    } catch (error) {
      console.error(
        'getUserAttendanceSchedule error:',
        error
      );

      return res.status(500).json({
        success: false,
        message: 'Server error retrieving attendance schedule.'
      });
    }
  };

// ============================================================
// USER: MARK ATTENDANCE (WITH GPS GEOFENCING VALIDATION)
// ============================================================

// POST /api/attendance/mark

const markAttendance =
  async (req, res) => {
    try {
      const userId =
        req.user._id;

      // ------------------------------------------------------
      // GPS GEOFENCING VALIDATION
      // ------------------------------------------------------
      const officeLat = Number(process.env.OFFICE_LATITUDE);
      const officeLng = Number(process.env.OFFICE_LONGITUDE);
      const maxRadius = Number(process.env.OFFICE_RADIUS_METERS) || 100;

      if (!Number.isNaN(officeLat) && !Number.isNaN(officeLng) && officeLat !== 0 && officeLng !== 0) {
        const { latitude, longitude } = req.body || {};

        if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) {
          return res.status(400).json({
            success: false,
            message: 'GPS location is required to mark attendance. Please enable device location.',
          });
        }

        const clientLat = Number(latitude);
        const clientLng = Number(longitude);

        if (Number.isNaN(clientLat) || Number.isNaN(clientLng)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid GPS coordinates received.',
          });
        }

        const distanceMeters = calculateDistanceInMeters(
          clientLat,
          clientLng,
          officeLat,
          officeLng
        );

        if (distanceMeters > maxRadius) {
          return res.status(403).json({
            success: false,
            message: `You are approximately ${distanceMeters} meters away. Attendance can only be marked within ${maxRadius} meters of the office premises.`,
            distance: distanceMeters,
            allowedRadius: maxRadius,
          });
        }
      }

      const now = new Date();

      const {
        start,
        end
      } =
        getDayRange(now);

      let attendance =
        await Attendance.findOne({
          user: userId,
          date: {
            $gte: start,
            $lte: end
          }
        });

      if (!attendance) {
        const user = await User.findById(userId);
        if (user) {
          attendance = await createTodayAttendanceForUser(user);
        }
      }

      if (!attendance) {
        return res.status(404).json({
          success: false,
          message: 'No attendance has been scheduled for you today.'
        });
      }

      if (
        attendance.status === 'Present' ||
        attendance.checkIn
      ) {
        return res.status(400).json({
          success: false,
          message: 'Your attendance has already been marked today.'
        });
      }

      const currentPktMins = getPKTCurrentMinutes(now);

      const schedule =
        req.user.attendanceSchedule ||
        req.user.preferences?.attendanceSchedule ||
        req.user.workSchedule;

      const windowStartStr = schedule?.windowStart || '08:45';
      const windowEndStr = schedule?.windowEnd || '09:30';

      const winStartMins = parseTimeToMinutes(windowStartStr) || 0;
      const winEndMins = parseTimeToMinutes(windowEndStr) || 1440;

      if (
        currentPktMins < winStartMins
      ) {
        return res.status(400).json({
          success: false,
          message: `Your attendance window starts at ${windowStartStr} (PKT).`
        });
      }

      if (
        currentPktMins > winEndMins
      ) {
        attendance.status =
          'Absent';

        attendance.markedAt =
          now;

        await attendance.save();

        return res.status(400).json({
          success: false,
          message: 'The attendance window has expired. You are marked absent.'
        });
      }

      attendance.checkIn =
        now;

      attendance.markedAt =
        now;

      attendance.status =
        'Present';

      if (
        req.body?.notes
      ) {
        attendance.notes =
          String(
            req.body.notes
          ).trim();
      }

      await attendance.save();

      if (
        attendance.notificationId
      ) {
        await Notification.findByIdAndUpdate(
          attendance.notificationId,
          {
            $set: {
              isRead: true,
              readAt: now,
              'metadata.status': 'completed'
            }
          }
        );
      }

      const populated =
        await Attendance.findById(
          attendance._id
        ).populate(
          'user',
          'name email role avatar'
        );

      const result =
        safeAttendance(
          populated
        );

      return res.status(200).json({
        success: true,
        message: 'Attendance marked successfully. You are present.',
        attendance: result,
        data: result
      });
    } catch (error) {
      console.error(
        'markAttendance error:',
        error
      );

      return res.status(500).json({
        success: false,
        message: 'Server error while marking attendance.'
      });
    }
  };

// ============================================================
// USER: CHECK IN
// ============================================================

// POST /api/attendance/check-in

const checkIn =
  async (req, res) => {
    return markAttendance(req, res);
  };

// ============================================================
// USER: CHECK OUT
// ============================================================

// POST /api/attendance/check-out

const checkOut =
  async (req, res) => {
    try {
      const userId =
        req.user._id;

      const now =
        new Date();

      const {
        start,
        end
      } =
        getDayRange(now);

      const attendance =
        await Attendance.findOne({
          user: userId,
          date: {
            $gte: start,
            $lte: end
          }
        });

      if (!attendance) {
        return res.status(404).json({
          success: false,
          message: 'No attendance record found for today.'
        });
      }

      if (
        attendance.status !== 'Present'
      ) {
        return res.status(400).json({
          success: false,
          message: 'You must be present before checking out.'
        });
      }

      if (
        attendance.checkOut
      ) {
        return res.status(400).json({
          success: false,
          message: 'You have already checked out today.'
        });
      }

      attendance.checkOut =
        now;

      if (
        req.body?.notes
      ) {
        attendance.notes =
          String(
            req.body.notes
          ).trim();
      }

      await attendance.save();

      const populated =
        await Attendance.findById(
          attendance._id
        ).populate(
          'user',
          'name email role avatar'
        );

      const result =
        safeAttendance(
          populated
        );

      return res.status(200).json({
        success: true,
        message: 'Checked out successfully.',
        attendance: result,
        data: result
      });
    } catch (error) {
      console.error(
        'checkOut error:',
        error
      );

      return res.status(500).json({
        success: false,
        message: 'Server error processing check-out.'
      });
    }
  };

// ============================================================
// USER: GET MY ATTENDANCE
// ============================================================

// GET /api/attendance/my

const getMyAttendance =
  async (req, res) => {
    try {
      const userId =
        req.user._id;

      const {
        page = 1,
        limit = 20,
        startDate,
        endDate,
        status
      } = req.query;

      const filter = {
        user: userId
      };

      if (status) {
        if (
          !VALID_STATUSES.includes(
            status
          )
        ) {
          return res.status(400).json({
            success: false,
            message: `Invalid status filter. Allowed: ${VALID_STATUSES.join(', ')}.`
          });
        }

        filter.status =
          status;
      }

      if (
        startDate ||
        endDate
      ) {
        filter.date = {};

        if (startDate) {
          filter.date.$gte = new Date(`${startDate}T00:00:00+05:00`);
        }

        if (endDate) {
          filter.date.$lte = new Date(`${endDate}T23:59:59.999+05:00`);
        }
      }

      const pageNum =
        Math.max(
          1,
          parseInt(page, 10) || 1
        );

      const limitNum =
        Math.min(
          100,
          Math.max(
            1,
            parseInt(limit, 10) || 20
          )
        );

      const skip =
        (pageNum - 1) *
        limitNum;

      const [
        attendanceList,
        total
      ] =
        await Promise.all([
          Attendance.find(
            filter
          )
            .populate(
              'user',
              'name email role avatar'
            )
            .skip(skip)
            .limit(limitNum)
            .sort({
              date: -1,
              createdAt: -1
            }),

          Attendance.countDocuments(
            filter
          )
        ]);

      const formatted =
        attendanceList.map(
          safeAttendance
        );

      return res.status(200).json({
        success: true,
        attendance: formatted,
        data: formatted,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages:
            Math.ceil(
              total /
                limitNum
            ) || 0
        }
      });
    } catch (error) {
      console.error(
        'getMyAttendance error:',
        error
      );

      return res.status(500).json({
        success: false,
        message: 'Server error retrieving attendance history.'
      });
    }
  };

// ============================================================
// USER: GET TODAY ATTENDANCE
// ============================================================

// GET /api/attendance/today

const getTodayAttendance =
  async (req, res) => {
    try {
      const userId =
        req.user._id;

      const now =
        new Date();

      const {
        start,
        end
      } =
        getDayRange(now);

      let attendance =
        await Attendance.findOne({
          user: userId,
          date: {
            $gte: start,
            $lte: end
          }
        }).populate(
          'user',
          'name email role avatar'
        );

      // Create record if not found
      if (!attendance) {
        const user =
          await User.findById(
            userId
          ).select(
            'name email role status attendanceSettings attendanceSchedule preferences workSchedule'
          );

        if (
          user &&
          user.status === 'Active'
        ) {
          attendance = await createTodayAttendanceForUser(
            user
          );

          if (attendance) {
            attendance =
              await Attendance.findById(
                attendance._id
              ).populate(
                'user',
                'name email role avatar'
              );
          }
        }
      }

      if (!attendance) {
        return res.status(200).json({
          success: true,
          attendance: null,
          data: null,
          message: 'No attendance schedule found for today.'
        });
      }

      const result =
        safeAttendance(
          attendance
        );

      return res.status(200).json({
        success: true,
        attendance: result,
        data: result
      });
    } catch (error) {
      console.error(
        'getTodayAttendance error:',
        error
      );

      return res.status(500).json({
        success: false,
        message: 'Server error retrieving today attendance.'
      });
    }
  };

// ============================================================
// ATTENDANCE SUMMARY
// ============================================================

// GET /api/attendance/summary

const getAttendanceSummary =
  async (req, res) => {
    try {
      const filter = {};

      if (
        req.user.role === 'user'
      ) {
        filter.user =
          req.user._id;
      } else {
        const {
          userId,
          user
        } = req.query;

        const targetUser =
          userId || user;

        if (targetUser && isValidObjectId(targetUser)) {
          filter.user =
            targetUser;
        }
      }

      const [
        present,
        absent,
        late,
        halfDay,
        leave,
        pending,
        total
      ] =
        await Promise.all([
          Attendance.countDocuments({
            ...filter,
            status: 'Present'
          }),

          Attendance.countDocuments({
            ...filter,
            status: 'Absent'
          }),

          Attendance.countDocuments({
            ...filter,
            status: 'Late'
          }),

          Attendance.countDocuments({
            ...filter,
            status: 'Half Day'
          }),

          Attendance.countDocuments({
            ...filter,
            status: 'Leave'
          }),

          Attendance.countDocuments({
            ...filter,
            status: 'Pending'
          }),

          Attendance.countDocuments(
            filter
          )
        ]);

      return res.status(200).json({
        success: true,
        summary: {
          present,
          absent,
          late,
          halfDay,
          leave,
          pending,
          total
        }
      });
    } catch (error) {
      console.error(
        'getAttendanceSummary error:',
        error
      );

      return res.status(500).json({
        success: false,
        message: 'Server error retrieving attendance summary.'
      });
    }
  };

// ============================================================
// ADMIN / MANAGER: GET ATTENDANCE LIST
// ============================================================

// GET /api/attendance

const getAttendanceList =
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        userId,
        user,
        startDate,
        endDate,
        status,
        search
      } = req.query;

      const filter = {};

      const targetUser =
        userId || user;

      if (targetUser && isValidObjectId(targetUser)) {
        filter.user =
          targetUser;
      } else if (
        search &&
        search.trim()
      ) {
        const matchingUsers =
          await User.find({
            $or: [
              {
                name: {
                  $regex:
                    search.trim(),
                  $options:
                    'i'
                }
              },
              {
                email: {
                  $regex:
                    search.trim(),
                  $options:
                    'i'
                }
              }
            ]
          }).select(
            '_id'
          );

        const userIds =
          matchingUsers.map(
            (u) => u._id
          );

        filter.user = {
          $in: userIds
        };
      }

      if (status && VALID_STATUSES.includes(status)) {
        filter.status =
          status;
      }

      if (
        startDate ||
        endDate
      ) {
        filter.date = {};

        if (startDate) {
          filter.date.$gte = new Date(`${startDate}T00:00:00+05:00`);
        }

        if (endDate) {
          filter.date.$lte = new Date(`${endDate}T23:59:59.999+05:00`);
        }
      }

      const pageNum =
        Math.max(
          1,
          parseInt(page, 10) || 1
        );

      const limitNum =
        Math.min(
          100,
          Math.max(
            1,
            parseInt(limit, 10) || 20
          )
        );

      const skip =
        (pageNum - 1) *
        limitNum;

      const [
        attendanceList,
        total
      ] =
        await Promise.all([
          Attendance.find(
            filter
          )
            .populate(
              'user',
              'name email role avatar'
            )
            .skip(skip)
            .limit(limitNum)
            .sort({
              date: -1,
              createdAt: -1
            }),

          Attendance.countDocuments(
            filter
          )
        ]);

      const formatted =
        attendanceList.map(
          safeAttendance
        );

      return res.status(200).json({
        success: true,
        attendance: formatted,
        data: formatted,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages:
            Math.ceil(
              total /
                limitNum
            ) || 0
        }
      });
    } catch (error) {
      console.error(
        'getAttendanceList error:',
        error
      );

      return res.status(500).json({
        success: false,
        message: 'Server error retrieving attendance records.'
      });
    }
  };

// ============================================================
// GET SINGLE ATTENDANCE
// ============================================================

// GET /api/attendance/:id

const getAttendanceById =
  async (req, res) => {
    try {
      if (
        !isValidObjectId(
          req.params.id
        )
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid attendance ID.'
        });
      }

      const attendance =
        await Attendance.findById(
          req.params.id
        ).populate(
          'user',
          'name email role avatar'
        );

      if (!attendance) {
        return res.status(404).json({
          success: false,
          message: 'Attendance record not found.'
        });
      }

      if (
        req.user.role === 'user' &&
        attendance.user &&
        attendance.user._id.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view your own attendance records.'
        });
      }

      const result =
        safeAttendance(
          attendance
        );

      return res.status(200).json({
        success: true,
        attendance: result,
        data: result
      });
    } catch (error) {
      console.error(
        'getAttendanceById error:',
        error
      );

      return res.status(500).json({
        success: false,
        message: 'Server error retrieving attendance record.'
      });
    }
  };

// ============================================================
// ADMIN: CREATE MANUAL ATTENDANCE
// ============================================================

// POST /api/attendance

const createManualAttendance =
  async (req, res) => {
    try {
      const {
        userId,
        user,
        date,
        checkIn,
        checkOut,
        status,
        notes,
        scheduledTime,
        windowStart,
        windowEnd
      } = req.body || {};

      const targetUserId =
        userId || user;

      if (!targetUserId || !isValidObjectId(targetUserId)) {
        return res.status(400).json({
          success: false,
          message: 'Valid userId is required.'
        });
      }

      const userExists =
        await User.findById(
          targetUserId
        );

      if (!userExists) {
        return res.status(404).json({
          success: false,
          message: 'User not found.'
        });
      }

      if (!date) {
        return res.status(400).json({
          success: false,
          message: 'Date is required.'
        });
      }

      const recordDate =
        new Date(date);

      const {
        start,
        end
      } =
        getDayRange(
          recordDate
        );

      const existing =
        await Attendance.findOne({
          user: targetUserId,
          date: {
            $gte: start,
            $lte: end
          }
        });

      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'An attendance record for this user on this date already exists.'
        });
      }

      const assignedStatus =
        status &&
        VALID_STATUSES.includes(
          status
        )
          ? status
          : 'Present';

      const attendanceData = {
        user: targetUserId,
        date: normalizeDate(recordDate),
        checkIn: checkIn ? new Date(checkIn) : null,
        checkOut: checkOut ? new Date(checkOut) : null,
        status: assignedStatus,
        markedAt: assignedStatus === 'Pending' ? null : new Date(),
        notes: notes ? String(notes).trim() : '',
        scheduledTime: scheduledTime ? new Date(scheduledTime) : null,
        windowStart: windowStart ? new Date(windowStart) : null,
        windowEnd: windowEnd ? new Date(windowEnd) : null,
      };

      const attendance =
        await Attendance.create(
          attendanceData
        );

      const populated =
        await Attendance.findById(
          attendance._id
        ).populate(
          'user',
          'name email role avatar'
        );

      const result =
        safeAttendance(
          populated
        );

      return res.status(201).json({
        success: true,
        message: 'Attendance record created successfully.',
        attendance: result,
        data: result
      });
    } catch (error) {
      console.error(
        'createManualAttendance error:',
        error
      );

      if (
        error.code === 11000
      ) {
        return res.status(400).json({
          success: false,
          message: 'An attendance record for this user on this date already exists.'
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Server error creating manual attendance record.'
      });
    }
  };

// ============================================================
// ADMIN: UPDATE ATTENDANCE
// ============================================================

// PUT/PATCH /api/attendance/:id

const updateAttendance =
  async (req, res) => {
    try {
      if (
        !isValidObjectId(
          req.params.id
        )
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid attendance ID.'
        });
      }

      const attendance =
        await Attendance.findById(
          req.params.id
        );

      if (!attendance) {
        return res.status(404).json({
          success: false,
          message: 'Attendance record not found.'
        });
      }

      const {
        date,
        checkIn,
        checkOut,
        status,
        notes,
        scheduledTime,
        windowStart,
        windowEnd
      } = req.body || {};

      if (
        status !== undefined &&
        VALID_STATUSES.includes(status)
      ) {
        attendance.status =
          status;

        attendance.markedAt =
          status === 'Pending' ? null : new Date();

        if (
          status === 'Present' &&
          !attendance.checkIn
        ) {
          attendance.checkIn =
            new Date();
        }

        if (
          status === 'Absent'
        ) {
          attendance.checkIn =
            null;

          attendance.checkOut =
            null;
        }
      }

      if (
        date !== undefined
      ) {
        attendance.date =
          normalizeDate(
            new Date(date)
          );
      }

      if (
        checkIn !== undefined
      ) {
        attendance.checkIn =
          checkIn ? new Date(checkIn) : null;
      }

      if (
        checkOut !== undefined
      ) {
        attendance.checkOut =
          checkOut ? new Date(checkOut) : null;
      }

      if (
        scheduledTime !== undefined
      ) {
        attendance.scheduledTime =
          scheduledTime ? new Date(scheduledTime) : null;
      }

      if (
        windowStart !== undefined
      ) {
        attendance.windowStart =
          windowStart ? new Date(windowStart) : null;
      }

      if (
        windowEnd !== undefined
      ) {
        attendance.windowEnd =
          windowEnd ? new Date(windowEnd) : null;
      }

      if (
        notes !== undefined
      ) {
        attendance.notes =
          String(
            notes
          ).trim();
      }

      await attendance.save();

      if (
        [
          'Present',
          'Absent',
          'Late',
          'Half Day',
          'Leave'
        ].includes(
          attendance.status
        ) &&
        attendance.notificationId
      ) {
        await Notification.findByIdAndUpdate(
          attendance.notificationId,
          {
            $set: {
              isRead: true,
              readAt: new Date(),
              'metadata.status': 'completed'
            }
          }
        );
      }

      const populated =
        await Attendance.findById(
          attendance._id
        ).populate(
          'user',
          'name email role avatar'
        );

      const result =
        safeAttendance(
          populated
        );

      return res.status(200).json({
        success: true,
        message: 'Attendance updated successfully.',
        attendance: result,
        data: result
      });
    } catch (error) {
      console.error(
        'updateAttendance error:',
        error
      );

      return res.status(500).json({
        success: false,
        message: 'Server error updating attendance record.'
      });
    }
  };

// ============================================================
// ADMIN: DELETE ATTENDANCE
// ============================================================

// DELETE /api/attendance/:id

const deleteAttendance =
  async (req, res) => {
    try {
      if (
        !isValidObjectId(
          req.params.id
        )
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid attendance ID.'
        });
      }

      const attendance =
        await Attendance.findById(
          req.params.id
        );

      if (!attendance) {
        return res.status(404).json({
          success: false,
          message: 'Attendance record not found.'
        });
      }

      if (
        attendance.notificationId
      ) {
        await Notification.findByIdAndDelete(
          attendance.notificationId
        );
      }

      await Attendance.findByIdAndDelete(
        req.params.id
      );

      return res.status(200).json({
        success: true,
        message: 'Attendance deleted successfully.'
      });
    } catch (error) {
      console.error(
        'deleteAttendance error:',
        error
      );

      return res.status(500).json({
        success: false,
        message: 'Server error deleting attendance record.'
      });
    }
  };

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  checkIn,
  checkOut,

  markAttendance,

  getMyAttendance,
  getTodayAttendance,

  getAttendanceSummary,

  getAttendanceList,
  getAttendanceById,

  createManualAttendance,
  updateAttendance,
  deleteAttendance,

  setUserAttendanceSchedule,
  getUserAttendanceSchedule,

  createTodayAttendanceForUser,
  createAttendanceNotification,
  processAttendanceNotifications
};