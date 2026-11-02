import Notification from "../models/Notification.js";
import { sendPushToUser } from "./pushNotificationService.js";
import User from "../models/User.js";

const getNotificationUrl = (role, link) => {
  const path = typeof link === "string" ? link : "";

  if (path.includes("attendance")) {
    return role === "user" ? "/user/attendance" : "/admin/attendance";
  }

  if (path.includes("tasks")) {
    return role === "user" ? "/user/tasks" : "/admin/tasks";
  }

  if (path.includes("leave")) {
    return role === "user" ? "/user/leaves" : "/admin/leaves";
  }

  return role === "user" ? "/user/dashboard" : "/admin";
};

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const sendPushInBackground = async ({
  recipient,
  title,
  message,
  type,
  link,
  notificationId,
}) => {
  try {
    const user = await User.findById(recipient)
      .select("role")
      .lean();

    if (!user) {
      return;
    }

    await sendPushToUser(recipient, {
      title,
      message,
      tag: `localpro-${type}-${notificationId}`,
      url: getNotificationUrl(user.role, link),
    });
  } catch (error) {
    console.error(
      "Desktop push notification failed:",
      error.message
    );
  }
};

export const createNotification = async ({
  recipient,
  sender = null,
  title,
  message,
  type = "system",
  link = "",
}) => {
  if (
    !recipient ||
    !isNonEmptyString(title) ||
    !isNonEmptyString(message)
  ) {
    throw new Error(
      "Recipient, title, and message are required for a notification."
    );
  }

  const allowedTypes = [
    "task",
    "attendance",
    "approval",
    "user",
    "system",
    "leave",
  ];

  if (!allowedTypes.includes(type)) {
    throw new Error("Invalid notification type.");
  }

  const cleanTitle = title.trim();
  const cleanMessage = message.trim();
  const cleanLink = typeof link === "string" ? link : "";

  // Save the in-app notification first.
  const notification = await Notification.create({
    recipient,
    sender,
    title: cleanTitle,
    message: cleanMessage,
    type,
    link: cleanLink,
    isRead: false,
  });

  // Emit the saved notification to the recipient's connected clients in real-time.
  try {
    const io = globalThis.__localProNotificationIO;

    if (io) {
      io.to(`user:${String(recipient)}`).emit(
        "notification:new",
        notification.toObject()
      );
    }
  } catch (error) {
    console.error(
      "Real-time notification emit failed:",
      error.message
    );
  }

  // Trigger desktop push notification in background without blocking API
  void sendPushInBackground({
    recipient,
    title: cleanTitle,
    message: cleanMessage,
    type,
    link: cleanLink,
    notificationId: notification._id,
  });

  return notification;
};

export default createNotification;