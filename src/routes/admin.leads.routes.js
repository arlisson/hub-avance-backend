import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.js";
import {
  listAdminLeads,
  updateLeadAtendido,
} from "../controllers/admin.leads.controller.js";

const router = Router();

router.get("/admin/leads", authenticateToken, listAdminLeads);
router.post("/admin/leads", authenticateToken, updateLeadAtendido);

export default router;