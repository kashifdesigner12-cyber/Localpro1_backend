const mongoose = require("mongoose");
const Task = require("../models/Task");
const User = require("../models/User");
const { createNotification } = require("./notificationController");
const { sendTaskAssignedEmail, sendTaskCompletedEmail } = require("../utils/sendEmail");

// ============================================================
// CONSTANTS
// ============================================================

const VALID_PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const VALID_STATUSES = ["Pending", "In Progress", "Completed", "Cancelled"];

// ============================================================
// HELPERS
// ============================================================

const isValidObjectId = (id) =>
  Boolean(id) && mongoose.Types.ObjectId.isValid(id);

const getUserRole = (user) =>
  String(user?.role || "").trim().toLowerCase();

const isAdminOrManager = (user) => {
  const role = getUserRole(user);
  return role === "admin" || role === "manager";
};

const sameId = (a, b) => {
  if (!a || !b) return false;
  return String(a) === String(b);
};

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ============================================================
// SAFE USER (Sanitized Base64)
// ============================================================

const safeUserRef = (user) => {
  if (!user) return null;

  if (typeof user === "object" && user._id) {
    let cleanAvatar = user.avatar || null;
    if (typeof cleanAvatar === "string" && cleanAvatar.startsWith("data:image") && cleanAvatar.length > 500) {
      cleanAvatar = null;
    }

    return {
      id: user._id,
      _id: user._id,
      name: user.name || "",
      email: user.email || "",
      phone: user.phone !== undefined ? user.phone : undefined,
      role: user.role !== undefined ? user.role : undefined,
      status: user.status !== undefined ? user.status : undefined,
      avatar: cleanAvatar,
    };
  }

  return user;
};

// ============================================================
// SAFE CONTACT
// ============================================================

const safeContactRef = (contact) => {
  if (!contact) return null;

  if (typeof contact === "object" && contact._id) {
    const fullName =
      contact.name ||
      `${contact.firstName || ""} ${contact.lastName || ""}`.trim();

    return {
      id: contact._id,
      _id: contact._id,
      name: fullName,
      email: contact.email !== undefined ? contact.email : undefined,
      phone: contact.phone !== undefined ? contact.phone : undefined,
      company: contact.company !== undefined ? contact.company : undefined,
    };
  }

  return contact;
};

// ============================================================
// ATTACHMENTS NORMALIZER & SANITIZER
// ============================================================

const sanitizeAttachmentUrl = (url = "") => {
  if (typeof url === "string" && url.startsWith("data:") && url.length > 500) {
    return "/placeholder-file"; // Prevent MBs of base64 transfer in API responses
  }
  return String(url);
};

const normalizeAttachments = (attachments, userId = null) => {
  if (!Array.isArray(attachments)) return [];

  return attachments
    .filter(Boolean)
    .map((attachment) => {
      if (typeof attachment !== "object") return null;

      const url =
        attachment.url ||
        attachment.path ||
        attachment.secure_url ||
        "";

      return {
        url: sanitizeAttachmentUrl(url),
        filename: attachment.filename || attachment.originalname || "attachment",
        originalName: attachment.originalName || attachment.originalname || attachment.filename || "attachment",
        fileType: attachment.fileType || attachment.mimetype || "",
        size: Number(attachment.size) || 0,
        uploadedBy: attachment.uploadedBy || userId || null,
        uploadedAt: attachment.uploadedAt || new Date(),
      };
    })
    .filter((att) => att && att.url);
};

const getUploadedAttachments = (req) => {
  let files = [];

  if (req.file) {
    files = [req.file];
  } else if (Array.isArray(req.files)) {
    files = req.files;
  } else if (req.files && typeof req.files === "object") {
    files = Object.values(req.files).flat();
  }

  if (!files.length) return [];

  const userId = req.user?._id || null;

  return files
    .filter(Boolean)
    .map((file) => {
      const url =
        file.secure_url ||
        file.url ||
        (file.filename ? `/uploads/${file.filename}` : file.path) ||
        "";

      return {
        url: String(url),
        filename: file.filename || file.originalname || "attachment",
        originalName: file.originalname || file.filename || "attachment",
        fileType: file.mimetype || file.fileType || "",
        size: Number(file.size) || 0,
        uploadedBy: userId,
        uploadedAt: new Date(),
      };
    })
    .filter((att) => att.url);
};

const parseBodyAttachments = (attachments, userId = null) => {
  if (attachments === undefined || attachments === null || attachments === "") {
    return null;
  }

  if (Array.isArray(attachments)) {
    return normalizeAttachments(attachments, userId);
  }

  if (typeof attachments === "string") {
    try {
      const parsed = JSON.parse(attachments);
      if (Array.isArray(parsed)) {
        return normalizeAttachments(parsed, userId);
      }
      return [];
    } catch {
      return [];
    }
  }

  return [];
};

const getRequestAttachments = (req) => {
  const userId = req.user?._id || null;
  const bodyAttachments = parseBodyAttachments(req.body?.attachments, userId);
  const uploadedAttachments = getUploadedAttachments(req);

  return [...(bodyAttachments || []), ...uploadedAttachments];
};

// ============================================================
// SAFE TASK (Payload Guard)
// ============================================================

const safeTask = (task) => {
  if (!task) return null;

  const contactValue = task.contact || task.contactId || null;

  // Crucial: Sanitize attachments so heavy base64 strings don't bloat JSON payload
  const cleanAttachments = Array.isArray(task.attachments)
    ? task.attachments.map((attachment) => ({
        id: attachment._id,
        _id: attachment._id,
        url: sanitizeAttachmentUrl(attachment.url),
        filename: attachment.filename || "",
        originalName: attachment.originalName || attachment.filename || "",
        fileType: attachment.fileType || "",
        size: Number(attachment.size) || 0,
        uploadedBy: attachment.uploadedBy || null,
        uploadedAt: attachment.uploadedAt || null,
      }))
    : [];

  return {
    id: task._id,
    _id: task._id,

    title: task.title || "",
    description: task.description || "",
    category: task.category || "General",

    createdBy: safeUserRef(task.createdBy),
    assignedTo: safeUserRef(task.assignedTo),
    contact: safeContactRef(contactValue),

    contactId: contactValue ? contactValue._id || contactValue : null,

    priority: task.priority || "Medium",
    status: task.status || "Pending",
    dueDate: task.dueDate || null,
    completedAt: task.completedAt || null,

    attachments: cleanAttachments,

    comments: Array.isArray(task.comments)
      ? task.comments.map((comment) => ({
          id: comment._id,
          _id: comment._id,
          user: safeUserRef(comment.user),
          text: comment.text || "",
          createdAt: comment.createdAt,
        }))
      : [],

    activity: Array.isArray(task.activity)
      ? task.activity.map((act) => ({
          id: act._id,
          _id: act._id,
          user: safeUserRef(act.user),
          action: act.action || "",
          details: act.details || "",
          timestamp: act.timestamp,
        }))
      : [],

    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
};

// ============================================================
// POPULATE HELPERS
// ============================================================

const populateTaskList = (query) => {
  return query
    .populate("createdBy", "name email role phone status avatar")
    .populate("assignedTo", "name email role phone status avatar")
    .populate("contact", "name firstName lastName email phone company");
};

const populateTask = (query) => {
  return query
    .populate("createdBy", "name email role phone status avatar")
    .populate("assignedTo", "name email role phone status avatar")
    .populate("contact", "name firstName lastName email phone company")
    .populate("comments.user", "name email role avatar")
    .populate("activity.user", "name email role avatar");
};

const getSortOption = (sort) => {
  switch (sort) {
    case "dueDate":
    case "due":
      return { dueDate: 1 };
    case "-dueDate":
      return { dueDate: -1 };
    case "oldest":
    case "createdAt":
      return { createdAt: 1 };
    case "newest":
    case "-createdAt":
      return { createdAt: -1 };
    case "priority":
      return { priority: 1 };
    case "-priority":
      return { priority: -1 };
    case "status":
      return { status: 1 };
    case "-status":
      return { status: -1 };
    default:
      return { createdAt: -1 };
  }
};

const getPagination = (page, limit) => {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  return { pageNum, limitNum, skip };
};

// ============================================================
// CREATE TASK
// ============================================================

const createTask = async (req, res) => {
  try {
    const {
      title,
      description,
      assignedTo,
      contact,
      contactId,
      priority,
      status,
      dueDate,
      category,
    } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, message: "Task title is required." });
    }

    const cleanTitle = String(title).trim();
    if (cleanTitle.length < 3) {
      return res.status(400).json({ success: false, message: "Title must be at least 3 characters long." });
    }

    const assigneeId = assignedTo || req.user._id;
    if (!isValidObjectId(assigneeId)) {
      return res.status(400).json({ success: false, message: "Invalid assigned user ID." });
    }

    const assignedUser = await User.findById(assigneeId).select("name email role status").lean();
    if (!assignedUser) {
      return res.status(404).json({ success: false, message: "Assigned user not found." });
    }

    const targetContactId = contact || contactId || null;
    if (targetContactId && !isValidObjectId(targetContactId)) {
      return res.status(400).json({ success: false, message: "Invalid contact ID." });
    }

    const taskPriority = priority || "Medium";
    if (!VALID_PRIORITIES.includes(taskPriority)) {
      return res.status(400).json({
        success: false,
        message: `Invalid priority. Allowed: ${VALID_PRIORITIES.join(", ")}.`,
      });
    }

    const taskStatus = status || "Pending";
    if (!VALID_STATUSES.includes(taskStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${VALID_STATUSES.join(", ")}.`,
      });
    }

    let parsedDueDate = null;
    if (dueDate !== undefined && dueDate !== null && dueDate !== "") {
      parsedDueDate = new Date(dueDate);
      if (Number.isNaN(parsedDueDate.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid due date." });
      }
    }

    const taskAttachments = getRequestAttachments(req);
    const initialActivity = [
      {
        user: req.user._id,
        action: "created",
        details: taskAttachments.length > 0
          ? `Task created with ${taskAttachments.length} attachment(s)`
          : "Task created",
        timestamp: new Date(),
      },
    ];

    const task = await Task.create({
      title: cleanTitle,
      description: description ? String(description).trim() : "",
      category: category ? String(category).trim() : "General",
      createdBy: req.user._id,
      assignedTo: assigneeId,
      contact: targetContactId,
      contactId: targetContactId,
      priority: taskPriority,
      status: taskStatus,
      dueDate: parsedDueDate,
      completedAt: taskStatus === "Completed" ? new Date() : null,
      attachments: taskAttachments,
      comments: [],
      activity: initialActivity,
    });

    if (!sameId(assigneeId, req.user._id)) {
      (async () => {
        try {
          await createNotification({
            userId: assigneeId,
            type: "task",
            title: "New Task Assigned",
            message: `A new task "${task.title}" has been assigned to you.`,
            relatedId: task._id,
            relatedType: "Task",
            actionUrl: "/dashboard/tasks",
            metadata: { taskId: task._id, title: task.title, priority: task.priority },
          });
        } catch (err) {
          console.error("Notification dispatch note:", err.message);
        }

        if (assignedUser && assignedUser.email) {
          try {
            await sendTaskAssignedEmail(
              assignedUser.email,
              assignedUser.name || "Team Member",
              req.user.name || "Admin",
              task.title,
              task.description,
              task.dueDate
            );
          } catch (err) {
            console.error("Email dispatch note:", err.message);
          }
        }
      })();
    }

    const populated = await populateTask(Task.findById(task._id)).lean();
    const formattedTask = safeTask(populated);

    return res.status(201).json({
      success: true,
      message: "Task created successfully.",
      task: formattedTask,
      data: formattedTask,
    });
  } catch (error) {
    console.error("createTask error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error creating task.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// ============================================================
// GET ALL TASKS (Optimized Lightweight Payload)
// ============================================================

const getAllTasks = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      priority,
      category,
      assignedTo,
      createdBy,
      contact,
      contactId,
      search,
      overdue,
      startDate,
      endDate,
      sort = "-createdAt",
    } = req.query;

    const filter = {};

    if (!isAdminOrManager(req.user)) {
      filter.$or = [
        { assignedTo: req.user._id },
        { createdBy: req.user._id },
      ];
    } else {
      if (assignedTo) {
        if (!isValidObjectId(assignedTo)) {
          return res.status(400).json({ success: false, message: "Invalid assignedTo filter ID." });
        }
        filter.assignedTo = assignedTo;
      }

      if (createdBy) {
        if (!isValidObjectId(createdBy)) {
          return res.status(400).json({ success: false, message: "Invalid createdBy filter ID." });
        }
        filter.createdBy = createdBy;
      }
    }

    const targetContact = contact || contactId;
    if (targetContact) {
      if (!isValidObjectId(targetContact)) {
        return res.status(400).json({ success: false, message: "Invalid contact filter ID." });
      }
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [{ contact: targetContact }, { contactId: targetContact }],
      });
    }

    if (category) filter.category = category;

    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status filter. Allowed: ${VALID_STATUSES.join(", ")}.`,
        });
      }
      filter.status = status;
    }

    if (priority) {
      if (!VALID_PRIORITIES.includes(priority)) {
        return res.status(400).json({
          success: false,
          message: `Invalid priority filter. Allowed: ${VALID_PRIORITIES.join(", ")}.`,
        });
      }
      filter.priority = priority;
    }

    if (search && String(search).trim()) {
      const regex = new RegExp(escapeRegex(String(search).trim()), "i");
      const searchCondition = {
        $or: [{ title: regex }, { description: regex }, { category: regex }],
      };

      if (filter.$or) {
        filter.$and = filter.$and || [];
        filter.$and.push({ $or: filter.$or });
        filter.$and.push(searchCondition);
        delete filter.$or;
      } else {
        filter.$or = searchCondition.$or;
      }
    }

    if (overdue === "true") {
      filter.$and = filter.$and || [];
      filter.$and.push({ dueDate: { $lt: new Date(), $ne: null } });
      filter.$and.push({ status: { $nin: ["Completed", "Cancelled"] } });
    }

    if (startDate || endDate) {
      const dueDateFilter = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) dueDateFilter.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          dueDateFilter.$lte = end;
        }
      }
      filter.dueDate = dueDateFilter;
    }

    const { pageNum, limitNum, skip } = getPagination(page, limit);

    // List query explicitly excludes heavy arrays & executes with .lean()
    const [tasks, total] = await Promise.all([
      populateTaskList(
        Task.find(filter)
          .select("-comments -activity")
          .sort(getSortOption(sort))
          .skip(skip)
          .limit(limitNum)
      ).lean(),
      Task.countDocuments(filter),
    ]);

    const formattedTasks = tasks.map(safeTask);

    return res.status(200).json({
      success: true,
      tasks: formattedTasks,
      data: formattedTasks,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 0,
      },
    });
  } catch (error) {
    console.error("getAllTasks error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error retrieving tasks.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// ============================================================
// GET TASK STATS
// ============================================================

const getTaskStats = async (req, res) => {
  try {
    const filter = {};

    if (!isAdminOrManager(req.user)) {
      filter.$or = [
        { assignedTo: req.user._id },
        { createdBy: req.user._id },
      ];
    }

    const now = new Date();

    const [
      total,
      pending,
      inProgress,
      completed,
      cancelled,
      overdue,
      aggregates,
    ] = await Promise.all([
      Task.countDocuments(filter),
      Task.countDocuments({ ...filter, status: "Pending" }),
      Task.countDocuments({ ...filter, status: "In Progress" }),
      Task.countDocuments({ ...filter, status: "Completed" }),
      Task.countDocuments({ ...filter, status: "Cancelled" }),
      Task.countDocuments({
        ...filter,
        dueDate: { $lt: now, $ne: null },
        status: { $nin: ["Completed", "Cancelled"] },
      }),
      Task.aggregate([
        { $match: filter },
        {
          $facet: {
            byPriority: [{ $group: { _id: "$priority", count: { $sum: 1 } } }],
            byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
            byAssignedUser: [{ $group: { _id: "$assignedTo", count: { $sum: 1 } } }],
          },
        },
      ]),
    ]);

    const stats = {
      total,
      pending,
      inProgress,
      completed,
      cancelled,
      overdue,
      byPriority: aggregates[0]?.byPriority || [],
      byStatus: aggregates[0]?.byStatus || [],
      byAssignedUser: aggregates[0]?.byAssignedUser || [],
    };

    return res.status(200).json({
      success: true,
      stats,
      data: stats,
    });
  } catch (error) {
    console.error("getTaskStats error:", error);
    return res.status(500).json({ success: false, message: "Server error retrieving task stats." });
  }
};

// ============================================================
// GET MY TASKS
// ============================================================

const getMyTasks = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      priority,
      sort = "-createdAt",
      search,
    } = req.query;

    const ownershipCondition = {
      $or: [
        { assignedTo: req.user._id },
        { createdBy: req.user._id },
      ],
    };

    const filter = { ...ownershipCondition };

    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status filter. Allowed: ${VALID_STATUSES.join(", ")}.`,
        });
      }
      filter.status = status;
    }

    if (priority) {
      if (!VALID_PRIORITIES.includes(priority)) {
        return res.status(400).json({
          success: false,
          message: `Invalid priority filter. Allowed: ${VALID_PRIORITIES.join(", ")}.`,
        });
      }
      filter.priority = priority;
    }

    if (search && String(search).trim()) {
      const regex = new RegExp(escapeRegex(String(search).trim()), "i");
      filter.$and = [
        ownershipCondition,
        { $or: [{ title: regex }, { description: regex }, { category: regex }] },
      ];
      delete filter.$or;
    }

    const { pageNum, limitNum, skip } = getPagination(page, limit);

    const [tasks, total] = await Promise.all([
      populateTaskList(
        Task.find(filter)
          .select("-comments -activity")
          .sort(getSortOption(sort))
          .skip(skip)
          .limit(limitNum)
      ).lean(),
      Task.countDocuments(filter),
    ]);

    const formattedTasks = tasks.map(safeTask);

    return res.status(200).json({
      success: true,
      tasks: formattedTasks,
      data: formattedTasks,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 0,
      },
    });
  } catch (error) {
    console.error("getMyTasks error:", error);
    return res.status(500).json({ success: false, message: "Server error retrieving your tasks." });
  }
};

// ============================================================
// GET TASK BY ID
// ============================================================

const getTaskById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid task ID." });
    }

    const task = await populateTask(Task.findById(id)).lean();

    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }

    const currentUserId = req.user._id;
    const isAssigned =
      task.assignedTo &&
      sameId(task.assignedTo._id || task.assignedTo, currentUserId);

    const isCreator =
      task.createdBy &&
      sameId(task.createdBy._id || task.createdBy, currentUserId);

    if (!isAdminOrManager(req.user) && !isAssigned && !isCreator) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only view tasks assigned to or created by you.",
      });
    }

    const formattedTask = safeTask(task);

    return res.status(200).json({
      success: true,
      task: formattedTask,
      data: formattedTask,
    });
  } catch (error) {
    console.error("getTaskById error:", error);
    return res.status(500).json({ success: false, message: "Server error retrieving task." });
  }
};

// ============================================================
// UPDATE TASK
// ============================================================

const updateTask = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid task ID." });
    }

    const task = await Task.findById(id);

    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }

    const currentUser = await User.findById(req.user._id).select("name email role").lean();

    if (!currentUser) {
      return res.status(401).json({ success: false, message: "Authenticated user no longer exists." });
    }

    const currentUserId = currentUser._id;
    const adminOrManager = isAdminOrManager(currentUser);
    const isAssignedUser = task.assignedTo && sameId(task.assignedTo, currentUserId);
    const isCreatorUser = task.createdBy && sameId(task.createdBy, currentUserId);

    if (!adminOrManager && !isAssignedUser && !isCreatorUser) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only update tasks assigned to or created by you.",
      });
    }

    const {
      title,
      description,
      assignedTo,
      contact,
      contactId,
      priority,
      status,
      dueDate,
      category,
    } = req.body;

    task.activity = task.activity || [];

    // Normal User Flow
    if (!adminOrManager) {
      const hasRestrictedFields =
        title !== undefined ||
        description !== undefined ||
        assignedTo !== undefined ||
        contact !== undefined ||
        contactId !== undefined ||
        priority !== undefined ||
        dueDate !== undefined ||
        category !== undefined ||
        req.body?.attachments !== undefined ||
        getUploadedAttachments(req).length > 0;

      if (hasRestrictedFields) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You can only update the status of your assigned tasks.",
        });
      }

      if (!isAssignedUser) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You can only update tasks assigned to you.",
        });
      }

      if (status === undefined || !VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Allowed: ${VALID_STATUSES.join(", ")}.`,
        });
      }

      const previousStatus = task.status;

      if (status === previousStatus) {
        const populated = await populateTask(Task.findById(task._id)).lean();
        const formattedTask = safeTask(populated);

        return res.status(200).json({
          success: true,
          message: "Task status is already set to this value.",
          task: formattedTask,
          data: formattedTask,
        });
      }

      const allowedTransitions = {
        Pending: ["In Progress", "Completed", "Cancelled"],
        "In Progress": ["Pending", "Completed", "Cancelled"],
        Completed: ["In Progress"],
        Cancelled: ["In Progress"],
      };

      const allowedNextStatuses = allowedTransitions[previousStatus] || [];

      if (!allowedNextStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status transition from ${previousStatus} to ${status}.`,
        });
      }

      task.status = status;
      task.activity.push({
        user: currentUserId,
        action: "status_changed",
        details: `Status changed from ${previousStatus} to ${status}`,
        timestamp: new Date(),
      });

      if (status === "Completed") {
        task.completedAt = new Date();
      } else if (previousStatus === "Completed") {
        task.completedAt = null;
      }

      await task.save();

      if (status === "Completed" && task.createdBy && !sameId(task.createdBy, currentUserId)) {
        (async () => {
          try {
            await createNotification({
              userId: task.createdBy,
              type: "task",
              title: "Task Completed",
              message: `The task "${task.title}" has been completed.`,
              relatedId: task._id,
              relatedType: "Task",
              actionUrl: "/dashboard/tasks",
              metadata: { taskId: task._id, title: task.title, completedBy: currentUserId },
            });
          } catch (err) {
            console.error("Task completion notification note:", err.message);
          }

          try {
            const creatorUser = await User.findById(task.createdBy).select("name email").lean();
            if (creatorUser && creatorUser.email) {
              await sendTaskCompletedEmail(
                creatorUser.email,
                creatorUser.name || "Manager",
                currentUser.name || "Team Member",
                task.title,
                task.completedAt || new Date()
              );
            }
          } catch (err) {
            console.error("Task completion email note:", err.message);
          }
        })();
      }

      const populated = await populateTask(Task.findById(task._id)).lean();
      const formattedTask = safeTask(populated);

      return res.status(200).json({
        success: true,
        message: "Task status updated successfully.",
        task: formattedTask,
        data: formattedTask,
      });
    }

    // Admin / Manager Flow
    if (title !== undefined) {
      const cleanTitle = String(title).trim();
      if (!cleanTitle) return res.status(400).json({ success: false, message: "Task title cannot be empty." });
      if (cleanTitle.length < 3) return res.status(400).json({ success: false, message: "Title must be at least 3 characters long." });
      task.title = cleanTitle;
    }

    if (description !== undefined) {
      task.description = description ? String(description).trim() : "";
    }

    if (category !== undefined) {
      task.category = category ? String(category).trim() : "General";
    }

    const bodyAttachments = parseBodyAttachments(req.body?.attachments, currentUserId);
    const uploadedAttachments = getUploadedAttachments(req);

    if (bodyAttachments !== null || uploadedAttachments.length > 0) {
      const existingAttachments = bodyAttachments !== null
        ? bodyAttachments
        : Array.isArray(task.attachments)
        ? task.attachments
        : [];

      task.attachments = [...existingAttachments, ...uploadedAttachments];

      if (uploadedAttachments.length > 0) {
        task.activity.push({
          user: currentUserId,
          action: "attachment_added",
          details: `Added ${uploadedAttachments.length} attachment(s)`,
          timestamp: new Date(),
        });
      }
    }

    let targetContact;
    if (contact !== undefined) targetContact = contact;
    else if (contactId !== undefined) targetContact = contactId;

    if (targetContact !== undefined) {
      if (targetContact === null || targetContact === "") {
        task.contact = null;
        task.contactId = null;
      } else {
        if (!isValidObjectId(targetContact)) {
          return res.status(400).json({ success: false, message: "Invalid contact ID." });
        }
        task.contact = targetContact;
        task.contactId = targetContact;
      }
    }

    let isReassigned = false;
    let newAssigneeUserObj = null;

    if (assignedTo !== undefined) {
      if (!assignedTo || !isValidObjectId(assignedTo)) {
        return res.status(400).json({ success: false, message: "Invalid assigned user ID." });
      }

      const newAssignee = await User.findById(assignedTo).select("name email role status").lean();
      if (!newAssignee) {
        return res.status(404).json({ success: false, message: "Assigned user not found." });
      }

      newAssigneeUserObj = newAssignee;
      const previousAssignee = task.assignedTo ? String(task.assignedTo) : null;

      if (previousAssignee !== String(newAssignee._id)) {
        task.assignedTo = newAssignee._id;
        isReassigned = true;
        task.activity.push({
          user: currentUserId,
          action: "reassigned",
          details: `Reassigned to ${newAssignee.name || "user"}`,
          timestamp: new Date(),
        });
      }
    }

    if (priority !== undefined) {
      if (!VALID_PRIORITIES.includes(priority)) {
        return res.status(400).json({ success: false, message: `Invalid priority. Allowed: ${VALID_PRIORITIES.join(", ")}.` });
      }

      if (priority !== task.priority) {
        task.activity.push({
          user: currentUserId,
          action: "priority_changed",
          details: `Priority changed from ${task.priority} to ${priority}`,
          timestamp: new Date(),
        });
        task.priority = priority;
      }
    }

    const previousStatus = task.status;
    let statusChanged = false;

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ success: false, message: `Invalid status. Allowed: ${VALID_STATUSES.join(", ")}.` });
      }

      if (status !== previousStatus) {
        task.status = status;
        statusChanged = true;
        task.activity.push({
          user: currentUserId,
          action: "status_changed",
          details: `Status changed from ${previousStatus} to ${status}`,
          timestamp: new Date(),
        });

        if (status === "Completed") {
          task.completedAt = new Date();
        } else if (previousStatus === "Completed") {
          task.completedAt = null;
        }
      }
    }

    if (dueDate !== undefined) {
      if (dueDate === null || dueDate === "") {
        task.dueDate = null;
      } else {
        const parsedDate = new Date(dueDate);
        if (Number.isNaN(parsedDate.getTime())) {
          return res.status(400).json({ success: false, message: "Invalid due date." });
        }
        task.dueDate = parsedDate;
      }
    }

    await task.save();

    // Fast non-blocking notifications
    (async () => {
      try {
        if (isReassigned && task.assignedTo && !sameId(task.assignedTo, currentUserId)) {
          await createNotification({
            userId: task.assignedTo,
            type: "task",
            title: "New Task Assigned",
            message: `A task "${task.title}" has been assigned to you.`,
            relatedId: task._id,
            relatedType: "Task",
            actionUrl: "/dashboard/tasks",
            metadata: { taskId: task._id, title: task.title, reassigned: true },
          });

          if (newAssigneeUserObj && newAssigneeUserObj.email) {
            try {
              await sendTaskAssignedEmail(
                newAssigneeUserObj.email,
                newAssigneeUserObj.name || "Team Member",
                currentUser.name || "Admin",
                task.title,
                task.description,
                task.dueDate
              );
            } catch (err) {
              console.error("Reassign email error:", err.message);
            }
          }
        }

        if (statusChanged) {
          if (task.status === "Completed" && task.createdBy && !sameId(task.createdBy, currentUserId)) {
            await createNotification({
              userId: task.createdBy,
              type: "task",
              title: "Task Completed",
              message: `The task "${task.title}" has been completed.`,
              relatedId: task._id,
              relatedType: "Task",
              actionUrl: "/dashboard/tasks",
              metadata: { taskId: task._id, title: task.title, completedBy: currentUserId },
            });

            try {
              const creatorUser = await User.findById(task.createdBy).select("name email").lean();
              if (creatorUser && creatorUser.email) {
                await sendTaskCompletedEmail(
                  creatorUser.email,
                  creatorUser.name || "Manager",
                  currentUser.name || "Team Member",
                  task.title,
                  task.completedAt || new Date()
                );
              }
            } catch (err) {
              console.error("Task complete email error:", err.message);
            }
          } else if (task.assignedTo && !sameId(task.assignedTo, currentUserId)) {
            await createNotification({
              userId: task.assignedTo,
              type: "task",
              title: "Task Status Updated",
              message: `The status of task "${task.title}" was updated to ${task.status}.`,
              relatedId: task._id,
              relatedType: "Task",
              actionUrl: "/dashboard/tasks",
              metadata: { taskId: task._id, title: task.title, status: task.status },
            });
          }
        }
      } catch (notifErr) {
        console.error("Update task notification error:", notifErr.message);
      }
    })();

    const populated = await populateTask(Task.findById(task._id)).lean();
    const formattedTask = safeTask(populated);

    return res.status(200).json({
      success: true,
      message: "Task updated successfully.",
      task: formattedTask,
      data: formattedTask,
    });
  } catch (error) {
    console.error("updateTask error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error updating task.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// ============================================================
// DELETE TASK
// ============================================================

const deleteTask = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid task ID." });
    }

    const task = await Task.findById(id).select("assignedTo createdBy").lean();

    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }

    const currentUserId = req.user._id;
    const isAssignedUser = task.assignedTo && sameId(task.assignedTo, currentUserId);
    const isCreatorUser = task.createdBy && sameId(task.createdBy, currentUserId);

    if (!isAdminOrManager(req.user) && !isAssignedUser && !isCreatorUser) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only delete tasks assigned to or created by you.",
      });
    }

    await Task.findByIdAndDelete(id);

    return res.status(200).json({ success: true, message: "Task deleted successfully." });
  } catch (error) {
    console.error("deleteTask error:", error);
    return res.status(500).json({ success: false, message: "Server error deleting task." });
  }
};

// ============================================================
// ADD COMMENT
// ============================================================

const addComment = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid task ID." });
    }

    const { text, comment } = req.body;
    const commentText = text !== undefined ? text : comment;

    if (!commentText || !String(commentText).trim()) {
      return res.status(400).json({ success: false, message: "Comment text is required." });
    }

    const trimmedComment = String(commentText).trim();
    const task = await Task.findById(id);

    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }

    const currentUserId = req.user._id;
    const isAllowed =
      isAdminOrManager(req.user) ||
      (task.assignedTo && sameId(task.assignedTo, currentUserId)) ||
      (task.createdBy && sameId(task.createdBy, currentUserId));

    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only comment on tasks assigned to or created by you.",
      });
    }

    task.comments = task.comments || [];
    task.activity = task.activity || [];

    task.comments.push({
      user: currentUserId,
      text: trimmedComment,
      createdAt: new Date(),
    });

    const preview = trimmedComment.length > 50
      ? `${trimmedComment.substring(0, 50)}...`
      : trimmedComment;

    task.activity.push({
      user: currentUserId,
      action: "comment_added",
      details: `Added a comment: "${preview}"`,
      timestamp: new Date(),
    });

    await task.save();

    let notifyTarget = task.assignedTo && sameId(task.assignedTo, currentUserId)
      ? task.createdBy
      : task.assignedTo;

    if (notifyTarget && !sameId(notifyTarget, currentUserId)) {
      (async () => {
        try {
          await createNotification({
            userId: notifyTarget,
            type: "task",
            title: "New Comment on Task",
            message: `${req.user.name || "A user"} commented on "${task.title}".`,
            relatedId: task._id,
            relatedType: "Task",
            actionUrl: "/dashboard/tasks",
            metadata: { taskId: task._id, title: task.title },
          });
        } catch (err) {
          console.error("Comment notification note:", err.message);
        }
      })();
    }

    const populated = await populateTask(Task.findById(task._id)).lean();
    const formattedTask = safeTask(populated);

    return res.status(201).json({
      success: true,
      message: "Comment added successfully.",
      comments: formattedTask.comments,
      data: formattedTask,
    });
  } catch (error) {
    console.error("addComment error:", error);
    return res.status(500).json({ success: false, message: "Server error adding comment." });
  }
};

// ============================================================
// GET COMMENTS
// ============================================================

const getComments = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid task ID." });
    }

    const task = await Task.findById(id)
      .populate("comments.user", "name email role avatar")
      .populate("assignedTo", "name email role")
      .populate("createdBy", "name email role")
      .lean();

    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }

    const currentUserId = req.user._id;
    const isAllowed =
      isAdminOrManager(req.user) ||
      (task.assignedTo && sameId(task.assignedTo._id || task.assignedTo, currentUserId)) ||
      (task.createdBy && sameId(task.createdBy._id || task.createdBy, currentUserId));

    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only view comments for tasks assigned to or created by you.",
      });
    }

    const comments = (task.comments || []).map((comment) => ({
      id: comment._id,
      _id: comment._id,
      user: safeUserRef(comment.user),
      text: comment.text || "",
      createdAt: comment.createdAt,
    }));

    return res.status(200).json({ success: true, comments, data: comments });
  } catch (error) {
    console.error("getComments error:", error);
    return res.status(500).json({ success: false, message: "Server error retrieving comments." });
  }
};

// ============================================================
// DELETE COMMENT
// ============================================================

const deleteComment = async (req, res) => {
  try {
    const { id, commentId } = req.params;

    if (!isValidObjectId(id) || !isValidObjectId(commentId)) {
      return res.status(400).json({ success: false, message: "Invalid ID provided." });
    }

    const task = await Task.findById(id);

    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }

    const currentUserId = req.user._id;
    const isTaskAllowed =
      isAdminOrManager(req.user) ||
      (task.assignedTo && sameId(task.assignedTo, currentUserId)) ||
      (task.createdBy && sameId(task.createdBy, currentUserId));

    if (!isTaskAllowed) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const comment = task.comments.id(commentId);

    if (!comment) {
      return res.status(404).json({ success: false, message: "Comment not found." });
    }

    const isCommentAuthor = comment.user && sameId(comment.user, currentUserId);
    const isAdmin = getUserRole(req.user) === "admin";

    if (!isCommentAuthor && !isAdmin) {
      return res.status(403).json({ success: false, message: "Access denied. You can only delete your own comments." });
    }

    task.comments.pull(commentId);
    task.activity = task.activity || [];
    task.activity.push({
      user: currentUserId,
      action: "comment_deleted",
      details: "Deleted a comment",
      timestamp: new Date(),
    });

    await task.save();

    return res.status(200).json({ success: true, message: "Comment deleted successfully." });
  } catch (error) {
    console.error("deleteComment error:", error);
    return res.status(500).json({ success: false, message: "Server error deleting comment." });
  }
};

// ============================================================
// REMOVE ATTACHMENT
// ============================================================

const removeAttachment = async (req, res) => {
  try {
    const { id, attachmentId } = req.params;

    if (!isValidObjectId(id) || !isValidObjectId(attachmentId)) {
      return res.status(400).json({ success: false, message: "Invalid ID provided." });
    }

    const task = await Task.findById(id);

    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }

    const currentUser = await User.findById(req.user._id).select("name email role").lean();
    const currentUserId = currentUser._id;
    const adminOrManager = isAdminOrManager(currentUser);
    const isCreatorUser = task.createdBy && sameId(task.createdBy, currentUserId);

    if (!adminOrManager && !isCreatorUser) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only managers or the task creator can remove attachments.",
      });
    }

    const attachment = task.attachments.id(attachmentId);

    if (!attachment) {
      return res.status(404).json({ success: false, message: "Attachment not found." });
    }

    const removedName = attachment.originalName || attachment.filename || "attachment";

    task.attachments.pull(attachmentId);
    task.activity = task.activity || [];
    task.activity.push({
      user: currentUserId,
      action: "attachment_removed",
      details: `Removed attachment: "${removedName}"`,
      timestamp: new Date(),
    });

    await task.save();

    const populated = await populateTask(Task.findById(task._id)).lean();
    const formattedTask = safeTask(populated);

    return res.status(200).json({
      success: true,
      message: "Attachment removed successfully.",
      task: formattedTask,
      data: formattedTask,
    });
  } catch (error) {
    console.error("removeAttachment error:", error);
    return res.status(500).json({ success: false, message: "Server error removing attachment." });
  }
};

module.exports = {
  createTask,
  getAllTasks,
  getMyTasks,
  getTaskById,
  updateTask,
  deleteTask,
  getTaskStats,
  addComment,
  getComments,
  deleteComment,
  removeAttachment,
};