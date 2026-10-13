"use strict";

// =====================================================
// ENVIRONMENT
// =====================================================

require("dotenv").config();

const dns = require("dns");

// DNS fallback
dns.setServers(["1.1.1.1", "8.8.8.8"]);

// =====================================================
// IMPORTS
// =====================================================

const http = require("http");
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const { Server } = require("socket.io");

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

const normalizeOrigin = (origin) =>
  origin ? origin.replace(/\/+$/, "") : origin;

const allowedOrigins = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "https://localpro1.net",
]);

if (process.env.FRONTEND_URL) {
  for (const origin of process.env.FRONTEND_URL.split(",")) {
    const normalized = normalizeOrigin(origin.trim());
    if (normalized) allowedOrigins.add(normalized);
  }
}

const corsOrigin = (origin, callback) => {
  if (!origin || allowedOrigins.has(normalizeOrigin(origin))) {
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

// =====================================================
// SOCKET.IO — REAL-TIME FOUNDATION (OPTIMIZED FOR 1S LATENCY)
// =====================================================

const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    credentials: true,
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
  pingInterval: 10000,
  pingTimeout: 5000,
  connectTimeout: 10000,
  maxHttpBufferSize: 5e6, // Increased buffer size for fast file transfer (5MB)
});

// Make Socket.IO available to controllers and routes.
app.set("io", io);

// Connected online users tracking map for blue tick / active status
const activeUsers = new Map();

io.on("connection", (socket) => {
  console.log(`[Socket.IO] Connected: ${socket.id}`);

  // User join personal room or online status register
  socket.on("user_join", (userId) => {
    if (userId) {
      activeUsers.set(userId, socket.id);
      socket.join(userId);
      // Broadcast online status to all users/admin
      io.emit("update_user_status", { userId, status: "online" });
      console.log(`[Socket.IO] User online & joined room: ${userId}`);
    }
  });

  // Join Conversation / Group Room
  socket.on("join_room", (roomId) => {
    if (roomId) {
      socket.join(roomId);
      console.log(`[Socket.IO] Socket ${socket.id} joined room: ${roomId}`);
    }
  });

  // Leave Conversation / Group Room
  socket.on("leave_room", (roomId) => {
    if (roomId) {
      socket.leave(roomId);
    }
  });

  socket.on("disconnect", (reason) => {
    for (let [userId, sId] of activeUsers.entries()) {
      if (sId === socket.id) {
        activeUsers.delete(userId);
        io.emit("update_user_status", { userId, status: "offline" });
        console.log(`[Socket.IO] User offline: ${userId}`);
        break;
      }
    }
    console.log(`[Socket.IO] Disconnected: ${socket.id} (${reason})`);
  });

  socket.on("error", (error) => {
    console.error("[Socket.IO] Socket error:", error.message);
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

  console.error(`Invalid router export from ${routePath}`);

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

app.use(cors(corsOptions));

app.use(cookieParser());

app.use(
  express.json({
    limit: "50mb",
  })
);

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
    maxAge: process.env.NODE_ENV === "production"
      ? "1d"
      : 0,
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
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Backend is running",
    timestamp: new Date().toISOString(),
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
// Existing routes preserved
// =====================================================

const routes = [
  ["/api/auth", "./routes/authRoutes"],
  ["/api/users", "./routes/userRoutes"],
  ["/api/signup-requests", "./routes/signupRequestRoutes"],
  ["/api/leave-requests", "./routes/leaveRequestRoutes"],
  ["/api/notifications", "./routes/notificationRoutes"],
  ["/api/tasks", "./routes/taskRoutes"],
  ["/api/dashboard", "./routes/dashboardRoutes"],

  // Messaging
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
  ["/api/marketing", "./routes/campaignRoutes"],
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
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// =====================================================
// GLOBAL ERROR HANDLER
// =====================================================

app.use((error, req, res, next) => {
  console.error("[Server Error]", error);

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
      message: "Origin is not allowed.",
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error.",
  });
});

// =====================================================
// ATTENDANCE SCHEDULER
// =====================================================

let attendanceScheduler = null;
let attendanceEmailSchedulerStarted = false;
let shuttingDown = false;

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

    if (attendanceScheduler) {
      return;
    }

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

    if (attendanceEmailSchedulerStarted) {
      return;
    }

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
      typeof stopAttendanceEmailScheduler !== "function"
    ) {
      return;
    }

    if (!attendanceEmailSchedulerStarted) {
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

    console.log(
      "[Database] MongoDB connection established."
    );

    server.listen(PORT, () => {
      console.log(
        `[Server] Running on port ${PORT}`
      );

      console.log(
        `[Environment] ${process.env.NODE_ENV || "development"}`
      );

      console.log(
        "[Socket.IO] Real-server initialized with speed optimizations."
      );
    });

    startAttendanceScheduler();
    startAttendanceEmailSchedulerSafe();
  } catch (error) {
    console.error(
      "[Server] Failed to start:",
      error
    );

    process.exit(1);
  }
};

// =====================================================
// GRACEFUL SHUTDOWN
// =====================================================

const shutdown = async (signal) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(
    `[Server] ${signal} received. Shutting down...`
  );

  if (attendanceScheduler) {
    clearInterval(attendanceScheduler);
    attendanceScheduler = null;
  }

  stopAttendanceEmailSchedulerSafe();

  io.close();

  server.close(() => {
    console.log("[Server] HTTP server closed.");
    process.exit(0);
  });

  setTimeout(() => {
    console.error(
      "[Server] Forced shutdown after timeout."
    );
    process.exit(1);
  }, 10000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

startServer();