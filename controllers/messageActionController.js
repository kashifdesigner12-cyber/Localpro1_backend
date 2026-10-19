"use strict";

const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const { isValidObjectId, canAccessConversation, getUserRole } = require("../utils/messageHelpers");

const sendMessage = async (req, res) => {
  try {
    const { conversationId, body, message, content, messageType } = req.body;
    const currentUserId = String(req.user._id);

    const text = String(body ?? message ?? content ?? "").trim();
    if (!isValidObjectId(conversationId) || !text) {
      return res.status(400).json({ success: false, message: "Conversation ID and text message are required." });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found." });
    }

    let createdMessage = await Message.create({
      conversation: conversation._id,
      sender: req.user._id,
      body: text,
      message: text,
      messageType: messageType || "text",
      isRead: false,
    });

    // Populate sender details so frontend can render name/avatar instantly via socket
    createdMessage = await createdMessage.populate("sender", "name fullName email avatar profileImage role");

    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: { lastMessage: text, lastMessageAt: new Date(), lastSender: req.user._id } }
    );

    const io = req.app.get("io");
    if (io) {
      io.to(String(conversation._id)).emit("receive_message", {
        success: true,
        message: createdMessage,
      });
    }

    return res.status(201).json({ success: true, message: "Message sent.", data: createdMessage });
  } catch (error) {
    console.error("[Messages] sendMessage error:", error);
    return res.status(500).json({ success: false, message: "Server error sending message." });
  }
};

const reactToMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const emoji = String(req.body?.emoji || "").trim();

    if (!isValidObjectId(id) || !emoji) {
      return res.status(400).json({ success: false, message: "Valid message ID and emoji required." });
    }

    const msg = await Message.findById(id);
    if (!msg) return res.status(404).json({ success: false, message: "Message not found." });

    msg.reactions = [{ userId: String(req.user._id), emoji, createdAt: new Date() }];
    await msg.save();

    const io = req.app.get("io");
    if (io && msg.conversation) {
      io.to(String(msg.conversation)).emit("message_reaction_updated", { success: true, data: msg });
    }

    return res.status(200).json({ success: true, message: "Reaction updated.", data: msg });
  } catch (error) {
    console.error("[Messages] reactToMessage error:", error);
    return res.status(500).json({ success: false, message: "Server error updating reaction." });
  }
};

module.exports = { sendMessage, reactToMessage };