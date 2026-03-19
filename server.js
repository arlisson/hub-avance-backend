import { pool } from "./src/config/db.js";

app.get("/api/health", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");
    res.json({ ok: true, db: rows[0].ok === 1 });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});