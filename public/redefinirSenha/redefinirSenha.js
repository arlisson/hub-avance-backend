// redefinirSenha.js
document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("reset-form");
  const pass = document.getElementById("new-password");
  const currentPassInput = document.getElementById("current-password");
  const btn = document.getElementById("save-btn");
  const rulesBox = document.getElementById("password-rules");
  const toggleBtn = document.getElementById("toggle-new-password");
  const toggleCurrentBtn = document.getElementById("toggle-current-password");

  if (!form || !pass || !currentPassInput) return;

  async function apiFetch(url, options = {}) {
    const token = localStorage.getItem("auth_token");

    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const resp = await fetch(url, {
      ...options,
      headers,
    });

    const data = await resp.json().catch(() => null);

    if (!resp.ok) {
      throw new Error(data?.error || data?.message || `Erro ${resp.status}`);
    }

    return data;
  }

  try {
    const me = await apiFetch("/api/me", { method: "GET" });
    if (!me?.ok || !me?.user) {
      throw new Error("Sessão inválida.");
    }
  } catch (err) {
    alert("Sua sessão expirou. Faça login novamente.");
    localStorage.removeItem("auth_token");
    window.location.href = "../login/login.html";
    return;
  }

  function passwordChecks(pw) {
    const value = String(pw || "");
    return {
      len: value.length >= 8,
      digit: /\d/.test(value),
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


  function clearPasswordRulesUI() {
    if (!rulesBox) return;
    rulesBox.querySelectorAll(".rule").forEach((el) => {
      el.classList.remove("ok", "bad");
    });
  }

  function getPasswordErrorMessage(checks) {
    const missing = [];

    if (!checks.len) missing.push("mínimo de 8 caracteres");
    if (!checks.digit) missing.push("pelo menos 1 número");

    if (!missing.length) return "";
    return `A senha precisa ter ${missing.join(" e ")}.`;
  }

  function validatePassword(showAlert = false) {
    const value = pass.value || "";

    if (!value) {
      clearPasswordRulesUI();
      if (showAlert) {
        alert("Digite a nova senha.");
      }
      return false;
    }

    const checks = passwordChecks(value);
    updatePasswordRulesUI(checks);

    const message = getPasswordErrorMessage(checks);
    if (message) {
      if (showAlert) {
        alert(message);
      }
      return false;
    }

    return true;
  }

  pass.addEventListener("input", () => {
    const value = pass.value || "";
    if (!value) {
      clearPasswordRulesUI();
      return;
    }
    validatePassword(false);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const currentPass = currentPassInput.value || "";
    const newPass = pass.value || "";

    if (!currentPass) {
      alert("Por favor, digite sua senha atual.");
      return;
    }

    if (!validatePassword(true)) {
      return;
    }

    const originalText = btn?.innerText || "Salvar";

    try {
      if (btn) {
        btn.disabled = true;
        btn.innerText = "Atualizando...";
      }

      const out = await apiFetch("/api/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: currentPass,
          newPassword: newPass,
        }),
      });

      alert(out?.message || "Senha atualizada com sucesso. Faça login novamente.");

      localStorage.removeItem("auth_token");
      window.location.href = "../login/login.html";
    } catch (err) {
      alert(err?.message || "Falha ao atualizar a senha.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerText = originalText;
      }
    }
  });

  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const isPassword = pass.type === "password";
      pass.type = isPassword ? "text" : "password";

      toggleBtn.innerHTML = isPassword
        ? '<i class="ph ph-eye-slash"></i>'
        : '<i class="ph ph-eye"></i>';
    });
  }

  if (toggleCurrentBtn) {
    toggleCurrentBtn.addEventListener("click", () => {
      const isPassword = currentPassInput.type === "password";
      currentPassInput.type = isPassword ? "text" : "password";

      toggleCurrentBtn.innerHTML = isPassword
        ? '<i class="ph ph-eye-slash"></i>'
        : '<i class="ph ph-eye"></i>';
    });
  }
});