import "dotenv/config";
import mongoose from "mongoose";
import User from "./models/User.js";
import { createNotification } from "./services/notificationService.js";

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

try {
  const user = await User.findOne({ username: "ali", role: "user" })
    .select("_id username")
    .lean();

  if (!user) throw new Error("User account 'ali' not found.");

  await createNotification({
    recipient: user._id,
    title: "Attendance Reminder Test",
    message: "Please check in for today's attendance.",
    type: "attendance",
    link: "/attendance",
  });

  console.log(`Test notification created for user: ${user.username}`);
} catch (error) {
  console.error("Test failed:", error.message);
} finally {
  await mongoose.disconnect();
}
