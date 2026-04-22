import { pool } from "../config/db.js";
import * as XLSX from "xlsx";
import Piscina from "piscina";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { unlink } from "fs/promises";
import { promisify } from "util";
import { gzip, gunzip } from "zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));

const workerPool = new Piscina({
  filename: join(__dirname, "../workers/planilha.worker.js"),
  maxThreads: 3,
  idleTimeout: 30_000,
});

const gzipAsync  = promisify(gzip);
const gunzipAsync = promisify(gunzip);

async function comprimirDados(dados) {
  return gzipAsync(JSON.stringify(dados));
}

async function descomprimirDados(raw) {
  // Compatibilidade: suporta dados antigos em texto puro (MEDIUMTEXT sem gzip)
  if (Buffer.isBuffer(raw) && raw[0] === 0x1f && raw[1] === 0x8b) {
    return JSON.parse((await gunzipAsync(raw)).toString("utf8"));
  }
  return JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
}

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS planilhas_sessao (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        session_id   VARCHAR(64) NOT NULL,
        nome_arquivo VARCHAR(255) NOT NULL,
        dados        LONGBLOB NOT NULL,
        criado_em    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_session (session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    // Migra coluna caso a tabela já exista com tipo antigo
    await pool.query("ALTER TABLE planilhas_sessao MODIFY COLUMN dados LONGBLOB NOT NULL").catch(() => {});
  } catch (err) {
    console.error("[planilhas] Erro ao criar tabela:", err.message);
  }
})();

setInterval(async () => {
  await pool.query("DELETE FROM planilhas_sessao WHERE criado_em < NOW() - INTERVAL 2 HOUR").catch(() => {});
}, 60 * 60 * 1000);

function getSessionId(req) {
  return String(req.headers["x-session-id"] || req.query.sid || "").trim().slice(0, 64);
}

function parsearEmWorker(filePath) {
  return workerPool.run({ filePath });
}

export async function uploadPlanilha(req, res) {
  const filePath = req.file?.path;
  try {
    const sessionId = getSessionId(req);
    if (!sessionId) return res.status(400).json({ ok: false, error: "session_id obrigatório." });
    if (!req.file)  return res.status(400).json({ ok: false, error: "Nenhum arquivo enviado." });

    const dados = await parsearEmWorker(filePath);

    if (!dados.length) return res.status(400).json({ ok: false, error: "Planilha vazia ou sem dados." });

    const compressed = await comprimirDados(dados);

    await pool.query(
      "INSERT INTO planilhas_sessao (session_id, nome_arquivo, dados) VALUES (?, ?, ?)",
      [sessionId, req.file.originalname, compressed]
    );

    return res.json({ ok: true, nome: req.file.originalname, linhas: dados.length });
  } catch (err) {
    console.error("[uploadPlanilha]", err);
    return res.status(500).json({ ok: false, error: "Erro ao processar planilha." });
  } finally {
    if (filePath) await unlink(filePath).catch(() => {});
  }
}

export async function listarPlanilhas(req, res) {
  try {
    const sessionId = getSessionId(req);
    if (!sessionId) return res.status(400).json({ ok: false, error: "session_id obrigatório." });

    const [rows] = await pool.query(
      "SELECT id, nome_arquivo, criado_em FROM planilhas_sessao WHERE session_id = ? ORDER BY criado_em ASC",
      [sessionId]
    );

    return res.json({ ok: true, planilhas: rows });
  } catch (err) {
    console.error("[listarPlanilhas]", err);
    return res.status(500).json({ ok: false, error: "Erro ao listar planilhas." });
  }
}

export async function deletarPlanilha(req, res) {
  try {
    const sessionId = getSessionId(req);
    const id = Number(req.params.id);
    if (!sessionId || !id) return res.status(400).json({ ok: false, error: "Parâmetros inválidos." });

    await pool.query("DELETE FROM planilhas_sessao WHERE id = ? AND session_id = ?", [id, sessionId]);

    return res.json({ ok: true });
  } catch (err) {
    console.error("[deletarPlanilha]", err);
    return res.status(500).json({ ok: false, error: "Erro ao deletar planilha." });
  }
}

export async function limparSessao(req, res) {
  try {
    const sessionId = getSessionId(req);
    if (!sessionId) return res.status(400).json({ ok: false, error: "session_id obrigatório." });

    await pool.query("DELETE FROM planilhas_sessao WHERE session_id = ?", [sessionId]);

    return res.json({ ok: true });
  } catch (err) {
    console.error("[limparSessao]", err);
    return res.status(500).json({ ok: false, error: "Erro ao limpar sessão." });
  }
}

// filtros = { "planilhaId": [{coluna, valor}] }
function parseFiltrosPorPlanilha(raw) {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (typeof obj !== "object" || Array.isArray(obj) || !obj) return {};
    const result = {};
    for (const [id, arr] of Object.entries(obj)) {
      if (!Array.isArray(arr)) continue;
      result[id] = arr
        .map((f) => ({ coluna: String(f.coluna || "").trim(), valor: String(f.valor || "").trim() }))
        .filter((f) => f.coluna && f.valor);
    }
    return result;
  } catch {
    return {};
  }
}

function linhaPassaFiltros(linha, filtros) {
  for (const { coluna, valor } of filtros) {
    const cellValue = String(linha[coluna] ?? "").toLowerCase();
    if (!cellValue.includes(valor.toLowerCase())) return false;
  }
  return true;
}

export async function buscarDados(req, res) {
  try {
    const sessionId = getSessionId(req);
    if (!sessionId) return res.status(400).json({ ok: false, error: "session_id obrigatório." });

    const filtrosPorPlanilha = parseFiltrosPorPlanilha(req.query.filtros);

    const [rows] = await pool.query(
      "SELECT id, nome_arquivo, dados FROM planilhas_sessao WHERE session_id = ? ORDER BY criado_em ASC",
      [sessionId]
    );

    const resultados = [];
    for (const row of rows) {
      const dados = await descomprimirDados(row.dados);
      const filtros = filtrosPorPlanilha[String(row.id)] || [];
      for (const linha of dados) {
        if (!filtros.length || linhaPassaFiltros(linha, filtros)) {
          resultados.push({ _arquivo: row.nome_arquivo, ...linha });
        }
      }
    }

    return res.json({ ok: true, total: resultados.length, resultados });
  } catch (err) {
    console.error("[buscarDados]", err);
    return res.status(500).json({ ok: false, error: "Erro ao buscar dados." });
  }
}

export async function exportarResultados(req, res) {
  try {
    const sessionId = getSessionId(req);
    if (!sessionId) return res.status(400).json({ ok: false, error: "session_id obrigatório." });

    const filtrosPorPlanilha = parseFiltrosPorPlanilha(req.query.filtros);

    let colunasOrdenadas = null;
    if (req.query.colunas) {
      try {
        const parsed = JSON.parse(req.query.colunas);
        if (Array.isArray(parsed) && parsed.length) colunasOrdenadas = parsed;
      } catch {}
    }

    const [rows] = await pool.query(
      "SELECT id, nome_arquivo, dados FROM planilhas_sessao WHERE session_id = ? ORDER BY criado_em ASC",
      [sessionId]
    );

    const resultados = [];
    for (const row of rows) {
      const dados = await descomprimirDados(row.dados);
      const filtros = filtrosPorPlanilha[String(row.id)] || [];
      for (const linha of dados) {
        if (!filtros.length || linhaPassaFiltros(linha, filtros)) {
          resultados.push({ _arquivo: row.nome_arquivo, ...linha });
        }
      }
    }

    if (!resultados.length) {
      return res.status(400).json({ ok: false, error: "Nenhum resultado para exportar." });
    }

    let dadosParaExportar;
    if (colunasOrdenadas) {
      dadosParaExportar = resultados.map((linha) => {
        const obj = {};
        for (const col of colunasOrdenadas) {
          const header = col.startsWith("_") ? col.slice(1) : col;
          obj[header] = linha[col] ?? "";
        }
        return obj;
      });
    } else {
      dadosParaExportar = resultados.map(({ _arquivo, ...rest }) => ({ arquivo: _arquivo, ...rest }));
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(dadosParaExportar);
    XLSX.utils.book_append_sheet(wb, ws, "Resultados");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=resultado_cofre.xlsx");
    return res.send(buffer);
  } catch (err) {
    console.error("[exportarResultados]", err);
    return res.status(500).json({ ok: false, error: "Erro ao exportar." });
  }
}

export async function listarColunasPorPlanilha(req, res) {
  try {
    const sessionId = getSessionId(req);
    if (!sessionId) return res.status(400).json({ ok: false, error: "session_id obrigatório." });

    const [rows] = await pool.query(
      "SELECT id, nome_arquivo, dados FROM planilhas_sessao WHERE session_id = ? ORDER BY criado_em ASC",
      [sessionId]
    );

    const planilhas = [];
    for (const row of rows) {
      const dados = await descomprimirDados(row.dados);
      planilhas.push({
        id: row.id,
        nome_arquivo: row.nome_arquivo,
        colunas: dados.length ? Object.keys(dados[0]) : [],
      });
    }

    return res.json({ ok: true, planilhas });
  } catch (err) {
    console.error("[listarColunasPorPlanilha]", err);
    return res.status(500).json({ ok: false, error: "Erro ao listar colunas." });
  }
}
