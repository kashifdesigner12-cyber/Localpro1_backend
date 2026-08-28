const cron = require('node-cron');

const {
  processAttendanceNotifications
} = require('../controllers/attendanceController');

let schedulerRunning = false;

const startAttendanceScheduler = () => {
  if (schedulerRunning) {
    console.log('[Attendance Scheduler] Already running.');
    return;
  }

  schedulerRunning = true;

  console.log(
    '[Attendance Scheduler] Started. Running every minute.'
  );

  cron.schedule('* * * * *', async () => {
    try {
      console.log(
        '[Attendance Scheduler] Processing attendance...'
      );

      const result =
        await processAttendanceNotifications();

      console.log(
        '[Attendance Scheduler] Result:',
        result
      );
    } catch (error) {
      console.error(
        '[Attendance Scheduler] Error:',
        error
      );
    }
  });
};

module.exports = {
  startAttendanceScheduler
};