
import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  getProfile,
  updateProfile,
  changePassword,
} from "../controllers/profileController.js";

const router = Router();

router.use(protect);

router.get("/", getProfile);
router.patch("/", updateProfile);
router.patch("/change-password", changePassword);

export default router;
