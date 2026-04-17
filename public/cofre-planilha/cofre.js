const LOGIN_URL = "/login/login.html";
const HUB_URL   = "/paginaUnificada/index.html";

// ── SESSION ID ───────────────────────────────────────────
let sessionId = localStorage.getItem("cofre_session_id");
if (!sessionId) {
  sessionId = crypto.randomUUID();
  localStorage.setItem("cofre_session_id", sessionId);
}

function cofreHeaders() {
  return { "x-session-id": sessionId };
}

// ── API FETCH (mesmo padrão das demais ferramentas) ──────
async function apiFetch(url, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const resp = await fetch(url, {
    method,
    credentials: "include",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { data = { ok: false, error: text || "Resposta inválida." }; }

  if (!resp.ok) {
    const err = new Error(data?.error || "Erro na requisição.");
    err.status = resp.status;
    throw err;
  }
  return data;
}

// ── INIT ─────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const themeToggle  = document.getElementById("theme-toggle");
  const settingsBtn  = document.getElementById("settings-btn");
  const settingsMenu = document.getElementById("settings-menu");
  const menuBackHub  = document.getElementById("menu-back-hub");
  const menuLogout   = document.getElementById("menu-logout");
  const mobileMenuBtn = document.getElementById("mobile-menu-btn");
  const userEmailEl  = document.getElementById("user-email");

  initTheme(themeToggle);
  initSettingsMenu(settingsBtn, settingsMenu);
  initMobileSidebar(mobileMenuBtn);

  menuBackHub?.addEventListener("click", () => { window.location.href = HUB_URL; });
  menuLogout?.addEventListener("click", async () => {
    try { await apiFetch("/api/logout", { method: "POST" }); } catch {}
    window.location.href = LOGIN_URL;
  });

  // Auth guard
  try {
    const me = await apiFetch("/api/profile");
    if (!me?.ok || !me?.user) throw new Error("Não autenticado.");
    if (userEmailEl) {
      userEmailEl.textContent = me.user.email || "";
      userEmailEl.title = me.user.email || "";
    }
  } catch (err) {
    window.location.href = LOGIN_URL;
    return;
  }

  // Carrega estado inicial
  await carregarLista();
  await carregarColunas();

  // Limpa sessão ao fechar aba
  window.addEventListener("beforeunload", () => {
    fetch("/api/planilhas", {
      method: "DELETE",
      headers: cofreHeaders(),
      keepalive: true,
    }).catch(() => {});
  });
});

// ── UPLOAD ───────────────────────────────────────────────
const uploadArea   = document.getElementById("upload-area");
const fileInput    = document.getElementById("file-input");
const uploadStatus = document.getElementById("upload-status");

uploadArea?.addEventListener("click", () => fileInput.click());

uploadArea?.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadArea.classList.add("drag-over");
});
uploadArea?.addEventListener("dragleave", () => uploadArea.classList.remove("drag-over"));
uploadArea?.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadArea.classList.remove("drag-over");
  handleFiles(e.dataTransfer.files);
});
fileInput?.addEventListener("change", () => handleFiles(fileInput.files));

async function handleFiles(files) {
  for (const file of files) {
    setStatus("Enviando " + file.name + "…", "");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/planilhas/upload", {
        method: "POST",
        headers: cofreHeaders(),
        credentials: "include",
        body: fd,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setStatus(`${file.name} — ${data.linhas} linhas carregadas`, "ok");
    } catch (err) {
      setStatus("Erro: " + err.message, "err");
    }
  }
  if (fileInput) fileInput.value = "";
  await carregarLista();
  await carregarColunas();
}

function setStatus(msg, tipo) {
  if (!uploadStatus) return;
  uploadStatus.textContent = msg;
  uploadStatus.className = "upload-status" + (tipo ? " " + tipo : "");
}

// ── LISTA DE PLANILHAS ────────────────────────────────────
async function carregarLista() {
  const fileList = document.getElementById("file-list");
  if (!fileList) return;
  try {
    const res = await fetch("/api/planilhas", {
      headers: cofreHeaders(),
      credentials: "include",
    });
    const data = await res.json();
    if (!data.ok) return;

    fileList.innerHTML = "";
    if (!data.planilhas.length) {
      fileList.innerHTML = '<li class="file-list-empty">Nenhuma planilha carregada.</li>';
      return;
    }

    for (const p of data.planilhas) {
      const li = document.createElement("li");
      li.className = "file-item";
      li.innerHTML = `
        <i class="ph ph-file-xls" style="color:var(--accent-cyan);flex-shrink:0"></i>
        <span class="file-item-name" title="${escHtml(p.nome_arquivo)}">${escHtml(p.nome_arquivo)}</span>
        <button class="btn-delete-file" data-id="${p.id}" title="Remover">
          <i class="ph ph-trash"></i>
        </button>
      `;
      fileList.appendChild(li);
    }

    fileList.querySelectorAll(".btn-delete-file").forEach((btn) => {
      btn.addEventListener("click", () => deletarPlanilha(Number(btn.dataset.id)));
    });
  } catch {}
}

async function deletarPlanilha(id) {
  await fetch(`/api/planilhas/${id}`, {
    method: "DELETE",
    headers: cofreHeaders(),
    credentials: "include",
  }).catch(() => {});
  await carregarLista();
  await carregarColunas();
}

// ── COLUNAS ──────────────────────────────────────────────
async function carregarColunas() {
  const selColuna = document.getElementById("sel-coluna");
  if (!selColuna) return;
  try {
    const res = await fetch("/api/planilhas/colunas", {
      headers: cofreHeaders(),
      credentials: "include",
    });
    const data = await res.json();
    if (!data.ok) return;

    const atual = selColuna.value;
    selColuna.innerHTML = '<option value="">-- Todas as colunas --</option>';
    for (const col of data.colunas) {
      const opt = document.createElement("option");
      opt.value = col;
      opt.textContent = col;
      selColuna.appendChild(opt);
    }
    if (atual) selColuna.value = atual;
  } catch {}
}

// ── BUSCA ─────────────────────────────────────────────────
document.getElementById("btn-buscar")?.addEventListener("click", buscar);
document.getElementById("inp-valor")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") buscar();
});

async function buscar() {
  const coluna = document.getElementById("sel-coluna")?.value || "";
  const valor  = document.getElementById("inp-valor")?.value.trim() || "";
  const tableWrapper = document.getElementById("table-wrapper");
  const resultsBar   = document.getElementById("results-bar");

  if (tableWrapper) tableWrapper.innerHTML = '<p class="table-placeholder">Buscando…</p>';
  if (resultsBar) resultsBar.hidden = true;

  try {
    const params = new URLSearchParams();
    if (coluna) params.set("coluna", coluna);
    if (valor)  params.set("valor",  valor);

    const res = await fetch(`/api/planilhas/buscar?${params}`, {
      headers: cofreHeaders(),
      credentials: "include",
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    renderTabela(data.resultados, data.total);
  } catch (err) {
    if (tableWrapper)
      tableWrapper.innerHTML = `<p class="table-placeholder" style="color:var(--danger)">${escHtml(err.message)}</p>`;
  }
}

function renderTabela(rows, total) {
  const tableWrapper = document.getElementById("table-wrapper");
  const resultsBar   = document.getElementById("results-bar");
  const resultsCount = document.getElementById("results-count");

  if (!rows.length) {
    if (tableWrapper) tableWrapper.innerHTML = '<p class="table-placeholder">Nenhum resultado encontrado.</p>';
    if (resultsBar) resultsBar.hidden = true;
    return;
  }

  if (resultsCount)
    resultsCount.textContent = `${total} resultado${total !== 1 ? "s" : ""} encontrado${total !== 1 ? "s" : ""}`;
  if (resultsBar) resultsBar.hidden = false;

  const colunas = Object.keys(rows[0]);
  const table = document.createElement("table");
  table.className = "results-table";

  const thead = document.createElement("thead");
  const trHead = document.createElement("tr");
  for (const col of colunas) {
    const th = document.createElement("th");
    th.textContent = col;
    trHead.appendChild(th);
  }
  thead.appendChild(trHead);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const col of colunas) {
      const td = document.createElement("td");
      const val = row[col] ?? "";
      td.textContent = val;
      td.title = String(val);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  if (tableWrapper) {
    tableWrapper.innerHTML = "";
    tableWrapper.appendChild(table);
  }
}

// ── EXPORTAR ──────────────────────────────────────────────
document.getElementById("btn-export")?.addEventListener("click", () => {
  const coluna = document.getElementById("sel-coluna")?.value || "";
  const valor  = document.getElementById("inp-valor")?.value.trim() || "";
  const params = new URLSearchParams();
  if (coluna) params.set("coluna", coluna);
  if (valor)  params.set("valor", valor);
  params.set("sid", sessionId);

  const a = document.createElement("a");
  a.href = `/api/planilhas/exportar?${params}`;
  a.click();
});

// ── HELPERS ───────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function initTheme(btn) {
  if (!btn) return;
  const isLight = localStorage.getItem("theme") === "light";
  document.body.classList.toggle("light-mode", isLight);
  updateThemeIcon(btn, !isLight);

  btn.addEventListener("click", () => {
    const nowLight = document.body.classList.toggle("light-mode");
    localStorage.setItem("theme", nowLight ? "light" : "dark");
    updateThemeIcon(btn, !nowLight);
  });
}

function updateThemeIcon(btn, isDark) {
  const icon = btn?.querySelector("i");
  const text = btn?.querySelector("span");
  if (icon) icon.className = isDark ? "ph ph-sun" : "ph ph-moon";
  if (text) text.textContent = isDark ? "Modo claro" : "Modo escuro";
}

function initSettingsMenu(btn, menu) {
  if (!btn || !menu) return;
  const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  const open  = () => { menu.hidden = false; btn.setAttribute("aria-expanded", "true"); };
  btn.setAttribute("aria-expanded", "false");
  btn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden ? open() : close(); });
  document.addEventListener("click", (e) => {
    const bar = document.getElementById("sidebar-userbar");
    if (!bar?.contains(e.target)) close();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

function initMobileSidebar(menuBtn) {
  if (!menuBtn) return;
  menuBtn.addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
  document.addEventListener("click", (e) => {
    if (!document.body.classList.contains("sidebar-open")) return;
    const sidebar = document.querySelector(".sidebar");
    if (!sidebar?.contains(e.target) && !menuBtn.contains(e.target))
      document.body.classList.remove("sidebar-open");
  });
}
