import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import allowRoles from "../middleware/roleMiddleware.js";
import {
  getSettings,
  updateSettings,
} from "../controllers/settingsController.js";

const router = Router();

// Settings routes require authentication and admin access.
router.use(protect);
router.use(allowRoles("admin"));

router.get("/", getSettings);
router.patch("/", updateSettings);

export default router;