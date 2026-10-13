const mongoose = require('mongoose');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const { createNotification } = require('./notificationController');
const { sendMessageNotificationEmail } = require('../utils/sendEmail');

const isValidObjectId = (id) =>
  Boolean(id) && mongoose.Types.ObjectId.isValid(id);

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
      phone: u.phone !== undefined ? u.phone : undefined,
      role: u.role || '',
      status: u.status !== undefined ? u.status : undefined,
      avatar: cleanAvatar
    };
  }
  return u;
};

const safeMessage = (msg, currentUserId = null) => {
  if (!msg) return null;

  const isDeletedForEveryone = Boolean(msg.isDeletedForEveryone);
  const deletedForList = Array.isArray(msg.deletedFor)
    ? msg.deletedFor.map((id) => id.toString())
    : [];
  const isDeletedForMe = currentUserId
    ? deletedForList.includes(currentUserId.toString())
    : false;

  const displayBody = isDeletedForEveryone
    ? 'This message was deleted'
    : msg.body || msg.message || '';

  return {
    id: msg._id,
    _id: msg._id,
    conversationId: msg.conversation,
    sender: safeUserRef(msg.sender),
    recipient: safeUserRef(msg.recipient),
    body: displayBody,
    message: displayBody,
    messageType: isDeletedForEveryone ? 'text' : msg.messageType || 'text',
    attachments: isDeletedForEveryone
      ? []
      : Array.isArray(msg.attachments)
      ? msg.attachments
      : [],
    isRead: Boolean(msg.isRead),
    readAt: msg.readAt || null,
    isDeletedForEveryone: isDeletedForEveryone,
    isDeletedForMe: isDeletedForMe,
    deletedForEveryoneAt: msg.deletedForEveryoneAt || null,
    deletedBy: safeUserRef(msg.deletedBy),
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt
  };
};

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

const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    if (!isValidObjectId(conversationId)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation ID.' });
    }

    const conversation = await Conversation.findById(conversationId).select('participants userId').lean();
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

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const filter = {
      conversation: conversationId,
      deletedFor: { $ne: req.user._id }
    };

    const [messages, total] = await Promise.all([
      Message.find(filter)
        .populate('sender', 'name email role avatar')
        .populate('recipient', 'name email role avatar')
        .populate('deletedBy', 'name email role')
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Message.countDocuments(filter)
    ]);

    const formattedMessages = messages.map((m) => safeMessage(m, req.user._id));

    return res.status(200).json({
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
    return res.status(500).json({ success: false, message: 'Server error retrieving messages.' });
  }
};

const getMessageById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid message ID.' });
    }

    const message = await Message.findById(id)
      .populate('sender', 'name email role avatar')
      .populate('recipient', 'name email role avatar')
      .populate('deletedBy', 'name email role')
      .lean();

    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found.' });
    }

    if (
      Array.isArray(message.deletedFor) &&
      message.deletedFor.some((uid) => uid.toString() === req.user._id.toString())
    ) {
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

    const formatted = safeMessage(message, req.user._id);

    return res.status(200).json({
      success: true,
      message: formatted,
      data: formatted
    });
  } catch (error) {
    console.error('getMessageById error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving message.' });
  }
};

const sendMessage = async (req, res) => {
  try {
    const { conversationId, recipientId, to, body, message, content, messageType } = req.body;
    let rawAttachments = req.body.attachments;

    if (typeof rawAttachments === 'string') {
      try {
        rawAttachments = JSON.parse(rawAttachments);
      } catch {
        rawAttachments = [];
      }
    }

    let parsedAttachments = Array.isArray(rawAttachments) ? [...rawAttachments] : [];

    const incomingFiles = [];
    if (req.files) {
      if (Array.isArray(req.files)) {
        incomingFiles.push(...req.files);
      } else if (typeof req.files === 'object') {
        Object.values(req.files).forEach((fileArr) => {
          if (Array.isArray(fileArr)) incomingFiles.push(...fileArr);
          else if (fileArr) incomingFiles.push(fileArr);
        });
      }
    }
    if (req.file) {
      incomingFiles.push(req.file);
    }

    if (incomingFiles.length > 0) {
      const uploadedList = incomingFiles.map((file) => ({
        url: `/uploads/${file.filename}`,
        filename: file.filename,
        originalName: file.originalname,
        fileType: file.mimetype.split('/')[0] || 'file',
        mimeType: file.mimetype,
        size: file.size
      }));
      parsedAttachments = [...parsedAttachments, ...uploadedList];
    }

    const uniqueAttachments = [];
    const seenUrls = new Set();
    for (const att of parsedAttachments) {
      const identifier = att.url || att.filename;
      if (identifier && !seenUrls.has(identifier)) {
        seenUrls.add(identifier);
        uniqueAttachments.push(att);
      }
    }
    parsedAttachments = uniqueAttachments;

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

      const targetUser = await User.findById(targetUserId).select('_id role').lean();
      if (!targetUser) {
        return res.status(404).json({ success: false, message: 'Recipient user not found.' });
      }

      if (userRole !== 'admin' && userRole !== 'manager') {
        const targetRole = String(targetUser.role || '').toLowerCase();
        if (targetRole !== 'admin' && targetRole !== 'manager' && targetRole !== 'support') {
          return res.status(403).json({
            success: false,
            message: 'Access denied. Regular users can only message Admin or Support.'
          });
        }
      }

      conversation = await Conversation.findOne({
        participants: { $all: [req.user._id, targetUserId],$size: 2 }
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

    const previewText = text.trim() || (calculatedMessageType === 'image' ? '📷 Photo' : '📎 Attachment');
    conversation.lastMessage = previewText;
    conversation.lastMessageType = calculatedMessageType;
    conversation.lastMessageAt = now;
    conversation.lastSender = req.user._id;
    await conversation.save();

    const populated = await Message.findById(createdMessage._id)
      .populate('sender', 'name email role avatar')
      .populate('recipient', 'name email role avatar')
      .lean();

    const formattedMessage = safeMessage(populated, req.user._id);

    const io = req.app.get('io');
    if (io) {
      io.to(conversation._id.toString()).emit('receive_message', formattedMessage);
      io.to(conversation._id.toString()).emit('new_message', formattedMessage);

      if (Array.isArray(conversation.participants)) {
        conversation.participants.forEach((participantId) => {
          io.to(participantId.toString()).emit('notification', {
            type: 'message',
            title: `New message from ${req.user.name || 'Admin / Support'}`,
            message: previewText,
            conversationId: conversation._id,
            messageId: formattedMessage._id
          });
        });
      }
    }

    if (resolvedRecipientId && resolvedRecipientId.toString() !== req.user._id.toString()) {
      (async () => {
        try {
          await createNotification({
            userId: resolvedRecipientId,
            type: 'message',
            title: 'New Message',
            message: `${req.user.name || 'Admin'} sent you a message.`,
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

        try {
          const recipientUser = await User.findById(resolvedRecipientId).select('name email').lean();
          if (recipientUser && recipientUser.email) {
            await sendMessageNotificationEmail(
              recipientUser.email,
              recipientUser.name || 'User',
              req.user.name || 'Admin / Support',
              previewText
            );
          }
        } catch (emailErr) {
          console.error('Message notification email failed:', emailErr.message);
        }
      })();
    }

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully.',
      data: formattedMessage,
      messageData: formattedMessage
    });
  } catch (error) {
    console.error('sendMessage error:', error);
    return res.status(500).json({ success: false, message: 'Server error sending message.' });
  }
};

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

    if (msg.isDeletedForEveryone) {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit a deleted message.'
      });
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
      .populate('recipient', 'name email role avatar')
      .lean();

    const formatted = safeMessage(populated, req.user._id);

    const io = req.app.get('io');
    if (io) {
      io.to(msg.conversation.toString()).emit('message_updated', formatted);
    }

    return res.status(200).json({
      success: true,
      message: 'Message updated successfully.',
      data: formatted
    });
  } catch (error) {
    console.error('updateMessage error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating message.' });
  }
};

const getUnreadMessageCount = async (req, res) => {
  try {
    const unreadCount = await Message.countDocuments({
      recipient: req.user._id,
      isRead: false,
      deletedFor: { $ne: req.user._id }
    });

    return res.status(200).json({
      success: true,
      unreadCount
    });
  } catch (error) {
    console.error('getUnreadMessageCount error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving unread count.' });
  }
};

const markMessagesAsRead = async (req, res) => {
  try {
    const { conversationId } = req.params;

    if (!isValidObjectId(conversationId)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation ID.' });
    }

    const conversation = await Conversation.findById(conversationId).select('participants userId').lean();
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
        $set: {
          isRead: true,
          readAt: now
        }
      }
    );

    const io = req.app.get('io');
    if (io) {
      io.to(conversationId).emit('messages_read', { conversationId, readerId: req.user._id });
    }

    return res.status(200).json({
      success: true,
      message: 'Messages marked as read.',
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('markMessagesAsRead error:', error);
    return res.status(500).json({ success: false, message: 'Server error marking messages as read.' });
  }
};

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

    if (!message.isRead) {
      message.isRead = true;
      message.readAt = new Date();
      await message.save();
    }

    const populated = await Message.findById(message._id)
      .populate('sender', 'name email role avatar')
      .populate('recipient', 'name email role avatar')
      .lean();

    const formatted = safeMessage(populated, req.user._id);

    const io = req.app.get('io');
    if (io) {
      io.to(message.conversation.toString()).emit('message_read', formatted);
    }

    return res.status(200).json({
      success: true,
      message: 'Message marked as read.',
      data: formatted
    });
  } catch (error) {
    console.error('markSingleMessageAsRead error:', error);
    return res.status(500).json({ success: false, message: 'Server error marking message as read.' });
  }
};

const deleteMessageForMe = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid message ID.' });
    }

    const message = await Message.findById(id).select('_id').lean();
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found.' });
    }

    await Message.findByIdAndUpdate(id, {
      $addToSet: { deletedFor: req.user._id }
    });

    return res.status(200).json({
      success: true,
      message: 'Message deleted for you successfully.',
      messageId: id
    });
  } catch (error) {
    console.error('deleteMessageForMe error:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting message for you.' });
  }
};

const deleteMessageForEveryone = async (req, res) => {
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
    const isSender = message.sender.toString() === req.user._id.toString();

    if (!isSender && userRole !== 'admin' && userRole !== 'manager') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only the sender or an admin/manager can delete this message for everyone.'
      });
    }

    message.isDeletedForEveryone = true;
    message.deletedForEveryoneAt = new Date();
    message.deletedBy = req.user._id;
    message.body = 'This message was deleted';
    message.message = 'This message was deleted';
    message.attachments = [];
    await message.save();

    await Conversation.findOneAndUpdate(
      { _id: message.conversation, lastMessageAt: message.createdAt },
      { $set: { lastMessage: 'This message was deleted' } }
    );

    const populated = await Message.findById(message._id)
      .populate('sender', 'name email role avatar')
      .populate('recipient', 'name email role avatar')
      .populate('deletedBy', 'name email role')
      .lean();

    const formatted = safeMessage(populated, req.user._id);

    const io = req.app.get('io');
    if (io) {
      io.to(message.conversation.toString()).emit('message_deleted', formatted);
    }

    return res.status(200).json({
      success: true,
      message: 'Message deleted for everyone successfully.',
      data: formatted
    });
  } catch (error) {
    console.error('deleteMessageForEveryone error:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting message for everyone.' });
  }
};

const deleteMessage = async (req, res) => {
  try {
    const messageId = req.params.id;
    const deleteType = String(req.query.type || req.body.type || req.body.deleteType || '').toLowerCase();

    if (!isValidObjectId(messageId)) {
      return res.status(400).json({ success: false, message: 'Invalid message ID.' });
    }

    if (deleteType === 'me' || deleteType === 'for_me') {
      return deleteMessageForMe(req, res);
    }

    if (deleteType === 'everyone' || deleteType === 'for_everyone') {
      return deleteMessageForEveryone(req, res);
    }

    const message = await Message.findById(messageId).select('sender').lean();
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found.' });
    }

    const userRole = String(req.user?.role || '').toLowerCase();
    const isSender = message.sender.toString() === req.user._id.toString();

    if (isSender || userRole === 'admin' || userRole === 'manager') {
      return deleteMessageForEveryone(req, res);
    }

    return deleteMessageForMe(req, res);
  } catch (error) {
    console.error('deleteMessage error:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting message.' });
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
  deleteMessage,
  deleteMessageForMe,
  deleteMessageForEveryone
};