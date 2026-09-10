const mongoose = require('mongoose');
const Task = require('../models/Task');

// =====================================================
// HELPERS
// =====================================================

const isValidObjectId = (id) =>
  Boolean(id) && mongoose.Types.ObjectId.isValid(id);

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
  const month = String(result.getMonth() + 1).padStart(2, '0');
  const day = String(result.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateInput = (value, fieldName) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (isNaN(date.getTime())) {
    const error = new Error(`Invalid ${fieldName}.`);
    error.statusCode = 400;
    throw error;
  }

  return date;
};

// =====================================================
// SAFE USER (Sanitized without heavy Base64 payload)
// =====================================================

const safeUser = (user) => {
  if (!user) {
    return null;
  }

  let cleanAvatar = user.avatar || null;
  if (typeof cleanAvatar === 'string' && cleanAvatar.startsWith('data:image') && cleanAvatar.length > 1000) {
    cleanAvatar = null;
  }

  return {
    id: user._id,
    _id: user._id,
    name: user.name || '',
    email: user.email || '',
    role: user.role || '',
    avatar: cleanAvatar
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
      `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
    email: contact.email || undefined,
    phone: contact.phone || undefined,
    company: contact.company || undefined
  };
};

// =====================================================
// OVERDUE LOGIC
// =====================================================

const getOverdueStatus = (dueDate, status, now = new Date()) => {
  if (!dueDate) {
    return false;
  }

  if (status === 'Completed' || status === 'Cancelled') {
    return false;
  }

  const due = new Date(dueDate);

  return !isNaN(due.getTime()) && due.getTime() < now.getTime();
};

// =====================================================
// SAFE CALENDAR TASK
// =====================================================

const safeCalendarTask = (task, now = new Date()) => {
  const dueDate = task.dueDate ? new Date(task.dueDate) : null;
  const isCompleted = task.status === 'Completed';
  const isCancelled = task.status === 'Cancelled';
  const overdue = getOverdueStatus(dueDate, task.status, now);

  const dueDateKey =
    dueDate && !isNaN(dueDate.getTime()) ? formatDateKey(dueDate) : null;

  return {
    id: task._id,
    _id: task._id,
    title: task.title,
    description: task.description || '',
    category: task.category || 'General',
    priority: task.priority,
    status: task.status,
    dueDate: task.dueDate || null,
    dueDateKey,
    completedAt: task.completedAt || null,
    overdue,
    isCompleted,
    isCancelled,
    calendarStatus: overdue
      ? 'overdue'
      : isCompleted
      ? 'completed'
      : isCancelled
      ? 'cancelled'
      : 'scheduled',
    calendarColor: overdue
      ? 'red'
      : isCompleted
      ? 'green'
      : isCancelled
      ? 'gray'
      : 'blue',
    assignedTo: safeUser(task.assignedTo),
    createdBy: safeUser(task.createdBy),
    contact: safeContact(task.contact),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
};

// =====================================================
// POPULATE TASK (Optimized with projection)
// =====================================================

const populateCalendarTasks = (query) => {
  return query
    .select('-comments -activity')
    .populate('assignedTo', 'name email role avatar')
    .populate('createdBy', 'name email role avatar')
    .populate('contact', 'name firstName lastName email phone company');
};

// =====================================================
// ACCESS FILTER
// =====================================================

const buildAccessFilter = (req) => {
  if (isAdminOrManager(req.user)) {
    return {};
  }

  return {
    $or: [
      { assignedTo: req.user._id },
      { createdBy: req.user._id }
    ]
  };
};

// =====================================================
// BUILD CALENDAR SUMMARY
// =====================================================

const buildCalendarSummary = (formattedTasks) => {
  let overdueCount = 0;
  let completedCount = 0;
  let cancelledCount = 0;
  let pendingCount = 0;
  let inProgressCount = 0;
  let scheduledCount = 0;

  const overdueDateKeys = new Set();
  const taskDateKeys = new Set();

  for (let i = 0; i < formattedTasks.length; i++) {
    const task = formattedTasks[i];

    if (task.overdue) {
      overdueCount++;
      if (task.dueDateKey) overdueDateKeys.add(task.dueDateKey);
    }
    if (task.isCompleted) completedCount++;
    if (task.isCancelled) cancelledCount++;
    if (task.status === 'Pending') pendingCount++;
    if (task.status === 'In Progress') inProgressCount++;
    if (!task.overdue && !task.isCompleted && !task.isCancelled) scheduledCount++;

    if (task.dueDateKey) taskDateKeys.add(task.dueDateKey);
  }

  return {
    totalTasks: formattedTasks.length,
    overdueTasks: overdueCount,
    completedTasks: completedCount,
    pendingTasks: pendingCount,
    inProgressTasks: inProgressCount,
    cancelledTasks: cancelledCount,
    scheduledTasks: scheduledCount,
    totalDates: taskDateKeys.size,
    overdueDates: overdueDateKeys.size,
    overdueDateKeys: Array.from(overdueDateKeys).sort(),
    taskDateKeys: Array.from(taskDateKeys).sort()
  };
};

// =====================================================
// GROUP TASKS BY DATE
// =====================================================

const groupTasksByDate = (formattedTasks) => {
  const dates = {};

  formattedTasks.forEach((task) => {
    if (!task.dueDateKey) {
      return;
    }

    if (!dates[task.dueDateKey]) {
      dates[task.dueDateKey] = {
        date: task.dueDateKey,
        tasks: [],
        totalTasks: 0,
        overdueTasks: 0,
        completedTasks: 0,
        pendingTasks: 0,
        inProgressTasks: 0,
        cancelledTasks: 0,
        hasTasks: true,
        hasOverdue: false,
        calendarStatus: 'scheduled'
      };
    }

    const dateEntry = dates[task.dueDateKey];
    dateEntry.tasks.push(task);
    dateEntry.totalTasks += 1;

    if (task.overdue) {
      dateEntry.overdueTasks += 1;
      dateEntry.hasOverdue = true;
      dateEntry.calendarStatus = 'overdue';
    }

    if (task.isCompleted) {
      dateEntry.completedTasks += 1;
    }

    if (task.status === 'Pending') {
      dateEntry.pendingTasks += 1;
    }

    if (task.status === 'In Progress') {
      dateEntry.inProgressTasks += 1;
    }

    if (task.isCancelled) {
      dateEntry.cancelledTasks += 1;
    }
  });

  return Object.values(dates).sort((a, b) => a.date.localeCompare(b.date));
};

// =====================================================
// GET CALENDAR TASKS
// =====================================================

const getCalendarTasks = async (req, res) => {
  try {
    const { startDate, endDate, assignedTo } = req.query;

    let start = null;
    let end = null;

    if (startDate) {
      start = parseDateInput(startDate, 'startDate');
      start = startOfDay(start);
    }

    if (endDate) {
      end = parseDateInput(endDate, 'endDate');
      end = endOfDay(end);
    }

    if (start && end && start > end) {
      return res.status(400).json({
        success: false,
        message: 'startDate cannot be after endDate.'
      });
    }

    const filter = buildAccessFilter(req);

    if (start || end) {
      filter.dueDate = {};
      if (start) filter.dueDate.$gte = start;
      if (end) filter.dueDate.$lte = end;
    } else {
      filter.dueDate = { $ne: null };
    }

    if (assignedTo) {
      if (!isValidObjectId(assignedTo)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid assignedTo user ID.'
        });
      }

      if (!isAdminOrManager(req.user) && assignedTo.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view your own calendar.'
        });
      }

      filter.assignedTo = assignedTo;
    }

    const tasks = await populateCalendarTasks(
      Task.find(filter).sort({ dueDate: 1 })
    ).lean();

    const now = new Date();
    const formattedTasks = tasks.map((task) => safeCalendarTask(task, now));
    const dates = groupTasksByDate(formattedTasks);
    const summary = buildCalendarSummary(formattedTasks);

    return res.status(200).json({
      success: true,
      message: 'Calendar tasks retrieved successfully.',
      filters: {
        startDate: start || null,
        endDate: end || null,
        assignedTo: assignedTo || null
      },
      summary,
      tasks: formattedTasks,
      dates,
      data: {
        tasks: formattedTasks,
        dates,
        summary
      }
    });
  } catch (error) {
    console.error('getCalendarTasks error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Server error retrieving calendar tasks.'
    });
  }
};

// =====================================================
// GET CALENDAR SUMMARY
// =====================================================

const getCalendarSummary = async (req, res) => {
  try {
    const { startDate, endDate, assignedTo } = req.query;

    let start = null;
    let end = null;

    if (startDate) {
      start = parseDateInput(startDate, 'startDate');
      start = startOfDay(start);
    }

    if (endDate) {
      end = parseDateInput(endDate, 'endDate');
      end = endOfDay(end);
    }

    if (start && end && start > end) {
      return res.status(400).json({
        success: false,
        message: 'startDate cannot be after endDate.'
      });
    }

    const filter = buildAccessFilter(req);
    filter.dueDate = { $ne: null };

    if (start) filter.dueDate.$gte = start;
    if (end) filter.dueDate.$lte = end;

    if (assignedTo) {
      if (!isValidObjectId(assignedTo)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid assignedTo user ID.'
        });
      }

      if (!isAdminOrManager(req.user) && assignedTo.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view your own calendar.'
        });
      }

      filter.assignedTo = assignedTo;
    }

    const tasks = await populateCalendarTasks(
      Task.find(filter).sort({ dueDate: 1 })
    ).lean();

    const now = new Date();
    const formattedTasks = tasks.map((task) => safeCalendarTask(task, now));
    const dates = groupTasksByDate(formattedTasks);
    const summary = buildCalendarSummary(formattedTasks);

    return res.status(200).json({
      success: true,
      message: 'Calendar summary retrieved successfully.',
      summary,
      dates,
      data: {
        summary,
        dates
      }
    });
  } catch (error) {
    console.error('getCalendarSummary error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Server error retrieving calendar summary.'
    });
  }
};

// =====================================================
// GET CALENDAR MONTH
// =====================================================

const getCalendarMonth = async (req, res) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({
        success: false,
        message: 'Invalid year. Please provide a year between 2000 and 2100.'
      });
    }

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({
        success: false,
        message: 'Invalid month. Month must be between 1 and 12.'
      });
    }

    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const end = new Date(year, month, 0, 23, 59, 59, 999);

    const filter = buildAccessFilter(req);
    filter.dueDate = { $gte: start, $lte: end };

    const tasks = await populateCalendarTasks(
      Task.find(filter).sort({ dueDate: 1 })
    ).lean();

    const now = new Date();
    const formattedTasks = tasks.map((task) => safeCalendarTask(task, now));

    // Fast O(1) Pre-grouping by dateKey
    const tasksByDateMap = {};
    for (let i = 0; i < formattedTasks.length; i++) {
      const t = formattedTasks[i];
      if (t.dueDateKey) {
        if (!tasksByDateMap[t.dueDateKey]) {
          tasksByDateMap[t.dueDateKey] = [];
        }
        tasksByDateMap[t.dueDateKey].push(t);
      }
    }

    const dates = [];
    const daysInMonth = new Date(year, month, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const currentDate = new Date(year, month - 1, day);
      const dateKey = formatDateKey(currentDate);
      const dayTasks = tasksByDateMap[dateKey] || [];

      let overdueCount = 0;
      let completedCount = 0;
      let pendingCount = 0;
      let inProgressCount = 0;
      let cancelledCount = 0;

      for (let j = 0; j < dayTasks.length; j++) {
        const dt = dayTasks[j];
        if (dt.overdue) overdueCount++;
        if (dt.isCompleted) completedCount++;
        if (dt.status === 'Pending') pendingCount++;
        if (dt.status === 'In Progress') inProgressCount++;
        if (dt.isCancelled) cancelledCount++;
      }

      dates.push({
        date: dateKey,
        day,
        totalTasks: dayTasks.length,
        overdueTasks: overdueCount,
        completedTasks: completedCount,
        pendingTasks: pendingCount,
        inProgressTasks: inProgressCount,
        cancelledTasks: cancelledCount,
        hasTasks: dayTasks.length > 0,
        hasOverdue: overdueCount > 0,
        calendarStatus:
          overdueCount > 0
            ? 'overdue'
            : completedCount === dayTasks.length && dayTasks.length > 0
            ? 'completed'
            : dayTasks.length > 0
            ? 'scheduled'
            : 'empty',
        tasks: dayTasks
      });
    }

    const summary = buildCalendarSummary(formattedTasks);

    return res.status(200).json({
      success: true,
      message: 'Calendar month retrieved successfully.',
      month: {
        year,
        month,
        startDate: start,
        endDate: end
      },
      summary,
      dates,
      tasks: formattedTasks,
      data: {
        year,
        month,
        dates,
        tasks: formattedTasks,
        summary
      }
    });
  } catch (error) {
    console.error('getCalendarMonth error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving calendar month.'
    });
  }
};

// =====================================================
// GET CALENDAR DAY
// =====================================================

const getCalendarDay = async (req, res) => {
  try {
    const { date } = req.params;
    const parsedDate = parseDateInput(date, 'date');
    const start = startOfDay(parsedDate);
    const end = endOfDay(parsedDate);

    const filter = buildAccessFilter(req);
    filter.dueDate = { $gte: start, $lte: end };

    const tasks = await populateCalendarTasks(
      Task.find(filter).sort({ dueDate: 1 })
    ).lean();

    const now = new Date();
    const formattedTasks = tasks.map((task) => safeCalendarTask(task, now));

    let overdueCount = 0;
    let completedCount = 0;
    let pendingCount = 0;
    let inProgressCount = 0;
    let cancelledCount = 0;

    for (let i = 0; i < formattedTasks.length; i++) {
      const task = formattedTasks[i];
      if (task.overdue) overdueCount++;
      if (task.isCompleted) completedCount++;
      if (task.status === 'Pending') pendingCount++;
      if (task.status === 'In Progress') inProgressCount++;
      if (task.isCancelled) cancelledCount++;
    }

    const totalTasks = formattedTasks.length;

    return res.status(200).json({
      success: true,
      message: 'Calendar day retrieved successfully.',
      date: formatDateKey(parsedDate),
      hasTasks: totalTasks > 0,
      hasOverdue: overdueCount > 0,
      calendarStatus:
        overdueCount > 0
          ? 'overdue'
          : completedCount === totalTasks && totalTasks > 0
          ? 'completed'
          : totalTasks > 0
          ? 'scheduled'
          : 'empty',
      summary: {
        totalTasks,
        overdueTasks: overdueCount,
        completedTasks,
        pendingTasks: pendingCount,
        inProgressTasks,
        cancelledTasks: cancelledCount
      },
      tasks: formattedTasks,
      data: formattedTasks
    });
  } catch (error) {
    console.error('getCalendarDay error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Server error retrieving calendar day.'
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