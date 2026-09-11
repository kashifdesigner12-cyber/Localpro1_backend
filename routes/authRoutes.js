const express = require("express");

const {
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
  logout,
} = require("../controllers/authController");

const {
  protect,
} = require("../middleware/authMiddleware");

const router = express.Router();

// ==========================================
// IN-MEMORY RESPONSE CACHE FOR GET /me
// ==========================================
// To eliminate the persistent multi-second delay on subsequent layout/dashboard mounts,
// we cache the /me response for 15 seconds.
const meCache = new Map();
const ME_CACHE_TTL = 15000;

const cachedGetMe = async (req, res, next) => {
  const token = req.headers.authorization || req.cookies?.token;
  if (!token) {
    return getMe(req, res, next);
  }

  const cacheKey = `me_${token}`;
  const cached = meCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < ME_CACHE_TTL) {
    return res.status(200).json(cached.data);
  }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode === 200 && body?.success !== false) {
      meCache.set(cacheKey, { data: body, timestamp: Date.now() });
    }
    return originalJson(body);
  };

  return getMe(req, res, next);
};

// Clear cache on profile or password updates so fresh data is loaded immediately
const clearMeCache = (req, res, next) => {
  meCache.clear();
  return next();
};

// ==========================================
// PUBLIC AUTH ROUTES
// ==========================================

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);

// ==========================================
// PROTECTED AUTH ROUTES
// ==========================================

router.get("/me", protect, cachedGetMe);
router.put("/me", protect, clearMeCache, updateProfile);
router.put("/profile", protect, clearMeCache, updateProfile);

router.patch("/change-password", protect, clearMeCache, changePassword);
router.put("/change-password", protect, clearMeCache, changePassword);

// ==========================================
// EXPORT
// ==========================================
module.exports = router;