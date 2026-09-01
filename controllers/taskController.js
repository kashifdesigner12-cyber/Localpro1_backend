const mongoose = require("mongoose");
const Task = require("../models/Task");
const User = require("../models/User");
const { createNotification } = require("./notificationController");

// ============================================================
// CONSTANTS
// ============================================================

const VALID_PRIORITIES = [
  "Low",
  "Medium",
  "High",
  "Urgent",
];

const VALID_STATUSES = [
  "Pending",
  "In Progress",
  "Completed",
  "Cancelled",
];

// ============================================================
// HELPERS
// ============================================================

const isValidObjectId = (id) => {
  return Boolean(id) && mongoose.Types.ObjectId.isValid(id);
};

const getUserRole = (user) => {
  return String(user?.role || "")
    .trim()
    .toLowerCase();
};

const isAdminOrManager = (user) => {
  const role = getUserRole(user);

  return role === "admin" || role === "manager";
};

const sameId = (a, b) => {
  if (!a || !b) return false;

  return String(a) === String(b);
};

// Escape regex characters so search text cannot break RegExp.
const escapeRegex = (value) => {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
};

// ============================================================
// SAFE USER
// ============================================================

const safeUserRef = (user) => {
  if (!user) return null;

  // Populated user
  if (
    typeof user === "object" &&
    user._id
  ) {
    return {
      id: user._id,
      _id: user._id,
      name: user.name || "",
      email: user.email || "",
      phone:
        user.phone !== undefined
          ? user.phone
          : undefined,
      role:
        user.role !== undefined
          ? user.role
          : undefined,
      status:
        user.status !== undefined
          ? user.status
          : undefined,
      avatar:
        user.avatar !== undefined
          ? user.avatar
          : undefined,
    };
  }

  return user;
};

// ============================================================
// SAFE CONTACT
// ============================================================

const safeContactRef = (contact) => {
  if (!contact) return null;

  if (
    typeof contact === "object" &&
    contact._id
  ) {
    const fullName =
      contact.name ||
      `${contact.firstName || ""} ${
        contact.lastName || ""
      }`.trim();

    return {
      id: contact._id,
      _id: contact._id,
      name: fullName,
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
          : undefined,
    };
  }

  return contact;
};

// ============================================================
// ATTACHMENTS
// ============================================================

const normalizeAttachments = (attachments, userId = null) => {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .filter(Boolean)
    .map((attachment) => {
      if (
        typeof attachment !== "object"
      ) {
        return null;
      }

      const url =
        attachment.url ||
        attachment.path ||
        attachment.secure_url ||
        "";

      return {
        url: String(url),
        filename:
          attachment.filename ||
          attachment.originalname ||
          "attachment",
        originalName:
          attachment.originalName ||
          attachment.originalname ||
          attachment.filename ||
          "attachment",
        fileType:
          attachment.fileType ||
          attachment.mimetype ||
          "",
        size:
          Number(attachment.size) || 0,
        uploadedBy:
          attachment.uploadedBy || userId || null,
        uploadedAt:
          attachment.uploadedAt || new Date(),
      };
    })
    .filter(
      (attachment) =>
        attachment &&
        attachment.url
    );
};

const getUploadedAttachments = (req) => {
  let files = [];

  // Single file uploaded via upload.single('file')
  if (req.file) {
    files = [req.file];
  }
  // Multiple files uploaded via upload.array('files')
  else if (Array.isArray(req.files)) {
    files = req.files;
  }
  // Multiple fields uploaded via upload.fields(...)
  else if (
    req.files &&
    typeof req.files === "object"
  ) {
    files = Object.values(
      req.files
    ).flat();
  }

  if (!files.length) {
    return [];
  }

  const userId = req.user?._id || null;

  return files
    .filter(Boolean)
    .map((file) => {
      // Local multer file path setup or cloud URL
      const url =
        file.secure_url ||
        file.url ||
        (file.filename ? `/uploads/${file.filename}` : file.path) ||
        "";

      return {
        url: String(url),
        filename:
          file.filename ||
          file.originalname ||
          "attachment",
        originalName:
          file.originalname ||
          file.filename ||
          "attachment",
        fileType:
          file.mimetype ||
          file.fileType ||
          "",
        size:
          Number(file.size) || 0,
        uploadedBy: userId,
        uploadedAt: new Date(),
      };
    })
    .filter(
      (attachment) =>
        attachment.url
    );
};

const parseBodyAttachments = (
  attachments,
  userId = null
) => {
  if (
    attachments === undefined ||
    attachments === null ||
    attachments === ""
  ) {
    return null;
  }

  if (Array.isArray(attachments)) {
    return normalizeAttachments(
      attachments,
      userId
    );
  }

  if (typeof attachments === "string") {
    try {
      const parsed =
        JSON.parse(attachments);

      if (Array.isArray(parsed)) {
        return normalizeAttachments(
          parsed,
          userId
        );
      }

      return [];
    } catch (error) {
      return [];
    }
  }

  return [];
};

const getRequestAttachments = (req) => {
  const userId = req.user?._id || null;
  const bodyAttachments =
    parseBodyAttachments(
      req.body?.attachments,
      userId
    );

  const uploadedAttachments =
    getUploadedAttachments(req);

  return [
    ...(bodyAttachments || []),
    ...uploadedAttachments,
  ];
};

// ============================================================
// SAFE TASK
// ============================================================

const safeTask = (task) => {
  if (!task) return null;

  const contactValue =
    task.contact ||
    task.contactId ||
    null;

  return {
    id: task._id,
    _id: task._id,

    title: task.title || "",

    description:
      task.description || "",

    category:
      task.category || "General",

    createdBy:
      safeUserRef(task.createdBy),

    assignedTo:
      safeUserRef(task.assignedTo),

    contact:
      safeContactRef(contactValue),

    contactId:
      contactValue
        ? contactValue._id ||
          contactValue
        : null,

    priority:
      task.priority || "Medium",

    status:
      task.status || "Pending",

    dueDate:
      task.dueDate || null,

    completedAt:
      task.completedAt || null,

    attachments:
      Array.isArray(task.attachments)
        ? task.attachments.map(
            (attachment) => ({
              id: attachment._id,
              _id: attachment._id,

              url:
                attachment.url || "",

              filename:
                attachment.filename ||
                "",

              originalName:
                attachment.originalName ||
                attachment.filename ||
                "",

              fileType:
                attachment.fileType ||
                "",

              size:
                Number(
                  attachment.size
                ) || 0,

              uploadedBy:
                attachment.uploadedBy || null,

              uploadedAt:
                attachment.uploadedAt || null,
            })
          )
        : [],

    comments:
      Array.isArray(task.comments)
        ? task.comments.map(
            (comment) => ({
              id: comment._id,
              _id: comment._id,

              user:
                safeUserRef(
                  comment.user
                ),

              text:
                comment.text || "",

              createdAt:
                comment.createdAt,
            })
          )
        : [],

    activity:
      Array.isArray(task.activity)
        ? task.activity.map(
            (activity) => ({
              id: activity._id,
              _id: activity._id,

              user:
                safeUserRef(
                  activity.user
                ),

              action:
                activity.action || "",

              details:
                activity.details || "",

              timestamp:
                activity.timestamp,
            })
          )
        : [],

    createdAt:
      task.createdAt,

    updatedAt:
      task.updatedAt,
  };
};

// ============================================================
// POPULATE TASK
// ============================================================

const populateTask = (query) => {
  return query
    .populate(
      "createdBy",
      "name email role phone status avatar"
    )
    .populate(
      "assignedTo",
      "name email role phone status avatar"
    )
    .populate(
      "contact",
      "name firstName lastName email phone company"
    )
    .populate(
      "comments.user",
      "name email role avatar"
    )
    .populate(
      "activity.user",
      "name email role avatar"
    );
};

// ============================================================
// SORT
// ============================================================

const getSortOption = (sort) => {
  switch (sort) {
    case "dueDate":
    case "due":
      return {
        dueDate: 1,
      };

    case "-dueDate":
      return {
        dueDate: -1,
      };

    case "oldest":
    case "createdAt":
      return {
        createdAt: 1,
      };

    case "newest":
    case "-createdAt":
      return {
        createdAt: -1,
      };

    case "priority":
      return {
        priority: 1,
      };

    case "-priority":
      return {
        priority: -1,
      };

    case "status":
      return {
        status: 1,
      };

    case "-status":
      return {
        status: -1,
      };

    default:
      return {
        createdAt: -1,
      };
  }
};

// ============================================================
// PAGINATION
// ============================================================

const getPagination = (
  page,
  limit
) => {
  const pageNum = Math.max(
    1,
    parseInt(page, 10) || 1
  );

  const limitNum = Math.min(
    100,
    Math.max(
      1,
      parseInt(limit, 10) || 20
    )
  );

  const skip =
    (pageNum - 1) *
    limitNum;

  return {
    pageNum,
    limitNum,
    skip,
  };
};

// ============================================================
// CREATE TASK
// POST /api/tasks
// ============================================================

const createTask = async (
  req,
  res
) => {
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

    // --------------------------------------------------------
    // TITLE
    // --------------------------------------------------------

    if (
      !title ||
      !String(title).trim()
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Task title is required.",
      });
    }

    const cleanTitle =
      String(title).trim();

    if (cleanTitle.length < 3) {
      return res.status(400).json({
        success: false,
        message:
          "Title must be at least 3 characters long.",
      });
    }

    // --------------------------------------------------------
    // ASSIGNEE
    // --------------------------------------------------------

    const assigneeId =
      assignedTo ||
      req.user._id;

    if (
      !isValidObjectId(
        assigneeId
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid assigned user ID.",
      });
    }

    const assignedUser =
      await User.findById(
        assigneeId
      ).select(
        "name email role status"
      );

    if (!assignedUser) {
      return res.status(404).json({
        success: false,
        message:
          "Assigned user not found.",
      });
    }

    // --------------------------------------------------------
    // CONTACT
    // --------------------------------------------------------

    const targetContactId =
      contact ||
      contactId ||
      null;

    if (
      targetContactId &&
      !isValidObjectId(
        targetContactId
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid contact ID.",
      });
    }

    // --------------------------------------------------------
    // PRIORITY
    // --------------------------------------------------------

    const taskPriority =
      priority || "Medium";

    if (
      !VALID_PRIORITIES.includes(
        taskPriority
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          `Invalid priority. Allowed: ${VALID_PRIORITIES.join(
            ", "
          )}.`,
      });
    }

    // --------------------------------------------------------
    // STATUS
    // --------------------------------------------------------

    const taskStatus =
      status || "Pending";

    if (
      !VALID_STATUSES.includes(
        taskStatus
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          `Invalid status. Allowed: ${VALID_STATUSES.join(
            ", "
          )}.`,
      });
    }

    // --------------------------------------------------------
    // DUE DATE
    // --------------------------------------------------------

    let parsedDueDate = null;

    if (
      dueDate !== undefined &&
      dueDate !== null &&
      dueDate !== ""
    ) {
      parsedDueDate =
        new Date(dueDate);

      if (
        Number.isNaN(
          parsedDueDate.getTime()
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid due date.",
        });
      }
    }

    // --------------------------------------------------------
    // ATTACHMENTS
    // --------------------------------------------------------

    const taskAttachments =
      getRequestAttachments(req);

    // --------------------------------------------------------
    // ACTIVITY
    // --------------------------------------------------------

    const initialActivity = [
      {
        user: req.user._id,
        action: "created",
        details:
          taskAttachments.length > 0
            ? `Task created with ${taskAttachments.length} attachment(s)`
            : "Task created",
        timestamp: new Date(),
      },
    ];

    // --------------------------------------------------------
    // CREATE
    // --------------------------------------------------------

    const task =
      await Task.create({
        title: cleanTitle,

        description:
          description
            ? String(
                description
              ).trim()
            : "",

        category:
          category
            ? String(
                category
              ).trim()
            : "General",

        createdBy:
          req.user._id,

        assignedTo:
          assigneeId,

        contact:
          targetContactId,

        contactId:
          targetContactId,

        priority:
          taskPriority,

        status:
          taskStatus,

        dueDate:
          parsedDueDate,

        completedAt:
          taskStatus ===
          "Completed"
            ? new Date()
            : null,

        attachments:
          taskAttachments,

        comments: [],

        activity:
          initialActivity,
      });

    // --------------------------------------------------------
    // NOTIFICATION
    // --------------------------------------------------------

    if (
      !sameId(
        assigneeId,
        req.user._id
      )
    ) {
      try {
        await createNotification({
          userId: assigneeId,

          type: "task",

          title:
            "New Task Assigned",

          message:
            `A new task "${task.title}" has been assigned to you.`,

          relatedId:
            task._id,

          relatedType:
            "Task",

          actionUrl:
            "/dashboard/tasks",

          metadata: {
            taskId:
              task._id,

            title:
              task.title,

            priority:
              task.priority,
          },
        });
      } catch (notificationError) {
        console.error(
          "Task notification error:",
          notificationError
        );
      }
    }

    // --------------------------------------------------------
    // RESPONSE
    // --------------------------------------------------------

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
        "Task created successfully.",

      task:
        formattedTask,

      data:
        formattedTask,
    });
  } catch (error) {
    console.error(
      "createTask error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error creating task.",
      error:
        process.env.NODE_ENV ===
        "development"
          ? error.message
          : undefined,
    });
  }
};

// ============================================================
// GET ALL TASKS
// GET /api/tasks
// ============================================================

const getAllTasks = async (
  req,
  res
) => {
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

    // --------------------------------------------------------
    // ROLE FILTER
    // --------------------------------------------------------

    if (
      !isAdminOrManager(
        req.user
      )
    ) {
      filter.$or = [
        {
          assignedTo:
            req.user._id,
        },
        {
          createdBy:
            req.user._id,
        },
      ];
    } else {
      if (assignedTo) {
        if (
          !isValidObjectId(
            assignedTo
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid assignedTo filter ID.",
          });
        }

        filter.assignedTo =
          assignedTo;
      }

      if (createdBy) {
        if (
          !isValidObjectId(
            createdBy
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid createdBy filter ID.",
          });
        }

        filter.createdBy =
          createdBy;
      }
    }

    // --------------------------------------------------------
    // CONTACT FILTER
    // --------------------------------------------------------

    const targetContact =
      contact || contactId;

    if (targetContact) {
      if (
        !isValidObjectId(
          targetContact
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid contact filter ID.",
        });
      }

      filter.$and =
        filter.$and || [];

      filter.$and.push({
        $or: [
          {
            contact:
              targetContact,
          },
          {
            contactId:
              targetContact,
          },
        ],
      });
    }

    // --------------------------------------------------------
    // CATEGORY
    // --------------------------------------------------------

    if (category) {
      filter.category =
        category;
    }

    // --------------------------------------------------------
    // STATUS
    // --------------------------------------------------------

    if (status) {
      if (
        !VALID_STATUSES.includes(
          status
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid status filter. Allowed: ${VALID_STATUSES.join(
              ", "
            )}.`,
        });
      }

      filter.status =
        status;
    }

    // --------------------------------------------------------
    // PRIORITY
    // --------------------------------------------------------

    if (priority) {
      if (
        !VALID_PRIORITIES.includes(
          priority
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid priority filter. Allowed: ${VALID_PRIORITIES.join(
              ", "
            )}.`,
        });
      }

      filter.priority =
        priority;
    }

    // --------------------------------------------------------
    // SEARCH
    // --------------------------------------------------------

    if (
      search &&
      String(search).trim()
    ) {
      const regex =
        new RegExp(
          escapeRegex(
            String(search).trim()
          ),
          "i"
        );

      const searchCondition = {
        $or: [
          {
            title: regex,
          },
          {
            description:
              regex,
          },
          {
            category:
              regex,
          },
        ],
      };

      if (filter.$or) {
        filter.$and =
          filter.$and || [];

        filter.$and.push({
          $or: filter.$or,
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

    // --------------------------------------------------------
    // OVERDUE
    // --------------------------------------------------------

    if (overdue === "true") {
      filter.$and =
        filter.$and || [];

      filter.$and.push({
        dueDate: {
          $lt: new Date(),
          $ne: null,
        },
      });

      filter.$and.push({
        status: {
          $nin: [
            "Completed",
            "Cancelled",
          ],
        },
      });
    }

    // --------------------------------------------------------
    // DATE RANGE
    // --------------------------------------------------------

    if (startDate || endDate) {
      const dueDateFilter = {};

      if (startDate) {
        const start =
          new Date(startDate);

        if (
          Number.isNaN(
            start.getTime()
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid startDate.",
          });
        }

        dueDateFilter.$gte =
          start;
      }

      if (endDate) {
        const end =
          new Date(endDate);

        if (
          Number.isNaN(
            end.getTime()
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid endDate.",
          });
        }

        // Include entire end day
        end.setHours(
          23,
          59,
          59,
          999
        );

        dueDateFilter.$lte =
          end;
      }

      filter.dueDate =
        dueDateFilter;
    }

    // --------------------------------------------------------
    // PAGINATION
    // --------------------------------------------------------

    const {
      pageNum,
      limitNum,
      skip,
    } = getPagination(
      page,
      limit
    );

    // --------------------------------------------------------
    // QUERY
    // --------------------------------------------------------

    const [
      tasks,
      total,
    ] = await Promise.all([
      populateTask(
        Task.find(filter)
          .sort(
            getSortOption(sort)
          )
          .skip(skip)
          .limit(limitNum)
      ),

      Task.countDocuments(
        filter
      ),
    ]);

    const formattedTasks =
      tasks.map(safeTask);

    return res.status(200).json({
      success: true,

      tasks:
        formattedTasks,

      data:
        formattedTasks,

      pagination: {
        page:
          pageNum,

        limit:
          limitNum,

        total,

        pages:
          Math.ceil(
            total /
              limitNum
          ),
      },
    });
  } catch (error) {
    console.error(
      "getAllTasks error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error retrieving tasks.",
      error:
        process.env.NODE_ENV ===
        "development"
          ? error.message
          : undefined,
    });
  }
};

// ============================================================
// GET TASK STATS
// GET /api/tasks/stats
// ============================================================

const getTaskStats = async (
  req,
  res
) => {
  try {
    const filter = {};

    if (
      !isAdminOrManager(
        req.user
      )
    ) {
      filter.$or = [
        {
          assignedTo:
            req.user._id,
        },
        {
          createdBy:
            req.user._id,
        },
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
      byAssignedUser,
    ] = await Promise.all([
      Task.countDocuments(
        filter
      ),

      Task.countDocuments({
        ...filter,
        status: "Pending",
      }),

      Task.countDocuments({
        ...filter,
        status: "In Progress",
      }),

      Task.countDocuments({
        ...filter,
        status: "Completed",
      }),

      Task.countDocuments({
        ...filter,
        status: "Cancelled",
      }),

      Task.countDocuments({
        ...filter,

        dueDate: {
          $lt: now,
          $ne: null,
        },

        status: {
          $nin: [
            "Completed",
            "Cancelled",
          ],
        },
      }),

      Task.aggregate([
        {
          $match:
            filter,
        },
        {
          $group: {
            _id:
              "$priority",

            count: {
              $sum: 1,
            },
          },
        },
      ]),

      Task.aggregate([
        {
          $match:
            filter,
        },
        {
          $group: {
            _id:
              "$status",

            count: {
              $sum: 1,
            },
          },
        },
      ]),

      Task.aggregate([
        {
          $match:
            filter,
        },
        {
          $group: {
            _id:
              "$assignedTo",

            count: {
              $sum: 1,
            },
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
      byPriority,
      byStatus,
      byAssignedUser,
    };

    return res.status(200).json({
      success: true,
      stats,
      data: stats,
    });
  } catch (error) {
    console.error(
      "getTaskStats error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error retrieving task stats.",
    });
  }
};

// ============================================================
// GET MY TASKS
// GET /api/tasks/my
// ============================================================

const getMyTasks = async (
  req,
  res
) => {
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
        {
          assignedTo:
            req.user._id,
        },
        {
          createdBy:
            req.user._id,
        },
      ]
    };

    const filter = {
      ...ownershipCondition,
    };

    // --------------------------------------------------------
    // STATUS
    // --------------------------------------------------------

    if (status) {
      if (
        !VALID_STATUSES.includes(
          status
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid status filter. Allowed: ${VALID_STATUSES.join(
              ", "
            )}.`,
        });
      }

      filter.status =
        status;
    }

    // --------------------------------------------------------
    // PRIORITY
    // --------------------------------------------------------

    if (priority) {
      if (
        !VALID_PRIORITIES.includes(
          priority
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid priority filter. Allowed: ${VALID_PRIORITIES.join(
              ", "
            )}.`,
        });
      }

      filter.priority =
        priority;
    }

    // --------------------------------------------------------
    // SEARCH
    // --------------------------------------------------------

    if (
      search &&
      String(search).trim()
    ) {
      const regex =
        new RegExp(
          escapeRegex(
            String(search).trim()
          ),
          "i"
        );

      filter.$and = [
        ownershipCondition,
        {
          $or: [
            {
              title: regex,
            },
            {
              description:
                regex,
            },
            {
              category:
                regex,
            },
          ],
        },
      ];

      delete filter.$or;
    }

    // --------------------------------------------------------
    // PAGINATION
    // --------------------------------------------------------

    const {
      pageNum,
      limitNum,
      skip,
    } = getPagination(
      page,
      limit
    );

    const [
      tasks,
      total,
    ] = await Promise.all([
      populateTask(
        Task.find(filter)
          .sort(
            getSortOption(sort)
          )
          .skip(skip)
          .limit(limitNum)
      ),

      Task.countDocuments(
        filter
      ),
    ]);

    const formattedTasks =
      tasks.map(safeTask);

    return res.status(200).json({
      success: true,

      tasks:
        formattedTasks,

      data:
        formattedTasks,

      pagination: {
        page:
          pageNum,

        limit:
          limitNum,

        total,

        pages:
          Math.ceil(
            total /
              limitNum
          ),
      },
    });
  } catch (error) {
    console.error(
      "getMyTasks error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error retrieving your tasks.",
    });
  }
};

// ============================================================
// GET TASK BY ID
// GET /api/tasks/:id
// ============================================================

const getTaskById = async (
  req,
  res
) => {
  try {
    const { id } =
      req.params;

    if (
      !isValidObjectId(id)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid task ID.",
      });
    }

    const task =
      await populateTask(
        Task.findById(id)
      );

    if (!task) {
      return res.status(404).json({
        success: false,
        message:
          "Task not found.",
      });
    }

    const currentUserId =
      req.user._id;

    const isAssigned =
      task.assignedTo &&
      sameId(
        task.assignedTo._id ||
          task.assignedTo,
        currentUserId
      );

    const isCreator =
      task.createdBy &&
      sameId(
        task.createdBy._id ||
          task.createdBy,
        currentUserId
      );

    if (
      !isAdminOrManager(
        req.user
      ) &&
      !isAssigned &&
      !isCreator
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. You can only view tasks assigned to or created by you.",
      });
    }

    const formattedTask =
      safeTask(task);

    return res.status(200).json({
      success: true,

      task:
        formattedTask,

      data:
        formattedTask,
    });
  } catch (error) {
    console.error(
      "getTaskById error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error retrieving task.",
    });
  }
};

// ============================================================
// UPDATE TASK
// PUT/PATCH /api/tasks/:id
// ============================================================

const updateTask = async (
  req,
  res
) => {
  try {
    const { id } =
      req.params;

    if (
      !isValidObjectId(id)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid task ID.",
      });
    }

    const task =
      await Task.findById(id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message:
          "Task not found.",
      });
    }

    const currentUser =
      await User.findById(
        req.user._id
      ).select(
        "name email role"
      );

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message:
          "Authenticated user no longer exists.",
      });
    }

    const currentUserId =
      currentUser._id;

    const adminOrManager =
      isAdminOrManager(
        currentUser
      );

    const isAssignedUser =
      task.assignedTo &&
      sameId(
        task.assignedTo,
        currentUserId
      );

    const isCreatorUser =
      task.createdBy &&
      sameId(
        task.createdBy,
        currentUserId
      );

    // --------------------------------------------------------
    // ACCESS
    // --------------------------------------------------------

    if (
      !adminOrManager &&
      !isAssignedUser &&
      !isCreatorUser
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. You can only update tasks assigned to or created by you.",
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

    task.activity =
      task.activity || [];

    // ========================================================
    // NORMAL USER
    // ========================================================

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
        req.body?.attachments !==
          undefined ||
        getUploadedAttachments(
          req
        ).length > 0;

      if (hasRestrictedFields) {
        return res.status(403).json({
          success: false,
          message:
            "Access denied. You can only update the status of your assigned tasks.",
        });
      }

      if (!isAssignedUser) {
        return res.status(403).json({
          success: false,
          message:
            "Access denied. You can only update tasks assigned to you.",
        });
      }

      if (
        status === undefined ||
        !VALID_STATUSES.includes(
          status
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid status. Allowed: ${VALID_STATUSES.join(
              ", "
            )}.`,
        });
      }

      const previousStatus =
        task.status;

      // Same status
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
          safeTask(
            populated
          );

        return res.status(200).json({
          success: true,

          message:
            "Task status is already set to this value.",

          task:
            formattedTask,

          data:
            formattedTask,
        });
      }

      const allowedTransitions = {
        Pending: [
          "In Progress",
          "Completed",
          "Cancelled",
        ],

        "In Progress": [
          "Pending",
          "Completed",
          "Cancelled",
        ],

        Completed: [
          "In Progress",
        ],

        Cancelled: [
          "In Progress",
        ],
      };

      const allowedNextStatuses =
        allowedTransitions[
          previousStatus
        ] || [];

      if (
        !allowedNextStatuses.includes(
          status
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid status transition from ${previousStatus} to ${status}.`,
        });
      }

      task.status =
        status;

      task.activity.push({
        user:
          currentUserId,

        action:
          "status_changed",

        details:
          `Status changed from ${previousStatus} to ${status}`,

        timestamp:
          new Date(),
      });

      if (
        status === "Completed"
      ) {
        task.completedAt =
          new Date();
      } else if (
        previousStatus ===
        "Completed"
      ) {
        task.completedAt =
          null;
      }

      await task.save();

      // ------------------------------------------------------
      // NOTIFY CREATOR
      // ------------------------------------------------------

      if (
        status ===
          "Completed" &&
        task.createdBy &&
        !sameId(
          task.createdBy,
          currentUserId
        )
      ) {
        try {
          await createNotification({
            userId:
              task.createdBy,

            type:
              "task",

            title:
              "Task Completed",

            message:
              `The task "${task.title}" has been completed.`,

            relatedId:
              task._id,

            relatedType:
              "Task",

            actionUrl:
              "/dashboard/tasks",

            metadata: {
              taskId:
                task._id,

              title:
                task.title,

              completedBy:
                currentUserId,
            },
          });
        } catch (notificationError) {
          console.error(
            "Notification error in status update:",
            notificationError
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
        safeTask(
          populated
        );

      return res.status(200).json({
        success: true,

        message:
          "Task status updated successfully.",

        task:
          formattedTask,

        data:
          formattedTask,
      });
    }

    // ========================================================
    // ADMIN / MANAGER UPDATE
    // ========================================================

    // --------------------------------------------------------
    // TITLE
    // --------------------------------------------------------

    if (
      title !== undefined
    ) {
      const cleanTitle =
        String(title).trim();

      if (!cleanTitle) {
        return res.status(400).json({
          success: false,
          message:
            "Task title cannot be empty.",
        });
      }

      if (
        cleanTitle.length < 3
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Title must be at least 3 characters long.",
        });
      }

      task.title =
        cleanTitle;
    }

    // --------------------------------------------------------
    // DESCRIPTION
    // --------------------------------------------------------

    if (
      description !==
      undefined
    ) {
      task.description =
        description
          ? String(
              description
            ).trim()
          : "";
    }

    // --------------------------------------------------------
    // CATEGORY
    // --------------------------------------------------------

    if (
      category !== undefined
    ) {
      task.category =
        category
          ? String(
              category
            ).trim()
          : "General";
    }

    // --------------------------------------------------------
    // ATTACHMENTS
    // --------------------------------------------------------

    const bodyAttachments =
      parseBodyAttachments(
        req.body?.attachments,
        currentUserId
      );

    const uploadedAttachments =
      getUploadedAttachments(
        req
      );

    /*
      Attachment behaviour:

      1. No attachments field + no uploaded files
         => Keep existing attachments.

      2. attachments field exists
         => Replace existing attachments
            with supplied attachments.

      3. New uploaded files
         => Append uploaded files.
    */

    if (
      bodyAttachments !==
        null ||
      uploadedAttachments.length >
        0
    ) {
      const existingAttachments =
        bodyAttachments !==
        null
          ? bodyAttachments
          : Array.isArray(
              task.attachments
            )
            ? task.attachments
            : [];

      task.attachments = [
        ...existingAttachments,
        ...uploadedAttachments,
      ];

      if (
        uploadedAttachments.length >
        0
      ) {
        task.activity.push({
          user:
            currentUserId,

          action:
            "attachment_added",

          details:
            `Added ${uploadedAttachments.length} attachment(s)`,

          timestamp:
            new Date(),
        });
      }
    }

    // --------------------------------------------------------
    // CONTACT
    // --------------------------------------------------------

    let targetContact;

    if (
      contact !== undefined
    ) {
      targetContact =
        contact;
    } else if (
      contactId !== undefined
    ) {
      targetContact =
        contactId;
    }

    if (
      targetContact !==
      undefined
    ) {
      if (
        targetContact ===
          null ||
        targetContact === ""
      ) {
        task.contact =
          null;

        task.contactId =
          null;
      } else {
        if (
          !isValidObjectId(
            targetContact
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid contact ID.",
          });
        }

        task.contact =
          targetContact;

        task.contactId =
          targetContact;
      }
    }

    // --------------------------------------------------------
    // REASSIGN
    // --------------------------------------------------------

    let isReassigned =
      false;

    if (
      assignedTo !==
      undefined
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
            "Invalid assigned user ID.",
        });
      }

      const newAssignee =
        await User.findById(
          assignedTo
        ).select(
          "name email role status"
        );

      if (!newAssignee) {
        return res.status(404).json({
          success: false,
          message:
            "Assigned user not found.",
        });
      }

      const previousAssignee =
        task.assignedTo
          ? String(
              task.assignedTo
            )
          : null;

      if (
        previousAssignee !==
        String(
          newAssignee._id
        )
      ) {
        task.assignedTo =
          newAssignee._id;

        isReassigned =
          true;

        task.activity.push({
          user:
            currentUserId,

          action:
            "reassigned",

          details:
            `Reassigned to ${newAssignee.name || "user"}`,

          timestamp:
            new Date(),
        });
      }
    }

    // --------------------------------------------------------
    // PRIORITY
    // --------------------------------------------------------

    if (
      priority !==
      undefined
    ) {
      if (
        !VALID_PRIORITIES.includes(
          priority
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid priority. Allowed: ${VALID_PRIORITIES.join(
              ", "
            )}.`,
        });
      }

      if (
        priority !==
        task.priority
      ) {
        task.activity.push({
          user:
            currentUserId,

          action:
            "priority_changed",

          details:
            `Priority changed from ${task.priority} to ${priority}`,

          timestamp:
            new Date(),
        });

        task.priority =
          priority;
      }
    }

    // --------------------------------------------------------
    // STATUS
    // --------------------------------------------------------

    const previousStatus =
      task.status;

    let statusChanged =
      false;

    if (
      status !== undefined
    ) {
      if (
        !VALID_STATUSES.includes(
          status
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid status. Allowed: ${VALID_STATUSES.join(
              ", "
            )}.`,
        });
      }

      if (
        status !==
        previousStatus
      ) {
        task.status =
          status;

        statusChanged =
          true;

        task.activity.push({
          user:
            currentUserId,

          action:
            "status_changed",

          details:
            `Status changed from ${previousStatus} to ${status}`,

          timestamp:
            new Date(),
        });

        if (
          status ===
          "Completed"
        ) {
          task.completedAt =
            new Date();
        } else if (
          previousStatus ===
          "Completed"
        ) {
          task.completedAt =
            null;
        }
      }
    }

    // --------------------------------------------------------
    // DUE DATE
    // --------------------------------------------------------

    if (
      dueDate !==
      undefined
    ) {
      if (
        dueDate === null ||
        dueDate === ""
      ) {
        task.dueDate =
          null;
      } else {
        const parsedDate =
          new Date(
            dueDate
          );

        if (
          Number.isNaN(
            parsedDate.getTime()
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid due date.",
          });
        }

        task.dueDate =
          parsedDate;
      }
    }

    // --------------------------------------------------------
    // SAVE
    // --------------------------------------------------------

    await task.save();

    // ========================================================
    // NOTIFICATIONS
    // ========================================================

    try {
      // ------------------------------------------------------
      // REASSIGNED
      // ------------------------------------------------------

      if (
        isReassigned &&
        task.assignedTo &&
        !sameId(
          task.assignedTo,
          currentUserId
        )
      ) {
        await createNotification({
          userId:
            task.assignedTo,

          type:
            "task",

          title:
            "New Task Assigned",

          message:
            `A task "${task.title}" has been assigned to you.`,

          relatedId:
            task._id,

          relatedType:
            "Task",

          actionUrl:
            "/dashboard/tasks",

          metadata: {
            taskId:
              task._id,

            title:
              task.title,

            reassigned:
              true,
          },
        });
      }

      // ------------------------------------------------------
      // STATUS CHANGED
      // ------------------------------------------------------

      if (
        statusChanged
      ) {
        // Completed
        if (
          task.status ===
            "Completed" &&
          task.createdBy &&
          !sameId(
            task.createdBy,
            currentUserId
          )
        ) {
          await createNotification({
            userId:
              task.createdBy,

            type:
              "task",

            title:
              "Task Completed",

            message:
              `The task "${task.title}" has been completed.`,

            relatedId:
              task._id,

            relatedType:
              "Task",

            actionUrl:
              "/dashboard/tasks",

            metadata: {
              taskId:
                task._id,

              title:
                task.title,

              completedBy:
                currentUserId,
            },
          });
        }

        // Other status updates
        else if (
          task.assignedTo &&
          !sameId(
            task.assignedTo,
            currentUserId
          )
        ) {
          await createNotification({
            userId:
              task.assignedTo,

            type:
              "task",

            title:
              "Task Status Updated",

            message:
              `The status of task "${task.title}" was updated to ${task.status}.`,

            relatedId:
              task._id,

            relatedType:
              "Task",

            actionUrl:
              "/dashboard/tasks",

            metadata: {
              taskId:
                task._id,

              title:
                task.title,

              status:
                task.status,
            },
          });
        }
      }
    } catch (notificationError) {
      console.error(
        "Notification error in updateTask:",
        notificationError
      );
    }

    // --------------------------------------------------------
    // RESPONSE
    // --------------------------------------------------------

    const populated =
      await populateTask(
        Task.findById(
          task._id
        )
      );

    const formattedTask =
      safeTask(
        populated
      );

    return res.status(200).json({
      success: true,

      message:
        "Task updated successfully.",

      task:
        formattedTask,

      data:
        formattedTask,
    });
  } catch (error) {
    console.error(
      "updateTask error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error updating task.",

      error:
        process.env.NODE_ENV ===
        "development"
          ? error.message
          : undefined,
    });
  }
};

// ============================================================
// DELETE TASK
// DELETE /api/tasks/:id
// ============================================================

const deleteTask = async (
  req,
  res
) => {
  try {
    const { id } =
      req.params;

    if (
      !isValidObjectId(id)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid task ID.",
      });
    }

    const task =
      await Task.findById(id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message:
          "Task not found.",
      });
    }

    const currentUserId =
      req.user._id;

    const isAssignedUser =
      task.assignedTo &&
      sameId(
        task.assignedTo,
        currentUserId
      );

    const isCreatorUser =
      task.createdBy &&
      sameId(
        task.createdBy,
        currentUserId
      );

    if (
      !isAdminOrManager(
        req.user
      ) &&
      !isAssignedUser &&
      !isCreatorUser
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. You can only delete tasks assigned to or created by you.",
      });
    }

    await Task.findByIdAndDelete(
      id
    );

    return res.status(200).json({
      success: true,
      message:
        "Task deleted successfully.",
    });
  } catch (error) {
    console.error(
      "deleteTask error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error deleting task.",
    });
  }
};

// ============================================================
// ADD COMMENT
// POST /api/tasks/:id/comments
// ============================================================

const addComment = async (
  req,
  res
) => {
  try {
    const { id } =
      req.params;

    if (
      !isValidObjectId(id)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid task ID.",
      });
    }

    const {
      text,
      comment,
    } = req.body;

    const commentText =
      text !== undefined
        ? text
        : comment;

    if (
      !commentText ||
      !String(
        commentText
      ).trim()
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Comment text is required.",
      });
    }

    const trimmedComment =
      String(
        commentText
      ).trim();

    const task =
      await Task.findById(id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message:
          "Task not found.",
      });
    }

    const currentUserId =
      req.user._id;

    const isAllowed =
      isAdminOrManager(
        req.user
      ) ||
      (
        task.assignedTo &&
        sameId(
          task.assignedTo,
          currentUserId
        )
      ) ||
      (
        task.createdBy &&
        sameId(
          task.createdBy,
          currentUserId
        )
      );

    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. You can only comment on tasks assigned to or created by you.",
      });
    }

    task.comments =
      task.comments || [];

    task.activity =
      task.activity || [];

    // --------------------------------------------------------
    // COMMENT
    // --------------------------------------------------------

    task.comments.push({
      user:
        currentUserId,

      text:
        trimmedComment,

      createdAt:
        new Date(),
    });

    const preview =
      trimmedComment.length >
      50
        ? `${trimmedComment.substring(
            0,
            50
          )}...`
        : trimmedComment;

    task.activity.push({
      user:
        currentUserId,

      action:
        "comment_added",

      details:
        `Added a comment: "${preview}"`,

      timestamp:
        new Date(),
    });

    await task.save();

    // --------------------------------------------------------
    // NOTIFICATION TARGET
    // --------------------------------------------------------

    let notifyTarget = null;

    if (
      task.assignedTo &&
      sameId(
        task.assignedTo,
        currentUserId
      )
    ) {
      notifyTarget =
        task.createdBy;
    } else {
      notifyTarget =
        task.assignedTo;
    }

    if (
      notifyTarget &&
      !sameId(
        notifyTarget,
        currentUserId
      )
    ) {
      try {
        await createNotification({
          userId:
            notifyTarget,

          type:
            "task",

          title:
            "New Comment on Task",

          message:
            `${req.user.name || "A user"} commented on "${task.title}".`,

          relatedId:
            task._id,

          relatedType:
            "Task",

          actionUrl:
            "/dashboard/tasks",

          metadata: {
            taskId:
              task._id,

            title:
              task.title,
          },
        });
      } catch (notificationError) {
        console.error(
          "Comment notification error:",
          notificationError
        );
      }
    }

    // --------------------------------------------------------
    // RESPONSE
    // --------------------------------------------------------

    const populated =
      await populateTask(
        Task.findById(
          task._id
        )
      );

    const formattedTask =
      safeTask(
        populated
      );

    return res.status(201).json({
      success: true,

      message:
        "Comment added successfully.",

      comments:
        formattedTask.comments,

      data:
        formattedTask,
    });
  } catch (error) {
    console.error(
      "addComment error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error adding comment.",
    });
  }
};

// ============================================================
// GET COMMENTS
// GET /api/tasks/:id/comments
// ============================================================

const getComments = async (
  req,
  res
) => {
  try {
    const { id } =
      req.params;

    if (
      !isValidObjectId(id)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid task ID.",
      });
    }

    const task =
      await Task.findById(id)
        .populate(
          "comments.user",
          "name email role avatar"
        )
        .populate(
          "assignedTo",
          "name email role"
        )
        .populate(
          "createdBy",
          "name email role"
        );

    if (!task) {
      return res.status(404).json({
        success: false,
        message:
          "Task not found.",
      });
    }

    const currentUserId =
      req.user._id;

    const isAllowed =
      isAdminOrManager(
        req.user
      ) ||
      (
        task.assignedTo &&
        sameId(
          task.assignedTo._id ||
            task.assignedTo,
          currentUserId
        )
      ) ||
      (
        task.createdBy &&
        sameId(
          task.createdBy._id ||
            task.createdBy,
          currentUserId
        )
      );

    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. You can only view comments for tasks assigned to or created by you.",
      });
    }

    const comments =
      (task.comments || [])
        .map(
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
              comment.text ||
              "",

            createdAt:
              comment.createdAt,
          })
        );

    return res.status(200).json({
      success: true,

      comments,

      data:
        comments,
    });
  } catch (error) {
    console.error(
      "getComments error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error retrieving comments.",
    });
  }
};

// ============================================================
// DELETE COMMENT
// DELETE /api/tasks/:id/comments/:commentId
// ============================================================

const deleteComment = async (
  req,
  res
) => {
  try {
    const {
      id,
      commentId,
    } = req.params;

    if (
      !isValidObjectId(id) ||
      !isValidObjectId(
        commentId
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid ID provided.",
      });
    }

    const task =
      await Task.findById(id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message:
          "Task not found.",
      });
    }

    const currentUserId =
      req.user._id;

    // --------------------------------------------------------
    // TASK ACCESS
    // --------------------------------------------------------

    const isTaskAllowed =
      isAdminOrManager(
        req.user
      ) ||
      (
        task.assignedTo &&
        sameId(
          task.assignedTo,
          currentUserId
        )
      ) ||
      (
        task.createdBy &&
        sameId(
          task.createdBy,
          currentUserId
        )
      );

    if (!isTaskAllowed) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied.",
      });
    }

    // --------------------------------------------------------
    // FIND COMMENT
    // --------------------------------------------------------

    const comment =
      task.comments.id(
        commentId
      );

    if (!comment) {
      return res.status(404).json({
        success: false,
        message:
          "Comment not found.",
      });
    }

    // --------------------------------------------------------
    // COMMENT PERMISSION
    // --------------------------------------------------------

    const isCommentAuthor =
      comment.user &&
      sameId(
        comment.user,
        currentUserId
      );

    const isAdmin =
      getUserRole(
        req.user
      ) === "admin";

    if (
      !isCommentAuthor &&
      !isAdmin
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. You can only delete your own comments.",
      });
    }

    // --------------------------------------------------------
    // DELETE
    // --------------------------------------------------------

    task.comments.pull(
      commentId
    );

    task.activity =
      task.activity || [];

    task.activity.push({
      user:
        currentUserId,

      action:
        "comment_deleted",

      details:
        "Deleted a comment",

      timestamp:
        new Date(),
    });

    await task.save();

    return res.status(200).json({
      success: true,

      message:
        "Comment deleted successfully.",
    });
  } catch (error) {
    console.error(
      "deleteComment error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error deleting comment.",
    });
  }
};

// ============================================================
// REMOVE ATTACHMENT
// DELETE /api/tasks/:id/attachments/:attachmentId
// ============================================================

const removeAttachment = async (
  req,
  res
) => {
  try {
    const {
      id,
      attachmentId,
    } = req.params;

    if (
      !isValidObjectId(id) ||
      !isValidObjectId(attachmentId)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid ID provided.",
      });
    }

    const task =
      await Task.findById(id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message:
          "Task not found.",
      });
    }

    const currentUser =
      await User.findById(
        req.user._id
      ).select(
        "name email role"
      );

    const currentUserId =
      currentUser._id;

    const adminOrManager =
      isAdminOrManager(
        currentUser
      );

    const isCreatorUser =
      task.createdBy &&
      sameId(
        task.createdBy,
        currentUserId
      );

    if (
      !adminOrManager &&
      !isCreatorUser
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. Only managers or the task creator can remove attachments.",
      });
    }

    const attachment =
      task.attachments.id(
        attachmentId
      );

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message:
          "Attachment not found.",
      });
    }

    const removedName =
      attachment.originalName ||
      attachment.filename ||
      "attachment";

    task.attachments.pull(
      attachmentId
    );

    task.activity =
      task.activity || [];

    task.activity.push({
      user:
        currentUserId,

      action:
        "attachment_removed",

      details:
        `Removed attachment: "${removedName}"`,

      timestamp:
        new Date(),
    });

    await task.save();

    const populated =
      await populateTask(
        Task.findById(
          task._id
        )
      );

    const formattedTask =
      safeTask(
        populated
      );

    return res.status(200).json({
      success: true,
      message:
        "Attachment removed successfully.",
      task:
        formattedTask,
      data:
        formattedTask,
    });
  } catch (error) {
    console.error(
      "removeAttachment error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error removing attachment.",
    });
  }
};

// ============================================================
// EXPORTS
// ============================================================

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