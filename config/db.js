const mongoose = require("mongoose");

// =====================================================
// MongoDB Connection
// =====================================================

const connectDB = async () => {
  try {
    const isProduction =
      process.env.NODE_ENV === "production";

    // =================================================
    // Select MongoDB URI
    // =================================================

    const mongoUri = isProduction
      ? process.env.MONGO_URI?.trim()
      : (
          process.env.MONGO_LOCAL_URI?.trim() ||
          "mongodb://127.0.0.1:27017/local-pro-1"
        );

    // =================================================
    // Validate URI
    // =================================================

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

    // =================================================
    // Hide MongoDB credentials in terminal
    // =================================================

    const safeUri = mongoUri.replace(
      /\/\/.*?:.*?@/,
      "//***:***@"
    );

    console.log("=================================");
    console.log("MongoDB Connection");
    console.log("=================================");
    console.log(
      `Environment: ${
        isProduction ? "production" : "development"
      }`
    );
    console.log(
      `Database: ${
        isProduction
          ? "MongoDB Atlas"
          : "Local MongoDB"
      }`
    );
    console.log("MongoDB URI:", safeUri);

    // =================================================
    // Connect MongoDB
    // =================================================

    console.log("MongoDB: Connecting...");

    const conn = await mongoose.connect(
      mongoUri,
      {
        // Fail reasonably fast if Atlas/server is unavailable.
        serverSelectionTimeoutMS: isProduction
          ? 10000
          : 5000,

        connectTimeoutMS: isProduction
          ? 10000
          : 5000,

        // Prevent a dead socket from hanging forever.
        socketTimeoutMS: 30000,

        // Connection pool.
        maxPoolSize: isProduction ? 20 : 10,
        minPoolSize: isProduction ? 2 : 0,

        // MongoDB retry support.
        retryWrites: true,

        // Keep connection state healthy.
        heartbeatFrequencyMS: 10000,

        // Do not automatically create indexes on every
        // production startup. Indexes should be managed
        // deliberately for production performance.
        autoIndex: !isProduction,
      }
    );

    // =================================================
    // Connection successful
    // =================================================

    console.log("=================================");
    console.log("MongoDB Connected Successfully");
    console.log(`Host: ${conn.connection.host}`);
    console.log(
      `Database: ${
        conn.connection.name || "default"
      }`
    );
    console.log("=================================");

    return conn;
  } catch (error) {
    console.error("=================================");
    console.error("MongoDB Connection Failed");
    console.error("=================================");
    console.error("Error:", error.message);

    // =================================================
    // Development-specific error
    // =================================================

    if (process.env.NODE_ENV !== "production") {
      console.error("");
      console.error(
        "Make sure MongoDB is running locally."
      );
      console.error(
        "Expected local MongoDB URI:"
      );
      console.error(
        "mongodb://127.0.0.1:27017/local-pro-1"
      );
      console.error("");
    }

    // =================================================
    // Production-specific error
    // =================================================

    if (process.env.NODE_ENV === "production") {
      console.error("");
      console.error(
        "Check your MongoDB Atlas connection:"
      );
      console.error("1. MONGO_URI is correct");
      console.error("2. MongoDB Atlas IP access list");
      console.error("3. Database username/password");
      console.error("4. MongoDB Atlas cluster status");
      console.error("");
    }

    // Do not start Express without MongoDB.
    process.exit(1);
  }
};

// =====================================================
// Mongoose Events
// =====================================================

mongoose.connection.on(
  "connected",
  () => {
    console.log(
      "Mongoose: connection established."
    );
  }
);

mongoose.connection.on(
  "error",
  (error) => {
    console.error(
      "Mongoose connection error:",
      error.message
    );
  }
);

mongoose.connection.on(
  "disconnected",
  () => {
    console.warn(
      "Mongoose: MongoDB disconnected."
    );
  }
);

// =====================================================
// Graceful MongoDB Shutdown
// =====================================================

const closeMongoDB = async () => {
  try {
    if (
      mongoose.connection.readyState !== 0
    ) {
      await mongoose.connection.close();

      console.log(
        "MongoDB connection closed."
      );
    }
  } catch (error) {
    console.error(
      "Error closing MongoDB:",
      error.message
    );
  }
};

module.exports = connectDB;
module.exports.closeMongoDB = closeMongoDB;