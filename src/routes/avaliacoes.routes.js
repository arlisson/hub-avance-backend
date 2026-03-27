import { Router } from "express";
import { listAvaliacoes, criarAvaliacaoSite } from "../controllers/avaliacoes.controller.js";

const router = Router();

// pública
router.get("/avaliacoes", listAvaliacoes);
router.post("/avaliacoes/nova", criarAvaliacaoSite);

export default router;