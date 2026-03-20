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

    const { id } = req.body || {};

    if (!id) {
      return res.status(400).json({ error: "missing_id" });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const ANON_KEY = process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
      return res.status(500).json({
        error: "missing_env",
        has_url: !!SUPABASE_URL,
        has_service_role: !!SERVICE_ROLE,
        has_anon_key: !!ANON_KEY,
      });
    }

    // valida usuário logado pelo token recebido do frontend
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    });

    const authUser = await userResp.json().catch(() => null);

    if (!userResp.ok || !authUser?.id) {
      return res.status(401).json({
        error: "invalid_token",
        detail: authUser,
      });
    }

    const adminHeaders = {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    };

    // verifica se quem está excluindo tem permissão protocol
    const profileResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}&select=protocol`,
      { headers: adminHeaders }
    );

    const profileData = await profileResp.json().catch(() => null);
    const profile = Array.isArray(profileData) ? profileData[0] : null;

    if (!profileResp.ok) {
      return res.status(500).json({
        error: "profile_check_failed",
        detail: profileData,
      });
    }

    if (!profile?.protocol) {
      return res.status(403).json({ error: "forbidden" });
    }

    // impede excluir a si mesmo
    if (authUser.id === id) {
      return res.status(400).json({ error: "cannot_delete_self" });
    }

    // opcional: verifica se o usuário existe antes
    const targetResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=id,email&limit=1`,
      { headers: adminHeaders }
    );

    const targetData = await targetResp.json().catch(() => null);
    const targetUser = Array.isArray(targetData) ? targetData[0] : null;

    if (!targetResp.ok) {
      return res.status(500).json({
        error: "target_lookup_failed",
        detail: targetData,
      });
    }

    if (!targetUser?.id) {
      return res.status(404).json({ error: "user_not_found" });
    }

    // exclui do Auth; se houver FK/trigger/cascade, o profile acompanha
    const deleteResp = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
        },
      }
    );

    const deleteText = await deleteResp.text().catch(() => "");

    if (!deleteResp.ok) {
      return res.status(500).json({
        error: "delete_failed",
        detail: deleteText,
      });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("admin delete user error:", e);
    return res.status(500).json({
      error: "server_error",
      detail: String(e),
    });
  }
}