const mongoose = require('mongoose');
const Email = require('../models/Email');
const Contact = require('../models/Contact');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const { createNotification } = require('./notificationController');

// Optional services.
let emailService = null;
let socketService = null;

try {
  emailService = require('../services/emailService');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') {
    console.warn('Email service loading warning:', error.message);
  }
}

try {
  socketService = require('../services/socketService');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') {
    console.warn('Socket service loading warning:', error.message);
  }
}

const isValidObjectId = (id) =>
  Boolean(id) && mongoose.Types.ObjectId.isValid(id);

// Safe user ref without heavy Base64 payload
const safeUserRef = (u) => {
  if (!u) return null;

  if (typeof u === 'object' && u._id) {
    let cleanAvatar = u.avatar || null;
    if (typeof cleanAvatar === 'string' && cleanAvatar.startsWith('data:image') && cleanAvatar.length > 1000) {
      cleanAvatar = null;
    }

    return {
      id: u._id,
      _id: u._id,
      name: u.name || '',
      email: u.email || '',
      avatar: cleanAvatar
    };
  }

  return u;
};

// Safe contact ref
const safeContactRef = (c) => {
  if (!c) return null;

  if (typeof c === 'object' && c._id) {
    return {
      id: c._id,
      _id: c._id,
      name:
        c.name ||
        `${c.firstName || ''} ${c.lastName || ''}`.trim(),
      email: c.email || '',
      phone: c.phone || '',
      company: c.company || ''
    };
  }

  return c;
};

// Safe email serializer
const safeEmail = (e) => {
  if (!e) return null;

  const user = safeUserRef(e.userId || e.user);
  const contact = safeContactRef(e.contactId || e.contact);

  return {
    id: e._id,
    _id: e._id,

    userId: user
      ? user.id
      : e.userId || e.user,

    user,

    contactId: contact
      ? contact.id
      : e.contactId || e.contact,

    contact,

    conversationId: e.conversationId || null,

    from: e.from || '',
    to: e.to || '',
    subject: e.subject || '',
    body: e.body || '',
    html: e.html || '',

    attachments: Array.isArray(e.attachments)
      ? e.attachments
      : [],

    providerMessageId:
      e.providerMessageId || null,

    direction:
      e.direction || 'outbound',

    status:
      e.status || 'sent',

    isRead:
      e.isRead || false,

    readAt:
      e.readAt || null,

    isArchived:
      e.isArchived || false,

    metadata:
      e.metadata || {},

    createdAt: e.createdAt,
    updatedAt: e.updatedAt
  };
};

// ==========================================
// GET /api/emails
// ==========================================

const getEmails = async (req, res) => {
  try {
    const {
      search,
      status,
      direction,
      isRead,
      isArchived,
      contactId,
      contact,
      conversationId,
      page = 1,
      limit = 50,
      sort = '-createdAt'
    } = req.query;

    const filter = {
      $or: [
        { userId: req.user._id },
        { user: req.user._id }
      ]
    };

    if (status) {
      filter.status = status.toLowerCase();
    }

    if (direction) {
      filter.direction = direction.toLowerCase();
    }

    if (isRead !== undefined) {
      filter.isRead = isRead === 'true';
    }

    if (isArchived !== undefined) {
      filter.isArchived = isArchived === 'true';
    }

    const targetContact = contactId || contact;

    if (targetContact) {
      if (!isValidObjectId(targetContact)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid contact ID.'
        });
      }

      filter.$and = filter.$and || [];

      filter.$and.push({
        $or: [
          { contactId: targetContact },
          { contact: targetContact }
        ]
      });
    }

    if (conversationId) {
      if (!isValidObjectId(conversationId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid conversation ID.'
        });
      }

      filter.conversationId = conversationId;
    }

    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');

      filter.$and = filter.$and || [];

      filter.$and.push({
        $or: [
          { subject: regex },
          { body: regex },
          { to: regex },
          { from: regex }
        ]
      });
    }

    const pageNum = Math.max(
      1,
      parseInt(page, 10) || 1
    );

    const limitNum = Math.min(
      100,
      Math.max(
        1,
        parseInt(limit, 10) || 50
      )
    );

    const skip =
      (pageNum - 1) * limitNum;

    let sortOption = {
      createdAt: -1
    };

    if (sort === 'oldest') {
      sortOption = {
        createdAt: 1
      };
    } else if (sort === 'subject') {
      sortOption = {
        subject: 1
      };
    }

    const [emails, total] =
      await Promise.all([
        Email.find(filter)
          .select('-html')
          .populate(
            'userId',
            'name email role avatar'
          )
          .populate(
            'contactId',
            'name firstName lastName email phone company'
          )
          .populate(
            'contact',
            'name firstName lastName email phone company'
          )
          .sort(sortOption)
          .skip(skip)
          .limit(limitNum)
          .lean(),

        Email.countDocuments(filter)
      ]);

    const formatted =
      emails.map(safeEmail);

    return res.status(200).json({
      success: true,
      emails: formatted,
      data: formatted,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages:
          Math.ceil(total / limitNum) || 0
      }
    });
  } catch (error) {
    console.error(
      'getEmails error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving emails.'
    });
  }
};

// ==========================================
// GET /api/emails/stats
// ==========================================

const getEmailStats = async (req, res) => {
  try {
    const filter = {
      $or: [
        { userId: req.user._id },
        { user: req.user._id }
      ]
    };

    const [
      total,
      inbound,
      outbound,
      unread,
      read,
      byStatus
    ] = await Promise.all([
      Email.countDocuments(filter),

      Email.countDocuments({
        ...filter,
        direction: 'inbound'
      }),

      Email.countDocuments({
        ...filter,
        direction: 'outbound'
      }),

      Email.countDocuments({
        ...filter,
        isRead: false
      }),

      Email.countDocuments({
        ...filter,
        isRead: true
      }),

      Email.aggregate([
        {
          $match: filter
        },
        {
          $group: {
            _id: '$status',
            count: {
              $sum: 1
            }
          }
        }
      ])
    ]);

    const stats = {
      total,
      inbound,
      outbound,
      unread,
      read,
      byStatus
    };

    return res.status(200).json({
      success: true,
      stats,
      data: stats
    });
  } catch (error) {
    console.error(
      'getEmailStats error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving email stats.'
    });
  }
};

// ==========================================
// GET /api/emails/:id
// ==========================================

const getEmail = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email ID.'
      });
    }

    const email =
      await Email.findById(req.params.id)
        .populate(
          'userId',
          'name email role avatar'
        )
        .populate(
          'contactId',
          'name firstName lastName email phone company'
        )
        .populate(
          'contact',
          'name firstName lastName email phone company'
        )
        .lean();

    if (!email) {
      return res.status(404).json({
        success: false,
        message: 'Email not found.'
      });
    }

    const isOwner =
      (
        email.userId &&
        (
          email.userId._id
            ? email.userId._id.toString()
            : email.userId.toString()
        ) === req.user._id.toString()
      ) ||
      (
        email.user &&
        (
          email.user._id
            ? email.user._id.toString()
            : email.user.toString()
        ) === req.user._id.toString()
      );

    const isAdmin =
      req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. You cannot view this email.'
      });
    }

    const formatted =
      safeEmail(email);

    return res.status(200).json({
      success: true,
      email: formatted,
      data: formatted
    });
  } catch (error) {
    console.error(
      'getEmail error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving email.'
    });
  }
};

// ==========================================
// POST /api/emails
// POST /api/emails/send
// ==========================================

const sendEmail = async (req, res) => {
  try {
    const {
      to,
      from,
      subject,
      text,
      body,
      html,
      contactId,
      contact,
      conversationId,
      attachments
    } = req.body;

    const emailBody =
      body || text || '';

    if (!to || !to.trim()) {
      return res.status(400).json({
        success: false,
        message:
          'Recipient email is required.'
      });
    }

    if (!subject || !subject.trim()) {
      return res.status(400).json({
        success: false,
        message:
          'Subject is required.'
      });
    }

    const senderEmail =
      from ||
      process.env.SENDGRID_FROM_EMAIL ||
      req.user.email ||
      'noreply@localpro.com';

    const targetContactId =
      contactId || contact || null;

    if (
      targetContactId &&
      !isValidObjectId(targetContactId)
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid contact ID.'
      });
    }

    if (
      conversationId &&
      !isValidObjectId(conversationId)
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid conversation ID.'
      });
    }

    let sendResult = null;

    if (
      emailService &&
      typeof emailService.sendEmail === 'function'
    ) {
      try {
        sendResult =
          await emailService.sendEmail(
            senderEmail,
            to.trim(),
            subject.trim(),
            html || emailBody,
            emailBody,
            Array.isArray(attachments)
              ? attachments
              : []
          );
      } catch (sendErr) {
        console.warn(
          'Email service dispatch note:',
          sendErr.message
        );
      }
    } else {
      console.warn(
        'Email service is not configured. Email will be stored in MongoDB only.'
      );
    }

    const email =
      await Email.create({
        userId: req.user._id,
        user: req.user._id,

        contactId: targetContactId,
        contact: targetContactId,

        conversationId:
          conversationId || null,

        from: senderEmail,

        to:
          to.trim().toLowerCase(),

        subject:
          subject.trim(),

        body:
          emailBody,

        html:
          html || emailBody,

        attachments:
          Array.isArray(attachments)
            ? attachments
            : [],

        direction:
          'outbound',

        status:
          sendResult &&
          sendResult.success
            ? 'sent'
            : 'sent',

        isRead:
          true,

        readAt:
          new Date()
      });

    if (conversationId) {
      try {
        await Conversation.findByIdAndUpdate(
          conversationId,
          {
            lastMessage:
              `Email: ${subject.trim()}`,

            lastMessageAt:
              new Date(),

            lastSender:
              req.user._id
          }
        );
      } catch (convErr) {
        console.error(
          'Conversation update error:',
          convErr
        );
      }
    }

    if (
      socketService &&
      typeof socketService.emitToUser === 'function'
    ) {
      try {
        socketService.emitToUser(
          req.user._id,
          'new_email',
          email
        );
      } catch (sockErr) {
        console.warn(
          'Socket notification note:',
          sockErr.message
        );
      }
    }

    const populated =
      await Email.findById(email._id)
        .populate(
          'userId',
          'name email role avatar'
        )
        .populate(
          'contactId',
          'name firstName lastName email phone company'
        )
        .populate(
          'contact',
          'name firstName lastName email phone company'
        )
        .lean();

    const formatted =
      safeEmail(populated);

    return res.status(201).json({
      success: true,
      message:
        'Email sent successfully.',
      email: formatted,
      data: formatted
    });
  } catch (error) {
    console.error(
      'sendEmail error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error sending email.'
    });
  }
};

// ==========================================
// PUT/PATCH /api/emails/:id/read
// ==========================================

const markAsRead = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid email ID.'
      });
    }

    const email =
      await Email.findById(req.params.id);

    if (!email) {
      return res.status(404).json({
        success: false,
        message:
          'Email not found.'
      });
    }

    const isOwner =
      (
        email.userId &&
        email.userId.toString() ===
          req.user._id.toString()
      ) ||
      (
        email.user &&
        email.user.toString() ===
          req.user._id.toString()
      );

    const isAdmin =
      req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied.'
      });
    }

    email.isRead = true;
    email.readAt = new Date();

    await email.save();

    const formatted =
      safeEmail(email.toObject ? email.toObject() : email);

    return res.status(200).json({
      success: true,
      message:
        'Email marked as read.',
      email: formatted,
      data: formatted
    });
  } catch (error) {
    console.error(
      'markAsRead error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error marking email as read.'
    });
  }
};

// ==========================================
// DELETE /api/emails/:id
// ==========================================

const deleteEmail = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid email ID.'
      });
    }

    const email =
      await Email.findById(req.params.id).select('userId user').lean();

    if (!email) {
      return res.status(404).json({
        success: false,
        message:
          'Email not found.'
      });
    }

    const isOwner =
      (
        email.userId &&
        email.userId.toString() ===
          req.user._id.toString()
      ) ||
      (
        email.user &&
        email.user.toString() ===
          req.user._id.toString()
      );

    const isAdmin =
      req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied.'
      });
    }

    await Email.findByIdAndDelete(
      req.params.id
    );

    return res.status(200).json({
      success: true,
      message:
        'Email deleted successfully.'
    });
  } catch (error) {
    console.error(
      'deleteEmail error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error deleting email.'
    });
  }
};

// ==========================================
// GET /api/emails/thread/:conversationId
// ==========================================

const getEmailThread = async (req, res) => {
  try {
    const {
      conversationId
    } = req.params;

    if (
      !isValidObjectId(conversationId)
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid conversation ID.'
      });
    }

    const emails =
      await Email.find({
        conversationId
      })
        .populate(
          'userId',
          'name email role avatar'
        )
        .populate(
          'contactId',
          'name firstName lastName email phone company'
        )
        .populate(
          'contact',
          'name firstName lastName email phone company'
        )
        .sort({
          createdAt: 1
        })
        .lean();

    const formatted =
      emails.map(safeEmail);

    return res.status(200).json({
      success: true,
      emails: formatted,
      data: formatted
    });
  } catch (error) {
    console.error(
      'getEmailThread error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving email thread.'
    });
  }
};

// ==========================================
// Exports
// ==========================================

module.exports = {
  getEmails,
  getEmail,
  getEmailById: getEmail,

  sendEmail,
  createEmail: sendEmail,

  markAsRead,
  markEmailAsRead: markAsRead,

  deleteEmail,

  getEmailStats,
  getEmailThread
};