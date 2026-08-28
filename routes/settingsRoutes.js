const express = require('express');
const {
  getProfile,
  updateProfile,
  updatePassword,
  getBusiness,
  updateBusiness,
  getPreferences,
  updatePreferences,
  getNotificationPreferences,
  updateNotificationPreferences,
  getIntegrations,
  updateIntegrations,
  getAllSettings
} = require('../controllers/settingsController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

// ── Overall Settings Bundle ─────────────────────────────────────────────────
router.get('/', getAllSettings);

// ── Profile Settings ────────────────────────────────────────────────────────
router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.patch('/profile', updateProfile);

// ── Password Change ─────────────────────────────────────────────────────────
router.put('/password', updatePassword);
router.patch('/password', updatePassword);
router.put('/change-password', updatePassword);
router.patch('/change-password', updatePassword);

// ── Business Settings ───────────────────────────────────────────────────────
router.get('/business', getBusiness);
router.put('/business', updateBusiness);
router.patch('/business', updateBusiness);

// ── User Preferences ────────────────────────────────────────────────────────
router.get('/preferences', getPreferences);
router.put('/preferences', updatePreferences);
router.patch('/preferences', updatePreferences);

// ── Notification Preferences ────────────────────────────────────────────────
router.get('/notifications', getNotificationPreferences);
router.put('/notifications', updateNotificationPreferences);
router.patch('/notifications', updateNotificationPreferences);

// ── Integrations ────────────────────────────────────────────────────────────
router.get('/integrations', getIntegrations);
router.put('/integrations', updateIntegrations);
router.patch('/integrations', updateIntegrations);

module.exports = router;