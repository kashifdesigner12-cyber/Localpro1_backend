require('dotenv').config({
  path: require('path').join(__dirname, '../.env')
});

const dns = require('dns');

// Force Node.js to use reliable public DNS servers.
// This fixes MongoDB Atlas SRV lookup issues on networks
// where the system DNS resolver refuses SRV queries.
dns.setServers(['8.8.8.8', '1.1.1.1']);

const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const User = require('../models/User');

// Transporter Configuration
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Helper Function to Send Welcome Email to User
const sendWelcomeEmail = async (targetUserEmail, targetUserName, rawPassword) => {
  const loginUrl = process.env.FRONTEND_LOGIN_URL || 'http://localhost:3000/login';

  const mailOptions = {
    from: `"LocalPro Portal" <${process.env.EMAIL_USER}>`,
    to: targetUserEmail,
    subject: 'Aapka Account Create Ho Chuka Hai - Login Details',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; background-color: #ffffff;">
        <h2 style="color: #1a202c; margin-top: 0;">Welcome, ${targetUserName}!</h2>
        <p style="color: #4a5568; line-height: 1.6;">Aapka LocalPro account successfully create kar diya gaya hai. Aap neeche diye gaye credentials ke sath login kar sakte hain:</p>
        
        <div style="background-color: #f7fafc; border: 1px solid #edf2f7; padding: 18px; border-radius: 8px; margin: 24px 0;">
          <p style="margin: 6px 0; color: #2d3748;"><strong>Registered Email:</strong> ${targetUserEmail}</p>
          <p style="margin: 6px 0; color: #2d3748;"><strong>Password:</strong> <span style="color: #e53e3e; font-weight: bold; letter-spacing: 0.5px;">${rawPassword}</span></p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${loginUrl}" style="background-color: #3182ce; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">Login Page Par Jayein</a>
        </div>

        <p style="color: #a0aec0; font-size: 13px; margin-bottom: 0; line-height: 1.4;">Security Note: Pehli dafa login karne ke baad apna password zaroor update kar lein.</p>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
};

const seedUsers = [
  {
    name: 'Admin User',
    email: 'admin@localpro1.com',
    password: 'Admin@123',
    role: 'admin',
    status: 'Active'
  },
  {
    name: 'Manager User',
    email: 'manager@localpro1.com',
    password: 'Manager@123',
    role: 'manager',
    status: 'Active'
  },
  {
    name: 'Regular User',
    email: 'user@localpro1.com',
    password: 'User@123',
    role: 'user',
    status: 'Active'
  }
];

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log('MongoDB Connected\n');

    for (const userData of seedUsers) {
      const existing = await User.findOne({
        email: userData.email
      }).select('+password');

      if (existing) {
        /*
         * Existing user:
         * Update the known seed credentials/profile
         * instead of creating a duplicate user.
         */
        existing.name = userData.name;
        existing.role = userData.role;
        existing.status = userData.status;
        existing.password = userData.password;

        await existing.save();

        console.log(
          `  Updated [${userData.role}]: ${userData.email}  password: ${userData.password}`
        );

        // Send email on update (optional)
        try {
          await sendWelcomeEmail(userData.email, userData.name, userData.password);
          console.log(`  📧 Mail sent to: ${userData.email}`);
        } catch (mailErr) {
          console.error(`  ❌ Mail failed for ${userData.email}:`, mailErr.message);
        }

        continue;
      }

      await User.create(userData);

      console.log(
        `  Created [${userData.role}]: ${userData.email}  password: ${userData.password}`
      );

      // Send email when new user is created
      try {
        await sendWelcomeEmail(userData.email, userData.name, userData.password);
        console.log(`  📧 Mail sent to: ${userData.email}`);
      } catch (mailErr) {
        console.error(`  ❌ Mail failed for ${userData.email}:`, mailErr.message);
      }
    }

    console.log('\nSeed complete.');
  } catch (error) {
    console.error('Seed error:', error.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

run();