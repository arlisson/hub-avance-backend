// api/register.js
/**
 * Handles user registration with email, password, and profile information.
 *
 * This handler performs the following operations in sequence:
 * 1. Validates the request method (POST only)
 * 2. Checks for duplicate CPF in the database
 * 3. Creates a new user account via Supabase Auth
 * 4. Updates the user profile with additional information (including mobile questions and região from CEP)
 * 5. Registers a license in Google Sheets
 *
 * @async
 * @param {Object} req - Express request object
 * @param {string} req.method - HTTP method (must be POST or OPTIONS)
 * @param {Object} req.body - Request body
 * @param {string} req.body.email - User email (required)
 * @param {string} req.body.password - User password (required)
 * @param {string} req.body.cpf - User CPF/CNPJ number (required)
 * @param {string} [req.body.name] - User full name (optional)
 * @param {string} [req.body.whatsapp] - User WhatsApp number (optional)
 * @param {string} req.body.cep - CEP (required)
 * @param {Object} req.body.regiao - Região object to persist in jsonb (required)
 * @param {string} req.body.regiao.cep - CEP normalized
 * @param {string} req.body.regiao.cidade - Cidade from CEP lookup
 * @param {string} req.body.regiao.estado - UF from CEP lookup
 *
 * @param {boolean} [req.body.has_mobile_service] - Whether company has active mobile service
 * @param {string} [req.body.contract_type] - "CPF" | "CNPJ"
 * @param {string} [req.body.operator] - Current operator
 * @param {number} [req.body.active_lines] - Active mobile lines
 *
 * @param {Object} res - Express response object
 *
 * @returns {Promise<void>} JSON response with status
 */
export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const {
      email,
      password,
      name,
      cpf,
      whatsapp,

      // telefonia
      has_mobile_service,
      contract_type,
      operator,
      active_lines,

      // CEP / região
      cep,
      regiao,
    } = req.body || {};

    if (!email || !password || !cpf || !cep || !regiao) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    // --- NORMALIZAÇÕES BÁSICAS ---
    const emailClean = String(email || "").trim().toLowerCase();
    const nameClean = name ? String(name).trim().slice(0, 200) : null;
    const cpfClean = String(cpf || "").replace(/\D/g, "");
    const whatsappClean = whatsapp ? String(whatsapp).replace(/\D/g, "") : null;
    const cepClean = String(cep || "").replace(/\D/g, "");

    // --- VALIDAÇÃO BÁSICA DE CEP / REGIÃO ---
    const regiaoCep = String(regiao?.cep || "").replace(/\D/g, "");
    const regiaoCidade = regiao?.cidade ? String(regiao.cidade).trim().slice(0, 120) : "";
    const regiaoEstado = regiao?.estado ? String(regiao.estado).trim().toUpperCase().slice(0, 2) : "";

    if (cepClean.length !== 8) {
      return res.status(400).json({ ok: false, error: "invalid_cep" });
    }

    if (!regiaoCidade || !regiaoEstado || regiaoEstado.length !== 2) {
      return res.status(400).json({ ok: false, error: "invalid_regiao" });
    }

    const regiaoFinal = {
      cep: regiaoCep || cepClean,
      cidade: regiaoCidade,
      estado: regiaoEstado,
    };

    // --- NORMALIZAÇÃO TELEFONIA ---
    const hasMobile =
      typeof has_mobile_service === "boolean"
        ? has_mobile_service
        : has_mobile_service === "true"
          ? true
          : has_mobile_service === "false"
            ? false
            : null;

    const contractType =
      contract_type === "CPF" || contract_type === "CNPJ" ? contract_type : null;

    const operatorClean = operator ? String(operator).trim().slice(0, 120) : null;

    let activeLines = null;
    if (active_lines !== undefined && active_lines !== null && active_lines !== "") {
      const n = Number(active_lines);
      activeLines = Number.isFinite(n) ? Math.trunc(n) : null;
    }
    if (activeLines !== null && activeLines < 0) activeLines = null;

    // Regras coerentes:
    // - Se não tem telefonia móvel, ignora contract/operator/active_lines
    // - Se tem telefonia móvel, contract_type é obrigatório
    const finalContractType = hasMobile === true ? contractType : null;
    const finalOperator = hasMobile === true ? operatorClean : null;
    const finalActiveLines = hasMobile === true ? activeLines : null;

    if (hasMobile === true && !finalContractType) {
      return res.status(400).json({ ok: false, error: "missing_contract_type" });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const ANON_KEY = process.env.SUPABASE_ANON_KEY;

    const GS_WEBAPP_URL = process.env.GS_WEBAPP_URL;
    const HUB_SECRET = process.env.HUB_SECRET;

    if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
      return res.status(500).json({
        ok: false,
        error: "missing_supabase_env",
        has_url: !!SUPABASE_URL,
        has_service_role: !!SERVICE_ROLE,
        has_anon_key: !!ANON_KEY,
      });
    }

    if (!GS_WEBAPP_URL || !HUB_SECRET) {
      return res.status(500).json({
        ok: false,
        error: "missing_sheets_env",
        has_gs_url: !!GS_WEBAPP_URL,
        has_hub_secret: !!HUB_SECRET,
      });
    }

    // 1) checa CPF/CNPJ duplicado (service role)
    const cpfCheck = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=id&cpf=eq.${encodeURIComponent(cpfClean)}&limit=1`,
      {
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
        },
      }
    );

    const cpfRows = await cpfCheck.json().catch(() => []);
    if (Array.isArray(cpfRows) && cpfRows.length > 0) {
      return res.status(409).json({ ok: false, error: "cpf_exists" });
    }

    // 2) cria usuário (signup normal -> envia e-mail de confirmação quando "Confirm email" estiver habilitado)
    const redirectTo = "https://hub-avance.vercel.app/login/login.html";

    const signUpResp = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
      },
      body: JSON.stringify({
        email: emailClean,
        password,
        data: {
          name: nameClean,
          cpf: cpfClean,
          whatsapp: whatsappClean,
          cep: cepClean,
          regiao: regiaoFinal,

          has_mobile_service: hasMobile,
          contract_type: finalContractType,
          operator: finalOperator,
          active_lines: finalActiveLines,
        },
        redirect_to: redirectTo,
      }),
    });

    const created = await signUpResp.json().catch(() => ({}));
    if (!signUpResp.ok) {
      const msg = created?.msg || created?.message || "signup_failed";
      return res.status(signUpResp.status).json({
        ok: false,
        error: "auth_error",
        detail: msg,
      });
    }

    const userId = created?.user?.id || created?.id;
    if (!userId) {
      return res.status(500).json({ ok: false, error: "missing_user_id" });
    }

    // 3) atualiza profile (linha criada por trigger)
    const profilePayload = {
      name: nameClean,
      cpf: cpfClean,
      whatsapp: whatsappClean,
      cep: cepClean,
      regiao: regiaoFinal,

      has_mobile_service: hasMobile,
      contract_type: finalContractType,
      operator: finalOperator,
      active_lines: finalActiveLines,
    };

    const upd = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify(profilePayload),
      }
    );

    if (!upd.ok) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
        },
      });

      const detail = await upd.text();
      return res.status(409).json({ ok: false, error: "profile_update_failed", detail });
    }

    // 4) registra licença no Google Sheets (upsert)
    const sheetsPayload = {
      action: "upsert_license",
      secret: HUB_SECRET,
      email: emailClean,
      status: "ACTIVE",
      max_devices: 1,
      created_at: new Date().toISOString(),
    };

    const sheetsResp = await fetch(GS_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sheetsPayload),
    });

    const sheetsData = await sheetsResp.json().catch(() => null);

    if (!sheetsResp.ok || !sheetsData?.ok) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
        },
      });

      console.error("Sheets failed:", sheetsData || (await sheetsResp.text()));

      return res.status(502).json({
        ok: false,
        error: "sheets_failed",
        detail: sheetsData || (await sheetsResp.text()),
      });
    }

    return res.status(200).json({ ok: true, needs_email_confirmation: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error", detail: String(e) });
  }
}