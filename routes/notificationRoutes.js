
import { Router } from "express";

import { protect } from "../middleware/authMiddleware.js";

import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} from "../controllers/notificationController.js";

const router = Router();

// All notification endpoints require authentication.
router.use(protect);

// List notifications with pagination and unread count.
router.get("/", getNotifications);

// Keep this route before /:id routes.
router.patch("/read-all", markAllNotificationsRead);

// Mark one notification as read.
router.patch("/:id/read", markNotificationRead);

// Delete one notification.
router.delete("/:id", deleteNotification);

export default router;
