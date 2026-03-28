// routes/auth.routes.js
import { Router } from "express";
import {
  login,
  me,
  logout,
  forgotPassword,
  register,
  verifyEmail,  
  resetPassword,
  changePassword,
  testSmtp,
  testEmail,
  debugSmtpEnv
} from "../controllers/auth.controller.js";
import {registerAppUsage} from "../controllers/counter.controller.js"
import { authenticateToken } from "../middlewares/auth.js";

const router = Router();

router.post("/login", login);
router.get("/me", authenticateToken, me);
router.post("/logout", authenticateToken, logout);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/register", register);
router.get("/verify-email", verifyEmail);
router.post("/change-password", authenticateToken, changePassword);
router.post("/contador", authenticateToken, registerAppUsage);

// ROTAS DE TESTE SMTP (protegidas)
router.get("/test-smtp", authenticateToken, testSmtp);
router.get("/test-email", authenticateToken, testEmail);
router.get("/debug-smtp-env", authenticateToken, debugSmtpEnv);

export default router;