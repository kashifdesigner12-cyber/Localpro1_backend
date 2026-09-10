const bcrypt = require('bcryptjs');
const User = require('../models/User');

// Safe user serialization without heavy Base64 payload
const safeUser = (user) => {
  if (!user) return null;

  let cleanAvatar = user.avatar || null;
  if (typeof cleanAvatar === 'string' && cleanAvatar.startsWith('data:image') && cleanAvatar.length > 1000) {
    cleanAvatar = null;
  }

  return {
    id: user._id,
    _id: user._id,
    name: user.name || '',
    email: user.email || '',
    phone: user.phone || '',
    role: user.role || 'user',
    status: user.status || 'Active',
    avatar: cleanAvatar,
    twilioPhoneNumber: user.twilioPhoneNumber || '',
    business: user.business || {},
    preferences: user.preferences || {},
    notificationPreferences: user.notificationPreferences || {},
    integrations: user.integrations || {},
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
};

// GET /api/settings/profile or GET /api/settings
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password').lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const safeUserData = safeUser(user);
    return res.status(200).json({ success: true, user: safeUserData, data: safeUserData });
  } catch (error) {
    console.error('getProfile error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving profile settings.' });
  }
};

// PUT /api/settings/profile or PATCH /api/settings/profile
const updateProfile = async (req, res) => {
  try {
    const { name, phone, avatar } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (name !== undefined) {
      if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: 'Name cannot be empty.' });
      }
      user.name = name.trim();
    }

    if (phone !== undefined) user.phone = typeof phone === 'string' ? phone.trim() : '';
    if (avatar !== undefined) user.avatar = avatar;

    await user.save();

    const safeUserData = safeUser(user.toObject ? user.toObject() : user);
    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      user: safeUserData,
      data: safeUserData
    });
  } catch (error) {
    console.error('updateProfile error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating profile settings.' });
  }
};

// PUT /api/settings/password or PATCH /api/settings/password
const updatePassword = async (req, res) => {
  try {
    const { currentPassword, oldPassword, newPassword, password } = req.body;
    const currentPass = currentPassword || oldPassword;
    const newPass = newPassword || password;

    if (!currentPass || !newPass) {
      return res.status(400).json({ success: false, message: 'Current password and new password are required.' });
    }

    if (newPass.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const isMatch = await user.comparePassword(currentPass);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    user.password = newPass;
    await user.save();

    return res.status(200).json({ success: true, message: 'Password updated successfully.' });
  } catch (error) {
    console.error('updatePassword error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating password.' });
  }
};

// GET /api/settings/business
const getBusiness = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('business').lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const business = user.business || {};
    return res.status(200).json({ success: true, business, data: business });
  } catch (error) {
    console.error('getBusiness error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving business settings.' });
  }
};

// PUT /api/settings/business or PATCH /api/settings/business
const updateBusiness = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    user.business = { ...(user.business || {}), ...req.body };
    user.markModified('business');
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Business settings updated successfully.',
      business: user.business,
      data: user.business
    });
  } catch (error) {
    console.error('updateBusiness error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating business settings.' });
  }
};

// GET /api/settings/preferences
const getPreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('preferences').lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const preferences = user.preferences || {};
    return res.status(200).json({ success: true, preferences, data: preferences });
  } catch (error) {
    console.error('getPreferences error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving preferences.' });
  }
};

// PUT /api/settings/preferences or PATCH /api/settings/preferences
const updatePreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    user.preferences = { ...(user.preferences || {}), ...req.body };
    user.markModified('preferences');
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Preferences updated successfully.',
      preferences: user.preferences,
      data: user.preferences
    });
  } catch (error) {
    console.error('updatePreferences error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating preferences.' });
  }
};

// GET /api/settings/notifications
const getNotificationPreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('notificationPreferences').lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const notificationPreferences = user.notificationPreferences || {};
    return res.status(200).json({ success: true, notificationPreferences, data: notificationPreferences });
  } catch (error) {
    console.error('getNotificationPreferences error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving notification preferences.' });
  }
};

// PUT /api/settings/notifications or PATCH /api/settings/notifications
const updateNotificationPreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    user.notificationPreferences = { ...(user.notificationPreferences || {}), ...req.body };
    user.markModified('notificationPreferences');
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Notification preferences updated successfully.',
      notificationPreferences: user.notificationPreferences,
      data: user.notificationPreferences
    });
  } catch (error) {
    console.error('updateNotificationPreferences error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating notification preferences.' });
  }
};

// GET /api/settings/integrations
const getIntegrations = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('integrations').lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const integrations = user.integrations || {};
    return res.status(200).json({ success: true, integrations, data: integrations });
  } catch (error) {
    console.error('getIntegrations error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving integrations.' });
  }
};

// PUT /api/settings/integrations or PATCH /api/settings/integrations
const updateIntegrations = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    user.integrations = { ...(user.integrations || {}), ...req.body };
    user.markModified('integrations');
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Integrations updated successfully.',
      integrations: user.integrations,
      data: user.integrations
    });
  } catch (error) {
    console.error('updateIntegrations error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating integrations.' });
  }
};

// GET /api/settings (bundle)
const getAllSettings = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password').lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    let cleanAvatar = user.avatar || null;
    if (typeof cleanAvatar === 'string' && cleanAvatar.startsWith('data:image') && cleanAvatar.length > 1000) {
      cleanAvatar = null;
    }

    const settingsData = {
      profile: {
        id: user._id,
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        avatar: cleanAvatar,
        role: user.role,
        status: user.status
      },
      business: user.business || {},
      preferences: user.preferences || {},
      notificationPreferences: user.notificationPreferences || {},
      integrations: user.integrations || {}
    };

    return res.status(200).json({
      success: true,
      settings: settingsData,
      data: settingsData
    });
  } catch (error) {
    console.error('getAllSettings error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving settings.' });
  }
};

module.exports = {
  getProfile,
  updateProfile,
  updatePassword,
  changePassword: updatePassword,
  getBusiness,
  updateBusiness,
  getPreferences,
  updatePreferences,
  getNotificationPreferences,
  updateNotificationPreferences,
  getIntegrations,
  updateIntegrations,
  getAllSettings
};