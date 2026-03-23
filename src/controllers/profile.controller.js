import { pool } from "../config/db.js";

function parseJsonSafe(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

function normalizeProfileRow(row) {
  const regiao = parseJsonSafe(row.regiao, null);

  return {
    id: row.id,
    email: row.email,
    nome: row.nome || "",
    ativo: !!row.ativo,
    role: row.role || "",
    protocol: !!row.protocol,
    cliente_avance: !!row.cliente_avance,
    cpf_cnpj: row.cpf_cnpj || "",
    whatsapp: row.whatsapp || "",
    has_mobile_service: normalizeBoolean(row.has_mobile_service),
    contract_type: row.contract_type || "",
    operador: row.operador || "",
    active_lines:
      row.active_lines === null || row.active_lines === undefined
        ? null
        : Number(row.active_lines),
    app_usage: parseJsonSafe(row.app_usage, {}),
    regiao,
    cep: regiao?.cep || row.cep || "",
    cidade: regiao?.cidade || "",
    estado: regiao?.estado || "",
    email_confirmado: !!row.email_confirmado,
  };
}

function validateProfilePayload(body) {
  const errors = [];

  const nome = String(body.nome || "").trim();
  const whatsapp = String(body.whatsapp || "").replace(/\D/g, "");
  const cep = String(body.cep || "").replace(/\D/g, "");
  const hasMobileService = body.has_mobile_service;
  const regiaoInput = body.regiao && typeof body.regiao === "object" ? body.regiao : {};

  if (!nome) {
    errors.push("Informe seu nome.");
  }

  if (!whatsapp || whatsapp.length < 10 || whatsapp.length > 11) {
    errors.push("Informe um WhatsApp válido.");
  }

  if (!cep || cep.length !== 8) {
    errors.push("Informe um CEP válido.");
  }

  if (hasMobileService !== true && hasMobileService !== false) {
    errors.push("Selecione se a telefonia está ativa.");
  }

  let contractType = null;
  let operador = null;
  let activeLines = null;

  if (hasMobileService === true) {
    contractType = String(body.contract_type || "").trim().toUpperCase();
    operador = String(body.operador || "").trim();
    const activeLinesRaw = body.active_lines;

    if (contractType !== "CPF" && contractType !== "CNPJ") {
      errors.push("Selecione um tipo de contrato válido.");
    }

    if (!operador) {
      errors.push("Informe a operadora.");
    }

    if (
      activeLinesRaw === "" ||
      activeLinesRaw === null ||
      activeLinesRaw === undefined ||
      !Number.isInteger(Number(activeLinesRaw)) ||
      Number(activeLinesRaw) < 0
    ) {
      errors.push("Informe uma quantidade válida de linhas ativas.");
    } else {
      activeLines = Number(activeLinesRaw);
    }
  }

  const regiao = {
    cep,
    cidade: String(regiaoInput.cidade || body.cidade || "").trim(),
    estado: String(regiaoInput.estado || body.estado || "").trim(),
  };

  return {
    errors,
    values: {
      nome,
      whatsapp,
      cep,
      has_mobile_service: hasMobileService,
      contract_type: contractType,
      operador,
      active_lines: activeLines,
      regiao,
    },
  };
}

export async function getProfile(req, res) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const [rows] = await pool.query(
      `
      SELECT
        u.id,
        u.email,
        u.ativo,
        u.email_confirmado,
        r.nome AS role,
        p.nome,
        p.cpf_cnpj,
        p.whatsapp,
        p.has_mobile_service,
        p.contract_type,
        p.operador,
        p.active_lines,
        p.protocol,
        p.cliente_avance,
        p.app_usage,
        p.regiao,
        p.cep
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      LEFT JOIN profiles p ON p.id = u.id
      WHERE u.id = ?
      LIMIT 1
      `,
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "PROFILE_NOT_FOUND" });
    }

    return res.json({
      ok: true,
      user: normalizeProfileRow(rows[0]),
    });
  } catch (error) {
    console.error("Erro ao buscar perfil:", error);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}

export async function updateProfile(req, res) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const { errors, values } = validateProfilePayload(req.body || {});
    if (errors.length) {
      return res.status(400).json({
        ok: false,
        error: errors[0],
        errors,
      });
    }

    const regiaoJson = JSON.stringify(values.regiao);

    const [result] = await pool.query(
      `
      UPDATE profiles
      SET
        nome = ?,
        whatsapp = ?,
        has_mobile_service = ?,
        contract_type = ?,
        operador = ?,
        active_lines = ?,
        regiao = ?,
        cep = ?
      WHERE id = ?
      `,
      [
        values.nome,
        values.whatsapp,
        values.has_mobile_service ? 1 : 0,
        values.contract_type,
        values.operador,
        values.active_lines,
        regiaoJson,
        values.cep,
        userId,
      ]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ ok: false, error: "PROFILE_NOT_FOUND" });
    }

    const [rows] = await pool.query(
      `
      SELECT
        u.id,
        u.email,
        u.ativo,
        u.email_confirmado,
        r.nome AS role,
        p.nome,
        p.cpf_cnpj,
        p.whatsapp,
        p.has_mobile_service,
        p.contract_type,
        p.operador,
        p.active_lines,
        p.protocol,
        p.cliente_avance,
        p.app_usage,
        p.regiao,
        p.cep
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      LEFT JOIN profiles p ON p.id = u.id
      WHERE u.id = ?
      LIMIT 1
      `,
      [userId]
    );

    return res.json({
      ok: true,
      message: "Perfil atualizado com sucesso.",
      user: normalizeProfileRow(rows[0]),
    });
  } catch (error) {
    console.error("Erro ao atualizar perfil:", error);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}