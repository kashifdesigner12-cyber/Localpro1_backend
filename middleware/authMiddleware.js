const jwt = require("jsonwebtoken");
const User = require("../models/User");

// ============================================================
// PROTECT
// ============================================================
// Verify JWT from:
// 1. Authorization: Bearer <token>
// 2. HttpOnly cookie: token
// 3. x-auth-token header
//
// IMPORTANT:
// We still verify the CURRENT user from MongoDB so that:
// - Deleted users cannot use old JWTs
// - Blocked users cannot continue
// - Inactive users cannot continue
//
// Optimization:
// Only required user fields are selected.
// Password and unnecessary fields are NOT loaded.
// ============================================================

const protect = async (req, res, next) => {
  try {
    let token = null;

    // --------------------------------------------------------
    // 1. AUTHORIZATION HEADER
    // --------------------------------------------------------

    const authorization = req.headers.authorization;

    if (
      authorization &&
      authorization.startsWith("Bearer ")
    ) {
      token = authorization.slice(7).trim();
    }

    // --------------------------------------------------------
    // 2. HTTPONLY COOKIE
    // --------------------------------------------------------

    if (!token && req.cookies?.token) {
      token = req.cookies.token;
    }

    // --------------------------------------------------------
    // 3. X-AUTH-TOKEN
    // --------------------------------------------------------

    if (!token && req.headers["x-auth-token"]) {
      token = req.headers["x-auth-token"];
    }

    // --------------------------------------------------------
    // NO TOKEN
    // --------------------------------------------------------

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "No token provided. Access denied.",
      });
    }

    // --------------------------------------------------------
    // JWT SECRET CHECK
    // --------------------------------------------------------

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      console.error(
        "JWT_SECRET is missing from environment variables."
      );

      return res.status(500).json({
        success: false,
        message:
          "Server authentication configuration error.",
      });
    }

    // --------------------------------------------------------
    // VERIFY JWT
    // --------------------------------------------------------

    let decoded;

    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          message:
            "Token has expired. Please login again.",
        });
      }

      return res.status(401).json({
        success: false,
        message: "Invalid token.",
      });
    }

    // --------------------------------------------------------
    // VALIDATE TOKEN PAYLOAD
    // --------------------------------------------------------

    if (!decoded || !decoded.id) {
      return res.status(401).json({
        success: false,
        message: "Invalid token payload.",
      });
    }

    // --------------------------------------------------------
    // FIND CURRENT USER
    // --------------------------------------------------------
    //
    // IMPORTANT PERFORMANCE CHANGE:
    //
    // The previous code:
    //
    //   select("-password")
    //
    // could load almost the entire User document.
    //
    // We only need these fields for authentication and
    // authorization.
    //
    // This makes the query smaller and reduces MongoDB ->
    // Node.js data transfer.
    // --------------------------------------------------------

    const user = await User.findById(decoded.id)
      .select(
        "_id name email role isDeleted isActive status"
      )
      .lean();

    // --------------------------------------------------------
    // USER DOES NOT EXIST
    // --------------------------------------------------------

    if (!user) {
      return res.status(401).json({
        success: false,
        message:
          "User no longer exists. Please login again.",
      });
    }

    // --------------------------------------------------------
    // SOFT-DELETED USER
    // --------------------------------------------------------

    if (user.isDeleted === true) {
      return res.status(401).json({
        success: false,
        message:
          "Your account has been deleted. Please contact the administrator.",
      });
    }

    // --------------------------------------------------------
    // IS ACTIVE CHECK
    // --------------------------------------------------------

    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message:
          "Your account is inactive.",
      });
    }

    // --------------------------------------------------------
    // ACCOUNT STATUS
    // --------------------------------------------------------

    if (user.status === "Blocked") {
      return res.status(403).json({
        success: false,
        message:
          "Your account has been blocked.",
      });
    }

    if (user.status === "Inactive") {
      return res.status(403).json({
        success: false,
        message:
          "Your account is inactive.",
      });
    }

    if (user.status === "Pending") {
      return res.status(403).json({
        success: false,
        message:
          "Your account is pending approval.",
      });
    }

    // --------------------------------------------------------
    // ATTACH USER TO REQUEST
    // --------------------------------------------------------

    req.user = user;

    return next();
  } catch (error) {
    console.error(
      "Authentication middleware error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error during authentication.",
    });
  }
};

// ============================================================
// ROLE-BASED AUTHORIZATION
// ============================================================
//
// Usage:
//
// authorize("admin")
// authorize("admin", "manager")
// authorize("admin", "manager", "user")
//
// ============================================================

const authorize = (...roles) => {
  return (req, res, next) => {
    // --------------------------------------------------------
    // AUTHENTICATION CHECK
    // --------------------------------------------------------

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    // --------------------------------------------------------
    // EXTRA ACCOUNT CHECK
    // --------------------------------------------------------

    if (req.user.isDeleted === true) {
      return res.status(401).json({
        success: false,
        message:
          "Your account has been deleted.",
      });
    }

    if (req.user.isActive === false) {
      return res.status(403).json({
        success: false,
        message:
          "Your account is inactive.",
      });
    }

    // --------------------------------------------------------
    // ROLE CHECK
    // --------------------------------------------------------

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message:
          `Access denied. Required role: ${roles.join(
            " or "
          )}.`,
      });
    }

    return next();
  };
};

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  protect,
  authorize,
};