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

  const btnGenerate = document.getElementById("btn-generate");
  const btnClear = document.getElementById("btn-clear");

  const resultBox = document.getElementById("result");
  const errorBox = document.getElementById("errorBox");
  const protoEl = document.getElementById("proto");
  const msgEl = document.getElementById("msg");

  const btnCopyProto = document.getElementById("btn-copy-proto");
  const btnCopyMsg = document.getElementById("btn-copy-msg");

  const menuBackHub = document.getElementById("menu-back-hub");
  if (menuBackHub) {
    menuBackHub.addEventListener("click", () => {
      window.location.href = HUB_URL;
    });
  }

  function clearFeedback() {
    if (resultBox) resultBox.hidden = true;
    if (errorBox) {
      errorBox.hidden = true;
      errorBox.textContent = "";
    }
  }

  function clearResultFields() {
    if (protoEl) protoEl.textContent = "";
    if (msgEl) msgEl.value = "";
  }

  btnClear?.addEventListener("click", () => {
    clearResultFields();
    clearFeedback();
  });

  btnGenerate?.addEventListener("click", (e) => {
    e.preventDefault();

    try {
      clearFeedback();
      clearResultFields();

      const protocol = generateProtocol();

      if (protoEl) {
        protoEl.textContent = protocol;
      }

      if (msgEl) {
        msgEl.value = buildMessage(protocol);
      }

      if (resultBox) {
        resultBox.hidden = false;
      }
    } catch (e) {
      if (errorBox) {
        errorBox.textContent = e?.message || "Erro ao gerar protocolo.";
        errorBox.hidden = false;
      }
    }
  });

  btnCopyProto?.addEventListener("click", async () => {
    const text = protoEl?.textContent || "";
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      fallbackCopy(text);
    }
  });

  btnCopyMsg?.addEventListener("click", async () => {
    const text = msgEl?.value || "";
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      fallbackCopy(text);
    }
  });
});

function generateProtocol() {
  const now = new Date();

  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  return `${dd}${mm}${yy}${hh}${mi}${ss}`;
}

function buildMessage(protocol) {
  return `Seu atendimento foi registrado sob o protocolo ${protocol}. Guarde este número para confirmar a autenticidade em novos contatos.`;
}

function fallbackCopy(text) {
  const temp = document.createElement("textarea");
  temp.value = text;
  temp.style.position = "fixed";
  temp.style.left = "-9999px";
  document.body.appendChild(temp);
  temp.focus();
  temp.select();
  document.execCommand("copy");
  document.body.removeChild(temp);
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
    if (!isLight) {
      logo.src = "../img/LogoEscuroSemFundo.png";
    } else {
      logo.src = "../img/LogoClaraSemFundo.png";
    }
  }
}