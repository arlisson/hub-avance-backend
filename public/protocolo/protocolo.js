document.addEventListener("DOMContentLoaded", async () => {
  const LOGIN_URL = "/login/login.html";
  const HUB_URL = "/hub/hub.html";

  let sb;
  let session;

  // Supabase guard
  try {
    sb = await window.getSupabaseClient();
  } catch {
    window.location.href = LOGIN_URL;
    return;
  }

  try {
    const { data: sessionData, error: sessionError } = await sb.auth.getSession();

    if (sessionError || !sessionData?.session) {
      window.location.href = LOGIN_URL;
      return;
    }

    session = sessionData.session;
  } catch {
    window.location.href = LOGIN_URL;
    return;
  }

  const user = session.user;
  const email = user?.email || "";

  // Permissão de acesso ao protocolo
  try {
    const { data: profile, error: profileError } = await sb
      .from("profiles")
      .select("protocol")
      .eq("id", user.id)
      .single();

    if (profileError) {
      throw profileError;
    }

    if (!profile?.protocol) {
      alert("Você não tem permissão para acessar o Gerador de Protocolo.");
      window.location.href = HUB_URL;
      return;
    }
  } catch (err) {
    console.error("Erro ao validar permissão de protocolo:", err);
    alert("Não foi possível validar sua permissão de acesso.");
    window.location.href = HUB_URL;
    return;
  }

  const userEmailEl = document.getElementById("user-email");
  if (userEmailEl) {
    userEmailEl.textContent = email;
    userEmailEl.title = email;
  }

  // Menus e tema
  initSettingsMenu(
    document.getElementById("settings-btn"),
    document.getElementById("settings-menu")
  );
  initMobileSidebar(document.getElementById("mobile-menu-btn"));
  initTheme(document.getElementById("theme-toggle"));

  // Logout
  const menuLogout = document.getElementById("menu-logout");
  if (menuLogout) {
    menuLogout.addEventListener("click", async () => {
      try {
        await sb.auth.signOut();
      } finally {
        window.location.href = LOGIN_URL;
      }
    });
  }

  // Form
  const phoneEl = document.getElementById("phone");
  const agentEl = document.getElementById("agent");
  const channelEl = document.getElementById("channel");

  // Picker de empresa
  const orgPickerWrap = document.getElementById("orgPickerWrap");
  const orgPicker = document.getElementById("orgPicker");

  const btnGenerate = document.getElementById("btn-generate");
  const btnClear = document.getElementById("btn-clear");

  const resultBox = document.getElementById("result");
  const errorBox = document.getElementById("errorBox");
  const protoEl = document.getElementById("proto");
  const sheetStatusEl = document.getElementById("sheetStatus");
  const agendorStatusEl = document.getElementById("agendorStatus");
  const msgEl = document.getElementById("msg");

  const btnCopyProto = document.getElementById("btn-copy-proto");
  const btnCopyMsg = document.getElementById("btn-copy-msg");

  function hideOrgPicker() {
    if (!orgPickerWrap || !orgPicker) return;
    orgPicker.innerHTML = "";
    orgPickerWrap.hidden = true;
  }

  const menuBackHub = document.getElementById("menu-back-hub");
  if (menuBackHub) {
    menuBackHub.addEventListener("click", () => {
      window.location.href = HUB_URL;
    });
  }

  function showOrgPicker(matches) {
    if (!orgPickerWrap || !orgPicker) return;

    orgPicker.innerHTML = "";

    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "Selecione...";
    orgPicker.appendChild(ph);

    for (const m of matches || []) {
      const opt = document.createElement("option");
      opt.value = m.key || "";
      opt.textContent = m.label || "";
      orgPicker.appendChild(opt);
    }

    orgPicker.value = "";
    orgPickerWrap.hidden = false;
  }

  function clearFeedback() {
    if (resultBox) resultBox.hidden = true;
    if (errorBox) {
      errorBox.hidden = true;
      errorBox.textContent = "";
    }
  }

  btnClear?.addEventListener("click", () => {
    if (phoneEl) phoneEl.value = "";
    if (agentEl) agentEl.value = "";
    if (channelEl) channelEl.value = "whatsapp";
    if (msgEl) msgEl.value = "";

    if (protoEl) protoEl.textContent = "";
    if (sheetStatusEl) sheetStatusEl.textContent = "";
    if (agendorStatusEl) agendorStatusEl.textContent = "";

    hideOrgPicker();
    clearFeedback();
  });

  async function callApi(payload) {
    const token = session.access_token;

    const resp = await fetch("/api/protocolo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const raw = await resp.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { error: raw };
    }

    return { resp, data };
  }

  btnGenerate?.addEventListener("click", async (e) => {
    e.preventDefault();

    try {
      clearFeedback();

      const phoneRaw = (phoneEl?.value || "").trim();
      const phone = digitsOnly(phoneRaw);

      if (phone.length < 10) {
        throw new Error("Informe um telefone válido com DDD.");
      }

      btnGenerate.disabled = true;

      const selectedPick =
        orgPicker && orgPickerWrap && !orgPickerWrap.hidden
          ? (orgPicker.value || "")
          : "";

      const payload = {
        phone,
        phoneRaw,
        agent: (agentEl?.value || "").trim(),
        channel: channelEl?.value || "whatsapp",
        agendorPick: selectedPick || undefined,
        requestedBy: email,
      };

      AppLoading.show({
        title: "Gerando protocolo",
        message: "Aguarde..."
      });

     

      const { resp, data } = await callApi(payload);

      // Caso queira tratar múltiplos registros futuramente, pode reativar este bloco:
      /*
      if (resp.status === 409 && Array.isArray(data?.matches)) {
        AppLoading.update({
          title: "Seleção necessária",
          message: "Foram encontrados múltiplos registros."
        });

        showOrgPicker(data.matches);

        const maybeProtocol = data?.protocol ? ` Protocolo gerado: ${data.protocol}` : "";
        throw new Error((data?.error || "Mais de um registro encontrado.") + maybeProtocol);
      }
      */

      if (!resp.ok) {
        const maybeProtocol = data?.protocol ? `\nProtocolo gerado: ${data.protocol}` : "";
        throw new Error((data?.error || "Falha ao gerar protocolo.") + maybeProtocol);
      }

     
      hideOrgPicker();

      const protocol = data?.protocol || "";

      if (protoEl) {
        protoEl.textContent = protocol;
      }

      if (sheetStatusEl) {
        sheetStatusEl.textContent = data?.sheets?.ok
          ? "Registrado"
          : (data?.sheets?.detail || "Falhou");
      }

      if (agendorStatusEl) {
        agendorStatusEl.textContent = data?.agendor?.sent
          ? "Enviado"
          : (data?.agendor?.detail || "Não enviado");
      }

      if (msgEl) {
        msgEl.value = buildMessage(protocol);
      }

      if (resultBox) {
        resultBox.hidden = false;
      }
    } catch (e) {
      if (errorBox) {
        errorBox.textContent = e?.message || "Erro.";
        errorBox.hidden = false;
      }
    } finally {
      AppLoading.hide();
      if (btnGenerate) btnGenerate.disabled = false;
    }
  });

  btnCopyProto?.addEventListener("click", async () => {
    const t = protoEl?.textContent || "";
    if (!t) return;
    await navigator.clipboard.writeText(t);
  });

  btnCopyMsg?.addEventListener("click", async () => {
    const t = msgEl?.value || "";
    if (!t) return;
    await navigator.clipboard.writeText(t);
  });
});

function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

function buildMessage(protocol) {
  return `Seu atendimento foi registrado sob o protocolo ${protocol}. Guarde este número para confirmar a autenticidade em novos contatos.`;
}

// -------------------------
// Padrões do Hub/Agente
// -------------------------
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
    // ATENÇÃO: Substitua os caminhos abaixo pelos nomes corretos dos seus arquivos!
    if (!isLight) {
      // Logo para quando o fundo estiver ESCURO (Geralmente a logo com letras brancas/claras)
      logo.src = "../img/LogoEscuroSemFundo.png"; 
    } else {
      // Logo para quando o fundo estiver CLARO (Geralmente a logo com letras escuras/pretas)
      logo.src = "../img/LogoClaraSemFundo.png"; 
    }
  }
}