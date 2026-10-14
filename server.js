
"use strict";

// =====================================================
// ENVIRONMENT
// =====================================================

require("dotenv").config();

const http = require("http");
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const connectDB = require("./config/db");

const {
  startAttendanceEmailScheduler,
  stopAttendanceEmailScheduler,
  sendDailyAttendanceEmails,
} = require("./services/attendanceEmailScheduler");

// =====================================================
// APP AND HTTP SERVER
// =====================================================

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;

app.disable("x-powered-by");

// =====================================================
// CORS CONFIGURATION
// =====================================================

// Always compare normalized origins, not full URL paths.
// Example: https://example.com/path becomes https://example.com.

function normalizeOrigin(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const input = value.trim();

  if (!input) {
    return null;
  }

  try {
    const parsed = new URL(input);

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
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

// Hostinger environment variable example:
// FRONTEND_URL=https://your-frontend.com,https://www.your-frontend.com

function addConfiguredOrigins(value, variableName) {
  if (!value) return;

  for (const item of value.split(",")) {
    const origin = normalizeOrigin(item);

    if (origin) {
      allowedOrigins.add(origin);
      console.log(`[CORS] Allowed origin configured: ${origin}`);
    } else if (item.trim()) {
      console.warn(
        `[CORS] Invalid URL in ${variableName}: ${item.trim()}`
      );
    }
  }
}

addConfiguredOrigins(
  process.env.FRONTEND_URL,
  "FRONTEND_URL"
);

addConfiguredOrigins(
  process.env.FRONTEND_LOGIN_URL,
  "FRONTEND_LOGIN_URL"
);

// Optional additional domains:
// FRONTEND_URL=https://frontend.example.com,https://www.frontend.example.com

const corsOrigin = (origin, callback) => {
  // Requests without an Origin header can include server-to-server
  // requests, health checks, and some command-line requests.
  if (!origin) {
    return callback(null, true);
  }

  const normalizedOrigin = normalizeOrigin(origin);

  if (
    normalizedOrigin &&
    allowedOrigins.has(normalizedOrigin)
  ) {
    return callback(null, true);
  }

  console.warn(`[CORS] Blocked origin: ${origin}`);

  return callback(new Error("Not allowed by CORS"));
};

const corsOptions = {
  origin: corsOrigin,
  credentials: true,
  methods: [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ],
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

  // WebSocket first, HTTP polling fallback.
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

  if (!sockets) return;

  sockets.delete(socketId);

  if (sockets.size === 0) {
    activeUsers.delete(id);

    io.emit("update_user_status", {
      userId: id,
      status: "offline",
    });
  }
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

// =====================================================
// SOCKET.IO CONNECTION HANDLING
// =====================================================

io.on("connection", (socket) => {
  const connectedAt = Date.now();

  console.log(
    `[Socket.IO] Connected: ${socket.id}; ` +
    `transport=${socket.conn.transport.name}; ` +
    `origin=${socket.handshake.headers.origin || "none"}`
  );

  let connectedUserId = null;

  // Authenticate the socket using the JWT token.
  try {
    const authorization =
      socket.handshake.headers?.authorization || "";

    const token =
      socket.handshake.auth?.token ||
      authorization.replace(/^Bearer\s+/i, "");

    if (token && process.env.JWT_SECRET) {
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET
      );

      const userId =
        decoded?.id ||
        decoded?._id ||
        decoded?.userId;

      if (userId) {
        connectedUserId = String(userId);
        socket.data.userId = connectedUserId;

        socket.join(connectedUserId);

        addActiveSocket(
          connectedUserId,
          socket.id
        );

        io.emit("update_user_status", {
          userId: connectedUserId,
          status: "online",
        });

        console.log(
          `[Socket.IO] Authenticated user ${connectedUserId}`
        );
      }
    }
  } catch (error) {
    console.warn(
      `[Socket.IO] Authentication failed for ${socket.id}:`,
      error.message
    );
  }

  // Legacy compatibility. Authenticated users cannot impersonate
  // a different user. Unauthenticated user_join remains a legacy
  // compatibility path and should be removed once all clients
  // send a valid JWT during the handshake.
  socket.on("user_join", (userId) => {
    if (!userId) return;

    const requestedId = String(userId);

    if (
      connectedUserId &&
      requestedId !== connectedUserId
    ) {
      console.warn(
        `[Socket.IO] Rejected mismatched user_join: ${socket.id}`
      );

      return;
    }

    if (!connectedUserId) {
      connectedUserId = requestedId;
      socket.data.userId = requestedId;

      addActiveSocket(requestedId, socket.id);
    }

    socket.join(connectedUserId);

    io.emit("update_user_status", {
      userId: connectedUserId,
      status: "online",
    });

    console.log(
      `[Socket.IO] User ${connectedUserId} joined private room`
    );
  });

  // Join a conversation room.
  // IMPORTANT: the conversation membership should be verified
  // against the database before allowing private-room access.
  socket.on("join_room", (roomId, callback) => {
    if (!roomId) {
      if (typeof callback === "function") {
        callback({
          success: false,
          message: "Missing room ID",
        });
      }

      return;
    }

    // Do not allow an unauthenticated socket to join arbitrary rooms.
    if (!connectedUserId) {
      if (typeof callback === "function") {
        callback({
          success: false,
          message: "Authentication required",
        });
      }

      return;
    }

    const normalizedRoomId = String(roomId);

    socket.join(normalizedRoomId);

    if (typeof callback === "function") {
      callback({
        success: true,
        roomId: normalizedRoomId,
      });
    }
  });

  socket.on("leave_room", (roomId, callback) => {
    if (!roomId) return;

    const normalizedRoomId = String(roomId);

    if (
      connectedUserId &&
      normalizedRoomId === connectedUserId
    ) {
      return;
    }

    socket.leave(normalizedRoomId);

    if (typeof callback === "function") {
      callback({
        success: true,
        roomId: normalizedRoomId,
      });
    }
  });

  socket.conn.on("upgrade", (transport) => {
    console.log(
      `[Socket.IO] Transport upgraded for ${socket.id}: ` +
      transport.name
    );
  });

  socket.on("disconnect", (reason) => {
    if (connectedUserId) {
      removeActiveSocket(
        connectedUserId,
        socket.id
      );

      console.log(
        `[Socket.IO] User ${connectedUserId} disconnected: ` +
        `${reason}; connected for ${Date.now() - connectedAt}ms`
      );
    } else {
      console.log(
        `[Socket.IO] Disconnected: ${socket.id}; reason=${reason}`
      );
    }
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

  console.error(
    `[Server] Invalid router export from ${routePath}`
  );

  throw new TypeError(
    `Route file ${routePath} does not export an Express router.`
  );
};

// =====================================================
// UPLOADS DIRECTORY
// =====================================================

const uploadsDir = path.join(__dirname, "uploads");

fs.mkdirSync(uploadsDir, { recursive: true });

// =====================================================
// EXPRESS MIDDLEWARE
// =====================================================

// Keep CORS before routes so it can handle preflight requests.
app.use(cors(corsOptions));

app.use(cookieParser());

app.use(express.json({ limit: "50mb" }));

app.use(
  express.urlencoded({
    extended: true,
    limit: "50mb",
  })
);

// =====================================================
// STATIC FILES
// =====================================================

app.use(
  "/uploads",
  express.static(uploadsDir, {
    index: false,
    dotfiles: "deny",
    maxAge:
      process.env.NODE_ENV === "production"
        ? "1d"
        : 0,
    setHeaders(res) {
      res.setHeader(
        "X-Content-Type-Options",
        "nosniff"
      );
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

app.post(
  "/api/send-attendance-reminders",
  async (req, res) => {
    try {
      console.log(
        "[Attendance Email] Manual sending started."
      );

      const result = await sendDailyAttendanceEmails();

      console.log(
        "[Attendance Email] Completed:",
        result
      );

      return res.status(200).json({
        success: true,
        message:
          "Attendance reminder emails sent successfully.",
        result,
      });
    } catch (error) {
      console.error(
        "[Attendance Email] Error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to send attendance reminder emails.",
      });
    }
  }
);

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
  ["/api/marketing", "./routes/marketingRoutes"],
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
// 404 HANDLER
// =====================================================

app.use((req, res) => {
  console.warn(
    `[404] ${req.method} ${req.originalUrl}`
  );

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

  if (res.headersSent) {
    return next(error);
  }

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

    if (
      typeof processAttendanceNotifications !== "function"
    ) {
      console.warn(
        "[Attendance] Processing function unavailable."
      );

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
        const result =
          await processAttendanceNotifications();

        console.log(
          "[Attendance] Scheduler completed:",
          result
        );
      } catch (error) {
        console.error(
          "[Attendance] Scheduler error:",
          error
        );
      }
    }, 60 * 1000);

    console.log(
      "[Attendance] Scheduler started (60 seconds)."
    );
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
    if (
      typeof startAttendanceEmailScheduler !== "function"
    ) {
      console.warn(
        "[Attendance Email] Scheduler unavailable."
      );

      return;
    }

    if (attendanceEmailSchedulerStarted) return;

    startAttendanceEmailScheduler();
    attendanceEmailSchedulerStarted = true;

    console.log(
      "[Attendance Email] Scheduler started."
    );
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

    console.log(
      "[Attendance Email] Scheduler stopped."
    );
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

    console.log(
      "[Database] MongoDB connection established."
    );

    server.on("error", (error) => {
      console.error("[Server] HTTP server error:", error);

      if (error.code === "EADDRINUSE") {
        console.error(
          `[Server] Port ${PORT} is already in use.`
        );
      }
    });

    server.listen(PORT, "0.0.0.0", () => {
      serverStarted = true;

      console.log(`[Server] Running on port ${PORT}`);

      console.log(
        `[Environment] ${process.env.NODE_ENV || "development"}`
      );

      console.log(
        "[CORS] Allowed origins:",
        [...allowedOrigins]
      );

      console.log(
        "[Socket.IO] Real-time server initialized."
      );

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

  console.log(
    `[Server] ${signal} received. Shutting down...`
  );

  if (attendanceScheduler) {
    clearInterval(attendanceScheduler);
    attendanceScheduler = null;
  }

  stopAttendanceEmailSchedulerSafe();

  const forceShutdownTimer = setTimeout(() => {
    console.error(
      "[Server] Forced shutdown after timeout."
    );

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
            console.log(
              "[Server] HTTP server closed."
            );
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

    console.log(
      "[Server] Shutdown completed."
    );

    process.exit(0);
  } catch (error) {
    console.error(
      "[Server] Shutdown error:",
      error.message
    );

    process.exit(1);
  }
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("unhandledRejection", (reason) => {
  console.error(
    "[Process] Unhandled promise rejection:",
    reason
  );
});

process.on("uncaughtException", (error) => {
  console.error(
    "[Process] Uncaught exception:",
    error
  );

  void shutdown("uncaughtException");
});

// =====================================================
// BOOT
// =====================================================

startServer();
