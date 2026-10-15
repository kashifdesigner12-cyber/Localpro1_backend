"use strict";

const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const User = require("../models/User");

const MAX_TITLE_LENGTH = 160;
const MAX_MESSAGE_LENGTH = 2000;
const VALID_RELATED_TYPES = new Set([
  "Conversation",
  "Message",
  "User",
  "System",
]);

function validObjectId(value) {
  return Boolean(value && mongoose.Types.ObjectId.isValid(String(value)));
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function safeActionUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const url = value.trim();

  // Only allow same-origin relative paths or explicit HTTP(S) URLs.
  if (url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\")) {
    return url.slice(0, 500);
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.toString().slice(0, 500);
    }
  } catch {
    // Invalid URLs are omitted.
  }

  return "";
}

/**
 * Creates a notification for one recipient.
 * `io` is optional; when supplied, the notification is emitted to that
 * recipient's private room only after the database write succeeds.
 */
async function createChatNotification({
  recipientId,
  senderId = null,
  title,
  message,
  type = "message",
  relatedId = null,
  relatedType = "Conversation",
  actionUrl = "",
  metadata = {},
  io = null,
}) {
  if (!validObjectId(recipientId)) {
    return { success: false, reason: "invalid_recipient" };
  }

  if (senderId && !validObjectId(senderId)) {
    return { success: false, reason: "invalid_sender" };
  }

  const safeTitle = cleanText(title, MAX_TITLE_LENGTH);
  const safeMessage = cleanText(message, MAX_MESSAGE_LENGTH);

  if (!safeTitle || !safeMessage) {
    return { success: false, reason: "invalid_content" };
  }

  if (senderId && String(senderId) === String(recipientId)) {
    return { success: false, reason: "self_notification_skipped" };
  }

  if (relatedId && !validObjectId(relatedId)) {
    return { success: false, reason: "invalid_related_id" };
  }

  const safeRelatedType = VALID_RELATED_TYPES.has(relatedType)
    ? relatedType
    : "Conversation";

  // Do not accept arbitrary object payloads from clients. Store a shallow,
  // bounded metadata object containing primitive values only.
  const safeMetadata = {};
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    for (const [key, value] of Object.entries(metadata).slice(0, 20)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) continue;
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      ) {
        safeMetadata[key] =
          typeof value === "string" ? value.slice(0, 300) : value;
      }
    }
  }

  try {
    // Verify the recipient still exists; never trust a client-supplied user ID.
    const recipientExists = await User.exists({ _id: recipientId });
    if (!recipientExists) {
      return { success: false, reason: "recipient_not_found" };
    }

    const notification = await Notification.create({
      user: recipientId,
      type: "message",
      title: safeTitle,
      message: safeMessage,
      isRead: false,
      readAt: null,
      relatedId: relatedId || null,
      relatedType: safeRelatedType,
      actionUrl: safeActionUrl(actionUrl),
      metadata: safeMetadata,
    });

    const result = {
      success: true,
      notification: {
        _id: String(notification._id),
        user: String(notification.user),
        type: notification.type,
        title: notification.title,
        message: notification.message,
        isRead: notification.isRead,
        relatedId: notification.relatedId
          ? String(notification.relatedId)
          : null,
        relatedType: notification.relatedType,
        actionUrl: notification.actionUrl,
        createdAt: notification.createdAt,
      },
    };

    if (io && typeof io.to === "function") {
      // The room is derived from the verified recipient ID only.
      io.to(String(recipientId)).emit("notification:new", result.notification);
    }

    return result;
  } catch (error) {
    console.error("[Chat Notification] Failed to create notification:", error.message);
    return { success: false, reason: "notification_failed" };
  }
}

/**
 * Notify conversation participants except the sender. Participant IDs are
 * read from MongoDB, not accepted as an arbitrary client list.
 */
async function notifyConversationParticipants({
  conversation,
  senderId,
  title = "New message",
  message,
  messageId = null,
  actionUrl = "",
  io = null,
}) {
  const sender = String(senderId || "");
  const participants = Array.isArray(conversation?.participants)
    ? conversation.participants
    : [];

  const recipients = [...new Set(
    participants
      .map((item) => String(item?._id || item))
      .filter((id) => validObjectId(id) && id !== sender)
  )];

  const results = [];
  for (const recipientId of recipients) {
    results.push(await createChatNotification({
      recipientId,
      senderId: validObjectId(sender) ? sender : null,
      title,
      message,
      type: "message",
      relatedId: messageId || conversation?._id || null,
      relatedType: messageId ? "Message" : "Conversation",
      actionUrl,
      metadata: { conversationId: String(conversation?._id || "") },
      io,
    }));
  }

  return results;
}

module.exports = {
  createChatNotification,
  notifyConversationParticipants,
};