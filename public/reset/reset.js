document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("reset-form");
  const pass = document.getElementById("new-password");
  const btn = document.getElementById("save-btn");
  const rulesBox = document.getElementById("password-rules");
  const toggleBtn = document.getElementById("toggle-new-password");

  if (!form || !pass) return;

  const params = new URLSearchParams(window.location.search);
  const token = String(params.get("token") || "").trim();

  if (!token) {
    alert("Link de redefinição inválido.");
    window.location.href = "../login/login.html";
    return;
  }

  async function apiFetch(url, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };

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

    if (!validatePassword(true)) {
      return;
    }

    const originalText = btn?.innerText || "Salvar";

    try {
      if (btn) {
        btn.disabled = true;
        btn.innerText = "Salvando...";
      }

      const out = await apiFetch("/api/reset-password", {
        method: "POST",
        body: JSON.stringify({
          token,
          password: pass.value,
        }),
      });

      alert(out?.message || "Senha atualizada com sucesso. Faça login novamente.");
      window.location.href = "../login/login.html";
    } catch (err) {
      alert(err?.message || "Falha ao atualizar senha.");
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
});