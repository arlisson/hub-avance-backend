import { Router } from "express";
import multer from "multer";
import os from "os";
import {
  uploadPlanilha,
  listarPlanilhas,
  deletarPlanilha,
  limparSessao,
  buscarDados,
  exportarResultados,
  listarColunasPorPlanilha,
} from "../controllers/planilhas.controller.js";

const router = Router();
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, file, cb) => cb(null, `cofre-${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

router.post("/planilhas/upload", upload.single("file"), uploadPlanilha);
router.get("/planilhas/buscar", buscarDados);
router.get("/planilhas/exportar", exportarResultados);
router.get("/planilhas/colunas-por-planilha", listarColunasPorPlanilha);
router.get("/planilhas", listarPlanilhas);
router.delete("/planilhas", limparSessao);
router.delete("/planilhas/:id", deletarPlanilha);

export default router;
