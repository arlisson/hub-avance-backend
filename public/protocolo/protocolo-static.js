const LOGIN_URL = "/login/login.html";
const HUB_URL = "/hub/hub.html";

const API_ME_URL = "/api/profile";
const API_LOGOUT_URL = "/api/logout";

document.addEventListener("DOMContentLoaded", async () => {
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

  try {
    const token = getAccessToken();

    if (!token) {
      window.location.href = LOGIN_URL;
      return;
    }

    const meResp = await apiFetch(API_ME_URL, {
      method: "GET",
      token,
    });

    if (!meResp?.ok || !meResp?.user) {
      throw new Error("Usuário não autenticado.");
    }

    const user = meResp.user;

    if (userEmailEl) {
      userEmailEl.textContent = user.email || "";
      userEmailEl.title = user.email || "";
    }
  } catch (err) {
    console.error("Erro ao carregar usuário:", err);

    if (errorBox) {
      errorBox.textContent =
        extractApiError(err) || "Não foi possível carregar os dados do usuário.";
      errorBox.hidden = false;
    }

    const status = err?.status;
    if (status === 401) {
      clearAuthToken();
      window.location.href = LOGIN_URL;
      return;
    }
  }

  initSettingsMenu(
    document.getElementById("settings-btn"),
    document.getElementById("settings-menu")
  );
  initMobileSidebar(document.getElementById("mobile-menu-btn"));
  initTheme(document.getElementById("theme-toggle"));

  if (menuBackHub) {
    menuBackHub.addEventListener("click", () => {
      window.location.href = HUB_URL;
    });
  }

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

  if (btnClear) {
    btnClear.addEventListener("click", () => {
      clearResultFields();
      clearFeedback();
    });
  }

  if (btnGenerate) {
    btnGenerate.addEventListener("click", (e) => {
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
        console.error("Erro ao gerar protocolo:", error);

        if (errorBox) {
          errorBox.textContent =
            error?.message || "Erro ao gerar protocolo.";
          errorBox.hidden = false;
        }
      }
    });
  }

  if (btnCopyProto) {
    btnCopyProto.addEventListener("click", async () => {
      const text = protoEl?.textContent || "";
      if (!text) return;

      try {
        await navigator.clipboard.writeText(text);
      } catch {
        fallbackCopy(text);
      }
    });
  }

  if (btnCopyMsg) {
    btnCopyMsg.addEventListener("click", async () => {
      const text = msgEl?.value || "";
      if (!text) return;

      try {
        await navigator.clipboard.writeText(text);
      } catch {
        fallbackCopy(text);
      }
    });
  }
});

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