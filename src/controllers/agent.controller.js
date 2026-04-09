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

async function callN8nAgent({ chatInput, sessionId, email, apiKey }) {
  const webhookUrl = process.env.N8N_AGENT_WEBHOOK_URL;

  if (!webhookUrl) {
    const err = new Error("Agente não configurado no servidor.");
    err.status = 503;
    throw err;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  let resp;
  try {
    resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatInput, sessionId, email, geminiApiKey: apiKey }),
      signal: controller.signal,
    });
  } catch (fetchErr) {
    clearTimeout(timeout);
    if (fetchErr.name === "AbortError") {
      const err = new Error("O agente demorou demais para responder. Tente novamente.");
      err.status = 504;
      throw err;
    }
    throw fetchErr;
  }
  clearTimeout(timeout);

  const text = await resp.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!resp.ok) {
    console.error(`[callN8nAgent] n8n retornou ${resp.status} para ${webhookUrl}`);
    console.error(`[callN8nAgent] corpo da resposta:`, text.slice(0, 500));
    const err = new Error(data?.error || "Falha ao contactar o agente.");
    err.status = 502;
    throw err;
  }

  console.log("[callN8nAgent] resposta do n8n:", JSON.stringify(data)?.slice(0, 300));
  return data?.output || data?.text || "";
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

  const apiKey = await getStoredApiKeyByUserId(userId);
  if (!apiKey) {
    return res.status(400).json({
      ok: false,
      error: "O agente está offline. Cadastre uma chave Gemini.",
    });
  }

  // Abre conexão SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Ping a cada 15s para o proxy não cortar
  const ping = setInterval(() => {
    res.write(": ping\n\n");
  }, 15000);

  const finish = (data) => {
    clearInterval(ping);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    res.end();
  };

  try {
    const output = await callN8nAgent({ chatInput, sessionId, email, apiKey: decryptApiKey(apiKey) });
    finish({ ok: true, output });
  } catch (error) {
    console.error("Erro em sendAgentMessage:", error);
    finish({ ok: false, error: error?.message || "Não foi possível processar a mensagem." });
  }
}