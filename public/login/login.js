// login.js — versão para Express/MySQL
// Mantém: verificação de elementos, toggle de tema, toggle de senha e submit.
// Remove: dependência do Supabase no frontend.

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

function salvarToken(token) {
  localStorage.setItem("auth_token", token);
}

function obterToken() {
  return localStorage.getItem("auth_token");
}

function removerToken() {
  localStorage.removeItem("auth_token");
}

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
    const message =
      data?.error ||
      data?.message ||
      `Erro na requisição (${resp.status})`;
    throw new Error(message);
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

  if (!identifierInput || !passwordInput || !loginForm) return;

  try {
    const token = obterToken();

    if (token) {
      const me = await fetchComErroTratado("/api/me", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (me?.ok) {
        window.location.href = "/hub/hub.html";
        return;
      }
    }
  } catch {
    removerToken();
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
        body: JSON.stringify({ email, password }),
      });

      if (!data?.token) {
        throw new Error("Token não retornado pelo servidor.");
      }

      salvarToken(data.token);
      window.location.href = "/hub/hub.html";
    } catch (error) {
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

      const email = (identifierInput.value || "").trim();

      if (!validarEmail(email)) {
        alert("Digite seu e-mail no campo acima para redefinir a senha.");
        return;
      }

      try {
        await fetchComErroTratado("/api/forgot-password", {
          method: "POST",
          body: JSON.stringify({ email }),
        });

        alert("Se esse e-mail existir e estiver cadastrado no sistema, enviaremos as instruções de redefinição.");
      } catch (error) {
        alert(error?.message || "Não foi possível solicitar a redefinição de senha.");
      }
    });
  }
});