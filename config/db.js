const mongoose = require("mongoose");

// =====================================================
// MongoDB Connection
// =====================================================
//
// Development:
//   Uses local MongoDB
//
// Production:
//   Uses MongoDB Atlas
//
// Environment variables:
//
// Development:
//   MONGO_LOCAL_URI=mongodb://127.0.0.1:27017/local-pro-1
//
// Production:
//   MONGO_URI=mongodb+srv://USERNAME:PASSWORD@cluster.mongodb.net/...
//
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
        `Invalid MongoDB URI. URI must start with mongodb:// or mongodb+srv://`
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

    console.log(
      "MongoDB URI:",
      safeUri
    );

    // =================================================
    // Connect MongoDB
    // =================================================

    console.log(
      "MongoDB: Connecting..."
    );

    const conn = await mongoose.connect(
      mongoUri,
      {
        // ---------------------------------------------
        // Connection timeout
        // ---------------------------------------------

        serverSelectionTimeoutMS: isProduction
          ? 15000
          : 5000,

        connectTimeoutMS: isProduction
          ? 15000
          : 5000,

        socketTimeoutMS: 45000,

        // ---------------------------------------------
        // MongoDB recommended options
        // ---------------------------------------------

        maxPoolSize: 10,

        minPoolSize: 2,

        retryWrites: true,

        // ---------------------------------------------
        // Keep connection alive
        // ---------------------------------------------

        heartbeatFrequencyMS: 10000,
      }
    );

    // =================================================
    // Connection successful
    // =================================================

    console.log(
      "================================="
    );

    console.log(
      "MongoDB Connected Successfully"
    );

    console.log(
      `Host: ${conn.connection.host}`
    );

    console.log(
      `Database: ${
        conn.connection.name || "default"
      }`
    );

    console.log(
      "================================="
    );

    return conn;

  } catch (error) {
    console.error(
      "================================="
    );

    console.error(
      "MongoDB Connection Failed"
    );

    console.error(
      "================================="
    );

    console.error(
      "Error:",
      error.message
    );

    // =================================================
    // Development-specific error
    // =================================================

    if (
      process.env.NODE_ENV !== "production"
    ) {
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

    if (
      process.env.NODE_ENV === "production"
    ) {
      console.error("");
      console.error(
        "Check your MongoDB Atlas connection:"
      );

      console.error(
        "1. MONGO_URI is correct"
      );

      console.error(
        "2. MongoDB Atlas IP access list"
      );

      console.error(
        "3. Database username/password"
      );

      console.error(
        "4. MongoDB Atlas cluster status"
      );

      console.error("");
    }

    // =================================================
    // Do not start Express without MongoDB
    // =================================================

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

module.exports.closeMongoDB =
  closeMongoDB;

