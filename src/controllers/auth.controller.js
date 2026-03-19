import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET não configurado.");
  }
  return secret;
}

function gerarToken(payload) {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: "12h"
  });
}

export async function login(req, res) {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        error: "E-mail e senha são obrigatórios."
      });
    }

    const [rows] = await pool.query(
      `
      SELECT
        u.id,
        u.email,
        u.password_hash,
        u.ativo,
        r.nome AS role,
        p.nome,
        p.protocol,
        p.cliente_avance
      FROM users u
      INNER JOIN roles r ON r.id = u.role_id
      LEFT JOIN profiles p ON p.id = u.id
      WHERE u.email = ?
      LIMIT 1
      `,
      [email]
    );

    const user = rows[0];

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Credenciais inválidas."
      });
    }

    if (!user.ativo) {
      return res.status(403).json({
        ok: false,
        error: "Usuário desativado."
      });
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);

    if (!passwordOk) {
      return res.status(401).json({
        ok: false,
        error: "Credenciais inválidas."
      });
    }

    const token = gerarToken({
      sub: user.id,
      email: user.email,
      role: user.role
    });

    await pool.query(
      `UPDATE users SET ultimo_login_em = NOW() WHERE id = ?`,
      [user.id]
    );

    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        nome: user.nome || null,
        role: user.role,
        protocol: Boolean(user.protocol),
        cliente_avance: user.cliente_avance === null ? null : Boolean(user.cliente_avance)
      }
    });
  } catch (error) {
    console.error("Erro em /api/login:", error);
    return res.status(500).json({
      ok: false,
      error: "Erro interno ao realizar login."
    });
  }
}

export async function me(req, res) {
  try {
    const userId = req.user?.id;

    const [rows] = await pool.query(
      `
      SELECT
        u.id,
        u.email,
        u.ativo,
        r.nome AS role,
        p.nome,
        p.protocol,
        p.cliente_avance
      FROM users u
      INNER JOIN roles r ON r.id = u.role_id
      LEFT JOIN profiles p ON p.id = u.id
      WHERE u.id = ?
      LIMIT 1
      `,
      [userId]
    );

    const user = rows[0];

    if (!user) {
      return res.status(404).json({
        ok: false,
        error: "Usuário não encontrado."
      });
    }

    return res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        nome: user.nome || null,
        ativo: Boolean(user.ativo),
        role: user.role,
        protocol: Boolean(user.protocol),
        cliente_avance: user.cliente_avance === null ? null : Boolean(user.cliente_avance)
      }
    });
  } catch (error) {
    console.error("Erro em /api/me:", error);
    return res.status(500).json({
      ok: false,
      error: "Erro interno ao buscar sessão."
    });
  }
}

export async function logout(req, res) {
  return res.json({
    ok: true,
    message: "Logout realizado com sucesso."
  });
}

export async function forgotPassword(req, res) {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "E-mail é obrigatório."
      });
    }

    return res.json({
      ok: true,
      message:
        "Se esse e-mail existir e estiver cadastrado no sistema, enviaremos as instruções de redefinição."
    });
  } catch (error) {
    console.error("Erro em /api/forgot-password:", error);
    return res.status(500).json({
      ok: false,
      error: "Erro interno ao solicitar redefinição."
    });
  }
}