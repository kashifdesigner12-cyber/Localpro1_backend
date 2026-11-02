import "dotenv/config";
import mongoose from "mongoose";
import Attendance from "./models/Attendance.js";

try {
  await mongoose.connect(process.env.MONGO_URI);

  const targetDate = "2026-10-26";
  const count = await Attendance.countDocuments({ date: targetDate });

  console.log("Database:", mongoose.connection.name);
  console.log("Target date:", targetDate);
  console.log("Records to delete:", count);

  if (mongoose.connection.name !== "Local-Pro_1") {
    throw new Error("Wrong database. Nothing deleted.");
  }

  if (count !== 13) {
    throw new Error("Expected 13 records. Nothing deleted.");
  }

  const result = await Attendance.deleteMany({ date: targetDate });

  console.log("Deleted records:", result.deletedCount);
  console.log("Other dates were not targeted.");
} catch (error) {
  console.error("Operation stopped:", error.message);
} finally {
  await mongoose.disconnect();
}
