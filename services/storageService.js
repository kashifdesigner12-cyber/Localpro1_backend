const fs = require('fs');
const path = require('path');

const uploadsDir = path.join(__dirname, '..', 'uploads');

const ensureUploadsDirectory = () => {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, {
      recursive: true
    });
  }
};

const normalizeKey = (key = '') => {
  return String(key)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^uploads\//i, '');
};

/**
 * Upload a file to local storage.
 *
 * @param {Buffer} buffer
 * @param {string} key
 * @param {string} mimeType
 * @returns {Promise<object>}
 */
const upload = async (buffer, key, mimeType = 'application/octet-stream') => {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('File buffer is required.');
  }

  if (!key) {
    throw new Error('Storage key is required.');
  }

  ensureUploadsDirectory();

  const safeKey = normalizeKey(key);

  // Prevent path traversal.
  const filePath = path.resolve(uploadsDir, safeKey);
  const uploadsRoot = path.resolve(uploadsDir);

  if (
    filePath !== uploadsRoot &&
    !filePath.startsWith(`${uploadsRoot}${path.sep}`)
  ) {
    throw new Error('Invalid storage key.');
  }

  const directory = path.dirname(filePath);

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, {
      recursive: true
    });
  }

  await fs.promises.writeFile(filePath, buffer);

  return {
    success: true,
    key: safeKey,
    url: `/uploads/${safeKey}`,
    path: filePath,
    mimeType,
    size: buffer.length
  };
};

/**
 * Delete a file from local storage.
 *
 * @param {string} key
 * @returns {Promise<object>}
 */
const remove = async (key) => {
  if (!key) {
    return {
      success: false,
      message: 'Storage key is required.'
    };
  }

  const safeKey = normalizeKey(key);

  const filePath = path.resolve(uploadsDir, safeKey);
  const uploadsRoot = path.resolve(uploadsDir);

  if (
    filePath !== uploadsRoot &&
    !filePath.startsWith(`${uploadsRoot}${path.sep}`)
  ) {
    throw new Error('Invalid storage key.');
  }

  try {
    await fs.promises.unlink(filePath);

    return {
      success: true,
      key: safeKey
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        success: true,
        key: safeKey,
        message: 'File was already deleted or does not exist.'
      };
    }

    throw error;
  }
};

// Keep both names available so existing controllers remain compatible.
const deleteFile = remove;

module.exports = {
  upload,
  delete: remove,
  remove,
  deleteFile
};