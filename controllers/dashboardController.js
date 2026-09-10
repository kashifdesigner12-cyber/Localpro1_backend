const User = require('../models/User');
const Task = require('../models/Task');
const LeaveRequest = require('../models/LeaveRequest');
const SignupRequest = require('../models/SignupRequest');
const Notification = require('../models/Notification');

// Optional models
const loadOptionalModel = (modelPath) => {
  try {
    return require(modelPath);
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') {
      console.error(`Error loading optional model ${modelPath}:`, error);
    }

    return null;
  }
};

const Attendance = loadOptionalModel('../models/Attendance');
const Conversation = loadOptionalModel('../models/Conversation');
const Message = loadOptionalModel('../models/Message');
const Event = loadOptionalModel('../models/Event');
const Call = loadOptionalModel('../models/Call');
const Email = loadOptionalModel('../models/Email');
const Contact = loadOptionalModel('../models/Contact');
const Campaign = loadOptionalModel('../models/Campaign');
const Agent = loadOptionalModel('../models/Agent');

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────

const getTodayRange = (date = new Date()) => {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);

  return {
    start,
    end,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dashboard/stats
// Admin / Manager
// ─────────────────────────────────────────────────────────────────────────────

const getStats = async (req, res) => {
  try {
    const now = new Date();

    const {
      start: todayStart,
      end: todayEnd,
    } = getTodayRange(now);

    const [
      // Users
      totalUsers,
      activeUsers,
      inactiveUsers,
      blockedUsers,
      pendingUsers,

      // Tasks
      totalTasks,
      pendingTasks,
      inProgressTasks,
      completedTasks,
      cancelledTasks,
      overdueTasks,
      urgentTasks,

      // Leave Requests
      totalLeaveRequests,
      pendingLeaveRequests,
      approvedLeaveRequests,
      rejectedLeaveRequests,

      // Signup Requests
      pendingSignupRequests,

      // Attendance
      todayPresent,
      todayAbsent,
      todayLate,
      todayHalfDay,
      todayLeave,
      totalAttendanceRecords,

      // Conversations
      totalConversations,

      // Events
      totalEvents,
      upcomingEvents,

      // Communication / CRM
      totalCalls,
      totalEmails,
      totalCampaigns,
      totalAgents,
    ] = await Promise.all([
      // ───────────────────────────────────────────────────────────────────────
      // USERS
      // ───────────────────────────────────────────────────────────────────────

      User.countDocuments(),

      User.countDocuments({
        status: 'Active',
      }),

      User.countDocuments({
        status: {
          $in: ['Inactive', 'Blocked'],
        },
      }),

      User.countDocuments({
        status: 'Blocked',
      }),

      User.countDocuments({
        status: 'Pending',
      }),

      // ───────────────────────────────────────────────────────────────────────
      // TASKS
      // ───────────────────────────────────────────────────────────────────────

      Task.countDocuments(),

      Task.countDocuments({
        status: 'Pending',
      }),

      Task.countDocuments({
        status: 'In Progress',
      }),

      Task.countDocuments({
        status: 'Completed',
      }),

      Task.countDocuments({
        status: 'Cancelled',
      }),

      Task.countDocuments({
        dueDate: {
          $lt: now,
          $ne: null,
        },
        status: {
          $nin: ['Completed', 'Cancelled'],
        },
      }),

      Task.countDocuments({
        priority: 'Urgent',
      }),

      // ───────────────────────────────────────────────────────────────────────
      // LEAVE REQUESTS
      // ───────────────────────────────────────────────────────────────────────

      LeaveRequest.countDocuments(),

      LeaveRequest.countDocuments({
        status: 'Pending',
      }),

      LeaveRequest.countDocuments({
        status: 'Approved',
      }),

      LeaveRequest.countDocuments({
        status: 'Rejected',
      }),

      // ───────────────────────────────────────────────────────────────────────
      // SIGNUP REQUESTS
      // ───────────────────────────────────────────────────────────────────────

      SignupRequest.countDocuments({
        status: 'Pending',
      }),

      // ───────────────────────────────────────────────────────────────────────
      // ATTENDANCE
      // ───────────────────────────────────────────────────────────────────────

      Attendance
        ? Attendance.countDocuments({
            date: {
              $gte: todayStart,
              $lte: todayEnd,
            },
            status: 'Present',
          })
        : 0,

      Attendance
        ? Attendance.countDocuments({
            date: {
              $gte: todayStart,
              $lte: todayEnd,
            },
            status: 'Absent',
          })
        : 0,

      Attendance
        ? Attendance.countDocuments({
            date: {
              $gte: todayStart,
              $lte: todayEnd,
            },
            status: 'Late',
          })
        : 0,

      Attendance
        ? Attendance.countDocuments({
            date: {
              $gte: todayStart,
              $lte: todayEnd,
            },
            status: 'Half Day',
          })
        : 0,

      Attendance
        ? Attendance.countDocuments({
            date: {
              $gte: todayStart,
              $lte: todayEnd,
            },
            status: 'Leave',
          })
        : 0,

      Attendance
        ? Attendance.countDocuments()
        : 0,

      // ───────────────────────────────────────────────────────────────────────
      // CONVERSATIONS
      // ───────────────────────────────────────────────────────────────────────

      Conversation
        ? Conversation.countDocuments()
        : 0,

      // ───────────────────────────────────────────────────────────────────────
      // EVENTS
      // ───────────────────────────────────────────────────────────────────────

      Event
        ? Event.countDocuments()
        : 0,

      Event
        ? Event.countDocuments({
            startDate: {
              $gte: now,
            },
          })
        : 0,

      // ───────────────────────────────────────────────────────────────────────
      // CALLS
      // ───────────────────────────────────────────────────────────────────────

      Call
        ? Call.countDocuments()
        : 0,

      // ───────────────────────────────────────────────────────────────────────
      // EMAILS
      // ───────────────────────────────────────────────────────────────────────

      Email
        ? Email.countDocuments()
        : 0,

      // ───────────────────────────────────────────────────────────────────────
      // CAMPAIGNS
      // ───────────────────────────────────────────────────────────────────────

      Campaign
        ? Campaign.countDocuments()
        : 0,

      // ───────────────────────────────────────────────────────────────────────
      // AI AGENTS
      // ───────────────────────────────────────────────────────────────────────

      Agent
        ? Agent.countDocuments()
        : 0,
    ]);

    // ─────────────────────────────────────────────────────────────────────────
    // OPTIONAL / LEGACY CRM METRICS
    // ─────────────────────────────────────────────────────────────────────────

    let totalLeads = 0;
    let newLeads = 0;

    if (Contact) {
      try {
        [totalLeads, newLeads] = await Promise.all([
          Contact.countDocuments(),

          Contact.countDocuments({
            createdAt: {
              $gte: new Date(
                Date.now() - 30 * 24 * 60 * 60 * 1000
              ),
            },
          }),
        ]);
      } catch (error) {
        console.error(
          'Contact stats error:',
          error.message
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // APPOINTMENTS
    // ─────────────────────────────────────────────────────────────────────────

    let appointments = 0;

    if (Event) {
      try {
        appointments = await Event.countDocuments({
          startDate: {
            $gte: now,
          },
        });
      } catch (error) {
        console.error(
          'Appointment stats error:',
          error.message
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RESPONSE
    // ─────────────────────────────────────────────────────────────────────────

    return res.status(200).json({
      success: true,

      stats: {
        // Users
        totalUsers,
        activeUsers,
        inactiveUsers,
        blockedUsers,
        pendingUsers,

        // Tasks
        totalTasks,
        pendingTasks,
        inProgressTasks,
        completedTasks,
        cancelledTasks,
        overdueTasks,
        urgentTasks,

        // Leave Requests
        totalLeaveRequests,
        pendingLeaveRequests,
        approvedLeaveRequests,
        rejectedLeaveRequests,

        // Signup Requests
        pendingSignupRequests,

        // Attendance
        todayAttendance: {
          present: todayPresent,
          absent: todayAbsent,
          late: todayLate,
          halfDay: todayHalfDay,
          leave: todayLeave,
          totalRecords: totalAttendanceRecords,
        },

        // Conversations / Events
        totalConversations,
        totalEvents,
        upcomingEvents,

        // Communication / CRM
        totalCalls,
        totalEmails,
        totalCampaigns,
        totalAgents,

        // Leads
        totalLeads,
        newLeads,

        // Appointments
        appointments,

        // Existing dashboard metrics
        revenue: 0,
        responseRate: 85,
      },
    });
  } catch (error) {
    console.error(
      'getStats error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving dashboard stats.',
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dashboard/summary
// Authenticated User / Admin
// ─────────────────────────────────────────────────────────────────────────────

const getSummary = async (req, res) => {
  try {
    const userId = req.user._id;

    const now = new Date();

    const {
      start: todayStart,
      end: todayEnd,
    } = getTodayRange(now);

    const sevenDaysAgo = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000
    );

    const [
      // Tasks
      myPendingTasks,
      myCompletedTasks,
      myTotalTasks,

      // Events
      myUpcomingEvents,

      // Notifications
      myUnreadNotifications,

      // Messages
      myUnreadMessages,

      // Attendance
      myTodayAttendance,

      // Conversations
      totalConversations,

      // Calls
      missedCalls,

      // Emails
      totalEmails,

      // Contacts
      newContacts,
    ] = await Promise.all([
      Task.countDocuments({
        assignedTo: userId,
        status: 'Pending',
      }),

      Task.countDocuments({
        assignedTo: userId,
        status: 'Completed',
      }),

      Task.countDocuments({
        assignedTo: userId,
      }),

      Event
        ? Event.countDocuments({
            $or: [
              {
                assignedTo: userId,
              },
              {
                participants: userId,
              },
              {
                createdBy: userId,
              },
            ],
            startDate: {
              $gte: now,
            },
          })
        : 0,

      Notification.countDocuments({
        user: userId,
        isRead: false,
      }),

      Message
        ? Message.countDocuments({
            $or: [
              {
                recipient: userId,
              },
              {
                user: userId,
              },
            ],
            isRead: false,
          })
        : 0,

      Attendance
        ? Attendance.findOne({
            user: userId,
            date: {
              $gte: todayStart,
              $lte: todayEnd,
            },
          })
            .select('status checkIn checkOut')
            .lean()
        : null,

      Conversation
        ? Conversation.countDocuments({
            $or: [
              {
                participants: userId,
              },
              {
                user: userId,
              },
            ],
          })
        : 0,

      Call
        ? Call.countDocuments({
            $or: [
              {
                user: userId,
              },
              {
                recipient: userId,
              },
            ],
            status: 'missed',
          })
        : 0,

      Email
        ? Email.countDocuments({
            user: userId,
          })
        : 0,

      Contact
        ? Contact.countDocuments({
            $or: [
              {
                user: userId,
              },
              {
                createdBy: userId,
              },
            ],
            createdAt: {
              $gte: sevenDaysAgo,
            },
          })
        : 0,
    ]);

    // ─────────────────────────────────────────────────────────────────────────
    // RESPONSE
    // ─────────────────────────────────────────────────────────────────────────

    return res.status(200).json({
      success: true,

      data: {
        stats: {
          // Tasks
          myPendingTasks,
          myCompletedTasks,
          myTotalTasks,

          // Events
          myUpcomingEvents,

          // Notifications
          myUnreadNotifications,

          // Messages
          myUnreadMessages,

          // Conversations
          totalConversations,
          unreadMessages: myUnreadMessages,

          // Calls
          missedCalls,

          // Emails
          totalEmails,

          // Contacts
          newContacts,

          // Attendance
          todayAttendance: myTodayAttendance
            ? {
                status: myTodayAttendance.status,
                checkIn: myTodayAttendance.checkIn,
                checkOut: myTodayAttendance.checkOut,
              }
            : null,

          // Existing metric
          responseRate: 85,
        },

        recentActivity: [],

        chartData: [],
      },
    });
  } catch (error) {
    console.error(
      'getSummary error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving summary.',
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dashboard/activity
// Admin / Manager
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dashboard/activity
// Admin / Manager
// ─────────────────────────────────────────────────────────────────────────────

const getActivity = async (req, res) => {
  try {
    const startTime = Date.now();

    // Use _id sorting because MongoDB always has an _id index.
    // This avoids expensive collection sorting when createdAt
    // does not have a suitable index.
    const [recentTasks, recentLeaves, recentEvents] = await Promise.all([
      Task.find({})
        .select(
          'title status priority dueDate completedAt createdAt createdBy assignedTo'
        )
        .sort({ _id: -1 })
        .limit(10)
        .populate({
          path: 'createdBy',
          select: 'name email',
          options: { lean: true },
        })
        .populate({
          path: 'assignedTo',
          select: 'name email',
          options: { lean: true },
        })
        .lean(),

      LeaveRequest.find({})
        .select(
          'user leaveType startDate endDate status reviewedBy reviewedAt createdAt'
        )
        .sort({ _id: -1 })
        .limit(5)
        .populate({
          path: 'user',
          select: 'name email',
          options: { lean: true },
        })
        .populate({
          path: 'reviewedBy',
          select: 'name email',
          options: { lean: true },
        })
        .lean(),

      Event
        ? Event.find({})
            .select(
              'title startDate endDate allDay location type eventType status createdBy assignedTo createdAt'
            )
            .sort({ _id: -1 })
            .limit(5)
            .populate({
              path: 'createdBy',
              select: 'name email',
              options: { lean: true },
            })
            .populate({
              path: 'assignedTo',
              select: 'name email',
              options: { lean: true },
            })
            .lean()
        : [],
    ]);

    const executionTime = Date.now() - startTime;

    console.log(
      `[Dashboard Activity] ${executionTime}ms | ` +
      `Tasks: ${recentTasks.length} | ` +
      `Leaves: ${recentLeaves.length} | ` +
      `Events: ${recentEvents.length}`
    );

    return res.status(200).json({
      success: true,
      recentActivity: {
        tasks: recentTasks,
        leaveRequests: recentLeaves,
        events: recentEvents,
      },
    });
  } catch (error) {
    console.error('getActivity error:', error);

    return res.status(500).json({
      success: false,
      message: 'Server error retrieving activity.',
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dashboard/chart-data
// Admin / Manager
// ─────────────────────────────────────────────────────────────────────────────

const getChartData = async (req, res) => {
  try {
    const [
      tasksByStatus,
      tasksByPriority,
      usersByRole,
      leaveSummary,
      attendanceSummary,
    ] = await Promise.all([
      // Tasks by status
      Task.aggregate([
        {
          $group: {
            _id: '$status',
            count: {
              $sum: 1,
            },
          },
        },
      ]),

      // Tasks by priority
      Task.aggregate([
        {
          $group: {
            _id: '$priority',
            count: {
              $sum: 1,
            },
          },
        },
      ]),

      // Users by role
      User.aggregate([
        {
          $group: {
            _id: '$role',
            count: {
              $sum: 1,
            },
          },
        },
      ]),

      // Leave summary
      LeaveRequest.aggregate([
        {
          $group: {
            _id: '$status',
            count: {
              $sum: 1,
            },
          },
        },
      ]),

      // Attendance summary
      Attendance
        ? Attendance.aggregate([
            {
              $group: {
                _id: '$status',
                count: {
                  $sum: 1,
                },
              },
            },
          ])
        : [],
    ]);

    return res.status(200).json({
      success: true,

      chartData: {
        tasksByStatus,
        tasksByPriority,
        usersByRole,
        leaveSummary,
        attendanceSummary,
      },
    });
  } catch (error) {
    console.error(
      'getChartData error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving chart data.',
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  getStats,
  getSummary,
  getActivity,
  getChartData,
};