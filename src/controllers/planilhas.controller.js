import { pool } from "../config/db.js";
import * as XLSX from "xlsx";
import { randomBytes } from "crypto";

// Auto-cria tabela de sessão
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS planilhas_sessao (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(64) NOT NULL,
        nome_arquivo VARCHAR(255) NOT NULL,
        dados      MEDIUMTEXT NOT NULL,
        criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_session (session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } catch (err) {
    console.error("[planilhas] Erro ao criar tabela:", err.message);
  }
})();

// Limpa sessões antigas a cada hora (segurança extra)
setInterval(async () => {
  await pool.query("DELETE FROM planilhas_sessao WHERE criado_em < NOW() - INTERVAL 2 HOUR").catch(() => {});
}, 60 * 60 * 1000);

function getSessionId(req) {
  return String(req.headers["x-session-id"] || req.query.sid || "").trim().slice(0, 64);
}

export async function uploadPlanilha(req, res) {
  try {
    const sessionId = getSessionId(req);
    if (!sessionId) return res.status(400).json({ ok: false, error: "session_id obrigatório." });

    if (!req.file) return res.status(400).json({ ok: false, error: "Nenhum arquivo enviado." });

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const dados = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });

    if (!dados.length) return res.status(400).json({ ok: false, error: "Planilha vazia ou sem dados." });

    await pool.query(
      "INSERT INTO planilhas_sessao (session_id, nome_arquivo, dados) VALUES (?, ?, ?)",
      [sessionId, req.file.originalname, JSON.stringify(dados)]
    );

    return res.json({ ok: true, nome: req.file.originalname, linhas: dados.length });
  } catch (err) {
    console.error("[uploadPlanilha]", err);
    return res.status(500).json({ ok: false, error: "Erro ao processar planilha." });
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

    await pool.query(
      "DELETE FROM planilhas_sessao WHERE id = ? AND session_id = ?",
      [id, sessionId]
    );

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

export async function buscarDados(req, res) {
  try {
    const sessionId = getSessionId(req);
    if (!sessionId) return res.status(400).json({ ok: false, error: "session_id obrigatório." });

    const coluna = String(req.query.coluna || "").trim();
    const valor  = String(req.query.valor  || "").trim();

    const [rows] = await pool.query(
      "SELECT nome_arquivo, dados FROM planilhas_sessao WHERE session_id = ?",
      [sessionId]
    );

    const resultados = [];

    for (const row of rows) {
      const dados = JSON.parse(row.dados);
      for (const linha of dados) {
        if (!coluna) {
          // sem filtro: retorna tudo
          resultados.push({ _arquivo: row.nome_arquivo, ...linha });
          continue;
        }
        const cellValue = String(linha[coluna] ?? "").toLowerCase();
        if (cellValue.includes(valor.toLowerCase())) {
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

    const coluna = String(req.query.coluna || "").trim();
    const valor  = String(req.query.valor  || "").trim();

    const [rows] = await pool.query(
      "SELECT nome_arquivo, dados FROM planilhas_sessao WHERE session_id = ?",
      [sessionId]
    );

    const resultados = [];

    for (const row of rows) {
      const dados = JSON.parse(row.dados);
      for (const linha of dados) {
        if (!coluna) {
          resultados.push({ _arquivo: row.nome_arquivo, ...linha });
          continue;
        }
        const cellValue = String(linha[coluna] ?? "").toLowerCase();
        if (cellValue.includes(valor.toLowerCase())) {
          resultados.push({ _arquivo: row.nome_arquivo, ...linha });
        }
      }
    }

    if (!resultados.length) {
      return res.status(400).json({ ok: false, error: "Nenhum resultado para exportar." });
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(resultados);
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

export async function listarColunas(req, res) {
  try {
    const sessionId = getSessionId(req);
    if (!sessionId) return res.status(400).json({ ok: false, error: "session_id obrigatório." });

    const [rows] = await pool.query(
      "SELECT dados FROM planilhas_sessao WHERE session_id = ?",
      [sessionId]
    );

    const colunasSet = new Set();
    for (const row of rows) {
      const dados = JSON.parse(row.dados);
      if (dados.length) {
        Object.keys(dados[0]).forEach((k) => colunasSet.add(k));
      }
    }

    return res.json({ ok: true, colunas: [...colunasSet] });
  } catch (err) {
    console.error("[listarColunas]", err);
    return res.status(500).json({ ok: false, error: "Erro ao listar colunas." });
  }
}
