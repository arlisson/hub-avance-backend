document.addEventListener("DOMContentLoaded", async () => {

  try {
    const sb = await window.getSupabaseClient();
    const { data } = await sb.auth.getSession();
    
    if (data?.session) {
      const backLink = document.querySelector(".back-link");
      if (backLink) {
        backLink.href = "../hub/hub.html";
        backLink.textContent = "Voltar para o Início";
      }
    }
  } catch (err) {
    console.warn("Não foi possível verificar a sessão no carregamento.", err);
  }

  const form = document.getElementById("reset-form");
  const pass = document.getElementById("new-password");
  const btn = document.getElementById("save-btn");
  const rulesBox = document.getElementById("password-rules");
  const toggleBtn = document.getElementById("toggle-new-password");

  if (!form || !pass) return;

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

    let supabase;
    try {
      supabase = await window.getSupabaseClient();
    } catch (err) {
      alert(err?.message || "Cliente Supabase não inicializado.");
      return;
    }

    if (btn) btn.disabled = true;

    try {
      const { error } = await supabase.auth.updateUser({
        password: pass.value,
      });

      if (error) throw error;

      alert("Senha atualizada com sucesso. Faça login novamente.");
      window.location.href = "../login/login.html";
    } catch (err) {
      alert(err?.message || "Falha ao atualizar senha.");
    } finally {
      if (btn) btn.disabled = false;
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