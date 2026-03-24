import { pool } from "../config/db.js";

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