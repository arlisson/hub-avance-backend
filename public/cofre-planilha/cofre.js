const LOGIN_URL = "/login/login.html";
const HUB_URL   = "/paginaUnificada/index.html";

let sessionId = localStorage.getItem("cofre_session_id");
if (!sessionId) {
  sessionId = crypto.randomUUID();
  localStorage.setItem("cofre_session_id", sessionId);
}

function cofreHeaders() {
  return { "x-session-id": sessionId };
}

async function apiFetch(url, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const resp = await fetch(url, {
    method, credentials: "include", headers,
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

let planilhasInfo = []; // [{id, nome_arquivo, colunas}]
let ultimasColunas = [];

// ── INIT ─────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const themeToggle   = document.getElementById("theme-toggle");
  const settingsBtn   = document.getElementById("settings-btn");
  const settingsMenu  = document.getElementById("settings-menu");
  const menuBackHub   = document.getElementById("menu-back-hub");
  const menuLogout    = document.getElementById("menu-logout");
  const mobileMenuBtn = document.getElementById("mobile-menu-btn");
  const userEmailEl   = document.getElementById("user-email");

  initTheme(themeToggle);
  initSettingsMenu(settingsBtn, settingsMenu);
  initMobileSidebar(mobileMenuBtn);

  menuBackHub?.addEventListener("click", () => { window.location.href = HUB_URL; });
  menuLogout?.addEventListener("click", async () => {
    try { await apiFetch("/api/logout", { method: "POST" }); } catch {}
    window.location.href = LOGIN_URL;
  });

  try {
    const me = await apiFetch("/api/profile");
    if (!me?.ok || !me?.user) throw new Error("Não autenticado.");
    if (userEmailEl) {
      userEmailEl.textContent = me.user.email || "";
      userEmailEl.title = me.user.email || "";
    }
  } catch {
    window.location.href = LOGIN_URL;
    return;
  }

  const uploadArea = document.getElementById("upload-area");
  const fileInput  = document.getElementById("file-input");

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

  document.getElementById("btn-buscar")?.addEventListener("click", buscar);
  document.getElementById("btn-export")?.addEventListener("click", abrirModalExport);

  await carregarLista();
  await carregarInfoPlanilhas();

  window.addEventListener("beforeunload", () => {
    fetch("/api/planilhas", {
      method: "DELETE",
      headers: cofreHeaders(),
      keepalive: true,
    }).catch(() => {});
  });
});

// ── UPLOAD ───────────────────────────────────────────────
async function handleFiles(files) {
  const fileInput = document.getElementById("file-input");
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
  await carregarInfoPlanilhas();
}

function setStatus(msg, tipo) {
  const el = document.getElementById("upload-status");
  if (!el) return;
  el.textContent = msg;
  el.className = "upload-status" + (tipo ? " " + tipo : "");
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

    data.planilhas.forEach((p, i) => {
      const li = document.createElement("li");
      li.className = "file-item";
      li.innerHTML = `
        <span class="file-item-num">${i + 1}º</span>
        <i class="ph ph-file-xls" style="color:var(--accent-cyan);flex-shrink:0"></i>
        <span class="file-item-name" title="${escHtml(p.nome_arquivo)}">${escHtml(p.nome_arquivo)}</span>
        <button class="btn-delete-file" data-id="${p.id}" title="Remover">
          <i class="ph ph-trash"></i>
        </button>
      `;
      fileList.appendChild(li);
    });

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
  setStatus("", "");
  await carregarLista();
  await carregarInfoPlanilhas();
}

// ── FILTROS POR PLANILHA ─────────────────────────────────
async function carregarInfoPlanilhas() {
  try {
    const res = await fetch("/api/planilhas/colunas-por-planilha", {
      headers: cofreHeaders(),
      credentials: "include",
    });
    const data = await res.json();
    if (!data.ok) return;
    planilhasInfo = data.planilhas;
    renderFiltrosPanel();
  } catch {}
}

function renderFiltrosPanel() {
  const lista = document.getElementById("filtros-lista");
  if (!lista) return;
  lista.innerHTML = "";

  if (!planilhasInfo.length) {
    lista.innerHTML = '<p class="filtro-vazio">Faça upload de planilhas para ver os filtros.</p>';
    return;
  }

  planilhasInfo.forEach((p, i) => {
    const secao = document.createElement("div");
    secao.className = "filtro-planilha";

    const titulo = document.createElement("div");
    titulo.className = "filtro-planilha-titulo";
    titulo.innerHTML = `
      <span class="filtro-planilha-num">${i + 1}º</span>
      <span class="filtro-planilha-nome" title="${escHtml(p.nome_arquivo)}">${escHtml(p.nome_arquivo)}</span>
    `;

    const cols = document.createElement("div");
    cols.className = "filtro-planilha-cols";

    for (const col of p.colunas) {
      cols.appendChild(criarItemColuna(p.id, col));
    }

    secao.appendChild(titulo);
    secao.appendChild(cols);
    lista.appendChild(secao);
  });
}

function criarItemColuna(planilhaId, coluna) {
  const item = document.createElement("div");
  item.className = "filtro-col-item";

  const label = document.createElement("label");
  label.className = "filtro-col-label";

  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.className = "filtro-col-check";
  chk.dataset.planilha = planilhaId;
  chk.dataset.coluna = coluna;

  const nome = document.createElement("span");
  nome.className = "filtro-col-nome";
  nome.textContent = coluna;
  nome.title = coluna;

  label.appendChild(chk);
  label.appendChild(nome);

  const inp = document.createElement("input");
  inp.type = "text";
  inp.className = "input-dark-lite filtro-col-valor";
  inp.placeholder = "Filtrar...";
  inp.disabled = true;
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") buscar(); });

  chk.addEventListener("change", () => {
    inp.disabled = !chk.checked;
    if (!chk.checked) inp.value = "";
    else inp.focus();
  });

  item.appendChild(label);
  item.appendChild(inp);
  return item;
}

function coletarFiltros() {
  const filtros = {};
  document.querySelectorAll(".filtro-col-check:checked").forEach((chk) => {
    const valor = chk.closest(".filtro-col-item")?.querySelector(".filtro-col-valor")?.value.trim() || "";
    if (!valor) return;
    const pid = chk.dataset.planilha;
    if (!filtros[pid]) filtros[pid] = [];
    filtros[pid].push({ coluna: chk.dataset.coluna, valor });
  });
  return filtros;
}

// ── BUSCA ─────────────────────────────────────────────────
async function buscar() {
  const tableWrapper = document.getElementById("table-wrapper");
  const resultsBar   = document.getElementById("results-bar");

  if (tableWrapper) tableWrapper.innerHTML = '<p class="table-placeholder">Buscando…</p>';
  if (resultsBar) resultsBar.hidden = true;

  const filtros = coletarFiltros();

  try {
    const params = new URLSearchParams();
    if (Object.keys(filtros).length) params.set("filtros", JSON.stringify(filtros));

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

  ultimasColunas = Object.keys(rows[0]);

  if (resultsCount)
    resultsCount.textContent = `${total} resultado${total !== 1 ? "s" : ""} encontrado${total !== 1 ? "s" : ""}`;
  if (resultsBar) resultsBar.hidden = false;

  const table = document.createElement("table");
  table.className = "results-table";

  const thead = document.createElement("thead");
  const trHead = document.createElement("tr");
  for (const col of ultimasColunas) {
    const th = document.createElement("th");
    th.textContent = col.startsWith("_") ? col.slice(1) : col;
    trHead.appendChild(th);
  }
  thead.appendChild(trHead);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const col of ultimasColunas) {
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

// ── EXPORTAR COM REORDENAÇÃO ──────────────────────────────
function abrirModalExport() {
  const colunas = ultimasColunas.length ? ultimasColunas : [];
  if (!colunas.length) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "export-modal";

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title"><i class="ph ph-arrows-out-line-vertical"></i> Ordenar colunas</h2>
        <p class="modal-sub">Arraste para definir a ordem das colunas na planilha exportada.</p>
      </div>
      <ul class="col-reorder-list" id="col-reorder-list">
        ${colunas.map((col) => `
          <li class="col-reorder-item" draggable="true" data-col="${escHtml(col)}">
            <i class="ph ph-dots-six-vertical drag-handle"></i>
            <span>${escHtml(col.startsWith("_") ? col.slice(1) : col)}</span>
          </li>
        `).join("")}
      </ul>
      <div class="modal-actions">
        <button class="btn-modal-cancel" id="export-modal-cancel">Cancelar</button>
        <button class="btn-primary" id="export-modal-confirm">
          <i class="ph ph-download-simple"></i> Exportar
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) fecharModalExport(); });
  document.getElementById("export-modal-cancel")?.addEventListener("click", fecharModalExport);
  document.getElementById("export-modal-confirm")?.addEventListener("click", confirmarExport);
  iniciarDragAndDrop(document.getElementById("col-reorder-list"));
}

function fecharModalExport() {
  document.getElementById("export-modal")?.remove();
}

async function confirmarExport() {
  const lista = document.getElementById("col-reorder-list");
  const colunas = [...lista.querySelectorAll(".col-reorder-item")].map((li) => li.dataset.col);
  fecharModalExport();

  const filtros = coletarFiltros();
  const params = new URLSearchParams();
  if (Object.keys(filtros).length) params.set("filtros", JSON.stringify(filtros));
  params.set("colunas", JSON.stringify(colunas));

  try {
    const res = await fetch(`/api/planilhas/exportar?${params}`, {
      headers: cofreHeaders(),
      credentials: "include",
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Erro ao exportar." }));
      alert(data.error || "Erro ao exportar.");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "resultado_cofre.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert("Erro ao exportar: " + err.message);
  }
}

function iniciarDragAndDrop(lista) {
  if (!lista) return;
  let dragSrc = null;

  lista.querySelectorAll(".col-reorder-item").forEach((item) => {
    item.addEventListener("dragstart", (e) => {
      dragSrc = item;
      item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dragend", () => {
      dragSrc = null;
      lista.querySelectorAll(".col-reorder-item").forEach((i) => i.classList.remove("dragging", "drag-over"));
    });
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (item === dragSrc) return;
      lista.querySelectorAll(".col-reorder-item").forEach((i) => i.classList.remove("drag-over"));
      item.classList.add("drag-over");
    });
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!dragSrc || dragSrc === item) return;
      const rect = item.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      lista.insertBefore(dragSrc, after ? item.nextSibling : item);
      lista.querySelectorAll(".col-reorder-item").forEach((i) => i.classList.remove("drag-over"));
    });
  });
}

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
