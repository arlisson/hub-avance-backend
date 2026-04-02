// routes/auth.routes.js
import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  login,
  me,
  logout,
  forgotPassword,
  register,
  verifyEmail,
  resetPassword,
  changePassword,

} from "../controllers/auth.controller.js";
import {registerAppUsage} from "../controllers/counter.controller.js"
import { authenticateToken } from "../middlewares/auth.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { ok: false, error: "Muitas tentativas. Tente novamente em 1 minuto." },
  standardHeaders: true,
  legacyHeaders: false,
});

const forgotLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { ok: false, error: "Muitas solicitações. Tente novamente em 1 minuto." },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { ok: false, error: "Muitos cadastros. Tente novamente em 1 minuto." },
  standardHeaders: true,
  legacyHeaders: false,
});

const resetPasswordLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { ok: false, error: "Muitas tentativas. Tente novamente em 1 minuto." },
  standardHeaders: true,
  legacyHeaders: false,
});

const verifyEmailLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { ok: false, error: "Muitas tentativas. Tente novamente em 1 minuto." },
  standardHeaders: true,
  legacyHeaders: false,
});

const changePasswordLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { ok: false, error: "Muitas tentativas. Tente novamente em 1 minuto." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/login", loginLimiter, login);
router.get("/me", authenticateToken, me);
router.post("/logout", authenticateToken, logout);
router.post("/forgot-password", forgotLimiter, forgotPassword);
router.post("/reset-password", resetPasswordLimiter, resetPassword);
router.post("/register", registerLimiter, register);
router.get("/verify-email", verifyEmailLimiter, verifyEmail);
router.post("/change-password", changePasswordLimiter, authenticateToken, changePassword);
router.post("/contador", authenticateToken, registerAppUsage);


export default router;