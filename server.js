import "dotenv/config";

import { performance } from "node:perf_hooks";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import http from "node:http";
import path from "node:path";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";

import connectDB from "./config/db.js";
import User from "./models/User.js";

import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import taskRoutes from "./routes/taskRoutes.js";
import attendanceRoutes from "./routes/attendanceRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import deviceRoutes from "./routes/deviceRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import pushSubscriptionRoutes from "./routes/pushSubscriptionRoutes.js";
import leaveRoutes from "./routes/leaveRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";

import {
  startAttendanceReminderService,
} from "./services/attendanceReminderService.js";

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || "0.0.0.0";
const COOKIE_NAME = process.env.COOKIE_NAME || "localpro_token";
const JWT_SECRET = process.env.JWT_SECRET;

// ----------------------------------------------------
// CORS CONFIGURATION
// ----------------------------------------------------

const normalizeOrigin = (origin) => {
  if (typeof origin !== "string") return "";

  return origin.trim().replace(/\/+$/, "").toLowerCase();
};

const productionOrigins = [
  "https://localpro1.net",
  "https://www.localpro1.net",
];

const developmentOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const environmentOrigins = [
  process.env.FRONTEND_URL,
  ...(process.env.FRONTEND_URLS || "").split(","),
];

const allowedOrigins = [
  ...new Set(
    [
      ...productionOrigins,
      ...environmentOrigins,
      ...(process.env.NODE_ENV !== "production"
        ? developmentOrigins
        : []),
    ]
      .map(normalizeOrigin)
      .filter(Boolean)
  ),
];

const isAllowedOrigin = (origin) => {
  if (!origin) return true;

  return allowedOrigins.includes(normalizeOrigin(origin));
};

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    console.warn("[CORS] Blocked origin:", origin);
    return callback(new Error("Origin not allowed by CORS"));
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
    "X-Requested-With",
    "Accept",
    "Cache-Control",
    "Pragma",
    "Expires",
  ],

  optionsSuccessStatus: 204,
};

// ----------------------------------------------------
// EXPRESS MIDDLEWARE
// ----------------------------------------------------

app.use(cors(corsOptions));

app.use(express.json({
  limit: "25mb",
}));

app.use(express.urlencoded({
  extended: true,
  limit: "25mb",
}));

// Cookie parser MUST run before authenticated routes.
app.use(cookieParser());

// Serve static upload directory
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

// ----------------------------------------------------
// API PERFORMANCE MONITORING
// ----------------------------------------------------

app.use((req, res, next) => {
  const startedAt = performance.now();

  res.on("finish", () => {
    const duration = Math.round(
      performance.now() - startedAt
    );

    if (duration >= 1000) {
      console.warn(
        `[SLOW API] ${req.method} ${req.originalUrl} | ` +
        `${duration}ms | Status ${res.statusCode}`
      );
    }
  });

  next();
});

// ----------------------------------------------------
// SOCKET.IO
// ----------------------------------------------------

const io = new Server(server, {
  cors: corsOptions,

  transports: ["websocket", "polling"],
  allowUpgrades: true,

  pingInterval: 25000,
  pingTimeout: 30000,
  connectTimeout: 20000,

  maxHttpBufferSize: 1e6,

  connectionStateRecovery: {
    maxDisconnectionDuration: 120000,
    skipMiddlewares: false,
  },
});

app.set("io", io);
app.set("socketIO", io);
globalThis.__localProNotificationIO = io;

// ----------------------------------------------------
// ONLINE USERS
// ----------------------------------------------------

const activeUsers = new Map();

app.set("activeUsers", activeUsers);
app.set("onlineUsers", activeUsers);

const getUserRoom = (userId) => `user:${String(userId)}`;

// ----------------------------------------------------
// SOCKET TOKEN EXTRACTION
// ----------------------------------------------------

const getSocketToken = (socket) => {
  const auth = socket.handshake.auth || {};
  const headers = socket.handshake.headers || {};

  const cookieHeader = headers.cookie || "";

  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");

    if (separator === -1) continue;

    const name = item.slice(0, separator).trim();

    if (name !== COOKIE_NAME) continue;

    const rawValue = item.slice(separator + 1).trim();

    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  let token =
    auth.token ||
    auth.accessToken ||
    auth.access_token ||
    headers.authorization ||
    "";

  if (typeof token !== "string") {
    return null;
  }

  token = token.trim();

  if (token.toLowerCase().startsWith("bearer ")) {
    token = token.slice(7).trim();
  }

  return token || null;
};

// ----------------------------------------------------
// SOCKET AUTHENTICATION
// ----------------------------------------------------

io.use(async (socket, next) => {
  try {
    if (!JWT_SECRET) {
      return next(
        new Error("Server authentication is not configured")
      );
    }

    if (User.db?.readyState !== 1) {
      return next(
        new Error("Database connection is not ready")
      );
    }

    const token = getSocketToken(socket);
    let decoded = null;

    if (token) {
      try {
        decoded = jwt.verify(token, JWT_SECRET);
      } catch {
        return next(
          new Error("Invalid or expired authentication token")
        );
      }
    }

    const userId =
      decoded?.id ||
      decoded?.userId ||
      decoded?._id ||
      decoded?.sub ||
      socket.handshake.auth?.userId ||
      socket.handshake.query?.userId;

    if (
      !userId ||
      !/^[a-f\d]{24}$/i.test(String(userId))
    ) {
      return next(
        new Error("Invalid authentication payload")
      );
    }

    const user = await User.findById(userId)
      .select("_id name username role status")
      .maxTimeMS(5000)
      .lean()
      .exec();

    if (!user) {
      return next(
        new Error("User account not found")
      );
    }

    if (String(user.status || "").toLowerCase() === "blocked") {
      return next(
        new Error("User account is blocked")
      );
    }

    socket.userId = String(user._id);
    socket.user = user;

    return next();
  } catch (error) {
    console.error(
      "[SOCKET AUTH ERROR]",
      error.message
    );

    return next(
      new Error("Socket authentication failed")
    );
  }
});

// ----------------------------------------------------
// SOCKET CONNECTION
// ----------------------------------------------------

io.on("connection", (socket) => {
  const userId = String(
    socket.user?._id ||
    socket.handshake?.auth?.userId ||
    socket.userId ||
    ""
  );

  if (userId) {
    socket.userId = userId;
    socket.join(`user:${userId}`);
  }

  socket.on("join", (id) => {
    if (id) {
      const targetId = String(id);
      socket.join(`user:${targetId}`);
      console.log(`[SOCKET ROOM JOIN] Socket ${socket.id} joined user:${targetId}`);
    }
  });

  socket.on("join_conversation", (conversationId) => {
    if (conversationId) {
      socket.join(`conv:${String(conversationId)}`);
    }
  });

  socket.on("leave_conversation", (conversationId) => {
    if (conversationId) {
      socket.leave(`conv:${String(conversationId)}`);
    }
  });

  socket.on("chat:typing", (payload) => {
    const convId = String(payload?.conversationId || "");
    if (!convId) return;
    const typingUserId = String(socket.userId || userId || payload?.userId || "");
    socket.to(`conv:${convId}`).emit("chat:typing", {
      conversationId: convId,
      userId: typingUserId,
      isTyping: Boolean(payload?.isTyping),
    });
  });

  let userSockets = activeUsers.get(userId);

  if (!userSockets) {
    userSockets = new Set();
    activeUsers.set(userId, userSockets);
  }

  const wasOffline = userSockets.size === 0;

  userSockets.add(socket.id);

  console.log(
    `[SOCKET CONNECTED] User: ${userId} | Socket: ${socket.id}`
  );

  if (wasOffline) {
    const presence = {
      userId,
      isOnline: true,
      status: "online",
    };

    io.emit("user:online", presence);
    io.emit("update_user_status", presence);
  }

  socket.emit("socket:ready", {
    success: true,
    userId,
    connected: true,
  });

  // Connection health
  socket.on("socket:ping", (callback) => {
    if (typeof callback === "function") {
      callback({
        success: true,
        timestamp: Date.now(),
      });
    }
  });

  // Disconnect
  socket.on("disconnect", (reason) => {
    console.log(
      `[SOCKET DISCONNECTED] User: ${userId} | Reason: ${reason}`
    );

    const sockets = activeUsers.get(userId);

    if (sockets) {
      sockets.delete(socket.id);

      if (sockets.size === 0) {
        activeUsers.delete(userId);

        const presence = {
          userId,
          isOnline: false,
          status: "offline",
        };

        io.emit("user:offline", presence);
        io.emit("update_user_status", presence);
      }
    }
  });

  socket.on("error", (error) => {
    console.error(
      `[SOCKET ERROR] User: ${userId}`,
      error?.message || error
    );
  });
});

// ----------------------------------------------------
// HEALTH CHECK
// ----------------------------------------------------

app.get("/api/health", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "LocalPro1 API is running",
    environment: process.env.NODE_ENV || "development",

    database: {
      connected: User.db?.readyState === 1,
    },

    socket: {
      connected: io.engine.clientsCount,
      onlineUsers: activeUsers.size,
    },
  });
});

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/push", pushSubscriptionRoutes);
app.use("/api/leaves", leaveRoutes);
app.use("/api/chats", chatRoutes);

// ----------------------------------------------------
// 404 HANDLER
// ----------------------------------------------------

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: "API route not found",
  });
});

// ----------------------------------------------------
// CENTRAL ERROR HANDLER
// ----------------------------------------------------

app.use((error, req, res, next) => {
  console.error(
    `[SERVER ERROR] ${req.method} ${req.originalUrl}:`,
    error.message
  );

  if (res.headersSent) {
    return next(error);
  }

  const statusCode = Number.isInteger(error.status)
    ? error.status
    : 500;

  return res.status(statusCode).json({
    success: false,
    message:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : error.message,
  });
});

// ----------------------------------------------------
// START SERVER
// ----------------------------------------------------

const startServer = async () => {
  try {
    if (!JWT_SECRET) {
      throw new Error("JWT_SECRET is missing from environment variables.");
    }

    await connectDB();

    startAttendanceReminderService();

    server.on("error", (error) => {
      console.error("[HTTP SERVER ERROR]", error);
    });

    server.listen(PORT, HOST, () => {
      console.log("--------------------------------------");
      console.log("LocalPro1 API started successfully");
      console.log(`Port: ${PORT}`);
      console.log(`Host: ${HOST}`);
      console.log(
        `Environment: ${process.env.NODE_ENV || "development"}`
      );
      console.log(
        `Health: http://localhost:${PORT}/api/health`
      );
      console.log(
        `Allowed origins: ${allowedOrigins.join(", ")}`
      );
      console.log("Socket.IO: Enabled");
      console.log("Private user rooms: Enabled");
      console.log("Multi-device presence: Enabled");
      console.log("--------------------------------------");
    });
  } catch (error) {
    console.error(
      "[SERVER STARTUP FAILED]",
      error.message
    );

    process.exit(1);
  }
};

startServer();
