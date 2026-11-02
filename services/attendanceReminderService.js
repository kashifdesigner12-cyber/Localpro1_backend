import cron from "node-cron";
import Attendance from "../models/Attendance.js";
import User from "../models/User.js";
import WorkspaceSettings from "../models/WorkspaceSettings.js";
import { createNotification } from "./notificationService.js";

let reminderJob = null;
let isRunning = false;

const getTodayDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export const sendDailyAttendanceReminders = async ({
  dryRun = process.env.ATTENDANCE_REMINDER_DRY_RUN === "true",
} = {}) => {
  if (isRunning) {
    console.log("Attendance reminder job is already running.");
    return;
  }

  isRunning = true;

  try {
    const settings = await WorkspaceSettings.findOne()
      .select("attendanceReminders")
      .lean();

    if (settings?.attendanceReminders === false) {
      console.log("Attendance reminders are disabled.");
      return;
    }

    const date = getTodayDate();

    const users = await User.find({
      status: "active",
      role: { $in: ["user", "manager"] },
      "settings.attendanceNotifications": { $ne: false },
    })
      .select("_id name username")
      .lean();

    if (users.length === 0) {
      console.log(`No eligible users for attendance reminders on ${date}.`);
      return;
    }

    const userIds = users.map((user) => user._id);

    const attendanceRecords = await Attendance.find({
      user: { $in: userIds },
      date,
    }).lean();

    const attendanceByUser = new Map(
      attendanceRecords.map((record) => [
        String(record.user),
        record,
      ])
    );

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    // Process reminders concurrently for high performance
    const reminderPromises = users.map(async (user) => {
      const userLabel = user.username || user.name || String(user._id);
      const existing = attendanceByUser.get(String(user._id));

      if (
        existing?.checkIn ||
        existing?.reminderSentAt ||
        existing?.status === "leave"
      ) {
        skipped++;
        return;
      }

      if (dryRun) {
        console.log(`[DRY RUN] Would remind ${userLabel}`);
        sent++;
        return;
      }

      const reservationTime = new Date();
      let attendance;
      let createdNewRecord = false;

      try {
        if (existing) {
          attendance = await Attendance.findOneAndUpdate(
            {
              _id: existing._id,
              checkIn: null,
              reminderSentAt: null,
              status: { $ne: "leave" },
            },
            {
              $set: {
                reminderSentAt: reservationTime,
                status: "absent",
              },
            },
            {
              new: true,
              runValidators: true,
            }
          ).lean();

          if (!attendance) {
            skipped++;
            return;
          }
        } else {
          try {
            const newAtt = await Attendance.create({
              user: user._id,
              date,
              status: "absent",
              reminderSentAt: reservationTime,
            });
            attendance = newAtt.toObject();
            createdNewRecord = true;
          } catch (error) {
            if (error.code === 11000) {
              skipped++;
              return;
            }
            throw error;
          }
        }

        await createNotification({
          recipient: user._id,
          title: "Attendance Reminder",
          message:
            "You have not checked in today. Please check in when you arrive at the office.",
          type: "attendance",
          link: "/attendance",
        });

        sent++;
      } catch (error) {
        failed++;

        if (attendance) {
          try {
            if (createdNewRecord) {
              await Attendance.deleteOne({
                _id: attendance._id,
                reminderSentAt: reservationTime,
                checkIn: null,
              });
            } else {
              await Attendance.updateOne(
                {
                  _id: attendance._id,
                  reminderSentAt: reservationTime,
                  checkIn: null,
                },
                {
                  $set: {
                    status: existing.status,
                  },
                  $unset: {
                    reminderSentAt: 1,
                  },
                }
              );
            }
          } catch (rollbackError) {
            console.error(
              `Attendance rollback failed for ${userLabel}:`,
              rollbackError.message
            );
          }
        }

        console.error(
          `Attendance reminder failed for ${userLabel}:`,
          error.message
        );
      }
    });

    await Promise.allSettled(reminderPromises);

    console.log(
      `[${dryRun ? "DRY RUN" : "LIVE"}] Attendance reminders for ${date}. ` +
        `Processed: ${sent}, Skipped: ${skipped}, Failed: ${failed}`
    );
  } finally {
    isRunning = false;
  }
};

export const startAttendanceReminderService = () => {
  if (reminderJob) {
    return reminderJob;
  }

  reminderJob = cron.schedule(
    "0 10 * * *",
    async () => {
      try {
        await sendDailyAttendanceReminders();
      } catch (error) {
        console.error(
          "Attendance reminder scheduler error:",
          error.message
        );
      }
    },
    {
      timezone: "Asia/Karachi",
    }
  );

  console.log(
    "Daily attendance reminder scheduled for 10:00 AM Pakistan time."
  );

  return reminderJob;
};

export const stopAttendanceReminderService = () => {
  if (!reminderJob) {
    return;
  }

  reminderJob.stop();
  reminderJob = null;
};