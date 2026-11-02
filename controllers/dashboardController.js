const User = require('../models/User');
const Task = require('../models/Task');
const Attendance = require('../models/Attendance');

const getDashboardStats = async (req, res) => {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        // Parallel execution using Promise.all for super fast response
        const [totalUsers, presentToday, totalTasks, pendingTasks] = await Promise.all([
            User.countDocuments({}).lean(),
            Attendance.countDocuments({
                date: { $gte: todayStart, $lte: todayEnd },
                status: 'Present'
            }).lean(),
            Task.countDocuments({}).lean(),
            Task.countDocuments({ status: 'pending' }).lean()
        ]);

        res.status(200).json({
            success: true,
            data: {
                totalUsers,
                presentToday,
                totalTasks,
                pendingTasks
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getDashboardStats };