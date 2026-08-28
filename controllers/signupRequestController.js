const mongoose = require("mongoose");
const SignupRequest = require("../models/SignupRequest");
const User = require("../models/User");
const { createNotification } = require("./notificationController");

const VALID_STATUSES = ["Pending", "Approved", "Rejected"];
const VALID_ROLES = ["user", "admin", "manager"];

const isValidObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id);

const safeRequest = (request) => {
  if (!request) return null;

  return {
    id: request._id,
    name: request.name,
    email: request.email,
    phone: request.phone || "",
    role: request.role || "user",
    status: request.status,
    rejectionReason: request.rejectionReason || "",
    reviewedBy: request.reviewedBy
      ? typeof request.reviewedBy === "object" && request.reviewedBy._id
        ? {
            id: request.reviewedBy._id,
            name: request.reviewedBy.name,
            email: request.reviewedBy.email,
            role: request.reviewedBy.role,
          }
        : request.reviewedBy
      : null,
    reviewedAt: request.reviewedAt || null,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
};

const safeUser = (user) => {
  if (!user) return null;

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone || "",
    role: user.role,
    status: user.status,
    avatar: user.avatar || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

const parseSort = (sortParam, defaultSort = { createdAt: -1 }) => {
  if (!sortParam || typeof sortParam !== "string") {
    return defaultSort;
  }

  const sort = sortParam.trim();

  if (sort === "newest" || sort === "-createdAt") {
    return { createdAt: -1 };
  }

  if (sort === "oldest" || sort === "createdAt") {
    return { createdAt: 1 };
  }

  if (sort === "name" || sort === "asc") {
    return { name: 1 };
  }

  if (sort === "-name" || sort === "desc") {
    return { name: -1 };
  }

  if (sort === "email") {
    return { email: 1 };
  }

  if (sort === "-email") {
    return { email: -1 };
  }

  if (sort === "status") {
    return { status: 1 };
  }

  if (sort === "-status") {
    return { status: -1 };
  }

  if (sort.startsWith("-")) {
    return { [sort.substring(1)]: -1 };
  }

  return { [sort]: 1 };
};

// POST /api/signup-requests
const createSignupRequest = async (req, res) => {
  try {
    const { name, email, phone, password, role } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Name is required.",
      });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const emailNorm = email.trim().toLowerCase();

    if (!/^\S+@\S+\.\S+$/.test(emailNorm)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email.",
      });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters.",
      });
    }

    const existingUser = await User.findOne({
      email: emailNorm,
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    const existingRequest = await SignupRequest.findOne({
      email: emailNorm,
      status: "Pending",
    });

    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message:
          "A pending signup request for this email already exists.",
      });
    }

    const requestedRole = VALID_ROLES.includes(role)
      ? role
      : "user";

    const signupRequest = await SignupRequest.create({
      name: name.trim(),
      email: emailNorm,
      phone: phone ? phone.trim() : "",
      password,
      role: requestedRole,
      status: "Pending",
    });

    return res.status(201).json({
      success: true,
      message: "Signup request submitted successfully.",
      request: safeRequest(signupRequest),
    });
  } catch (error) {
    console.error("createSignupRequest error:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message:
          "A signup request with this email already exists.",
      });
    }

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map(
        (err) => err.message
      );

      return res.status(400).json({
        success: false,
        message: messages.join(" "),
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error submitting signup request.",
    });
  }
};

// GET /api/signup-requests
const getSignupRequests = async (req, res) => {
  try {
    const {
      search,
      status,
      page = 1,
      limit = 20,
      sort = "-createdAt",
    } = req.query;

    const filter = {};

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");

      filter.$or = [
        { name: regex },
        { email: regex },
        { phone: regex },
      ];
    }

    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status filter. Allowed: ${VALID_STATUSES.join(
            ", "
          )}.`,
        });
      }

      filter.status = status;
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(
      Math.max(parseInt(limit, 10) || 20, 1),
      100
    );

    const skip = (pageNum - 1) * limitNum;
    const sortOption = parseSort(sort);

    const [requests, total] = await Promise.all([
      SignupRequest.find(filter)
        .select("-password")
        .populate("reviewedBy", "name email role")
        .skip(skip)
        .limit(limitNum)
        .sort(sortOption),

      SignupRequest.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      requests: requests.map(safeRequest),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 0,
      },
    });
  } catch (error) {
    console.error("getSignupRequests error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error retrieving signup requests.",
    });
  }
};

// GET /api/signup-requests/:id
const getSignupRequestById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid request ID.",
      });
    }

    const request = await SignupRequest.findById(id)
      .select("-password")
      .populate("reviewedBy", "name email role");

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Signup request not found.",
      });
    }

    return res.status(200).json({
      success: true,
      request: safeRequest(request),
    });
  } catch (error) {
    console.error("getSignupRequestById error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error retrieving signup request.",
    });
  }
};

// PUT/PATCH /api/signup-requests/:id/approve
const approveSignupRequest = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid request ID.",
      });
    }

    const request = await SignupRequest.findById(id).select(
      "+password"
    );

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Signup request not found.",
      });
    }

    if (request.status !== "Pending") {
      return res.status(400).json({
        success: false,
        message: `Request is already ${request.status.toLowerCase()}.`,
      });
    }

    const existingUser = await User.findOne({
      email: request.email,
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "A user with this email already exists.",
      });
    }

    const now = new Date();

    const insertResult = await User.collection.insertOne({
      name: request.name,
      email: request.email,
      phone: request.phone || "",
      password: request.password,
      role: request.role || "user",
      status: "Active",
      avatar: null,
      createdAt: now,
      updatedAt: now,
    });

    if (!insertResult.insertedId) {
      return res.status(500).json({
        success: false,
        message: "User account could not be created.",
      });
    }

    request.status = "Approved";
    request.reviewedBy = req.user._id;
    request.reviewedAt = now;

    await request.save();

    try {
      await createNotification({
        userId: insertResult.insertedId,
        type: "system",
        title: "Account Approved",
        message:
          "Your account signup request has been approved. Welcome to Local Pro 1!",
        relatedId: insertResult.insertedId,
        relatedType: "User",
      });
    } catch (notificationError) {
      console.error(
        "Notification creation error:",
        notificationError
      );
    }

    const createdUser = await User.findById(
      insertResult.insertedId
    ).select("-password");

    const populatedRequest = await SignupRequest.findById(
      request._id
    ).populate("reviewedBy", "name email role");

    return res.status(200).json({
      success: true,
      message: "Signup request approved successfully.",
      request: safeRequest(populatedRequest),
      user: safeUser(createdUser),
    });
  } catch (error) {
    console.error("approveSignupRequest error:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "A user with this email already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error approving signup request.",
    });
  }
};

// PUT/PATCH /api/signup-requests/:id/reject
const rejectSignupRequest = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid request ID.",
      });
    }

    const { reason, rejectionReason } = req.body;
    const reasonText = reason || rejectionReason || "";

    const request = await SignupRequest.findById(id).select(
      "-password"
    );

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Signup request not found.",
      });
    }

    if (request.status !== "Pending") {
      return res.status(400).json({
        success: false,
        message: `Request is already ${request.status.toLowerCase()}.`,
      });
    }

    const now = new Date();

    request.status = "Rejected";
    request.rejectionReason = reasonText.trim();
    request.reviewedBy = req.user._id;
    request.reviewedAt = now;

    await request.save();

    const populatedRequest = await SignupRequest.findById(
      request._id
    ).populate("reviewedBy", "name email role");

    return res.status(200).json({
      success: true,
      message: "Signup request rejected successfully.",
      request: safeRequest(populatedRequest),
    });
  } catch (error) {
    console.error("rejectSignupRequest error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error rejecting signup request.",
    });
  }
};

// DELETE /api/signup-requests/:id
const deleteSignupRequest = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid request ID.",
      });
    }

    const request = await SignupRequest.findById(id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Signup request not found.",
      });
    }

    await SignupRequest.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "Signup request deleted successfully.",
    });
  } catch (error) {
    console.error("deleteSignupRequest error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error deleting signup request.",
    });
  }
};

module.exports = {
  createSignupRequest,
  getSignupRequests,
  getSignupRequestById,
  approveSignupRequest,
  rejectSignupRequest,
  deleteSignupRequest,
};