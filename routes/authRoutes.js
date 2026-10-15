const express = require("express");

const {
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
  logout,
} = require("../controllers/authController");

const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// Short-lived in-memory cache for GET /me.
// `protect` runs first, so requests are still authenticated before cache access.
const meCache = new Map();
const ME_CACHE_TTL = 15_000;
const ME_CACHE_MAX_ENTRIES = 500;

const getUserCacheKey = (req) => {
  const userId = req.user?._id || req.user?.id;
  return userId ? `me_${String(userId)}` : null;
};

const cachedGetMe = (req, res, next) => {
  const cacheKey = getUserCacheKey(req);

  // If the auth middleware does not attach a user, safely fall back to the controller.
  if (!cacheKey) {
    return getMe(req, res, next);
  }

  const now = Date.now();
  const cached = meCache.get(cacheKey);

  if (cached && now - cached.timestamp < ME_CACHE_TTL) {
    // Refresh insertion order so frequently used entries remain in the bounded cache.
    meCache.delete(cacheKey);
    meCache.set(cacheKey, cached);
    return res.status(200).json(cached.data);
  }

  if (cached) meCache.delete(cacheKey);

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode === 200 && body?.success !== false) {
      // Prevent unbounded memory growth when many users log in.
      while (meCache.size >= ME_CACHE_MAX_ENTRIES) {
        const oldestKey = meCache.keys().next().value;
        if (oldestKey === undefined) break;
        meCache.delete(oldestKey);
      }
      meCache.set(cacheKey, { data: body, timestamp: Date.now() });
    }
    return originalJson(body);
  };

  return getMe(req, res, next);
};

// Invalidate only the current user's cached /me response before a mutation.
const clearCurrentUserMeCache = (req, res, next) => {
  const cacheKey = getUserCacheKey(req);
  if (cacheKey) meCache.delete(cacheKey);
  return next();
};

// Public authentication routes
router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);

// Protected authentication routes
router.get("/me", protect, cachedGetMe);
router.put("/me", protect, clearCurrentUserMeCache, updateProfile);
router.put("/profile", protect, clearCurrentUserMeCache, updateProfile);

router.patch("/change-password", protect, clearCurrentUserMeCache, changePassword);
router.put("/change-password", protect, clearCurrentUserMeCache, changePassword);

module.exports = router;
