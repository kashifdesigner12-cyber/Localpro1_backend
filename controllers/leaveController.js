import Leave from "../models/Leave.js";
import User from "../models/User.js";
import { createNotification } from "../services/notificationService.js";

// 1. User Leave Request Submit Kare
export const createLeaveRequest = async (req, res, next) => {
  try {
    const { startDate, endDate, reason } = req.body || {};

    if (!startDate || !endDate || !reason?.trim()) {
      return res.status(400).json({ success: false, message: "All fields are required." });
    }

    const leave = await Leave.create({
      user: req.user._id,
      startDate,
      endDate,
      reason: reason.trim(),
    });

    // Find all active admins and managers to notify them in real-time
    const admins = await User.find({ role: { $in: ["admin", "manager"] }, status: "active" })
      .select("_id")
      .lean();

    admins.forEach((admin) => {
      createNotification({
        recipient: admin._id,
        sender: req.user._id,
        title: "New Leave Request",
        message: `${req.user.name || "A user"} has requested leave from ${startDate} to ${endDate}.`,
        type: "approval", // Uses built-in schema enum to prevent validation errors
        link: "/admin/leaves",
      }).catch(() => {});
    });

    return res.status(201).json({ success: true, message: "Leave request submitted successfully.", leave });
  } catch (error) {
    return next(error);
  }
};

// 2. Get Leaves
export const getLeaves = async (req, res, next) => {
  try {
    const isManager = ["admin", "manager"].includes(req.user.role);
    const filter = isManager ? {} : { user: req.user._id };

    const leaves = await Leave.find(filter)
      .select("startDate endDate reason status adminRemark createdAt updatedAt user")
      .populate({ path: "user", select: "name email role" })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.status(200).json({ success: true, count: leaves.length, leaves });
  } catch (error) {
    return next(error);
  }
};

// 3. Admin Update Leave Status (Approve / Reject)
export const updateLeaveStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, adminRemark = "" } = req.body || {};

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status value." });
    }

    const leave = await Leave.findById(id);
    if (!leave) {
      return res.status(404).json({ success: false, message: "Leave request not found." });
    }

    leave.status = status;
    leave.adminRemark = adminRemark.trim();
    leave.approvedBy = req.user._id;
    await leave.save();

    // Send real-time notification to the user
    await createNotification({
      recipient: leave.user,
      sender: req.user._id,
      title: `Leave Request ${status === "approved" ? "Approved" : "Rejected"}`,
      message: `Your leave request has been ${status}.${adminRemark ? ` Remark: ${adminRemark}` : ""}`,
      type: "approval", // Uses built-in schema enum
      link: "/user/leaves",
    });

    return res.status(200).json({ success: true, message: `Leave ${status} successfully.`, leave });
  } catch (error) {
    return next(error);
  }
};