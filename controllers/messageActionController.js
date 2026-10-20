"use strict";

const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const { isValidObjectId } = require("../utils/messageHelpers");

const sendMessage = async (req, res) => {
  try {
    const { conversationId, body, message, content, messageType } = req.body;
    const text = String(body ?? message ?? content ?? "").trim();
    const files = req.files || (req.file ? [req.file] : []);

    if (!isValidObjectId(conversationId)) {
      return res.status(400).json({ success: false, message: "Valid Conversation ID is required." });
    }

    if (!text && files.length === 0) {
      return res.status(400).json({ success: false, message: "Conversation ID and text message or attachment are required." });
    }

    const conversation = await Conversation.findById(conversationId).select("_id");
    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found." });
    }

    // Process uploaded attachments safely
    const attachments = files.map(file => ({
      url: `/uploads/${file.filename || file.originalname}`,
      name: file.originalname,
      size: file.size,
      mimetype: file.mimetype
    }));

    let finalMessageType = messageType || "text";
    if (files.length > 0 && !messageType) {
      finalMessageType = files[0].mimetype?.startsWith("image/") ? "image" : "file";
    }

    let createdMessage = await Message.create({
      conversation: conversation._id,
      sender: req.user._id,
      body: text || (files.length > 0 ? `Sent ${files.length} attachment(s)` : ""),
      message: text || (files.length > 0 ? `Sent ${files.length} attachment(s)` : ""),
      messageType: finalMessageType,
      attachments: attachments,
      isRead: false,
    });

    // Populate sender details so frontend can render name/avatar instantly via socket
    createdMessage = await createdMessage.populate("sender", "name fullName email avatar profileImage role");

    // Non-blocking update for conversation last message to speed up response
    const lastMsgText = text || (files.length > 0 ? "Attachment" : "");
    Conversation.updateOne(
      { _id: conversation._id },
      { $set: { lastMessage: lastMsgText, lastMessageAt: new Date(), lastSender: req.user._id } }
    ).catch(err => console.error("Background conversation update error:", err));

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