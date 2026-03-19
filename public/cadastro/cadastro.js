// cadastro.js — Supabase (fluxo com confirmação de e-mail)
// Mantém: máscaras, toggle senha, submit
// Faz: validação em tempo real (CPF/CNPJ, e-mail e CEP) com destaque vermelho + mensagem abaixo
// Chama endpoint server-side /api/register (Vercel Function)
// Agora: ao sucesso, informa que foi enviado link de confirmação e redireciona para login
// Novo: CEP obrigatório, busca automática de cidade/estado via ViaCEP e envio de regiao para o backend

/**
 * Validates a Brazilian CPF (Cadastro de Pessoas Físicas) number.
 *
 * @param {string|number} cpf - The CPF number to validate. Can be a string or number,
 *                               with or without formatting characters.
 * @returns {boolean} Returns true if the CPF is valid, false otherwise.
 */
function validarCPF(cpf) {
  const c = String(cpf || "").replace(/\D/g, "");
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false;

  const calcDV = (base, fatorInicial) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * (fatorInicial - i);
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const dv1 = calcDV(c.slice(0, 9), 10);
  const dv2 = calcDV(c.slice(0, 9) + String(dv1), 11);

  return c === c.slice(0, 9) + String(dv1) + String(dv2);
}

/**
 * Validates a Brazilian CNPJ (Cadastro Nacional da Pessoa Jurídica) number.
 *
 * @param {string|number} cnpj - The CNPJ number to validate. Can be provided as a string or number.
 * @returns {boolean} True if the CNPJ is valid, false otherwise.
 */
function validarCNPJ(cnpj) {
  const c = String(cnpj || "").replace(/\D/g, "");
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;

  const calcDV = (base, pesos) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * pesos[i];
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const base12 = c.slice(0, 12);
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const dv1 = calcDV(base12, pesos1);

  const base13 = base12 + String(dv1);
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const dv2 = calcDV(base13, pesos2);

  return c === base12 + String(dv1) + String(dv2);
}

/**
 * Validates a CPF or CNPJ document number.
 * @param {string|number} doc - The CPF or CNPJ document number to validate (with or without formatting).
 * @returns {boolean} True if the document is a valid CPF (11 digits) or CNPJ (14 digits), false otherwise.
 */
function validarCpfOuCnpj(doc) {
  const d = String(doc || "").replace(/\D/g, "");
  if (d.length === 11) return validarCPF(d);
  if (d.length === 14) return validarCNPJ(d);
  return false;
}

/**
 * Validates if a given string is a valid email address.
 * @param {string} email - The email address to validate.
 * @returns {boolean} True if the email is valid, false otherwise.
 */
function validarEmail(email) {
  const v = String(email || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/**
 * Marks an input element as invalid and displays an error message.
 * @param {HTMLElement} inputEl - The input element to mark as invalid
 * @param {string} [message="Inválido"] - The error message to display
 * @returns {void}
 */
function setInvalid(inputEl, message) {
  const group = inputEl?.closest?.(".input-group");
  if (!group) return;

  group.classList.add("is-invalid");

  let err = group.querySelector(".input-error");
  if (!err) {
    err = document.createElement("div");
    err.className = "input-error";
    group.appendChild(err);
  }
  err.textContent = message || "Inválido";
}

/**
 * Removes the invalid state from an input group and clears any associated error message.
 * @param {HTMLElement} inputEl - The input element whose parent input group should be validated.
 * @returns {void}
 */
function setValid(inputEl) {
  const group = inputEl?.closest?.(".input-group");
  if (!group) return;

  group.classList.remove("is-invalid");
  const err = group.querySelector(".input-error");
  if (err) err.textContent = "";
}

/**
 * Converts authentication error messages into user-friendly Portuguese messages.
 * @param {string|*} detailOrMessage - The error message or detail to be converted.
 * @returns {string} A user-friendly error message in Portuguese.
 */
function friendlyAuthMessage(detailOrMessage) {
  const t = String(detailOrMessage || "").toLowerCase();

  if (t.includes("user already registered") || t.includes("already registered")) {
    return "Este e-mail já está cadastrado.";
  }
  if (t.includes("invalid email")) {
    return "E-mail inválido.";
  }
  if (t.includes("password")) {
    return "Senha inválida. Verifique os requisitos e tente novamente.";
  }
  if (t.includes("rate") || t.includes("too many")) {
    return "Muitas tentativas. Aguarde um pouco e tente novamente.";
  }
  return "Não foi possível concluir o cadastro. Verifique os dados e tente novamente.";
}

document.addEventListener("DOMContentLoaded", async () => {
  // --- TEMA (padrão: escuro, igual ao Hub) ---
  const themeToggle = document.getElementById('theme-toggle');

  function updateThemeIcon(isDark) {
    const icon = themeToggle?.querySelector('i');
    if (icon) icon.className = isDark ? 'ph ph-sun' : 'ph ph-moon';
  }

  const savedTheme = localStorage.getItem('theme');
  const isDarkOnLoad = savedTheme !== 'light';
  document.body.classList.toggle('dark-mode', isDarkOnLoad);
  updateThemeIcon(isDarkOnLoad);

  themeToggle?.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeIcon(isDark);
  });

  // --- ELEMENTOS ---
  const docInput = document.getElementById("document");
  const phoneInput = document.getElementById("whatsapp");
  const emailInput = document.getElementById("email");
  const passInput = document.getElementById("password");
  const toggleBtn = document.getElementById("toggle-password");
  const form = document.getElementById("register-form");

  // --- CEP / REGIÃO ---
  const cepInput = document.getElementById("cep");
  const cidadeInput = document.getElementById("cidade");
  const estadoInput = document.getElementById("estado");

  // --- NOVOS CAMPOS ---
  const hasMobileYes = document.getElementById("has_mobile_yes");
  const hasMobileNo = document.getElementById("has_mobile_no");
  const contractTypeCnpj = document.getElementById("contract_type_cnpj");
  const contractTypeCpf = document.getElementById("contract_type_cpf");
  const operatorInput = document.getElementById("operator");
  const activeLinesInput = document.getElementById("active_lines");

  const operatorGroup = document.getElementById("operator-group");
  const linesGroup = document.getElementById("lines-group");
  const contractGroup = document.getElementById("contract-type-group");

  let cepLookupController = null;

  // --- REDIRECIONA SE JÁ ESTIVER LOGADO ---
  try {
    const sb = await getSupabaseClient();
    const { data } = await sb.auth.getSession();

    if (data?.session) {
      window.location.href = "../hub/hub.html";
      return;
    }
  } catch (_) {
    // se falhar, apenas segue (sem travar tela)
  }

  if (!docInput || !phoneInput || !emailInput || !passInput || !form) return;

  // --- HELPERS CEP ---
  function limparRegiaoUI() {
    if (cidadeInput) cidadeInput.value = "";
    if (estadoInput) estadoInput.value = "";
  }

  function getCepLimpo() {
    return String(cepInput?.value || "").replace(/\D/g, "");
  }

  function validateCepSoft() {
    if (!cepInput) return true;

    const cep = getCepLimpo();

    if (!cep) {
      setValid(cepInput);
      limparRegiaoUI();
      return true;
    }

    if (cep.length < 8) {
      setValid(cepInput);
      limparRegiaoUI();
      return true;
    }

    if (cep.length !== 8) {
      setInvalid(cepInput, "CEP inválido");
      limparRegiaoUI();
      return false;
    }

    setValid(cepInput);
    return true;
  }

  function validateCepHard() {
    if (!cepInput) return true;

    const cep = getCepLimpo();

    if (cep.length !== 8) {
      setInvalid(cepInput, "CEP inválido");
      limparRegiaoUI();
      return false;
    }

    setValid(cepInput);
    return true;
  }

  async function buscarCep(cepInformado, opts = {}) {
    if (!cepInput) return false;

    const { silent = false } = opts;
    const cep = String(cepInformado || "").replace(/\D/g, "");

    if (cep.length !== 8) {
      if (!silent) setInvalid(cepInput, "CEP inválido");
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
        if (!silent) setInvalid(cepInput, "CEP não encontrado");
        limparRegiaoUI();
        return false;
      }

      if (cidadeInput) cidadeInput.value = data.localidade || "";
      if (estadoInput) estadoInput.value = data.uf || "";

      setValid(cepInput);
      return true;
    } catch (error) {
      if (error?.name === "AbortError") {
        return false;
      }

      console.error("Erro ao consultar CEP:", error);

      if (!silent) {
        setInvalid(cepInput, "Não foi possível consultar o CEP");
      }

      limparRegiaoUI();
      return false;
    }
  }

  // --- 1) MÁSCARAS ---
  // Máscara CPF/CNPJ
  docInput.addEventListener("input", (e) => {
    let value = e.target.value.replace(/\D/g, "");
    if (value.length > 14) value = value.slice(0, 14);

    if (value.length <= 11) {
      value = value.replace(/(\d{3})(\d)/, "$1.$2");
      value = value.replace(/(\d{3})(\d)/, "$1.$2");
      value = value.replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    } else {
      value = value.replace(/^(\d{2})(\d)/, "$1.$2");
      value = value.replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3");
      value = value.replace(/\.(\d{3})(\d)/, ".$1/$2");
      value = value.replace(/(\d{4})(\d)/, "$1-$2");
    }

    e.target.value = value;
  });

  // Máscara WhatsApp
  phoneInput.addEventListener("input", (e) => {
    let value = e.target.value.replace(/\D/g, "");
    if (value.length > 11) value = value.slice(0, 11);
    value = value.replace(/^(\d{2})(\d)/, "($1) $2");
    value = value.replace(/(\d)(\d{4})$/, "$1-$2");
    e.target.value = value;
  });

  // Máscara CEP
  if (cepInput) {
    cepInput.addEventListener("input", (e) => {
      let value = e.target.value.replace(/\D/g, "");
      if (value.length > 8) value = value.slice(0, 8);
      value = value.replace(/^(\d{5})(\d)/, "$1-$2");
      e.target.value = value;

      validateCepSoft();

      const cep = value.replace(/\D/g, "");
      if (cep.length === 8) {
        buscarCep(cep, { silent: true });
      }
    });

    cepInput.addEventListener("blur", async () => {
      const ok = validateCepHard();
      if (!ok) return;
      await buscarCep(cepInput.value);
    });
  }

  // --- 2) VALIDAÇÃO EM TEMPO REAL (CPF/CNPJ e E-mail) ---
  const validateDocSoft = () => {
    const raw = docInput.value.replace(/\D/g, "");

    if (!raw) {
      setValid(docInput);
      return true;
    }
    if (raw.length !== 11 && raw.length !== 14) {
      setValid(docInput);
      return true;
    }

    if (!validarCpfOuCnpj(raw)) {
      setInvalid(docInput, "CPF/CNPJ inválido");
      return false;
    }

    setValid(docInput);
    return true;
  };

  const validateDocHard = () => {
    const raw = docInput.value.replace(/\D/g, "");
    if (!raw || (raw.length !== 11 && raw.length !== 14) || !validarCpfOuCnpj(raw)) {
      setInvalid(docInput, "CPF/CNPJ inválido");
      return false;
    }
    setValid(docInput);
    return true;
  };

  const validateEmailSoft = () => {
    const v = emailInput.value.trim();

    if (!v) {
      setValid(emailInput);
      return true;
    }

    if (!validarEmail(v)) {
      setInvalid(emailInput, "E-mail inválido");
      return false;
    }

    setValid(emailInput);
    return true;
  };

  const validateEmailHard = () => {
    const v = emailInput.value.trim();
    if (!validarEmail(v)) {
      setInvalid(emailInput, "E-mail inválido");
      return false;
    }
    setValid(emailInput);
    return true;
  };

  docInput.addEventListener("input", validateDocSoft);
  docInput.addEventListener("blur", validateDocHard);

  emailInput.addEventListener("input", validateEmailSoft);
  emailInput.addEventListener("blur", validateEmailHard);

  // --- 2.1) VALIDAÇÃO DE SENHA (tempo real) ---
  const rulesBox = document.getElementById("password-rules");

  function passwordChecks(pw) {
    const v = String(pw || "");

    return {
      len: v.length >= 8,
      upper: /[A-Z]/.test(v),
      lower: /[a-z]/.test(v),
      digit: /\d/.test(v),
      special: /[^A-Za-z0-9]/.test(v),
    };
  }

  function updatePasswordRulesUI(checks) {
    if (!rulesBox) return;

    Object.entries(checks).forEach(([key, ok]) => {
      const el = rulesBox.querySelector(`[data-rule="${key}"]`);
      if (!el) return;
      el.classList.toggle("ok", !!ok);
      el.classList.toggle("bad", !ok);
    });
  }

  function passwordErrorMessage(checks) {
    const missing = [];
    if (!checks.len) missing.push("mínimo 8 caracteres");
    if (!checks.digit) missing.push("1 número");

    if (missing.length === 0) return "";
    return `A senha precisa ter: ${missing.join(", ")}.`;
  }

  const validatePasswordSoft = () => {
    const v = passInput.value || "";

    if (!v) {
      setValid(passInput);
      if (rulesBox) {
        rulesBox.querySelectorAll(".rule").forEach((r) => r.classList.remove("ok", "bad"));
      }
      return true;
    }

    const checks = passwordChecks(v);
    updatePasswordRulesUI(checks);

    const msg = passwordErrorMessage(checks);
    if (msg) {
      setInvalid(passInput, msg);
      return false;
    }

    setValid(passInput);
    return true;
  };

  const validatePasswordHard = () => {
    const v = passInput.value || "";
    const checks = passwordChecks(v);
    updatePasswordRulesUI(checks);

    const msg = passwordErrorMessage(checks);
    if (msg) {
      setInvalid(passInput, msg);
      return false;
    }

    setValid(passInput);
    return true;
  };

  passInput.addEventListener("input", validatePasswordSoft);
  passInput.addEventListener("blur", validatePasswordHard);

  // --- 3) MOSTRAR SENHA ---
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const type = passInput.getAttribute("type") === "password" ? "text" : "password";
      passInput.setAttribute("type", type);

      const icon = toggleBtn.querySelector("i");
      if (icon) {
        icon.classList.toggle("ph-eye");
        icon.classList.toggle("ph-eye-slash");
      }
    });
  }

  // --- NOVAS FUNÇÕES (campos de telefonia) ---
  function getHasMobileValue() {
    const v = document.querySelector('input[name="has_mobile"]:checked')?.value;
    if (v === "sim") return true;
    if (v === "nao") return false;
    return null;
  }

  function setContractTypeRequired(isRequired) {
    const radios = document.querySelectorAll('input[name="contract_type"]');
    radios.forEach((r) => {
      if (isRequired) r.setAttribute("required", "required");
      else r.removeAttribute("required");
    });

    if (!isRequired) {
      radios.forEach((r) => {
        r.checked = false;
      });
    }
  }

  function toggleMobileFields() {
    const hasMobile = getHasMobileValue();

    const shouldShow = hasMobile === true;
    if (operatorGroup) operatorGroup.classList.toggle("is-hidden", !shouldShow);
    if (linesGroup) linesGroup.classList.toggle("is-hidden", !shouldShow);
    if (contractGroup) contractGroup.classList.toggle("is-hidden", !shouldShow);

    setContractTypeRequired(hasMobile === true);

    if (!shouldShow) {
      if (operatorInput) operatorInput.value = "";
      if (activeLinesInput) activeLinesInput.value = "";
      if (operatorInput) setValid(operatorInput);
      if (activeLinesInput) setValid(activeLinesInput);
    }
  }

  const validateMobileExtrasHard = () => {
    const hasMobile = getHasMobileValue();
    if (hasMobile !== true) return true;

    let ok = true;

    const op = (operatorInput?.value || "").trim();
    if (!op) {
      setInvalid(operatorInput, "Informe a operadora");
      ok = false;
    } else {
      setValid(operatorInput);
    }

    const nRaw = activeLinesInput?.value;
    const n = nRaw === "" || nRaw == null ? NaN : Number(nRaw);

    if (!Number.isInteger(n) || n < 0) {
      setInvalid(activeLinesInput, "Informe um número válido (0 ou maior)");
      ok = false;
    } else {
      setValid(activeLinesInput);
    }

    return ok;
  };

  // inicializa ocultando até escolher
  toggleMobileFields();

  document.querySelectorAll('input[name="has_mobile"]').forEach((el) => {
    el.addEventListener("change", toggleMobileFields);
  });

  if (operatorInput) operatorInput.addEventListener("blur", validateMobileExtrasHard);
  if (activeLinesInput) activeLinesInput.addEventListener("blur", validateMobileExtrasHard);

  // --- 4) SUBMIT (via /api/register) ---
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const nameValue = (document.getElementById("name")?.value || "").trim();
    const emailValue = emailInput.value.trim();
    const passwordValue = passInput.value || "";

    const docRaw = docInput.value.replace(/\D/g, "");
    const whatsapp = phoneInput.value.replace(/\D/g, "");
    const cep = getCepLimpo();

    const okDoc = validateDocHard();
    const okEmail = validateEmailHard();
    const okPass = validatePasswordHard();
    const okCep = validateCepHard();
    const okMobileExtras = validateMobileExtrasHard();

    const hasMobile = getHasMobileValue();
    const contractType =
      document.querySelector('input[name="contract_type"]:checked')?.value || "";

    if (hasMobile === null) {
      alert("Responda se sua empresa possui telefonia móvel ativa.");
      return;
    }

    if (hasMobile === true && !contractType) {
      alert("Selecione se o contrato está vinculado a CPF ou CNPJ.");
      return;
    }

    if (!okDoc || !okEmail || !okPass || !okCep || !okMobileExtras) return;

    const cepConsultado = await buscarCep(cep);
    if (!cepConsultado) {
      alert("Informe um CEP válido.");
      return;
    }

    const cidade = (cidadeInput?.value || "").trim();
    const estado = (estadoInput?.value || "").trim();

    if (!cidade || !estado) {
      setInvalid(cepInput, "Não foi possível obter cidade e estado pelo CEP");
      alert("Não foi possível obter cidade e estado pelo CEP informado.");
      return;
    }

    const btn = form.querySelector(".register-btn");
    const originalText = btn?.innerText || "Cadastrar";

    if (btn) {
      btn.innerText = "Criando conta...";
      btn.disabled = true;
    }

    try {
      const payload = {
        name: nameValue,
        email: emailValue,
        password: passwordValue,
        cpf: docRaw,
        whatsapp: whatsapp,

        // NOVOS CAMPOS
        has_mobile_service: hasMobile,
        contract_type: contractType,
        operator: (operatorInput?.value || "").trim(),
        active_lines: activeLinesInput?.value === "" ? null : Number(activeLinesInput?.value),

        // CEP / REGIÃO
        cep: cep,
        regiao: {
          cep: cep,
          cidade: cidade,
          estado: estado,
        },
      };

      const r = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const out = await r.json().catch(() => null);

      if (!r.ok || !out?.ok) {
        const err = out?.error || "unknown_error";

        if (err === "cpf_exists") {
          setInvalid(docInput, "CPF/CNPJ já cadastrado");
          alert("Este CPF/CNPJ já está cadastrado.");
          return;
        }

        if (err === "auth_error") {
          const msg = friendlyAuthMessage(out?.detail || out?.message);
          setInvalid(emailInput, msg);
          alert(msg);
          return;
        }

        if (err === "missing_fields") {
          alert("Preencha os campos obrigatórios.");
          return;
        }

        if (err === "sheets_failed") {
          alert("Cadastro indisponível no momento. Tente novamente em instantes.");
          return;
        }

        alert("Erro ao cadastrar. Verifique os dados e tente novamente.");
        return;
      }

      alert(
        "Cadastro realizado. Enviamos um link de confirmação para seu e-mail. " +
          "Confirme o link para liberar o login. Verifique também a caixa de spam."
      );
      window.location.href = "../login/login.html";
    } catch (error) {
      console.error("Erro:", error);
      alert("Erro de conexão. Tente novamente.");
    } finally {
      if (btn) {
        btn.innerText = originalText;
        btn.disabled = false;
      }
    }
  });
});