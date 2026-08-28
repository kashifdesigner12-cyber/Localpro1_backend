const jwt = require("jsonwebtoken");
const User = require("../models/User");

// ============================================================
// PROTECT
// ============================================================
// Verify JWT from:
// 1. Authorization: Bearer <token>
// 2. HttpOnly cookie: token
// 3. x-auth-token header
// ============================================================

const protect = async (req, res, next) => {
  try {
    let token = null;

    // --------------------------------------------------------
    // 1. AUTHORIZATION HEADER
    // --------------------------------------------------------

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer ")
    ) {
      token =
        req.headers.authorization.split(" ")[1];
    }

    // --------------------------------------------------------
    // 2. HTTPONLY COOKIE
    // --------------------------------------------------------

    else if (
      req.cookies &&
      req.cookies.token
    ) {
      token = req.cookies.token;
    }

    // --------------------------------------------------------
    // 3. X-AUTH-TOKEN
    // --------------------------------------------------------

    else if (
      req.headers["x-auth-token"]
    ) {
      token =
        req.headers["x-auth-token"];
    }

    // --------------------------------------------------------
    // NO TOKEN
    // --------------------------------------------------------

    if (!token) {
      return res.status(401).json({
        success: false,
        message:
          "No token provided. Access denied.",
      });
    }

    // --------------------------------------------------------
    // JWT SECRET CHECK
    // --------------------------------------------------------

    if (!process.env.JWT_SECRET) {
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
      decoded = jwt.verify(
        token,
        process.env.JWT_SECRET
      );
    } catch (error) {
      // Token expired
      if (
        error.name ===
        "TokenExpiredError"
      ) {
        return res.status(401).json({
          success: false,
          message:
            "Token has expired. Please login again.",
        });
      }

      // Invalid token
      return res.status(401).json({
        success: false,
        message: "Invalid token.",
      });
    }

    // --------------------------------------------------------
    // VALIDATE TOKEN PAYLOAD
    // --------------------------------------------------------

    if (
      !decoded ||
      !decoded.id
    ) {
      return res.status(401).json({
        success: false,
        message:
          "Invalid token payload.",
      });
    }

    // --------------------------------------------------------
    // FIND CURRENT USER
    // --------------------------------------------------------

    const user =
      await User.findById(
        decoded.id
      ).select("-password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message:
          "User no longer exists.",
      });
    }

    // --------------------------------------------------------
    // ACCOUNT STATUS
    // --------------------------------------------------------

    if (
      user.status === "Blocked"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Your account has been blocked.",
      });
    }

    if (
      user.status === "Inactive"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Your account is inactive.",
      });
    }

    if (
      user.status === "Pending"
    ) {
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

    next();
  } catch (error) {
    console.error(
      "Authentication middleware error:",
      error
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
        message:
          "Authentication required.",
      });
    }

    // --------------------------------------------------------
    // ROLE CHECK
    // --------------------------------------------------------

    if (
      !roles.includes(req.user.role)
    ) {
      return res.status(403).json({
        success: false,
        message:
          `Access denied. Required role: ${roles.join(
            " or "
          )}.`,
      });
    }

    next();
  };
};

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  protect,
  authorize,
};