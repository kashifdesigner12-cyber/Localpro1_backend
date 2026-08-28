require("dns").setServers(["1.1.1.1", "8.8.8.8"]);
require("dotenv").config();

const connectDB = require("./config/db");
const User = require("./models/User");

const resetAdminPassword = async () => {
  try {
    await connectDB();

    const email = "admin@localpro1.com";
    const newPassword = "Admin@123";

    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      console.log("Admin user not found:", email);
      process.exit(1);
    }

    user.password = newPassword;
    user.role = "admin";
    user.status = "Active";

    await user.save();

    console.log("");
    console.log("=================================");
    console.log("ADMIN PASSWORD RESET SUCCESSFULLY");
    console.log("=================================");
    console.log("Email:", email);
    console.log("Password:", newPassword);
    console.log("Role:", user.role);
    console.log("Status:", user.status);
    console.log("=================================");

    process.exit(0);
  } catch (error) {
    console.error("Password reset failed:", error);
    process.exit(1);
  }
};

resetAdminPassword();