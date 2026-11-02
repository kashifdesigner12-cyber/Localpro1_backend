import mongoose from "mongoose";

const connectDB = async () => {
  const mongoURI = process.env.MONGO_URI;

  if (!mongoURI) {
    throw new Error("MONGO_URI is missing from environment variables.");
  }

  try {
    const connection = await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 50,
      minPoolSize: 10,
      maxIdleTimeMS: 30000,
    });

    const db = connection.connection;

    console.log(`MongoDB connected: ${db.name}`);

    db.on("error", (error) => {
      console.error("[MongoDB] Connection error:", error.message);
    });

    db.on("disconnected", () => {
      console.warn("[MongoDB] Disconnected - attempting reconnection...");
    });

    db.on("reconnected", () => {
      console.log("[MongoDB] Reconnected successfully");
    });

    return connection;
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    throw error;
  }
};

export default connectDB;