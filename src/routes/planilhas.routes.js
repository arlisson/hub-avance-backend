import { Router } from "express";
import multer from "multer";
import {
  uploadPlanilha,
  listarPlanilhas,
  deletarPlanilha,
  limparSessao,
  buscarDados,
  exportarResultados,
  listarColunas,
} from "../controllers/planilhas.controller.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post("/planilhas/upload", upload.single("file"), uploadPlanilha);
router.get("/planilhas/buscar", buscarDados);
router.get("/planilhas/exportar", exportarResultados);
router.get("/planilhas/colunas", listarColunas);
router.get("/planilhas", listarPlanilhas);
router.delete("/planilhas", limparSessao);
router.delete("/planilhas/:id", deletarPlanilha);

export default router;
