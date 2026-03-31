import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.js";
import {
  getAgentStatus,
  saveAgentApiKey,
  deleteAgentApiKey,
  sendAgentMessage,
  requireClienteAvance,
} from "../controllers/agent.controller.js";

const router = Router();

router.get("/agent/status", authenticateToken, requireClienteAvance, getAgentStatus);
router.post("/agent/api-key", authenticateToken, requireClienteAvance, saveAgentApiKey);
router.delete("/agent/api-key", authenticateToken, requireClienteAvance, deleteAgentApiKey);
router.post("/agent", authenticateToken, requireClienteAvance, sendAgentMessage);

export default router;