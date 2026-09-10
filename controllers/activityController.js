const Activity = require("../models/Activity");

// ============================================================
// GET MY ACTIVITIES
// ============================================================

const getMyActivities = async (req, res) => {
  try {
    // --------------------------------------------------------
    // Pagination
    // --------------------------------------------------------

    const page = Math.max(
      Number.parseInt(req.query.page, 10) || 1,
      1
    );

    const requestedLimit =
      Number.parseInt(req.query.limit, 10) || 30;

    // Never allow a very large activity response.
    const limit = Math.min(
      Math.max(requestedLimit, 1),
      50
    );

    const skip = (page - 1) * limit;

    // --------------------------------------------------------
    // Query
    // --------------------------------------------------------
    //
    // Only fetch the fields needed by the Activity UI.
    //
    // IMPORTANT:
    // If your Activity model contains different field names,
    // we will adjust this projection after checking the model.
    //
    // --------------------------------------------------------

    const activities = await Activity.find({
      user: req.user._id,
    })
      .select(
        "_id action type description entity entityId createdAt"
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // --------------------------------------------------------
    // Response
    // --------------------------------------------------------

    return res.status(200).json({
      success: true,
      activities,
      pagination: {
        page,
        limit,
        hasMore: activities.length === limit,
      },
    });
  } catch (error) {
    console.error(
      "Get my activities error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch activities",
    });
  }
};

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  getMyActivities,
};