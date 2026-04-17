import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.js";
import {
  getAgentStatus,
  saveAgentApiKey,
  deleteAgentApiKey,
  sendAgentMessage,
  getAgentJobResult,
  cancelAgentJob,
  receiveAgentCallback,
  requireClienteAvance,
  getAgentContext,
  saveAgentContext,
} from "../controllers/agent.controller.js";

const router = Router();

router.get("/public-agent-config", (req, res) => {
  return res.json({ 
    ok: true, 
    loginUrl: "/login/login.html" // ou o caminho real do seu login
  });
});

router.get("/agent/status", authenticateToken, requireClienteAvance, getAgentStatus);
router.post("/agent/api-key", authenticateToken, requireClienteAvance, saveAgentApiKey);
router.delete("/agent/api-key", authenticateToken, requireClienteAvance, deleteAgentApiKey);
router.post("/agent", authenticateToken, requireClienteAvance, sendAgentMessage);
router.get("/agent/result/:jobId", authenticateToken, requireClienteAvance, getAgentJobResult);
router.delete("/agent/job/:jobId", authenticateToken, requireClienteAvance, cancelAgentJob);
router.post("/agent/callback/:jobId", receiveAgentCallback);

router.get("/agent/context", authenticateToken, requireClienteAvance, getAgentContext);
router.post("/agent/context", authenticateToken, requireClienteAvance, saveAgentContext);

export default router;