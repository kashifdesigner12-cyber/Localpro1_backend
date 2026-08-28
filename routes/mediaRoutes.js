const express = require('express');
const {
  uploadFile,
  getFiles,
  getFileById,
  deleteFile,
  getMediaStats
} = require('../controllers/mediaController');
const { protect } = require('../middleware/authMiddleware');

let uploadMiddleware = (req, res, next) => next();
try {
  const multer = require('multer');
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }
  });
  uploadMiddleware = upload.single('file');
} catch (e) {}

const router = express.Router();

router.use(protect);

router.get('/stats', getMediaStats);
router.post('/upload', uploadMiddleware, uploadFile);

router.get('/', getFiles);
router.post('/', uploadMiddleware, uploadFile);

router.get('/:id', getFileById);
router.delete('/:id', deleteFile);

module.exports = router;