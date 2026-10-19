"use strict";

require("dotenv").config();

const http = require("http");
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const multer = require("multer");

const connectDB = require("./config/db");
const { corsOptions, socketCorsOptions } = require("./config/cors");
const setupSocket = require("./config/socket");
const registerRoutes = require("./routes/index");

const {
  startAttendanceEmailScheduler,
  stopAttendanceEmailScheduler,
  sendDailyAttendanceEmails,
} = require("./services/attendanceEmailScheduler");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

app.disable("x-powered-by");

// Setup Socket.IO using modular handler
const { io, getSocketStats } = setupSocket(server, socketCorsOptions);
app.set("io", io);

// Upload Directories Setup
const uploadsDir = path.join(__dirname, "uploads");
const chatUploadsDir = path.join(uploadsDir, "chat");
const taskUploadsDir = path.join(uploadsDir, "tasks");

for (const directory of [uploadsDir, chatUploadsDir, taskUploadsDir]) {
  fs.mkdirSync(directory, { recursive: true });
}

// Express Middleware
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Static Files
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

// Health Checks
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

// Attendance Email Route
app.post("/api/send-attendance-reminders", async (req, res) => {
  try {
    const result = await sendDailyAttendanceEmails();
    return res.status(200).json({ success: true, message: "Attendance reminder emails sent.", result });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to send attendance reminder emails." });
  }
});

// Register All API Routes cleanly via modular router loader
registerRoutes(app);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// Global Error Handler
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ success: false, message: `File upload error: ${error.message}` });
  }
  if (error.message === "Not allowed by CORS") {
    return res.status(403).json({ success: false, message: "Origin is not allowed by CORS." });
  }
  return res.status(500).json({ success: false, message: "Internal server error." });
});

// Schedulers & Server Boot
let attendanceScheduler = null;
let attendanceEmailSchedulerStarted = false;
let shuttingDown = false;
let serverStarted = false;

const startAttendanceScheduler = () => {
  try {
    const { processAttendanceNotifications } = require("./controllers/attendanceController");
    if (typeof processAttendanceNotifications !== "function" || attendanceScheduler) return;

    attendanceScheduler = setInterval(async () => {
      if (shuttingDown) return;
      try {
        await processAttendanceNotifications();
      } catch (error) {}
    }, 60 * 1000);
  } catch (error) {}
};

const startServer = async () => {
  try {
    await connectDB();
    if (shuttingDown) return;

    server.listen(PORT, "0.0.0.0", () => {
      serverStarted = true;
      console.log(`[Server] Running efficiently on port ${PORT}`);
      startAttendanceScheduler();
      if (typeof startAttendanceEmailScheduler === "function" && !attendanceEmailSchedulerStarted) {
        startAttendanceEmailScheduler();
        attendanceEmailSchedulerStarted = true;
      }
    });
  } catch (error) {
    process.exitCode = 1;
  }
};

startServer();