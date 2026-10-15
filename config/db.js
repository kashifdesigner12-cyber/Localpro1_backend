"use strict";

const mongoose = require("mongoose");

// Keep one connection and one in-flight connection attempt per process.
let cachedConnection = null;
let connectionPromise = null;

const getMongoUri = () => {
  const isProduction = process.env.NODE_ENV === "production";
  const mongoUri = isProduction
    ? process.env.MONGO_URI?.trim()
    : (
        process.env.MONGO_LOCAL_URI?.trim() ||
        "mongodb://127.0.0.1:27017/local-pro-1"
      );

  if (!mongoUri) {
    throw new Error(
      isProduction
        ? "MONGO_URI is not defined for production."
        : "MONGO_LOCAL_URI is not defined for development."
    );
  }

  if (!/^mongodb(?:\+srv)?:\/\//i.test(mongoUri)) {
    throw new Error(
      "Invalid MongoDB URI. URI must start with mongodb:// or mongodb+srv://"
    );
  }

  return mongoUri;
};

// =====================================================
// MongoDB Connection
// =====================================================
const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    cachedConnection = cachedConnection || mongoose;
    return cachedConnection;
  }

  // Prevent simultaneous callers from opening duplicate connection attempts.
  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    const isProduction = process.env.NODE_ENV === "production";
    const mongoUri = getMongoUri();

    console.log("=================================");
    console.log("MongoDB Connection");
    console.log("=================================");
    console.log(`Environment: ${isProduction ? "production" : "development"}`);
    console.log(
      `Database target: ${isProduction ? "configured production database" : "configured development database"}`
    );
    // Never log the URI: it may contain credentials or sensitive query options.
    console.log("MongoDB: Connecting...");

    try {
      const connection = await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: isProduction ? 10000 : 5000,
        connectTimeoutMS: isProduction ? 10000 : 5000,
        socketTimeoutMS: 30000,
        maxPoolSize: isProduction ? 20 : 10,
        minPoolSize: isProduction ? 2 : 0,
        retryWrites: true,
        heartbeatFrequencyMS: 10000,
        autoIndex: !isProduction,
      });

      cachedConnection = connection;

      console.log("=================================");
      console.log("MongoDB Connected Successfully");
      console.log(`Host: ${mongoose.connection.host || "connected"}`);
      console.log(`Database: ${mongoose.connection.name || "default"}`);
      console.log("=================================");

      return connection;
    } catch (error) {
      cachedConnection = null;
      console.error("=================================");
      console.error("MongoDB Connection Failed");
      console.error("=================================");
      // Driver errors can contain connection details; only log the error name here.
      console.error("Error type:", error?.name || "MongoDBConnectionError");

      if (!isProduction) {
        console.error("Check that the configured development MongoDB is accessible.");
      } else {
        console.error(
          "Check MONGO_URI, Atlas IP access list, database credentials, and cluster status."
        );
      }

      throw error;
    } finally {
      connectionPromise = null;
    }
  })();

  return connectionPromise;
};

// =====================================================
// Mongoose Events
// =====================================================
mongoose.connection.on("connected", () => {
  console.log("Mongoose: connection established.");
});

mongoose.connection.on("error", (error) => {
  // Avoid printing raw driver messages that may contain connection details.
  console.error("Mongoose connection error:", error?.name || "MongoDBError");
});

mongoose.connection.on("disconnected", () => {
  console.warn("Mongoose: MongoDB disconnected.");
  cachedConnection = null;
  connectionPromise = null;
});

// =====================================================
// Graceful MongoDB Shutdown
// =====================================================
const closeMongoDB = async () => {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
      console.log("MongoDB connection closed.");
    }
  } catch (error) {
    console.error("Error closing MongoDB:", error?.name || "MongoDBCloseError");
    throw error;
  } finally {
    cachedConnection = null;
    connectionPromise = null;
  }
};

module.exports = connectDB;
module.exports.closeMongoDB = closeMongoDB;
