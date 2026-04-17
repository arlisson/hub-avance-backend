const LOGIN_URL = "/login/login.html";
const HUB_URL = "/paginaUnificada/index.html";

const API_ME_URL = "/api/profile";
const API_LOGOUT_URL = "/api/logout";
const API_AGENT_STATUS_URL = "/api/agent/status";
const API_AGENT_KEY_URL = "/api/agent/api-key";
const API_AGENT_CHAT_URL = "/api/agent";

document.addEventListener("DOMContentLoaded", async () => {
  const chatMessages = document.getElementById("chat-messages");
  const userInput = document.querySelector(".input-container textarea");
  const sendBtn = document.querySelector(".send-btn");
  const cancelBtn = document.querySelector(".cancel-btn");
  const themeToggle = document.getElementById("theme-toggle");
  const newChatBtn = document.querySelector(".new-chat-btn");
  const userEmailEl = document.getElementById("user-email");

  const menuBtn = document.getElementById("mobile-menu-btn");
  const settingsBtn = document.getElementById("settings-btn");
  const settingsMenu = document.getElementById("settings-menu");
  const menuLogout = document.getElementById("menu-logout");
  const menuBackHub = document.getElementById("menu-back-hub");

  const modalApi = document.getElementById("modalApi");
  const btnAbrirModal = document.getElementById("btnAbrirModalSidebar");
  const btnFecharModal = document.getElementById("btnFecharModal");
  const formApi = document.getElementById("formApi");
  const inputApiKey = document.getElementById("apiKey");
  const btnMostrarSenha = document.getElementById("btnMostrarSenha");
  const mensagemApi = document.getElementById("mensagemApi");

  initSettingsMenu(settingsBtn, settingsMenu);
  initMobileSidebar(menuBtn);
  initTheme(themeToggle);

  if (!chatMessages || !userInput || !sendBtn || !newChatBtn) {
    console.warn("Elementos do chat não encontrados na tela.");
    return;
  }

  let currentUser = null;
  let isProcessing = false;

  try {
    const meResp = await apiFetch(API_ME_URL, {
      method: "GET",
    });

    if (!meResp?.ok || !meResp?.user) {
      throw new Error("Usuário não autenticado.");
    }

    currentUser = meResp.user;

    const role = String(currentUser.role || "").toLowerCase();
    const canAccess = role === "admin" || role === "administrador" || currentUser.cliente_avance === true;

    if (!canAccess) {
      window.location.href = HUB_URL;
      return;
    }

    if (userEmailEl) {
      userEmailEl.textContent = currentUser.email || "";
      userEmailEl.title = currentUser.email || "";
    }
  } catch (err) {
    console.error("Erro ao carregar usuário:", err);
    if (err?.status === 401) {
      clearAuthToken();
      window.location.href = LOGIN_URL;
      return;
    }
    appendSystemMessage(
      chatMessages,
      `Não foi possível carregar o usuário: ${extractApiError(err) || "erro desconhecido."}`
    );
    return;
  }

  const emailUser = currentUser?.email || "usuario";
  const storageKey = `agente_chat_state:${emailUser}`;
  const chatState = loadState(storageKey);

  if (!chatState.sessionId) chatState.sessionId = newSessionId();
  if (!Array.isArray(chatState.messages)) chatState.messages = [];
  saveState(storageKey, chatState);

  renderHistory(chatMessages, chatState.messages);

  await refreshAgentStatus(chatMessages);

  if (menuBackHub) {
    menuBackHub.addEventListener("click", () => {
      window.location.href = HUB_URL;
    });
  }

  if (menuLogout) {
    menuLogout.addEventListener("click", async () => {
      try {
        await apiFetch(API_LOGOUT_URL, {
          method: "POST",
        });
      } catch (err) {
        console.warn("Falha no logout remoto:", err);
      } finally {
        clearAuthToken();
        clearAgentChatSessionStorage();
        window.location.href = LOGIN_URL;
      }
    });
  }

  sendBtn.addEventListener("click", () => sendMessage());

  userInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  userInput.addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = `${this.scrollHeight}px`;
  });

  newChatBtn.addEventListener("click", () => {
    chatState.sessionId = newSessionId();
    chatState.messages = [];
    saveState(storageKey, chatState);
    chatMessages.innerHTML = "";
  });

  if (btnAbrirModal) {
    btnAbrirModal.addEventListener("click", async () => {
      resetApiFeedback();
      if (inputApiKey) inputApiKey.value = "";

      modalApi?.classList.add("active");

      try {
        const statusResp = await apiFetch(API_AGENT_STATUS_URL, {
          method: "GET",
        });

        if (statusResp?.hasApiKey && inputApiKey) {
          inputApiKey.placeholder = "Chave já cadastrada. Cole outra para substituir.";
        }
      } catch (err) {
        console.warn("Não foi possível consultar status da chave:", err);
      }
    });
  }

  const fecharModal = () => {
    modalApi?.classList.remove("active");
    resetApiFeedback();
    if (inputApiKey) {
      inputApiKey.type = "password";
    }
    const icon = btnMostrarSenha?.querySelector("i");
    if (icon) {
      icon.className = "ph ph-eye";
    }
  };

  if (btnFecharModal) {
    btnFecharModal.addEventListener("click", fecharModal);
  }

  if (modalApi) {
    modalApi.addEventListener("click", (e) => {
      if (e.target === modalApi) {
        fecharModal();
      }
    });
  }

  if (btnMostrarSenha && inputApiKey) {
    btnMostrarSenha.addEventListener("click", () => {
      const icon = btnMostrarSenha.querySelector("i");
      const isPassword = inputApiKey.type === "password";
      inputApiKey.type = isPassword ? "text" : "password";
      if (icon) {
        icon.className = isPassword ? "ph ph-eye-slash" : "ph ph-eye";
      }
    });
  }

  if (formApi) {
    formApi.addEventListener("submit", async (e) => {
      e.preventDefault();

      const apiKey = String(inputApiKey?.value || "").trim();

      if (apiKey.length < 10) {
        showApiFeedback("Por favor, insira uma chave de API válida.", "erro");
        return;
      }

      showApiFeedback("Validando e salvando chave...", "loading");

      try {
        const resp = await apiFetch(API_AGENT_KEY_URL, {
          method: "POST",
          body: { apiKey },
        });

        if (!resp?.ok) {
          throw new Error(resp?.error || "Não foi possível salvar a chave.");
        }

        showApiFeedback("Chave validada e salva com sucesso.", "sucesso");
        await refreshAgentStatus(chatMessages);

        setTimeout(() => {
          fecharModal();
        }, 1200);
      } catch (err) {
        showApiFeedback(
          `Erro: ${extractApiError(err) || "Falha na validação da chave."}`,
          "erro"
        );
      }
    });
  }

  // === MODAL: CONTEXTO DA EMPRESA ===
  const modalContexto = document.getElementById("modalContexto");
  const btnAbrirContexto = document.getElementById("btnAbrirModalContexto");
  const btnFecharContexto = document.getElementById("btnFecharModalContexto");
  const formContexto = document.getElementById("formContexto");
  const mensagemContexto = document.getElementById("mensagemContexto");
  const CONTEXTO_KEY = `apolo_contexto_empresa:${emailUser}`;

  function preencherFormContexto(saved) {
    if (!saved) return;
    const ctx = (id) => document.getElementById(id);
    if (saved.empresa)  ctx("ctx-empresa").value  = saved.empresa;
    if (saved.segmento) ctx("ctx-segmento").value = saved.segmento;
    if (saved.produto)  ctx("ctx-produto").value  = saved.produto;
    if (saved.modeloVenda) {
      const radio = document.querySelector(`input[name="ctx-modelo-venda"][value="${saved.modeloVenda}"]`);
      if (radio) radio.checked = true;
    }
    if (saved.publico) ctx("ctx-publico").value = saved.publico;
    if (Array.isArray(saved.processo)) {
      document.querySelectorAll("input[name='ctx-processo']").forEach((cb) => {
        cb.checked = saved.processo.includes(cb.value);
      });
    }
    if (saved.problema) ctx("ctx-problema").value = saved.problema;
  }

  const abrirModalContexto = async () => {
    if (mensagemContexto) {
      mensagemContexto.textContent = "";
      mensagemContexto.className = "mensagem-feedback";
    }
    modalContexto?.classList.add("active");

    // Tenta carregar do banco; usa cache localStorage como fallback imediato
    const cached = JSON.parse(localStorage.getItem(CONTEXTO_KEY) || "{}");
    preencherFormContexto(cached);

    try {
      const resp = await apiFetch("/api/agent/context", { method: "GET" });
      if (resp?.ok && resp.contexto) {
        localStorage.setItem(CONTEXTO_KEY, JSON.stringify(resp.contexto));
        preencherFormContexto(resp.contexto);
      }
    } catch {
      // falha silenciosa — mantém o que já estava preenchido pelo cache
    }
  };

  const fecharModalContexto = () => modalContexto?.classList.remove("active");

  if (btnAbrirContexto) btnAbrirContexto.addEventListener("click", abrirModalContexto);
  if (btnFecharContexto) btnFecharContexto.addEventListener("click", fecharModalContexto);
  if (formContexto) {
    formContexto.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btnSalvar = formContexto.querySelector(".btn-salvar");
      if (btnSalvar) { btnSalvar.disabled = true; btnSalvar.textContent = "Salvando..."; }

      const modeloVenda = document.querySelector("input[name='ctx-modelo-venda']:checked")?.value || "";
      if (!modeloVenda) {
        if (mensagemContexto) {
          mensagemContexto.textContent = "Selecione o modelo de venda da sua empresa.";
          mensagemContexto.className = "mensagem-feedback mensagem-erro";
        }
        if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.textContent = "Salvar Contexto"; }
        return;
      }

      const processoChecked = [...document.querySelectorAll("input[name='ctx-processo']:checked")];
      if (processoChecked.length === 0) {
        if (mensagemContexto) {
          mensagemContexto.textContent = "Selecione pelo menos um processo de vendas.";
          mensagemContexto.className = "mensagem-feedback mensagem-erro";
        }
        if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.textContent = "Salvar Contexto"; }
        return;
      }

      const data = {
        empresa:    document.getElementById("ctx-empresa").value.trim(),
        segmento:   document.getElementById("ctx-segmento").value.trim(),
        produto:    document.getElementById("ctx-produto").value.trim(),
        modeloVenda,
        publico:    document.getElementById("ctx-publico").value.trim(),
        processo:   processoChecked.map((cb) => cb.value),
        problema:   document.getElementById("ctx-problema").value.trim(),
      };

      try {
        const resp = await apiFetch("/api/agent/context", { method: "POST", body: data });
        if (!resp?.ok) throw new Error(resp?.error || "Erro ao salvar.");

        localStorage.setItem(CONTEXTO_KEY, JSON.stringify(data));

        if (mensagemContexto) {
          mensagemContexto.textContent = "Contexto salvo com sucesso!";
          mensagemContexto.className = "mensagem-feedback mensagem-sucesso";
        }
        setTimeout(fecharModalContexto, 1200);
      } catch (err) {
        if (mensagemContexto) {
          mensagemContexto.textContent = extractApiError(err) || "Não foi possível salvar. Tente novamente.";
          mensagemContexto.className = "mensagem-feedback mensagem-erro";
        }
      } finally {
        if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.textContent = "Salvar Contexto"; }
      }
    });
  }

  function setInputLocked(locked) {
    sendBtn.style.display = locked ? "none" : "flex";
    userInput.disabled = locked;
    userInput.placeholder = locked
      ? "O Apolo está pensando na resposta..."
      : "Digite sua mensagem para o Apolo...";
    if (cancelBtn) cancelBtn.style.display = locked ? "flex" : "none";
  }

  let cancelCurrentJob = null;

  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      if (cancelCurrentJob) cancelCurrentJob();
    });
  }

  async function sendMessage() {
    if (isProcessing) return;
    const text = userInput.value.trim();
    if (!text) return;

    isProcessing = true;
    setInputLocked(true);

    appendMessage(chatMessages, chatState, storageKey, "user", text);
    userInput.value = "";
    userInput.style.height = "auto";

    showLoading(chatMessages);

    let cancelled = false;
    let activeJobId = null;

    cancelCurrentJob = () => {
      cancelled = true;
      if (activeJobId) {
        fetch(`/api/agent/job/${activeJobId}`, { method: "DELETE", credentials: "include" }).catch(() => {});
      }
    };

    try {
      const startResp = await apiFetch(API_AGENT_CHAT_URL, {
        method: "POST",
        body: { chatInput: text, sessionId: chatState.sessionId },
      });

      if (!startResp?.ok) {
        throw new Error(startResp?.error || "Erro ao iniciar agente.");
      }

      activeJobId = startResp.jobId;
      const deadline = Date.now() + 3 * 60 * 1000; // 3 minutos

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));

        if (cancelled) {
          removeLoading();
          appendMessage(chatMessages, chatState, storageKey, "bot", "Resposta cancelada.");
          return;
        }

        let poll = null;
        try {
          const pollResp = await fetch(`/api/agent/result/${activeJobId}`, {
            credentials: "include",
            headers: { Accept: "application/json" },
          });
          poll = await pollResp.json().catch(() => null);
        } catch {
          continue; // erro de rede temporário, tenta de novo
        }

        if (!poll || poll?.status === "pending") continue;

        removeLoading();

        if (!poll?.ok) {
          appendMessage(chatMessages, chatState, storageKey, "bot", poll?.error || "Erro do agente.");
        } else {
          appendMessage(chatMessages, chatState, storageKey, "bot", poll?.output || "Desculpe, não entendi.");
        }
        return;
      }

      removeLoading();
      appendMessage(chatMessages, chatState, storageKey, "bot", "O agente demorou demais para responder. Tente novamente.");
    } catch (err) {
      removeLoading();
      if (err?.status === 401) {
        clearAuthToken();
        window.location.href = LOGIN_URL;
        return;
      }
      appendMessage(chatMessages, chatState, storageKey, "bot", err?.message || "Erro de conexão.");
    } finally {
      cancelCurrentJob = null;
      isProcessing = false;
      const isOnline = document.getElementById("status-dot")?.classList.contains("online");
      if (isOnline) setInputLocked(false);
    }
  }

  function showApiFeedback(text, kind = "") {
    if (!mensagemApi) return;
    mensagemApi.textContent = text;
    mensagemApi.className = "mensagem-feedback";
    if (kind === "erro") mensagemApi.classList.add("mensagem-erro");
    if (kind === "sucesso") mensagemApi.classList.add("mensagem-sucesso");
  }

  function resetApiFeedback() {
    if (!mensagemApi) return;
    mensagemApi.textContent = "";
    mensagemApi.className = "mensagem-feedback";
  }
});

function clearAuthToken() {}

async function apiFetch(url, { method = "GET", body } = {}) {
  const headers = {
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const resp = await fetch(url, {
    method,
    credentials: "include",
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

  if (!resp.ok) {
    const err = new Error(data?.error || "Erro na requisição.");
    err.response = data;
    err.status = resp.status;
    throw err;
  }

  return data;
}

async function refreshAgentStatus(chatMessages) {
  try {
    const resp = await apiFetch("/api/agent/status", {
      method: "GET",
    });

    const isOnline = !!resp?.hasApiKey;
    window.atualizarStatusAgente(isOnline);

    if (isOnline) {
      const offlineTip = document.getElementById("agent-offline-tip");
      if (offlineTip) offlineTip.remove();
    } else if (chatMessages && !document.getElementById("agent-offline-tip")) {
      appendSystemMessage(
        chatMessages,
        "O agente está offline. Cadastre uma chave Gemini na barra lateral para habilitar o Apolo.",
        "agent-offline-tip"
      );
    }
  } catch {
    window.atualizarStatusAgente(false);
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
    if (menu.hidden) open();
    else close();
  };

  btn.setAttribute("aria-expanded", "false");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });

  document.addEventListener("click", (e) => {
    const userbar = document.getElementById("sidebar-userbar");
    if (!userbar?.contains(e.target)) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
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
  document.body.classList.toggle("dark-mode", !isLight);
  updateThemeIcon(themeToggle, !isLight);

  themeToggle.addEventListener("click", () => {
    const nowLight = document.body.classList.toggle("light-mode");
    document.body.classList.toggle("dark-mode", !nowLight);
    localStorage.setItem("theme", nowLight ? "light" : "dark");
    updateThemeIcon(themeToggle, !nowLight);
  });
}

function updateThemeIcon(btn, isDark) {
  const icon = btn?.querySelector("i");
  const text = btn?.querySelector("span");

  if (icon && text) {
    icon.className = isDark ? "ph ph-sun" : "ph ph-moon";
    text.textContent = isDark ? "Modo claro" : "Modo escuro";
  }
}

function newSessionId() {
  return "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 11);
}

function loadState(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : { sessionId: null, messages: [] };
  } catch {
    return { sessionId: null, messages: [] };
  }
}

function saveState(key, state) {
  sessionStorage.setItem(key, JSON.stringify(state));
}

function renderHistory(chatMessages, messages) {
  chatMessages.innerHTML = "";
  messages.forEach((msg) => {
    appendMessage(chatMessages, null, null, msg.role, msg.text, { persist: false });
  });
}

function appendMessage(chatMessages, chatState, storageKey, role, text, opts = {}) {
  const persist = opts.persist !== false;
  const messageDiv = document.createElement("div");

  messageDiv.className = `message ${role === "user" ? "message-user" : "message-bot"}`;

  const contentHTML =
    role === "bot"
      ? (window.marked
          ? marked.parse(text)
          : `<div class="text-content">${escapeHtml(text)}</div>`)
      : `<div class="text-content">${escapeHtml(text)}</div>`;

  messageDiv.innerHTML = `<div class="message-bubble">${contentHTML}</div>`;
  chatMessages.appendChild(messageDiv);

  chatMessages.scrollTo({
    top: chatMessages.scrollHeight,
    behavior: "smooth",
  });

  if (persist && chatState && storageKey) {
    chatState.messages.push({ role, text });
    saveState(storageKey, chatState);
  }
}

function appendSystemMessage(chatMessages, text, id = "") {
  const messageDiv = document.createElement("div");
  messageDiv.className = "message message-bot";
  if (id) messageDiv.id = id;
  messageDiv.innerHTML = `<div class="message-bubble"><div class="text-content">${escapeHtml(text)}</div></div>`;
  chatMessages.appendChild(messageDiv);
}

function showLoading(chatMessages) {
  if (document.getElementById("loading-indicator")) return;

  const loadingDiv = document.createElement("div");
  loadingDiv.className = "message message-bot";
  loadingDiv.id = "loading-indicator";
  loadingDiv.innerHTML = `
    <div class="message-bubble typing-indicator">
      <span></span><span></span><span></span>
    </div>
  `;

  chatMessages.appendChild(loadingDiv);
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: "smooth" });
}

function removeLoading() {
  const loader = document.getElementById("loading-indicator");
  if (loader) loader.remove();
}

window.atualizarStatusAgente = function (isOnline) {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  const inputBtn = document.querySelector(".send-btn");
  const inputBox = document.querySelector(".input-container textarea");

  if (!dot || !text) return;

  dot.className = isOnline ? "status-dot online" : "status-dot offline";
  text.className = isOnline ? "status-text online" : "status-text offline";
  text.textContent = isOnline ? "Online" : "Offline";

  if (inputBtn) inputBtn.disabled = !isOnline;
  if (inputBox) {
    inputBox.disabled = !isOnline;
    inputBox.placeholder = isOnline
      ? "Digite sua mensagem para o Apolo..."
      : "IA offline. Conecte sua Chave API na barra lateral.";
  }
};

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[m]));
}

function extractApiError(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err?.response?.error) return String(err.response.error);
  if (err?.message) return String(err.message);
  return "";
}

function clearAgentChatSessionStorage() {
  Object.keys(sessionStorage)
    .filter((k) => k.startsWith("agente_chat_state:"))
    .forEach((k) => sessionStorage.removeItem(k));
}