const LOGIN_URL    = "/login/login.html";
const HUB_URL      = "/paginaUnificada/index.html";
const MAX_SIZE     = 200 * 1024 * 1024; // 200 MB

// ── ESTADO LOCAL ──────────────────────────────────────────
let planilhas     = []; // [{ id, nome, dados, colunas }]
let nextId        = 1;
let ultimasColunas = [];

// ── BANCO DE DADOS LOCAL (IndexedDB) ──────────────────────
const DB_NAME = "CofrePlanilhasDB";
const DB_VERSION = 1;
const STORE_NAME = "planilhas";

function abrirDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    // Configura o timeout para evitar que o site fique travado se o DB não responder
    const timeout = setTimeout(() => reject("Timeout ao abrir banco de dados"), 5000);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };

    request.onsuccess = (e) => {
      clearTimeout(timeout);
      const db = e.target.result;
      // Garante que o banco seja fechado se a página for recarregada ou fechada
      db.onversionchange = () => {
        db.close();
        window.location.reload();
      };
      resolve(db);
    };

    request.onerror = (e) => {
      clearTimeout(timeout);
      console.error("Erro IndexedDB:", e.target.error);
      reject("Erro ao abrir IndexedDB");
    };
    
    request.onblocked = () => {
      console.warn("Abertura do banco bloqueada por outra aba/conexão.");
    };
  });
}

async function salvarPlanilhaLocal(planilha) {
  try {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const { id, ...dadosSemId } = planilha;
      const request = store.add(dadosSemId);
      request.onsuccess = (e) => {
        planilha.id = e.target.result;
        resolve(e.target.result);
      };
      request.onerror = () => reject("Erro ao salvar planilha");
    });
  } catch (err) { console.error(err); }
}

async function carregarPlanilhasLocais() {
  try {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject("Erro ao carregar planilhas");
    });
  } catch (err) { console.error(err); return []; }
}

async function removerPlanilhaLocal(id) {
  try {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(Number(id));
      request.onsuccess = () => resolve();
      request.onerror = () => reject("Erro ao remover planilha");
    });
  } catch (err) { console.error(err); }
}

async function limparBancoLocal() {
  try {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject();
    });
  } catch (err) { console.error(err); }
}

// ── INIT ──────────────────────────────────────────────────
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
    try { await fetch("/api/logout", { method: "POST", credentials: "include" }); } catch {}
    window.location.href = LOGIN_URL;
  });

  try {
    const res = await fetch("/api/profile", { credentials: "include" });
    const me  = await res.json();
    if (!me?.ok || !me?.user) throw new Error();
    if (userEmailEl) { userEmailEl.textContent = me.user.email || ""; userEmailEl.title = me.user.email || ""; }
  } catch {
    window.location.href = LOGIN_URL;
    return;
  }

  // Carregar dados salvos do IndexedDB
  toggleLoading(true, "Carregando cofre local...");
  planilhas = await carregarPlanilhasLocais();
  toggleLoading(false);

  if (planilhas.length > 0) {
    const ids = planilhas.map(p => p.id).filter(id => typeof id === 'number');
    nextId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
    renderLista();
    renderFiltrosPanel();
    const statusEl = document.querySelector(".assistant-details .status");
    if (statusEl) statusEl.textContent = "Dados salvos localmente no seu navegador";
  }

  const uploadArea = document.getElementById("upload-area");
  const fileInput  = document.getElementById("file-input");

  uploadArea?.addEventListener("dragover",  (e) => { e.preventDefault(); uploadArea.classList.add("drag-over"); });
  uploadArea?.addEventListener("dragleave", () => uploadArea.classList.remove("drag-over"));
  uploadArea?.addEventListener("drop", (e) => { e.preventDefault(); uploadArea.classList.remove("drag-over"); handleFiles(e.dataTransfer.files); });
  fileInput?.addEventListener("change", () => handleFiles(fileInput.files));

  document.getElementById("btn-buscar")?.addEventListener("click", buscar);
  document.getElementById("btn-export")?.addEventListener("click", abrirModalExport);
  document.getElementById("btn-limpar-tudo")?.addEventListener("click", limparTudo);
});

// ── UPLOAD ────────────────────────────────────────────────
async function handleFiles(files) {
  const fileInput = document.getElementById("file-input");
  for (const file of files) {
    if (file.size > MAX_SIZE) { setStatus(`${file.name} excede 200 MB`, "err"); continue; }
    
    toggleLoading(true, `Processando ${file.name}...`);
    setStatus(`Processando ${file.name}…`, "");
    
    try {
      const dados = await parsearArquivo(file);
      if (!dados.length) throw new Error("Planilha vazia ou sem dados.");
      const colunas = Object.keys(dados[0]);
      
      const novaPlanilha = { nome: file.name, dados, colunas };
      
      toggleLoading(true, `Salvando ${file.name} localmente...`);
      await salvarPlanilhaLocal(novaPlanilha); 
      planilhas.push(novaPlanilha);
      
      setStatus(`${file.name} — ${dados.length} linhas carregadas`, "ok");
      
      const statusEl = document.querySelector(".assistant-details .status");
      if (statusEl) statusEl.textContent = "Dados salvos localmente no seu navegador";
    } catch (err) {
      setStatus(`Erro: ${err.message}`, "err");
    }
  }
  toggleLoading(false);
  if (fileInput) fileInput.value = "";
  renderLista();
  renderFiltrosPanel();
}

function parsearArquivo(file) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./cofre-worker.js');
    const reader = new FileReader();
    reader.onload  = (e) => {
      worker.postMessage({ buffer: e.target.result }, [e.target.result]);
      worker.onmessage = ({ data }) => { worker.terminate(); data.ok ? resolve(data.dados) : reject(new Error(data.error)); };
      worker.onerror   = (err) => { worker.terminate(); reject(new Error(err.message)); };
    };
    reader.onerror = () => reject(new Error("Erro ao ler arquivo."));
    reader.readAsArrayBuffer(file);
  });
}

function setStatus(msg, tipo) {
  const el = document.getElementById("upload-status");
  if (!el) return;
  el.textContent = msg;
  el.className = "upload-status" + (tipo ? " " + tipo : "");
}

async function limparTudo() {
  if (!confirm("Isso apagará todas as planilhas carregadas do disco local. Deseja continuar?")) return;
  
  toggleLoading(true, "Limpando cofre...");
  await limparBancoLocal();
  planilhas = [];
  nextId = 1;
  renderLista();
  renderFiltrosPanel();
  
  const tableWrapper = document.getElementById("table-wrapper");
  if (tableWrapper) tableWrapper.innerHTML = '<p class="table-placeholder">Faça upload de planilhas e clique em Buscar.</p>';
  const resultsBar = document.getElementById("results-bar");
  if (resultsBar) resultsBar.hidden = true;
  
  toggleLoading(false);
  setStatus("Cofre limpo com sucesso.", "ok");
}

// ── LISTA DE PLANILHAS ────────────────────────────────────
function renderLista() {
  const fileList = document.getElementById("file-list");
  if (!fileList) return;
  fileList.innerHTML = "";

  if (!planilhas.length) {
    fileList.innerHTML = '<li class="file-list-empty">Nenhuma planilha carregada.</li>';
    const statusEl = document.querySelector(".assistant-details .status");
    if (statusEl) statusEl.textContent = "Dados temporários — apagados ao fechar esta aba";
    return;
  }

  planilhas.forEach((p, i) => {
    const li = document.createElement("li");
    li.className = "file-item";
    li.innerHTML = `
      <span class="file-item-num">${i + 1}º</span>
      <i class="ph ph-file-xls" style="color:var(--accent-cyan);flex-shrink:0"></i>
      <span class="file-item-name" title="${escHtml(p.nome)}">${escHtml(p.nome)}</span>
      <button class="btn-delete-file" data-id="${p.id}" title="Remover"><i class="ph ph-trash"></i></button>
    `;
    fileList.appendChild(li);
  });

  fileList.querySelectorAll(".btn-delete-file").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idParaRemover = Number(btn.dataset.id);
      toggleLoading(true, "Removendo arquivo...");
      await removerPlanilhaLocal(idParaRemover);
      planilhas = planilhas.filter((p) => p.id !== idParaRemover);
      toggleLoading(false);
      setStatus("", "");
      renderLista();
      renderFiltrosPanel();
    });
  });
}

// ── FILTROS POR PLANILHA ──────────────────────────────────
function renderFiltrosPanel() {
  const lista = document.getElementById("filtros-lista");
  if (!lista) return;
  lista.innerHTML = "";

  if (!planilhas.length) {
    lista.innerHTML = '<p class="filtro-vazio">Faça upload de planilhas para ver os filtros.</p>';
    return;
  }

  // Busca Global
  const globalSearchBox = document.createElement("div");
  globalSearchBox.className = "global-search-box";
  globalSearchBox.innerHTML = `
    <div class="input-with-icon">
      <i class="ph ph-magnifying-glass"></i>
      <input type="text" id="global-search" placeholder="Busca global em todas as colunas..." class="global-search-input">
    </div>
  `;
  lista.appendChild(globalSearchBox);

  const wrap    = document.createElement("div");
  wrap.className = "filtro-tabs-wrap";

  const tabsRow = document.createElement("div");
  tabsRow.className = "filtro-tabs-row";

  const drawer = document.createElement("div");
  drawer.className = "filtro-drawer";

  planilhas.forEach((p, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filtro-tab-btn";
    btn.dataset.planilhaId = p.id;
    btn.textContent = `${i + 1}º`;
    btn.title = p.nome;
    tabsRow.appendChild(btn);

    const panel = document.createElement("div");
    panel.className = "filtro-drawer-panel";
    panel.dataset.planilhaId = p.id;
    for (const col of p.colunas) panel.appendChild(criarItemColuna(p.id, col));
    drawer.appendChild(panel);

    btn.addEventListener("click", () => {
      const isActive = btn.classList.contains("active");
      tabsRow.querySelectorAll(".filtro-tab-btn").forEach((b) => b.classList.remove("active"));
      drawer.querySelectorAll(".filtro-drawer-panel").forEach((dp) => dp.classList.remove("active"));
      if (!isActive) { btn.classList.add("active"); panel.classList.add("active"); }
    });
  });

  wrap.appendChild(tabsRow);
  wrap.appendChild(drawer);
  lista.appendChild(wrap);
}

function criarItemColuna(planilhaId, coluna) {
  const item = document.createElement("div");
  item.className = "filtro-col-item";

  const head = document.createElement("div");
  head.className = "filtro-col-head";
  head.style.display = "flex";
  head.style.justifyContent = "space-between";
  head.style.alignItems = "center";
  head.style.gap = "8px";

  const label = document.createElement("label");
  label.className = "filtro-col-label";

  const chk = document.createElement("input");
  chk.type = "checkbox"; chk.className = "filtro-col-check";
  chk.dataset.planilha = planilhaId; chk.dataset.coluna = coluna;

  const nome = document.createElement("span");
  nome.className = "filtro-col-nome"; nome.textContent = coluna; nome.title = coluna;

  label.appendChild(chk); label.appendChild(nome);

  const select = document.createElement("select");
  select.className = "filtro-col-type";
  select.style.padding = "2px 4px";
  select.style.fontSize = "11px";
  select.style.borderRadius = "4px";
  select.style.background = "var(--bg-secondary)";
  select.style.color = "var(--text-primary)";
  select.style.border = "1px solid var(--border-color)";
  select.innerHTML = `
    <option value="contains">Contém</option>
    <option value="exact">Exato</option>
    <option value="starts">Começa</option>
    <option value="ends">Termina</option>
  `;
  select.hidden = true;

  head.appendChild(label);
  head.appendChild(select);

  const tagsWrap = document.createElement("div");
  tagsWrap.className = "filtro-col-tags-wrap";
  tagsWrap.hidden = true;

  const tagsBox = document.createElement("div");
  tagsBox.className = "filtro-col-tags";

  const tagInput = document.createElement("input");
  tagInput.type = "text";
  tagInput.className = "filtro-col-tag-input";
  tagInput.placeholder = "Valor + Enter";
  tagInput.style.outline = "none";

  tagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const val = tagInput.value.trim().replace(/,$/, "");
      if (val) { adicionarTag(tagsBox, tagInput, val); tagInput.value = ""; }
    } else if (e.key === "Backspace" && !tagInput.value) {
      tagsBox.querySelector(".filtro-col-tag:last-of-type")?.remove();
    }
  });

  tagsBox.appendChild(tagInput);
  tagsWrap.appendChild(tagsBox);

  chk.addEventListener("change", () => {
    tagsWrap.hidden = !chk.checked;
    select.hidden = !chk.checked;
    if (!chk.checked) { tagsBox.querySelectorAll(".filtro-col-tag").forEach((t) => t.remove()); tagInput.value = ""; }
    else tagInput.focus();
  });

  item.appendChild(head);
  item.appendChild(tagsWrap);
  return item;
}

function adicionarTag(tagsBox, tagInput, value) {
  const tag = document.createElement("span");
  tag.className = "filtro-col-tag";

  const txt = document.createElement("span");
  txt.textContent = value;

  const rem = document.createElement("button");
  rem.type = "button"; rem.className = "filtro-col-tag-remove";
  rem.innerHTML = '<i class="ph ph-x"></i>';
  rem.addEventListener("click", () => tag.remove());

  tag.appendChild(txt); tag.appendChild(rem);
  tagsBox.insertBefore(tag, tagInput);
}

function coletarFiltros() {
  const filtros = {};
  document.querySelectorAll(".filtro-col-check:checked").forEach((chk) => {
    const item    = chk.closest(".filtro-col-item");
    const tagsBox = item?.querySelector(".filtro-col-tags");
    const type    = item?.querySelector(".filtro-col-type")?.value || "contains";
    if (!tagsBox) return;

    const valores = [...tagsBox.querySelectorAll(".filtro-col-tag span:first-child")].map((s) => s.textContent.trim());
    const digitando = item.querySelector(".filtro-col-tag-input")?.value.trim();
    if (digitando) valores.push(digitando);
    if (!valores.length) return;

    const pid = String(chk.dataset.planilha);
    if (!filtros[pid]) filtros[pid] = [];
    filtros[pid].push({ coluna: chk.dataset.coluna, valores, type });
  });
  return filtros;
}

// ── BUSCA ─────────────────────────────────────────────────
function buscar() {
  const globalTerm = document.getElementById("global-search")?.value.trim().toLowerCase();
  const tableWrapper = document.getElementById("table-wrapper");
  const resultsBar   = document.getElementById("results-bar");
  
  toggleLoading(true, "Filtrando dados...");
  
  if (tableWrapper) tableWrapper.innerHTML = '<p class="table-placeholder">Buscando…</p>';
  if (resultsBar) resultsBar.hidden = true;

  const filtros    = coletarFiltros();
  const resultados = [];

  // Usar um pequeno delay para o spinner aparecer
  setTimeout(() => {
    for (const p of planilhas) {
      const fp = filtros[String(p.id)] || [];
      for (const linha of p.dados) {
        // Filtro Global
        if (globalTerm) {
          const valoresLinha = Object.values(linha).join(" ").toLowerCase();
          if (!valoresLinha.includes(globalTerm)) continue;
        }

        // Filtros Específicos
        if (!fp.length || linhaPassaFiltros(linha, fp)) {
          resultados.push({ _arquivo: p.nome, ...linha });
        }
      }
    }

    renderTabela(resultados);
    toggleLoading(false);
  }, 50);
}

function linhaPassaFiltros(linha, filtros) {
  for (const { coluna, valores, type } of filtros) {
    const cell = String(linha[coluna] ?? "").toLowerCase();
    const passou = valores.some((v) => {
      const term = v.toLowerCase();
      if (type === "exact") return cell === term;
      if (type === "starts") return cell.startsWith(term);
      if (type === "ends") return cell.endsWith(term);
      return cell.includes(term); // default contains
    });
    if (!passou) return false;
  }
  return true;
}

function renderTabela(rows) {
  const tableWrapper = document.getElementById("table-wrapper");
  const resultsBar   = document.getElementById("results-bar");
  const resultsCount = document.getElementById("results-count");

  if (!rows.length) {
    if (tableWrapper) tableWrapper.innerHTML = '<p class="table-placeholder">Nenhum resultado encontrado.</p>';
    if (resultsBar) resultsBar.hidden = true;
    return;
  }

  const colMap = new Map();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      const norm = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (!colMap.has(norm)) colMap.set(norm, k);
    }
  }
  ultimasColunas = [...colMap.values()];

  const total = rows.length;
  if (resultsCount) resultsCount.textContent = `${total} resultado${total !== 1 ? "s" : ""} encontrado${total !== 1 ? "s" : ""}`;
  if (resultsBar) resultsBar.hidden = false;

  const table  = document.createElement("table");
  table.className = "results-table";
  const thead  = document.createElement("thead");
  const trHead = document.createElement("tr");
  for (const col of ultimasColunas) {
    const th = document.createElement("th");
    th.textContent = col.startsWith("_") ? col.slice(1) : col;
    trHead.appendChild(th);
  }
  thead.appendChild(trHead); table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const col of ultimasColunas) {
      const td  = document.createElement("td");
      const val = row[col] ?? "";
      td.textContent = val; td.title = String(val);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  if (tableWrapper) { tableWrapper.innerHTML = ""; tableWrapper.appendChild(table); }
}

// ── EXPORTAR COM REORDENAÇÃO ──────────────────────────────
function abrirModalExport() {
  if (!ultimasColunas.length) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay"; overlay.id = "export-modal";
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title"><i class="ph ph-arrows-out-line-vertical"></i> Ordenar colunas</h2>
        <p class="modal-sub">Arraste para definir a ordem das colunas na planilha exportada.</p>
      </div>
      <ul class="col-reorder-list" id="col-reorder-list">
        ${ultimasColunas.map((col) => `
          <li class="col-reorder-item" draggable="true" data-col="${escHtml(col)}">
            <i class="ph ph-dots-six-vertical drag-handle"></i>
            <span class="col-reorder-label">${escHtml(col.startsWith("_") ? col.slice(1) : col)}</span>
            <button type="button" class="col-delete-btn" title="Remover coluna"><i class="ph ph-x"></i></button>
          </li>`).join("")}
      </ul>
      <div class="modal-actions">
        <button class="btn-modal-cancel" id="export-modal-cancel">Cancelar</button>
        <button class="btn-primary" id="export-modal-confirm"><i class="ph ph-download-simple"></i> Exportar</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.getElementById("export-modal-cancel")?.addEventListener("click", fecharModalExport);
  document.getElementById("export-modal-confirm")?.addEventListener("click", confirmarExport);

  const reorderList = document.getElementById("col-reorder-list");
  reorderList?.addEventListener("click", (e) => { const btn = e.target.closest(".col-delete-btn"); if (btn) btn.closest(".col-reorder-item")?.remove(); });
  iniciarDragAndDrop(reorderList);
}

function fecharModalExport() { document.getElementById("export-modal")?.remove(); }

function confirmarExport() {
  const lista          = document.getElementById("col-reorder-list");
  const colunasOrdenadas = [...lista.querySelectorAll(".col-reorder-item")].map((li) => li.dataset.col);
  fecharModalExport();

  const filtros    = coletarFiltros();
  const resultados = [];
  for (const p of planilhas) {
    const fp = filtros[String(p.id)] || [];
    for (const linha of p.dados) {
      if (!fp.length || linhaPassaFiltros(linha, fp))
        resultados.push({ _arquivo: p.nome, ...linha });
    }
  }
  if (!resultados.length) { alert("Nenhum resultado para exportar."); return; }

  const dadosParaExportar = resultados.map((linha) => {
    const obj = {};
    for (const col of colunasOrdenadas) { obj[col.startsWith("_") ? col.slice(1) : col] = linha[col] ?? ""; }
    return obj;
  });

  const wb  = XLSX.utils.book_new();
  const ws  = XLSX.utils.json_to_sheet(dadosParaExportar);
  XLSX.utils.book_append_sheet(wb, ws, "Resultados");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "resultado_cofre.xlsx"; a.click();
  URL.revokeObjectURL(url);
}

function iniciarDragAndDrop(lista) {
  if (!lista) return;
  let dragSrc = null;
  lista.querySelectorAll(".col-reorder-item").forEach((item) => {
    item.addEventListener("dragstart", (e) => { dragSrc = item; item.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
    item.addEventListener("dragend",   () => { dragSrc = null; lista.querySelectorAll(".col-reorder-item").forEach((i) => i.classList.remove("dragging", "drag-over")); });
    item.addEventListener("dragover",  (e) => { e.preventDefault(); if (item === dragSrc) return; lista.querySelectorAll(".col-reorder-item").forEach((i) => i.classList.remove("drag-over")); item.classList.add("drag-over"); });
    item.addEventListener("drop",      (e) => { e.preventDefault(); if (!dragSrc || dragSrc === item) return; const after = e.clientY > item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2; lista.insertBefore(dragSrc, after ? item.nextSibling : item); lista.querySelectorAll(".col-reorder-item").forEach((i) => i.classList.remove("drag-over")); });
  });
}

function toggleLoading(active, msg = "Processando...") {
  let loader = document.getElementById("global-loader");
  if (!loader) {
    loader = document.createElement("div");
    loader.id = "global-loader";
    loader.className = "global-loader";
    loader.innerHTML = `
      <div class="loader-content">
        <div class="spinner"></div>
        <p id="loader-text"></p>
      </div>
    `;
    document.body.appendChild(loader);
  }
  const text = loader.querySelector("#loader-text");
  if (text) text.textContent = msg;
  if (active) loader.classList.add("active");
  else loader.classList.remove("active");
}

// ── HELPERS ───────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
  const icon = btn?.querySelector("i"); const text = btn?.querySelector("span");
  if (icon) icon.className = isDark ? "ph ph-sun" : "ph ph-moon";
  if (text) text.textContent = isDark ? "Modo claro" : "Modo escuro";
}

function initSettingsMenu(btn, menu) {
  if (!btn || !menu) return;
  const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  const open  = () => { menu.hidden = false; btn.setAttribute("aria-expanded", "true"); };
  btn.setAttribute("aria-expanded", "false");
  btn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden ? open() : close(); });
  document.addEventListener("click", (e) => { if (!document.getElementById("sidebar-userbar")?.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

function initMobileSidebar(menuBtn) {
  if (!menuBtn) return;
  menuBtn.addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
  document.addEventListener("click", (e) => {
    if (!document.body.classList.contains("sidebar-open")) return;
    const sidebar = document.querySelector(".sidebar");
    if (!sidebar?.contains(e.target) && !menuBtn.contains(e.target)) document.body.classList.remove("sidebar-open");
  });
}
