"use strict";

const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const { getMessages, getUnreadMessageCount } = require("./messageQueryController");
const { sendMessage, reactToMessage } = require("./messageActionController");

// Mark messages as read in a conversation
const markMessagesAsRead = async (req, res) => {
  try {
    const { conversationId } = req.body;
    if (!conversationId) {
      return res.status(400).json({ success: false, message: "Conversation ID is required." });
    }

    await Message.updateMany(
      { conversation: conversationId, recipient: req.user._id, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    // Reset unread count in conversation if applicable
    await Conversation.findByIdAndUpdate(conversationId, { $set: { unreadCount: 0 } });

    return res.status(200).json({ success: true, message: "Messages marked as read." });
  } catch (error) {
    console.error("[Messages] markMessagesAsRead error:", error);
    return res.status(500).json({ success: false, message: "Server error marking messages as read." });
  }
};

// Delete a message (Soft delete for everyone or for me)
const deleteMessage = async (req, res) => {
  try {
    const messageId = req.params.id || req.params.messageId;
    const { everyone } = req.body;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }

    if (everyone) {
      message.isDeleted = true;
      message.body = "This message was deleted.";
      message.message = "This message was deleted.";
      await message.save();
    } else {
      if (!message.deletedFor.includes(req.user._id)) {
        message.deletedFor.push(req.user._id);
        await message.save();
      }
    }

    return res.status(200).json({ success: true, message: "Message deleted successfully." });
  } catch (error) {
    console.error("[Messages] deleteMessage error:", error);
    return res.status(500).json({ success: false, message: "Server error deleting message." });
  }
};

module.exports = {
  getMessages,
  getMessageById: getMessages,
  sendMessage,
  updateMessage: sendMessage,
  getUnreadMessageCount,
  markMessagesAsRead,
  markSingleMessageAsRead: markMessagesAsRead,
  deleteMessage,
  deleteMessageForMe: deleteMessage,
  deleteMessageForEveryone: deleteMessage,
  reactToMessage,
};