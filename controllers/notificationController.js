
import mongoose from "mongoose";
import Notification from "../models/Notification.js";

const parsePositiveInteger = (value, fallback, maximum = Infinity) => {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, maximum);
};

export const getNotifications = async (req, res, next) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const limit = parsePositiveInteger(req.query.limit, 20, 50);
    const recipient = req.user._id;
    const unreadOnly = req.query.unread === "true";

    const filter = { recipient };

    if (unreadOnly) {
      filter.isRead = false;
    }

    const [notifications, total, unreadResult] = await Promise.all([
      Notification.find(filter)
        .select(
          "_id recipient sender title message type link isRead readAt createdAt updatedAt"
        )
        .populate({
          path: "sender",
          select: "name username",
        })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),

      Notification.countDocuments(filter).exec(),

      unreadOnly
        ? Promise.resolve(null)
        : Notification.countDocuments({
            recipient,
            isRead: false,
          }).exec(),
    ]);

    const unreadCount = unreadOnly ? total : unreadResult;

    return res.status(200).json({
      success: true,
      data: notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      unreadCount,
    });
  } catch (error) {
    return next(error);
  }
};

export const markNotificationRead = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID.",
      });
    }

    const notification = await Notification.findOneAndUpdate(
      {
        _id: id,
        recipient: req.user._id,
        isRead: false,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      },
      {
        new: true,
        runValidators: true,
      }
    )
      .lean()
      .exec();

    if (!notification) {
      const existing = await Notification.exists({
        _id: id,
        recipient: req.user._id,
      }).exec();

      if (!existing) {
        return res.status(404).json({
          success: false,
          message: "Notification not found.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Notification already marked as read.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notification marked as read.",
      data: notification,
    });
  } catch (error) {
    return next(error);
  }
};

export const markAllNotificationsRead = async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      {
        recipient: req.user._id,
        isRead: false,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      }
    ).exec();

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read.",
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    return next(error);
  }
};

export const deleteNotification = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID.",
      });
    }

    const notification = await Notification.findOneAndDelete({
      _id: id,
      recipient: req.user._id,
    })
      .lean()
      .exec();

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notification deleted.",
    });
  } catch (error) {
    return next(error);
  }
};
