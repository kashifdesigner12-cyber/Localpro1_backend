const mongoose = require("mongoose");

// =====================================================
// MongoDB Connection Caching
// =====================================================
let cachedConnection = null;

// =====================================================
// MongoDB Connection
// =====================================================
const connectDB = async () => {
  if (cachedConnection && mongoose.connection.readyState === 1) {
    return cachedConnection;
  }

  try {
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

    if (
      !mongoUri.startsWith("mongodb://") &&
      !mongoUri.startsWith("mongodb+srv://")
    ) {
      throw new Error(
        "Invalid MongoDB URI. URI must start with mongodb:// or mongodb+srv://"
      );
    }

    let safeUri = mongoUri;

    try {
      const parsedUri = new URL(mongoUri);
      if (parsedUri.username || parsedUri.password) {
        parsedUri.username = "***";
        parsedUri.password = "***";
      }
      safeUri = parsedUri.toString();
    } catch {
      safeUri = "[MongoDB URI hidden]";
    }

    console.log("=================================");
    console.log("MongoDB Connection");
    console.log("=================================");
    console.log(`Environment: ${isProduction ? "production" : "development"}`);
    console.log(`Database: ${isProduction ? "MongoDB Atlas" : "Configured development database"}`);
    console.log("MongoDB URI:", safeUri);
    console.log("MongoDB: Connecting...");

    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: isProduction ? 10000 : 5000,
      connectTimeoutMS: isProduction ? 10000 : 5000,
      socketTimeoutMS: 30000,
      maxPoolSize: isProduction ? 20 : 10,
      minPoolSize: isProduction ? 2 : 0,
      retryWrites: true,
      heartbeatFrequencyMS: 10000,
      autoIndex: !isProduction,
    });

    cachedConnection = conn;

    console.log("=================================");
    console.log("MongoDB Connected Successfully");
    console.log(`Host: ${conn.connection.host}`);
    console.log(`Database: ${conn.connection.name || "default"}`);
    console.log("=================================");

    return conn;
  } catch (error) {
    console.error("=================================");
    console.error("MongoDB Connection Failed");
    console.error("=================================");
    console.error("Error:", error.message);

    if (process.env.NODE_ENV !== "production") {
      console.error("Check that your configured development MongoDB is accessible.");
    } else {
      console.error("Check MONGO_URI, Atlas IP access list, database credentials, and cluster status.");
    }

    throw error;
  }
};

// =====================================================
// Mongoose Events
// =====================================================
mongoose.connection.on("connected", () => {
  console.log("Mongoose: connection established.");
});

mongoose.connection.on("error", (error) => {
  console.error("Mongoose connection error:", error.message);
});

mongoose.connection.on("disconnected", () => {
  console.warn("Mongoose: MongoDB disconnected.");
  cachedConnection = null;
});

// =====================================================
// Graceful MongoDB Shutdown
// =====================================================
const closeMongoDB = async () => {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
      cachedConnection = null;
      console.log("MongoDB connection closed.");
    }
  } catch (error) {
    console.error("Error closing MongoDB:", error.message);
  }
};

module.exports = connectDB;
module.exports.closeMongoDB = closeMongoDB;