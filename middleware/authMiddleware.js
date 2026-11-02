
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const COOKIE_NAME = process.env.COOKIE_NAME || "localpro_token";

const USER_CACHE_TTL_MS = 5000;
const QUERY_TIMEOUT_MS = 3000;
const MAX_CACHE_SIZE = 5000;

const userCache = new Map();
const pendingUserQueries = new Map();

// ----------------------------------------------------
// ACTIVE USER CACHE
// ----------------------------------------------------

const getActiveUser = async (userId) => {
  const now = Date.now();
  const cached = userCache.get(userId);

  if (cached && cached.expiresAt > now) {
    userCache.delete(userId);
    userCache.set(userId, cached);

    return cached.user;
  }

  if (cached) {
    userCache.delete(userId);
  }

  const pendingQuery = pendingUserQueries.get(userId);

  if (pendingQuery) {
    return pendingQuery;
  }

  const query = User.findById(userId)
    .select("_id name username email role status")
    .lean()
    .maxTimeMS(QUERY_TIMEOUT_MS)
    .exec()
    .then((user) => {
      if (user && user.status === "active") {
        if (userCache.size >= MAX_CACHE_SIZE) {
          const oldestKey = userCache.keys().next().value;

          if (oldestKey) {
            userCache.delete(oldestKey);
          }
        }

        userCache.set(userId, {
          user,
          expiresAt: Date.now() + USER_CACHE_TTL_MS,
        });
      }

      return user;
    })
    .finally(() => {
      pendingUserQueries.delete(userId);
    });

  pendingUserQueries.set(userId, query);

  return query;
};

// ----------------------------------------------------
// TOKEN EXTRACTION
// Prefer Authorization header over cookie.
// ----------------------------------------------------

const getTokenFromRequest = (req) => {
  const authorization = req.headers?.authorization;

  if (authorization && /^Bearer\s+/i.test(authorization)) {
    const bearerToken = authorization
      .replace(/^Bearer\s+/i, "")
      .trim();

    if (bearerToken) {
      return bearerToken;
    }
  }

  const cookieToken = req.cookies?.[COOKIE_NAME];

  if (typeof cookieToken === "string" && cookieToken.trim()) {
    return cookieToken.trim();
  }

  return null;
};

// ----------------------------------------------------
// CACHE INVALIDATION
// ----------------------------------------------------

export const invalidateUserAuthCache = (userId) => {
  if (!userId) return;

  userCache.delete(String(userId));
};

// ----------------------------------------------------
// AUTHENTICATION MIDDLEWARE
// ----------------------------------------------------

export const protect = async (req, res, next) => {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please log in.",
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error("[AUTH ERROR] JWT_SECRET is missing.");

      return res.status(500).json({
        success: false,
        message: "Authentication configuration error.",
      });
    }

    let decoded;

    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      if (
        [
          "TokenExpiredError",
          "JsonWebTokenError",
          "NotBeforeError",
        ].includes(error.name)
      ) {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired authentication token.",
        });
      }

      throw error;
    }

    const userId =
      decoded?.id ||
      decoded?._id ||
      decoded?.sub;

    if (
      !userId ||
      !/^[a-f\d]{24}$/i.test(String(userId))
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token payload.",
      });
    }

    if (User.db?.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: "Database connection is not ready. Please try again.",
      });
    }

    const normalizedUserId = String(userId);

    const user = await getActiveUser(normalizedUserId);

    if (!user) {
      userCache.delete(normalizedUserId);

      return res.status(401).json({
        success: false,
        message: "User account not found or inactive.",
      });
    }

    if (user.status !== "active") {
      userCache.delete(normalizedUserId);

      return res.status(403).json({
        success: false,
        message: "Your account is not active.",
      });
    }

    req.user = user;

    return next();
  } catch (error) {
    console.error(
      `[AUTH ERROR] ${req.method} ${req.originalUrl}:`,
      error.message
    );

    return next(error);
  }
};
