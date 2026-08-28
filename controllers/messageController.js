const mongoose = require('mongoose');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const { createNotification } = require('./notificationController');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// Safe user ref helper
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
      status: u.status !== undefined ? u.status : undefined,
      avatar: u.avatar !== undefined ? u.avatar : undefined
    };
  }
  return u;
};

// Safe message response helper
const safeMessage = (msg) => ({
  id: msg._id,
  _id: msg._id,
  conversationId: msg.conversation,
  sender: safeUserRef(msg.sender),
  recipient: safeUserRef(msg.recipient),
  body: msg.body || msg.message || '',
  message: msg.body || msg.message || '',
  messageType: msg.messageType || 'text',
  attachments: Array.isArray(msg.attachments) ? msg.attachments : [],
  isRead: msg.isRead,
  readAt: msg.readAt,
  createdAt: msg.createdAt,
  updatedAt: msg.updatedAt
});

// Helper to determine message type based on attachments
const determineMessageType = (attachments, defaultType = 'text') => {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return defaultType;
  }
  const first = attachments[0];
  const mime = String(first.mimeType || first.fileType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
};

// GET /api/messages/:conversationId (authenticated user)
const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    if (!isValidObjectId(conversationId)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation ID.' });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found.' });
    }

    const userRole = String(req.user?.role || '').toLowerCase();
    const isParticipant = Array.isArray(conversation.participants) &&
      conversation.participants.some((p) => p.toString() === req.user._id.toString());
    const isLegacyUser = conversation.userId &&
      conversation.userId.toString() === req.user._id.toString();

    if (!isParticipant && !isLegacyUser && userRole !== 'admin' && userRole !== 'manager') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You are not a participant in this conversation.'
      });
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [messages, total] = await Promise.all([
      Message.find({ conversation: conversationId })
        .populate('sender', 'name email role avatar')
        .populate('recipient', 'name email role avatar')
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limitNum),
      Message.countDocuments({ conversation: conversationId })
    ]);

    const formattedMessages = messages.map(safeMessage);

    res.status(200).json({
      success: true,
      messages: formattedMessages,
      data: formattedMessages,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 0
      }
    });
  } catch (error) {
    console.error('getMessages error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving messages.' });
  }
};

// GET /api/messages/detail/:id or GET /api/messages/single/:id (authenticated user)
const getMessageById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid message ID.' });
    }

    const message = await Message.findById(id)
      .populate('sender', 'name email role avatar')
      .populate('recipient', 'name email role avatar');

    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found.' });
    }

    const userRole = String(req.user?.role || '').toLowerCase();
    const isSender = message.sender && (message.sender._id ? message.sender._id.toString() : message.sender.toString()) === req.user._id.toString();
    const isRecipient = message.recipient && (message.recipient._id ? message.recipient._id.toString() : message.recipient.toString()) === req.user._id.toString();

    if (!isSender && !isRecipient && userRole !== 'admin' && userRole !== 'manager') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view this message.'
      });
    }

    const formatted = safeMessage(message);

    res.status(200).json({
      success: true,
      message: formatted,
      data: formatted
    });
  } catch (error) {
    console.error('getMessageById error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving message.' });
  }
};

// POST /api/messages or POST /api/messages/send (authenticated user + file support)
const sendMessage = async (req, res) => {
  try {
    const { conversationId, recipientId, to, body, message, content, messageType } = req.body;
    let rawAttachments = req.body.attachments;

    // Parse attachments if sent as stringified JSON in multipart/form-data
    if (typeof rawAttachments === 'string') {
      try {
        rawAttachments = JSON.parse(rawAttachments);
      } catch {
        rawAttachments = [];
      }
    }

    let parsedAttachments = Array.isArray(rawAttachments) ? [...rawAttachments] : [];

    // Process files uploaded via Multer (req.files)
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      const uploadedList = req.files.map((file) => ({
        url: `/uploads/${file.filename}`,
        filename: file.filename,
        originalName: file.originalname,
        fileType: file.mimetype.split('/')[0] || 'file',
        mimeType: file.mimetype,
        size: file.size
      }));
      parsedAttachments = [...parsedAttachments, ...uploadedList];
    } else if (req.file) {
      parsedAttachments.push({
        url: `/uploads/${req.file.filename}`,
        filename: req.file.filename,
        originalName: req.file.originalname,
        fileType: req.file.mimetype.split('/')[0] || 'file',
        mimeType: req.file.mimetype,
        size: req.file.size
      });
    }

    const text = body || message || content || '';

    if (!text.trim() && parsedAttachments.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Message content or at least one file attachment is required.'
      });
    }

    let conversation = null;
    const userRole = String(req.user?.role || '').toLowerCase();

    if (conversationId) {
      if (!isValidObjectId(conversationId)) {
        return res.status(400).json({ success: false, message: 'Invalid conversation ID.' });
      }
      conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        return res.status(404).json({ success: false, message: 'Conversation not found.' });
      }

      const isParticipant = Array.isArray(conversation.participants) &&
        conversation.participants.some((p) => p.toString() === req.user._id.toString());
      const isLegacyUser = conversation.userId &&
        conversation.userId.toString() === req.user._id.toString();

      if (!isParticipant && !isLegacyUser && userRole !== 'admin' && userRole !== 'manager') {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You are not a participant in this conversation.'
        });
      }
    } else if (recipientId || to) {
      const targetUserId = recipientId || to;
      if (!isValidObjectId(targetUserId)) {
        return res.status(400).json({ success: false, message: 'Invalid recipient ID.' });
      }
      if (targetUserId.toString() === req.user._id.toString()) {
        return res.status(400).json({ success: false, message: 'Cannot send message to yourself.' });
      }

      const targetUser = await User.findById(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ success: false, message: 'Recipient user not found.' });
      }

      conversation = await Conversation.findOne({
        participants: { $all: [req.user._id, targetUserId], $size: 2 }
      });

      if (!conversation) {
        conversation = await Conversation.create({
          participants: [req.user._id, targetUserId],
          status: 'open',
          channel: 'chat'
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'conversationId or recipientId is required.'
      });
    }

    // Determine recipient
    let resolvedRecipientId = null;
    if (Array.isArray(conversation.participants)) {
      const other = conversation.participants.find(
        (p) => p.toString() !== req.user._id.toString()
      );
      if (other) resolvedRecipientId = other;
    }

    const calculatedMessageType = messageType || determineMessageType(parsedAttachments, 'text');

    const now = new Date();
    const createdMessage = await Message.create({
      conversation: conversation._id,
      sender: req.user._id,
      recipient: resolvedRecipientId,
      body: text.trim(),
      message: text.trim(),
      messageType: calculatedMessageType,
      attachments: parsedAttachments,
      isRead: false,
      readAt: null
    });

    // Update conversation state preview
    const previewText = text.trim() || (calculatedMessageType === 'image' ? '📷 Photo' : '📎 Attachment');
    conversation.lastMessage = previewText;
    conversation.lastMessageType = calculatedMessageType;
    conversation.lastMessageAt = now;
    conversation.lastSender = req.user._id;
    await conversation.save();

    const populated = await Message.findById(createdMessage._id)
      .populate('sender', 'name email role avatar')
      .populate('recipient', 'name email role avatar');

    if (resolvedRecipientId && resolvedRecipientId.toString() !== req.user._id.toString()) {
      try {
        await createNotification({
          userId: resolvedRecipientId,
          type: 'message',
          title: 'New Message',
          message: `${req.user.name || 'A user'} sent you a message.`,
          relatedId: conversation._id,
          relatedType: 'Message',
          actionUrl: userRole === 'admin' ? '/admin/conversations' : userRole === 'manager' ? '/manager/conversations' : '/user/conversations',
          metadata: {
            conversationId: conversation._id,
            messageId: createdMessage._id,
            senderId: req.user._id,
            senderName: req.user.name
          }
        });
      } catch (notifErr) {
        console.error('Message notification error:', notifErr);
      }
    }

    const formattedMessage = safeMessage(populated);

    res.status(201).json({
      success: true,
      message: 'Message sent successfully.',
      data: formattedMessage,
      messageData: formattedMessage
    });
  } catch (error) {
    console.error('sendMessage error:', error);
    res.status(500).json({ success: false, message: 'Server error sending message.' });
  }
};

// PUT /api/messages/:id or PATCH /api/messages/:id (authenticated user)
const updateMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { body, message, content } = req.body;
    const newText = body || message || content;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid message ID.' });
    }

    const msg = await Message.findById(id);
    if (!msg) {
      return res.status(404).json({ success: false, message: 'Message not found.' });
    }

    const userRole = String(req.user?.role || '').toLowerCase();
    if (msg.sender.toString() !== req.user._id.toString() && userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only edit your own messages.'
      });
    }

    if (newText !== undefined) {
      if (!newText.trim() && (!Array.isArray(msg.attachments) || msg.attachments.length === 0)) {
        return res.status(400).json({ success: false, message: 'Message text cannot be empty.' });
      }
      msg.body = newText.trim();
      msg.message = newText.trim();
    }

    await msg.save();

    const populated = await Message.findById(msg._id)
      .populate('sender', 'name email role avatar')
      .populate('recipient', 'name email role avatar');

    const formatted = safeMessage(populated);

    res.status(200).json({
      success: true,
      message: 'Message updated successfully.',
      data: formatted
    });
  } catch (error) {
    console.error('updateMessage error:', error);
    res.status(500).json({ success: false, message: 'Server error updating message.' });
  }
};

// GET /api/messages/unread-count (authenticated user)
const getUnreadMessageCount = async (req, res) => {
  try {
    const unreadCount = await Message.countDocuments({
      recipient: req.user._id,
      isRead: false
    });

    res.status(200).json({
      success: true,
      unreadCount
    });
  } catch (error) {
    console.error('getUnreadMessageCount error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving unread count.' });
  }
};

// PUT /api/messages/read/:conversationId or PATCH /api/messages/read/:conversationId (authenticated user)
const markMessagesAsRead = async (req, res) => {
  try {
    const { conversationId } = req.params;

    if (!isValidObjectId(conversationId)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation ID.' });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found.' });
    }

    const userRole = String(req.user?.role || '').toLowerCase();
    const isParticipant = Array.isArray(conversation.participants) &&
      conversation.participants.some((p) => p.toString() === req.user._id.toString());
    const isLegacyUser = conversation.userId &&
      conversation.userId.toString() === req.user._id.toString();

    if (!isParticipant && !isLegacyUser && userRole !== 'admin' && userRole !== 'manager') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You are not a participant in this conversation.'
      });
    }

    const now = new Date();
    const result = await Message.updateMany(
      {
        conversation: conversationId,
        recipient: req.user._id,
        isRead: false
      },
      {
        isRead: true,
        readAt: now
      }
    );

    res.status(200).json({
      success: true,
      message: 'Messages marked as read.',
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('markMessagesAsRead error:', error);
    res.status(500).json({ success: false, message: 'Server error marking messages as read.' });
  }
};

// PUT /api/messages/single/:id/read or PUT /api/messages/:id/read or PUT /api/messages/messages/:messageId/read
const markSingleMessageAsRead = async (req, res) => {
  try {
    const messageId = req.params.messageId || req.params.id;

    if (!isValidObjectId(messageId)) {
      return res.status(400).json({ success: false, message: 'Invalid message ID.' });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found.' });
    }

    message.isRead = true;
    message.readAt = new Date();
    await message.save();

    const populated = await Message.findById(message._id)
      .populate('sender', 'name email role avatar')
      .populate('recipient', 'name email role avatar');

    const formatted = safeMessage(populated);

    res.status(200).json({
      success: true,
      message: 'Message marked as read.',
      data: formatted
    });
  } catch (error) {
    console.error('markSingleMessageAsRead error:', error);
    res.status(500).json({ success: false, message: 'Server error marking message as read.' });
  }
};

// DELETE /api/messages/:id (authenticated user)
const deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid message ID.' });
    }

    const message = await Message.findById(id);
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found.' });
    }

    const userRole = String(req.user?.role || '').toLowerCase();
    if (message.sender.toString() !== req.user._id.toString() && userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only delete your own messages.'
      });
    }

    await Message.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Message deleted successfully.'
    });
  } catch (error) {
    console.error('deleteMessage error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting message.' });
  }
};

module.exports = {
  getMessages,
  getMessageById,
  sendMessage,
  updateMessage,
  getUnreadMessageCount,
  markMessagesAsRead,
  markSingleMessageAsRead,
  deleteMessage
};