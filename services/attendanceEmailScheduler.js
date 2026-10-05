const cron = require("node-cron");

const User = require("../models/User");
const {
  sendAttendanceReminderEmail,
} = require("../utils/sendEmail");

let schedulerRunning = false;
let attendanceEmailJob = null;

/**
 * Send the daily attendance email to all active users.
 *
 * Runs every day at 10:00 AM Pakistan time.
 */
const sendDailyAttendanceEmails = async () => {
  try {
    const users = await User.find({
      status: "Active",
      isActive: true,
      isDeleted: false,
      email: {
        $exists: true,
        $ne: "",
      },
    })
      .select("_id name email")
      .lean();

    if (!users.length) {
      console.log(
        "[Attendance Email] No active users with email addresses found."
      );

      return {
        success: true,
        sent: 0,
        failed: 0,
        total: 0,
      };
    }

    let sent = 0;
    let failed = 0;

    for (const user of users) {
      try {
        await sendAttendanceReminderEmail(
          user.email,
          user.name
        );

        sent++;
      } catch (error) {
        failed++;

        console.error(
          `[Attendance Email] Failed for ${user.email}:`,
          error.message
        );
      }
    }

    const result = {
      success: failed === 0,
      sent,
      failed,
      total: users.length,
    };

    console.log(
      "[Attendance Email] Daily email result:",
      result
    );

    return result;
  } catch (error) {
    console.error(
      "[Attendance Email] Daily email processing error:",
      error
    );

    throw error;
  }
};

/**
 * Start the daily attendance email scheduler.
 *
 * 0 10 * * *
 * = Every day at 10:00 AM.
 *
 * Asia/Karachi ensures Pakistan time.
 */
const startAttendanceEmailScheduler = () => {
  if (schedulerRunning) {
    console.log(
      "[Attendance Email] Scheduler already running."
    );

    return;
  }

  attendanceEmailJob = cron.schedule(
    "0 10 * * *",
    async () => {
      console.log(
        "[Attendance Email] 10:00 AM Pakistan time reached. Sending attendance emails..."
      );

      try {
        await sendDailyAttendanceEmails();
      } catch (error) {
        console.error(
          "[Attendance Email] Scheduler error:",
          error
        );
      }
    },
    {
      timezone: "Asia/Karachi",
    }
  );

  schedulerRunning = true;

  console.log(
    "[Attendance Email] Scheduler started. Daily at 10:00 AM Pakistan time."
  );
};

/**
 * Stop the attendance email scheduler.
 *
 * Used during graceful server shutdown.
 */
const stopAttendanceEmailScheduler = () => {
  if (!attendanceEmailJob) {
    schedulerRunning = false;
    return;
  }

  try {
    attendanceEmailJob.stop();
  } catch (error) {
    console.error(
      "[Attendance Email] Failed to stop scheduler:",
      error
    );
  }

  attendanceEmailJob = null;
  schedulerRunning = false;

  console.log(
    "[Attendance Email] Scheduler stopped."
  );
};

module.exports = {
  startAttendanceEmailScheduler,
  stopAttendanceEmailScheduler,
  sendDailyAttendanceEmails,
};