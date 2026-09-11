// =====================================================
// DNS SOLUTION
// =====================================================

const dns = require("dns");

dns.setServers(["1.1.1.1", "8.8.8.8"]);

// =====================================================
// ENVIRONMENT
// =====================================================

require("dotenv").config();

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
const connectDB = require("./config/db");

// =====================================================
// APP SETUP
// =====================================================

const app = express();
const server = http.createServer(app);

// =====================================================
// ROUTER LOADER
// =====================================================

const loadRouter = (routePath) => {
  const routeModule = require(routePath);

  // Direct Express Router
  if (typeof routeModule === "function") {
    return routeModule;
  }

  // { router }
  if (
    routeModule &&
    typeof routeModule.router === "function"
  ) {
    return routeModule.router;
  }

  // { default: router }
  if (
    routeModule &&
    typeof routeModule.default === "function"
  ) {
    return routeModule.default;
  }

  console.error(
    `Invalid router export from ${routePath}:`,
    routeModule
  );

  throw new TypeError(
    `Route file ${routePath} does not export an Express router.`
  );
};

// =====================================================
// UPLOADS DIRECTORY
// =====================================================

const uploadsDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, {
    recursive: true,
  });
}

// =====================================================
// CORS
// =====================================================

const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://localpro1.net",
];

if (process.env.FRONTEND_URL) {
  allowedOrigins.push(
    process.env.FRONTEND_URL.replace(/\/$/, "")
  );
}

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests without an Origin header
      // such as Postman and server-to-server requests.
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin = origin.replace(/\/$/, "");

      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      console.error(
        `CORS blocked origin: ${origin}`
      );

      return callback(
        new Error("Not allowed by CORS")
      );
    },

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

    exposedHeaders: [
      "Content-Disposition",
    ],

    // OPTIMIZATION: Cache preflight options requests for 10 minutes (600 seconds) 
    // to completely eliminate repeated preflight network round-trips before actual API calls.
    maxAge: 600,
  })
);

// =====================================================
// COOKIE PARSER
// =====================================================

app.use(cookieParser());

// =====================================================
// BODY PARSERS (Increased limit to 50mb for base64 profile pictures)
// =====================================================

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
// STATIC UPLOADS
// =====================================================

app.use(
  "/uploads",
  express.static(uploadsDir)
);

// =====================================================
// HEALTH CHECK
// =====================================================

// Existing API health endpoint
app.get("/api/health", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "API is working",
    timestamp: new Date(),
  });
});

// Simple health endpoint
// Useful for direct browser/server monitoring.
app.get("/health", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Backend is running",
    timestamp: new Date(),
  });
});

// =====================================================
// API ROUTES
// =====================================================

app.use(
  "/api/auth",
  loadRouter("./routes/authRoutes")
);

app.use(
  "/api/users",
  loadRouter("./routes/userRoutes")
);

app.use(
  "/api/signup-requests",
  loadRouter("./routes/signupRequestRoutes")
);

app.use(
  "/api/leave-requests",
  loadRouter("./routes/leaveRequestRoutes")
);

app.use(
  "/api/notifications",
  loadRouter("./routes/notificationRoutes")
);

app.use(
  "/api/tasks",
  loadRouter("./routes/taskRoutes")
);

app.use(
  "/api/dashboard",
  loadRouter("./routes/dashboardRoutes")
);

app.use(
  "/api/conversations",
  loadRouter("./routes/conversationRoutes")
);

app.use(
  "/api/messages",
  loadRouter("./routes/messageRoutes")
);

app.use(
  "/api/attendance",
  loadRouter("./routes/attendanceRoutes")
);

app.use(
  "/api/events",
  loadRouter("./routes/eventRoutes")
);

app.use(
  "/api/calendar",
  loadRouter("./routes/calendarRoutes")
);

app.use(
  "/api/appointments",
  loadRouter("./routes/eventRoutes")
);

app.use(
  "/api/calls",
  loadRouter("./routes/callRoutes")
);

app.use(
  "/api/contacts",
  loadRouter("./routes/contactRoutes")
);

app.use(
  "/api/leads",
  loadRouter("./routes/contactRoutes")
);

app.use(
  "/api/emails",
  loadRouter("./routes/emailRoutes")
);

app.use(
  "/api/media",
  loadRouter("./routes/mediaRoutes")
);

app.use(
  "/api/files",
  loadRouter("./routes/mediaRoutes")
);

app.use(
  "/api/campaigns",
  loadRouter("./routes/campaignRoutes")
);

app.use(
  "/api/marketing",
  loadRouter("./routes/campaignRoutes")
);

app.use(
  "/api/ai-agents",
  loadRouter("./routes/agentRoutes")
);

app.use(
  "/api/agents",
  loadRouter("./routes/agentRoutes")
);

app.use(
  "/api/analytics",
  loadRouter("./routes/analyticsRoutes")
);

app.use(
  "/api/settings",
  loadRouter("./routes/settingsRoutes")
);

app.use(
  "/api/activity",
  loadRouter("./routes/activityRoutes")
);

// =====================================================
// 404 HANDLER
// =====================================================

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// =====================================================
// GLOBAL ERROR HANDLER
// =====================================================

app.use((error, req, res, next) => {
  console.error(
    "Global server error:",
    error
  );

  if (res.headersSent) {
    return next(error);
  }

  // Specific handling for Multer file upload errors
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message:
          "File size exceeds the allowed limit (10MB).",
      });
    }

    return res.status(400).json({
      success: false,
      message: `File upload error: ${error.message}`,
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error.",
  });
});

// =====================================================
// DATABASE + SERVER
// =====================================================

const PORT = process.env.PORT || 5000;

let attendanceScheduler = null;

const startAttendanceScheduler = () => {
  try {
    const {
      processAttendanceNotifications,
    } = require("./controllers/attendanceController");

    if (
      typeof processAttendanceNotifications !==
      "function"
    ) {
      console.warn(
        "[Attendance] processAttendanceNotifications is not available."
      );

      return;
    }

    // Run initial processing in the background.
    // Do not block the HTTP server from starting.
    Promise.resolve()
      .then(() => {
        console.log(
          "[Attendance] Running initial attendance processing..."
        );

        return processAttendanceNotifications();
      })
      .then((result) => {
        console.log(
          "[Attendance] Initial processing:",
          result
        );
      })
      .catch((error) => {
        console.error(
          "[Attendance] Initial processing error:",
          error
        );
      });

    // Run every 60 seconds.
    attendanceScheduler = setInterval(async () => {
      try {
        const result =
          await processAttendanceNotifications();

        console.log(
          "[Attendance] Scheduler tick:",
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
      "[Attendance] Scheduler started. Running every 60 seconds."
    );
  } catch (error) {
    console.error(
      "[Attendance] Failed to start attendance scheduler:",
      error
    );
  }
};

const startServer = async () => {
  try {
    await connectDB();

    console.log(
      "[Database] MongoDB connection established."
    );

    // Start HTTP server immediately after DB connection.
    server.listen(PORT, () => {
      console.log(
        `Backend running on http://localhost:${PORT}`
      );
    });

    // Start non-critical background work
    // without blocking the HTTP server.
    startAttendanceScheduler();
  } catch (error) {
    console.error(
      "Failed to connect to MongoDB:",
      error
    );

    process.exit(1);
  }
};

startServer();

// =====================================================
// GRACEFUL SHUTDOWN
// =====================================================

const shutdown = async (signal) => {
  console.log(
    `${signal} received. Shutting down server...`
  );

  if (attendanceScheduler) {
    clearInterval(
      attendanceScheduler
    );

    attendanceScheduler = null;

    console.log(
      "[Attendance] Scheduler stopped."
    );
  }

  server.close(() => {
    console.log(
      "HTTP server closed."
    );

    process.exit(0);
  });
};

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});