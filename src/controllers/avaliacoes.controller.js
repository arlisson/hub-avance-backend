import { pool } from "../config/db.js";

async function isAdmin(userId) {
  const [rows] = await pool.query(
    `SELECT r.nome AS role_nome, p.protocol
     FROM users u
     INNER JOIN roles r ON r.id = u.role_id
     LEFT JOIN profiles p ON p.id = u.id
     WHERE u.id = ? LIMIT 1`,
    [userId]
  );
  const user = rows[0];
  if (!user) return false;
  const role = String(user.role_nome || "").toLowerCase();
  return role === "admin" || role === "administrador" || Number(user.protocol) === 1;
}

export async function criarAvaliacaoSite(req, res) {
  const userId = req.user?.id;
  if (!userId || !(await isAdmin(userId))) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  const { cliente_id, nota, comentario } = req.body;

  if (!cliente_id) {
    return res.status(400).json({ ok: false, error: "cliente_id é obrigatório." });
  }
  if (!nota || nota < 1 || nota > 5) {
    return res.status(400).json({ ok: false, error: "Nota deve ser entre 1 e 5." });
  }

  try {
    await pool.query(
      `INSERT INTO avaliacoes_site (cliente_id, nota, comentario, data_criacao)
       VALUES (?, ?, ?, NOW())`,
      [cliente_id, nota, comentario || null]
    );
    return res.json({ ok: true });
  } catch (error) {
    console.error("Erro ao salvar avaliação:", error);
    return res.status(500).json({ ok: false, error: "INTERNAL_SERVER_ERROR" });
  }
}

function normalizeAvaliacaoRow(row) {
  return {
    id: row.id,
    Nome: row.nome || "",
    TextoComentario: row.texto_comentario || "",
    Cargo: row.cargo || "",
    Iniciais: row.iniciais || "",
    created_at: row.created_at || null,
  };
}

export async function listAvaliacoes(req, res) {
  try {
    const limitRaw = Number(req.query?.limit || 30);
    const limit = Number.isInteger(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 100)
      : 30;

    const [rows] = await pool.query(
      `
      SELECT
        id,
        nome,
        texto_comentario,
        cargo,
        iniciais,
        created_at
      FROM avaliacoes
      ORDER BY created_at DESC, id DESC
      LIMIT ?
      `,
      [limit]
    );

    return res.json({
      ok: true,
      avaliacoes: rows.map(normalizeAvaliacaoRow),
    });
  } catch (error) {
    console.error("Erro ao listar avaliações:", error);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}