import { pool } from "../config/db.js";
import { isAdminRole } from "../utils/roles.js";

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

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .filter((item) => item && typeof item.text === "string" && item.text.trim())
    .slice(-12)
    .map((item) => ({
      role: item.role === "model" ? "model" : "user",
      text: item.text.trim(),
    }));
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

async function callN8nAgent({ chatInput, sessionId, email }) {
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
      body: JSON.stringify({ chatInput, sessionId, email }),
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

async function callGemini({ apiKey, history, chatInput }) {
  const systemInstruction = `
Você é o Apolo, mentor estratégico de vendas da AVANCE.
Responda em português do Brasil.
Seja objetivo, claro e útil.
Quando fizer sentido, use tópicos curtos e sugestões práticas.
`.trim();

  const contents = [
    {
      role: "user",
      parts: [{ text: systemInstruction }],
    },
    {
      role: "model",
      parts: [{ text: "Entendido. Vou agir como Apolo, mentor estratégico de vendas da AVANCE." }],
    },
  ];

  for (const item of history) {
    contents.push({
      role: item.role === "model" ? "model" : "user",
      parts: [{ text: item.text }],
    });
  }

  contents.push({
    role: "user",
    parts: [{ text: chatInput }],
  });

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 1024,
        },
      }),
    }
  );

  const data = await resp.json().catch(() => null);

  if (!resp.ok) {
    const message = data?.error?.message || "Falha ao consultar o Gemini.";
    const err = new Error(message);
    err.status = resp.status || 502;
    throw err;
  }

  const output =
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text || "")
      .join("")
      .trim() || "";

  return output || "Não consegui gerar uma resposta agora.";
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
      [apiKey, userId]
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
  try {
    const userId = getUserId(req);
    const email = getUserEmail(req);
    const chatInput = String(req.body?.chatInput || "").trim();
    const sessionId = String(req.body?.sessionId || "").trim();

    if (!userId || !email) {
      return res.status(401).json({
        ok: false,
        error: "Não autorizado.",
      });
    }

    if (!chatInput) {
      return res.status(400).json({
        ok: false,
        error: "Digite uma mensagem.",
      });
    }

    const apiKey = await getStoredApiKeyByUserId(userId);

    if (!apiKey) {
      return res.status(400).json({
        ok: false,
        error: "O agente está offline. Cadastre uma chave Gemini.",
      });
    }

    const output = await callN8nAgent({ chatInput, sessionId, email });

    return res.json({
      ok: true,
      output,
    });
  } catch (error) {
    console.error("Erro em sendAgentMessage:", error);
    return res.status(error?.status || 500).json({
      ok: false,
      error: error?.message || "Não foi possível processar a mensagem.",
    });
  }
}