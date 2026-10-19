"use strict";

const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");

function setupSocket(server, socketCorsOptions) {
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

  const activeUsers = new Map();

  function addActiveSocket(userId, socketId) {
    const id = String(userId);
    if (!activeUsers.has(id)) activeUsers.set(id, new Set());
    activeUsers.get(id).add(socketId);
  }

  function removeActiveSocket(userId, socketId) {
    const id = String(userId);
    const sockets = activeUsers.get(id);
    if (!sockets) return false;
    sockets.delete(socketId);
    if (sockets.size === 0) {
      activeUsers.delete(id);
      const payload = { userId: id, status: "offline" };
      io.emit("update_user_status", payload);
      io.emit("user_status_update", payload);
      io.emit("user_offline", { userId: id });
      io.emit("user:offline", { userId: id });
      return true;
    }
    return false;
  }

  function getTokenFromSocket(socket) {
    const authorization = socket.handshake.headers?.authorization || "";
    const bearerToken = authorization.replace(/^Bearer\s+/i, "");
    return socket.handshake.auth?.token || bearerToken || null;
  }

  function getDecodedUserId(decoded) {
    const id = decoded?.id || decoded?._id || decoded?.userId;
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return null;
    return String(id);
  }

  function replyToSocket(callback, result) {
    if (typeof callback === "function") callback(result);
  }

  async function canJoinConversation(userId, role, conversationId) {
    if (typeof conversationId !== "string" || !mongoose.Types.ObjectId.isValid(conversationId)) {
      return false;
    }
    const conversation = await Conversation.findById(conversationId).select("participants userId isGroup").lean();
    if (!conversation) return false;
    const participantIds = (conversation.participants || []).map((p) => String(p?._id || p));
    if (participantIds.includes(String(userId)) || String(conversation.userId || "") === String(userId)) {
      return true;
    }
    if (role === "admin" || role === "manager" || role === "support") return true;
    return false;
  }

  io.use(async (socket, next) => {
    try {
      if (!process.env.JWT_SECRET) return next(new Error("Socket authentication unavailable."));
      const token = getTokenFromSocket(socket);
      if (!token) return next(new Error("Authentication required."));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = getDecodedUserId(decoded);
      if (!userId) return next(new Error("Invalid authentication token."));

      const user = await User.findById(userId).select("_id role").lean();
      if (!user) return next(new Error("Authenticated user no longer exists."));

      socket.data.userId = String(user._id);
      socket.data.role = String(user.role || "").toLowerCase();
      return next();
    } catch (error) {
      return next(new Error("Invalid or expired authentication token."));
    }
  });

  io.on("connection", (socket) => {
    const connectedUserId = socket.data.userId;
    const connectedUserRole = socket.data.role || "";

    socket.join(connectedUserId);
    addActiveSocket(connectedUserId, socket.id);

    const onlinePayload = { userId: connectedUserId, status: "online" };
    io.emit("update_user_status", onlinePayload);
    io.emit("user_status_update", onlinePayload);
    io.emit("user_online", { userId: connectedUserId });
    io.emit("user:online", { userId: connectedUserId });

    socket.emit("online_users", Array.from(activeUsers.keys()));

    socket.on("get_online_users", (callback) => {
      const users = Array.from(activeUsers.keys());
      replyToSocket(callback, { success: true, users });
    });

    socket.on("join_room", async (roomId, callback) => {
      if (typeof roomId !== "string" || !roomId.trim()) {
        return replyToSocket(callback, { success: false, message: "Missing conversation ID." });
      }
      const normalizedRoomId = roomId.trim();
      const allowed = await canJoinConversation(connectedUserId, connectedUserRole, normalizedRoomId);
      if (!allowed) {
        return replyToSocket(callback, { success: false, message: "Access denied." });
      }
      socket.join(normalizedRoomId);
      replyToSocket(callback, { success: true, roomId: normalizedRoomId });
    });

    socket.on("leave_room", (roomId) => {
      if (typeof roomId === "string" && roomId.trim()) {
        socket.leave(roomId.trim());
      }
    });

    // --- INSTANT REAL-TIME SOCKET MESSAGE EMISSION (WhatsApp/Line style) ---
    socket.on("send_message", async (data = {}, callback) => {
      const fail = (msg, code = "MESSAGE_SEND_FAILED") => {
        const res = { success: false, code, message: msg };
        replyToSocket(callback, res);
        socket.emit("message_error", res);
      };

      try {
        const conversationId = String(data.conversationId || data.roomId || "").trim();
        const body = String(data.body ?? data.message ?? data.content ?? "").trim();
        if (!mongoose.Types.ObjectId.isValid(conversationId) || !body) {
          return fail("Invalid payload or empty message.");
        }

        const allowed = await canJoinConversation(connectedUserId, connectedUserRole, conversationId);
        if (!allowed) return fail("Forbidden", "FORBIDDEN");

        const conversation = await Conversation.findById(conversationId).select("participants isGroup").lean();
        if (!conversation) return fail("Conversation not found.");

        const message = await Message.create({
          conversation: conversationId,
          sender: connectedUserId,
          body,
          message: body,
          messageType: "text",
        });

        await Conversation.updateOne(
          { _id: conversationId },
          { $set: { lastMessage: body, lastMessageType: "text", lastMessageAt: new Date(), lastSender: connectedUserId } }
        ).catch(() => {});

        const populatedMessage = await Message.findById(message._id)
          .populate("sender", "_id name email phone role status avatar")
          .lean();

        const serializedMessage = {
          ...populatedMessage,
          id: String(message._id),
          _id: String(message._id),
          conversationId,
          body,
        };

        // Broadcast instantly to the entire conversation room (Line/WhatsApp style performance)
        io.to(conversationId).emit("receive_message", {
          success: true,
          message: serializedMessage,
        });

        replyToSocket(callback, { success: true, message: serializedMessage });
      } catch (err) {
        fail("Server error sending message.");
      }
    });

    socket.on("disconnect", () => {
      removeActiveSocket(connectedUserId, socket.id);
    });
  });

  return {
    io,
    getSocketStats: () => {
      let connectedSockets = 0;
      for (const sockets of activeUsers.values()) connectedSockets += sockets.size;
      return { connectedUsers: activeUsers.size, connectedSockets, transportConnections: io.engine.clientsCount };
    },
  };
}

module.exports = setupSocket;