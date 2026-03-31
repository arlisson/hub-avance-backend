// login.js — versão para Express/MySQL
// Mantém: verificação de elementos, toggle de tema, toggle de senha e submit.
// Remove: dependência do Supabase no frontend.

const WHATSAPP_NUMBER = "5522988124656";

function buildWhatsAppUrl(message) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

function initHelpWhatsApp() {
  const btn = document.getElementById("help-whatsapp");
  if (!btn) return;

  const message =
    "Olá! Estou na tela de login da AVANCE e preciso de ajuda para acessar minha conta.";

  btn.href = buildWhatsAppUrl(message);
}

function validarEmail(email) {
  const v = String(email || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

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

function setValid(inputEl) {
  const group = inputEl?.closest?.(".input-group");
  if (!group) return;

  group.classList.remove("is-invalid");
  const err = group.querySelector(".input-error");
  if (err) err.textContent = "";
}

function salvarToken() {}
function obterToken() { return null; }
function removerToken() {}

async function fetchComErroTratado(url, options = {}) {
  const resp = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  let data = null;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }

  if (!resp.ok) {
    const error = new Error(
      data?.error ||
      data?.message ||
      `Erro na requisição (${resp.status})`
    );

    error.status = resp.status;
    error.data = data;
    throw error;
  }

  return data;
}

document.addEventListener("DOMContentLoaded", async () => {
  const themeToggle = document.getElementById("theme-toggle");
  const identifierInput = document.getElementById("identifier");
  const passwordInput = document.getElementById("password");
  const loginForm = document.getElementById("login-form");
  const toggleBtn = document.getElementById("toggle-password");
  const forgotLink = document.getElementById("forgot-password-link");

  function updateThemeIcon(isDark) {
    const icon = themeToggle?.querySelector("i");
    if (icon) icon.className = isDark ? "ph ph-sun" : "ph ph-moon";
  }

  const isDarkOnLoad = localStorage.getItem("theme") !== "light";
  document.body.classList.toggle("dark-mode", isDarkOnLoad);
  updateThemeIcon(isDarkOnLoad);

  themeToggle?.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark-mode");
    localStorage.setItem("theme", isDark ? "dark" : "light");
    updateThemeIcon(isDark);
  });

  initHelpWhatsApp();

  if (!identifierInput || !passwordInput || !loginForm) return;

  try {
    const me = await fetchComErroTratado("/api/me", {
      method: "GET",
      credentials: "include",
    });

    if (me?.ok) {
      window.location.href = "/paginaUnificada/index.html";
      return;
    }
  } catch {
    // sessão inválida, permanece na tela de login
  }

  identifierInput.addEventListener("input", () => {
    const v = identifierInput.value.trim();

    if (!v) {
      setValid(identifierInput);
      return;
    }

    if (!validarEmail(v)) {
      setInvalid(identifierInput, "E-mail inválido");
      return;
    }

    setValid(identifierInput);
  });

  identifierInput.addEventListener("blur", () => {
    const v = identifierInput.value.trim();

    if (!validarEmail(v)) {
      setInvalid(identifierInput, "E-mail inválido");
      return;
    }

    setValid(identifierInput);
  });

  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const type =
        passwordInput.getAttribute("type") === "password" ? "text" : "password";
      passwordInput.setAttribute("type", type);

      const icon = toggleBtn.querySelector("i");
      if (icon) {
        icon.classList.replace(
          type === "text" ? "ph-eye" : "ph-eye-slash",
          type === "text" ? "ph-eye-slash" : "ph-eye",
        );
      }
    });
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = document.querySelector(".login-btn");
    const originalText = btn?.innerText || "Entrar";

    const email = (identifierInput.value || "").trim();
    const password = passwordInput.value || "";

    if (!validarEmail(email)) {
      setInvalid(identifierInput, "E-mail inválido");
      return;
    }
    setValid(identifierInput);

    if (!password) {
      alert("Informe sua senha.");
      return;
    }

    if (btn) {
      btn.innerText = "Entrando...";
      btn.disabled = true;
    }

    try {
      const data = await fetchComErroTratado("/api/login", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (!data?.token) {
        throw new Error("Token não retornado pelo servidor.");
      }

      window.location.href = "/paginaUnificada/index.html";
    } catch (error) {
      if (error?.status === 403) {
        alert("Confirme seu e-mail antes de fazer login. Verifique sua caixa de entrada e também o spam.");
        return;
      }

      if (error?.status === 401) {
        alert("E-mail ou senha inválidos.");
        return;
      }

      alert(`Erro: ${error?.message || "Falha no login."}`);
    } finally {
      if (btn) {
        btn.innerText = originalText;
        btn.disabled = false;
      }
    }
  });

 
  if (forgotLink) {
    forgotLink.addEventListener("click", async (e) => {
      e.preventDefault();

      const email = (identifierInput.value || "").trim().toLowerCase();

      if (!validarEmail(email)) {
        alert("Digite seu e-mail no campo \"E-mail\" para receber o link de redefinição.");
        return;
      }

      try {
        await fetchComErroTratado("/api/forgot-password", {
          method: "POST",
          body: JSON.stringify({ email }),
        });

        alert("Se esse e-mail existir e estiver cadastrado no sistema, enviaremos um link para redefinir a senha.");
      } catch (error) {
        alert(error?.message || "Não foi possível solicitar a redefinição de senha.");
      }
    });
  }
});