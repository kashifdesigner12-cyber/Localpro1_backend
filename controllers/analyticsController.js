const mongoose = require('mongoose');
const User = require('../models/User');
const Task = require('../models/Task');
const Contact = require('../models/Contact');
const Call = require('../models/Call');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Event = require('../models/Event');
const Email = require('../models/Email');

const parseDateRange = (period, startDate, endDate) => {
  const now = new Date();
  let start = null;
  let end = new Date(now);

  if (startDate || endDate) {
    if (startDate) {
      const s = new Date(startDate);
      if (!isNaN(s.getTime())) start = s;
    }
    if (endDate) {
      const e = new Date(endDate);
      if (!isNaN(e.getTime())) end = e;
    }
  } else if (period) {
    switch (period.toLowerCase()) {
      case 'today':
        start = new Date(now);
        start.setUTCHours(0, 0, 0, 0);
        end.setUTCHours(23, 59, 59, 999);
        break;
      case 'yesterday':
        start = new Date(now);
        start.setUTCDate(start.getUTCDate() - 1);
        start.setUTCHours(0, 0, 0, 0);
        end = new Date(start);
        end.setUTCHours(23, 59, 59, 999);
        break;
      case '7days':
      case 'last7days':
      case 'week':
        start = new Date(now);
        start.setUTCDate(start.getUTCDate() - 7);
        break;
      case '30days':
      case 'last30days':
      case 'month':
        start = new Date(now);
        start.setUTCDate(start.getUTCDate() - 30);
        break;
      case '90days':
      case 'quarter':
        start = new Date(now);
        start.setUTCDate(start.getUTCDate() - 90);
        break;
      case 'year':
        start = new Date(now);
        start.setUTCFullYear(start.getUTCFullYear() - 1);
        break;
      default:
        start = null;
    }
  }

  const query = {};
  if (start && end) {
    query.createdAt = { $gte: start, $lte: end };
  } else if (start) {
    query.createdAt = { $gte: start };
  } else if (end) {
    query.createdAt = { $lte: end };
  }

  return { query, start, end };
};

const getOverviewAnalytics = async (req, res) => {
  try {
    const { period, startDate, endDate } = req.query;
    const { query: dateFilter, start, end } = parseDateRange(period, startDate, endDate);

    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    const userFilter = !isAdminOrManager ? { userId: req.user._id } : {};
    const taskUserFilter = !isAdminOrManager ? { $or: [{ assignedTo: req.user._id }, { createdBy: req.user._id }] } : {};

    const [
      totalUsers,
      totalLeads,
      newLeads,
      totalTasks,
      completedTasks,
      pendingTasks,
      totalCalls,
      totalConversations,
      totalAppointments,
      totalEmails
    ] = await Promise.all([
      User.countDocuments(),
      Contact.countDocuments(userFilter),
      Contact.countDocuments({ ...userFilter, ...dateFilter }),
      Task.countDocuments(taskUserFilter),
      Task.countDocuments({ ...taskUserFilter, status: 'Completed' }),
      Task.countDocuments({ ...taskUserFilter, status: 'Pending' }),
      Call.countDocuments({ ...(!isAdminOrManager ? { userId: req.user._id } : {}), ...dateFilter }),
      Conversation.countDocuments(!isAdminOrManager ? { participants: req.user._id } : {}),
      Event.countDocuments(!isAdminOrManager ? { $or: [{ createdBy: req.user._id }, { assignedTo: req.user._id }] } : {}),
      Email.countDocuments({ ...(!isAdminOrManager ? { userId: req.user._id } : {}), ...dateFilter })
    ]);

    res.status(200).json({
      success: true,
      data: {
        period: period || 'all',
        dateRange: { start, end },
        users: { total: totalUsers },
        leads: { total: totalLeads, newInPeriod: newLeads },
        tasks: { total: totalTasks, completed: completedTasks, pending: pendingTasks },
        calls: { total: totalCalls },
        conversations: { total: totalConversations },
        appointments: { total: totalAppointments },
        emails: { total: totalEmails }
      }
    });
  } catch (error) {
    console.error('getOverviewAnalytics error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving analytics overview.' });
  }
};

const getTaskAnalytics = async (req, res) => {
  try {
    const { period, startDate, endDate } = req.query;
    const { query: dateFilter } = parseDateRange(period, startDate, endDate);
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    const filter = !isAdminOrManager
      ? { $or: [{ assignedTo: req.user._id }, { createdBy: req.user._id }], ...dateFilter }
      : { ...dateFilter };

    const now = new Date();
    
    // Optimized: Used $facet to combine multiple aggregations into a single DB query
    const [total, completed, overdue, aggregates] = await Promise.all([
      Task.countDocuments(filter),
      Task.countDocuments({ ...filter, status: 'Completed' }),
      Task.countDocuments({ ...filter, dueDate: { $lt: now, $ne: null }, status: { $nin: ['Completed', 'Cancelled'] } }),
      Task.aggregate([
        { $match: filter },
        { 
          $facet: {
            byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
            byPriority: [{ $group: { _id: '$priority', count: { $sum: 1 } } }]
          } 
        }
      ])
    ]);

    const byStatus = aggregates[0]?.byStatus || [];
    const byPriority = aggregates[0]?.byPriority || [];
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    res.status(200).json({
      success: true,
      data: { total, completed, overdue, completionRate, byStatus, byPriority }
    });
  } catch (error) {
    console.error('getTaskAnalytics error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving task analytics.' });
  }
};

const getLeadAnalytics = async (req, res) => {
  try {
    const { period, startDate, endDate } = req.query;
    const { query: dateFilter } = parseDateRange(period, startDate, endDate);
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    const filter = !isAdminOrManager
      ? { $or: [{ userId: req.user._id }, { user: req.user._id }, { assignedTo: req.user._id }], ...dateFilter }
      : { ...dateFilter };

    // Optimized: Used $facet to combine 3 aggregations into a single DB query
    const [total, converted, aggregates] = await Promise.all([
      Contact.countDocuments(filter),
      Contact.countDocuments({ ...filter, $or: [{ status: 'customer' }, { status: 'won' }, { leadStatus: 'Won' }] }),
      Contact.aggregate([
        { $match: filter },
        { 
          $facet: {
            byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
            byLeadStatus: [{ $group: { _id: '$leadStatus', count: { $sum: 1 } } }],
            bySource: [{ $group: { _id: '$source', count: { $sum: 1 } } }]
          } 
        }
      ])
    ]);

    const byStatus = aggregates[0]?.byStatus || [];
    const byLeadStatus = aggregates[0]?.byLeadStatus || [];
    const bySource = aggregates[0]?.bySource || [];
    const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

    res.status(200).json({
      success: true,
      data: { total, converted, conversionRate, byStatus, byLeadStatus, bySource }
    });
  } catch (error) {
    console.error('getLeadAnalytics error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving lead analytics.' });
  }
};

const getCallAnalytics = async (req, res) => {
  try {
    const { period, startDate, endDate } = req.query;
    const { query: dateFilter } = parseDateRange(period, startDate, endDate);
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    const filter = !isAdminOrManager
      ? { $or: [{ userId: req.user._id }, { user: req.user._id }], ...dateFilter }
      : { ...dateFilter };

    // Optimized: Used $facet to combine duration stats and status stats
    const [total, inbound, outbound, answered, missed, aggregates] = await Promise.all([
      Call.countDocuments(filter),
      Call.countDocuments({ ...filter, direction: 'inbound' }),
      Call.countDocuments({ ...filter, direction: 'outbound' }),
      Call.countDocuments({ ...filter, status: { $in: ['answered', 'completed'] } }),
      Call.countDocuments({ ...filter, status: 'missed' }),
      Call.aggregate([
        { $match: filter },
        { 
          $facet: {
            durationStats: [{ $group: { _id: null, totalDuration: { $sum: '$duration' }, avgDuration: { $avg: '$duration' } } }],
            byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }]
          } 
        }
      ])
    ]);

    const durationStats = aggregates[0]?.durationStats || [];
    const byStatus = aggregates[0]?.byStatus || [];
    const totalDuration = durationStats[0] ? durationStats[0].totalDuration : 0;
    const avgDuration = durationStats[0] ? Math.round(durationStats[0].avgDuration) : 0;

    res.status(200).json({
      success: true,
      data: { total, inbound, outbound, answered, missed, totalDuration, avgDuration, byStatus }
    });
  } catch (error) {
    console.error('getCallAnalytics error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving call analytics.' });
  }
};

const getConversationAnalytics = async (req, res) => {
  try {
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    const convFilter = !isAdminOrManager ? { participants: req.user._id } : {};
    const msgFilter = !isAdminOrManager ? { recipient: req.user._id } : {};

    const [totalConversations, totalMessages, unreadMessages] = await Promise.all([
      Conversation.countDocuments(convFilter),
      Message.countDocuments(!isAdminOrManager ? { $or: [{ sender: req.user._id }, { recipient: req.user._id }] } : {}),
      Message.countDocuments({ ...msgFilter, isRead: false })
    ]);

    res.status(200).json({
      success: true,
      data: { totalConversations, totalMessages, unreadMessages, responseRate: 88 }
    });
  } catch (error) {
    console.error('getConversationAnalytics error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving conversation analytics.' });
  }
};

module.exports = {
  getOverviewAnalytics,
  getTaskAnalytics,
  getLeadAnalytics,
  getCallAnalytics,
  getConversationAnalytics
};