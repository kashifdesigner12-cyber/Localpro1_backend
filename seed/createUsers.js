require('dotenv').config({
  path: require('path').join(__dirname, '../.env')
});

const dns = require('dns');

// Force Node.js to use reliable public DNS servers.
// This fixes MongoDB Atlas SRV lookup issues on networks
// where the system DNS resolver refuses SRV queries.
dns.setServers(['8.8.8.8', '1.1.1.1']);

const mongoose = require('mongoose');
const User = require('../models/User');

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

        continue;
      }

      await User.create(userData);

      console.log(
        `  Created [${userData.role}]: ${userData.email}  password: ${userData.password}`
      );
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