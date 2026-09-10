const mongoose = require('mongoose');
const LeaveRequest = require('../models/LeaveRequest');
const User = require('../models/User');
const { createNotification } = require('./notificationController');

const isValidObjectId = (id) =>
  Boolean(id) && mongoose.Types.ObjectId.isValid(id);

const VALID_LEAVE_TYPES = [
  'Annual',
  'Sick',
  'Casual',
  'Emergency',
  'Maternity',
  'Paternity',
  'Unpaid',
  'Other'
];

const VALID_STATUSES = [
  'Pending',
  'Approved',
  'Rejected',
  'Cancelled'
];

/*
|--------------------------------------------------------------------------
| Leave Type Normalizer
|--------------------------------------------------------------------------
*/

const normalizeLeaveType = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  const aliases = {
    'Annual Leave': 'Annual',
    'Sick Leave': 'Sick',
    'Casual Leave': 'Casual',
    'Emergency Leave': 'Emergency',
    'Maternity Leave': 'Maternity',
    'Paternity Leave': 'Paternity',
    'Unpaid Leave': 'Unpaid',
    'Other Leave': 'Other'
  };

  if (aliases[normalized]) {
    return aliases[normalized];
  }

  if (VALID_LEAVE_TYPES.includes(normalized)) {
    return normalized;
  }

  const caseInsensitiveMatch = VALID_LEAVE_TYPES.find(
    (type) => type.toLowerCase() === normalized.toLowerCase()
  );

  if (caseInsensitiveMatch) {
    return caseInsensitiveMatch;
  }

  return null;
};

/*
|--------------------------------------------------------------------------
| Safe Leave Request Response
|--------------------------------------------------------------------------
*/

const safeLeaveRequest = (lr) => {
  if (!lr) {
    return null;
  }

  let safeUserObj = null;
  if (lr.user) {
    if (typeof lr.user === 'object' && lr.user._id) {
      let cleanAvatar = lr.user.avatar || null;
      if (typeof cleanAvatar === 'string' && cleanAvatar.startsWith('data:image') && cleanAvatar.length > 1000) {
        cleanAvatar = null;
      }

      safeUserObj = {
        id: lr.user._id,
        _id: lr.user._id,
        name: lr.user.name || undefined,
        email: lr.user.email || undefined,
        role: lr.user.role || undefined,
        avatar: cleanAvatar
      };
    } else {
      safeUserObj = lr.user;
    }
  }

  let safeReviewerObj = null;
  if (lr.reviewedBy) {
    if (typeof lr.reviewedBy === 'object' && lr.reviewedBy._id) {
      safeReviewerObj = {
        id: lr.reviewedBy._id,
        _id: lr.reviewedBy._id,
        name: lr.reviewedBy.name || undefined,
        email: lr.reviewedBy.email || undefined,
        role: lr.reviewedBy.role || undefined
      };
    } else {
      safeReviewerObj = lr.reviewedBy;
    }
  }

  return {
    id: lr._id,
    _id: lr._id,

    user: safeUserObj,

    leaveType: lr.leaveType,

    startDate: lr.startDate,
    endDate: lr.endDate,

    reason: lr.reason,

    status: lr.status,

    reviewedBy: safeReviewerObj,

    reviewedAt: lr.reviewedAt || null,

    reviewComment:
      lr.reviewComment ||
      lr.rejectionReason ||
      '',

    rejectionReason:
      lr.rejectionReason ||
      lr.reviewComment ||
      '',

    createdAt: lr.createdAt,
    updatedAt: lr.updatedAt
  };
};

/*
|--------------------------------------------------------------------------
| POST /api/leave-requests
|--------------------------------------------------------------------------
*/

const createLeaveRequest = async (req, res) => {
  try {
    const {
      leaveType,
      startDate,
      endDate,
      reason
    } = req.body;

    if (!leaveType) {
      return res.status(400).json({
        success: false,
        message: 'Leave type is required.'
      });
    }

    const normalizedLeaveType =
      normalizeLeaveType(leaveType);

    if (!normalizedLeaveType) {
      return res.status(400).json({
        success: false,
        message: `Invalid leave type. Allowed: ${VALID_LEAVE_TYPES.join(', ')}.`
      });
    }

    if (!startDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date is required.'
      });
    }

    if (!endDate) {
      return res.status(400).json({
        success: false,
        message: 'End date is required.'
      });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Reason is required.'
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid start date.'
      });
    }

    if (Number.isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid end date.'
      });
    }

    if (end < start) {
      return res.status(400).json({
        success: false,
        message: 'End date cannot be before start date.'
      });
    }

    const leaveRequest = await LeaveRequest.create({
      user: req.user._id,
      leaveType: normalizedLeaveType,
      startDate: start,
      endDate: end,
      reason: reason.trim(),
      status: 'Pending'
    });

    const populated =
      await LeaveRequest.findById(
        leaveRequest._id
      )
        .populate(
          'user',
          'name email role avatar'
        )
        .populate(
          'reviewedBy',
          'name email role'
        )
        .lean();

    // Fast parallel notifications dispatch
    (async () => {
      try {
        const admins = await User.find({
          role: { $in: ['admin', 'manager'] }
        }).select('_id').lean();

        await Promise.allSettled(
          admins.map((admin) =>
            createNotification({
              userId: admin._id,
              type: 'leave',
              title: 'New Leave Request',
              message: `${
                req.user.name || 'An employee'
              } submitted a ${normalizedLeaveType} leave request.`,
              relatedId: leaveRequest._id,
              relatedType: 'LeaveRequest',
              actionUrl: '/dashboard/leave-requests'
            })
          )
        );
      } catch (notificationError) {
        console.error(
          'Notification dispatch error:',
          notificationError.message
        );
      }
    })();

    const safeData = safeLeaveRequest(populated);

    return res.status(201).json({
      success: true,
      message:
        'Leave request submitted successfully.',
      leaveRequest: safeData,
      request: safeData,
      data: safeData
    });
  } catch (error) {
    console.error(
      'createLeaveRequest error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error submitting leave request.'
    });
  }
};

/*
|--------------------------------------------------------------------------
| GET /api/leave-requests
|--------------------------------------------------------------------------
*/

const getLeaveRequests = async (req, res) => {
  try {
    const {
      status,
      leaveType,
      userId,
      user,
      search,
      page = 1,
      limit = 20
    } = req.query;

    const filter = {};

    if (req.user.role === 'user') {
      filter.user = req.user._id;
    } else {
      const targetUser = userId || user;

      if (targetUser) {
        if (!isValidObjectId(targetUser)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid userId filter.'
          });
        }

        filter.user = targetUser;
      }
    }

    if (status) {
      const normalizedStatus =
        VALID_STATUSES.find(
          (item) =>
            item.toLowerCase() ===
            String(status).toLowerCase()
        );

      if (!normalizedStatus) {
        return res.status(400).json({
          success: false,
          message: `Invalid status filter. Allowed: ${VALID_STATUSES.join(', ')}.`
        });
      }

      filter.status = normalizedStatus;
    }

    if (leaveType) {
      const normalizedLeaveType =
        normalizeLeaveType(leaveType);

      if (!normalizedLeaveType) {
        return res.status(400).json({
          success: false,
          message: `Invalid leave type filter. Allowed: ${VALID_LEAVE_TYPES.join(', ')}.`
        });
      }

      filter.leaveType =
        normalizedLeaveType;
    }

    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.reason = new RegExp(escaped, 'i');
    }

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
      (pageNum - 1) * limitNum;

    const [
      leaveRequests,
      total
    ] = await Promise.all([
      LeaveRequest.find(filter)
        .populate(
          'user',
          'name email role avatar'
        )
        .populate(
          'reviewedBy',
          'name email role'
        )
        .skip(skip)
        .limit(limitNum)
        .sort({
          createdAt: -1
        })
        .lean(),

      LeaveRequest.countDocuments(
        filter
      )
    ]);

    const safeRequests =
      leaveRequests.map(
        safeLeaveRequest
      );

    return res.status(200).json({
      success: true,
      leaveRequests: safeRequests,
      requests: safeRequests,
      data: safeRequests,

      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages:
          Math.ceil(
            total / limitNum
          ) || 0
      }
    });
  } catch (error) {
    console.error(
      'getLeaveRequests error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving leave requests.'
    });
  }
};

/*
|--------------------------------------------------------------------------
| GET /api/leave-requests/my
|--------------------------------------------------------------------------
*/

const getMyLeaveRequests = async (
  req,
  res
) => {
  try {
    const {
      status,
      leaveType,
      page = 1,
      limit = 20
    } = req.query;

    const filter = {
      user: req.user._id
    };

    if (status) {
      const normalizedStatus =
        VALID_STATUSES.find(
          (item) =>
            item.toLowerCase() ===
            String(status).toLowerCase()
        );

      if (!normalizedStatus) {
        return res.status(400).json({
          success: false,
          message: `Invalid status filter. Allowed: ${VALID_STATUSES.join(', ')}.`
        });
      }

      filter.status =
        normalizedStatus;
    }

    if (leaveType) {
      const normalizedLeaveType =
        normalizeLeaveType(leaveType);

      if (!normalizedLeaveType) {
        return res.status(400).json({
          success: false,
          message: `Invalid leave type filter. Allowed: ${VALID_LEAVE_TYPES.join(', ')}.`
        });
      }

      filter.leaveType =
        normalizedLeaveType;
    }

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
      (pageNum - 1) * limitNum;

    const [
      leaveRequests,
      total
    ] = await Promise.all([
      LeaveRequest.find(filter)
        .populate(
          'user',
          'name email role avatar'
        )
        .populate(
          'reviewedBy',
          'name email role'
        )
        .skip(skip)
        .limit(limitNum)
        .sort({
          createdAt: -1
        })
        .lean(),

      LeaveRequest.countDocuments(
        filter
      )
    ]);

    const safeRequests =
      leaveRequests.map(
        safeLeaveRequest
      );

    return res.status(200).json({
      success: true,
      leaveRequests: safeRequests,
      requests: safeRequests,
      data: safeRequests,

      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages:
          Math.ceil(
            total / limitNum
          ) || 0
      }
    });
  } catch (error) {
    console.error(
      'getMyLeaveRequests error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving leave requests.'
    });
  }
};

/*
|--------------------------------------------------------------------------
| GET /api/leave-requests/:id
|--------------------------------------------------------------------------
*/

const getLeaveRequestById = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid leave request ID.'
      });
    }

    const leaveRequest =
      await LeaveRequest.findById(id)
        .populate(
          'user',
          'name email role avatar'
        )
        .populate(
          'reviewedBy',
          'name email role'
        )
        .lean();

    if (!leaveRequest) {
      return res.status(404).json({
        success: false,
        message:
          'Leave request not found.'
      });
    }

    if (
      req.user.role === 'user' &&
      leaveRequest.user &&
      leaveRequest.user._id.toString() !==
        req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. You can only view your own leave requests.'
      });
    }

    const safeData = safeLeaveRequest(leaveRequest);

    return res.status(200).json({
      success: true,
      leaveRequest: safeData,
      request: safeData,
      data: safeData
    });
  } catch (error) {
    console.error(
      'getLeaveRequestById error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error retrieving leave request.'
    });
  }
};

/*
|--------------------------------------------------------------------------
| PUT/PATCH /api/leave-requests/:id
|--------------------------------------------------------------------------
*/

const updateLeaveRequest = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid leave request ID.'
      });
    }

    const leaveRequest =
      await LeaveRequest.findById(id);

    if (!leaveRequest) {
      return res.status(404).json({
        success: false,
        message:
          'Leave request not found.'
      });
    }

    const isOwner =
      leaveRequest.user.toString() ===
      req.user._id.toString();

    const isAdminOrManager =
      req.user.role === 'admin' ||
      req.user.role === 'manager';

    if (
      !isAdminOrManager &&
      !isOwner
    ) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. You can only update your own leave requests.'
      });
    }

    if (
      leaveRequest.status !==
      'Pending'
    ) {
      return res.status(400).json({
        success: false,
        message: `Cannot update a leave request that is already ${leaveRequest.status.toLowerCase()}.`
      });
    }

    const {
      leaveType,
      startDate,
      endDate,
      reason
    } = req.body;

    if (leaveType !== undefined) {
      const normalizedLeaveType =
        normalizeLeaveType(
          leaveType
        );

      if (!normalizedLeaveType) {
        return res.status(400).json({
          success: false,
          message: `Invalid leave type. Allowed: ${VALID_LEAVE_TYPES.join(', ')}.`
        });
      }

      leaveRequest.leaveType =
        normalizedLeaveType;
    }

    let start =
      leaveRequest.startDate;

    let end =
      leaveRequest.endDate;

    if (startDate !== undefined) {
      start = new Date(startDate);

      if (
        Number.isNaN(
          start.getTime()
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid start date.'
        });
      }

      leaveRequest.startDate =
        start;
    }

    if (endDate !== undefined) {
      end = new Date(endDate);

      if (
        Number.isNaN(
          end.getTime()
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid end date.'
        });
      }

      leaveRequest.endDate =
        end;
    }

    if (
      start &&
      end &&
      end < start
    ) {
      return res.status(400).json({
        success: false,
        message:
          'End date cannot be before start date.'
      });
    }

    if (reason !== undefined) {
      if (
        !reason ||
        !reason.trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Reason cannot be empty.'
        });
      }

      leaveRequest.reason =
        reason.trim();
    }

    await leaveRequest.save();

    const populated =
      await LeaveRequest.findById(
        leaveRequest._id
      )
        .populate(
          'user',
          'name email role avatar'
        )
        .populate(
          'reviewedBy',
          'name email role'
        )
        .lean();

    const safe =
      safeLeaveRequest(
        populated
      );

    return res.status(200).json({
      success: true,
      message:
        'Leave request updated successfully.',
      leaveRequest: safe,
      request: safe,
      data: safe
    });
  } catch (error) {
    console.error(
      'updateLeaveRequest error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error updating leave request.'
    });
  }
};

/*
|--------------------------------------------------------------------------
| PUT/PATCH /api/leave-requests/:id/cancel
|--------------------------------------------------------------------------
*/

const cancelLeaveRequest = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid leave request ID.'
      });
    }

    const leaveRequest =
      await LeaveRequest.findById(id);

    if (!leaveRequest) {
      return res.status(404).json({
        success: false,
        message:
          'Leave request not found.'
      });
    }

    if (
      req.user.role === 'user' &&
      leaveRequest.user.toString() !==
        req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. You can only cancel your own leave requests.'
      });
    }

    if (
      leaveRequest.status !==
      'Pending'
    ) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a leave request that is already ${leaveRequest.status.toLowerCase()}.`
      });
    }

    leaveRequest.status =
      'Cancelled';

    await leaveRequest.save();

    const populated =
      await LeaveRequest.findById(
        leaveRequest._id
      )
        .populate(
          'user',
          'name email role avatar'
        )
        .populate(
          'reviewedBy',
          'name email role'
        )
        .lean();

    const safeData = safeLeaveRequest(populated);

    return res.status(200).json({
      success: true,
      message:
        'Leave request cancelled successfully.',
      leaveRequest: safeData,
      request: safeData,
      data: safeData
    });
  } catch (error) {
    console.error(
      'cancelLeaveRequest error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error cancelling leave request.'
    });
  }
};

/*
|--------------------------------------------------------------------------
| PUT/PATCH /api/leave-requests/:id/approve
|--------------------------------------------------------------------------
*/

const approveLeaveRequest = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid leave request ID.'
      });
    }

    const {
      reviewComment,
      comment,
      reason
    } = req.body;

    const feedback =
      reviewComment ||
      comment ||
      reason ||
      '';

    const leaveRequest =
      await LeaveRequest.findById(id);

    if (!leaveRequest) {
      return res.status(404).json({
        success: false,
        message:
          'Leave request not found.'
      });
    }

    if (
      leaveRequest.status !==
      'Pending'
    ) {
      return res.status(400).json({
        success: false,
        message: `Cannot approve a leave request that is already ${leaveRequest.status.toLowerCase()}.`
      });
    }

    const now = new Date();

    leaveRequest.status =
      'Approved';

    leaveRequest.reviewedBy =
      req.user._id;

    leaveRequest.reviewedAt =
      now;

    leaveRequest.reviewComment =
      feedback
        ? feedback.trim()
        : '';

    await leaveRequest.save();

    const populated =
      await LeaveRequest.findById(
        leaveRequest._id
      )
        .populate(
          'user',
          'name email role avatar'
        )
        .populate(
          'reviewedBy',
          'name email role'
        )
        .lean();

    try {
      const notifMessage =
        feedback
          ? `Your ${leaveRequest.leaveType} leave request has been approved. Note: ${feedback.trim()}`
          : `Your ${leaveRequest.leaveType} leave request has been approved.`;

      await createNotification({
        userId: leaveRequest.user,
        type: 'leave',
        title:
          'Leave Request Approved',
        message: notifMessage,
        relatedId:
          leaveRequest._id,
        relatedType:
          'LeaveRequest',
        actionUrl:
          '/dashboard/leave-requests',
        metadata: {
          leaveType:
            leaveRequest.leaveType,
          reviewComment:
            leaveRequest.reviewComment
        }
      });
    } catch (notificationError) {
      console.error(
        'Notification creation error:',
        notificationError
      );
    }

    const safeData = safeLeaveRequest(populated);

    return res.status(200).json({
      success: true,
      message:
        'Leave request approved successfully.',
      leaveRequest: safeData,
      request: safeData,
      data: safeData
    });
  } catch (error) {
    console.error(
      'approveLeaveRequest error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error approving leave request.'
    });
  }
};

/*
|--------------------------------------------------------------------------
| PUT/PATCH /api/leave-requests/:id/reject
|--------------------------------------------------------------------------
*/

const rejectLeaveRequest = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid leave request ID.'
      });
    }

    const {
      reviewComment,
      comment,
      reason,
      rejectionReason
    } = req.body;

    const feedback =
      reviewComment ||
      comment ||
      reason ||
      rejectionReason ||
      '';

    const leaveRequest =
      await LeaveRequest.findById(id);

    if (!leaveRequest) {
      return res.status(404).json({
        success: false,
        message:
          'Leave request not found.'
      });
    }

    if (
      leaveRequest.status !==
      'Pending'
    ) {
      return res.status(400).json({
        success: false,
        message: `Cannot reject a leave request that is already ${leaveRequest.status.toLowerCase()}.`
      });
    }

    const now = new Date();

    leaveRequest.status =
      'Rejected';

    leaveRequest.reviewedBy =
      req.user._id;

    leaveRequest.reviewedAt =
      now;

    leaveRequest.reviewComment =
      feedback
        ? feedback.trim()
        : '';

    leaveRequest.rejectionReason =
      feedback
        ? feedback.trim()
        : '';

    await leaveRequest.save();

    const populated =
      await LeaveRequest.findById(
        leaveRequest._id
      )
        .populate(
          'user',
          'name email role avatar'
        )
        .populate(
          'reviewedBy',
          'name email role'
        )
        .lean();

    try {
      const notifMessage =
        feedback
          ? `Your ${leaveRequest.leaveType} leave request has been rejected. Reason: ${feedback.trim()}`
          : `Your ${leaveRequest.leaveType} leave request has been rejected.`;

      await createNotification({
        userId: leaveRequest.user,
        type: 'leave',
        title:
          'Leave Request Rejected',
        message: notifMessage,
        relatedId:
          leaveRequest._id,
        relatedType:
          'LeaveRequest',
        actionUrl:
          '/dashboard/leave-requests',
        metadata: {
          leaveType:
            leaveRequest.leaveType,
          reviewComment:
            leaveRequest.reviewComment
        }
      });
    } catch (notificationError) {
      console.error(
        'Notification creation error:',
        notificationError
      );
    }

    const safeData = safeLeaveRequest(populated);

    return res.status(200).json({
      success: true,
      message:
        'Leave request rejected successfully.',
      leaveRequest: safeData,
      request: safeData,
      data: safeData
    });
  } catch (error) {
    console.error(
      'rejectLeaveRequest error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error rejecting leave request.'
    });
  }
};

/*
|--------------------------------------------------------------------------
| DELETE /api/leave-requests/:id
|--------------------------------------------------------------------------
*/

const deleteLeaveRequest = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid leave request ID.'
      });
    }

    const leaveRequest =
      await LeaveRequest.findById(id).select('user').lean();

    if (!leaveRequest) {
      return res.status(404).json({
        success: false,
        message:
          'Leave request not found.'
      });
    }

    if (
      req.user.role === 'user' &&
      leaveRequest.user.toString() !==
        req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. You can only delete your own leave requests.'
      });
    }

    await LeaveRequest.findByIdAndDelete(
      id
    );

    return res.status(200).json({
      success: true,
      message:
        'Leave request deleted successfully.'
    });
  } catch (error) {
    console.error(
      'deleteLeaveRequest error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error deleting leave request.'
    });
  }
};

/*
|--------------------------------------------------------------------------
| Exports
|--------------------------------------------------------------------------
*/

module.exports = {
  createLeaveRequest,
  getLeaveRequests,
  getAllLeaveRequests:
    getLeaveRequests,
  getMyLeaveRequests,
  getLeaveRequestById,
  updateLeaveRequest,
  cancelLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
  deleteLeaveRequest
};