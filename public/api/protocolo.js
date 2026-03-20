export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método não permitido." });
    }

    const { phone, phoneRaw, agent, channel, agendorPick, requestedBy } = req.body || {};
    const phoneDigits = digitsOnly(phone);

    if (phoneDigits.length < 10) {
      return res.status(400).json({ error: "Telefone inválido (com DDD)." });
    }

    const protocol = generateProtocol(phoneDigits);

    // Se o usuário escolheu manualmente no dropdown
    if (agendorPick) {
      const agendor = await updateByPick({ agendorPick, protocol });

      if (!agendor.sent) {
        return res.status(502).json({
          error: "Falha ao registrar no Agendor.",
          protocol,
          agendor,
        });
      }

      const sheets = await writeProtocolToSheets({
        protocol,
        phone: phoneRaw || phoneDigits,
        agent,
        channel,
        requestedBy,
        recordType: agendor.recordType || "",
        agendorId: agendor.organizationId || agendor.personId || "",
      });

      return res.status(200).json({
        protocol,
        agendor,
        sheets,
      });
    }

    // 1) Tenta encontrar empresa pelo telefone
    let found = await findOrganizationByPhoneExact(phoneDigits);

    // 2) Se não achar empresa, tenta pessoa
    if (found.status === "not_found") {
      const person = await findPersonByPhoneExact(phoneDigits);

      if (person.status === "single") {
        const org = await resolveOrganizationFromPerson(person.personId);

        // Pessoa com empresa vinculada: grava na empresa
        if (org?.organizationId) {
          found = { status: "single", organizationId: org.organizationId };
        } else {
          // Pessoa sem empresa vinculada: grava direto na pessoa
          const agendor = await updateAgendorPersonProtocol({
            personId: person.personId,
            protocol,
          });

          if (!agendor.sent) {
            return res.status(502).json({
              error: "Pessoa encontrada, mas falhou ao registrar protocolo na pessoa no Agendor.",
              protocol,
              agendor,
            });
          }

          const sheets = await writeProtocolToSheets({
            protocol,
            phone: phoneRaw || phoneDigits,
            agent,
            channel,
            requestedBy,
            recordType: "pessoa",
            agendorId: agendor.personId || "",
          });

          return res.status(200).json({
            protocol,
            agendor,
            sheets,
          });
        }
      } else if (person.status === "multiple") {
        return res.status(409).json({
          error: "Mais de uma pessoa encontrada. Selecione uma.",
          protocol,
          matches: person.matches.map((m) => ({
            key: `person:${m.id}`,
            label: `Pessoa — ${m.name} (ID ${m.id})`,
          })),
          agendor: { sent: false, detail: "multiple_people" },
        });
      } else {
        return res.status(404).json({
          error: "Nenhuma empresa ou pessoa encontrada no Agendor para este telefone.",
          protocol,
        });
      }
    }

    // Múltiplas empresas
    if (found.status === "multiple") {
      return res.status(409).json({
        error: "Mais de uma empresa encontrada. Selecione uma.",
        protocol,
        matches: found.matches.map((m) => ({
          key: `org:${m.id}`,
          label: `Empresa — ${m.name} (ID ${m.id})`,
        })),
        agendor: { sent: false, detail: "multiple_orgs" },
      });
    }

    // Empresa única encontrada
    const agendor = await updateAgendorOrganizationProtocol({
      organizationId: found.organizationId,
      protocol,
    });

    if (!agendor.sent) {
      return res.status(502).json({
        error: "Falha ao registrar no Agendor.",
        protocol,
        agendor,
      });
    }

    const sheets = await writeProtocolToSheets({
      protocol,
      phone: phoneRaw || phoneDigits,
      agent,
      channel,
      requestedBy,
      recordType: "empresa",
      agendorId: agendor.organizationId || "",
    });

    return res.status(200).json({
      protocol,
      agendor,
      sheets,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Erro interno." });
  }
}

async function updateByPick({ agendorPick, protocol }) {
  const [kind, id] = String(agendorPick || "").split(":");

  if (!kind || !id) {
    return { sent: false, detail: "Seleção inválida." };
  }

  if (kind === "org") {
    return await updateAgendorOrganizationProtocol({
      organizationId: id,
      protocol,
    });
  }

  if (kind === "person") {
    return await updateAgendorPersonProtocol({
      personId: id,
      protocol,
    });
  }

  return { sent: false, detail: "Tipo não suportado." };
}

async function writeProtocolToSheets({
  protocol,
  phone,
  agent,
  channel,
  requestedBy,
  recordType,
  agendorId,
}) {
  try {
    const webhook = process.env.GOOGLE_SHEETS_WEBHOOK;

    if (!webhook) {
      return { ok: false, detail: "GOOGLE_SHEETS_WEBHOOK não configurado." };
    }

    const r = await fetch(webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        protocol,
        phone,
        agent,
        channel,
        requestedBy,
        recordType,
        agendorId,
      }),
    });

    const result = await r.json().catch(() => ({}));

    return {
      ok: r.ok && result?.ok === true,
      detail: result?.error || result?.message || (r.ok ? "ok" : `HTTP ${r.status}`),
    };
  } catch (err) {
    return {
      ok: false,
      detail: err?.message || "Erro ao registrar na planilha.",
    };
  }
}

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

function generateProtocol(phoneDigits) {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  const dd = map.day;
  const MM = map.month;
  const yy = map.year;
  const hh = map.hour;

  const last4 = String(phoneDigits || "").slice(-4).padStart(4, "0");

  return `${last4}${dd}${MM}${yy}${hh}`;
}

function normalizePhone(v) {
  return String(v || "").replace(/\D/g, "");
}

function stripBrazilCountryCode(d) {
  const s = String(d || "");
  if (s.startsWith("55") && s.length > 11) return s.slice(2);
  return s;
}

function unique(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function extractPhoneCandidatesDeep(obj) {
  const out = new Set();

  const visit = (node) => {
    if (node == null) return;

    const t = typeof node;

    if (t === "string" || t === "number") {
      const digits = normalizePhone(node);
      if (digits.length >= 8 && digits.length <= 14) {
        out.add(digits);
      }
      return;
    }

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (t === "object") {
      Object.keys(node).forEach((k) => visit(node[k]));
    }
  };

  visit(obj);
  return [...out];
}

async function findOrganizationByPhoneExact(phoneDigits) {
  const token = process.env.AGENDOR_API_TOKEN;
  const base = "https://api.agendor.com.br/v3";

  if (!token) throw new Error("AGENDOR_API_TOKEN não configurado.");

  const termsToTry = unique([
    phoneDigits,
    `55${phoneDigits}`,
    `+55${phoneDigits}`,
    phoneDigits.slice(-9),
    phoneDigits.slice(-8),
  ]);

  const candidateMap = new Map();

  for (const term of termsToTry) {
    const r = await fetch(`${base}/organizations?term=${encodeURIComponent(term)}&limit=10`, {
      headers: { authorization: `Token ${token}` },
    });

    const j = await r.json().catch(() => ({}));

    if (!r.ok) {
      const msg =
        (Array.isArray(j?.errors) && j.errors[0]) ||
        j?.message ||
        `HTTP ${r.status}`;
      throw new Error(`Falha ao buscar empresas no Agendor: ${msg}`);
    }

    const arr = Array.isArray(j?.data) ? j.data : [];
    for (const o of arr) {
      candidateMap.set(String(o.id), { id: String(o.id), name: o.name || "" });
    }

    if (candidateMap.size >= 10) break;
  }

  const candidates = [...candidateMap.values()];
  if (candidates.length === 0) return { status: "not_found" };

  const want = normalizePhone(phoneDigits);
  const want55 = normalizePhone(`55${phoneDigits}`);

  const exact = [];

  for (const c of candidates.slice(0, 10)) {
    const detailResp = await fetch(`${base}/organizations/${encodeURIComponent(c.id)}`, {
      headers: { authorization: `Token ${token}` },
    });

    const detailJson = await detailResp.json().catch(() => ({}));
    if (!detailResp.ok) continue;

    const data = detailJson?.data || detailJson;
    const phones = extractPhoneCandidatesDeep(data);

    const isExact =
      phones.includes(want) ||
      phones.includes(want55) ||
      phones.includes(stripBrazilCountryCode(want55)) ||
      phones.includes(stripBrazilCountryCode(want));

    if (isExact) {
      exact.push({ id: c.id, name: data?.name || c.name || "" });
    }
  }

  if (exact.length === 0) return { status: "not_found" };
  if (exact.length === 1) return { status: "single", organizationId: exact[0].id };
  return { status: "multiple", matches: exact };
}

async function findPersonByPhoneExact(phoneDigits) {
  const token = process.env.AGENDOR_API_TOKEN;
  const base = "https://api.agendor.com.br/v3";

  if (!token) throw new Error("AGENDOR_API_TOKEN não configurado.");

  const termsToTry = unique([
    phoneDigits,
    `55${phoneDigits}`,
    `+55${phoneDigits}`,
    phoneDigits.slice(-9),
    phoneDigits.slice(-8),
  ]);

  const candidateMap = new Map();

  for (const term of termsToTry) {
    const r = await fetch(`${base}/people?term=${encodeURIComponent(term)}&limit=10`, {
      headers: { authorization: `Token ${token}` },
    });

    const j = await r.json().catch(() => ({}));

    if (!r.ok) {
      const msg =
        (Array.isArray(j?.errors) && j.errors[0]) ||
        j?.message ||
        `HTTP ${r.status}`;
      throw new Error(`Falha ao buscar pessoas no Agendor: ${msg}`);
    }

    const arr = Array.isArray(j?.data) ? j.data : [];
    for (const p of arr) {
      candidateMap.set(String(p.id), { id: String(p.id), name: p.name || "" });
    }

    if (candidateMap.size >= 10) break;
  }

  const candidates = [...candidateMap.values()];
  if (candidates.length === 0) return { status: "not_found" };

  const want = normalizePhone(phoneDigits);
  const want55 = normalizePhone(`55${phoneDigits}`);

  const exact = [];

  for (const c of candidates.slice(0, 10)) {
    const detailResp = await fetch(`${base}/people/${encodeURIComponent(c.id)}`, {
      headers: { authorization: `Token ${token}` },
    });

    const detailJson = await detailResp.json().catch(() => ({}));
    if (!detailResp.ok) continue;

    const data = detailJson?.data || detailJson;
    const phones = extractPhoneCandidatesDeep(data);

    const isExact =
      phones.includes(want) ||
      phones.includes(want55) ||
      phones.includes(stripBrazilCountryCode(want55)) ||
      phones.includes(stripBrazilCountryCode(want));

    if (isExact) {
      exact.push({ id: c.id, name: data?.name || c.name || "" });
    }
  }

  if (exact.length === 0) return { status: "not_found" };
  if (exact.length === 1) return { status: "single", personId: exact[0].id };
  return { status: "multiple", matches: exact };
}

async function updateAgendorOrganizationProtocol({ organizationId, protocol }) {
  const token = process.env.AGENDOR_API_TOKEN;
  const base = "https://api.agendor.com.br/v3";
  const identifier = "protocolo_de_atendimento";

  if (!token) return { sent: false, detail: "AGENDOR_API_TOKEN não configurado." };

  const payload = {
    customFields: {
      [identifier]: protocol,
    },
  };

  const r = await fetch(`${base}/organizations/${encodeURIComponent(organizationId)}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Token ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    const msg =
      (Array.isArray(data?.errors) && data.errors[0]) ||
      data?.message ||
      `HTTP ${r.status}`;
    return { sent: false, detail: msg };
  }

  return {
    sent: true,
    detail: "ok",
    recordType: "empresa",
    organizationId,
  };
}

async function updateAgendorPersonProtocol({ personId, protocol }) {
  const token = process.env.AGENDOR_API_TOKEN;
  const base = "https://api.agendor.com.br/v3";
  const identifier = "protocolo_de_atendimento";

  if (!token) return { sent: false, detail: "AGENDOR_API_TOKEN não configurado." };

  const payload = {
    customFields: {
      [identifier]: protocol,
    },
  };

  const r = await fetch(`${base}/people/${encodeURIComponent(personId)}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Token ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    const msg =
      (Array.isArray(data?.errors) && data.errors[0]) ||
      data?.message ||
      `HTTP ${r.status}`;
    return { sent: false, detail: msg };
  }

  return {
    sent: true,
    detail: "ok",
    recordType: "pessoa",
    personId,
  };
}

async function resolveOrganizationFromPerson(personId) {
  const token = process.env.AGENDOR_API_TOKEN;
  const base = "https://api.agendor.com.br/v3";

  if (!token) throw new Error("AGENDOR_API_TOKEN não configurado.");

  const r = await fetch(`${base}/people/${encodeURIComponent(personId)}`, {
    headers: { authorization: `Token ${token}` },
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) return null;

  const data = j?.data || j;
  const orgIds = extractOrganizationIdsDeep(data);

  if (orgIds.length === 1) {
    return { organizationId: orgIds[0] };
  }

  return null;
}

function extractOrganizationIdsDeep(obj) {
  const out = new Set();

  const visit = (node) => {
    if (!node) return;

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (typeof node !== "object") return;

    for (const [k, v] of Object.entries(node)) {
      const key = k.toLowerCase();

      if (key === "organizationid" && (typeof v === "number" || typeof v === "string")) {
        const id = String(v).replace(/\D/g, "");
        if (id.length >= 6) out.add(id);
      }

      if (key.includes("organization") && v && typeof v === "object") {
        if (v.id != null) {
          const id = String(v.id).replace(/\D/g, "");
          if (id.length >= 6) out.add(id);
        }
      }

      visit(v);
    }
  };

  visit(obj);
  return [...out];
}