import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/User.js";

const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const validUsername = (username) =>
  typeof username === "string" &&
  username.length >= 3 &&
  username.length <= 50 &&
  /^[a-z0-9._-]+$/.test(username);

const createUser = async (req, res, next) => {
  try {
    const {
      username,
      password,
      role = "user",
      jobTitle = "",
      department = "",
      phone = "",
    } = req.body;

    if (
      typeof username !== "string" ||
      !username.trim() ||
      typeof password !== "string" ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required.",
      });
    }

    const normalizedUsername = username.trim().toLowerCase();

    if (!validUsername(normalizedUsername)) {
      return res.status(400).json({
        success: false,
        message:
          "Username must be 3-50 characters and contain only letters, numbers, dots, underscores or hyphens.",
      });
    }

    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({
        success: false,
        message: "Password must be between 8 and 128 characters.",
      });
    }

    if (!["user", "manager"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Select user or manager.",
      });
    }

    for (const [field, value] of Object.entries({
      jobTitle,
      department,
      phone,
    })) {
      if (typeof value !== "string") {
        return res.status(400).json({
          success: false,
          message: `${field} must be text.`,
        });
      }
    }

    const existingUser = await User.findOne({
      username: normalizedUsername,
    })
      .select("_id")
      .lean();

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: `Username "${normalizedUsername}" already exists.`,
      });
    }

    // Optimized bcrypt cost factor for fast user creation
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      username: normalizedUsername,
      name: normalizedUsername,
      password: hashedPassword,
      role,
      status: "active",
      jobTitle: jobTitle.trim(),
      department: department.trim(),
      phone: phone.trim(),
      createdBy: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: "User created successfully.",
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        role: user.role,
        status: user.status,
        jobTitle: user.jobTitle,
        department: user.department,
        phone: user.phone,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];

      return res.status(409).json({
        success: false,
        message: field
          ? `Duplicate value for "${field}".`
          : "A duplicate value already exists.",
      });
    }

    return next(error);
  }
};

const getUsers = async (req, res, next) => {
  try {
    const { role, status, search } = req.query;
    const filter = {};

    // Exclude suspended users from chat directory & system view
    filter.status = { $ne: "suspended" };

    if (role && ["admin", "manager", "user"].includes(role)) {
      filter.role = role;
    }

    if (
      status &&
      ["active", "pending", "blocked", "inactive"].includes(status)
    ) {
      filter.status = status;
    }

    if (typeof search === "string" && search.trim()) {
      const normalizedSearch = search.trim().slice(0, 100);
      const escaped = escapeRegex(normalizedSearch);

      filter.$or = [
        { username: { $regex: escaped, $options: "i" } },
        { name: { $regex: escaped, $options: "i" } },
      ];
    }

    // Optimized lean query with strict field selection for lightning-fast chat contacts loading
    const users = await User.find(filter)
      .select("username name role status jobTitle department phone createdAt lastLoginAt")
      .sort({ name: 1 })
      .limit(200)
      .lean();

    return res.status(200).json({
      success: true,
      count: users.length,
      users,
    });
  } catch (error) {
    return next(error);
  }
};

const updateUserStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const { id } = req.params;

    if (!["active", "blocked", "inactive", "pending"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid account status.",
      });
    }

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
      });
    }

    if (id === String(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: "You cannot change your own account status.",
      });
    }

    const user = await User.findOne({
      _id: id,
      role: { $ne: "admin" },
    });

    if (!user) {
      const exists = await User.exists({ _id: id });

      return res.status(exists ? 403 : 404).json({
        success: false,
        message: exists
          ? "Admin accounts cannot be changed here."
          : "User not found.",
      });
    }

    user.status = status;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "User status updated.",
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    return next(error);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
      });
    }

    if (id === String(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: "You cannot edit your own account here.",
      });
    }

    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (user.role === "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin accounts cannot be edited here.",
      });
    }

    const { username, name, role } = req.body;

    if (username !== undefined) {
      if (typeof username !== "string") {
        return res.status(400).json({
          success: false,
          message: "Username must be text.",
        });
      }

      const normalizedUsername = username.trim().toLowerCase();

      if (!validUsername(normalizedUsername)) {
        return res.status(400).json({
          success: false,
          message: "Invalid username format.",
        });
      }

      if (normalizedUsername !== user.username) {
        const duplicate = await User.findOne({
          username: normalizedUsername,
          _id: { $ne: user._id },
        })
          .select("_id")
          .lean();

        if (duplicate) {
          return res.status(409).json({
            success: false,
            message: `Username "${normalizedUsername}" already exists.`,
          });
        }
      }

      user.username = normalizedUsername;

      if (name === undefined) {
        user.name = normalizedUsername;
      }
    }

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Name cannot be empty.",
        });
      }

      user.name = name.trim();
    }

    if (role !== undefined) {
      if (!["user", "manager"].includes(role)) {
        return res.status(400).json({
          success: false,
          message: "Invalid role. Select user or manager.",
        });
      }

      user.role = role;
    }

    for (const field of ["jobTitle", "department", "phone"]) {
      if (req.body[field] !== undefined) {
        if (typeof req.body[field] !== "string") {
          return res.status(400).json({
            success: false,
            message: `${field} must be text.`,
          });
        }

        user[field] = req.body[field].trim();
      }
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: "User updated successfully.",
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        role: user.role,
        status: user.status,
        jobTitle: user.jobTitle,
        department: user.department,
        phone: user.phone,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "That username is already in use.",
      });
    }

    return next(error);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
      });
    }

    if (id === String(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own account.",
      });
    }

    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (user.role === "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin accounts cannot be deleted here.",
      });
    }

    await user.deleteOne();

    return res.status(200).json({
      success: true,
      message: "User deleted successfully.",
    });
  } catch (error) {
    return next(error);
  }
};

export {
  createUser,
  getUsers,
  updateUserStatus,
  updateUser,
  deleteUser,
};