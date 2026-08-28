const mongoose = require('mongoose');
const Campaign = require('../models/Campaign');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const VALID_TYPES = ['email', 'sms', 'social', 'call', 'multi-channel', 'custom'];
const VALID_STATUSES = ['draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled'];

const safeUserRef = (u) => {
  if (!u) return null;
  if (typeof u === 'object' && u._id) {
    return { id: u._id, _id: u._id, name: u.name, email: u.email, avatar: u.avatar || null };
  }
  return u;
};

const safeCampaign = (c) => ({
  id: c._id,
  _id: c._id,
  name: c.name || c.title || 'Untitled Campaign',
  title: c.title || c.name || 'Untitled Campaign',
  description: c.description || '',
  type: c.type || 'email',
  status: c.status || 'draft',
  createdBy: safeUserRef(c.createdBy),
  audience: c.audience || { segment: 'all', tags: [], contactCount: 0, filters: {} },
  schedule: c.schedule || { startDate: null, endDate: null, sendTime: '', timezone: 'UTC', isRecurring: false, frequency: 'once' },
  content: c.content || { subject: '', body: '', html: '', templateId: '' },
  budget: c.budget || { allocated: 0, spent: 0, currency: 'USD' },
  stats: c.stats || { sent: 0, delivered: 0, opened: 0, clicked: 0, conversions: 0, revenue: 0 },
  metadata: c.metadata || {},
  createdAt: c.createdAt,
  updatedAt: c.updatedAt
});

const createCampaign = async (req, res) => {
  try {
    const { name, title, description, type, status, audience, schedule, content, budget, stats, metadata } = req.body;
    const resolvedName = (name && name.trim()) || (title && title.trim());
    if (!resolvedName) return res.status(400).json({ success: false, message: 'Campaign name is required.' });

    const resolvedType = type ? type.toLowerCase() : 'email';
    if (type && !VALID_TYPES.includes(resolvedType)) {
      return res.status(400).json({ success: false, message: `Invalid type. Allowed: ${VALID_TYPES.join(', ')}.` });
    }

    const resolvedStatus = status ? status.toLowerCase() : 'draft';
    if (status && !VALID_STATUSES.includes(resolvedStatus)) {
      return res.status(400).json({ success: false, message: `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}.` });
    }

    const campaign = await Campaign.create({
      name: resolvedName,
      title: resolvedName,
      description: description ? description.trim() : '',
      type: resolvedType,
      status: resolvedStatus,
      createdBy: req.user._id,
      audience: audience || {},
      schedule: schedule || {},
      content: content || {},
      budget: budget || {},
      stats: stats || {},
      metadata: metadata || {}
    });

    const populated = await Campaign.findById(campaign._id).populate('createdBy', 'name email avatar');
    const formatted = safeCampaign(populated);

    res.status(201).json({ success: true, message: 'Campaign created successfully.', campaign: formatted, data: formatted });
  } catch (error) {
    console.error('createCampaign error:', error);
    res.status(500).json({ success: false, message: 'Server error creating campaign.' });
  }
};

const getCampaigns = async (req, res) => {
  try {
    const { search, status, type, startDate, endDate, page = 1, limit = 50, sort = '-createdAt' } = req.query;
    const filter = {};
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    if (!isAdminOrManager) filter.createdBy = req.user._id;
    if (status) filter.status = status.toLowerCase();
    if (type) filter.type = type.toLowerCase();

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [{ name: regex }, { title: regex }, { description: regex }];
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [campaigns, total] = await Promise.all([
      Campaign.find(filter)
        .populate('createdBy', 'name email avatar')
        .sort(sort === 'oldest' ? { createdAt: 1 } : { createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Campaign.countDocuments(filter)
    ]);

    const formatted = campaigns.map(safeCampaign);

    res.status(200).json({
      success: true,
      campaigns: formatted,
      data: formatted,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) || 0 }
    });
  } catch (error) {
    console.error('getCampaigns error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving campaigns.' });
  }
};

const getCampaignStats = async (req, res) => {
  try {
    const filter = {};
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    if (!isAdminOrManager) filter.createdBy = req.user._id;

    const [total, active, scheduled, completed, draft, byType, byStatus, budgetAgg] = await Promise.all([
      Campaign.countDocuments(filter),
      Campaign.countDocuments({ ...filter, status: 'active' }),
      Campaign.countDocuments({ ...filter, status: 'scheduled' }),
      Campaign.countDocuments({ ...filter, status: 'completed' }),
      Campaign.countDocuments({ ...filter, status: 'draft' }),
      Campaign.aggregate([{ $match: filter }, { $group: { _id: '$type', count: { $sum: 1 } } }]),
      Campaign.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Campaign.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalAllocated: { $sum: '$budget.allocated' },
            totalSpent: { $sum: '$budget.spent' },
            totalSent: { $sum: '$stats.sent' },
            totalOpened: { $sum: '$stats.opened' },
            totalClicked: { $sum: '$stats.clicked' },
            totalConversions: { $sum: '$stats.conversions' },
            totalRevenue: { $sum: '$stats.revenue' }
          }
        }
      ])
    ]);

    const stats = {
      total,
      active,
      scheduled,
      completed,
      draft,
      byType,
      byStatus,
      ...(budgetAgg[0] || {})
    };

    res.status(200).json({ success: true, stats, data: stats });
  } catch (error) {
    console.error('getCampaignStats error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving campaign stats.' });
  }
};

const getCampaignById = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid campaign ID.' });
    const campaign = await Campaign.findById(req.params.id).populate('createdBy', 'name email avatar');
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });

    const isCreator = campaign.createdBy && (campaign.createdBy._id ? campaign.createdBy._id.toString() : campaign.createdBy.toString()) === req.user._id.toString();
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    if (!isCreator && !isAdminOrManager) return res.status(403).json({ success: false, message: 'Access denied.' });

    const formatted = safeCampaign(campaign);
    res.status(200).json({ success: true, campaign: formatted, data: formatted });
  } catch (error) {
    console.error('getCampaignById error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving campaign.' });
  }
};

const updateCampaign = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid campaign ID.' });
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });

    const isCreator = campaign.createdBy && campaign.createdBy.toString() === req.user._id.toString();
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    if (!isCreator && !isAdminOrManager) return res.status(403).json({ success: false, message: 'Access denied.' });

    const { name, title, description, type, status, audience, schedule, content, budget, stats, metadata } = req.body;
    if (name !== undefined) campaign.name = name.trim();
    if (title !== undefined) campaign.title = title.trim();
    if (description !== undefined) campaign.description = description ? description.trim() : '';
    if (type !== undefined) campaign.type = type.toLowerCase();
    if (status !== undefined) campaign.status = status.toLowerCase();
    if (audience !== undefined) campaign.audience = { ...campaign.audience, ...audience };
    if (schedule !== undefined) campaign.schedule = { ...campaign.schedule, ...schedule };
    if (content !== undefined) campaign.content = { ...campaign.content, ...content };
    if (budget !== undefined) campaign.budget = { ...campaign.budget, ...budget };
    if (stats !== undefined) campaign.stats = { ...campaign.stats, ...stats };
    if (metadata !== undefined) campaign.metadata = { ...campaign.metadata, ...metadata };

    await campaign.save();
    const populated = await Campaign.findById(campaign._id).populate('createdBy', 'name email avatar');
    const formatted = safeCampaign(populated);

    res.status(200).json({ success: true, message: 'Campaign updated successfully.', campaign: formatted, data: formatted });
  } catch (error) {
    console.error('updateCampaign error:', error);
    res.status(500).json({ success: false, message: 'Server error updating campaign.' });
  }
};

const deleteCampaign = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid campaign ID.' });
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });

    const isCreator = campaign.createdBy && campaign.createdBy.toString() === req.user._id.toString();
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    if (!isCreator && !isAdminOrManager) return res.status(403).json({ success: false, message: 'Access denied.' });

    await Campaign.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Campaign deleted successfully.' });
  } catch (error) {
    console.error('deleteCampaign error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting campaign.' });
  }
};

module.exports = {
  createCampaign,
  getCampaigns,
  getCampaignById,
  updateCampaign,
  deleteCampaign,
  getCampaignStats
};