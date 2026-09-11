const mongoose = require('mongoose');

const Attendance = require('../models/Attendance');
const User = require('../models/User');
const Notification = require('../models/Notification');

const isValidObjectId = (id) =>
  Boolean(id) && mongoose.Types.ObjectId.isValid(id);

const VALID_STATUSES = [
  'Pending',
  'Present',
  'Absent',
  'Late',
  'Half Day',
  'Leave',
];

const DEFAULT_GRACE_PERIOD = 10;
const PAK_TIMEZONE = 'Asia/Karachi';

// ============================================================
// GPS GEOFENCING / HAVERSINE DISTANCE HELPER
// ============================================================

function calculateDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;

  const toRad = (value) => (Number(value) * Math.PI) / 180;

  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lon2 - lon1);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(deltaLambda / 2) *
      Math.sin(deltaLambda / 2);

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

const getPKTTimeParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PAK_TIMEZONE,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);

  return {
    hours: Number(parts.find((p) => p.type === 'hour')?.value || 0),
    minutes: Number(parts.find((p) => p.type === 'minute')?.value || 0),
  };
};

const getPKTCurrentMinutes = (date = new Date()) => {
  const { hours, minutes } = getPKTTimeParts(date);

  return hours * 60 + minutes;
};

const getPKTMinutesFromDate = (date) => {
  if (!date) {
    return null;
  }

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return getPKTCurrentMinutes(parsedDate);
};

const parseTimeToMinutes = (timeStr) => {
  if (timeStr === undefined || timeStr === null) {
    return null;
  }

  const value = String(timeStr).trim();

  const match = value.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
};

const getDayRange = (date = new Date()) => {
  const pktDateString = getPKTDateString(date);

  const start = new Date(
    `${pktDateString}T00:00:00+05:00`
  );

  const end = new Date(
    `${pktDateString}T23:59:59.999+05:00`
  );

  return {
    start,
    end,
    pktDateString,
  };
};

const normalizeDate = (date = new Date()) => {
  const pktDateString = getPKTDateString(date);

  return new Date(
    `${pktDateString}T00:00:00+05:00`
  );
};

// ============================================================
// TIME HELPERS
// ============================================================

const createScheduledDate = (date, time) => {
  const minutes = parseTimeToMinutes(time);

  if (minutes === null) {
    return null;
  }

  const pktDateString = getPKTDateString(date);

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  const timeFormatted =
    `${String(hours).padStart(2, '0')}:` +
    `${String(mins).padStart(2, '0')}`;

  const scheduled = new Date(
    `${pktDateString}T${timeFormatted}:00+05:00`
  );

  if (Number.isNaN(scheduled.getTime())) {
    return null;
  }

  return scheduled;
};

// ============================================================
// USER SCHEDULE HELPERS
// ============================================================

const getUserAttendanceScheduleObject = (user) => {
  return (
    user?.attendanceSchedule ||
    user?.preferences?.attendanceSchedule ||
    user?.workSchedule ||
    user?.preferences?.workSchedule ||
    null
  );
};

const getDefaultSchedule = (user = null) => {
  const schedule = getUserAttendanceScheduleObject(user);

  const attendanceSettings =
    user?.attendanceSettings || {};

  return {
    startTime:
      schedule?.startTime ||
      attendanceSettings.attendanceTime ||
      '09:00',

    endTime:
      schedule?.endTime ||
      '17:00',

    windowStart:
      schedule?.windowStart ||
      '08:45',

    windowEnd:
      schedule?.windowEnd ||
      '09:30',

    gracePeriodMinutes:
      Number(
        schedule?.gracePeriodMinutes ??
          attendanceSettings.gracePeriodMinutes
      ) || DEFAULT_GRACE_PERIOD,

    timezone:
      schedule?.timezone ||
      attendanceSettings.timezone ||
      PAK_TIMEZONE,
  };
};

const getAttendanceWindowMinutes = (
  attendance,
  user = null
) => {
  let windowStartMins = getPKTMinutesFromDate(
    attendance?.windowStart
  );

  let windowEndMins = getPKTMinutesFromDate(
    attendance?.windowEnd
  );

  const schedule = getDefaultSchedule(user);

  if (windowStartMins === null) {
    windowStartMins =
      parseTimeToMinutes(schedule.windowStart);

    if (windowStartMins === null) {
      windowStartMins = 8 * 60 + 45;
    }
  }

  if (windowEndMins === null) {
    windowEndMins =
      parseTimeToMinutes(schedule.windowEnd);

    if (windowEndMins === null) {
      windowEndMins = 9 * 60 + 30;
    }
  }

  return {
    windowStartMins,
    windowEndMins,
    windowStartText: schedule.windowStart,
    windowEndText: schedule.windowEnd,
  };
};

const escapeRegex = (value) => {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );
};

// ============================================================
// SAFE SERIALIZER
// ============================================================

const safeAttendance = (attendance) => {
  if (!attendance) {
    return null;
  }

  let safeUserObj = null;

  if (attendance.user) {
    if (
      typeof attendance.user === 'object' &&
      attendance.user._id
    ) {
      let cleanAvatar = attendance.user.avatar || null;

      if (
        typeof cleanAvatar === 'string' &&
        cleanAvatar.startsWith('data:image') &&
        cleanAvatar.length > 1000
      ) {
        cleanAvatar = null;
      }

      safeUserObj = {
        id: attendance.user._id,
        _id: attendance.user._id,
        name: attendance.user.name || '',
        email: attendance.user.email || '',
        role: attendance.user.role || '',
        avatar: cleanAvatar,
      };
    } else {
      safeUserObj = attendance.user;
    }
  }

  return {
    id: attendance._id,
    _id: attendance._id,
    user: safeUserObj,

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
      attendance.updatedAt,
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

  const schedule = getDefaultSchedule(user);

  const scheduleTime =
    schedule.startTime || '09:00';

  const windowStartStr =
    schedule.windowStart || '08:45';

  const windowEndStr =
    schedule.windowEnd || '09:30';

  const now = new Date();

  const { start, end } = getDayRange(now);

  const existing = await Attendance.findOne({
    user: user._id,
    date: {
      $gte: start,
      $lte: end,
    },
  });

  if (existing) {
    return existing;
  }

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

  let windowStart = createScheduledDate(
    now,
    windowStartStr
  );

  let windowEnd = createScheduledDate(
    now,
    windowEndStr
  );

  if (!windowStart || !windowEnd) {
    const gracePeriod =
      Number(
        user.attendanceSettings
          ?.gracePeriodMinutes
      ) || DEFAULT_GRACE_PERIOD;

    windowStart = new Date(
      scheduledTime
    );

    windowEnd = new Date(
      scheduledTime.getTime() +
        gracePeriod * 60 * 1000
    );
  }

  const currentPktMins =
    getPKTCurrentMinutes(now);

  const actualWindowEndMins =
    getPKTMinutesFromDate(windowEnd);

  const winEndMins =
    actualWindowEndMins !== null
      ? actualWindowEndMins
      : (
          parseTimeToMinutes(windowEndStr) ??
          (
            parseTimeToMinutes(scheduleTime) +
            DEFAULT_GRACE_PERIOD
          )
        );

  const initialStatus =
    currentPktMins > winEndMins
      ? 'Absent'
      : 'Pending';

  try {
    const attendance =
      await Attendance.create({
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

        markedAt:
          initialStatus === 'Absent'
            ? now
            : null,

        notes: '',
      });

    return attendance;
  } catch (error) {
    if (error.code === 11000) {
      return await Attendance.findOne({
        user: user._id,
        date: {
          $gte: start,
          $lte: end,
        },
      });
    }

    throw error;
  }
};

// ============================================================
// CREATE ATTENDANCE NOTIFICATION
// IMPORTANT:
// Never save the old attendance document after async work.
// Otherwise a concurrent check-in can be overwritten.
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
  )
    .select(
      'name email attendanceSettings attendanceSchedule preferences workSchedule'
    )
    .lean();

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
          gracePeriod,
      },
    });

  // IMPORTANT:
  // Update only if attendance is still Pending and
  // user has not checked in during notification creation.
  const updatedAttendance =
    await Attendance.findOneAndUpdate(
      {
        _id: attendance._id,

        status: 'Pending',

        $or: [
          {
            checkIn: null,
          },
          {
            checkIn: {
              $exists: false,
            },
          },
        ],

        $or: [
          {
            notificationId: null,
          },
          {
            notificationId: {
              $exists: false,
            },
          },
        ],
      },
      {
        $set: {
          notificationId:
            notification._id,

          notificationSentAt:
            new Date(),
        },
      },
      {
        new: true,
      }
    );

  // If the user checked in while the notification
  // was being created, don't leave an orphan notification.
  if (!updatedAttendance) {
    await Notification.findByIdAndDelete(
      notification._id
    );

    return null;
  }

  return notification;
};

// ============================================================
// PROCESS ATTENDANCE NOTIFICATIONS
// CRON SAFE / RACE CONDITION SAFE
// ============================================================

const processAttendanceNotifications =
  async () => {
    try {
      const now = new Date();

      const currentPktMins =
        getPKTCurrentMinutes(now);

      const users = await User.find({
        role: 'user',
        status: 'Active',
      })
        .select(
          '_id name email role status attendanceSettings attendanceSchedule preferences workSchedule'
        )
        .lean();

      let created = 0;
      let notified = 0;
      let expired = 0;

      const { start, end } =
        getDayRange(now);

      for (const user of users) {
        try {
          let attendance =
            await Attendance.findOne({
              user: user._id,

              date: {
                $gte: start,
                $lte: end,
              },
            });

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

          // Never touch an already checked-in record.
          if (
            attendance.status === 'Present' ||
            attendance.checkIn
          ) {
            continue;
          }

          const {
            windowStartMins,
            windowEndMins,
          } = getAttendanceWindowMinutes(
            attendance,
            user
          );

          // --------------------------------------------
          // BEFORE ATTENDANCE WINDOW
          // --------------------------------------------

          if (
            currentPktMins <
            windowStartMins
          ) {
            continue;
          }

          // --------------------------------------------
          // INSIDE ATTENDANCE WINDOW
          // --------------------------------------------

          if (
            currentPktMins >=
              windowStartMins &&
            currentPktMins <=
              windowEndMins
          ) {
            // Only Pending records should receive
            // automatic attendance notification.
            if (
              attendance.status ===
              'Pending'
            ) {
              if (
                !attendance.notificationId
              ) {
                const notification =
                  await createAttendanceNotification(
                    attendance
                  );

                if (notification) {
                  notified++;
                }
              }
            }

            continue;
          }

          // --------------------------------------------
          // AFTER ATTENDANCE WINDOW
          // --------------------------------------------

          if (
            currentPktMins >
              windowEndMins &&
            attendance.status ===
              'Pending'
          ) {
            // ATOMIC UPDATE:
            // If user checks in at the same time,
            // this query will fail instead of
            // overwriting Present with Absent.
            const expiredAttendance =
              await Attendance.findOneAndUpdate(
                {
                  _id: attendance._id,

                  status: 'Pending',

                  $or: [
                    {
                      checkIn: null,
                    },
                    {
                      checkIn: {
                        $exists: false,
                      },
                    },
                  ],
                },
                {
                  $set: {
                    status: 'Absent',
                    markedAt: now,
                  },
                },
                {
                  new: true,
                }
              );

            if (!expiredAttendance) {
              // Someone else changed the record,
              // most likely a successful check-in.
              continue;
            }

            if (
              expiredAttendance.notificationId
            ) {
              await Notification.findByIdAndUpdate(
                expiredAttendance.notificationId,
                {
                  $set: {
                    isRead: true,
                    readAt: now,
                    'metadata.status':
                      'expired',
                  },
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
        expired,
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

const setUserAttendanceSchedule =
  async (req, res) => {
    try {
      const userId =
        req.params.userId ||
        req.params.id;

      if (!isValidObjectId(userId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid user ID.',
        });
      }

      const user =
        await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found.',
        });
      }

      const {
        enabled = true,
        attendanceTime,
        startTime,
        endTime,
        windowStart,
        windowEnd,
        gracePeriodMinutes =
          DEFAULT_GRACE_PERIOD,
        timezone = PAK_TIMEZONE,
      } = req.body || {};

      const finalStartTime =
        startTime ||
        attendanceTime ||
        '09:00';

      const finalEndTime =
        endTime ||
        '17:00';

      const finalWindowStart =
        windowStart ||
        '08:45';

      const finalWindowEnd =
        windowEnd ||
        '09:30';

      const timeFormatRegex =
        /^([01]\d|2[0-3]):([0-5]\d)$/;

      if (
        !timeFormatRegex.test(
          String(finalStartTime).trim()
        ) ||
        !timeFormatRegex.test(
          String(finalEndTime).trim()
        ) ||
        !timeFormatRegex.test(
          String(finalWindowStart).trim()
        ) ||
        !timeFormatRegex.test(
          String(finalWindowEnd).trim()
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid time format. Use HH:mm format, for example 09:00.',
        });
      }

      const finalWindowStartMins =
        parseTimeToMinutes(
          finalWindowStart
        );

      const finalWindowEndMins =
        parseTimeToMinutes(
          finalWindowEnd
        );

      if (
        finalWindowStartMins === null ||
        finalWindowEndMins === null
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid attendance window.',
        });
      }

      if (
        finalWindowStartMins >
        finalWindowEndMins
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Attendance window start time cannot be after window end time.',
        });
      }

      const grace =
        Number(gracePeriodMinutes);

      const finalGrace =
        Number.isFinite(grace) &&
        grace >= 0
          ? grace
          : DEFAULT_GRACE_PERIOD;

      const scheduleObject = {
        startTime: finalStartTime,
        endTime: finalEndTime,
        windowStart:
          finalWindowStart,
        windowEnd:
          finalWindowEnd,
        gracePeriodMinutes:
          finalGrace,
        timezone:
          timezone || PAK_TIMEZONE,
      };

      user.attendanceSchedule =
        scheduleObject;

      user.workSchedule =
        scheduleObject;

      user.preferences = {
        ...(user.preferences || {}),
        attendanceSchedule:
          scheduleObject,
        workSchedule:
          scheduleObject,
        timezone:
          timezone || PAK_TIMEZONE,
      };

      user.attendanceSettings = {
        enabled:
          Boolean(enabled),

        attendanceTime:
          finalStartTime,

        gracePeriodMinutes:
          finalGrace,

        timezone:
          timezone || PAK_TIMEZONE,
      };

      user.markModified(
        'attendanceSchedule'
      );

      user.markModified(
        'workSchedule'
      );

      user.markModified(
        'preferences'
      );

      user.markModified(
        'attendanceSettings'
      );

      await user.save();

      const now = new Date();

      const { start, end } =
        getDayRange(now);

      const newWinStart =
        createScheduledDate(
          now,
          finalWindowStart
        );

      const newWinEnd =
        createScheduledDate(
          now,
          finalWindowEnd
        );

      const newSchedTime =
        createScheduledDate(
          now,
          finalStartTime
        );

      if (
        !newWinStart ||
        !newWinEnd ||
        !newSchedTime
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Unable to create attendance schedule dates.',
        });
      }

      const currentPktMins =
        getPKTCurrentMinutes(now);

      const targetStatus =
        currentPktMins <=
          finalWindowEndMins
          ? 'Pending'
          : 'Absent';

      const existingAttendance =
        await Attendance.findOne({
          user: user._id,
          date: {
            $gte: start,
            $lte: end,
          },
        });

      if (existingAttendance) {
        // IMPORTANT:
        // Never modify today's attendance window/status
        // after the user has already checked in.
        if (
          !existingAttendance.checkIn &&
          existingAttendance.status !==
            'Present'
        ) {
          existingAttendance.scheduledTime =
            newSchedTime;

          existingAttendance.windowStart =
            newWinStart;

          existingAttendance.windowEnd =
            newWinEnd;

          existingAttendance.status =
            targetStatus;

          existingAttendance.markedAt =
            targetStatus === 'Absent'
              ? now
              : null;

          await existingAttendance.save();
        }
      } else {
        await Attendance.create({
          user: user._id,

          date: normalizeDate(now),

          scheduledTime:
            newSchedTime,

          windowStart:
            newWinStart,

          windowEnd:
            newWinEnd,

          status:
            targetStatus,

          checkIn: null,

          checkOut: null,

          notificationId: null,

          notificationSentAt: null,

          markedAt:
            targetStatus === 'Absent'
              ? now
              : null,

          notes: '',
        });
      }

      return res.status(200).json({
        success: true,

        message: enabled
          ? 'Attendance schedule assigned successfully.'
          : 'Attendance schedule disabled successfully.',

        attendanceSchedule:
          scheduleObject,

        attendanceSettings:
          user.attendanceSettings,

        data: {
          attendanceSchedule:
            scheduleObject,

          attendanceSettings:
            user.attendanceSettings,
        },
      });
    } catch (error) {
      console.error(
        'setUserAttendanceSchedule error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Server error while setting attendance schedule.',
      });
    }
  };

// ============================================================
// ADMIN: GET USER ATTENDANCE SCHEDULE
// ============================================================

const getUserAttendanceSchedule =
  async (req, res) => {
    try {
      const userId =
        req.params.userId ||
        req.params.id;

      if (!isValidObjectId(userId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid user ID.',
        });
      }

      const user =
        await User.findById(userId)
          .select(
            'name email role status attendanceSettings attendanceSchedule preferences workSchedule'
          )
          .lean();

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found.',
        });
      }

      const schedule =
        getDefaultSchedule(user);

      return res.status(200).json({
        success: true,

        user: {
          id: user._id,
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
        },

        attendanceSchedule:
          schedule,

        attendanceSettings:
          user.attendanceSettings ||
          {
            enabled: false,
            attendanceTime: '',
            gracePeriodMinutes:
              DEFAULT_GRACE_PERIOD,
            timezone:
              PAK_TIMEZONE,
          },

        data: {
          attendanceSchedule:
            schedule,

          attendanceSettings:
            user.attendanceSettings,
        },
      });
    } catch (error) {
      console.error(
        'getUserAttendanceSchedule error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Server error retrieving attendance schedule.',
      });
    }
  };

// ============================================================
// USER: MARK ATTENDANCE
// WITH GPS GEOFENCING + RACE CONDITION PROTECTION
// ============================================================

const markAttendance =
  async (req, res) => {
    try {
      const userId =
        req.user._id;

      // ------------------------------------------------------
      // GPS VALIDATION
      // ------------------------------------------------------

      const officeLat =
        Number(
          process.env.OFFICE_LATITUDE
        );

      const officeLng =
        Number(
          process.env.OFFICE_LONGITUDE
        );

      const maxRadius =
        Number(
          process.env.OFFICE_RADIUS_METERS
        ) || 100;

      if (
        !Number.isNaN(officeLat) &&
        !Number.isNaN(officeLng) &&
        officeLat !== 0 &&
        officeLng !== 0
      ) {
        const {
          latitude,
          longitude,
        } = req.body || {};

        if (
          latitude === undefined ||
          longitude === undefined ||
          latitude === null ||
          longitude === null
        ) {
          return res.status(400).json({
            success: false,
            message:
              'GPS location is required to mark attendance. Please enable device location.',
          });
        }

        const clientLat =
          Number(latitude);

        const clientLng =
          Number(longitude);

        if (
          Number.isNaN(clientLat) ||
          Number.isNaN(clientLng)
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Invalid GPS coordinates received.',
          });
        }

        if (
          clientLat < -90 ||
          clientLat > 90 ||
          clientLng < -180 ||
          clientLng > 180
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Invalid GPS coordinates received.',
          });
        }

        const distanceMeters =
          calculateDistanceInMeters(
            clientLat,
            clientLng,
            officeLat,
            officeLng
          );

        if (
          distanceMeters >
          maxRadius
        ) {
          return res.status(403).json({
            success: false,

            message:
              `You are approximately ${distanceMeters} meters away. ` +
              `Attendance can only be marked within ${maxRadius} meters of the office premises.`,

            distance:
              distanceMeters,

            allowedRadius:
              maxRadius,
          });
        }
      }

      // ------------------------------------------------------
      // FIND TODAY'S ATTENDANCE
      // ------------------------------------------------------

      const now = new Date();

      const {
        start,
        end,
      } = getDayRange(now);

      let attendance =
        await Attendance.findOne({
          user: userId,

          date: {
            $gte: start,
            $lte: end,
          },
        });

      if (!attendance) {
        const user =
          await User.findById(
            userId
          );

        if (user) {
          attendance =
            await createTodayAttendanceForUser(
              user
            );
        }
      }

      if (!attendance) {
        return res.status(404).json({
          success: false,
          message:
            'No attendance has been scheduled for you today.',
        });
      }

      // ------------------------------------------------------
      // ALREADY PRESENT
      // ------------------------------------------------------

      if (
        attendance.status ===
          'Present' ||
        attendance.checkIn
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Your attendance has already been marked today.',
        });
      }

      // ------------------------------------------------------
      // IMPORTANT:
      // USE ACTUAL WINDOW STORED IN ATTENDANCE.
      // DO NOT USE req.user OLD SCHEDULE.
      // ------------------------------------------------------

      const {
        windowStartMins,
        windowEndMins,
        windowStartText,
        windowEndText,
      } = getAttendanceWindowMinutes(
        attendance,
        req.user
      );

      const currentPktMins =
        getPKTCurrentMinutes(now);

      // ------------------------------------------------------
      // BEFORE WINDOW
      // ------------------------------------------------------

      if (
        currentPktMins <
        windowStartMins
      ) {
        return res.status(400).json({
          success: false,

          message:
            `Your attendance window starts at ${windowStartText} (PKT).`,
        });
      }

      // ------------------------------------------------------
      // AFTER WINDOW
      // ATOMICALLY MARK ABSENT
      // ------------------------------------------------------

      if (
        currentPktMins >
        windowEndMins
      ) {
        const expiredAttendance =
          await Attendance.findOneAndUpdate(
            {
              _id: attendance._id,

              $or: [
                {
                  checkIn: null,
                },
                {
                  checkIn: {
                    $exists: false,
                  },
                },
              ],

              status: {
                $in: [
                  'Pending',
                  'Absent',
                ],
              },
            },
            {
              $set: {
                status: 'Absent',
                markedAt: now,
              },
            },
            {
              new: true,
            }
          );

        // If update failed, re-check the latest record.
        // Another request/scheduler may have marked it Present.
        if (!expiredAttendance) {
          const latest =
            await Attendance.findById(
              attendance._id
            );

          if (
            latest?.checkIn ||
            latest?.status === 'Present'
          ) {
            return res.status(400).json({
              success: false,
              message:
                'Your attendance has already been marked today.',
            });
          }
        }

        if (
          expiredAttendance?.notificationId
        ) {
          await Notification.findByIdAndUpdate(
            expiredAttendance.notificationId,
            {
              $set: {
                isRead: true,
                readAt: now,
                'metadata.status':
                  'expired',
              },
            }
          );
        }

        return res.status(400).json({
          success: false,
          message:
            `The attendance window has expired at ${windowEndText} (PKT). You are marked absent.`,
        });
      }

      // ------------------------------------------------------
      // INSIDE WINDOW
      // ATOMIC CHECK-IN
      // ------------------------------------------------------

      const updateData = {
        checkIn: now,

        markedAt: now,

        status: 'Present',
      };

      if (
        req.body?.notes
      ) {
        updateData.notes =
          String(
            req.body.notes
          ).trim();
      }

      // IMPORTANT:
      // Atomic update prevents two simultaneous
      // check-in requests from both succeeding.
      const updatedAttendance =
        await Attendance.findOneAndUpdate(
          {
            _id: attendance._id,

            $or: [
              {
                checkIn: null,
              },
              {
                checkIn: {
                  $exists: false,
                },
              },
            ],

            status: {
              $in: [
                'Pending',
                'Absent',
              ],
            },
          },
          {
            $set: updateData,
          },
          {
            new: true,
          }
        );

      if (!updatedAttendance) {
        const latest =
          await Attendance.findById(
            attendance._id
          );

        if (
          latest?.checkIn ||
          latest?.status === 'Present'
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Your attendance has already been marked today.',
          });
        }

        return res.status(409).json({
          success: false,
          message:
            'Attendance was changed by another request. Please refresh and try again.',
        });
      }

      // ------------------------------------------------------
      // COMPLETE NOTIFICATION
      // ------------------------------------------------------

      if (
        updatedAttendance.notificationId
      ) {
        await Notification.findByIdAndUpdate(
          updatedAttendance.notificationId,
          {
            $set: {
              isRead: true,
              readAt: now,
              'metadata.status':
                'completed',
            },
          }
        );
      }

      // ------------------------------------------------------
      // RETURN POPULATED RESULT
      // ------------------------------------------------------

      const populated =
        await Attendance.findById(
          updatedAttendance._id
        )
          .populate(
            'user',
            'name email role avatar'
          )
          .lean();

      const result =
        safeAttendance(
          populated
        );

      return res.status(200).json({
        success: true,

        message:
          'Attendance marked successfully. You are present.',

        attendance:
          result,

        data:
          result,
      });
    } catch (error) {
      console.error(
        'markAttendance error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Server error while marking attendance.',
      });
    }
  };

// ============================================================
// USER: CHECK IN
// ============================================================

const checkIn =
  async (req, res) => {
    return markAttendance(
      req,
      res
    );
  };

// ============================================================
// USER: CHECK OUT
// ============================================================

const checkOut =
  async (req, res) => {
    try {
      const userId =
        req.user._id;

      const now =
        new Date();

      const {
        start,
        end,
      } = getDayRange(now);

      const attendance =
        await Attendance.findOne({
          user: userId,

          date: {
            $gte: start,
            $lte: end,
          },
        });

      if (!attendance) {
        return res.status(404).json({
          success: false,
          message:
            'No attendance record found for today.',
        });
      }

      if (
        attendance.status !==
        'Present'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'You must be present before checking out.',
        });
      }

      if (
        attendance.checkOut
      ) {
        return res.status(400).json({
          success: false,
          message:
            'You have already checked out today.',
        });
      }

      const updatedAttendance =
        await Attendance.findOneAndUpdate(
          {
            _id: attendance._id,

            status: 'Present',

            $or: [
              {
                checkOut: null,
              },
              {
                checkOut: {
                  $exists: false,
                },
              },
            ],
          },
          {
            $set: {
              checkOut: now,

              ...(req.body?.notes
                ? {
                    notes: String(
                      req.body.notes
                    ).trim(),
                  }
                : {}),
            },
          },
          {
            new: true,
          }
        );

      if (!updatedAttendance) {
        return res.status(400).json({
          success: false,
          message:
            'You have already checked out today.',
        });
      }

      const populated =
        await Attendance.findById(
          updatedAttendance._id
        )
          .populate(
            'user',
            'name email role avatar'
          )
          .lean();

      const result =
        safeAttendance(
          populated
        );

      return res.status(200).json({
        success: true,

        message:
          'Checked out successfully.',

        attendance:
          result,

        data:
          result,
      });
    } catch (error) {
      console.error(
        'checkOut error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Server error processing check-out.',
      });
    }
  };

// ============================================================
// USER: GET MY ATTENDANCE
// ============================================================

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
        status,
      } = req.query;

      const filter = {
        user: userId,
      };

      if (status) {
        if (
          !VALID_STATUSES.includes(
            status
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              `Invalid status filter. Allowed: ${VALID_STATUSES.join(', ')}.`,
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
          filter.date.$gte =
            new Date(
              `${startDate}T00:00:00+05:00`
            );
        }

        if (endDate) {
          filter.date.$lte =
            new Date(
              `${endDate}T23:59:59.999+05:00`
            );
        }
      }

      const pageNum =
        Math.max(
          1,
          parseInt(
            page,
            10
          ) || 1
        );

      const limitNum =
        Math.min(
          100,
          Math.max(
            1,
            parseInt(
              limit,
              10
            ) || 20
          )
        );

      const skip =
        (pageNum - 1) *
        limitNum;

      const [
        attendanceList,
        total,
      ] = await Promise.all([
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
            createdAt: -1,
          })
          .lean(),

        Attendance.countDocuments(
          filter
        ),
      ]);

      const formatted =
        attendanceList.map(
          safeAttendance
        );

      return res.status(200).json({
        success: true,

        attendance:
          formatted,

        data:
          formatted,

        pagination: {
          page: pageNum,
          limit: limitNum,
          total,

          pages:
            Math.ceil(
              total /
                limitNum
            ) || 0,
        },
      });
    } catch (error) {
      console.error(
        'getMyAttendance error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Server error retrieving attendance history.',
      });
    }
  };

// ============================================================
// USER: GET TODAY ATTENDANCE
// ============================================================

const getTodayAttendance =
  async (req, res) => {
    try {
      const userId =
        req.user._id;

      const now =
        new Date();

      const {
        start,
        end,
      } = getDayRange(now);

      let attendance =
        await Attendance.findOne({
          user: userId,

          date: {
            $gte: start,
            $lte: end,
          },
        })
          .populate(
            'user',
            'name email role avatar'
          )
          .lean();

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
          const createdAtt =
            await createTodayAttendanceForUser(
              user
            );

          if (createdAtt) {
            attendance =
              await Attendance.findById(
                createdAtt._id
              )
                .populate(
                  'user',
                  'name email role avatar'
                )
                .lean();
          }
        }
      }

      if (!attendance) {
        return res.status(200).json({
          success: true,
          attendance: null,
          data: null,
          message:
            'No attendance schedule found for today.',
        });
      }

      const result =
        safeAttendance(
          attendance
        );

      return res.status(200).json({
        success: true,
        attendance:
          result,
        data:
          result,
      });
    } catch (error) {
      console.error(
        'getTodayAttendance error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Server error retrieving today attendance.',
      });
    }
  };

// ============================================================
// ATTENDANCE SUMMARY
// ============================================================

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
          user,
        } = req.query;

        const targetUser =
          userId || user;

        if (
          targetUser &&
          isValidObjectId(
            targetUser
          )
        ) {
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
        total,
      ] = await Promise.all([
        Attendance.countDocuments({
          ...filter,
          status: 'Present',
        }),

        Attendance.countDocuments({
          ...filter,
          status: 'Absent',
        }),

        Attendance.countDocuments({
          ...filter,
          status: 'Late',
        }),

        Attendance.countDocuments({
          ...filter,
          status: 'Half Day',
        }),

        Attendance.countDocuments({
          ...filter,
          status: 'Leave',
        }),

        Attendance.countDocuments({
          ...filter,
          status: 'Pending',
        }),

        Attendance.countDocuments(
          filter
        ),
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
          total,
        },
      });
    } catch (error) {
      console.error(
        'getAttendanceSummary error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Server error retrieving attendance summary.',
      });
    }
  };

// ============================================================
// ADMIN / MANAGER: GET ATTENDANCE LIST
// ============================================================

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
        search,
      } = req.query;

      const filter = {};

      const targetUser =
        userId || user;

      if (
        targetUser &&
        isValidObjectId(
          targetUser
        )
      ) {
        filter.user =
          targetUser;
      } else if (
        search &&
        search.trim()
      ) {
        const searchRegex =
          escapeRegex(
            search.trim()
          );

        const matchingUsers =
          await User.find({
            $or: [
              {
                name: {
                  $regex:
                    searchRegex,
                  $options: 'i',
                },
              },

              {
                email: {
                  $regex:
                    searchRegex,
                  $options: 'i',
                },
              },
            ],
          })
            .select('_id')
            .lean();

        const userIds =
          matchingUsers.map(
            (u) => u._id
          );

        filter.user = {
          $in: userIds,
        };
      }

      if (
        status &&
        VALID_STATUSES.includes(
          status
        )
      ) {
        filter.status =
          status;
      }

      if (
        startDate ||
        endDate
      ) {
        filter.date = {};

        if (startDate) {
          filter.date.$gte =
            new Date(
              `${startDate}T00:00:00+05:00`
            );
        }

        if (endDate) {
          filter.date.$lte =
            new Date(
              `${endDate}T23:59:59.999+05:00`
            );
        }
      }

      const pageNum =
        Math.max(
          1,
          parseInt(
            page,
            10
          ) || 1
        );

      const limitNum =
        Math.min(
          100,
          Math.max(
            1,
            parseInt(
              limit,
              10
            ) || 20
          )
        );

      const skip =
        (pageNum - 1) *
        limitNum;

      const [
        attendanceList,
        total,
      ] = await Promise.all([
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
            createdAt: -1,
          })
          .lean(),

        Attendance.countDocuments(
          filter
        ),
      ]);

      const formatted =
        attendanceList.map(
          safeAttendance
        );

      return res.status(200).json({
        success: true,

        attendance:
          formatted,

        data:
          formatted,

        pagination: {
          page: pageNum,
          limit: limitNum,
          total,

          pages:
            Math.ceil(
              total /
                limitNum
            ) || 0,
        },
      });
    } catch (error) {
      console.error(
        'getAttendanceList error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Server error retrieving attendance records.',
      });
    }
  };

// ============================================================
// GET SINGLE ATTENDANCE
// ============================================================

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
          message:
            'Invalid attendance ID.',
        });
      }

      const attendance =
        await Attendance.findById(
          req.params.id
        )
          .populate(
            'user',
            'name email role avatar'
          )
          .lean();

      if (!attendance) {
        return res.status(404).json({
          success: false,
          message:
            'Attendance record not found.',
        });
      }

      if (
        req.user.role ===
          'user' &&
        attendance.user &&
        attendance.user._id.toString() !==
          req.user._id.toString()
      ) {
        return res.status(403).json({
          success: false,
          message:
            'Access denied. You can only view your own attendance records.',
        });
      }

      const result =
        safeAttendance(
          attendance
        );

      return res.status(200).json({
        success: true,

        attendance:
          result,

        data:
          result,
      });
    } catch (error) {
      console.error(
        'getAttendanceById error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Server error retrieving attendance record.',
      });
    }
  };

// ============================================================
// ADMIN: CREATE MANUAL ATTENDANCE
// ============================================================

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
        windowEnd,
      } = req.body || {};

      const targetUserId =
        userId || user;

      if (
        !targetUserId ||
        !isValidObjectId(
          targetUserId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Valid userId is required.',
        });
      }

      const userExists =
        await User.findById(
          targetUserId
        )
          .select('_id')
          .lean();

      if (!userExists) {
        return res.status(404).json({
          success: false,
          message:
            'User not found.',
        });
      }

      if (!date) {
        return res.status(400).json({
          success: false,
          message:
            'Date is required.',
        });
      }

      const recordDate =
        new Date(date);

      if (
        Number.isNaN(
          recordDate.getTime()
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid attendance date.',
        });
      }

      const {
        start,
        end,
      } = getDayRange(
        recordDate
      );

      const existing =
        await Attendance.findOne({
          user: targetUserId,

          date: {
            $gte: start,
            $lte: end,
          },
        })
          .select('_id')
          .lean();

      if (existing) {
        return res.status(400).json({
          success: false,
          message:
            'An attendance record for this user on this date already exists.',
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

        date:
          normalizeDate(
            recordDate
          ),

        checkIn:
          checkIn
            ? new Date(checkIn)
            : null,

        checkOut:
          checkOut
            ? new Date(checkOut)
            : null,

        status:
          assignedStatus,

        markedAt:
          assignedStatus ===
          'Pending'
            ? null
            : new Date(),

        notes:
          notes
            ? String(
                notes
              ).trim()
            : '',

        scheduledTime:
          scheduledTime
            ? new Date(
                scheduledTime
              )
            : null,

        windowStart:
          windowStart
            ? new Date(
                windowStart
              )
            : null,

        windowEnd:
          windowEnd
            ? new Date(
                windowEnd
              )
            : null,
      };

      const attendance =
        await Attendance.create(
          attendanceData
        );

      const populated =
        await Attendance.findById(
          attendance._id
        )
          .populate(
            'user',
            'name email role avatar'
          )
          .lean();

      const result =
        safeAttendance(
          populated
        );

      return res.status(201).json({
        success: true,

        message:
          'Attendance record created successfully.',

        attendance:
          result,

        data:
          result,
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
          message:
            'An attendance record for this user on this date already exists.',
        });
      }

      return res.status(500).json({
        success: false,
        message:
          'Server error creating manual attendance record.',
      });
    }
  };

// ============================================================
// ADMIN: UPDATE ATTENDANCE
// ============================================================

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
          message:
            'Invalid attendance ID.',
        });
      }

      const attendance =
        await Attendance.findById(
          req.params.id
        );

      if (!attendance) {
        return res.status(404).json({
          success: false,
          message:
            'Attendance record not found.',
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
        windowEnd,
      } = req.body || {};

      if (
        status !== undefined
      ) {
        if (
          !VALID_STATUSES.includes(
            status
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}.`,
          });
        }

        attendance.status =
          status;

        attendance.markedAt =
          status === 'Pending'
            ? null
            : new Date();

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
        const parsedDate =
          new Date(date);

        if (
          Number.isNaN(
            parsedDate.getTime()
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Invalid attendance date.',
          });
        }

        attendance.date =
          normalizeDate(
            parsedDate
          );
      }

      if (
        checkIn !== undefined
      ) {
        attendance.checkIn =
          checkIn
            ? new Date(checkIn)
            : null;
      }

      if (
        checkOut !== undefined
      ) {
        attendance.checkOut =
          checkOut
            ? new Date(checkOut)
            : null;
      }

      if (
        scheduledTime !==
        undefined
      ) {
        attendance.scheduledTime =
          scheduledTime
            ? new Date(
                scheduledTime
              )
            : null;
      }

      if (
        windowStart !==
        undefined
      ) {
        attendance.windowStart =
          windowStart
            ? new Date(
                windowStart
              )
            : null;
      }

      if (
        windowEnd !==
        undefined
      ) {
        attendance.windowEnd =
          windowEnd
            ? new Date(
                windowEnd
              )
            : null;
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
          'Leave',
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
              'metadata.status':
                'completed',
            },
          }
        );
      }

      const populated =
        await Attendance.findById(
          attendance._id
        )
          .populate(
            'user',
            'name email role avatar'
          )
          .lean();

      const result =
        safeAttendance(
          populated
        );

      return res.status(200).json({
        success: true,

        message:
          'Attendance updated successfully.',

        attendance:
          result,

        data:
          result,
      });
    } catch (error) {
      console.error(
        'updateAttendance error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Server error updating attendance record.',
      });
    }
  };

// ============================================================
// ADMIN: DELETE ATTENDANCE
// ============================================================

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
          message:
            'Invalid attendance ID.',
        });
      }

      const attendance =
        await Attendance.findById(
          req.params.id
        )
          .select(
            'notificationId'
          )
          .lean();

      if (!attendance) {
        return res.status(404).json({
          success: false,
          message:
            'Attendance record not found.',
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
        message:
          'Attendance deleted successfully.',
      });
    } catch (error) {
      console.error(
        'deleteAttendance error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Server error deleting attendance record.',
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
  processAttendanceNotifications,
};