import { Router } from "express";
import { createLead, listLeads } from "../controllers/leads.controller.js";
import { authenticateToken } from "../middlewares/auth.js";

const router = Router();

router.post("/leads", authenticateToken, createLead);
router.get("/leads", authenticateToken, listLeads);

export default router;