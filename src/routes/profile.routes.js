import { Router } from "express";
import { getProfile, updateProfile } from "../controllers/profile.controller.js";
import { authenticateToken } from "../middlewares/auth.js";

const router = Router();

router.get("/profile", authenticateToken, getProfile);
router.put("/profile", authenticateToken, updateProfile);

export default router;