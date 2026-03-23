import { pool } from "../config/db.js";

function parseJsonSafe(value, fallback = null) {
  if (value == null) return fallback;
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

function normalizeNullableString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function normalizeUserRow(row) {
  const regiao = parseJsonSafe(row.regiao, null);

  return {
    id: row.id,
    email: row.email,
    ativo: !!row.ativo,
    email_confirmado: !!row.email_confirmado,
    role: row.role || "",

    nome: row.nome || "",
    cpf_cnpj: row.cpf_cnpj || "",
    whatsapp: row.whatsapp || "",
    has_mobile_service: normalizeBoolean(row.has_mobile_service),
    contract_type: row.contract_type || "",
    operador: row.operador || "",
    active_lines:
      row.active_lines === null || row.active_lines === undefined
        ? null
        : Number(row.active_lines),
    protocol: !!row.protocol,
    cliente_avance: !!row.cliente_avance,
    app_usage: parseJsonSafe(row.app_usage, {}),
    regiao,
    cep: regiao?.cep || row.cep || "",
    cidade: regiao?.cidade || "",
    estado: regiao?.estado || "",
  };
}

async function ensureAdmin(req, res) {
  try {
    const role = String(req.user?.role || "").toLowerCase();

    if (role === "admin" || role === "administrador") {
      return true;
    }

    const [rows] = await pool.query(
      `
      SELECT protocol
      FROM profiles
      WHERE id = ?
      LIMIT 1
      `,
      [req.user.id]
    );

    const protocol = rows?.[0]?.protocol;

    if (protocol === 1 || protocol === true) {
      return true;
    }

    res.status(403).json({ ok: false, error: "Acesso negado." });
    return false;
  } catch (error) {
    console.error("Erro ao validar permissão:", error);
    res.status(500).json({ ok: false, error: "INTERNAL_SERVER_ERROR" });
    return false;
  }
}

function buildListFilters(query) {
  const where = [];
  const params = [];

  const search = String(query.search || "").trim();
  const clienteAvance = String(query.cliente_avance || "").trim();
  const hasMobileService = String(query.has_mobile_service || "").trim();
  const contractType = String(query.contract_type || "").trim();
  const operador = String(query.operador || "").trim();
  const activeLines = String(query.active_lines || "").trim();

  if (search) {
    const like = `%${search}%`;
    where.push(`(
      u.email LIKE ?
      OR p.nome LIKE ?
      OR p.cpf_cnpj LIKE ?
      OR p.whatsapp LIKE ?
      OR p.operador LIKE ?
    )`);
    params.push(like, like, like, like, like);
  }

  if (clienteAvance === "true" || clienteAvance === "false") {
    where.push("p.cliente_avance = ?");
    params.push(clienteAvance === "true" ? 1 : 0);
  }

  if (hasMobileService === "true" || hasMobileService === "false") {
    where.push("p.has_mobile_service = ?");
    params.push(hasMobileService === "true" ? 1 : 0);
  }

  if (contractType) {
    where.push("p.contract_type = ?");
    params.push(contractType);
  }

  if (operador) {
    where.push("p.operador = ?");
    params.push(operador);
  }

  if (activeLines === "0") {
    where.push("COALESCE(p.active_lines, 0) = 0");
  } else if (activeLines === "1-10") {
    where.push("COALESCE(p.active_lines, 0) BETWEEN 1 AND 10");
  } else if (activeLines === "11-50") {
    where.push("COALESCE(p.active_lines, 0) BETWEEN 11 AND 50");
  } else if (activeLines === "51+") {
    where.push("COALESCE(p.active_lines, 0) >= 51");
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

export async function listUsers(req, res) {
  try {
    if (!await ensureAdmin(req, res)) return;

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200);
    const offset = (page - 1) * limit;

    const { whereSql, params } = buildListFilters(req.query);

    const [countRows] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      LEFT JOIN profiles p ON p.id = u.id
      ${whereSql}
      `,
      params
    );

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
      ${whereSql}
      ORDER BY COALESCE(p.nome, u.email) ASC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    return res.json({
      ok: true,
      page,
      limit,
      total: Number(countRows?.[0]?.total || 0),
      users: rows.map(normalizeUserRow),
    });
  } catch (error) {
    console.error("Erro ao listar usuários:", error);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}

export async function updateUser(req, res) {
  try {
    if (!await ensureAdmin(req, res)) return;

    const id = String(req.body?.id || "").trim();
    const nome = String(req.body?.nome || "").trim();
    const cpf_cnpj = String(req.body?.cpf_cnpj || "").trim();
    const whatsapp = String(req.body?.whatsapp || "").replace(/\D/g, "");
    const cep = String(req.body?.cep || "").replace(/\D/g, "");
    const cidade = String(req.body?.cidade || "").trim();
    const estado = String(req.body?.estado || "").trim();
    const has_mobile_service = req.body?.has_mobile_service;
    const contract_type = String(req.body?.contract_type || "").trim().toUpperCase();
    const operador = String(req.body?.operador || "").trim();
    const active_lines = Number(req.body?.active_lines);
    const protocol = !!req.body?.protocol;
    const cliente_avance = !!req.body?.cliente_avance;

    if (!id) {
      return res.status(400).json({ ok: false, error: "ID do usuário é obrigatório." });
    }

    if (!nome) {
      return res.status(400).json({ ok: false, error: "Nome é obrigatório." });
    }

    if (!cpf_cnpj) {
      return res.status(400).json({ ok: false, error: "CPF/CNPJ é obrigatório." });
    }

    if (!whatsapp || whatsapp.length < 10 || whatsapp.length > 11) {
      return res.status(400).json({ ok: false, error: "WhatsApp inválido." });
    }

    if (!cep || cep.length !== 8) {
      return res.status(400).json({ ok: false, error: "CEP inválido." });
    }

    if (has_mobile_service !== true && has_mobile_service !== false) {
      return res.status(400).json({ ok: false, error: "Selecione se a telefonia está ativa." });
    }

    if (contract_type !== "CPF" && contract_type !== "CNPJ") {
      return res.status(400).json({ ok: false, error: "Tipo de contrato inválido." });
    }

    if (!operador) {
      return res.status(400).json({ ok: false, error: "Operadora é obrigatória." });
    }

    if (!Number.isInteger(active_lines) || active_lines < 0) {
      return res.status(400).json({ ok: false, error: "Quantidade de linhas inválida." });
    }

    const regiaoJson = JSON.stringify({
      cep,
      cidade,
      estado,
    });

    const [result] = await pool.query(
      `
      UPDATE profiles
      SET
        nome = ?,
        cpf_cnpj = ?,
        whatsapp = ?,
        has_mobile_service = ?,
        contract_type = ?,
        operador = ?,
        active_lines = ?,
        protocol = ?,
        cliente_avance = ?,
        regiao = ?,
        cep = ?
      WHERE id = ?
      `,
      [
        nome,
        cpf_cnpj,
        whatsapp,
        has_mobile_service ? 1 : 0,
        contract_type,
        operador,
        active_lines,
        protocol ? 1 : 0,
        cliente_avance ? 1 : 0,
        regiaoJson,
        cep,
        id,
      ]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });
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
      [id]
    );

    return res.json({
      ok: true,
      message: "Usuário atualizado com sucesso.",
      user: normalizeUserRow(rows[0]),
    });
  } catch (error) {
    console.error("Erro ao atualizar usuário:", error);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}

export async function deleteUser(req, res) {
  const connection = await pool.getConnection();

  try {
    if (!await ensureAdmin(req, res)) {
      connection.release();
      return;
    }

    const id = normalizeNullableString(req.body?.id);

    if (!id) {
      connection.release();
      return res.status(400).json({ ok: false, error: "ID do usuário é obrigatório." });
    }

    if (id === req.user?.id) {
      connection.release();
      return res.status(400).json({ ok: false, error: "Você não pode excluir seu próprio usuário." });
    }

    await connection.beginTransaction();

    const [userRows] = await connection.query(
      `SELECT id FROM users WHERE id = ? LIMIT 1`,
      [id]
    );

    if (!userRows.length) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });
    }

    await connection.query(`DELETE FROM profiles WHERE id = ?`, [id]);
    await connection.query(`DELETE FROM users WHERE id = ?`, [id]);

    await connection.commit();
    connection.release();

    return res.json({
      ok: true,
      message: "Usuário excluído com sucesso.",
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {}

    connection.release();

    console.error("Erro ao excluir usuário:", error);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}