import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.js";
import {
  getAgentStatus,
  saveAgentApiKey,
  deleteAgentApiKey,
  sendAgentMessage,
} from "../controllers/agent.controller.js";

const router = Router();

router.get("/agent/status", authenticateToken, getAgentStatus);
router.post("/agent/api-key", authenticateToken, saveAgentApiKey);
router.delete("/agent/api-key", authenticateToken, deleteAgentApiKey);
router.post("/agent", authenticateToken, sendAgentMessage);

export default router;