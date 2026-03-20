// controllers/auth.controller.js
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
import crypto from "crypto";
import nodemailer from "nodemailer";

function getMailer() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !port || !user || !pass) {
    throw new Error("SMTP não configurado.");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

function gerarTokenVerificacao() {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  return { token, tokenHash, expiresAt };
}

async function enviarEmailVerificacao(email, token) {
  const transporter = getMailer();

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    throw new Error("APP_URL não configurado.");
  }

  const verifyUrl = `${appUrl}/api/verify-email?token=${encodeURIComponent(token)}`;

  await transporter.sendMail({
    from: `"AVANCE" <${process.env.SMTP_USER}>`,
    to: email,
    subject: "Confirme seu cadastro",
    html: `
      <p>Olá,</p>
      <p>Seu cadastro foi criado com sucesso.</p>
      <p>Para liberar o login, confirme seu e-mail clicando no link abaixo:</p>
      <p><a href="${verifyUrl}">Confirmar e-mail</a></p>
      <p>Este link expira em 24 horas.</p>
    `
  });
}

export async function register(req, res) {
  const conn = await pool.getConnection();

  try {
    const {
      name,
      email,
      password,
      cpf_cnpj,
      whatsapp,
      cep,
      cidade,
      estado,
      has_mobile_service,
      contract_type,
      operator,
      active_lines
    } = req.body || {};

    const emailNorm = String(email || "").trim().toLowerCase();
    const passwordNorm = String(password || "");
    const cpfCnpjNorm = String(cpf_cnpj || "").trim();

    if (!name || !emailNorm || !passwordNorm || !cpfCnpjNorm) {
      return res.status(400).json({
        ok: false,
        error: "Campos obrigatórios ausentes."
      });
    }

    const [emailRows] = await conn.query(
      `SELECT id FROM users WHERE email = ? LIMIT 1`,
      [emailNorm]
    );

    if (emailRows.length) {
      return res.status(409).json({
        ok: false,
        error: "EMAIL_EXISTS"
      });
    }

    const [docRows] = await conn.query(
      `SELECT id FROM profiles WHERE cpf_cnpj = ? LIMIT 1`,
      [cpfCnpjNorm]
    );

    if (docRows.length) {
      return res.status(409).json({
        ok: false,
        error: "DOCUMENT_EXISTS"
      });
    }

    const [roleRows] = await conn.query(
      `SELECT id FROM roles WHERE nome = ? LIMIT 1`,
      ["user"]
    );

    if (!roleRows.length) {
      return res.status(500).json({
        ok: false,
        error: "Role padrão não encontrada."
      });
    }

    const roleId = roleRows[0].id;
    const passwordHash = await bcrypt.hash(passwordNorm, 10);
    const { token, tokenHash, expiresAt } = gerarTokenVerificacao();

    const userId = crypto.randomUUID();

    const regiaoJson =
      cep || cidade || estado
        ? JSON.stringify({
            cep: cep || null,
            cidade: cidade || null,
            estado: estado || null
          })
        : null;

    const appUsageJson = JSON.stringify({});

    await conn.beginTransaction();

    await conn.query(
      `
      INSERT INTO users (
        id,
        email,
        password_hash,
        ativo,
        role_id,
        email_confirmado
      ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      [userId, emailNorm, passwordHash, 1, roleId, 0]
    );

    await conn.query(
      `
      INSERT INTO profiles (
        id,
        email,
        cpf_cnpj,
        nome,
        whatsapp,
        has_mobile_service,
        contract_type,
        operador,
        active_lines,
        protocol,
        cliente_avance,
        app_usage,
        regiao,
        cep
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        userId,
        emailNorm,
        cpfCnpjNorm,
        name,
        whatsapp || null,
        has_mobile_service === true ? 1 : 0,
        contract_type || null,
        operator || null,
        active_lines ?? null,
        0,
        1,
        appUsageJson,
        regiaoJson,
        cep || null
      ]
    );

    await conn.query(
      `
      INSERT INTO email_verifications (
        user_id,
        token_hash,
        expires_at
      ) VALUES (?, ?, ?)
      `,
      [userId, tokenHash, expiresAt]
    );

    await conn.commit();

    await enviarEmailVerificacao(emailNorm, token);

    return res.status(201).json({
      ok: true,
      message: "Cadastro realizado. Verifique seu e-mail para liberar o login."
    });
  } catch (error) {
    await conn.rollback();
    console.error("Erro em /api/register:", error);

    return res.status(500).json({
      ok: false,
      error: error.message,
      stack: error.stack
    });
  } finally {
    conn.release();
  }
}

export async function verifyEmail(req, res) {
  const conn = await pool.getConnection();

  try {
    const token = String(req.query?.token || "").trim();

    if (!token) {
      return res.status(400).send("Token inválido.");
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const [rows] = await conn.query(
      `
      SELECT id, user_id, expires_at, used_at
      FROM email_verifications
      WHERE token_hash = ?
      LIMIT 1
      `,
      [tokenHash]
    );

    const row = rows[0];

    if (!row) {
      return res.status(400).send("Link inválido.");
    }

    if (row.used_at) {
      return res.status(400).send("Este link já foi utilizado.");
    }

    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).send("Este link expirou.");
    }

    await conn.beginTransaction();

    await conn.query(
      `UPDATE users SET email_confirmado = 1 WHERE id = ?`,
      [row.user_id]
    );

    await conn.query(
      `UPDATE email_verifications SET used_at = NOW() WHERE id = ?`,
      [row.id]
    );

    await conn.commit();

    return res.redirect("/login/login.html?verified=1");
  } catch (error) {
    await conn.rollback();
    console.error("Erro em /api/verify-email:", error);
    return res.status(500).send("Erro ao verificar e-mail.");
  } finally {
    conn.release();
  }
}

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
        u.email_confirmado,
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

    console.log("Email recebido:", email);
    console.log("JWT secret existe:", Boolean(process.env.JWT_SECRET));
    console.log("Rows retornadas:", rows);

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Credenciais inválidas."
      });
    }

    if (!user.password_hash) {
      return res.status(500).json({
        ok: false,
        error: "Usuário sem password_hash."
      });
    }

    if (!user.ativo) {
      return res.status(403).json({
        ok: false,
        error: "Usuário desativado."
      });
    }

    if (!user.email_confirmado) {
      return res.status(403).json({
        ok: false,
        error: "Confirme seu e-mail antes de fazer login."
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
        cliente_avance:
          user.cliente_avance === null ? null : Boolean(user.cliente_avance)
      }
    });
  } catch (error) {
    console.error("Erro em /api/login:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
      stack: error.stack
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
        cliente_avance:
          user.cliente_avance === null ? null : Boolean(user.cliente_avance)
      }
    });
  } catch (error) {
    console.error("Erro em /api/me:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
      stack: error.stack
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
      error: error.message,
      stack: error.stack
    });
  }
}