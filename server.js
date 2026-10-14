"use strict";

require("dotenv").config();

const http = require("http");
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const connectDB = require("./config/db");
const Conversation = require("./models/Conversation");

const {
  startAttendanceEmailScheduler,
  stopAttendanceEmailScheduler,
  sendDailyAttendanceEmails,
} = require("./services/attendanceEmailScheduler");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

app.disable("x-powered-by");

// =====================================================
// CORS
// =====================================================

function normalizeOrigin(value) {
  if (!value || typeof value !== "string") return null;

  try {
    const parsed = new URL(value.trim());

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    return parsed.origin;
  } catch {
    return null;
  }
}

const allowedOrigins = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "https://localpro1.net",
  "https://www.localpro1.net",
]);

function addConfiguredOrigins(value, variableName) {
  if (!value) return;

  for (const item of value.split(",")) {
    const origin = normalizeOrigin(item);

    if (origin) {
      allowedOrigins.add(origin);
      console.log(`[CORS] Configured origin: ${origin}`);
    } else if (item.trim()) {
      console.warn(`[CORS] Invalid URL in ${variableName}`);
    }
  }
}

addConfiguredOrigins(process.env.FRONTEND_URL, "FRONTEND_URL");
addConfiguredOrigins(
  process.env.FRONTEND_LOGIN_URL,
  "FRONTEND_LOGIN_URL"
);

function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true);

  const normalized = normalizeOrigin(origin);

  if (normalized && allowedOrigins.has(normalized)) {
    return callback(null, true);
  }

  console.warn(`[CORS] Blocked origin: ${origin}`);
  return callback(new Error("Not allowed by CORS"));
}

const corsOptions = {
  origin: corsOrigin,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "X-Requested-With",
  ],
  exposedHeaders: ["Content-Disposition"],
  maxAge: 600,
};

const socketCorsOptions = {
  origin: corsOrigin,
  credentials: true,
  methods: ["GET", "POST"],
};

// =====================================================
// SOCKET.IO
// =====================================================

const io = new Server(server, {
  cors: socketCorsOptions,
  transports: ["websocket", "polling"],
  pingInterval: 25000,
  pingTimeout: 20000,
  connectTimeout: 20000,
  maxHttpBufferSize: 5e6,

  connectionStateRecovery: {
    maxDisconnectionDuration: 120000,
    skipMiddlewares: false,
  },
});

app.set("io", io);

// userId -> Set of socket IDs
const activeUsers = new Map();

app.set("activeUsers", activeUsers);

function addActiveSocket(userId, socketId) {
  const id = String(userId);

  if (!activeUsers.has(id)) {
    activeUsers.set(id, new Set());
  }

  activeUsers.get(id).add(socketId);
}

function removeActiveSocket(userId, socketId) {
  const id = String(userId);
  const sockets = activeUsers.get(id);

  if (!sockets) return false;

  sockets.delete(socketId);

  if (sockets.size === 0) {
    activeUsers.delete(id);

    io.emit("update_user_status", {
      userId: id,
      status: "offline",
    });

    return true;
  }

  return false;
}

function getSocketStats() {
  let connectedSockets = 0;

  for (const sockets of activeUsers.values()) {
    connectedSockets += sockets.size;
  }

  return {
    connectedUsers: activeUsers.size,
    connectedSockets,
    transportConnections: io.engine.clientsCount,
  };
}

function getTokenFromSocket(socket) {
  const authorization =
    socket.handshake.headers?.authorization || "";

  const bearerToken = authorization.replace(/^Bearer\s+/i, "");

  return (
    socket.handshake.auth?.token ||
    bearerToken ||
    null
  );
}

function getDecodedUserId(decoded) {
  const id = decoded?.id || decoded?._id || decoded?.userId;

  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
    return null;
  }

  return String(id);
}

function getDecodedRole(decoded) {
  return String(
    decoded?.role ||
    decoded?.userRole ||
    decoded?.accountType ||
    ""
  ).toLowerCase();
}

function replyToSocket(callback, result) {
  if (typeof callback === "function") {
    callback(result);
  }
}

// =====================================================
// SOCKET AUTHENTICATION
// =====================================================

// Every socket must provide a valid JWT.
io.use((socket, next) => {
  try {
    if (!process.env.JWT_SECRET) {
      console.error("[Socket.IO] JWT_SECRET is not configured.");
      return next(new Error("Socket authentication unavailable."));
    }

    const token = getTokenFromSocket(socket);

    if (!token) {
      return next(new Error("Authentication required."));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = getDecodedUserId(decoded);

    if (!userId) {
      return next(new Error("Invalid authentication token."));
    }

    socket.data.userId = userId;
    socket.data.role = getDecodedRole(decoded);

    return next();
  } catch (error) {
    console.warn(
      `[Socket.IO] Authentication rejected: ${error.message}`
    );

    return next(new Error("Invalid or expired authentication token."));
  }
});

// =====================================================
// CONVERSATION ACCESS
// =====================================================

async function canJoinConversation(userId, role, conversationId) {
  if (
    typeof conversationId !== "string" ||
    !mongoose.Types.ObjectId.isValid(conversationId)
  ) {
    return false;
  }

  const conversation = await Conversation.findById(conversationId)
    .select("participants userId isGroup")
    .lean();

  if (!conversation) return false;

  const participantIds = (conversation.participants || []).map(
    (participant) => String(participant?._id || participant)
  );

  if (participantIds.includes(String(userId))) {
    return true;
  }

  // Support legacy conversations that store userId.
  if (String(conversation.userId || "") === String(userId)) {
    return true;
  }

  // Preserve the existing administrative access policy.
  if (role === "admin" || role === "manager") {
    return true;
  }

  return false;
}

// =====================================================
// SOCKET CONNECTION
// =====================================================

io.on("connection", (socket) => {
  const connectedAt = Date.now();

  const connectedUserId = socket.data.userId;
  const connectedUserRole = socket.data.role || "";

  console.log(
    `[Socket.IO] Connected: ${socket.id}; ` +
    `user=${connectedUserId}; ` +
    `transport=${socket.conn.transport.name}; ` +
    `origin=${socket.handshake.headers.origin || "none"}`
  );

  // Private room: controllers can continue using io.to(userId).
  socket.join(connectedUserId);

  addActiveSocket(connectedUserId, socket.id);

  io.emit("update_user_status", {
    userId: connectedUserId,
    status: "online",
  });

  // Legacy event retained. It cannot impersonate another user.
  socket.on("user_join", (requestedUserId, callback) => {
    if (
      !requestedUserId ||
      String(requestedUserId) !== connectedUserId
    ) {
      replyToSocket(callback, {
        success: false,
        message: "You can only join your own user room.",
      });

      return;
    }

    socket.join(connectedUserId);

    replyToSocket(callback, {
      success: true,
      userId: connectedUserId,
    });
  });

  // Join a conversation only after verifying access.
  socket.on("join_room", async (roomId, callback) => {
    if (typeof roomId !== "string" || !roomId.trim()) {
      replyToSocket(callback, {
        success: false,
        message: "Missing or invalid conversation ID.",
      });

      return;
    }

    const normalizedRoomId = roomId.trim();

    try {
      const allowed = await canJoinConversation(
        connectedUserId,
        connectedUserRole,
        normalizedRoomId
      );

      if (!allowed) {
        replyToSocket(callback, {
          success: false,
          message: "You do not have access to this conversation.",
        });

        console.warn(
          `[Socket.IO] Rejected room join: ` +
          `user=${connectedUserId}, room=${normalizedRoomId}`
        );

        return;
      }

      socket.join(normalizedRoomId);

      replyToSocket(callback, {
        success: true,
        roomId: normalizedRoomId,
      });
    } catch (error) {
      console.error(
        "[Socket.IO] Room authorization error:",
        error
      );

      replyToSocket(callback, {
        success: false,
        message: "Unable to authorize conversation access.",
      });
    }
  });

  socket.on("leave_room", (roomId, callback) => {
    if (typeof roomId !== "string" || !roomId.trim()) {
      replyToSocket(callback, {
        success: false,
        message: "A valid room ID is required.",
      });

      return;
    }

    const normalizedRoomId = roomId.trim();

    if (normalizedRoomId === connectedUserId) {
      replyToSocket(callback, {
        success: false,
        message: "Cannot leave the private user room.",
      });

      return;
    }

    socket.leave(normalizedRoomId);

    replyToSocket(callback, {
      success: true,
      roomId: normalizedRoomId,
    });
  });

  socket.conn.on("upgrade", (transport) => {
    console.log(
      `[Socket.IO] Transport upgraded for ${socket.id}: ${transport.name}`
    );
  });

  socket.on("disconnect", (reason) => {
    removeActiveSocket(connectedUserId, socket.id);

    console.log(
      `[Socket.IO] User ${connectedUserId} disconnected: ${reason}; ` +
      `connected for ${Date.now() - connectedAt}ms`
    );
  });

  socket.on("error", (error) => {
    console.error(
      `[Socket.IO] Error on ${socket.id}:`,
      error.message
    );
  });
});

io.engine.on("connection_error", (error) => {
  console.error("[Socket.IO] Connection error:", {
    code: error.code,
    message: error.message,
    context: error.context,
  });
});

// =====================================================
// ROUTER LOADER
// =====================================================

const loadRouter = (routePath) => {
  const routeModule = require(routePath);

  if (typeof routeModule === "function") {
    return routeModule;
  }

  if (
    routeModule &&
    typeof routeModule.router === "function"
  ) {
    return routeModule.router;
  }

  if (
    routeModule &&
    typeof routeModule.default === "function"
  ) {
    return routeModule.default;
  }

  console.error(`[Server] Invalid router export: ${routePath}`);

  throw new TypeError(
    `Route file ${routePath} does not export an Express router.`
  );
};

// =====================================================
// UPLOADS
// =====================================================

const uploadsDir = path.join(__dirname, "uploads");

fs.mkdirSync(uploadsDir, { recursive: true });

// =====================================================
// EXPRESS MIDDLEWARE
// =====================================================

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// =====================================================
// STATIC FILES
// =====================================================

app.use(
  "/uploads",
  express.static(uploadsDir, {
    index: false,
    dotfiles: "deny",
    maxAge: process.env.NODE_ENV === "production" ? "1d" : 0,
    setHeaders(res) {
      res.setHeader("X-Content-Type-Options", "nosniff");
    },
  })
);

// =====================================================
// HEALTH CHECKS
// =====================================================

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "API is working",
    realtime: "Socket.IO initialized",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
    socket: getSocketStats(),
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Backend is running",
    timestamp: new Date().toISOString(),
    socket: getSocketStats(),
  });
});

// =====================================================
// ATTENDANCE EMAILS
// =====================================================

app.post("/api/send-attendance-reminders", async (req, res) => {
  try {
    console.log("[Attendance Email] Manual sending started.");

    const result = await sendDailyAttendanceEmails();

    console.log("[Attendance Email] Completed:", result);

    return res.status(200).json({
      success: true,
      message: "Attendance reminder emails sent successfully.",
      result,
    });
  } catch (error) {
    console.error("[Attendance Email] Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to send attendance reminder emails.",
    });
  }
});

// =====================================================
// API ROUTES
// =====================================================

const routes = [
  ["/api/auth", "./routes/authRoutes"],
  ["/api/users", "./routes/userRoutes"],
  ["/api/signup-requests", "./routes/signupRequestRoutes"],
  ["/api/leave-requests", "./routes/leaveRequestRoutes"],
  ["/api/notifications", "./routes/notificationRoutes"],
  ["/api/tasks", "./routes/taskRoutes"],
  ["/api/dashboard", "./routes/dashboardRoutes"],
  ["/api/conversations", "./routes/conversationRoutes"],
  ["/api/messages", "./routes/messageRoutes"],
  ["/api/attendance", "./routes/attendanceRoutes"],
  ["/api/events", "./routes/eventRoutes"],
  ["/api/calendar", "./routes/calendarRoutes"],
  ["/api/appointments", "./routes/eventRoutes"],
  ["/api/calls", "./routes/callRoutes"],
  ["/api/contacts", "./routes/contactRoutes"],
  ["/api/leads", "./routes/contactRoutes"],
  ["/api/emails", "./routes/emailRoutes"],
  ["/api/media", "./routes/mediaRoutes"],
  ["/api/files", "./routes/mediaRoutes"],
  ["/api/campaigns", "./routes/campaignRoutes"],
  ["/api/ai-agents", "./routes/agentRoutes"],
  ["/api/agents", "./routes/agentRoutes"],
  ["/api/analytics", "./routes/analyticsRoutes"],
  ["/api/settings", "./routes/settingsRoutes"],
  ["/api/activity", "./routes/activityRoutes"],
];

for (const [prefix, routePath] of routes) {
  app.use(prefix, loadRouter(routePath));
}

// =====================================================
// 404
// =====================================================

app.use((req, res) => {
  console.warn(`[404] ${req.method} ${req.originalUrl}`);

  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// =====================================================
// GLOBAL ERROR HANDLER
// =====================================================

app.use((error, req, res, next) => {
  console.error("[Server Error]", {
    method: req.method,
    url: req.originalUrl,
    message: error.message,
    stack:
      process.env.NODE_ENV === "production"
        ? undefined
        : error.stack,
  });

  if (res.headersSent) return next(error);

  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "File size exceeds the configured upload limit."
        : `File upload error: ${error.message}`;

    return res.status(400).json({
      success: false,
      message,
    });
  }

  if (error.message === "Not allowed by CORS") {
    return res.status(403).json({
      success: false,
      message: "Origin is not allowed by CORS.",
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error.",
  });
});

// =====================================================
// SCHEDULER STATE
// =====================================================

let attendanceScheduler = null;
let attendanceEmailSchedulerStarted = false;
let shuttingDown = false;
let serverStarted = false;

// =====================================================
// ATTENDANCE SCHEDULER
// =====================================================

const startAttendanceScheduler = () => {
  try {
    const {
      processAttendanceNotifications,
    } = require("./controllers/attendanceController");

    if (typeof processAttendanceNotifications !== "function") {
      console.warn("[Attendance] Processing function unavailable.");
      return;
    }

    if (attendanceScheduler) return;

    Promise.resolve()
      .then(() => processAttendanceNotifications())
      .then((result) => {
        console.log(
          "[Attendance] Initial processing completed:",
          result
        );
      })
      .catch((error) => {
        console.error(
          "[Attendance] Initial processing error:",
          error
        );
      });

    attendanceScheduler = setInterval(async () => {
      if (shuttingDown) return;

      try {
        const result = await processAttendanceNotifications();

        console.log("[Attendance] Scheduler completed:", result);
      } catch (error) {
        console.error("[Attendance] Scheduler error:", error);
      }
    }, 60 * 1000);

    console.log("[Attendance] Scheduler started (60 seconds).");
  } catch (error) {
    console.error(
      "[Attendance] Failed to start scheduler:",
      error
    );
  }
};

// =====================================================
// ATTENDANCE EMAIL SCHEDULER
// =====================================================

const startAttendanceEmailSchedulerSafe = () => {
  try {
    if (typeof startAttendanceEmailScheduler !== "function") {
      console.warn("[Attendance Email] Scheduler unavailable.");
      return;
    }

    if (attendanceEmailSchedulerStarted) return;

    startAttendanceEmailScheduler();
    attendanceEmailSchedulerStarted = true;

    console.log("[Attendance Email] Scheduler started.");
  } catch (error) {
    console.error(
      "[Attendance Email] Scheduler startup failed:",
      error
    );
  }
};

const stopAttendanceEmailSchedulerSafe = () => {
  try {
    if (
      typeof stopAttendanceEmailScheduler !== "function" ||
      !attendanceEmailSchedulerStarted
    ) {
      return;
    }

    stopAttendanceEmailScheduler();
    attendanceEmailSchedulerStarted = false;

    console.log("[Attendance Email] Scheduler stopped.");
  } catch (error) {
    console.error(
      "[Attendance Email] Scheduler shutdown failed:",
      error
    );
  }
};

// =====================================================
// START SERVER
// =====================================================

const startServer = async () => {
  try {
    await connectDB();

    if (shuttingDown) return;

    console.log("[Database] MongoDB connection established.");

    server.on("error", (error) => {
      console.error("[Server] HTTP server error:", error);

      if (error.code === "EADDRINUSE") {
        console.error(`[Server] Port ${PORT} is already in use.`);
      }
    });

    server.listen(PORT, "0.0.0.0", () => {
      serverStarted = true;

      console.log(`[Server] Running on port ${PORT}`);
      console.log(
        `[Environment] ${process.env.NODE_ENV || "development"}`
      );
      console.log("[CORS] Allowed origins:", [...allowedOrigins]);
      console.log("[Socket.IO] Real-time server initialized.");

      startAttendanceScheduler();
      startAttendanceEmailSchedulerSafe();
    });
  } catch (error) {
    console.error(
      "[Server] Failed to start:",
      error.stack || error.message
    );

    process.exitCode = 1;
  }
};

// =====================================================
// GRACEFUL SHUTDOWN
// =====================================================

const shutdown = async (signal) => {
  if (shuttingDown) return;

  shuttingDown = true;

  console.log(`[Server] ${signal} received. Shutting down...`);

  if (attendanceScheduler) {
    clearInterval(attendanceScheduler);
    attendanceScheduler = null;
  }

  stopAttendanceEmailSchedulerSafe();

  const forceShutdownTimer = setTimeout(() => {
    console.error("[Server] Forced shutdown after timeout.");
    process.exit(1);
  }, 10000);

  forceShutdownTimer.unref();

  try {
    if (serverStarted && server.listening) {
      await new Promise((resolve) => {
        server.close((error) => {
          if (error) {
            console.error(
              "[Server] HTTP close error:",
              error.message
            );
          } else {
            console.log("[Server] HTTP server closed.");
          }

          resolve();
        });
      });
    }

    await new Promise((resolve) => {
      io.close(() => resolve());
    });

    const { closeMongoDB } = require("./config/db");

    if (typeof closeMongoDB === "function") {
      await closeMongoDB();
    }

    clearTimeout(forceShutdownTimer);

    console.log("[Server] Shutdown completed.");
    process.exit(0);
  } catch (error) {
    console.error("[Server] Shutdown error:", error.message);
    process.exit(1);
  }
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  console.error("[Process] Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[Process] Uncaught exception:", error);
  void shutdown("uncaughtException");
});

// =====================================================
// BOOT
// =====================================================

startServer();