const mongoose = require('mongoose');
const Task = require('../models/Task');
const User = require('../models/User');
const { createNotification } = require('./notificationController');

const isValidObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id);

const VALID_PRIORITIES = [
  'Low',
  'Medium',
  'High',
  'Urgent'
];

const VALID_STATUSES = [
  'Pending',
  'In Progress',
  'Completed',
  'Cancelled'
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const getUserRole = (user) =>
  String(user?.role || '').trim().toLowerCase();

const isAdminOrManager = (user) => {
  const role = getUserRole(user);
  return role === 'admin' || role === 'manager';
};

const safeUserRef = (user) => {
  if (!user) return null;

  if (typeof user === 'object' && user._id) {
    return {
      id: user._id,
      _id: user._id,
      name: user.name,
      email: user.email,
      phone:
        user.phone !== undefined
          ? user.phone
          : undefined,
      role: user.role,
      status:
        user.status !== undefined
          ? user.status
          : undefined,
      avatar:
        user.avatar !== undefined
          ? user.avatar
          : undefined
    };
  }

  return user;
};

const safeContactRef = (contact) => {
  if (!contact) return null;

  if (
    typeof contact === 'object' &&
    contact._id
  ) {
    return {
      id: contact._id,
      _id: contact._id,
      name:
        contact.name ||
        `${contact.firstName || ''} ${
          contact.lastName || ''
        }`.trim(),
      email:
        contact.email !== undefined
          ? contact.email
          : undefined,
      phone:
        contact.phone !== undefined
          ? contact.phone
          : undefined,
      company:
        contact.company !== undefined
          ? contact.company
          : undefined
    };
  }

  return contact;
};

const safeTask = (task) => ({
  id: task._id,
  _id: task._id,

  title: task.title,

  description:
    task.description || '',

  category:
    task.category || 'General',

  createdBy:
    safeUserRef(task.createdBy),

  assignedTo:
    safeUserRef(task.assignedTo),

  contact:
    safeContactRef(
      task.contact || task.contactId
    ),

  contactId: task.contact
    ? task.contact._id || task.contact
    : task.contactId
      ? task.contactId._id || task.contactId
      : null,

  priority: task.priority,

  status: task.status,

  dueDate:
    task.dueDate || null,

  completedAt:
    task.completedAt || null,

  attachments:
    Array.isArray(task.attachments)
      ? task.attachments
      : [],

  comments:
    Array.isArray(task.comments)
      ? task.comments.map((comment) => ({
          id: comment._id,
          _id: comment._id,
          user: safeUserRef(comment.user),
          text: comment.text,
          createdAt: comment.createdAt
        }))
      : [],

  activity:
    Array.isArray(task.activity)
      ? task.activity.map((activity) => ({
          id: activity._id,
          _id: activity._id,
          user: safeUserRef(activity.user),
          action: activity.action,
          details: activity.details,
          timestamp: activity.timestamp
        }))
      : [],

  createdAt:
    task.createdAt,

  updatedAt:
    task.updatedAt
});

const populateTask = (query) =>
  query
    .populate(
      'createdBy',
      'name email role phone status avatar'
    )
    .populate(
      'assignedTo',
      'name email role phone status avatar'
    )
    .populate(
      'contact',
      'name firstName lastName email phone company'
    )
    .populate(
      'comments.user',
      'name email role avatar'
    )
    .populate(
      'activity.user',
      'name email role avatar'
    );

const getSortOption = (sort) => {
  switch (sort) {
    case 'dueDate':
    case 'due':
      return { dueDate: 1 };

    case '-dueDate':
      return { dueDate: -1 };

    case 'oldest':
    case 'createdAt':
      return { createdAt: 1 };

    case 'newest':
    case '-createdAt':
      return { createdAt: -1 };

    case 'priority':
      return { priority: 1 };

    case '-priority':
      return { priority: -1 };

    case 'status':
      return { status: 1 };

    case '-status':
      return { status: -1 };

    default:
      return { createdAt: -1 };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE TASK
// POST /api/tasks
// ─────────────────────────────────────────────────────────────────────────────

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
      attachments
    } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Task title is required.'
      });
    }

    if (String(title).trim().length < 3) {
      return res.status(400).json({
        success: false,
        message:
          'Title must be at least 3 characters long.'
      });
    }

    const assigneeId =
      assignedTo || req.user._id;

    if (!isValidObjectId(assigneeId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid assigned user ID.'
      });
    }

    const assignedUser =
      await User.findById(assigneeId);

    if (!assignedUser) {
      return res.status(404).json({
        success: false,
        message: 'Assigned user not found.'
      });
    }

    const targetContactId =
      contact || contactId || null;

    if (
      targetContactId &&
      !isValidObjectId(targetContactId)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid contact ID.'
      });
    }

    if (
      priority &&
      !VALID_PRIORITIES.includes(priority)
    ) {
      return res.status(400).json({
        success: false,
        message:
          `Invalid priority. Allowed: ${VALID_PRIORITIES.join(', ')}.`
      });
    }

    if (
      status &&
      !VALID_STATUSES.includes(status)
    ) {
      return res.status(400).json({
        success: false,
        message:
          `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}.`
      });
    }

    let parsedDueDate = null;

    if (dueDate) {
      parsedDueDate = new Date(dueDate);

      if (isNaN(parsedDueDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid due date.'
        });
      }
    }

    const taskStatus =
      status || 'Pending';

    const initialActivity = [
      {
        user: req.user._id,
        action: 'created',
        details: 'Task created',
        timestamp: new Date()
      }
    ];

    const task = await Task.create({
      title: String(title).trim(),

      description: description
        ? String(description).trim()
        : '',

      category: category
        ? String(category).trim()
        : 'General',

      createdBy: req.user._id,

      assignedTo: assigneeId,

      contact: targetContactId,

      contactId: targetContactId,

      priority:
        priority || 'Medium',

      status: taskStatus,

      dueDate: parsedDueDate,

      completedAt:
        taskStatus === 'Completed'
          ? new Date()
          : null,

      attachments:
        Array.isArray(attachments)
          ? attachments
          : [],

      comments: [],

      activity: initialActivity
    });

    const populated =
      await populateTask(
        Task.findById(task._id)
      );

    if (
      assigneeId.toString() !==
      req.user._id.toString()
    ) {
      try {
        await createNotification({
          userId: assigneeId,
          type: 'task',
          title: 'New Task Assigned',
          message:
            `A new task "${task.title}" has been assigned to you.`,
          relatedId: task._id,
          relatedType: 'Task',
          actionUrl: '/dashboard/tasks',
          metadata: {
            taskId: task._id,
            title: task.title,
            priority: task.priority
          }
        });
      } catch (notifErr) {
        console.error(
          'Task notification error:',
          notifErr
        );
      }
    }

    const formattedTask =
      safeTask(populated);

    return res.status(201).json({
      success: true,
      message:
        'Task created successfully.',
      task: formattedTask,
      data: formattedTask
    });
  } catch (error) {
    console.error(
      'createTask error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error creating task.'
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET ALL TASKS
// GET /api/tasks
// ─────────────────────────────────────────────────────────────────────────────

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
      sort = '-createdAt'
    } = req.query;

    const filter = {};

    if (!isAdminOrManager(req.user)) {
      filter.$or = [
        {
          assignedTo: req.user._id
        },
        {
          createdBy: req.user._id
        }
      ];
    } else {
      if (assignedTo) {
        if (!isValidObjectId(assignedTo)) {
          return res.status(400).json({
            success: false,
            message:
              'Invalid assignedTo filter ID.'
          });
        }

        filter.assignedTo = assignedTo;
      }

      if (createdBy) {
        if (!isValidObjectId(createdBy)) {
          return res.status(400).json({
            success: false,
            message:
              'Invalid createdBy filter ID.'
          });
        }

        filter.createdBy = createdBy;
      }
    }

    const targetContact =
      contact || contactId;

    if (targetContact) {
      if (!isValidObjectId(targetContact)) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid contact filter ID.'
        });
      }

      filter.$and =
        filter.$and || [];

      filter.$and.push({
        $or: [
          {
            contact: targetContact
          },
          {
            contactId: targetContact
          }
        ]
      });
    }

    if (category) {
      filter.category = category;
    }

    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid status filter. Allowed: ${VALID_STATUSES.join(', ')}.`
        });
      }

      filter.status = status;
    }

    if (priority) {
      if (!VALID_PRIORITIES.includes(priority)) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid priority filter. Allowed: ${VALID_PRIORITIES.join(', ')}.`
        });
      }

      filter.priority = priority;
    }

    if (
      search &&
      String(search).trim()
    ) {
      const regex = new RegExp(
        String(search).trim(),
        'i'
      );

      const searchCondition = {
        $or: [
          {
            title: regex
          },
          {
            description: regex
          },
          {
            category: regex
          }
        ]
      };

      if (filter.$or) {
        filter.$and =
          filter.$and || [];

        filter.$and.push({
          $or: filter.$or
        });

        filter.$and.push(
          searchCondition
        );

        delete filter.$or;
      } else {
        filter.$or =
          searchCondition.$or;
      }
    }

    if (overdue === 'true') {
      filter.dueDate = {
        ...(filter.dueDate || {}),
        $lt: new Date()
      };

      filter.status = {
        $nin: [
          'Completed',
          'Cancelled'
        ]
      };
    }

    if (startDate || endDate) {
      filter.dueDate =
        filter.dueDate || {};

      if (startDate) {
        const start =
          new Date(startDate);

        if (isNaN(start.getTime())) {
          return res.status(400).json({
            success: false,
            message:
              'Invalid startDate.'
          });
        }

        filter.dueDate.$gte =
          start;
      }

      if (endDate) {
        const end =
          new Date(endDate);

        if (isNaN(end.getTime())) {
          return res.status(400).json({
            success: false,
            message:
              'Invalid endDate.'
          });
        }

        filter.dueDate.$lte =
          end;
      }
    }

    const pageNum =
      Math.max(
        1,
        parseInt(page) || 1
      );

    const limitNum =
      Math.min(
        100,
        Math.max(
          1,
          parseInt(limit) || 20
        )
      );

    const skip =
      (pageNum - 1) *
      limitNum;

    const [tasks, total] =
      await Promise.all([
        populateTask(
          Task.find(filter)
            .sort(
              getSortOption(sort)
            )
            .skip(skip)
            .limit(limitNum)
        ),

        Task.countDocuments(filter)
      ]);

    const formattedTasks =
      tasks.map(safeTask);

    return res.status(200).json({
      success: true,
      tasks: formattedTasks,
      data: formattedTasks,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages:
          Math.ceil(
            total / limitNum
          )
      }
    });
  } catch (error) {
    console.error(
      'getAllTasks error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving tasks.'
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET TASK STATS
// GET /api/tasks/stats
// ─────────────────────────────────────────────────────────────────────────────

const getTaskStats = async (req, res) => {
  try {
    const filter = {};

    if (!isAdminOrManager(req.user)) {
      filter.$or = [
        {
          assignedTo: req.user._id
        },
        {
          createdBy: req.user._id
        }
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
      byPriority,
      byStatus,
      byAssignedUser
    ] = await Promise.all([
      Task.countDocuments(filter),

      Task.countDocuments({
        ...filter,
        status: 'Pending'
      }),

      Task.countDocuments({
        ...filter,
        status: 'In Progress'
      }),

      Task.countDocuments({
        ...filter,
        status: 'Completed'
      }),

      Task.countDocuments({
        ...filter,
        status: 'Cancelled'
      }),

      Task.countDocuments({
        ...filter,
        dueDate: {
          $lt: now,
          $ne: null
        },
        status: {
          $nin: [
            'Completed',
            'Cancelled'
          ]
        }
      }),

      Task.aggregate([
        {
          $match: filter
        },
        {
          $group: {
            _id: '$priority',
            count: {
              $sum: 1
            }
          }
        }
      ]),

      Task.aggregate([
        {
          $match: filter
        },
        {
          $group: {
            _id: '$status',
            count: {
              $sum: 1
            }
          }
        }
      ]),

      Task.aggregate([
        {
          $match: filter
        },
        {
          $group: {
            _id: '$assignedTo',
            count: {
              $sum: 1
            }
          }
        }
      ])
    ]);

    const stats = {
      total,
      pending,
      inProgress,
      completed,
      cancelled,
      overdue,
      byPriority,
      byStatus,
      byAssignedUser
    };

    return res.status(200).json({
      success: true,
      stats,
      data: stats
    });
  } catch (error) {
    console.error(
      'getTaskStats error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving task stats.'
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET MY TASKS
// GET /api/tasks/my
// ─────────────────────────────────────────────────────────────────────────────

const getMyTasks = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      priority,
      sort = '-createdAt',
      search
    } = req.query;

    const userFilter = {
      $or: [
        {
          assignedTo: req.user._id
        },
        {
          createdBy: req.user._id
        }
      ]
    };

    const filter = {
      ...userFilter
    };

    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid status filter. Allowed: ${VALID_STATUSES.join(', ')}.`
        });
      }

      filter.status = status;
    }

    if (priority) {
      if (!VALID_PRIORITIES.includes(priority)) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid priority filter. Allowed: ${VALID_PRIORITIES.join(', ')}.`
        });
      }

      filter.priority = priority;
    }

    if (
      search &&
      String(search).trim()
    ) {
      const regex = new RegExp(
        String(search).trim(),
        'i'
      );

      filter.$and = [
        userFilter,
        {
          $or: [
            {
              title: regex
            },
            {
              description: regex
            },
            {
              category: regex
            }
          ]
        }
      ];

      delete filter.$or;
    }

    const pageNum =
      Math.max(
        1,
        parseInt(page) || 1
      );

    const limitNum =
      Math.min(
        100,
        Math.max(
          1,
          parseInt(limit) || 20
        )
      );

    const skip =
      (pageNum - 1) *
      limitNum;

    const [tasks, total] =
      await Promise.all([
        populateTask(
          Task.find(filter)
            .sort(
              getSortOption(sort)
            )
            .skip(skip)
            .limit(limitNum)
        ),

        Task.countDocuments(filter)
      ]);

    const formattedTasks =
      tasks.map(safeTask);

    return res.status(200).json({
      success: true,
      tasks: formattedTasks,
      data: formattedTasks,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages:
          Math.ceil(
            total / limitNum
          )
      }
    });
  } catch (error) {
    console.error(
      'getMyTasks error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving your tasks.'
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET TASK BY ID
// GET /api/tasks/:id
// ─────────────────────────────────────────────────────────────────────────────

const getTaskById = async (req, res) => {
  try {
    if (
      !isValidObjectId(
        req.params.id
      )
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task ID.'
      });
    }

    const task =
      await populateTask(
        Task.findById(
          req.params.id
        )
      );

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found.'
      });
    }

    const currentUserId =
      req.user._id.toString();

    const isAssigned =
      task.assignedTo &&
      task.assignedTo._id &&
      task.assignedTo._id.toString() ===
        currentUserId;

    const isCreator =
      task.createdBy &&
      task.createdBy._id &&
      task.createdBy._id.toString() ===
        currentUserId;

    if (
      !isAdminOrManager(req.user) &&
      !isAssigned &&
      !isCreator
    ) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. You can only view tasks assigned to or created by you.'
      });
    }

    const formattedTask =
      safeTask(task);

    return res.status(200).json({
      success: true,
      task: formattedTask,
      data: formattedTask
    });
  } catch (error) {
    console.error(
      'getTaskById error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving task.'
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE TASK
// PUT/PATCH /api/tasks/:id
// ─────────────────────────────────────────────────────────────────────────────

const updateTask = async (req, res) => {
  try {
    if (
      !isValidObjectId(
        req.params.id
      )
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task ID.'
      });
    }

    const task =
      await Task.findById(
        req.params.id
      );

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found.'
      });
    }

    const currentUser =
      await User.findById(
        req.user._id
      ).select('name role');

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message:
          'Authenticated user no longer exists.'
      });
    }

    const currentUserId =
      currentUser._id.toString();

    const adminOrManager =
      isAdminOrManager(
        currentUser
      );

    const isAssignedUser =
      task.assignedTo &&
      task.assignedTo.toString() ===
        currentUserId;

    const isCreatorUser =
      task.createdBy &&
      task.createdBy.toString() ===
        currentUserId;

    if (
      !adminOrManager &&
      !isAssignedUser &&
      !isCreatorUser
    ) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. You can only update tasks assigned to or created by you.'
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
      attachments
    } = req.body;

    task.activity =
      task.activity || [];

    // ─────────────────────────────────────
    // NORMAL USER
    // ─────────────────────────────────────

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
        attachments !== undefined;

      if (hasRestrictedFields) {
        return res.status(403).json({
          success: false,
          message:
            'Access denied. You can only update the status of your assigned tasks.'
        });
      }

      if (!isAssignedUser) {
        return res.status(403).json({
          success: false,
          message:
            'Access denied. You can only update tasks assigned to you.'
        });
      }

      if (
        !status ||
        !VALID_STATUSES.includes(status)
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}.`
        });
      }

      const previousStatus =
        task.status;

      if (
        status === previousStatus
      ) {
        const populated =
          await populateTask(
            Task.findById(
              task._id
            )
          );

        const formattedTask =
          safeTask(populated);

        return res.status(200).json({
          success: true,
          message:
            'Task status is already set to this value.',
          task: formattedTask,
          data: formattedTask
        });
      }

      const allowedTransitions = {
        Pending: [
          'In Progress',
          'Completed',
          'Cancelled'
        ],

        'In Progress': [
          'Pending',
          'Completed',
          'Cancelled'
        ],

        Completed: [
          'In Progress'
        ],

        Cancelled: [
          'In Progress'
        ]
      };

      const allowedNextStatuses =
        allowedTransitions[previousStatus] || [];

      if (
        !allowedNextStatuses.includes(status)
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid status transition from ${previousStatus} to ${status}.`
        });
      }

      task.status = status;

      task.activity.push({
        user: currentUserId,
        action: 'status_changed',
        details:
          `Status changed from ${previousStatus} to ${status}`,
        timestamp: new Date()
      });

      if (
        status === 'Completed'
      ) {
        task.completedAt =
          new Date();
      } else if (
        previousStatus === 'Completed'
      ) {
        task.completedAt = null;
      }

      await task.save();

      // Notify creator when assigned user completes task
      if (
        status === 'Completed' &&
        task.createdBy &&
        task.createdBy.toString() !==
          currentUserId
      ) {
        try {
          await createNotification({
            userId:
              task.createdBy,
            type:
              'task',
            title:
              'Task Completed',
            message:
              `The task "${task.title}" has been completed.`,
            relatedId:
              task._id,
            relatedType:
              'Task',
            actionUrl:
              '/dashboard/tasks',
            metadata: {
              taskId:
                task._id,
              title:
                task.title,
              completedBy:
                currentUser._id
            }
          });
        } catch (notifErr) {
          console.error(
            'Notification error in status update:',
            notifErr
          );
        }
      }

      const populated =
        await populateTask(
          Task.findById(
            task._id
          )
        );

      const formattedTask =
        safeTask(populated);

      return res.status(200).json({
        success: true,
        message:
          'Task status updated successfully.',
        task: formattedTask,
        data: formattedTask
      });
    }

    // ─────────────────────────────────────
    // ADMIN / MANAGER
    // ─────────────────────────────────────

    // TITLE
    if (title !== undefined) {
      if (
        !title ||
        !String(title).trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Task title cannot be empty.'
        });
      }

      if (
        String(title).trim().length < 3
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Title must be at least 3 characters long.'
        });
      }

      task.title =
        String(title).trim();
    }

    // DESCRIPTION
    if (description !== undefined) {
      task.description =
        description
          ? String(
              description
            ).trim()
          : '';
    }

    // CATEGORY
    if (category !== undefined) {
      task.category =
        category
          ? String(category).trim()
          : 'General';
    }

    // ATTACHMENTS
    if (
      attachments !== undefined
    ) {
      if (
        !Array.isArray(
          attachments
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Attachments must be an array.'
        });
      }

      task.attachments =
        attachments;
    }

    // CONTACT
    const targetContact =
      contact !== undefined
        ? contact
        : contactId;

    if (
      targetContact !== undefined
    ) {
      if (
        targetContact === null ||
        targetContact === ''
      ) {
        task.contact = null;
        task.contactId = null;
      } else {
        if (
          !isValidObjectId(
            targetContact
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Invalid contact ID.'
          });
        }

        task.contact =
          targetContact;

        task.contactId =
          targetContact;
      }
    }

    // REASSIGNMENT
    let isReassigned = false;

    if (
      assignedTo !== undefined
    ) {
      if (
        !assignedTo ||
        !isValidObjectId(
          assignedTo
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid assigned user ID.'
        });
      }

      const newAssignee =
        await User.findById(
          assignedTo
        );

      if (!newAssignee) {
        return res.status(404).json({
          success: false,
          message:
            'Assigned user not found.'
        });
      }

      const previousAssignee =
        task.assignedTo
          ? task.assignedTo.toString()
          : null;

      if (
        previousAssignee !==
        assignedTo.toString()
      ) {
        task.assignedTo =
          newAssignee._id;

        isReassigned = true;

        task.activity.push({
          user:
            currentUser._id,
          action:
            'reassigned',
          details:
            `Reassigned to ${newAssignee.name}`,
          timestamp:
            new Date()
        });
      }
    }

    // PRIORITY
    if (priority !== undefined) {
      if (
        !VALID_PRIORITIES.includes(
          priority
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid priority. Allowed: ${VALID_PRIORITIES.join(', ')}.`
        });
      }

      if (
        priority !==
        task.priority
      ) {
        task.activity.push({
          user:
            currentUser._id,
          action:
            'priority_changed',
          details:
            `Priority changed from ${task.priority} to ${priority}`,
          timestamp:
            new Date()
        });

        task.priority =
          priority;
      }
    }

    // STATUS
    const previousStatus =
      task.status;

    let statusChanged = false;

    if (status !== undefined) {
      if (
        !VALID_STATUSES.includes(
          status
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}.`
        });
      }

      if (
        status !== previousStatus
      ) {
        task.status =
          status;

        statusChanged = true;

        task.activity.push({
          user:
            currentUser._id,
          action:
            'status_changed',
          details:
            `Status changed from ${previousStatus} to ${status}`,
          timestamp:
            new Date()
        });

        if (
          status === 'Completed'
        ) {
          task.completedAt =
            new Date();
        } else if (
          previousStatus === 'Completed'
        ) {
          task.completedAt =
            null;
        }
      }
    }

    // DUE DATE
    if (
      dueDate !== undefined
    ) {
      if (
        dueDate === null ||
        dueDate === ''
      ) {
        task.dueDate = null;
      } else {
        const parsedDate =
          new Date(dueDate);

        if (
          isNaN(
            parsedDate.getTime()
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Invalid due date.'
          });
        }

        task.dueDate =
          parsedDate;
      }
    }

    await task.save();

    // ─────────────────────────────────────
    // NOTIFICATIONS
    // ─────────────────────────────────────

    try {
      if (
        isReassigned &&
        task.assignedTo &&
        task.assignedTo.toString() !==
          currentUserId
      ) {
        await createNotification({
          userId:
            task.assignedTo,

          type:
            'task',

          title:
            'New Task Assigned',

          message:
            `A task "${task.title}" has been assigned to you.`,

          relatedId:
            task._id,

          relatedType:
            'Task',

          actionUrl:
            '/dashboard/tasks',

          metadata: {
            taskId:
              task._id,

            title:
              task.title,

            reassigned:
              true
          }
        });
      }

      if (
        statusChanged
      ) {
        if (
          task.status ===
            'Completed' &&
          task.createdBy &&
          task.createdBy.toString() !==
            currentUserId
        ) {
          await createNotification({
            userId:
              task.createdBy,

            type:
              'task',

            title:
              'Task Completed',

            message:
              `The task "${task.title}" has been completed.`,

            relatedId:
              task._id,

            relatedType:
              'Task',

            actionUrl:
              '/dashboard/tasks',

            metadata: {
              taskId:
                task._id,

              title:
                task.title,

              completedBy:
                currentUser._id
            }
          });
        } else if (
          task.assignedTo &&
          task.assignedTo.toString() !==
            currentUserId
        ) {
          await createNotification({
            userId:
              task.assignedTo,

            type:
              'task',

            title:
              'Task Status Updated',

            message:
              `The status of task "${task.title}" was updated to ${task.status}.`,

            relatedId:
              task._id,

            relatedType:
              'Task',

            actionUrl:
              '/dashboard/tasks',

            metadata: {
              taskId:
                task._id,

              title:
                task.title,

              status:
                task.status
            }
          });
        }
      }
    } catch (notifErr) {
      console.error(
        'Notification error in updateTask:',
        notifErr
      );
    }

    const populated =
      await populateTask(
        Task.findById(
          task._id
        )
      );

    const formattedTask =
      safeTask(populated);

    return res.status(200).json({
      success: true,
      message:
        'Task updated successfully.',
      task: formattedTask,
      data: formattedTask
    });
  } catch (error) {
    console.error(
      'updateTask error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error updating task.'
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE TASK
// DELETE /api/tasks/:id
// ─────────────────────────────────────────────────────────────────────────────

const deleteTask = async (req, res) => {
  try {
    if (
      !isValidObjectId(
        req.params.id
      )
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task ID.'
      });
    }

    const task =
      await Task.findById(
        req.params.id
      );

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found.'
      });
    }

    const currentUserId =
      req.user._id.toString();

    const isAssignedUser =
      task.assignedTo &&
      task.assignedTo.toString() ===
        currentUserId;

    const isCreatorUser =
      task.createdBy &&
      task.createdBy.toString() ===
        currentUserId;

    if (
      !isAdminOrManager(req.user) &&
      !isAssignedUser &&
      !isCreatorUser
    ) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. You can only delete tasks assigned to or created by you.'
      });
    }

    await Task.findByIdAndDelete(
      req.params.id
    );

    return res.status(200).json({
      success: true,
      message:
        'Task deleted successfully.'
    });
  } catch (error) {
    console.error(
      'deleteTask error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error deleting task.'
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADD COMMENT
// POST /api/tasks/:id/comments
// ─────────────────────────────────────────────────────────────────────────────

const addComment = async (req, res) => {
  try {
    if (
      !isValidObjectId(
        req.params.id
      )
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task ID.'
      });
    }

    const {
      text,
      comment
    } = req.body;

    const commentText =
      text || comment;

    if (
      !commentText ||
      !String(commentText).trim()
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Comment text is required.'
      });
    }

    const task =
      await Task.findById(
        req.params.id
      );

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found.'
      });
    }

    const isAllowed =
      isAdminOrManager(
        req.user
      ) ||
      (
        task.assignedTo &&
        task.assignedTo.toString() ===
          req.user._id.toString()
      ) ||
      (
        task.createdBy &&
        task.createdBy.toString() ===
          req.user._id.toString()
      );

    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. You can only comment on tasks assigned to or created by you.'
      });
    }

    task.comments =
      task.comments || [];

    task.activity =
      task.activity || [];

    const trimmedComment =
      String(
        commentText
      ).trim();

    const newComment = {
      user:
        req.user._id,
      text:
        trimmedComment,
      createdAt:
        new Date()
    };

    task.comments.push(
      newComment
    );

    task.activity.push({
      user:
        req.user._id,
      action:
        'comment_added',
      details:
        `Added a comment: "${trimmedComment.substring(0, 50)}${trimmedComment.length > 50 ? '...' : ''}"`,
      timestamp:
        new Date()
    });

    await task.save();

    const notifyTarget =
      task.assignedTo &&
      task.assignedTo.toString() ===
        req.user._id.toString()
        ? task.createdBy
        : task.assignedTo;

    if (
      notifyTarget &&
      notifyTarget.toString() !==
        req.user._id.toString()
    ) {
      try {
        await createNotification({
          userId:
            notifyTarget,

          type:
            'task',

          title:
            'New Comment on Task',

          message:
            `${req.user.name || 'A user'} commented on "${task.title}".`,

          relatedId:
            task._id,

          relatedType:
            'Task',

          actionUrl:
            '/dashboard/tasks',

          metadata: {
            taskId:
              task._id,

            title:
              task.title
          }
        });
      } catch (notifErr) {
        console.error(
          'Comment notification error:',
          notifErr
        );
      }
    }

    const populated =
      await populateTask(
        Task.findById(
          task._id
        )
      );

    const formattedTask =
      safeTask(populated);

    return res.status(201).json({
      success: true,
      message:
        'Comment added successfully.',
      comments:
        formattedTask.comments,
      data:
        formattedTask
    });
  } catch (error) {
    console.error(
      'addComment error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error adding comment.'
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET COMMENTS
// GET /api/tasks/:id/comments
// ─────────────────────────────────────────────────────────────────────────────

const getComments = async (req, res) => {
  try {
    if (
      !isValidObjectId(
        req.params.id
      )
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task ID.'
      });
    }

    const task =
      await Task.findById(
        req.params.id
      )
        .populate(
          'comments.user',
          'name email role avatar'
        )
        .populate(
          'assignedTo',
          'name email role'
        )
        .populate(
          'createdBy',
          'name email role'
        );

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found.'
      });
    }

    const isAllowed =
      isAdminOrManager(
        req.user
      ) ||
      (
        task.assignedTo &&
        task.assignedTo._id &&
        task.assignedTo._id.toString() ===
          req.user._id.toString()
      ) ||
      (
        task.createdBy &&
        task.createdBy._id &&
        task.createdBy._id.toString() ===
          req.user._id.toString()
      );

    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. You can only view comments for tasks assigned to or created by you.'
      });
    }

    const comments =
      (task.comments || []).map(
        (comment) => ({
          id:
            comment._id,

          _id:
            comment._id,

          user:
            safeUserRef(
              comment.user
            ),

          text:
            comment.text,

          createdAt:
            comment.createdAt
        })
      );

    return res.status(200).json({
      success: true,
      comments,
      data:
        comments
    });
  } catch (error) {
    console.error(
      'getComments error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving comments.'
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE COMMENT
// DELETE /api/tasks/:id/comments/:commentId
// ─────────────────────────────────────────────────────────────────────────────

const deleteComment = async (
  req,
  res
) => {
  try {
    const {
      id,
      commentId
    } = req.params;

    if (
      !isValidObjectId(id) ||
      !isValidObjectId(commentId)
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid ID provided.'
      });
    }

    const task =
      await Task.findById(id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found.'
      });
    }

    const isTaskAllowed =
      isAdminOrManager(
        req.user
      ) ||
      (
        task.assignedTo &&
        task.assignedTo.toString() ===
          req.user._id.toString()
      ) ||
      (
        task.createdBy &&
        task.createdBy.toString() ===
          req.user._id.toString()
      );

    if (!isTaskAllowed) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied.'
      });
    }

    const comment =
      task.comments.id(
        commentId
      );

    if (!comment) {
      return res.status(404).json({
        success: false,
        message:
          'Comment not found.'
      });
    }

    const isCommentAuthor =
      comment.user &&
      comment.user.toString() ===
        req.user._id.toString();

    const isAdmin =
      getUserRole(
        req.user
      ) === 'admin';

    if (
      !isCommentAuthor &&
      !isAdmin
    ) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. You can only delete your own comments.'
      });
    }

    task.comments.pull(
      commentId
    );

    task.activity =
      task.activity || [];

    task.activity.push({
      user:
        req.user._id,
      action:
        'comment_deleted',
      details:
        'Deleted a comment',
      timestamp:
        new Date()
    });

    await task.save();

    return res.status(200).json({
      success: true,
      message:
        'Comment deleted successfully.'
    });
  } catch (error) {
    console.error(
      'deleteComment error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error deleting comment.'
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

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
  deleteComment
};