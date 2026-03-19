import { Router } from "express";
import {
  login,
  me,
  logout,
  forgotPassword
} from "../controllers/auth.controller.js";
import { authenticateToken } from "../middlewares/auth.js";

const router = Router();

router.post("/login", login);
router.get("/me", authenticateToken, me);
router.post("/logout", authenticateToken, logout);
router.post("/forgot-password", forgotPassword);

export default router;