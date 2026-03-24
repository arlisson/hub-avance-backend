import { pool } from "../config/db.js";

function trimText(value) {
  return String(value || "").trim();
}

function parseBooleanFilter(value) {
  if (value === "true") return 1;
  if (value === "false") return 0;
  return null;
}

function normalizeLeadRow(row) {
  let dados = row.dados;

  if (typeof dados === "string") {
    try {
      dados = JSON.parse(dados);
    } catch {
      dados = null;
    }
  }

  return {
    id: row.id,
    nome: row.nome || "",
    cpf: row.cpf || "",
    whatsapp: row.whatsapp || "",
    servico: row.servico || "",
    dados: dados && typeof dados === "object" ? dados : null,
    atendido: !!row.atendido,
    created_at: row.created_at || null,
  };
}

async function userCanManageLeads(userId) {
  const [rows] = await pool.query(
    `
    SELECT
      u.id,
      r.nome AS role_nome,
      p.protocol
    FROM users u
    INNER JOIN roles r ON r.id = u.role_id
    LEFT JOIN profiles p ON p.id = u.id
    WHERE u.id = ?
    LIMIT 1
    `,
    [userId]
  );

  const user = rows[0];
  if (!user) return false;

  const roleNome = String(user.role_nome || "").toLowerCase();
  return roleNome === "admin" || roleNome === "administrador" || Number(user.protocol) === 1;
}

export async function listAdminLeads(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId || !(await userCanManageLeads(userId))) {
      return res.status(403).json({
        ok: false,
        error: "FORBIDDEN",
      });
    }

    const pageRaw = Number(req.query?.page || 1);
    const limitRaw = Number(req.query?.limit || 25);

    const page = Number.isInteger(pageRaw) ? Math.max(pageRaw, 1) : 1;
    const limit = Number.isInteger(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 500)
      : 25;
    const offset = (page - 1) * limit;

    const search = trimText(req.query?.search);
    const servico = trimText(req.query?.servico).toLowerCase();
    const atendido = parseBooleanFilter(req.query?.atendido);

    const where = [];
    const params = [];

    if (search) {
      where.push(`(
        nome LIKE ?
        OR cpf LIKE ?
        OR whatsapp LIKE ?
      )`);
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    if (servico) {
      where.push(`servico = ?`);
      params.push(servico);
    }

    if (atendido !== null) {
      where.push(`atendido = ?`);
      params.push(atendido);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [countRows] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM leads
      ${whereSql}
      `,
      params
    );

    const total = Number(countRows?.[0]?.total || 0);

    const [rows] = await pool.query(
      `
      SELECT
        id,
        nome,
        cpf,
        whatsapp,
        servico,
        dados,
        atendido,
        created_at
      FROM leads
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    return res.json({
      ok: true,
      total,
      page,
      limit,
      leads: rows.map(normalizeLeadRow),
    });
  } catch (error) {
    console.error("Erro ao listar leads admin:", error);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}

export async function updateLeadAtendido(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId || !(await userCanManageLeads(userId))) {
      return res.status(403).json({
        ok: false,
        error: "FORBIDDEN",
      });
    }

    const id = trimText(req.body?.id);
    const atendidoRaw = req.body?.atendido;

    if (!id) {
      return res.status(400).json({
        ok: false,
        error: "ID do lead é obrigatório.",
      });
    }

    const atendido = atendidoRaw === true || atendidoRaw === 1 || atendidoRaw === "true" ? 1 : 0;

    const [result] = await pool.query(
      `
      UPDATE leads
      SET atendido = ?
      WHERE id = ?
      `,
      [atendido, id]
    );

    if (!result?.affectedRows) {
      return res.status(404).json({
        ok: false,
        error: "LEAD_NOT_FOUND",
      });
    }

    return res.json({
      ok: true,
      message: "Lead atualizado com sucesso.",
    });
  } catch (error) {
    console.error("Erro ao atualizar lead:", error);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}