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

// Helper to get today's UTC date range
const getTodayRange = (date = new Date()) => {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);

  return {
    start,
    end
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
      end: todayEnd
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

      // Conversations / Events
      totalConversations,
      totalEvents,
      upcomingEvents,

      // Communication / CRM
      totalCalls,
      totalEmails,
      totalCampaigns,
      totalAgents
    ] = await Promise.all([
      // ───────────────────────────────────────────────────────────────────────
      // USERS
      // ───────────────────────────────────────────────────────────────────────

      User.countDocuments(),

      User.countDocuments({
        status: 'Active'
      }),

      User.countDocuments({
        status: {
          $in: ['Inactive', 'Blocked']
        }
      }),

      User.countDocuments({
        status: 'Blocked'
      }),

      User.countDocuments({
        status: 'Pending'
      }),

      // ───────────────────────────────────────────────────────────────────────
      // TASKS
      // ───────────────────────────────────────────────────────────────────────

      Task.countDocuments(),

      Task.countDocuments({
        status: 'Pending'
      }),

      Task.countDocuments({
        status: 'In Progress'
      }),

      Task.countDocuments({
        status: 'Completed'
      }),

      Task.countDocuments({
        status: 'Cancelled'
      }),

      Task.countDocuments({
        dueDate: {
          $lt: now,
          $ne: null
        },
        status: {
          $nin: ['Completed', 'Cancelled']
        }
      }),

      Task.countDocuments({
        priority: 'Urgent'
      }),

      // ───────────────────────────────────────────────────────────────────────
      // LEAVE REQUESTS
      // ───────────────────────────────────────────────────────────────────────

      LeaveRequest.countDocuments(),

      LeaveRequest.countDocuments({
        status: 'Pending'
      }),

      LeaveRequest.countDocuments({
        status: 'Approved'
      }),

      LeaveRequest.countDocuments({
        status: 'Rejected'
      }),

      // ───────────────────────────────────────────────────────────────────────
      // SIGNUP REQUESTS
      // ───────────────────────────────────────────────────────────────────────

      SignupRequest.countDocuments({
        status: 'Pending'
      }),

      // ───────────────────────────────────────────────────────────────────────
      // ATTENDANCE
      // ───────────────────────────────────────────────────────────────────────

      Attendance
        ? Attendance.countDocuments({
            date: {
              $gte: todayStart,
              $lte: todayEnd
            },
            status: 'Present'
          })
        : 0,

      Attendance
        ? Attendance.countDocuments({
            date: {
              $gte: todayStart,
              $lte: todayEnd
            },
            status: 'Absent'
          })
        : 0,

      Attendance
        ? Attendance.countDocuments({
            date: {
              $gte: todayStart,
              $lte: todayEnd
            },
            status: 'Late'
          })
        : 0,

      Attendance
        ? Attendance.countDocuments({
            date: {
              $gte: todayStart,
              $lte: todayEnd
            },
            status: 'Half Day'
          })
        : 0,

      Attendance
        ? Attendance.countDocuments({
            date: {
              $gte: todayStart,
              $lte: todayEnd
            },
            status: 'Leave'
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
              $gte: now
            }
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
        : 0
    ]);

    // ─────────────────────────────────────────────────────────────────────────
    // OPTIONAL / LEGACY CRM METRICS
    // ─────────────────────────────────────────────────────────────────────────

    let totalLeads = 0;
    let newLeads = 0;

    if (Contact) {
      try {
        totalLeads = await Contact.countDocuments();

        newLeads = await Contact.countDocuments({
          createdAt: {
            $gte: new Date(
              Date.now() - 30 * 24 * 60 * 60 * 1000
            )
          }
        });
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
            $gte: now
          }
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
          totalRecords: totalAttendanceRecords
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
        responseRate: 85
      }
    });
  } catch (error) {
    console.error(
      'getStats error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving dashboard stats.'
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
      end: todayEnd
    } = getTodayRange(now);

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
      myTodayAttendance
    ] = await Promise.all([
      // Pending tasks assigned to current user
      Task.countDocuments({
        assignedTo: userId,
        status: 'Pending'
      }),

      // Completed tasks assigned to current user
      Task.countDocuments({
        assignedTo: userId,
        status: 'Completed'
      }),

      // Total tasks assigned to current user
      Task.countDocuments({
        assignedTo: userId
      }),

      // Upcoming events
      Event
        ? Event.countDocuments({
            $or: [
              {
                assignedTo: userId
              },
              {
                participants: userId
              },
              {
                createdBy: userId
              }
            ],
            startDate: {
              $gte: now
            }
          })
        : 0,

      // Unread notifications
      Notification.countDocuments({
        user: userId,
        isRead: false
      }),

      // Unread messages
      Message
        ? Message.countDocuments({
            $or: [
              {
                recipient: userId
              },
              {
                user: userId
              }
            ],
            isRead: false
          })
        : 0,

      // Today's attendance
      Attendance
        ? Attendance.findOne({
            user: userId,
            date: {
              $gte: todayStart,
              $lte: todayEnd
            }
          })
        : null
    ]);

    // ─────────────────────────────────────────────────────────────────────────
    // ADDITIONAL SUMMARY METRICS
    // ─────────────────────────────────────────────────────────────────────────

    let totalConversations = 0;
    let missedCalls = 0;
    let totalEmails = 0;
    let newContacts = 0;

    // ─────────────────────────────────────────────────────────────────────────
    // CONVERSATIONS
    // ─────────────────────────────────────────────────────────────────────────

    if (Conversation) {
      try {
        totalConversations =
          await Conversation.countDocuments({
            $or: [
              {
                participants: userId
              },
              {
                user: userId
              }
            ]
          });
      } catch (error) {
        console.error(
          'Conversation summary error:',
          error.message
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MISSED CALLS
    // ─────────────────────────────────────────────────────────────────────────

    if (Call) {
      try {
        missedCalls =
          await Call.countDocuments({
            $or: [
              {
                user: userId
              },
              {
                recipient: userId
              }
            ],
            status: 'missed'
          });
      } catch (error) {
        console.error(
          'Call summary error:',
          error.message
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EMAILS
    // ─────────────────────────────────────────────────────────────────────────

    if (Email) {
      try {
        totalEmails =
          await Email.countDocuments({
            user: userId
          });
      } catch (error) {
        console.error(
          'Email summary error:',
          error.message
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NEW CONTACTS
    // ─────────────────────────────────────────────────────────────────────────

    if (Contact) {
      try {
        const sevenDaysAgo =
          new Date(
            Date.now() -
              7 * 24 * 60 * 60 * 1000
          );

        newContacts =
          await Contact.countDocuments({
            $or: [
              {
                user: userId
              },
              {
                createdBy: userId
              }
            ],
            createdAt: {
              $gte: sevenDaysAgo
            }
          });
      } catch (error) {
        console.error(
          'Contact summary error:',
          error.message
        );
      }
    }

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
          todayAttendance:
            myTodayAttendance
              ? {
                  status:
                    myTodayAttendance.status,

                  checkIn:
                    myTodayAttendance.checkIn,

                  checkOut:
                    myTodayAttendance.checkOut
                }
              : null,

          // Existing metric
          responseRate: 85
        },

        recentActivity: [],

        chartData: []
      }
    });
  } catch (error) {
    console.error(
      'getSummary error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving summary.'
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dashboard/activity
// Admin / Manager
// ─────────────────────────────────────────────────────────────────────────────

const getActivity = async (req, res) => {
  try {
    const [
      recentTasks,
      recentLeaves,
      recentEvents
    ] = await Promise.all([
      // Recent tasks
      Task.find()
        .populate(
          'createdBy',
          'name email avatar'
        )
        .populate(
          'assignedTo',
          'name email avatar'
        )
        .sort({
          createdAt: -1
        })
        .limit(10),

      // Recent leave requests
      LeaveRequest.find()
        .populate(
          'user',
          'name email avatar'
        )
        .sort({
          createdAt: -1
        })
        .limit(5),

      // Recent events
      Event
        ? Event.find()
            .populate(
              'createdBy',
              'name email avatar'
            )
            .populate(
              'assignedTo',
              'name email avatar'
            )
            .sort({
              createdAt: -1
            })
            .limit(5)
        : []
    ]);

    return res.status(200).json({
      success: true,

      recentActivity: {
        tasks: recentTasks,
        leaveRequests: recentLeaves,
        events: recentEvents
      }
    });
  } catch (error) {
    console.error(
      'getActivity error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving activity.'
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
      attendanceSummary
    ] = await Promise.all([
      // Tasks by status
      Task.aggregate([
        {
          $group: {
            _id: '$status',
            count: {
              $sum: 1
            }
          }
        }
      ]),

      // Tasks by priority
      Task.aggregate([
        {
          $group: {
            _id: '$priority',
            count: {
              $sum: 1
            }
          }
        }
      ]),

      // Users by role
      User.aggregate([
        {
          $group: {
            _id: '$role',
            count: {
              $sum: 1
            }
          }
        }
      ]),

      // Leave summary
      LeaveRequest.aggregate([
        {
          $group: {
            _id: '$status',
            count: {
              $sum: 1
            }
          }
        }
      ]),

      // Attendance summary
      Attendance
        ? Attendance.aggregate([
            {
              $group: {
                _id: '$status',
                count: {
                  $sum: 1
                }
              }
            }
          ])
        : []
    ]);

    return res.status(200).json({
      success: true,

      chartData: {
        tasksByStatus,
        tasksByPriority,
        usersByRole,
        leaveSummary,
        attendanceSummary
      }
    });
  } catch (error) {
    console.error(
      'getChartData error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving chart data.'
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
  getChartData
};