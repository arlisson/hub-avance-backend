export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return res.status(401).json({ error: "missing_token" });
    }

    const {
      id,
      name,
      email,
      cpf,
      whatsapp,
      contract_type,
      operator,
      active_lines,
      protocol,
      cliente_avance,
    
    } = req.body || {};

    if (!id) {
      return res.status(400).json({ error: "missing_id" });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const ANON_KEY = process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
      return res.status(500).json({ error: "missing_env" });
    }

    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    });

    const authUser = await userResp.json();

    if (!userResp.ok || !authUser?.id) {
      return res.status(401).json({ error: "invalid_token" });
    }

    const adminHeaders = {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    };

    const profileResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${authUser.id}&select=protocol`,
      { headers: adminHeaders }
    );

    const profileData = await profileResp.json();
    const profile = Array.isArray(profileData) ? profileData[0] : null;

    if (!profile?.protocol) {
      return res.status(403).json({ error: "forbidden" });
    }

    const patchResp = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        ...adminHeaders,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        name: name || null,
        email: email || null,
        cpf: cpf || null,
        whatsapp: whatsapp || null,
        contract_type: contract_type || null,
        operator: operator || null,
        active_lines:
          active_lines === null || active_lines === "" || Number.isNaN(Number(active_lines))
            ? null
            : Number(active_lines),
        protocol: !!protocol,
        cliente_avance: !!cliente_avance,        
      }),
    });

    const updated = await patchResp.json();

    if (!patchResp.ok) {
      return res.status(500).json({
        error: "update_failed",
        detail: updated,
      });
    }

    return res.status(200).json({
      ok: true,
      user: Array.isArray(updated) ? updated[0] : null,
    });
  } catch (e) {
    console.error("admin update user error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}