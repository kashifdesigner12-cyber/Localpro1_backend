const { protect, authorize } = require('./authMiddleware');

module.exports = {
  protect,
  authorize
};