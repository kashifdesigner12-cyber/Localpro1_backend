import { Router } from "express";

import {
  createTask,
  getTasks,
  updateTaskStatus,
  deleteTask,
  downloadTaskAttachment,
} from "../controllers/taskController.js";

import { protect } from "../middleware/authMiddleware.js";
import allowRoles from "../middleware/roleMiddleware.js";
import upload from "../middleware/uploadMiddleware.js";

const router = Router();

// All task routes require authentication.
router.use(protect);

// List tasks available to the authenticated user.
router.get("/", getTasks);

// Download an authorized task attachment.
router.get(
  "/:id/attachments/:attachmentId/download",
  downloadTaskAttachment
);

// All authenticated roles (admin, manager, user) can create/assign tasks.
router.post(
  "/",
  upload.single("attachment"),
  createTask
);

// Update task status with controller-level permission checks.
router.patch("/:id/status", updateTaskStatus);

// Only admins and managers can delete tasks.
router.delete(
  "/:id",
  allowRoles("admin", "manager"),
  deleteTask
);

export default router;