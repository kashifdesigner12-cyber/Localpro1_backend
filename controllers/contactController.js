const mongoose = require('mongoose');
const Contact = require('../models/Contact');
const User = require('../models/User');
const { createNotification } = require('./notificationController');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const VALID_STATUSES = [
  'active',
  'inactive',
  'lead',
  'customer',
  'contacted',
  'qualified',
  'proposal',
  'won',
  'lost'
];

const VALID_LEAD_STATUSES = [
  'New',
  'Contacted',
  'Qualified',
  'Proposal',
  'Won',
  'Lost',
  'None',
  ''
];

const VALID_SOURCES = ['manual', 'sms', 'call', 'email', 'web', 'import', 'referral', 'other'];

// Helper to format safe user reference
const safeUserRef = (u) => {
  if (!u) return null;
  if (typeof u === 'object' && u._id) {
    return {
      id: u._id,
      _id: u._id,
      name: u.name,
      email: u.email,
      phone: u.phone !== undefined ? u.phone : undefined,
      role: u.role,
      avatar: u.avatar !== undefined ? u.avatar : null
    };
  }
  return u;
};

// Safe contact serializer
const safeContact = (c) => {
  if (!c) return null;
  const user = safeUserRef(c.userId || c.user || c.createdBy);
  const assigned = safeUserRef(c.assignedTo);

  return {
    id: c._id,
    _id: c._id,
    userId: user ? user.id : (c.userId || c.user),
    user,
    createdBy: user,
    name: c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim(),
    firstName: c.firstName || '',
    lastName: c.lastName || '',
    email: c.email || '',
    phone: c.phone || '',
    company: c.company || '',
    jobTitle: c.jobTitle || '',
    status: c.status || 'lead',
    leadStatus: c.leadStatus || (c.status === 'customer' ? 'Won' : 'New'),
    source: c.source || 'manual',
    assignedTo: assigned,
    tags: Array.isArray(c.tags) ? c.tags : [],
    notes: c.notes || '',
    address: c.address || '',
    city: c.city || '',
    state: c.state || '',
    country: c.country || '',
    zipCode: c.zipCode || '',
    avatar: c.avatar || null,
    avatarColor: c.avatarColor || '#2563EB',
    lastContactedAt: c.lastContactedAt || null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  };
};

// ─── CONTACT & LEAD ENDPOINTS ───────────────────────────────────────────────

// GET /api/contacts or GET /api/leads (authenticated user - user scoped unless admin/manager)
const getContacts = async (req, res) => {
  try {
    const {
      search,
      status,
      leadStatus,
      source,
      assignedTo,
      tags,
      page = 1,
      limit = 50,
      sort = '-createdAt'
    } = req.query;

    const filter = {};
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';

    // Scoping
    if (!isAdminOrManager) {
      filter.$or = [
        { userId: req.user._id },
        { user: req.user._id },
        { createdBy: req.user._id },
        { assignedTo: req.user._id }
      ];
    }

    if (status) {
      filter.status = status.toLowerCase();
    }

    if (leadStatus) {
      filter.leadStatus = leadStatus;
    }

    if (source) {
      filter.source = source.toLowerCase();
    }

    if (assignedTo) {
      if (!isValidObjectId(assignedTo)) {
        return res.status(400).json({ success: false, message: 'Invalid assignedTo filter ID.' });
      }
      filter.assignedTo = assignedTo;
    }

    if (tags) {
      const tagList = Array.isArray(tags) ? tags : tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (tagList.length > 0) {
        filter.tags = { $in: tagList };
      }
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      const searchConditions = [
        { name: regex },
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { phone: regex },
        { company: regex },
        { jobTitle: regex }
      ];

      if (filter.$or) {
        filter.$and = filter.$and || [];
        filter.$and.push({ $or: searchConditions });
      } else {
        filter.$or = searchConditions;
      }
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    let sortOption = { createdAt: -1 };
    if (sort === 'oldest') sortOption = { createdAt: 1 };
    else if (sort === 'name') sortOption = { name: 1 };
    else if (sort === '-name') sortOption = { name: -1 };
    else if (sort === 'lastContacted') sortOption = { lastContactedAt: -1 };

    const [contacts, total] = await Promise.all([
      Contact.find(filter)
        .populate('userId', 'name email role avatar')
        .populate('assignedTo', 'name email role avatar')
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum),
      Contact.countDocuments(filter)
    ]);

    const formatted = contacts.map(safeContact);

    res.status(200).json({
      success: true,
      contacts: formatted,
      leads: formatted,
      data: formatted,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 0
      }
    });
  } catch (error) {
    console.error('getContacts error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving contacts.' });
  }
};

// GET /api/contacts/:id or GET /api/leads/:id (authenticated user)
const getContact = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid contact ID.' });
    }

    const contact = await Contact.findById(req.params.id)
      .populate('userId', 'name email role avatar')
      .populate('assignedTo', 'name email role avatar');

    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contact not found.' });
    }

    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    const isOwner = (contact.userId && (contact.userId._id ? contact.userId._id.toString() : contact.userId.toString()) === req.user._id.toString()) ||
      (contact.user && (contact.user._id ? contact.user._id.toString() : contact.user.toString()) === req.user._id.toString()) ||
      (contact.assignedTo && (contact.assignedTo._id ? contact.assignedTo._id.toString() : contact.assignedTo.toString()) === req.user._id.toString());

    if (!isAdminOrManager && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view this contact.'
      });
    }

    const formatted = safeContact(contact);

    res.status(200).json({
      success: true,
      contact: formatted,
      lead: formatted,
      data: formatted
    });
  } catch (error) {
    console.error('getContact error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving contact.' });
  }
};

// POST /api/contacts or POST /api/leads (authenticated user)
const createContact = async (req, res) => {
  try {
    const {
      name,
      firstName,
      lastName,
      email,
      phone,
      company,
      jobTitle,
      status,
      leadStatus,
      source,
      assignedTo,
      tags,
      notes,
      address,
      city,
      state,
      country,
      zipCode,
      avatar,
      avatarColor,
      lastContactedAt
    } = req.body;

    const resolvedName = (name && name.trim()) || `${firstName || ''} ${lastName || ''}`.trim();
    if (!resolvedName) {
      return res.status(400).json({ success: false, message: 'Contact name or first name is required.' });
    }

    let validAssignee = null;
    if (assignedTo) {
      if (!isValidObjectId(assignedTo)) {
        return res.status(400).json({ success: false, message: 'Invalid assignedTo user ID.' });
      }
      const userExists = await User.findById(assignedTo);
      if (!userExists) {
        return res.status(404).json({ success: false, message: 'Assigned user not found.' });
      }
      validAssignee = assignedTo;
    }

    const resolvedStatus = status ? status.toLowerCase() : 'lead';
    if (status && !VALID_STATUSES.includes(resolvedStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}.`
      });
    }

    const resolvedLeadStatus = leadStatus !== undefined ? leadStatus : (resolvedStatus === 'customer' ? 'Won' : 'New');

    const contact = await Contact.create({
      userId: req.user._id,
      user: req.user._id,
      createdBy: req.user._id,
      name: resolvedName,
      firstName: firstName ? firstName.trim() : (resolvedName.split(' ')[0] || ''),
      lastName: lastName ? lastName.trim() : (resolvedName.split(' ').slice(1).join(' ') || ''),
      email: email ? email.trim().toLowerCase() : '',
      phone: phone ? phone.trim() : '',
      company: company ? company.trim() : '',
      jobTitle: jobTitle ? jobTitle.trim() : '',
      status: resolvedStatus,
      leadStatus: resolvedLeadStatus,
      source: source ? source.toLowerCase() : 'manual',
      assignedTo: validAssignee,
      tags: Array.isArray(tags) ? tags : (tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : []),
      notes: notes ? notes.trim() : '',
      address: address ? address.trim() : '',
      city: city ? city.trim() : '',
      state: state ? state.trim() : '',
      country: country ? country.trim() : '',
      zipCode: zipCode ? zipCode.trim() : '',
      avatar: avatar || null,
      avatarColor: avatarColor || undefined,
      lastContactedAt: lastContactedAt ? new Date(lastContactedAt) : null
    });

    const populated = await Contact.findById(contact._id)
      .populate('userId', 'name email role avatar')
      .populate('assignedTo', 'name email role avatar');

    // Notify assignee if assigned to someone else
    if (validAssignee && validAssignee.toString() !== req.user._id.toString()) {
      try {
        await createNotification({
          userId: validAssignee,
          type: 'system',
          title: 'New Lead/Contact Assigned',
          message: `A new contact "${contact.name}" has been assigned to you.`,
          relatedId: contact._id,
          relatedType: 'User',
          actionUrl: '/dashboard/contacts',
          metadata: { contactId: contact._id, name: contact.name }
        });
      } catch (notifErr) {
        console.error('Contact assignment notification error:', notifErr.message);
      }
    }

    const formatted = safeContact(populated);

    res.status(201).json({
      success: true,
      message: 'Contact created successfully.',
      contact: formatted,
      lead: formatted,
      data: formatted
    });
  } catch (error) {
    console.error('createContact error:', error);
    res.status(500).json({ success: false, message: 'Server error creating contact.' });
  }
};

// PUT /api/contacts/:id or PATCH /api/contacts/:id (authenticated user)
const updateContact = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid contact ID.' });
    }

    const contact = await Contact.findById(req.params.id);
    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contact not found.' });
    }

    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    const isOwner = (contact.userId && contact.userId.toString() === req.user._id.toString()) ||
      (contact.user && contact.user.toString() === req.user._id.toString()) ||
      (contact.assignedTo && contact.assignedTo.toString() === req.user._id.toString());

    if (!isAdminOrManager && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to update this contact.'
      });
    }

    const {
      name,
      firstName,
      lastName,
      email,
      phone,
      company,
      jobTitle,
      status,
      leadStatus,
      source,
      assignedTo,
      tags,
      notes,
      address,
      city,
      state,
      country,
      zipCode,
      avatar,
      avatarColor,
      lastContactedAt
    } = req.body;

    if (name !== undefined) contact.name = name.trim();
    if (firstName !== undefined) contact.firstName = firstName.trim();
    if (lastName !== undefined) contact.lastName = lastName.trim();

    if (contact.firstName || contact.lastName) {
      contact.name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.name;
    }

    if (email !== undefined) contact.email = email ? email.trim().toLowerCase() : '';
    if (phone !== undefined) contact.phone = phone ? phone.trim() : '';
    if (company !== undefined) contact.company = company ? company.trim() : '';
    if (jobTitle !== undefined) contact.jobTitle = jobTitle ? jobTitle.trim() : '';

    if (status !== undefined) {
      const lowerStatus = status.toLowerCase();
      if (!VALID_STATUSES.includes(lowerStatus)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}.`
        });
      }
      contact.status = lowerStatus;
    }

    if (leadStatus !== undefined) {
      contact.leadStatus = leadStatus;
    }

    if (source !== undefined) {
      contact.source = source.toLowerCase();
    }

    let isReassigned = false;
    if (assignedTo !== undefined) {
      if (assignedTo === null || assignedTo === '') {
        contact.assignedTo = null;
      } else {
        if (!isValidObjectId(assignedTo)) {
          return res.status(400).json({ success: false, message: 'Invalid assignedTo user ID.' });
        }
        const userExists = await User.findById(assignedTo);
        if (!userExists) {
          return res.status(404).json({ success: false, message: 'Assigned user not found.' });
        }
        if (!contact.assignedTo || contact.assignedTo.toString() !== assignedTo.toString()) {
          contact.assignedTo = assignedTo;
          isReassigned = true;
        }
      }
    }

    if (tags !== undefined) {
      contact.tags = Array.isArray(tags) ? tags : tags.split(',').map((t) => t.trim()).filter(Boolean);
    }

    if (notes !== undefined) contact.notes = notes ? notes.trim() : '';
    if (address !== undefined) contact.address = address ? address.trim() : '';
    if (city !== undefined) contact.city = city ? city.trim() : '';
    if (state !== undefined) contact.state = state ? state.trim() : '';
    if (country !== undefined) contact.country = country ? country.trim() : '';
    if (zipCode !== undefined) contact.zipCode = zipCode ? zipCode.trim() : '';
    if (avatar !== undefined) contact.avatar = avatar;
    if (avatarColor !== undefined) contact.avatarColor = avatarColor;

    if (lastContactedAt !== undefined) {
      contact.lastContactedAt = lastContactedAt ? new Date(lastContactedAt) : null;
    }

    await contact.save();

    if (isReassigned && contact.assignedTo && contact.assignedTo.toString() !== req.user._id.toString()) {
      try {
        await createNotification({
          userId: contact.assignedTo,
          type: 'system',
          title: 'Contact Reassigned',
          message: `The contact "${contact.name}" has been assigned to you.`,
          relatedId: contact._id,
          relatedType: 'User',
          actionUrl: '/dashboard/contacts',
          metadata: { contactId: contact._id, name: contact.name, reassigned: true }
        });
      } catch (notifErr) {
        console.error('Reassignment notification error:', notifErr.message);
      }
    }

    const populated = await Contact.findById(contact._id)
      .populate('userId', 'name email role avatar')
      .populate('assignedTo', 'name email role avatar');

    const formatted = safeContact(populated);

    res.status(200).json({
      success: true,
      message: 'Contact updated successfully.',
      contact: formatted,
      lead: formatted,
      data: formatted
    });
  } catch (error) {
    console.error('updateContact error:', error);
    res.status(500).json({ success: false, message: 'Server error updating contact.' });
  }
};

// DELETE /api/contacts/:id or DELETE /api/leads/:id (authenticated user)
const deleteContact = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid contact ID.' });
    }

    const contact = await Contact.findById(req.params.id);
    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contact not found.' });
    }

    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    const isOwner = (contact.userId && contact.userId.toString() === req.user._id.toString()) ||
      (contact.user && contact.user.toString() === req.user._id.toString());

    if (!isAdminOrManager && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to delete this contact.'
      });
    }

    await Contact.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Contact deleted successfully.'
    });
  } catch (error) {
    console.error('deleteContact error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting contact.' });
  }
};

// POST /api/contacts/import (authenticated user)
const importContacts = async (req, res) => {
  try {
    let contactsToInsert = [];

    if (Array.isArray(req.body.contacts)) {
      contactsToInsert = req.body.contacts;
    } else if (req.file && req.file.buffer) {
      const csvString = req.file.buffer.toString('utf-8');
      const lines = csvString.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length > 1) {
        const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
          const item = {};
          headers.forEach((h, idx) => {
            if (h && values[idx] !== undefined) item[h] = values[idx];
          });
          contactsToInsert.push(item);
        }
      }
    } else if (typeof req.body.csvData === 'string') {
      const lines = req.body.csvData.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length > 1) {
        const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
          const item = {};
          headers.forEach((h, idx) => {
            if (h && values[idx] !== undefined) item[h] = values[idx];
          });
          contactsToInsert.push(item);
        }
      }
    }

    if (!contactsToInsert.length) {
      return res.status(400).json({
        success: false,
        message: 'No contacts found to import. Provide a valid CSV file or contacts array.'
      });
    }

    const docs = contactsToInsert.map((item) => {
      const resolvedName = (item.name && item.name.trim()) || `${item.firstName || ''} ${item.lastName || ''}`.trim() || 'Unnamed Contact';
      return {
        userId: req.user._id,
        user: req.user._id,
        createdBy: req.user._id,
        name: resolvedName,
        firstName: item.firstName || (resolvedName.split(' ')[0] || ''),
        lastName: item.lastName || (resolvedName.split(' ').slice(1).join(' ') || ''),
        email: item.email ? item.email.toLowerCase().trim() : '',
        phone: item.phone ? item.phone.trim() : '',
        company: item.company || '',
        jobTitle: item.jobTitle || '',
        status: item.status || 'lead',
        leadStatus: item.leadStatus || 'New',
        source: item.source || 'import',
        notes: item.notes || '',
        address: item.address || '',
        city: item.city || '',
        state: item.state || '',
        country: item.country || '',
        zipCode: item.zipCode || ''
      };
    });

    const inserted = await Contact.insertMany(docs);

    res.status(200).json({
      success: true,
      message: 'Contacts imported successfully.',
      count: inserted.length,
      data: inserted.map(safeContact)
    });
  } catch (error) {
    console.error('importContacts error:', error);
    res.status(500).json({ success: false, message: 'Server error importing contacts.' });
  }
};

// GET /api/contacts/export (authenticated user)
const exportContacts = async (req, res) => {
  try {
    const filter = {};
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    if (!isAdminOrManager) {
      filter.$or = [
        { userId: req.user._id },
        { user: req.user._id },
        { createdBy: req.user._id },
        { assignedTo: req.user._id }
      ];
    }

    const contacts = await Contact.find(filter).lean();
    if (!contacts.length) {
      return res.status(404).json({ success: false, message: 'No contacts found to export.' });
    }

    const headers = ['name', 'firstName', 'lastName', 'email', 'phone', 'company', 'jobTitle', 'status', 'leadStatus', 'source', 'city', 'country'];
    const csvRows = [headers.join(',')];

    for (const c of contacts) {
      const row = headers.map((field) => {
        const val = c[field] !== undefined && c[field] !== null ? String(c[field]) : '';
        return `"${val.replace(/"/g, '""')}"`;
      });
      csvRows.push(row.join(','));
    }

    const csvData = csvRows.join('\n');

    res.header('Content-Type', 'text/csv');
    res.attachment('contacts.csv');
    return res.send(csvData);
  } catch (error) {
    console.error('exportContacts error:', error);
    res.status(500).json({ success: false, message: 'Server error exporting contacts.' });
  }
};

// GET /api/contacts/leads or GET /api/leads (convenience helper)
const getLeads = async (req, res) => {
  req.query.status = req.query.status || 'lead';
  return getContacts(req, res);
};

// GET /api/contacts/stats or GET /api/contacts/stats/leads (lead and contact summary stats)
const getLeadStats = async (req, res) => {
  try {
    const filter = {};
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    if (!isAdminOrManager) {
      filter.$or = [
        { userId: req.user._id },
        { user: req.user._id },
        { createdBy: req.user._id },
        { assignedTo: req.user._id }
      ];
    }

    const [total, byStatus, byLeadStatus, bySource, converted] = await Promise.all([
      Contact.countDocuments(filter),
      Contact.aggregate([
        { $match: filter },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Contact.aggregate([
        { $match: filter },
        { $group: { _id: '$leadStatus', count: { $sum: 1 } } }
      ]),
      Contact.aggregate([
        { $match: filter },
        { $group: { _id: '$source', count: { $sum: 1 } } }
      ]),
      Contact.countDocuments({ ...filter, $or: [{ status: 'customer' }, { status: 'won' }, { leadStatus: 'Won' }] })
    ]);

    const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

    const stats = {
      total,
      converted,
      conversionRate,
      byStatus,
      byLeadStatus,
      bySource
    };

    res.status(200).json({
      success: true,
      stats,
      data: stats
    });
  } catch (error) {
    console.error('getLeadStats error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving lead stats.' });
  }
};

// Webhook / Internal Helper
const findOrCreateContact = async (userId, data = {}) => {
  const phone = data.phone || data.phoneNumber;
  let contact = null;

  if (phone) {
    contact = await Contact.findOne({ userId, phone });
  }

  if (!contact && data.email) {
    contact = await Contact.findOne({ userId, email: data.email.toLowerCase() });
  }

  if (!contact) {
    const name = data.name || phone || 'New Contact';
    contact = await Contact.create({
      userId,
      user: userId,
      createdBy: userId,
      name,
      phone: phone || '',
      email: data.email ? data.email.toLowerCase() : '',
      company: data.company || '',
      source: data.source || 'sms',
      status: 'lead'
    });
  }

  return contact;
};

module.exports = {
  getContacts,
  getContact,
  getContactById: getContact,
  createContact,
  updateContact,
  deleteContact,
  importContacts,
  importCSV: importContacts,
  exportContacts,
  exportCSV: exportContacts,
  getLeads,
  getLeadStats,
  getContactStats: getLeadStats,
  findOrCreateContact
};