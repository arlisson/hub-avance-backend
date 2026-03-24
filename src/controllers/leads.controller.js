import { randomUUID } from "crypto";
import { pool } from "../config/db.js";

const SERVICOS_VALIDOS = new Set(["movel", "internet", "fixa"]);

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function trimText(value) {
  return String(value || "").trim();
}

export async function createLead(req, res) {
  try {
    const nome = trimText(req.body?.nome);
    const cpf = normalizeDigits(req.body?.cpf);
    const whatsapp = normalizeDigits(req.body?.whatsapp);
    const servico = trimText(req.body?.servico).toLowerCase();
    const dados = req.body?.dados ?? null;

    if (!nome) {
      return res.status(400).json({
        ok: false,
        error: "Nome é obrigatório.",
      });
    }

    if (!cpf || cpf.length < 11) {
      return res.status(400).json({
        ok: false,
        error: "CPF inválido.",
      });
    }

    if (!whatsapp || whatsapp.length < 10) {
      return res.status(400).json({
        ok: false,
        error: "WhatsApp inválido.",
      });
    }

    if (!SERVICOS_VALIDOS.has(servico)) {
      return res.status(400).json({
        ok: false,
        error: "Serviço inválido.",
      });
    }

    if (dados !== null && (typeof dados !== "object" || Array.isArray(dados))) {
      return res.status(400).json({
        ok: false,
        error: "O campo dados deve ser um objeto JSON.",
      });
    }

    const id = randomUUID();

    await pool.query(
      `
      INSERT INTO leads (
        id,
        nome,
        cpf,
        whatsapp,
        servico,
        dados,
        atendido
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        nome,
        cpf,
        whatsapp,
        servico,
        dados ? JSON.stringify(dados) : null,
        0,
      ]
    );

    return res.status(201).json({
      ok: true,
      message: "Lead salvo com sucesso.",
      id,
    });
  } catch (error) {
    console.error("Erro ao criar lead:", error);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}

export async function listLeads(req, res) {
  try {
    const servico = trimText(req.query?.servico).toLowerCase();
    const limitRaw = Number(req.query?.limit || 100);
    const limit = Number.isInteger(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 500)
      : 100;

    let sql = `
      SELECT
        id,
        nome,
        cpf,
        whatsapp,
        servico,
        dados,
        created_at
      FROM leads
    `;
    const params = [];

    if (servico) {
      sql += ` WHERE servico = ? `;
      params.push(servico);
    }

    sql += ` ORDER BY created_at DESC LIMIT ? `;
    params.push(limit);

    const [rows] = await pool.query(sql, params);

    const leads = rows.map((row) => ({
      id: row.id,
      nome: row.nome,
      cpf: row.cpf,
      whatsapp: row.whatsapp,
      servico: row.servico,
      dados:
        typeof row.dados === "string"
          ? JSON.parse(row.dados)
          : row.dados,
      created_at: row.created_at,
    }));

    return res.json({
      ok: true,
      leads,
    });
  } catch (error) {
    console.error("Erro ao listar leads:", error);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}