const express = require('express');
const {
  createAgent,
  getAgents,
  getAgentById,
  updateAgent,
  deleteAgent,
  getAgentStats
} = require('../controllers/agentController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/stats', getAgentStats);
router.get('/', getAgents);
router.post('/', createAgent);
router.get('/:id', getAgentById);
router.put('/:id', updateAgent);
router.patch('/:id', updateAgent);
router.delete('/:id', deleteAgent);

module.exports = router;