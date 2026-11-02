import "dotenv/config";
import mongoose from "mongoose";
import Attendance from "./models/Attendance.js";

try {
  await mongoose.connect(process.env.MONGO_URI);

  const result = await Attendance.aggregate([
    {
      $match: {
        $or: [
          { date: "2026-10-26" },
          {
            date: {
              $gte: new Date("2026-10-25T19:00:00.000Z"),
              $lt: new Date("2026-10-26T19:00:00.000Z")
            }
          }
        ]
      }
    },
    {
      $project: {
        date: 1,
        dateType: { $type: "$date" },
        user: 1,
        checkIn: 1,
        checkOut: 1,
        status: 1
      }
    }
  ]);

  console.log("Database:", mongoose.connection.name);
  console.log("26 October records found:", result.length);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error);
} finally {
  await mongoose.disconnect();
}
