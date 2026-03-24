import { Router } from "express";
import { listAvaliacoes } from "../controllers/avaliacoes.controller.js";

const router = Router();

// pública
router.get("/avaliacoes", listAvaliacoes);

export default router;