
import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import allowRoles from "../middleware/roleMiddleware.js";
import {
  getDevices,
  createDevice,
  updateDevice,
  deleteDevice,
} from "../controllers/deviceController.js";

const router = Router();

router.use(protect);

router.get("/", allowRoles("admin", "manager"), getDevices);
router.post("/", allowRoles("admin", "manager"), createDevice);
router.patch("/:id", allowRoles("admin", "manager"), updateDevice);
router.delete("/:id", allowRoles("admin"), deleteDevice);

export default router;
