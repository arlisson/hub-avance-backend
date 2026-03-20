import { pool } from "../config/db.js";

function getAppTargets() {
  return {
    desktop: process.env.TARGET_DESKTOP_URL,
    agent: process.env.TARGET_AGENT_URL,
    protocol: process.env.TARGET_PROTOCOL_URL,
  };
}

function normalizeAppUsage(raw) {
  if (!raw) return {};

  if (typeof raw === "object") return raw;

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function registerAppUsage(req, res) {
  const conn = await pool.getConnection();
  let startedTransaction = false;

  try {
    const app = String(req.body?.app || "").trim();
    const metric = String(req.body?.metric || "access").trim().toLowerCase();
    const userId = req.user?.id;

    if (!app) {
      return res.status(400).json({
        ok: false,
        error: "missing_app",
      });
    }

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: "missing_user",
      });
    }

    if (!["access", "download"].includes(metric)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_metric",
      });
    }

    const targets = getAppTargets();
    const target = targets[app];

    if (!target) {
      return res.status(400).json({
        ok: false,
        error: "unknown_app",
      });
    }

    await conn.beginTransaction();
    startedTransaction = true;

    await conn.query(
      `
      INSERT INTO app_access (nome, acessos)
      VALUES (?, 1)
      ON DUPLICATE KEY UPDATE
        acessos = acessos + 1
      `,
      [app]
    );

    const [profileRows] = await conn.query(
      `
      SELECT app_usage
      FROM profiles
      WHERE id = ?
      LIMIT 1
      `,
      [userId]
    );

    if (!profileRows.length) {
      await conn.rollback();
      return res.status(404).json({
        ok: false,
        error: "profile_not_found",
      });
    }

    const usage = normalizeAppUsage(profileRows[0].app_usage);

    if (!usage[app] || typeof usage[app] !== "object" || Array.isArray(usage[app])) {
      usage[app] = {};
    }

    usage[app][metric] = Number(usage[app][metric] || 0) + 1;

    await conn.query(
      `
      UPDATE profiles
      SET app_usage = ?
      WHERE id = ?
      `,
      [JSON.stringify(usage), userId]
    );

    await conn.commit();
    startedTransaction = false;

    return res.json({
      ok: true,
      target,
    });
  } catch (error) {
    if (startedTransaction) {
      await conn.rollback();
    }

    console.error("Erro em /api/contador:", error);

    return res.status(500).json({
      ok: false,
      error: "server_error",
    });
  } finally {
    conn.release();
  }
}