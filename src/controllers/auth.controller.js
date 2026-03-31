// controllers/auth.controller.js
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
import crypto from "crypto";
import nodemailer from "nodemailer";

async function registrarLicencaNoSheets(email) {
  const url = process.env.GS_WEBAPP_URL;
  const secret = process.env.HUB_SECRET;

  const payload = {
    action: "upsert_license",
    secret,
    email,
    status: "ACTIVE",
    max_devices: 1,
    created_at: new Date().toISOString()
  };

  console.log("[SHEETS] payload:", {
    ...payload,
    secret: secret ? `${secret.slice(0, 4)}...${secret.slice(-4)}` : "(vazio)"
  });

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const text = await resp.text();
  console.log("[SHEETS] status:", resp.status);
  console.log("[SHEETS] raw response:", text);

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`SHEETS_INVALID_JSON:${text}`);
  }

  if (!resp.ok || !data?.ok) {
    throw new Error(`SHEETS_FAILED:${JSON.stringify(data)}`);
  }

  return data;
}

export async function changePassword(req, res) {
  try {
    const userId = req.user?.id;
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: "Não autenticado."
      });
    }

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        ok: false,
        error: "Senha atual e nova senha são obrigatórias."
      });
    }

    if (newPassword.length < 8 || !/\d/.test(newPassword)) {
      return res.status(400).json({
        ok: false,
        error: "A nova senha deve ter no mínimo 8 caracteres e pelo menos 1 número."
      });
    }

    const [rows] = await pool.query(
      `
      SELECT id, password_hash, ativo
      FROM users
      WHERE id = ?
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

    if (!user.ativo) {
      return res.status(403).json({
        ok: false,
        error: "Usuário desativado."
      });
    }

    if (!user.password_hash) {
      return res.status(500).json({
        ok: false,
        error: "Usuário sem senha cadastrada."
      });
    }

    const passwordOk = await bcrypt.compare(currentPassword, user.password_hash);

    if (!passwordOk) {
      return res.status(401).json({
        ok: false,
        error: "A senha atual está incorreta."
      });
    }

    const samePassword = await bcrypt.compare(newPassword, user.password_hash);

    if (samePassword) {
      return res.status(400).json({
        ok: false,
        error: "A nova senha deve ser diferente da senha atual."
      });
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `
      UPDATE users
      SET password_hash = ?
      WHERE id = ?
      `,
      [newHash, userId]
    );

    return res.json({
      ok: true,
      message: "Senha atualizada com sucesso."
    });
  } catch (error) {
    console.error("Erro em /api/change-password:", error);
    return res.status(500).json({
      ok: false,
      error: "Erro interno. Tente novamente."
    });
  }
}

function gerarTokenResetSenha() {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

  return { token, tokenHash, expiresAt };
}

async function enviarEmailResetSenha(email, token) {
  const transporter = getMailer();

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    throw new Error("APP_URL não configurado.");
  }

  const resetUrl = `${appUrl}/reset/reset.html?token=${encodeURIComponent(token)}`;

  await transporter.sendMail({
    from: `"AVANCE" <${process.env.SMTP_USER}>`,
    to: email,
    subject: "Redefinição de senha",
    html: `
      <div style="margin:0;padding:0;background:#f4f7fb;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;padding:24px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.08);">
                <tr>
                  <td align="center" style="padding:32px 24px 16px 24px;">
                    <img
                      src="https://avancevip.net.br/img/avanceVip.png"
                      alt="AVANCE"
                      style="max-width:180px;height:auto;display:block;"
                    />
                  </td>
                </tr>

                <tr>
                  <td style="padding:8px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
                    <p style="margin:0 0 20px 0;font-size:24px;line-height:1.4;font-weight:700;">
                      Olá 👋
                    </p>

                    <p style="margin:0 0 16px 0;font-size:16px;line-height:1.7;color:#374151;">
                      Recebemos uma solicitação para redefinir sua senha na <strong>AVANCE</strong>.
                    </p>

                    <p style="margin:0 0 28px 0;font-size:16px;line-height:1.7;color:#374151;">
                      Para cadastrar uma nova senha e recuperar o acesso à sua conta, clique no botão abaixo:
                    </p>
                  </td>
                </tr>

                <tr>
                  <td align="center" style="padding:0 32px 8px 32px;">
                    <a
                      href="${resetUrl}"
                      style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;padding:16px 28px;border-radius:999px;"
                    >
                      🔐 REDEFINIR MINHA SENHA
                    </a>
                  </td>
                </tr>

                <tr>
                  <td style="padding:24px 32px 32px 32px;font-family:Arial,Helvetica,sans-serif;color:#6b7280;">
                    <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;">
                      ⏰ Este link é válido por 1 hora por segurança.
                    </p>

                    <p style="margin:0;font-size:14px;line-height:1.6;color:#9ca3af;">
                      Se você não solicitou a redefinição de senha, pode ignorar este e-mail.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `,
    text: `Olá!

  Recebemos uma solicitação para redefinir sua senha na AVANCE.

  Para cadastrar uma nova senha, acesse o link abaixo:
  ${resetUrl}

  Este link é válido por 1 hora por segurança.

  Se você não solicitou a redefinição de senha, pode ignorar este e-mail.`,
  });
}

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
    auth: {
      user,
      pass
    }
  });
}

function gerarTokenVerificacao() {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  return { token, tokenHash, expiresAt };
}

async function enviarEmailVerificacao(email, token, name) {
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
      <div style="margin:0;padding:0;background:#f4f7fb;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;padding:24px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.08);">
                <tr>
                  <td align="center" style="padding:32px 24px 16px 24px;">
                    <img
                      src="https://avancevip.net.br/img/avanceVip.png"
                      alt="AVANCE"
                      style="max-width:180px;height:auto;display:block;"
                    />
                  </td>
                </tr>

                <tr>
                  <td style="padding:8px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
                    <p style="margin:0 0 20px 0;font-size:24px;line-height:1.4;font-weight:700;">
                      Olá, ${name} 👋
                    </p>

                    <p style="margin:0 0 16px 0;font-size:16px;line-height:1.7;color:#374151;">
                      Bem-vindo à <strong>AVANCE</strong>! Estamos felizes em ter você com a gente.
                    </p>

                    <p style="margin:0 0 28px 0;font-size:16px;line-height:1.7;color:#374151;">
                      Para começar a aproveitar tudo que criamos pra aumentar sua produtividade
                      e facilitar seu dia a dia, confirme seu e-mail:
                    </p>
                  </td>
                </tr>

                <tr>
                  <td align="center" style="padding:0 32px 8px 32px;">
                    <a
                      href="${verifyUrl}"
                      style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;padding:16px 28px;border-radius:999px;"
                    >
                      🎯 CONFIRMAR MEU E-MAIL
                    </a>
                  </td>
                </tr>

                <tr>
                  <td style="padding:24px 32px 32px 32px;font-family:Arial,Helvetica,sans-serif;color:#6b7280;">
                    <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;">
                      ⏰ Este link é válido por 24 horas por segurança.
                    </p>

                    <p style="margin:0;font-size:14px;line-height:1.6;color:#9ca3af;">
                      Se você não criou uma conta, pode ignorar este e-mail.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `
  });
}

export async function register(req, res) {
  const conn = await pool.getConnection();
  let committed = false;

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

    await registrarLicencaNoSheets(emailNorm);
    await conn.commit();
    committed = true;

    try {
      await enviarEmailVerificacao(emailNorm, token, name);

      return res.status(201).json({
        ok: true,
        message: "Cadastro realizado. Verifique seu e-mail para liberar o login."
      });
    } catch (mailError) {
      console.error("Erro ao enviar e-mail de verificação:", mailError);

      return res.status(201).json({
        ok: true,
        emailSent: false,
        message:
          "Cadastro realizado, mas não foi possível enviar o e-mail de confirmação agora."
      });
    }
  } catch (error) {
    if (!committed) {
      await conn.rollback();
    }

    console.error("Erro em /api/register:", error);

    if (String(error.message || "").startsWith("SHEETS_FAILED")) {
      return res.status(502).json({
        ok: false,
        error: String(error.message)
      });
    }

    if (error.message === "SHEETS_FAILED") {
      return res.status(502).json({
        ok: false,
        error: "SHEETS_FAILED",
        detail: "Falha ao registrar licença no Apps Script"
      });
    }

    if (error.message === "SHEETS_NOT_CONFIGURED") {
      return res.status(500).json({
        ok: false,
        error: "SHEETS_NOT_CONFIGURED",
        detail: "Planilha não configurada"
      });
    }

    return res.status(500).json({
      ok: false,
      error: "Erro interno. Tente novamente."
    });
  } finally {
    conn.release();
  }
}

export async function testSmtp(req, res) {
  try {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 465);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    const transporter = getMailer();
    await transporter.verify();

    return res.status(200).send(`
      <html lang="pt-BR">
        <head>
          <meta charset="UTF-8" />
          <title>Teste SMTP</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 24px;
              background: #f7f7f7;
              color: #111;
            }
            .card {
              max-width: 720px;
              margin: 0 auto;
              background: #fff;
              padding: 24px;
              border-radius: 12px;
              box-shadow: 0 2px 12px rgba(0,0,0,.08);
            }
            .ok { color: #0a7a2f; }
            code {
              background: #f1f1f1;
              padding: 2px 6px;
              border-radius: 6px;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1 class="ok">SMTP autenticado com sucesso</h1>
            <p><strong>Host:</strong> <code>${host || "(vazio)"}</code></p>
            <p><strong>Porta:</strong> <code>${port}</code></p>
            <p><strong>Usuário:</strong> <code>${user || "(vazio)"}</code></p>
            <p><strong>Senha carregada:</strong> <code>${pass ? "SIM" : "NÃO"}</code></p>
            <p>Se esta tela abriu com sucesso, a autenticação SMTP básica está funcionando.</p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Erro em /api/test-smtp:", error);

    return res.status(500).send(`
      <html lang="pt-BR">
        <head>
          <meta charset="UTF-8" />
          <title>Erro SMTP</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 24px;
              background: #f7f7f7;
              color: #111;
            }
            .card {
              max-width: 720px;
              margin: 0 auto;
              background: #fff;
              padding: 24px;
              border-radius: 12px;
              box-shadow: 0 2px 12px rgba(0,0,0,.08);
            }
            .erro { color: #b42318; }
            pre {
              white-space: pre-wrap;
              word-break: break-word;
              background: #f8f8f8;
              padding: 12px;
              border-radius: 8px;
              border: 1px solid #e5e5e5;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1 class="erro">Falha ao autenticar no SMTP</h1>
            <pre>${String(error?.stack || error?.message || error)}</pre>
          </div>
        </body>
      </html>
    `);
  }
}

export async function testEmail(req, res) {
  try {
    const transporter = getMailer();

    const to = String(req.query?.to || process.env.SMTP_USER || "").trim();
    if (!to) {
      return res.status(400).send(`
        <html lang="pt-BR">
          <head>
            <meta charset="UTF-8" />
            <title>Teste de envio</title>
          </head>
          <body style="font-family: Arial, sans-serif; padding: 24px;">
            <h1>Destinatário não informado</h1>
            <p>Use <code>?to=seuemail@dominio.com</code> na URL ou configure <code>SMTP_USER</code>.</p>
          </body>
        </html>
      `);
    }

    const info = await transporter.sendMail({
      from: `"AVANCE" <${process.env.SMTP_USER}>`,
      to,
      subject: "Teste SMTP AVANCE",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h2>Teste de envio SMTP</h2>
          <p>Este é um e-mail de teste enviado pela rota <strong>/api/test-email</strong>.</p>
          <p><strong>Remetente:</strong> ${process.env.SMTP_USER}</p>
          <p><strong>Destinatário:</strong> ${to}</p>
          <p><strong>Data:</strong> ${new Date().toLocaleString("pt-BR")}</p>
        </div>
      `,
    });

    return res.status(200).send(`
      <html lang="pt-BR">
        <head>
          <meta charset="UTF-8" />
          <title>Teste de envio</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 24px;
              background: #f7f7f7;
              color: #111;
            }
            .card {
              max-width: 720px;
              margin: 0 auto;
              background: #fff;
              padding: 24px;
              border-radius: 12px;
              box-shadow: 0 2px 12px rgba(0,0,0,.08);
            }
            .ok { color: #0a7a2f; }
            code {
              background: #f1f1f1;
              padding: 2px 6px;
              border-radius: 6px;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1 class="ok">E-mail de teste enviado com sucesso</h1>
            <p><strong>Para:</strong> <code>${to}</code></p>
            <p><strong>Message ID:</strong> <code>${info?.messageId || "(não informado)"}</code></p>
            <p>Verifique a caixa de entrada e também o spam.</p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Erro em /api/test-email:", error);

    return res.status(500).send(`
      <html lang="pt-BR">
        <head>
          <meta charset="UTF-8" />
          <title>Erro no envio</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 24px;
              background: #f7f7f7;
              color: #111;
            }
            .card {
              max-width: 720px;
              margin: 0 auto;
              background: #fff;
              padding: 24px;
              border-radius: 12px;
              box-shadow: 0 2px 12px rgba(0,0,0,.08);
            }
            .erro { color: #b42318; }
            pre {
              white-space: pre-wrap;
              word-break: break-word;
              background: #f8f8f8;
              padding: 12px;
              border-radius: 8px;
              border: 1px solid #e5e5e5;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1 class="erro">Falha ao enviar e-mail de teste</h1>
            <pre>${String(error?.stack || error?.message || error)}</pre>
          </div>
        </body>
      </html>
    `);
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

    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 12 * 60 * 60 * 1000,
    });

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
      error: "Erro interno. Tente novamente."
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
      error: "Erro interno. Tente novamente."
    });
  }
}

export async function logout(req, res) {
  res.clearCookie("auth_token", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
  });

  return res.json({
    ok: true,
    message: "Logout realizado com sucesso."
  });
}

export async function forgotPassword(req, res) {
  const conn = await pool.getConnection();
  let startedTransaction = false;

  try {
    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "E-mail é obrigatório."
      });
    }

    const [rows] = await conn.query(
      `
      SELECT id, email, ativo
      FROM users
      WHERE email = ?
      LIMIT 1
      `,
      [email]
    );

    const user = rows[0];

    if (!user || !user.ativo) {
      return res.json({
        ok: true,
        message:
          "Se esse e-mail existir e estiver cadastrado no sistema, enviaremos as instruções de redefinição."
      });
    }

    const [recentRows] = await conn.query(
      `SELECT COUNT(*) AS total FROM password_resets
       WHERE user_id = ? AND expires_at > NOW()`,
      [user.id]
    );

    if (Number(recentRows[0]?.total) >= 2) {
      return res.json({
        ok: true,
        message:
          "Se esse e-mail existir e estiver cadastrado no sistema, enviaremos as instruções de redefinição."
      });
    }

    const { token, tokenHash, expiresAt } = gerarTokenResetSenha();

    await conn.beginTransaction();
    startedTransaction = true;

    await conn.query(
      `
      INSERT INTO password_resets (
        user_id,
        token_hash,
        expires_at
      ) VALUES (?, ?, ?)
      `,
      [user.id, tokenHash, expiresAt]
    );

    await conn.commit();
    startedTransaction = false;

    try {
      await enviarEmailResetSenha(user.email, token);
    } catch (mailError) {
      console.error("Erro ao enviar e-mail de reset:", mailError);
    }

    return res.json({
      ok: true,
      message:
        "Se esse e-mail existir e estiver cadastrado no sistema, enviaremos as instruções de redefinição."
    });
  } catch (error) {
    if (startedTransaction) {
      await conn.rollback();
    }

    console.error("Erro em /api/forgot-password:", error);

    return res.status(500).json({
      ok: false,
      error: "Erro interno. Tente novamente."
    });
  } finally {
    conn.release();
  }
}

export async function resetPassword(req, res) {
  const conn = await pool.getConnection();
  let startedTransaction = false;

  try {
    const token = String(req.body?.token || "").trim();
    const password = String(req.body?.password || "");

    if (!token || !password) {
      return res.status(400).json({
        ok: false,
        error: "Token e senha são obrigatórios."
      });
    }

    if (password.length < 8 || !/\d/.test(password)) {
      return res.status(400).json({
        ok: false,
        error: "A senha deve ter no mínimo 8 caracteres e pelo menos 1 número."
      });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const [rows] = await conn.query(
      `
      SELECT id, user_id, expires_at, used_at
      FROM password_resets
      WHERE token_hash = ?
      LIMIT 1
      `,
      [tokenHash]
    );

    const resetRow = rows[0];

    if (!resetRow) {
      return res.status(400).json({
        ok: false,
        error: "Link inválido."
      });
    }

    if (resetRow.used_at) {
      return res.status(400).json({
        ok: false,
        error: "Este link já foi utilizado."
      });
    }

    if (new Date(resetRow.expires_at) < new Date()) {
      return res.status(400).json({
        ok: false,
        error: "Este link expirou."
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await conn.beginTransaction();
    startedTransaction = true;

    await conn.query(
      `UPDATE users SET password_hash = ? WHERE id = ?`,
      [passwordHash, resetRow.user_id]
    );

    await conn.query(
      `UPDATE password_resets SET used_at = NOW() WHERE id = ?`,
      [resetRow.id]
    );

    await conn.query(
      `
      UPDATE password_resets
      SET used_at = NOW()
      WHERE user_id = ?
        AND used_at IS NULL
        AND id <> ?
      `,
      [resetRow.user_id, resetRow.id]
    );

    await conn.commit();
    startedTransaction = false;

    return res.json({
      ok: true,
      message: "Senha redefinida com sucesso."
    });
  } catch (error) {
    if (startedTransaction) {
      await conn.rollback();
    }

    console.error("Erro em /api/reset-password:", error);

    return res.status(500).json({
      ok: false,
      error: "Erro interno. Tente novamente."
    });
  } finally {
    conn.release();
  }
}

export async function debugSmtpEnv(req, res) {
  try {
    const host = String(process.env.SMTP_HOST || "").trim();
    const port = String(process.env.SMTP_PORT || "").trim();
    const user = String(process.env.SMTP_USER || "").trim();
    const pass = String(process.env.SMTP_PASS || "");

    return res.status(200).json({
      ok: true,
      smtp: {
        host: host || null,
        port: port || null,
        user: user || null,
        hasPass: pass.length > 0,
        passLength: pass.length,
        passStartsWith: pass ? pass.slice(0, 2) : null,
        passEndsWith: pass ? pass.slice(-2) : null,
        hasLeadingSpace: pass !== pass.trimStart(),
        hasTrailingSpace: pass !== pass.trimEnd(),
      },
      hints: [
        "Confira se SMTP_USER é exatamente o email completo da caixa.",
        "Confira se SMTP_PASS não tem espaço no começo ou no fim.",
        "Se passLength estiver 0, a senha não está chegando ao Node.",
      ],
    });
  } catch (error) {
    console.error("Erro em /api/debug-smtp-env:", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || String(error),
    });
  }
}