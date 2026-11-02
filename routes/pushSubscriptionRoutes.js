import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  savePushSubscription,
  deletePushSubscription,
} from "../controllers/pushSubscriptionController.js";

const router = Router();

router.use(protect);

router.post("/subscribe", savePushSubscription);
router.delete("/unsubscribe", deletePushSubscription);

export default router;
