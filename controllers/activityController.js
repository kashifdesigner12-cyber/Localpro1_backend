const Activity = require("../models/Activity");

const getMyActivities = async (req, res) => {
  try {
    const activities = await Activity.find({
      user: req.user._id,
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      activities,
    });
  } catch (error) {
    console.error("Get my activities error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch activities",
    });
  }
};

module.exports = {
  getMyActivities,
};