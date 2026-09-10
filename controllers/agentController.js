const mongoose = require('mongoose');
const Agent = require('../models/Agent');

const isValidObjectId = (id) =>
  Boolean(id) && mongoose.Types.ObjectId.isValid(id);

const VALID_TYPES = ['voice', 'chat', 'sms', 'email', 'multi-purpose'];
const VALID_STATUSES = ['active', 'inactive', 'draft', 'archived'];

const safeUserRef = (u) => {
  if (!u) return null;
  if (typeof u === 'object' && u._id) {
    let cleanAvatar = u.avatar || null;
    if (typeof cleanAvatar === 'string' && cleanAvatar.startsWith('data:image') && cleanAvatar.length > 1000) {
      cleanAvatar = null;
    }

    return { id: u._id, _id: u._id, name: u.name || '', email: u.email || '', avatar: cleanAvatar };
  }
  return u;
};

const safeAgent = (a) => ({
  id: a._id,
  _id: a._id,
  name: a.name || '',
  role: a.role || '',
  description: a.description || '',
  type: a.type || 'chat',
  status: a.status || 'active',
  model: a.model || 'gpt-4',
  systemPrompt: a.systemPrompt || '',
  instructions: a.instructions || '',
  voice: a.voice || { provider: 'elevenlabs', voiceId: 'default', speed: 1.0, pitch: 1.0 },
  tools: Array.isArray(a.tools) ? a.tools : [],
  knowledgeBase: Array.isArray(a.knowledgeBase) ? a.knowledgeBase : [],
  settings: a.settings || {
    temperature: 0.7,
    maxTokens: 1000,
    greetingMessage: 'Hello! How can I assist you today?',
    fallbackMessage: 'I am not sure about that. Let me connect you with a team member.',
    transferPhoneNumber: '',
    businessHoursOnly: false
  },
  createdBy: safeUserRef(a.createdBy),
  stats: a.stats || {
    totalConversations: 0,
    totalMessages: 0,
    resolvedQueries: 0,
    transferredCalls: 0,
    averageResponseTimeMs: 0,
    satisfactionScore: 100
  },
  activity: Array.isArray(a.activity)
    ? a.activity.map((act) => ({
        id: act._id,
        _id: act._id,
        action: act.action || '',
        details: act.details || '',
        timestamp: act.timestamp
      }))
    : [],
  metadata: a.metadata || {},
  createdAt: a.createdAt,
  updatedAt: a.updatedAt
});

const createAgent = async (req, res) => {
  try {
    const { name, role, description, type, status, model, systemPrompt, instructions, voice, tools, knowledgeBase, settings, metadata } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Agent name is required.' });

    const agent = await Agent.create({
      name: name.trim(),
      role: role ? role.trim() : 'Customer Support',
      description: description ? description.trim() : '',
      type: type ? type.toLowerCase() : 'chat',
      status: status ? status.toLowerCase() : 'active',
      model: model || 'gpt-4',
      systemPrompt: systemPrompt || '',
      instructions: instructions || '',
      voice: voice || {},
      tools: Array.isArray(tools) ? tools : [],
      knowledgeBase: Array.isArray(knowledgeBase) ? knowledgeBase : [],
      settings: settings || {},
      createdBy: req.user._id,
      stats: { totalConversations: 0, totalMessages: 0, resolvedQueries: 0, transferredCalls: 0, averageResponseTimeMs: 0, satisfactionScore: 100 },
      activity: [{ action: 'created', details: `Agent "${name.trim()}" created`, timestamp: new Date() }],
      metadata: metadata || {}
    });

    const populated = await Agent.findById(agent._id)
      .populate('createdBy', 'name email avatar')
      .lean();

    const formatted = safeAgent(populated);

    return res.status(201).json({ success: true, message: 'AI Agent created successfully.', agent: formatted, data: formatted });
  } catch (error) {
    console.error('createAgent error:', error);
    return res.status(500).json({ success: false, message: 'Server error creating AI Agent.' });
  }
};

const getAgents = async (req, res) => {
  try {
    const { search, status, type, role, page = 1, limit = 50, sort = '-createdAt' } = req.query;
    const filter = {};
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    if (!isAdminOrManager) filter.createdBy = req.user._id;
    if (status) filter.status = status.toLowerCase();
    if (type) filter.type = type.toLowerCase();

    if (role && role.trim()) {
      const escapedRole = role.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.role = new RegExp(escapedRole, 'i');
    }

    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [{ name: regex }, { role: regex }, { description: regex }];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [agents, total] = await Promise.all([
      Agent.find(filter)
        .select('-knowledgeBase -activity')
        .populate('createdBy', 'name email avatar')
        .sort(sort === 'oldest' ? { createdAt: 1 } : { createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Agent.countDocuments(filter)
    ]);

    const formatted = agents.map(safeAgent);

    return res.status(200).json({
      success: true,
      agents: formatted,
      data: formatted,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) || 0 }
    });
  } catch (error) {
    console.error('getAgents error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving AI Agents.' });
  }
};

const getAgentStats = async (req, res) => {
  try {
    const filter = {};
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    if (!isAdminOrManager) filter.createdBy = req.user._id;

    const [total, active, inactive, draft, byType, statsAgg] = await Promise.all([
      Agent.countDocuments(filter),
      Agent.countDocuments({ ...filter, status: 'active' }),
      Agent.countDocuments({ ...filter, status: 'inactive' }),
      Agent.countDocuments({ ...filter, status: 'draft' }),
      Agent.aggregate([{ $match: filter }, { $group: { _id: '$type', count: { $sum: 1 } } }]),
      Agent.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalConversations: { $sum: '$stats.totalConversations' },
            totalMessages: { $sum: '$stats.totalMessages' },
            resolvedQueries: { $sum: '$stats.resolvedQueries' },
            transferredCalls: { $sum: '$stats.transferredCalls' }
          }
        }
      ])
    ]);

    const stats = {
      total,
      active,
      inactive,
      draft,
      byType,
      ...(statsAgg[0] || {})
    };

    return res.status(200).json({ success: true, stats, data: stats });
  } catch (error) {
    console.error('getAgentStats error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving AI Agent stats.' });
  }
};

const getAgentById = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid agent ID.' });
    const agent = await Agent.findById(req.params.id)
      .populate('createdBy', 'name email avatar')
      .lean();

    if (!agent) return res.status(404).json({ success: false, message: 'AI Agent not found.' });

    const isCreator = agent.createdBy && (agent.createdBy._id ? agent.createdBy._id.toString() : agent.createdBy.toString()) === req.user._id.toString();
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    if (!isCreator && !isAdminOrManager) return res.status(403).json({ success: false, message: 'Access denied.' });

    const formatted = safeAgent(agent);
    return res.status(200).json({ success: true, agent: formatted, data: formatted });
  } catch (error) {
    console.error('getAgentById error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving AI Agent.' });
  }
};

const updateAgent = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid agent ID.' });
    const agent = await Agent.findById(req.params.id);
    if (!agent) return res.status(404).json({ success: false, message: 'AI Agent not found.' });

    const isCreator = agent.createdBy && agent.createdBy.toString() === req.user._id.toString();
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    if (!isCreator && !isAdminOrManager) return res.status(403).json({ success: false, message: 'Access denied.' });

    const { name, role, description, type, status, model, systemPrompt, instructions, voice, tools, knowledgeBase, settings, stats, metadata } = req.body;
    agent.activity = agent.activity || [];

    if (name !== undefined) agent.name = name.trim();
    if (role !== undefined) agent.role = role.trim();
    if (description !== undefined) agent.description = description ? description.trim() : '';
    if (type !== undefined) agent.type = type.toLowerCase();
    if (status !== undefined) agent.status = status.toLowerCase();
    if (model !== undefined) agent.model = model;
    if (systemPrompt !== undefined) agent.systemPrompt = systemPrompt;
    if (instructions !== undefined) agent.instructions = instructions;
    if (voice !== undefined) agent.voice = { ...agent.voice, ...voice };
    if (tools !== undefined && Array.isArray(tools)) agent.tools = tools;
    if (knowledgeBase !== undefined && Array.isArray(knowledgeBase)) agent.knowledgeBase = knowledgeBase;
    if (settings !== undefined) agent.settings = { ...agent.settings, ...settings };
    if (stats !== undefined) agent.stats = { ...agent.stats, ...stats };
    if (metadata !== undefined) agent.metadata = { ...agent.metadata, ...metadata };

    agent.activity.push({ action: 'updated', details: 'Agent configuration updated', timestamp: new Date() });
    await agent.save();

    const populated = await Agent.findById(agent._id)
      .populate('createdBy', 'name email avatar')
      .lean();

    const formatted = safeAgent(populated);

    return res.status(200).json({ success: true, message: 'AI Agent updated successfully.', agent: formatted, data: formatted });
  } catch (error) {
    console.error('updateAgent error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating AI Agent.' });
  }
};

const deleteAgent = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid agent ID.' });
    const agent = await Agent.findById(req.params.id).select('createdBy').lean();
    if (!agent) return res.status(404).json({ success: false, message: 'AI Agent not found.' });

    const isCreator = agent.createdBy && agent.createdBy.toString() === req.user._id.toString();
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    if (!isCreator && !isAdminOrManager) return res.status(403).json({ success: false, message: 'Access denied.' });

    await Agent.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'AI Agent deleted successfully.' });
  } catch (error) {
    console.error('deleteAgent error:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting AI Agent.' });
  }
};

module.exports = {
  createAgent,
  getAgents,
  getAgentById,
  updateAgent,
  deleteAgent,
  getAgentStats
};