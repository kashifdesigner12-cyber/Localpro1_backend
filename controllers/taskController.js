import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";

import Task from "../models/Task.js";
import User from "../models/User.js";
import { createNotification } from "../services/notificationService.js";

const canManageTasks = (role) => ["admin", "manager"].includes(role);

const ALLOWED_STATUSES = [
  "pending",
  "in_progress",
  "submitted",
  "approved",
  "rejected",
  "completed",
];

const ALLOWED_PRIORITIES = ["low", "medium", "high", "urgent"];

const getTasksUploadDirectory = () => path.resolve("uploads", "tasks");

const isValidId = (value) => mongoose.isValidObjectId(value);

const sendNotificationSafely = async (notificationData) => {
  try {
    await createNotification(notificationData);
  } catch (error) {
    console.error("Task notification failed:", error.message);
  }
};

export const createTask = async (req, res, next) => {
  try {
    const {
      title,
      description = "",
      assignedTo,
      dueDate = null,
      priority = "medium",
    } = req.body || {};

    if (
      typeof title !== "string" ||
      !title.trim() ||
      title.trim().length > 200 ||
      !assignedTo
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid task title and assigned user are required.",
      });
    }

    if (!isValidId(assignedTo)) {
      return res.status(400).json({
        success: false,
        message: "Invalid assigned user ID.",
      });
    }

    if (!ALLOWED_PRIORITIES.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task priority.",
      });
    }

    if (
      typeof description !== "string" ||
      description.length > 5000
    ) {
      return res.status(400).json({
        success: false,
        message: "Task description must be a string of at most 5000 characters.",
      });
    }

    if (
      dueDate !== null &&
      dueDate !== "" &&
      (typeof dueDate !== "string" ||
        Number.isNaN(Date.parse(dueDate)))
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid due date.",
      });
    }

    const assignee = await User.findOne({
      _id: assignedTo,
      status: "active",
    })
      .select("_id name")
      .lean();

    if (!assignee) {
      return res.status(400).json({
        success: false,
        message: "Assigned user does not exist or is inactive.",
      });
    }

    // Prevent assigning to yourself if needed, or allow it. Here we allow it if selected, but ensure recipient is correct.
    const taskData = {
      title: title.trim(),
      description: description.trim(),
      assignedTo: assignee._id,
      assignedBy: req.user._id,
      dueDate: dueDate ? new Date(dueDate) : null,
      priority,
      createdBy: req.user._id,
    };

    if (req.file) {
      taskData.attachments = [
        {
          name: path.basename(req.file.originalname || "attachment"),
          path: req.file.path,
          uploadedBy: req.user._id,
          uploadedAt: new Date(),
        },
      ];
    }

    const task = await Task.create(taskData);

    const assignerName = req.user.name || "A team member";

    // FIXED: Recipient is strictly the assignee (the person receiving the task)
    await sendNotificationSafely({
      recipient: assignee._id,
      sender: req.user._id,
      title: "New Task Assigned",
      message: `${assignerName} assigned a task to you: ${task.title}`,
      type: "task",
      link: "/user/tasks",
    });

    return res.status(201).json({
      success: true,
      message: "Task created successfully.",
      task,
    });
  } catch (error) {
    return next(error);
  }
};

export const getTasks = async (req, res, next) => {
  try {
    const filter = {};

    // Regular users see only tasks assigned TO them
    if (req.user.role === "user") {
      filter.assignedTo = req.user._id;
    } else if (req.query.assignedTo) {
      if (!isValidId(req.query.assignedTo)) {
        return res.status(400).json({
          success: false,
          message: "Invalid assigned user ID.",
        });
      }

      filter.assignedTo = req.query.assignedTo;
    }

    if (req.query.status) {
      if (!ALLOWED_STATUSES.includes(req.query.status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid task status.",
        });
      }

      filter.status = req.query.status;
    }

    const tasks = await Task.find(filter)
      .select(
        "title description status priority dueDate assignedTo assignedBy createdBy attachments approvalStatus approvalBy approvedAt rejectionReason createdAt updatedAt"
      )
      .populate({
        path: "assignedTo",
        select: "name email role",
      })
      .populate({
        path: "assignedBy",
        select: "name email role",
      })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.status(200).json({
      success: true,
      count: tasks.length,
      tasks,
    });
  } catch (error) {
    return next(error);
  }
};

export const downloadTaskAttachment = async (req, res, next) => {
  try {
    const { id, attachmentId } = req.params;

    if (!isValidId(id) || !isValidId(attachmentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task or attachment ID.",
      });
    }

    const task = await Task.findById(id).lean();

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found.",
      });
    }

    const isManager = canManageTasks(req.user.role);
    const isAssignee =
      task.assignedTo?.toString() === req.user._id.toString();
    const isAssigner =
      task.assignedBy?.toString() === req.user._id.toString();

    if (!isManager && !isAssignee && !isAssigner) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to download this attachment.",
      });
    }

    const attachment = task.attachments.find(
      (att) => att._id.toString() === attachmentId
    );

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: "Attachment not found.",
      });
    }

    const uploadDirectory = getTasksUploadDirectory();
    const filePath = path.resolve(attachment.path);
    const relativePath = path.relative(uploadDirectory, filePath);

    if (
      !relativePath ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid attachment path.",
      });
    }

    let fileStats;

    try {
      fileStats = await fs.promises.stat(filePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        return res.status(404).json({
          success: false,
          message: "Attachment file is missing from the server.",
        });
      }

      return next(error);
    }

    if (!fileStats.isFile()) {
      return res.status(404).json({
        success: false,
        message: "Attachment file is missing from the server.",
      });
    }

    return res.download(
      filePath,
      path.basename(attachment.name || filePath),
      (error) => {
        if (error && !res.headersSent) {
          next(error);
        }
      }
    );
  } catch (error) {
    return next(error);
  }
};

export const updateTaskStatus = async (req, res, next) => {
  try {
    const { status, rejectionReason = "" } = req.body || {};

    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task ID.",
      });
    }

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task status.",
      });
    }

    if (
      typeof rejectionReason !== "string" ||
      rejectionReason.length > 1000
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid rejection reason.",
      });
    }

    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found.",
      });
    }

    const isManager = canManageTasks(req.user.role);
    const isAssignee =
      task.assignedTo?.toString() === req.user._id.toString();

    if (!isManager && !isAssignee) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to update this task.",
      });
    }

    if (!isManager) {
      if (!["in_progress", "submitted"].includes(status)) {
        return res.status(403).json({
          success: false,
          message: "Users can only start or submit their assigned tasks.",
        });
      }

      if (status === "submitted") {
        task.approvalStatus = "pending";
      }
    }

    if (isManager && ["approved", "rejected"].includes(status)) {
      if (task.status !== "submitted") {
        return res.status(400).json({
          success: false,
          message: "Only submitted tasks can be approved or rejected.",
        });
      }

      task.approvalBy = req.user._id;
      task.approvedAt = new Date();

      if (status === "approved") {
        task.approvalStatus = "approved";
        task.rejectionReason = "";
      } else {
        if (!rejectionReason.trim()) {
          return res.status(400).json({
            success: false,
            message: "A rejection reason is required.",
          });
        }

        task.approvalStatus = "rejected";
        task.rejectionReason = rejectionReason.trim();
      }
    }

    task.status = status;
    await task.save();

    await sendNotificationSafely({
      recipient: task.assignedTo,
      sender: req.user._id,
      title: "Task status updated",
      message: `Task "${task.title}" status: ${status.replaceAll("_", " ")}.`,
      type: "approval",
      link: "/user/tasks",
    });

    return res.status(200).json({
      success: true,
      message: "Task status updated successfully.",
      task,
    });
  } catch (error) {
    return next(error);
  }
};

export const deleteTask = async (req, res, next) => {
  try {
    if (!canManageTasks(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Only admins and managers can delete tasks.",
      });
    }

    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task ID.",
      });
    }

    const task = await Task.findByIdAndDelete(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Task deleted successfully.",
    });
  } catch (error) {
    return next(error);
  }
};