import { pool } from "../config/db.js";
import { isAdminRole } from "../utils/roles.js";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";

function getEncryptionKey() {
  const key = process.env.API_KEY_SECRET;
  if (!key || key.length < 32) {
    throw new Error("API_KEY_SECRET não configurado ou muito curto (mínimo 32 caracteres).");
  }
  return Buffer.from(key.slice(0, 32), "utf8");
}

function encryptApiKey(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptApiKey(stored) {
  const parts = stored.split(":");
  if (parts.length !== 3) return stored; // fallback: chave em texto puro (legado)
  const [ivHex, tagHex, encHex] = parts;
  const decipher = createDecipheriv(ALGO, getEncryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(encHex, "hex"), undefined, "utf8") + decipher.final("utf8");
}


function getUserId(req) {
  return req.user?.id || null;
}

export async function requireClienteAvance(req, res, next) {
  const role = String(req.user?.role || "").toLowerCase();

  if (isAdminRole(role)) return next();

  try {
    const [rows] = await pool.query(
      "SELECT cliente_avance FROM profiles WHERE id = ? LIMIT 1",
      [req.user?.id]
    );
    if (rows[0]?.cliente_avance) return next();
  } catch {
    // falha silenciosa, nega acesso
  }

  return res.status(403).json({ ok: false, error: "Acesso negado." });
}

function getUserEmail(req) {
  return req.user?.email || "";
}

async function validateGeminiApiKey(apiKey) {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  );

  if (!resp.ok) {
    let detail = "Chave inválida ou bloqueada pelo Google.";

    try {
      const data = await resp.json();
      detail = data?.error?.message || detail;
    } catch {}

    const err = new Error(detail);
    err.status = 400;
    throw err;
  }
}

function triggerN8nAgent({ chatInput, sessionId, email, apiKey, jobId }) {
  const webhookUrl = process.env.N8N_AGENT_WEBHOOK_URL;

  if (!webhookUrl) {
    agentJobs.set(jobId, { status: "error", error: "Agente não configurado no servidor." });
    return;
  }

  // Fire and forget: responde imediatamente, n8n chama /api/agent/callback/:jobId quando terminar
  fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatInput, sessionId, email, geminiApiKey: apiKey, callbackJobId: jobId }),
  })
    .then(async (resp) => {
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.error(`[triggerN8nAgent] n8n retornou ${resp.status}:`, text.slice(0, 300));
        agentJobs.set(jobId, { status: "error", error: "Falha ao acionar o agente." });
      }
      // Se n8n respondeu ok, o resultado virá pelo callback — não faz nada aqui
    })
    .catch((err) => {
      console.error("[triggerN8nAgent] Erro ao acionar n8n:", err);
      agentJobs.set(jobId, { status: "error", error: "Não foi possível conectar ao agente." });
    });
}

async function getStoredApiKeyByUserId(userId) {
  const [rows] = await pool.query(
    "SELECT chave_api FROM profiles WHERE id = ? LIMIT 1",
    [userId]
  );

  if (!rows.length) return null;
  return rows[0]?.chave_api || null;
}


export async function getAgentStatus(req, res) {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: "Não autorizado.",
      });
    }

    const apiKey = await getStoredApiKeyByUserId(userId);

    return res.json({
      ok: true,
      hasApiKey: !!apiKey,
      online: !!apiKey,
    });
  } catch (error) {
    console.error("Erro em getAgentStatus:", error);
    return res.status(500).json({
      ok: false,
      error: "Não foi possível consultar o status do agente.",
    });
  }
}

export async function saveAgentApiKey(req, res) {
  try {
    const userId = getUserId(req);
    const email = getUserEmail(req);
    const apiKey = String(req.body?.apiKey || "").trim();

    if (!userId || !email) {
      return res.status(401).json({
        ok: false,
        error: "Não autorizado.",
      });
    }

    if (apiKey.length < 10) {
      return res.status(400).json({
        ok: false,
        error: "Informe uma chave Gemini válida.",
      });
    }

    await validateGeminiApiKey(apiKey);

    await pool.query(
      "UPDATE profiles SET chave_api = ? WHERE id = ? LIMIT 1",
      [encryptApiKey(apiKey), userId]
    );

    return res.json({
      ok: true,
      message: "Chave salva com sucesso.",
    });
  } catch (error) {
    console.error("Erro em saveAgentApiKey:", error);
    return res.status(error?.status || 500).json({
      ok: false,
      error: error?.message || "Não foi possível salvar a chave.",
    });
  }
}

export async function deleteAgentApiKey(req, res) {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: "Não autorizado.",
      });
    }

    await pool.query(
      "UPDATE profiles SET chave_api = NULL WHERE id = ? LIMIT 1",
      [userId]
    );

    return res.json({
      ok: true,
      message: "Chave removida com sucesso.",
    });
  } catch (error) {
    console.error("Erro em deleteAgentApiKey:", error);
    return res.status(500).json({
      ok: false,
      error: "Não foi possível remover a chave.",
    });
  }
}

// Jobs em memória: jobId -> { status, output, error }
const agentJobs = new Map();

function createJob() {
  const jobId = randomBytes(16).toString("hex");
  agentJobs.set(jobId, { status: "pending" });
  setTimeout(() => agentJobs.delete(jobId), 10 * 60 * 1000);
  return jobId;
}

export async function sendAgentMessage(req, res) {
  const userId = getUserId(req);
  const email = getUserEmail(req);
  const chatInput = String(req.body?.chatInput || "").trim();
  const sessionId = String(req.body?.sessionId || "").trim();

  if (!userId || !email) {
    return res.status(401).json({ ok: false, error: "Não autorizado." });
  }

  if (!chatInput) {
    return res.status(400).json({ ok: false, error: "Digite uma mensagem." });
  }

  const storedKey = await getStoredApiKeyByUserId(userId);
  if (!storedKey) {
    return res.status(400).json({
      ok: false,
      error: "O agente está offline. Cadastre uma chave Gemini.",
    });
  }

  const jobId = createJob();

  // Dispara n8n sem aguardar — n8n chama /api/agent/callback/:jobId quando terminar
  triggerN8nAgent({ chatInput, sessionId, email, apiKey: decryptApiKey(storedKey), jobId });

  return res.json({ ok: true, jobId });
}

export function receiveAgentCallback(req, res) {
  const jobId = String(req.params.jobId || "");
  const secret = String(req.headers["x-callback-secret"] || "");

  if (!process.env.N8N_CALLBACK_SECRET || secret !== process.env.N8N_CALLBACK_SECRET) {
    return res.status(403).json({ ok: false, error: "Não autorizado." });
  }

  if (!agentJobs.has(jobId)) {
    return res.status(404).json({ ok: false, error: "Job não encontrado ou expirado." });
  }

  const output = String(req.body?.output || "");
  agentJobs.set(jobId, { status: "done", output });

  return res.json({ ok: true });
}

export function getAgentJobResult(req, res) {
  const jobId = String(req.params.jobId || "");
  const job = agentJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ ok: false, error: "Job não encontrado." });
  }

  if (job.status === "pending") {
    return res.json({ ok: true, status: "pending" });
  }

  agentJobs.delete(jobId);

  if (job.status === "error") {
    return res.json({ ok: false, error: job.error });
  }

  return res.json({ ok: true, status: "done", output: job.output });
}

// ─── CONTEXTO DA EMPRESA ────────────────────────────────────────────────────

export async function getAgentContext(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Não autorizado." });

    const userEmail = getUserEmail(req);
    const [rows] = await pool.query(
      "SELECT dados FROM perfil_cliente WHERE user_email = ? LIMIT 1",
      [userEmail]
    );

    const raw = rows[0]?.dados || null;
    const contexto = raw ? JSON.parse(raw) : null;

    return res.json({ ok: true, contexto });
  } catch (err) {
    console.error("Erro em getAgentContext:", err);
    return res.status(500).json({ ok: false, error: "Não foi possível carregar o contexto." });
  }
}

export async function saveAgentContext(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Não autorizado." });

    const empresa = String(req.body?.empresa || "").trim().slice(0, 200);
    const problema = String(req.body?.problema || "").trim().slice(0, 5000);

    if (!empresa) return res.status(400).json({ ok: false, error: "O nome da empresa é obrigatório." });
    if (!problema) return res.status(400).json({ ok: false, error: "O campo de problema é obrigatório." });

    const contexto = {
      empresa,
      segmento:    String(req.body?.segmento    || "").trim().slice(0, 200),
      produto:     String(req.body?.produto     || "").trim().slice(0, 500),
      modeloVenda: String(req.body?.modeloVenda || "").trim().slice(0, 20),
      publico:     String(req.body?.publico     || "").trim().slice(0, 1000),
      processo: Array.isArray(req.body?.processo)
        ? req.body.processo.map((v) => String(v).trim().slice(0, 50)).slice(0, 10)
        : [],
      problema,
      dor: "",
    };

    const userEmail = getUserEmail(req);
    await pool.query(
      `INSERT INTO perfil_cliente (user_email, dados)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE dados = VALUES(dados)`,
      [userEmail, JSON.stringify(contexto)]
    );

    return res.json({ ok: true, message: "Contexto salvo com sucesso." });
  } catch (err) {
    console.error("Erro em saveAgentContext:", err);
    return res.status(500).json({ ok: false, error: "Não foi possível salvar o contexto." });
  }
}

// Migração automática: cria a tabela perfil_cliente se ainda não existir
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS perfil_cliente (
        user_email  VARCHAR(255) NOT NULL,
        dados       TEXT         NOT NULL,
        PRIMARY KEY (user_email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      ALTER TABLE perfil_cliente
      ADD COLUMN IF NOT EXISTS ebook_temp MEDIUMTEXT NULL DEFAULT NULL
    `);
  } catch (err) {
    console.error("[agent.controller] Erro ao criar tabela perfil_cliente:", err.message);
  }
})();