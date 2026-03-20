// routes/auth.routes.js
import { Router } from "express";
import {
  login,
  me,
  logout,
  forgotPassword,
  register,
  verifyEmail,
  testSmtp
} from "../controllers/auth.controller.js";
import { authenticateToken } from "../middlewares/auth.js";

const router = Router();

router.post("/login", login);
router.get("/me", authenticateToken, me);
router.post("/logout", authenticateToken, logout);
router.post("/forgot-password", forgotPassword);
router.post("/register", register);
router.get("/verify-email", verifyEmail);
router.get("/test-smtp", testSmtp);

export default router;