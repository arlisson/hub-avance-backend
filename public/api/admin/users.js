export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return res.status(401).json({ error: "missing_token" });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const ANON_KEY     = process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
      return res.status(500).json({ error: "missing_env" });
    }

    // ── Valida sessão do usuário ──────────────────────────────────────────────
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    const authUser = await userResp.json();
    if (!userResp.ok || !authUser?.id) {
      return res.status(401).json({ error: "invalid_token" });
    }

    const adminHeaders = {
      "Content-Type": "application/json",
      apikey:         SERVICE_ROLE,
      Authorization:  `Bearer ${SERVICE_ROLE}`,
      Prefer:         "count=exact",   // faz o PostgREST retornar Content-Range com o total
    };

    // ── Valida permissão de admin ─────────────────────────────────────────────
    const profileResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${authUser.id}&select=protocol`,
      { headers: adminHeaders }
    );
    const profileData = await profileResp.json();
    const profile = Array.isArray(profileData) ? profileData[0] : null;
    if (!profile?.protocol) {
      return res.status(403).json({ error: "forbidden" });
    }

    // ── Parâmetros da requisição ──────────────────────────────────────────────
    const page   = Math.max(1, parseInt(req.query.page  || "1",  10));
    const limit  = Math.min(500, Math.max(1, parseInt(req.query.limit || "25", 10)));
    const offset = (page - 1) * limit;

    const search           = (req.query.search            || "").trim();
    const clienteAvance    =  req.query.cliente_avance;       // "1" | "0" | undefined
    const hasMobileService =  req.query.has_mobile_service;   // "1" | "0" | undefined
    const activeLines      = (req.query.active_lines      || "").trim(); // "3" | "10+" | ""
    const contractType     = (req.query.contract_type     || "").trim().toUpperCase();
    const operator         = (req.query.operator          || "").trim().toUpperCase();

    // ── Monta os filtros PostgREST ────────────────────────────────────────────
    const qs = new URLSearchParams({
      select: "id,email,cpf,name,whatsapp,cep,regiao,protocol,cliente_avance,has_mobile_service,contract_type,operator,active_lines,app_usage,created_at",
      order:  "created_at.desc",
      limit:  String(limit),
      offset: String(offset),
    });

    if (clienteAvance === "1")    qs.append("cliente_avance",    "eq.true");
    if (clienteAvance === "0")    qs.append("cliente_avance",    "eq.false");
    if (hasMobileService === "1") qs.append("has_mobile_service","eq.true");
    if (hasMobileService === "0") qs.append("has_mobile_service","eq.false");
    if (contractType)             qs.append("contract_type",     `ilike.${contractType}`);
    if (operator)                 qs.append("operator",          `ilike.${operator}`);

    if (activeLines) {
      if (activeLines === "10+") {
        qs.append("active_lines", "gte.10");
      } else {
        const exact = parseInt(activeLines, 10);
        if (!isNaN(exact)) qs.append("active_lines", `eq.${exact}`);
      }
    }

    // Busca textual: OR entre os campos de texto
    if (search) {
      const s = search.replace(/[%_]/g, "\\$&"); // escapa wildcards
      qs.append("or", `(name.ilike.*${s}*,email.ilike.*${s}*,cpf.ilike.*${s}*,whatsapp.ilike.*${s}*,cep.ilike.*${s}*)`);
    }

    // ── Executa a query ───────────────────────────────────────────────────────
    const usersResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?${qs.toString()}`,
      { headers: adminHeaders }
    );

    const users = await usersResp.json();

    if (!usersResp.ok) {
      return res.status(500).json({ error: "failed_to_load_users", detail: users });
    }

    // Total vem no header Content-Range: "0-24/1523"
    const contentRange = usersResp.headers.get("content-range") || "";
    const total = contentRange.includes("/")
      ? parseInt(contentRange.split("/")[1], 10)
      : (Array.isArray(users) ? users.length : 0);

    return res.status(200).json({ users, total });

  } catch (e) {
    console.error("admin users error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}
