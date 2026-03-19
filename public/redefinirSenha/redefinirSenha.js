document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("reset-form");
  const pass = document.getElementById("new-password");
  const currentPassInput = document.getElementById("current-password");
  const btn = document.getElementById("save-btn");
  const rulesBox = document.getElementById("password-rules");
  const toggleBtn = document.getElementById("toggle-new-password");
  const toggleCurrentBtn = document.getElementById("toggle-current-password");

  // [NOVO] Verifica se o utilizador já tem sessão iniciada para adaptar o botão "Voltar"
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

    const currentPass = currentPassInput ? currentPassInput.value : "";
    const newPass = pass.value;

    if (!currentPass) {
      alert("Por favor, digite a sua senha atual.");
      return;
    }

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

    if (btn) {
      btn.disabled = true;
      btn.innerText = "Verificando...";
    }

    try {
      // 1. Pega o email do utilizador com sessão iniciada
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError || !session) {
        throw new Error("Sessão expirada. Inicie sessão novamente.");
      }

      const userEmail = session.user.email;

      // 2. Tenta "iniciar sessão" novamente apenas para validar se a senha atual está correta
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: currentPass,
      });

      if (signInError) {
        throw new Error("A senha atual está incorreta.");
      }

      // 3. Se a senha atual estiver correta, atualizamos para a nova
      if (btn) btn.innerText = "Atualizando...";
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPass,
      });

      if (updateError) throw updateError;

      alert("Senha atualizada com sucesso! Inicie sessão com a sua nova senha.");
      
      // Termina a sessão do utilizador e envia para o ecrã de login
      await supabase.auth.signOut();
      window.location.href = "../login/login.html";

    } catch (err) {
      alert(err?.message || "Falha ao atualizar a senha.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerText = "Salvar";
      }
    }
  });

  // Toggle do campo da NOVA senha
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const isPassword = pass.type === "password";
      pass.type = isPassword ? "text" : "password";

      toggleBtn.innerHTML = isPassword
        ? '<i class="ph ph-eye-slash"></i>'
        : '<i class="ph ph-eye"></i>';
    });
  }

  // Toggle do campo da SENHA ATUAL
  if (toggleCurrentBtn && currentPassInput) {
    toggleCurrentBtn.addEventListener("click", () => {
      const isPassword = currentPassInput.type === "password";
      currentPassInput.type = isPassword ? "text" : "password";

      toggleCurrentBtn.innerHTML = isPassword
        ? '<i class="ph ph-eye-slash"></i>'
        : '<i class="ph ph-eye"></i>';
    });
  }
});