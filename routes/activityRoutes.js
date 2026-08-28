const express = require("express");
const router = express.Router();

const {
  getMyActivities,
} = require("../controllers/activityController");

const { protect } = require("../middleware/authMiddleware");

router.get("/my", protect, getMyActivities);

module.exports = router;