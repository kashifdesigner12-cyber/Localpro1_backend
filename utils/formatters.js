"use strict";
const { toId, safeUserRef } = require("./chatHelpers");

const safeConversation = (conversation, unreadCount = 0) => {
  if (!conversation) return null;
  return {
    id: String(conversation._id),
    _id: String(conversation._id),
    isGroup: Boolean(conversation.isGroup),
    groupName: conversation.groupName || "",
    groupAvatar: conversation.groupAvatar || "",
    groupAdmin: safeUserRef(conversation.groupAdmin),
    participants: Array.isArray(conversation.participants)
      ? conversation.participants.map(safeUserRef)
      : [],
    lastMessage: conversation.lastMessage || "",
    lastMessageAt: conversation.lastMessageAt || conversation.updatedAt || null,
    lastMessageType: conversation.lastMessageType || "text",
    lastSender: safeUserRef(conversation.lastSender),
    unreadCount: Number(unreadCount) || 0,
    status: conversation.status || "open",
    isArchived: conversation.status === "archived",
    channel: conversation.channel || "chat",
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
};

const safeMessage = (message, currentUserId = null) => {
  if (!message) return null;
  const deletedFor = Array.isArray(message.deletedFor) ? message.deletedFor.map(String) : [];
  const deletedForMe = currentUserId != null && deletedFor.includes(String(currentUserId));
  const deletedForEveryone = Boolean(message.isDeletedForEveryone);
  const body = deletedForEveryone ? "This message was deleted" : message.body || message.message || "";
  return {
    id: String(message._id),
    _id: String(message._id),
    conversationId: toId(message.conversation),
    sender: safeUserRef(message.sender),
    recipient: safeUserRef(message.recipient),
    body,
    message: body,
    messageType: deletedForEveryone ? "text" : message.messageType || "text",
    attachments: deletedForEveryone ? [] : Array.isArray(message.attachments) ? message.attachments : [],
    isRead: Boolean(message.isRead),
    readAt: message.readAt || null,
    reactions: Array.isArray(message.reactions)
      ? message.reactions
      : Array.isArray(message.metadata?.reactions)
        ? message.metadata.reactions
        : [],
    isDeletedForEveryone: deletedForEveryone,
    isDeletedForMe: deletedForMe,
    clientMessageId: message.clientMessageId || message.metadata?.clientMessageId || null,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
};

module.exports = { safeConversation, safeMessage };