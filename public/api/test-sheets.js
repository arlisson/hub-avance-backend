//teste de api
export default async function handler(req, res) {
  try {
    const scriptUrl = process.env.GS_WEBAPP_URL;
    const secret = process.env.HUB_SECRET;

    if (!scriptUrl || !secret) {
      return res.status(500).json({ ok: false, error: "missing_env" });
    }

    const payload = {
      action: "upsert_license",
      secret,
      email: `teste_${Date.now()}@gmail.com`,
      status: "ACTIVE",
      max_devices: 1,
      created_at: new Date().toISOString(),
    };

    const r = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    return res.status(200).json({
      ok: true,
      status: r.status,
      raw: text,
      parsed: json,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error", detail: String(e) });
  }
}