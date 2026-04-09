function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function splitName(fullName) {
  const clean = String(fullName || "").trim().replace(/\s+/g, " ");

  if (!clean) {
    return { firstName: "", lastName: "" };
  }

  const parts = clean.split(" ");
  const firstName = parts.shift() || "";
  const lastName = parts.join(" ");

  return { firstName, lastName };
}

function buildCrmPayload(data) {
  const { firstName, lastName } = splitName(data.name);

  const payload = {
    locationId: process.env.CRM_LOCATION_ID,
    firstName,
    email: String(data.email || "").trim().toLowerCase() || undefined,
    phone: onlyDigits(data.whatsapp) || undefined,
    city: String(data.cidade || "").trim() || undefined,
    state: String(data.estado || "").trim() || undefined,
    postalCode: onlyDigits(data.cep) || undefined,
    source: "Hub Avance",
    customFields: [],
    country: "BR",
  };

  if (lastName) {
    payload.lastName = lastName;
  }
  const cpfCnpj = onlyDigits(data.cpf_cnpj);
  if (cpfCnpj) {
    payload.customFields.push({
      id: "sgW6l7Y85QrKLMgqtw3r",
      field_value: cpfCnpj,
    });
  }

  return payload;
}

export async function sendContactToCrm(data) {
  const token = process.env.CRM_API_TOKEN;
  const version = process.env.CRM_API_VERSION || "2021-07-28";
  const url =
    process.env.CRM_API_URL ||
    "https://services.leadconnectorhq.com/contacts/";
  const locationId = process.env.CRM_LOCATION_ID;

  if (!token) {
    throw new Error("CRM_API_TOKEN não configurado");
  }

  if (!locationId) {
    throw new Error("CRM_LOCATION_ID não configurado");
  }

  const payload = buildCrmPayload(data);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: version,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      result?.message ||
        result?.error ||
        `Erro ao enviar contato para o CRM (${response.status})`
    );
  }

  return result;
}