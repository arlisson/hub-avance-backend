const LOGIN_URL = "/login/login.html";
const HUB_URL = "/paginaUnificada/index.html";

const API_ME_URL = "/api/profile";
const API_PROFILE_URL = "/api/profile";
const API_LOGOUT_URL = "/api/logout";

let CURRENT_PROFILE = null;
let cepLookupController = null;

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("perfil-form");
  const errorBox = document.getElementById("errorBox");

  const nameInput = document.getElementById("name");
  const emailInput = document.getElementById("email");
  const cpfInput = document.getElementById("cpf");
  const whatsappInput = document.getElementById("whatsapp");
  const cepInput = document.getElementById("cep");
  const cidadeInput = document.getElementById("cidade");
  const estadoInput = document.getElementById("estado");
  const hasMobileInput = document.getElementById("has-mobile");
  const contractTypeInput = document.getElementById("contract-type");
  const operatorInput = document.getElementById("operator");
  const activeLinesInput = document.getElementById("active-lines");
  const saveBtn = document.getElementById("save-btn");

  const contractTypeField = contractTypeInput?.closest(".field");
  const operatorField = operatorInput?.closest(".field");
  const activeLinesField = activeLinesInput?.closest(".field");

  // ── Dropdown de operadora ──
  const operatorBtn = document.getElementById("operator-btn");
  const operatorList = document.getElementById("operator-list");
  const operatorSelectedLabel = document.getElementById("operator-selected-label");
  const operatorCustomWrap = document.getElementById("operator-custom-wrap");
  const operatorCustomInput = document.getElementById("operator-custom");

  const KNOWN_OPERATORS = ["VIVO", "TIM", "CLARO", "NIO", "EMBRATEL"];

  function setOperatorValue(val) {
    if (!val) {
      if (operatorInput) operatorInput.value = "";
      if (operatorSelectedLabel) {
        operatorSelectedLabel.textContent = "Selecione a operadora";
        operatorSelectedLabel.classList.add("operator-placeholder");
      }
      operatorList?.querySelectorAll("li").forEach(li => li.removeAttribute("aria-selected"));
      if (operatorCustomWrap) operatorCustomWrap.hidden = true;
      if (operatorCustomInput) operatorCustomInput.value = "";
      return;
    }

    const upper = val.toUpperCase();
    const isKnown = KNOWN_OPERATORS.includes(upper);
    const listVal = isKnown ? upper : "OUTRAS";

    if (operatorInput) operatorInput.value = val;
    if (operatorSelectedLabel) {
      operatorSelectedLabel.textContent = val.toUpperCase();
      operatorSelectedLabel.classList.remove("operator-placeholder");
    }
    operatorList?.querySelectorAll("li").forEach(li => {
      li.dataset.value === listVal
        ? li.setAttribute("aria-selected", "true")
        : li.removeAttribute("aria-selected");
    });

    if (operatorCustomWrap) operatorCustomWrap.hidden = isKnown;
    if (!isKnown && operatorCustomInput) operatorCustomInput.value = val;
  }

  function closeOperatorDropdown() {
    if (operatorList) operatorList.hidden = true;
    operatorBtn?.setAttribute("aria-expanded", "false");
  }

  operatorBtn?.addEventListener("click", () => {
    const isOpen = !operatorList.hidden;
    operatorList.hidden = isOpen;
    operatorBtn.setAttribute("aria-expanded", String(!isOpen));
  });

  operatorList?.querySelectorAll("li").forEach(li => {
    li.addEventListener("click", () => {
      const val = li.dataset.value;
      operatorList.querySelectorAll("li").forEach(el => el.removeAttribute("aria-selected"));
      li.setAttribute("aria-selected", "true");
      if (operatorInput) operatorInput.value = val === "OUTRAS" ? "" : val;
      if (operatorSelectedLabel) {
        operatorSelectedLabel.textContent = val;
        operatorSelectedLabel.classList.remove("operator-placeholder");
      }
      if (operatorCustomWrap) operatorCustomWrap.hidden = val !== "OUTRAS";
      if (val !== "OUTRAS" && operatorCustomInput) operatorCustomInput.value = "";
      if (val === "OUTRAS" && operatorCustomInput) operatorCustomInput.focus();
      closeOperatorDropdown();
    });
  });

  operatorCustomInput?.addEventListener("input", () => {
    if (operatorInput) operatorInput.value = operatorCustomInput.value.trim();
  });

  document.addEventListener("click", e => {
    if (!operatorBtn?.contains(e.target) && !operatorList?.contains(e.target)) {
      closeOperatorDropdown();
    }
  });

  function syncMobileFields() {
    const hasMobile =
      String(hasMobileInput?.value || "").trim().toLowerCase() === "true";

    if (contractTypeField) {
      contractTypeField.hidden = !hasMobile;
      contractTypeField.style.display = hasMobile ? "" : "none";
    }

    if (operatorField) {
      operatorField.hidden = !hasMobile;
      operatorField.style.display = hasMobile ? "" : "none";
    }

    if (activeLinesField) {
      activeLinesField.hidden = !hasMobile;
      activeLinesField.style.display = hasMobile ? "" : "none";
    }

    if (!hasMobile) {
      setOperatorValue("");
      if (activeLinesInput) activeLinesInput.value = "";
    }
  }

  const token = getAccessToken();

  if (!token) {
    window.location.href = LOGIN_URL;
    return;
  }

  try {
    const meResp = await apiFetch(API_ME_URL, {
      method: "GET",
      token,
    });

    if (!meResp?.ok || !meResp?.user) {
      throw new Error("Usuário não autenticado.");
    }

    const user = meResp.user;
    CURRENT_PROFILE = normalizeProfileFromApi(user);

    const userEmailEl = document.getElementById("user-email");
    if (userEmailEl) {
      userEmailEl.textContent = user.email || "";
      userEmailEl.title = user.email || "";
    }

    const menuUsers = document.getElementById("menu-users");
    if (menuUsers) {
      const shouldShow = !!user?.protocol;
      menuUsers.hidden = !shouldShow;
      menuUsers.style.display = shouldShow ? "" : "none";
    }

    fillProfileForm(CURRENT_PROFILE);

    if (emailInput) {
      emailInput.value = user.email || "";
      emailInput.readOnly = true;
    }

    if (cpfInput) {
      cpfInput.readOnly = true;
    }
  } catch (err) {
    console.error("Erro ao carregar perfil:", err);

    if (errorBox) {
      errorBox.textContent =
        extractApiError(err) || "Não foi possível carregar seu perfil.";
      errorBox.hidden = false;
    }

    return;
  }

  initSettingsMenu(
    document.getElementById("settings-btn"),
    document.getElementById("settings-menu")
  );
  initMobileSidebar(document.getElementById("mobile-menu-btn"));
  initTheme(document.getElementById("theme-toggle"));

  const menuBackHub = document.getElementById("menu-back-hub");
  if (menuBackHub) {
    menuBackHub.addEventListener("click", () => {
      window.location.href = HUB_URL;
    });
  }

  const menuLogout = document.getElementById("menu-logout");
  if (menuLogout) {
    menuLogout.addEventListener("click", async () => {
      try {
        const currentToken = getAccessToken();
        if (currentToken) {
          await apiFetch(API_LOGOUT_URL, {
            method: "POST",
            token: currentToken,
          });
        }
      } catch (err) {
        console.warn("Falha no logout remoto:", err);
      } finally {
        clearAuthToken();
        window.location.href = LOGIN_URL;
      }
    });
  }

  whatsappInput?.addEventListener("input", (e) => {
    let value = String(e.target.value || "").replace(/\D/g, "");
    if (value.length > 11) value = value.slice(0, 11);
    value = value.replace(/^(\d{2})(\d)/, "($1) $2");
    value = value.replace(/(\d)(\d{4})$/, "$1-$2");
    e.target.value = value;
  });

  cepInput?.addEventListener("input", (e) => {
    let value = String(e.target.value || "").replace(/\D/g, "");
    if (value.length > 8) value = value.slice(0, 8);
    value = value.replace(/^(\d{5})(\d)/, "$1-$2");
    e.target.value = value;
  });

  cepInput?.addEventListener("blur", async () => {
    await buscarCep(cepInput.value);
  });

  activeLinesInput?.addEventListener("input", (e) => {
    let value = String(e.target.value || "").replace(/\D/g, "");
    e.target.value = value;
  });

  hasMobileInput?.addEventListener("change", () => {
    syncMobileFields();
    hideError(errorBox);
  });

  form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError(errorBox);

  const token = getAccessToken();
  if (!token) {
    window.location.href = LOGIN_URL;
    return;
  }

  const nomeValue = (nameInput?.value || "").trim();
  const whatsappValue = (whatsappInput?.value || "").replace(/\D/g, "");
  const cepValue = (cepInput?.value || "").replace(/\D/g, "");
  const cidadeValue = (cidadeInput?.value || "").trim();
  const estadoValue = (estadoInput?.value || "").trim();

  const hasMobileRaw = String(hasMobileInput?.value || "").trim().toLowerCase();
  const hasMobile = hasMobileRaw === "true";

  if (!nomeValue) {
    showError(errorBox, "Informe seu nome.");
    return;
  }

  if (!whatsappValue || whatsappValue.length < 10) {
    showError(errorBox, "Informe um WhatsApp válido.");
    return;
  }

  if (cepValue.length !== 8) {
    showError(errorBox, "Informe um CEP válido.");
    return;
  }

  const cepOk = await buscarCep(cepValue);
  if (!cepOk) {
    showError(errorBox, "Não foi possível validar o CEP informado.");
    return;
  }

  if (hasMobileRaw !== "true" && hasMobileRaw !== "false") {
    showError(errorBox, "Selecione se a telefonia está ativa.");
    return;
  }

  let payload = {
    nome: nomeValue,
    whatsapp: whatsappValue,
    cep: cepValue,
    regiao: {
      ...(parseRegiao(CURRENT_PROFILE?.regiao)),
      cep: cepValue,
      cidade: cidadeValue,
      estado: estadoValue,
    },
    has_mobile_service: hasMobile,
  };

  if (hasMobile) {
    const contractTypeValue = (contractTypeInput?.value || "").trim().toUpperCase();
    const operadorValue = (operatorInput?.value || "").trim();
    const activeLinesRaw = String(activeLinesInput?.value || "").trim();

    if (contractTypeValue !== "CPF" && contractTypeValue !== "CNPJ") {
      showError(errorBox, "Selecione um tipo de contrato válido.");
      return;
    }

    if (!operadorValue) {
      showError(errorBox, "Informe a operadora.");
      return;
    }

    if (activeLinesRaw === "") {
      showError(errorBox, "Informe a quantidade de linhas ativas.");
      return;
    }

    const activeLinesValue = Number(activeLinesRaw);

    if (!Number.isInteger(activeLinesValue) || activeLinesValue < 0) {
      showError(errorBox, "Informe um número válido de linhas ativas.");
      return;
    }

    payload.contract_type = contractTypeValue;
    payload.operador = operadorValue;
    payload.active_lines = activeLinesValue;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = `
      <i class="ph ph-spinner-gap spinner"></i>
      <span>Salvando...</span>
    `;
  }

  try {
    const result = await apiFetch(API_PROFILE_URL, {
      method: "PUT",
      token,
      body: payload,
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Falha ao atualizar perfil.");
    }

    CURRENT_PROFILE = normalizeProfileFromApi({
      ...(CURRENT_PROFILE || {}),
      ...(result.user || payload),
      email: emailInput?.value || CURRENT_PROFILE?.email || "",
      protocol: CURRENT_PROFILE?.protocol,
      cliente_avance: CURRENT_PROFILE?.cliente_avance,
    });

    fillProfileForm(CURRENT_PROFILE);

    if (typeof showFeedback === "function") {
      showFeedback("Perfil atualizado com sucesso.", "success");
    }
  } catch (err) {
    console.error("Erro ao salvar perfil:", err);
    showError(
      errorBox,
      extractApiError(err) || "Não foi possível salvar as alterações."
    );
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `
        <i class="ph ph-floppy-disk"></i>
        <span>Salvar alterações</span>
      `;
    }
  }
});

  async function buscarCep(cepInformado, opts = {}) {
    if (!cepInput) return false;

    const { silent = false } = opts;
    const cep = String(cepInformado || "").replace(/\D/g, "");

    if (cep.length !== 8) {
      if (!silent) {
        showError(errorBox, "CEP inválido.");
      }
      limparRegiaoUI();
      return false;
    }

    if (cepLookupController) {
      cepLookupController.abort();
    }

    cepLookupController = new AbortController();

    try {
      const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
        signal: cepLookupController.signal,
      });

      const data = await resp.json();

      if (!resp.ok || data?.erro) {
        if (!silent) {
          showError(errorBox, "CEP não encontrado.");
        }
        limparRegiaoUI();
        return false;
      }

      if (cidadeInput) cidadeInput.value = data.localidade || "";
      if (estadoInput) estadoInput.value = data.uf || "";
      hideError(errorBox);
      return true;
    } catch (error) {
      if (error?.name === "AbortError") {
        return false;
      }

      console.error("Erro ao consultar CEP:", error);

      if (!silent) {
        showError(errorBox, "Não foi possível consultar o CEP.");
      }

      limparRegiaoUI();
      return false;
    }
  }

  function limparRegiaoUI() {
    if (cidadeInput) cidadeInput.value = "";
    if (estadoInput) estadoInput.value = "";
  }

  function fillProfileForm(profile) {
    const regiao = parseRegiao(profile?.regiao);

    if (nameInput) nameInput.value = profile?.nome || "";
    if (emailInput) emailInput.value = profile?.email || "";
    if (cpfInput) cpfInput.value = profile?.cpf_cnpj || "";
    if (whatsappInput) whatsappInput.value = formatWhatsapp(profile?.whatsapp || "");
    if (cepInput) cepInput.value = formatCep(regiao?.cep || profile?.cep || "");
    if (cidadeInput) cidadeInput.value = regiao?.cidade || "";
    if (estadoInput) estadoInput.value = regiao?.estado || "";

    if (hasMobileInput) {
      if (profile?.has_mobile_service === true) {
        hasMobileInput.value = "true";
      } else if (profile?.has_mobile_service === false) {
        hasMobileInput.value = "false";
      } else {
        hasMobileInput.value = "";
      }
    }

    if (contractTypeInput) {
      const contract = String(profile?.contract_type || "").trim().toUpperCase();
      contractTypeInput.value =
        contract === "CPF" || contract === "CNPJ" ? contract : "";
    }

    setOperatorValue(profile?.operador || "");

    if (activeLinesInput) {
      const raw = profile?.active_lines;
      activeLinesInput.value =
        raw === 0 || Number.isFinite(Number(raw)) ? String(raw) : "";
    }

    syncMobileFields();
  }
});

function normalizeProfileFromApi(user = {}) {
  return {
    id: user.id || "",
    email: user.email || "",
    nome: user.nome || user.name || "",
    cpf_cnpj: user.cpf_cnpj || "",
    whatsapp: user.whatsapp || "",
    cep: user.cep || "",
    regiao: parseRegiao(user.regiao),
    protocol: !!user.protocol,
    cliente_avance: !!user.cliente_avance,
    has_mobile_service:
      typeof user.has_mobile_service === "boolean"
        ? user.has_mobile_service
        : null,
    contract_type: user.contract_type || "",
    operador: user.operador || user.operator || "",
    active_lines:
      user.active_lines === 0 || Number.isFinite(Number(user.active_lines))
        ? Number(user.active_lines)
        : "",
  };
}

function getAccessToken() {
  return (
    localStorage.getItem("auth_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    localStorage.getItem("access_token") ||
    sessionStorage.getItem("auth_token") ||
    sessionStorage.getItem("token") ||
    sessionStorage.getItem("authToken") ||
    sessionStorage.getItem("access_token") ||
    ""
  );
}

function clearAuthToken() {
  localStorage.removeItem("auth_token");
  localStorage.removeItem("token");
  localStorage.removeItem("authToken");
  localStorage.removeItem("access_token");

  sessionStorage.removeItem("auth_token");
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("authToken");
  sessionStorage.removeItem("access_token");
}

async function apiFetch(url, { method = "GET", token = "", body } = {}) {
  const headers = {
    Accept: "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const resp = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await resp.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { ok: false, error: text || "Resposta inválida do servidor." };
  }

  if (resp.status === 401) {
    const err = new Error(data?.error || "Não autorizado.");
    err.response = data;
    err.status = resp.status;
    throw err;
  }

  if (!resp.ok) {
    const err = new Error(data?.error || "Erro na requisição.");
    err.response = data;
    err.status = resp.status;
    throw err;
  }

  return data;
}

function extractApiError(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err?.response?.error) return String(err.response.error);
  if (err?.message) return String(err.message);
  return "";
}

function parseRegiao(regiao) {
  if (regiao && typeof regiao === "object") return regiao;
  if (typeof regiao === "string") {
    try {
      return JSON.parse(regiao);
    } catch {
      return {};
    }
  }
  return {};
}

function formatWhatsapp(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length > 11) digits = digits.slice(0, 11);
  digits = digits.replace(/^(\d{2})(\d)/, "($1) $2");
  digits = digits.replace(/(\d)(\d{4})$/, "$1-$2");
  return digits;
}

function formatCep(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length > 8) digits = digits.slice(0, 8);
  return digits.replace(/^(\d{5})(\d)/, "$1-$2");
}

function showError(errorBox, message) {
  if (!errorBox) return;
  errorBox.textContent = message || "Ocorreu um erro.";
  errorBox.hidden = false;
}

function hideError(errorBox) {
  if (!errorBox) return;
  errorBox.hidden = true;
  errorBox.textContent = "";
}

function initSettingsMenu(btn, menu) {
  if (!btn || !menu) return;

  const close = () => {
    menu.hidden = true;
  };

  const open = () => {
    menu.hidden = false;
  };

  const toggle = () => {
    if (menu.hidden) open();
    else close();
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });

  document.addEventListener("click", (e) => {
    const userbar = document.getElementById("sidebar-userbar");
    if (!userbar?.contains(e.target)) {
      close();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close();
    }
  });
}

function initMobileSidebar(menuBtn) {
  if (!menuBtn) return;

  menuBtn.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-open");
  });

  document.addEventListener("click", (e) => {
    if (!document.body.classList.contains("sidebar-open")) return;

    const sidebar = document.querySelector(".sidebar");
    if (!sidebar?.contains(e.target) && !menuBtn.contains(e.target)) {
      document.body.classList.remove("sidebar-open");
    }
  });
}

function initTheme(themeToggle) {
  if (!themeToggle) return;

  const savedTheme = localStorage.getItem("theme");
  const isLight = savedTheme === "light";

  document.body.classList.toggle("light-mode", isLight);
  document.body.classList.remove("dark-mode");
  updateThemeIcon(themeToggle);

  themeToggle.addEventListener("click", () => {
    const nowLight = document.body.classList.toggle("light-mode");
    document.body.classList.remove("dark-mode");
    localStorage.setItem("theme", nowLight ? "light" : "dark");
    updateThemeIcon(themeToggle);
  });
}

function updateThemeIcon(btn) {
  const icon = btn?.querySelector("i");
  const text = btn?.querySelector("span");
  const logo = document.querySelector(".company-logo");

  if (!icon || !text) return;

  const isLight = document.body.classList.contains("light-mode");

  if (isLight) {
    icon.className = "ph ph-moon";
    text.textContent = "Modo escuro";
  } else {
    icon.className = "ph ph-sun";
    text.textContent = "Modo claro";
  }

  if (logo) {
    logo.src = !isLight
      ? "../img/LogoEscuroSemFundo.png"
      : "../img/LogoClaraSemFundo.png";
  }
}