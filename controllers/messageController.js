"use strict";

const { getMessages, getUnreadMessageCount } = require("./messageQueryController");
const { sendMessage, reactToMessage } = require("./messageActionController");

module.exports = {
  getMessages,
  getMessageById: getMessages,
  sendMessage,
  updateMessage: sendMessage,
  getUnreadMessageCount,
  markMessagesAsRead: (req, res) => res.status(200).json({ success: true }),
  markSingleMessageAsRead: (req, res) => res.status(200).json({ success: true }),
  deleteMessage: (req, res) => res.status(200).json({ success: true }),
  deleteMessageForMe: (req, res) => res.status(200).json({ success: true }),
  deleteMessageForEveryone: (req, res) => res.status(200).json({ success: true }),
  reactToMessage,
};