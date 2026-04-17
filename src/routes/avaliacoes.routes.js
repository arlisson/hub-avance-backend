import { Router } from "express";
import { listAvaliacoes, criarAvaliacaoSite } from "../controllers/avaliacoes.controller.js";
import { authenticateToken } from "../middlewares/auth.js";

const router = Router();

router.get("/avaliacoes", listAvaliacoes);
router.post("/avaliacoes/nova", authenticateToken, criarAvaliacaoSite);

export default router;