const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const Media = require('../models/Media');
const storageService = require('../services/storageService');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const getFileType = (mimeType = '') => {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.includes('pdf') || mimeType.includes('word') || mimeType.includes('text')) return 'document';
  return 'other';
};

const safeMedia = (m) => ({
  id: m._id,
  _id: m._id,
  userId: m.userId || m.user,
  filename: m.filename,
  originalName: m.originalName || m.filename,
  mimeType: m.mimeType,
  fileType: m.fileType,
  size: m.size,
  url: m.url,
  key: m.key,
  isPublic: m.isPublic,
  metadata: m.metadata || {},
  createdAt: m.createdAt,
  updatedAt: m.updatedAt
});

// POST /api/media or POST /api/media/upload
const uploadFile = async (req, res) => {
  try {
    let fileBuffer = null;
    let originalName = 'uploaded_file';
    let mimeType = 'application/octet-stream';
    let fileSize = 0;

    if (req.file) {
      fileBuffer = req.file.buffer || (req.file.path ? fs.readFileSync(req.file.path) : null);
      originalName = req.file.originalname || req.file.filename || originalName;
      mimeType = req.file.mimetype || mimeType;
      fileSize = req.file.size || (fileBuffer ? fileBuffer.length : 0);
    } else if (req.body.fileBase64 || req.body.data) {
      const base64Str = req.body.fileBase64 || req.body.data;
      originalName = req.body.filename || req.body.originalName || `upload_${Date.now()}.png`;
      mimeType = req.body.mimeType || req.body.contentType || 'image/png';
      const cleanBase64 = base64Str.replace(/^data:([A-Za-z-+\/]+);base64,/, '');
      fileBuffer = Buffer.from(cleanBase64, 'base64');
      fileSize = fileBuffer.length;
    }

    if (!fileBuffer) {
      return res.status(400).json({ success: false, message: 'No file uploaded or provided.' });
    }

    if (fileSize > 25 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'File size exceeds maximum allowed limit of 25MB.' });
    }

    const ext = path.extname(originalName) || '.bin';
    const uniqueKey = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}${ext}`;

    const uploaded = await storageService.upload(fileBuffer, uniqueKey, mimeType);
    const fileUrl = uploaded ? uploaded.url : `/uploads/${uniqueKey}`;
    const fileType = getFileType(mimeType);

    const mediaDoc = await Media.create({
      userId: req.user._id,
      user: req.user._id,
      filename: uniqueKey,
      originalName,
      mimeType,
      fileType,
      size: fileSize,
      url: fileUrl,
      key: uniqueKey,
      isPublic: true,
      metadata: req.body.metadata || {}
    });

    const formatted = safeMedia(mediaDoc);

    res.status(201).json({
      success: true,
      message: 'File uploaded successfully.',
      file: formatted,
      data: formatted
    });
  } catch (error) {
    console.error('uploadFile error:', error);
    res.status(500).json({ success: false, message: 'Server error uploading file.' });
  }
};

// GET /api/media or GET /api/files
const getFiles = async (req, res) => {
  try {
    const { fileType, search, page = 1, limit = 50, sort = '-createdAt' } = req.query;
    const filter = {};
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';

    if (!isAdminOrManager) {
      filter.$or = [{ userId: req.user._id }, { user: req.user._id }];
    }

    if (fileType) filter.fileType = fileType.toLowerCase();

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [{ originalName: regex }, { filename: regex }];
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [files, total] = await Promise.all([
      Media.find(filter)
        .populate('userId', 'name email avatar')
        .sort(sort === 'oldest' ? { createdAt: 1 } : { createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Media.countDocuments(filter)
    ]);

    const formatted = files.map(safeMedia);

    res.status(200).json({
      success: true,
      files: formatted,
      data: formatted,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 0
      }
    });
  } catch (error) {
    console.error('getFiles error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving files.' });
  }
};

// GET /api/media/stats
const getMediaStats = async (req, res) => {
  try {
    const filter = {};
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';

    if (!isAdminOrManager) {
      filter.$or = [{ userId: req.user._id }, { user: req.user._id }];
    }

    const [totalFiles, byType, sizeAgg] = await Promise.all([
      Media.countDocuments(filter),
      Media.aggregate([
        { $match: filter },
        { $group: { _id: '$fileType', count: { $sum: 1 }, totalSize: { $sum: '$size' } } }
      ]),
      Media.aggregate([
        { $match: filter },
        { $group: { _id: null, totalBytes: { $sum: '$size' } } }
      ])
    ]);

    const totalBytes = sizeAgg[0] ? sizeAgg[0].totalBytes : 0;

    res.status(200).json({
      success: true,
      stats: { totalFiles, totalBytes, byType },
      data: { totalFiles, totalBytes, byType }
    });
  } catch (error) {
    console.error('getMediaStats error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving media stats.' });
  }
};

// GET /api/media/:id
const getFileById = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid file ID.' });
    }

    const media = await Media.findById(req.params.id).populate('userId', 'name email avatar');
    if (!media) {
      return res.status(404).json({ success: false, message: 'File not found.' });
    }

    const isOwner = (media.userId && (media.userId._id ? media.userId._id.toString() : media.userId.toString()) === req.user._id.toString()) ||
      (media.user && (media.user._id ? media.user._id.toString() : media.user.toString()) === req.user._id.toString());
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin && !media.isPublic) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const formatted = safeMedia(media);

    res.status(200).json({
      success: true,
      file: formatted,
      data: formatted
    });
  } catch (error) {
    console.error('getFileById error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving file.' });
  }
};

// DELETE /api/media/:id
const deleteFile = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid file ID.' });
    }

    const media = await Media.findById(req.params.id);
    if (!media) {
      return res.status(404).json({ success: false, message: 'File not found.' });
    }

    const isOwner = (media.userId && media.userId.toString() === req.user._id.toString()) ||
      (media.user && media.user.toString() === req.user._id.toString());
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied. You cannot delete this file.' });
    }

    if (media.key) {
      try {
        await storageService.delete(media.key);
      } catch (storageErr) {
        console.warn('Storage file deletion warning:', storageErr.message);
      }
    }

    await Media.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'File deleted successfully.'
    });
  } catch (error) {
    console.error('deleteFile error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting file.' });
  }
};

module.exports = {
  uploadFile,
  getFiles,
  getFileById,
  deleteFile,
  getMediaStats
};