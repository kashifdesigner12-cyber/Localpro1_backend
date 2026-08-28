const mongoose = require('mongoose');
const Task = require('../models/Task');

// =====================================================
// HELPERS
// =====================================================

const isValidObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id);

const getUserRole = (user) =>
  String(user?.role || '')
    .trim()
    .toLowerCase();

const isAdminOrManager = (user) => {
  const role = getUserRole(user);

  return role === 'admin' || role === 'manager';
};

// =====================================================
// DATE HELPERS
// =====================================================

const startOfDay = (date) => {
  const result = new Date(date);

  result.setHours(0, 0, 0, 0);

  return result;
};

const endOfDay = (date) => {
  const result = new Date(date);

  result.setHours(23, 59, 59, 999);

  return result;
};

const formatDateKey = (date) => {
  const result = new Date(date);

  const year = result.getFullYear();

  const month = String(
    result.getMonth() + 1
  ).padStart(2, '0');

  const day = String(
    result.getDate()
  ).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const parseDateInput = (
  value,
  fieldName
) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (isNaN(date.getTime())) {
    const error = new Error(
      `Invalid ${fieldName}.`
    );

    error.statusCode = 400;

    throw error;
  }

  return date;
};

// =====================================================
// SAFE USER
// =====================================================

const safeUser = (user) => {
  if (!user) {
    return null;
  }

  return {
    id: user._id,
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar
  };
};

// =====================================================
// SAFE CONTACT
// =====================================================

const safeContact = (contact) => {
  if (!contact) {
    return null;
  }

  return {
    id: contact._id,
    _id: contact._id,

    name:
      contact.name ||
      `${contact.firstName || ''} ${
        contact.lastName || ''
      }`.trim(),

    email: contact.email,
    phone: contact.phone,
    company: contact.company
  };
};

// =====================================================
// OVERDUE LOGIC
// =====================================================
//
// A task becomes overdue when:
//
// 1. It has a due date.
// 2. Its due date/time has passed.
// 3. It is NOT Completed.
// 4. It is NOT Cancelled.
//
// IMPORTANT:
// If a task is due today but its exact due time has not
// passed yet, it is not overdue.
//
// =====================================================

const getOverdueStatus = (
  dueDate,
  status,
  now = new Date()
) => {
  if (!dueDate) {
    return false;
  }

  if (
    status === 'Completed' ||
    status === 'Cancelled'
  ) {
    return false;
  }

  const due = new Date(dueDate);

  return (
    !isNaN(due.getTime()) &&
    due.getTime() < now.getTime()
  );
};

// =====================================================
// SAFE CALENDAR TASK
// =====================================================

const safeCalendarTask = (
  task,
  now = new Date()
) => {
  const dueDate = task.dueDate
    ? new Date(task.dueDate)
    : null;

  const isCompleted =
    task.status === 'Completed';

  const isCancelled =
    task.status === 'Cancelled';

  const overdue =
    getOverdueStatus(
      dueDate,
      task.status,
      now
    );

  const dueDateKey =
    dueDate &&
    !isNaN(dueDate.getTime())
      ? formatDateKey(dueDate)
      : null;

  return {
    id: task._id,
    _id: task._id,

    title: task.title,

    description:
      task.description || '',

    category:
      task.category || 'General',

    priority:
      task.priority,

    status:
      task.status,

    dueDate:
      task.dueDate || null,

    dueDateKey,

    completedAt:
      task.completedAt || null,

    overdue,

    isCompleted,

    isCancelled,

    // Frontend can directly use this.
    calendarStatus:
      overdue
        ? 'overdue'
        : isCompleted
          ? 'completed'
          : isCancelled
            ? 'cancelled'
            : 'scheduled',

    // Useful for calendar UI.
    calendarColor:
      overdue
        ? 'red'
        : isCompleted
          ? 'green'
          : isCancelled
            ? 'gray'
            : 'blue',

    assignedTo:
      safeUser(task.assignedTo),

    createdBy:
      safeUser(task.createdBy),

    contact:
      safeContact(task.contact),

    createdAt:
      task.createdAt,

    updatedAt:
      task.updatedAt
  };
};

// =====================================================
// POPULATE TASK
// =====================================================

const populateCalendarTasks = (
  query
) => {
  return query
    .populate(
      'assignedTo',
      'name email role avatar'
    )
    .populate(
      'createdBy',
      'name email role avatar'
    )
    .populate(
      'contact',
      'name firstName lastName email phone company'
    );
};

// =====================================================
// ACCESS FILTER
// =====================================================
//
// Admin:
//   Can see all tasks.
//
// Manager:
//   Can see all tasks.
//
// User:
//   Can only see:
//   - tasks assigned to them
//   - tasks created by them
//
// =====================================================

const buildAccessFilter = (
  req
) => {
  if (
    isAdminOrManager(req.user)
  ) {
    return {};
  }

  return {
    $or: [
      {
        assignedTo:
          req.user._id
      },
      {
        createdBy:
          req.user._id
      }
    ]
  };
};

// =====================================================
// BUILD CALENDAR SUMMARY
// =====================================================

const buildCalendarSummary = (
  formattedTasks
) => {
  const overdueTasks =
    formattedTasks.filter(
      (task) => task.overdue
    );

  const completedTasks =
    formattedTasks.filter(
      (task) => task.isCompleted
    );

  const cancelledTasks =
    formattedTasks.filter(
      (task) => task.isCancelled
    );

  const pendingTasks =
    formattedTasks.filter(
      (task) =>
        task.status === 'Pending'
    );

  const inProgressTasks =
    formattedTasks.filter(
      (task) =>
        task.status === 'In Progress'
    );

  const overdueDateKeys =
    new Set(
      overdueTasks
        .map(
          (task) =>
            task.dueDateKey
        )
        .filter(Boolean)
    );

  const taskDateKeys =
    new Set(
      formattedTasks
        .map(
          (task) =>
            task.dueDateKey
        )
        .filter(Boolean)
    );

  return {
    totalTasks:
      formattedTasks.length,

    overdueTasks:
      overdueTasks.length,

    completedTasks:
      completedTasks.length,

    pendingTasks:
      pendingTasks.length,

    inProgressTasks:
      inProgressTasks.length,

    cancelledTasks:
      cancelledTasks.length,

    scheduledTasks:
      formattedTasks.filter(
        (task) =>
          !task.overdue &&
          !task.isCompleted &&
          !task.isCancelled
      ).length,

    totalDates:
      taskDateKeys.size,

    overdueDates:
      overdueDateKeys.size,

    overdueDateKeys:
      Array.from(
        overdueDateKeys
      ).sort(),

    taskDateKeys:
      Array.from(
        taskDateKeys
      ).sort()
  };
};

// =====================================================
// GROUP TASKS BY DATE
// =====================================================

const groupTasksByDate = (
  formattedTasks
) => {
  const dates = {};

  formattedTasks.forEach(
    (task) => {
      if (!task.dueDateKey) {
        return;
      }

      if (!dates[task.dueDateKey]) {
        dates[task.dueDateKey] = {
          date:
            task.dueDateKey,

          tasks: [],

          totalTasks: 0,

          overdueTasks: 0,

          completedTasks: 0,

          pendingTasks: 0,

          inProgressTasks: 0,

          cancelledTasks: 0,

          hasTasks: true,

          hasOverdue: false,

          // Frontend can use this directly
          // to make the calendar date red.
          calendarStatus:
            'scheduled'
        };
      }

      const dateEntry =
        dates[task.dueDateKey];

      dateEntry.tasks.push(task);

      dateEntry.totalTasks += 1;

      if (task.overdue) {
        dateEntry.overdueTasks += 1;

        dateEntry.hasOverdue = true;

        dateEntry.calendarStatus =
          'overdue';
      }

      if (task.isCompleted) {
        dateEntry.completedTasks += 1;
      }

      if (
        task.status === 'Pending'
      ) {
        dateEntry.pendingTasks += 1;
      }

      if (
        task.status === 'In Progress'
      ) {
        dateEntry.inProgressTasks += 1;
      }

      if (task.isCancelled) {
        dateEntry.cancelledTasks += 1;
      }
    }
  );

  return Object.values(
    dates
  ).sort(
    (a, b) =>
      a.date.localeCompare(
        b.date
      )
  );
};

// =====================================================
// GET CALENDAR TASKS
//
// GET /api/calendar/tasks
//
// Example:
//
// /api/calendar/tasks
//
// /api/calendar/tasks?startDate=2026-08-01&endDate=2026-08-31
//
// /api/calendar/tasks?assignedTo=USER_ID
//
// =====================================================

const getCalendarTasks = async (
  req,
  res
) => {
  try {
    const {
      startDate,
      endDate,
      assignedTo
    } = req.query;

    let start = null;
    let end = null;

    // -------------------------------------------------
    // DATE VALIDATION
    // -------------------------------------------------

    if (startDate) {
      start = parseDateInput(
        startDate,
        'startDate'
      );

      start = startOfDay(start);
    }

    if (endDate) {
      end = parseDateInput(
        endDate,
        'endDate'
      );

      end = endOfDay(end);
    }

    if (
      start &&
      end &&
      start > end
    ) {
      return res.status(400).json({
        success: false,
        message:
          'startDate cannot be after endDate.'
      });
    }

    // -------------------------------------------------
    // ACCESS FILTER
    // -------------------------------------------------

    const filter =
      buildAccessFilter(req);

    // -------------------------------------------------
    // DUE DATE FILTER
    // -------------------------------------------------

    if (start || end) {
      filter.dueDate = {};

      if (start) {
        filter.dueDate.$gte =
          start;
      }

      if (end) {
        filter.dueDate.$lte =
          end;
      }
    } else {
      filter.dueDate = {
        $ne: null
      };
    }

    // -------------------------------------------------
    // ASSIGNED USER FILTER
    // -------------------------------------------------

    if (assignedTo) {
      if (
        !isValidObjectId(
          assignedTo
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid assignedTo user ID.'
        });
      }

      // Normal users can only request
      // their own assigned calendar.
      if (
        !isAdminOrManager(req.user) &&
        assignedTo.toString() !==
          req.user._id.toString()
      ) {
        return res.status(403).json({
          success: false,
          message:
            'Access denied. You can only view your own calendar.'
        });
      }

      filter.assignedTo =
        assignedTo;
    }

    // -------------------------------------------------
    // FETCH TASKS
    // -------------------------------------------------

    const tasks =
      await populateCalendarTasks(
        Task.find(filter)
          .sort({
            dueDate: 1
          })
      );

    const now =
      new Date();

    const formattedTasks =
      tasks.map(
        (task) =>
          safeCalendarTask(
            task,
            now
          )
      );

    const dates =
      groupTasksByDate(
        formattedTasks
      );

    const summary =
      buildCalendarSummary(
        formattedTasks
      );

    // -------------------------------------------------
    // RESPONSE
    // -------------------------------------------------

    return res.status(200).json({
      success: true,

      message:
        'Calendar tasks retrieved successfully.',

      filters: {
        startDate:
          start || null,

        endDate:
          end || null,

        assignedTo:
          assignedTo || null
      },

      summary,

      tasks:
        formattedTasks,

      dates,

      data: {
        tasks:
          formattedTasks,

        dates,

        summary
      }
    });
  } catch (error) {
    console.error(
      'getCalendarTasks error:',
      error
    );

    return res.status(
      error.statusCode || 500
    ).json({
      success: false,

      message:
        error.statusCode
          ? error.message
          : 'Server error retrieving calendar tasks.'
    });
  }
};

// =====================================================
// GET CALENDAR SUMMARY
//
// GET /api/calendar/summary
//
// Optional:
//
// ?startDate=2026-08-01
// &endDate=2026-08-31
//
// =====================================================

const getCalendarSummary = async (
  req,
  res
) => {
  try {
    const {
      startDate,
      endDate,
      assignedTo
    } = req.query;

    let start = null;
    let end = null;

    if (startDate) {
      start = parseDateInput(
        startDate,
        'startDate'
      );

      start = startOfDay(start);
    }

    if (endDate) {
      end = parseDateInput(
        endDate,
        'endDate'
      );

      end = endOfDay(end);
    }

    if (
      start &&
      end &&
      start > end
    ) {
      return res.status(400).json({
        success: false,
        message:
          'startDate cannot be after endDate.'
      });
    }

    const filter =
      buildAccessFilter(req);

    // Only tasks with due dates
    filter.dueDate = {
      $ne: null
    };

    if (start) {
      filter.dueDate.$gte =
        start;
    }

    if (end) {
      filter.dueDate.$lte =
        end;
    }

    // -------------------------------------------------
    // ASSIGNED USER
    // -------------------------------------------------

    if (assignedTo) {
      if (
        !isValidObjectId(
          assignedTo
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid assignedTo user ID.'
        });
      }

      if (
        !isAdminOrManager(req.user) &&
        assignedTo.toString() !==
          req.user._id.toString()
      ) {
        return res.status(403).json({
          success: false,
          message:
            'Access denied. You can only view your own calendar.'
        });
      }

      filter.assignedTo =
        assignedTo;
    }

    const tasks =
      await populateCalendarTasks(
        Task.find(filter)
          .sort({
            dueDate: 1
          })
      );

    const now =
      new Date();

    const formattedTasks =
      tasks.map(
        (task) =>
          safeCalendarTask(
            task,
            now
          )
      );

    const dates =
      groupTasksByDate(
        formattedTasks
      );

    const summary =
      buildCalendarSummary(
        formattedTasks
      );

    return res.status(200).json({
      success: true,

      message:
        'Calendar summary retrieved successfully.',

      summary,

      dates,

      data: {
        summary,
        dates
      }
    });
  } catch (error) {
    console.error(
      'getCalendarSummary error:',
      error
    );

    return res.status(
      error.statusCode || 500
    ).json({
      success: false,

      message:
        error.statusCode
          ? error.message
          : 'Server error retrieving calendar summary.'
    });
  }
};

// =====================================================
// GET CALENDAR MONTH
//
// GET /api/calendar/month?year=2026&month=8
//
// month = 1 - 12
//
// =====================================================

const getCalendarMonth = async (
  req,
  res
) => {
  try {
    const year =
      Number(
        req.query.year
      );

    const month =
      Number(
        req.query.month
      );

    // -------------------------------------------------
    // VALIDATE YEAR
    // -------------------------------------------------

    if (
      !Number.isInteger(year) ||
      year < 2000 ||
      year > 2100
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid year. Please provide a year between 2000 and 2100.'
      });
    }

    // -------------------------------------------------
    // VALIDATE MONTH
    // -------------------------------------------------

    if (
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid month. Month must be between 1 and 12.'
      });
    }

    const start =
      new Date(
        year,
        month - 1,
        1,
        0,
        0,
        0,
        0
      );

    const end =
      new Date(
        year,
        month,
        0,
        23,
        59,
        59,
        999
      );

    const filter =
      buildAccessFilter(req);

    filter.dueDate = {
      $gte: start,
      $lte: end
    };

    const tasks =
      await populateCalendarTasks(
        Task.find(filter)
          .sort({
            dueDate: 1
          })
      );

    const now =
      new Date();

    const formattedTasks =
      tasks.map(
        (task) =>
          safeCalendarTask(
            task,
            now
          )
      );

    // -------------------------------------------------
    // BUILD ALL MONTH DAYS
    // -------------------------------------------------

    const dates = [];

    const daysInMonth =
      new Date(
        year,
        month,
        0
      ).getDate();

    for (
      let day = 1;
      day <= daysInMonth;
      day++
    ) {
      const currentDate =
        new Date(
          year,
          month - 1,
          day
        );

      const dateKey =
        formatDateKey(
          currentDate
        );

      const dayTasks =
        formattedTasks.filter(
          (task) =>
            task.dueDateKey ===
            dateKey
        );

      const overdueTasks =
        dayTasks.filter(
          (task) =>
            task.overdue
        );

      const completedTasks =
        dayTasks.filter(
          (task) =>
            task.isCompleted
        );

      const pendingTasks =
        dayTasks.filter(
          (task) =>
            task.status ===
            'Pending'
        );

      const inProgressTasks =
        dayTasks.filter(
          (task) =>
            task.status ===
            'In Progress'
        );

      const cancelledTasks =
        dayTasks.filter(
          (task) =>
            task.isCancelled
        );

      dates.push({
        date:
          dateKey,

        day,

        totalTasks:
          dayTasks.length,

        overdueTasks:
          overdueTasks.length,

        completedTasks:
          completedTasks.length,

        pendingTasks:
          pendingTasks.length,

        inProgressTasks:
          inProgressTasks.length,

        cancelledTasks:
          cancelledTasks.length,

        hasTasks:
          dayTasks.length > 0,

        hasOverdue:
          overdueTasks.length > 0,

        // Frontend can directly check:
        // date.hasOverdue === true
        calendarStatus:
          overdueTasks.length > 0
            ? 'overdue'
            : completedTasks.length ===
                dayTasks.length &&
              dayTasks.length > 0
              ? 'completed'
              : dayTasks.length > 0
                ? 'scheduled'
                : 'empty',

        tasks:
          dayTasks
      });
    }

    const summary =
      buildCalendarSummary(
        formattedTasks
      );

    return res.status(200).json({
      success: true,

      message:
        'Calendar month retrieved successfully.',

      month: {
        year,
        month,
        startDate: start,
        endDate: end
      },

      summary,

      dates,

      tasks:
        formattedTasks,

      data: {
        year,
        month,
        dates,
        tasks:
          formattedTasks,
        summary
      }
    });
  } catch (error) {
    console.error(
      'getCalendarMonth error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving calendar month.'
    });
  }
};

// =====================================================
// GET CALENDAR DAY
//
// GET /api/calendar/day/2026-08-25
//
// =====================================================

const getCalendarDay = async (
  req,
  res
) => {
  try {
    const {
      date
    } = req.params;

    const parsedDate =
      parseDateInput(
        date,
        'date'
      );

    const start =
      startOfDay(
        parsedDate
      );

    const end =
      endOfDay(
        parsedDate
      );

    const filter =
      buildAccessFilter(req);

    filter.dueDate = {
      $gte: start,
      $lte: end
    };

    const tasks =
      await populateCalendarTasks(
        Task.find(filter)
          .sort({
            dueDate: 1
          })
      );

    const now =
      new Date();

    const formattedTasks =
      tasks.map(
        (task) =>
          safeCalendarTask(
            task,
            now
          )
      );

    const overdueTasks =
      formattedTasks.filter(
        (task) =>
          task.overdue
      );

    const completedTasks =
      formattedTasks.filter(
        (task) =>
          task.isCompleted
      );

    const pendingTasks =
      formattedTasks.filter(
        (task) =>
          task.status ===
          'Pending'
      );

    const inProgressTasks =
      formattedTasks.filter(
        (task) =>
          task.status ===
          'In Progress'
      );

    const cancelledTasks =
      formattedTasks.filter(
        (task) =>
          task.isCancelled
      );

    return res.status(200).json({
      success: true,

      message:
        'Calendar day retrieved successfully.',

      date:
        formatDateKey(
          parsedDate
        ),

      hasTasks:
        formattedTasks.length > 0,

      hasOverdue:
        overdueTasks.length > 0,

      calendarStatus:
        overdueTasks.length > 0
          ? 'overdue'
          : completedTasks.length ===
              formattedTasks.length &&
            formattedTasks.length > 0
            ? 'completed'
            : formattedTasks.length > 0
              ? 'scheduled'
              : 'empty',

      summary: {
        totalTasks:
          formattedTasks.length,

        overdueTasks:
          overdueTasks.length,

        completedTasks:
          completedTasks.length,

        pendingTasks:
          pendingTasks.length,

        inProgressTasks:
          inProgressTasks.length,

        cancelledTasks:
          cancelledTasks.length
      },

      tasks:
        formattedTasks,

      data:
        formattedTasks
    });
  } catch (error) {
    console.error(
      'getCalendarDay error:',
      error
    );

    return res.status(
      error.statusCode || 500
    ).json({
      success: false,

      message:
        error.statusCode
          ? error.message
          : 'Server error retrieving calendar day.'
    });
  }
};

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
  getCalendarTasks,
  getCalendarSummary,
  getCalendarMonth,
  getCalendarDay
};