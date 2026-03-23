document.addEventListener("DOMContentLoaded", () => {
  const LOGIN_URL = "/login/login.html";
  const HUB_URL = "/hub/hub.html";

  const userEmailEl = document.getElementById("user-email");
  const menuBackHub = document.getElementById("menu-back-hub");
  const menuLogout = document.getElementById("menu-logout");

  const btnGenerate = document.getElementById("btn-generate");
  const btnClear = document.getElementById("btn-clear");

  const resultBox = document.getElementById("result");
  const errorBox = document.getElementById("errorBox");
  const protoEl = document.getElementById("proto");
  const msgEl = document.getElementById("msg");

  const btnCopyProto = document.getElementById("btn-copy-proto");
  const btnCopyMsg = document.getElementById("btn-copy-msg");

  initSettingsMenu(
    document.getElementById("settings-btn"),
    document.getElementById("settings-menu")
  );
  initMobileSidebar(document.getElementById("mobile-menu-btn"));
  initTheme(document.getElementById("theme-toggle"));
  loadUserEmail(userEmailEl);

  menuBackHub?.addEventListener("click", () => {
    window.location.href = HUB_URL;
  });

  menuLogout?.addEventListener("click", () => {
    clearAuthData();
    window.location.href = LOGIN_URL;
  });

  function clearFeedback() {
    if (resultBox) {
      resultBox.hidden = true;
    }

    if (errorBox) {
      errorBox.hidden = true;
      errorBox.textContent = "";
    }
  }

  function clearResultFields() {
    if (protoEl) {
      protoEl.textContent = "";
    }

    if (msgEl) {
      msgEl.value = "";
    }
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
    } catch (error) {
      if (errorBox) {
        errorBox.textContent =
          error?.message || "Erro ao gerar protocolo.";
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

function loadUserEmail(userEmailEl) {
  if (!userEmailEl) return;

  const possibleDirectKeys = [
    "userEmail",
    "email",
    "usuarioEmail",
    "user_email",
  ];

  for (const key of possibleDirectKeys) {
    const value = localStorage.getItem(key);
    if (value && String(value).trim()) {
      const email = String(value).trim();
      userEmailEl.textContent = email;
      userEmailEl.title = email;
      return;
    }
  }

  const possibleJsonKeys = [
    "auth",
    "user",
    "session",
    "login",
    "currentUser",
    "profile",
  ];

  for (const key of possibleJsonKeys) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);

      const email =
        parsed?.email ||
        parsed?.user?.email ||
        parsed?.usuario?.email ||
        parsed?.profile?.email ||
        parsed?.user_email ||
        parsed?.usuario_email ||
        "";

      if (email && String(email).trim()) {
        const finalEmail = String(email).trim();
        userEmailEl.textContent = finalEmail;
        userEmailEl.title = finalEmail;
        return;
      }
    } catch {
      // ignora JSON inválido
    }
  }

  userEmailEl.textContent = "Usuário";
  userEmailEl.title = "Usuário";
}

function clearAuthData() {
  const keysToRemove = [
    "token",
    "authToken",
    "accessToken",
    "jwt",
    "jwtToken",
    "auth",
    "user",
    "session",
    "login",
    "currentUser",
    "profile",
    "userEmail",
    "email",
    "usuarioEmail",
    "user_email",
  ];

  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }
}

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
  temp.setAttribute("readonly", "");
  temp.style.position = "fixed";
  temp.style.left = "-9999px";
  temp.style.top = "0";
  document.body.appendChild(temp);
  temp.focus();
  temp.select();

  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(temp);
  }
}

function initSettingsMenu(btn, menu) {
  if (!btn || !menu) return;

  const close = () => {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };

  const open = () => {
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  };

  const toggle = () => {
    if (menu.hidden) {
      open();
    } else {
      close();
    }
  };

  btn.setAttribute("aria-expanded", "false");

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
    logo.src = isLight
      ? "../img/LogoClaraSemFundo.png"
      : "../img/LogoEscuroSemFundo.png";
  }
}