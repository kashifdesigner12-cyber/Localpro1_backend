const express = require('express');
const {
  getContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
  importContacts,
  exportContacts,
  getLeads,
  getLeadStats
} = require('../controllers/contactController');
const { protect } = require('../middleware/authMiddleware');

let uploadMiddleware = (req, res, next) => next();
try {
  const multer = require('multer');
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
  });
  uploadMiddleware = upload.single('file');
} catch (e) {
  // Multer fallback
}

const router = express.Router();

router.use(protect);

// ── Static routes (Must be defined before /:id) ─────────────────────────────
router.get('/leads', getLeads);
router.get('/stats/leads', getLeadStats);
router.get('/stats', getLeadStats);
router.get('/export', exportContacts);
router.post('/import', uploadMiddleware, importContacts);

// ── Collection routes ───────────────────────────────────────────────────────
router.get('/', getContacts);
router.post('/', createContact);

// ── Single contact routes ───────────────────────────────────────────────────
router.get('/:id', getContact);
router.put('/:id', updateContact);
router.patch('/:id', updateContact);
router.delete('/:id', deleteContact);

module.exports = router;