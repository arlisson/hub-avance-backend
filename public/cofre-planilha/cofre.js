const LOGIN_URL = "/login/login.html";
const HUB_URL = "/paginaUnificada/index.html";
const WARN_ROWS = 50_000; // 50k linhas — avisa sobre filtros lentos
const PAGE_SIZE = 200;               // linhas por página na tabela de resultados

// ── ESTADO LOCAL ──────────────────────────────────────────
let planilhas = []; // [{ id, nome, colunas, schema }] — dados ficam só no IndexedDB
let nextId = 1;
let ultimasColunas = [];
let totalResultados = [];
let paginaAtual = 1;

// ── BANCO DE DADOS LOCAL (IndexedDB) ──────────────────────
const DB_NAME = "CofrePlanilhasDB";
const DB_VERSION = 3;
const STORE_META = "planilhas_meta";
const STORE_DADOS = "planilhas_dados";

function abrirDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    const timeout = setTimeout(() => reject("Timeout ao abrir banco de dados"), 5000);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "id", autoIncrement: true });
      }
      if (db.objectStoreNames.contains(STORE_DADOS)) {
        db.deleteObjectStore(STORE_DADOS);
      }
      const dadosStore = db.createObjectStore(STORE_DADOS, { keyPath: "id", autoIncrement: true });
      dadosStore.createIndex("fileId", "fileId", { unique: false });
    };

    request.onsuccess = (e) => {
      clearTimeout(timeout);
      const db = e.target.result;
      db.onversionchange = () => { db.close(); window.location.reload(); };
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

async function carregarPlanilhasLocais() {
  try {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META], "readonly");
      const req = tx.objectStore(STORE_META).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject("Erro ao carregar planilhas");
    });
  } catch (err) { console.error(err); return []; }
}

async function removerPlanilhaLocal(id) {
  try {
    const db = await abrirDB();
    const idNum = Number(id);
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META, STORE_DADOS], "readwrite");
      tx.objectStore(STORE_META).delete(idNum);
      const storeDados = tx.objectStore(STORE_DADOS);
      const index = storeDados.index("fileId");
      const range = IDBKeyRange.only(idNum);
      const cursorReq = index.openCursor(range);
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject("Erro ao remover planilha e lotes");
    });
  } catch (err) { console.error(err); }
}

async function limparBancoLocal() {
  try {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META, STORE_DADOS], "readwrite");
      tx.objectStore(STORE_META).clear();
      tx.objectStore(STORE_DADOS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject();
    });
  } catch (err) { console.error(err); }
}

async function carregarDadosPlanilha(fileId) {
  try {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_DADOS], "readonly");
      const store = tx.objectStore(STORE_DADOS);
      const index = store.index("fileId");
      const req = index.getAll(Number(fileId));
      req.onsuccess = () => {
        const todosOsDados = req.result.reduce((acc, batch) => acc.concat(batch.dados), []);
        resolve(todosOsDados);
      };
      req.onerror = () => reject("Erro ao carregar lotes de dados");
    });
  } catch (err) { console.error(err); return []; }
}

async function salvarSchemaLocal(id, schema) {
  try {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META], "readwrite");
      const store = tx.objectStore(STORE_META);
      const req = store.get(Number(id));
      req.onsuccess = () => {
        const data = req.result;
        if (data) {
          data.schema = schema;
          store.put(data);
          tx.oncomplete = resolve;
        } else {
          reject("Metadados não encontrados");
        }
      };
      req.onerror = reject;
    });
  } catch (err) { console.error(err); }
}

// ── INIT ──────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const themeToggle = document.getElementById("theme-toggle");
  const settingsBtn = document.getElementById("settings-btn");
  const settingsMenu = document.getElementById("settings-menu");
  const mobileMenuBtn = document.getElementById("mobile-menu-btn");
  const userEmailEl = document.getElementById("user-email");

  initTheme(themeToggle);
  initSettingsMenu(settingsBtn, settingsMenu);
  initMobileSidebar(mobileMenuBtn);

  document.getElementById("menu-back-hub")?.addEventListener("click", () => { window.location.href = HUB_URL; });
  document.getElementById("menu-logout")?.addEventListener("click", async () => {
    try { await fetch("/api/logout", { method: "POST", credentials: "include" }); } catch { }
    window.location.href = LOGIN_URL;
  });

  try {
    const res = await fetch("/api/profile", { credentials: "include" });
    const me = await res.json();
    if (!me?.ok || !me?.user) throw new Error();
    if (userEmailEl) { userEmailEl.textContent = me.user.email || ""; userEmailEl.title = me.user.email || ""; }
  } catch {
    window.location.href = LOGIN_URL;
    return;
  }

  toggleLoading(true, "Carregando cofre local...");
  planilhas = await carregarPlanilhasLocais();
  toggleLoading(false);

  if (planilhas.length > 0) {
    renderLista();
    renderFiltrosPanel();
    const statusEl = document.querySelector(".assistant-details .status");
    if (statusEl) statusEl.textContent = "Dados salvos localmente no seu navegador";
  }

  const uploadArea = document.getElementById("upload-area");
  const fileInput = document.getElementById("file-input");
  uploadArea?.addEventListener("dragover", (e) => { e.preventDefault(); uploadArea.classList.add("drag-over"); });
  uploadArea?.addEventListener("dragleave", () => uploadArea.classList.remove("drag-over"));
  uploadArea?.addEventListener("drop", (e) => { e.preventDefault(); uploadArea.classList.remove("drag-over"); handleFiles(e.dataTransfer.files); });
  fileInput?.addEventListener("change", () => handleFiles(fileInput.files));

  document.getElementById("btn-buscar")?.addEventListener("click", buscar);
  document.getElementById("btn-export")?.addEventListener("click", abrirModalExport);
  document.getElementById("btn-limpar-tudo")?.addEventListener("click", limparTudo);
  document.getElementById("btn-configurar-filtros")?.addEventListener("click", abrirModalFiltros);
  document.getElementById("btn-fechar-filtros")?.addEventListener("click", fecharModalFiltros);
  document.getElementById("btn-fechar-sem-buscar")?.addEventListener("click", fecharModalFiltros);
  document.getElementById("btn-aplicar-filtros")?.addEventListener("click", () => { fecharModalFiltros(); buscar(); });
  document.getElementById("filtros-modal-overlay")?.addEventListener("click", (e) => { if (e.target.id === "filtros-modal-overlay") fecharModalFiltros(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharModalFiltros(); });
});

// ── UPLOAD ────────────────────────────────────────────────
async function handleFiles(files) {
  const fileInput = document.getElementById("file-input");
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.csv')) { setStatus(`Upload bloqueado: "${file.name}" não é CSV.`, "err"); continue; }
    toggleLoading(true, `Processando ${file.name}...`);
    try {
      const { id, colunas, linhas } = await parsearArquivo(file);
      planilhas.push({ id, nome: file.name, colunas, schema: {} });
      setStatus(`${file.name} — ${linhas.toLocaleString("pt-BR")} linhas salvas`, "ok");
    } catch (err) { setStatus(`Erro: ${err.message}`, "err"); }
  }
  toggleLoading(false);
  if (fileInput) fileInput.value = "";
  renderLista();
  renderFiltrosPanel();
}

function parsearArquivo(file) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./cofre-worker.js?v=' + Date.now());
    worker.postMessage({ file, nome: file.name });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { toggleLoading(true, data.msg, data.percent); return; }
      worker.terminate();
      data.ok ? resolve(data) : reject(new Error(data.error));
    };
    worker.onerror = (err) => { worker.terminate(); reject(new Error(err.message)); };
  });
}

function setStatus(msg, tipo) {
  const el = document.getElementById("upload-status");
  if (el) { el.textContent = msg; el.className = "upload-status " + (tipo || ""); }
}

async function limparTudo() {
  if (!confirm("Isso apagará todas as planilhas carregadas. Continuar?")) return;
  toggleLoading(true, "Limpando cofre...");
  await limparBancoLocal();
  planilhas = [];
  totalResultados = [];
  paginaAtual = 1;
  renderLista();
  renderFiltrosPanel();
  const tableWrapper = document.getElementById("table-wrapper");
  if (tableWrapper) tableWrapper.innerHTML = '<p class="table-placeholder">Faça upload de planilhas e clique em Buscar.</p>';
  const resultsBar = document.getElementById("results-bar");
  if (resultsBar) resultsBar.hidden = true;
  toggleLoading(false);
}

// ── LISTA DE PLANILHAS ────────────────────────────────────
function renderLista() {
  const fileList = document.getElementById("file-list");
  if (!fileList) return;
  fileList.innerHTML = "";
  if (!planilhas.length) { fileList.innerHTML = '<li class="file-list-empty">Nenhuma planilha carregada.</li>'; return; }
  planilhas.forEach((p, i) => {
    const li = document.createElement("li");
    li.className = "file-item";
    li.innerHTML = `
      <span class="file-item-num">${i + 1}º</span>
      <i class="ph ph-file-csv" style="color:var(--accent-cyan);flex-shrink:0"></i>
      <span class="file-item-name" title="${escHtml(p.nome)}">${escHtml(p.nome)}</span>
      <button class="btn-delete-file" data-id="${p.id}"><i class="ph ph-trash"></i></button>
    `;
    fileList.appendChild(li);
  });
  fileList.querySelectorAll(".btn-delete-file").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      toggleLoading(true, "Removendo arquivo...");
      await removerPlanilhaLocal(id);
      planilhas = planilhas.filter(p => p.id !== id);
      toggleLoading(false);
      renderLista();
      renderFiltrosPanel();
    });
  });
}

// ── FILTROS ───────────────────────────────────────────────
function abrirModalFiltros() {
  const overlay = document.getElementById("filtros-modal-overlay");
  if (overlay) { overlay.hidden = false; document.body.style.overflow = "hidden"; document.getElementById("global-search")?.focus(); }
}

function fecharModalFiltros() {
  const overlay = document.getElementById("filtros-modal-overlay");
  if (overlay) { overlay.hidden = true; document.body.style.overflow = ""; }
  const count = document.querySelectorAll(".filtro-card--ativo").length + (document.getElementById("global-search")?.value.trim() ? 1 : 0);
  document.getElementById("btn-configurar-filtros")?.classList.toggle("has-filters", count > 0);
}

function renderFiltrosPanel() {
  const lista = document.getElementById("filtros-lista");
  if (!lista) return;
  lista.innerHTML = "";
  if (!planilhas.length) { lista.innerHTML = '<p class="filtro-vazio">Faça upload de planilhas para ver os filtros.</p>'; return; }

  const globalSearchBox = document.createElement("div");
  globalSearchBox.className = "global-search-box";
  globalSearchBox.innerHTML = `<div class="input-with-icon"><i class="ph ph-magnifying-glass"></i><input type="text" id="global-search" placeholder="Busca rápida..." class="global-search-input"></div>`;
  lista.appendChild(globalSearchBox);
  globalSearchBox.querySelector("#global-search").addEventListener("input", atualizarChipsFiltrosAtivos);

  const drawer = document.createElement("div");
  drawer.id = "filtro-drawer-novo";
  drawer.className = "filtro-drawer-novo";

  if (planilhas.length > 1) {
    const tabsContainer = document.createElement("div");
    tabsContainer.className = "filtro-tabs";
    planilhas.forEach((p, i) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = `filtro-tab-item${i === 0 ? " active" : ""}`;
      tab.dataset.planilhaId = p.id;
      tab.innerHTML = `<i class="ph ph-file-csv"></i> <span>${escHtml(p.nome.length > 20 ? p.nome.slice(0, 17) + "…" : p.nome)}</span>`;
      tab.addEventListener("click", () => {
        tabsContainer.querySelectorAll(".filtro-tab-item").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        drawer.querySelectorAll(".filtro-panel-planilha").forEach(panel => panel.hidden = panel.dataset.planilhaId !== String(p.id));
      });
      tabsContainer.appendChild(tab);
    });
    lista.appendChild(tabsContainer);
  }

  const colSearch = document.createElement("div");
  colSearch.className = "filtro-coluna-search";
  colSearch.innerHTML = `<div class="input-with-icon"><i class="ph ph-list-magnifying-glass"></i><input type="text" id="coluna-search" placeholder="Buscar coluna..." class="coluna-search-input"></div>`;
  lista.appendChild(colSearch);
  colSearch.querySelector("#coluna-search").addEventListener("input", (e) => {
    const t = e.target.value.trim().toLowerCase();
    const activePanel = document.querySelector(".filtro-panel-planilha:not([hidden])");
    activePanel?.querySelectorAll(".filtro-card").forEach(card => card.hidden = t !== "" && !card.dataset.coluna.toLowerCase().includes(t));
  });

  planilhas.forEach((p, i) => {
    const panel = document.createElement("div");
    panel.className = "filtro-panel-planilha";
    panel.dataset.planilhaId = p.id;
    panel.hidden = i !== 0;
    p.colunas.forEach(col => panel.appendChild(criarCartaoColuna(p, col, p.schema?.[col])));
    drawer.appendChild(panel);
  });
  lista.appendChild(drawer);
}

function criarCartaoColuna(planilha, coluna, schemaCol) {
  const tipo = schemaCol?.type || "text";
  const card = document.createElement("div");
  card.className = "filtro-card";
  card.dataset.planilha = planilha.id;
  card.dataset.coluna = coluna;
  card.dataset.type = tipo;

  const header = document.createElement("div");
  header.className = "filtro-card-header";

  const typeBtn = document.createElement("button");
  typeBtn.type = "button";
  typeBtn.className = "filtro-card-type-btn";
  typeBtn.innerHTML = `${getIconForType(tipo)} <span>${getTipoLabel(tipo)}</span>`;
  typeBtn.addEventListener("click", (e) => { e.stopPropagation(); abrirPopoverTipo(typeBtn, planilha, coluna, schemaCol, card); });

  const nome = document.createElement("span");
  nome.className = "filtro-card-nome";
  nome.textContent = coluna;

  const chevron = document.createElement("i");
  chevron.className = "ph ph-caret-down filtro-card-chevron";

  header.appendChild(typeBtn);
  header.appendChild(nome);
  header.appendChild(chevron);

  const body = document.createElement("div");
  body.className = "filtro-card-body";
  body.hidden = true;
  preencherCardBody(body, planilha, coluna, schemaCol, card);

  header.addEventListener("click", () => {
    const isOpen = !body.hidden;
    body.hidden = isOpen;
    card.classList.toggle("filtro-card--open", !isOpen);
    if (!isOpen) body.querySelector(".filtro-card-input-principal")?.focus();
  });

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

function preencherCardBody(body, planilha, coluna, schemaCol, card) {
  const tipo = schemaCol?.type || "text";
  body.innerHTML = "";
  const pid = planilha.id;
  const col = escHtml(coluna);

  if (tipo === "number") {
    body.innerHTML = `
      <div class="filtro-card-row">
        <select class="filtro-card-op-select num-op-select" data-op="num-op">
          <option value="range">Intervalo (De/Até)</option>
          <option value="exact">Valor Exato (=)</option>
        </select>
      </div>
      <div class="num-inputs-area">
        <div class="filtro-card-row">
          <div class="filtro-card-field">
            <label class="filtro-card-field-label">Mínimo</label>
            <input type="number" class="filtro-card-input filtro-card-input-principal" step="any" data-op="range-min">
          </div>
          <div class="filtro-card-field">
            <label class="filtro-card-field-label">Máximo</label>
            <input type="number" class="filtro-card-input" step="any" data-op="range-max">
          </div>
        </div>
      </div>`;

    const opSelect = body.querySelector(".num-op-select");
    const inputsArea = body.querySelector(".num-inputs-area");
    const setupNumInputs = () => {
      inputsArea.querySelectorAll("input").forEach(input => {
        input.addEventListener("input", () => {
          const temValor = Array.from(inputsArea.querySelectorAll("input")).some(i => i.value.trim() !== "");
          card.classList.toggle("filtro-card--ativo", temValor);
          atualizarChipsFiltrosAtivos();
        });
      });
    };
    opSelect.addEventListener("change", () => {
      if (opSelect.value === "range") {
        inputsArea.innerHTML = `
          <div class="filtro-card-row">
            <div class="filtro-card-field"><label class="filtro-card-field-label">Mínimo</label><input type="number" class="filtro-card-input filtro-card-input-principal" step="any" data-op="range-min"></div>
            <div class="filtro-card-field"><label class="filtro-card-field-label">Máximo</label><input type="number" class="filtro-card-input" step="any" data-op="range-max"></div>
          </div>`;
      } else {
        inputsArea.innerHTML = `
          <div class="filtro-card-row">
            <div class="filtro-card-field"><label class="filtro-card-field-label">Valor exato</label><input type="number" class="filtro-card-input filtro-card-input-principal" step="any" data-op="exact-val" placeholder="Ex: 123"></div>
          </div>`;
      }
      card.classList.remove("filtro-card--ativo");
      atualizarChipsFiltrosAtivos();
      setupNumInputs();
    });
    setupNumInputs();
  } else if (tipo === "date") {
    body.innerHTML = `
      <div class="filtro-card-row">
        <select class="filtro-card-op-select date-op-select" data-op="date-op">
          <option value="period">Período (De/Até)</option>
          <option value="exact">Dia Específico (=)</option>
        </select>
      </div>
      <div class="date-inputs-area">
        <div class="filtro-card-row">
          <div class="filtro-card-field">
            <label class="filtro-card-field-label">De</label>
            <input type="date" class="filtro-card-input filtro-card-input-principal" data-op="period-start">
          </div>
          <div class="filtro-card-field">
            <label class="filtro-card-field-label">Até</label>
            <input type="date" class="filtro-card-input" data-op="period-end">
          </div>
        </div>
      </div>`;

    const opSelect = body.querySelector(".date-op-select");
    const inputsArea = body.querySelector(".date-inputs-area");
    const setupDateInputs = () => {
      inputsArea.querySelectorAll("input").forEach(input => {
        input.addEventListener("input", () => {
          const temValor = Array.from(inputsArea.querySelectorAll("input")).some(i => i.value.trim() !== "");
          card.classList.toggle("filtro-card--ativo", temValor);
          atualizarChipsFiltrosAtivos();
        });
      });
    };
    opSelect.addEventListener("change", () => {
      if (opSelect.value === "period") {
        inputsArea.innerHTML = `
          <div class="filtro-card-row">
            <div class="filtro-card-field"><label class="filtro-card-field-label">De</label><input type="date" class="filtro-card-input filtro-card-input-principal" data-op="period-start"></div>
            <div class="filtro-card-field"><label class="filtro-card-field-label">Até</label><input type="date" class="filtro-card-input" data-op="period-end"></div>
          </div>`;
      } else {
        inputsArea.innerHTML = `
          <div class="filtro-card-row">
            <div class="filtro-card-field"><label class="filtro-card-field-label">Data exata</label><input type="date" class="filtro-card-input filtro-card-input-principal" data-op="exact-date"></div>
          </div>`;
      }
      card.classList.remove("filtro-card--ativo");
      atualizarChipsFiltrosAtivos();
      setupDateInputs();
    });
    setupDateInputs();
  } else {
    body.innerHTML = `
      <div class="filtro-card-row filtro-card-row--text">
        <select class="filtro-card-op-select" data-op="text-op"><option value="contains">Contém</option><option value="exact">Exato</option><option value="starts">Começa com</option><option value="ends">Termina com</option></select>
        <input type="text" class="filtro-card-input filtro-card-input-principal" placeholder="Digite..." data-op="text-val">
      </div>`;
  }

  const limparBtn = document.createElement("button");
  limparBtn.className = "filtro-card-limpar"; limparBtn.innerHTML = '<i class="ph ph-x"></i> Limpar';
  limparBtn.addEventListener("click", () => { body.querySelectorAll("input").forEach(i => i.value = ""); card.classList.remove("filtro-card--ativo"); atualizarChipsFiltrosAtivos(); });
  body.appendChild(limparBtn);

  body.addEventListener("input", (e) => {
    if (tipo !== "number" && tipo !== "date") {
      const inputs = body.querySelectorAll("input");
      const temValor = Array.from(inputs).some(i => i.value.trim() !== "");
      card.classList.toggle("filtro-card--ativo", temValor);
      atualizarChipsFiltrosAtivos();
    }
  });
}

function coletarFiltros() {
  const filtros = {};
  document.querySelectorAll(".filtro-card--ativo").forEach(card => {
    const pid = String(card.dataset.planilha);
    const coluna = card.dataset.coluna;
    const tipo = card.dataset.type || "text";
    if (!filtros[pid]) filtros[pid] = [];

    if (tipo === "number") {
      const op = card.querySelector("[data-op='num-op']")?.value || "range";
      if (op === "range") {
        const min = card.querySelector("[data-op='range-min']")?.value.trim();
        const max = card.querySelector("[data-op='range-max']")?.value.trim();
        if (min || max) filtros[pid].push({ coluna, valores: [min, max], type: "range" });
      } else {
        const val = card.querySelector("[data-op='exact-val']")?.value.trim();
        if (val) filtros[pid].push({ coluna, valores: [val], type: "exact" });
      }
    } else if (tipo === "date") {
      const op = card.querySelector("[data-op='date-op']")?.value || "period";
      if (op === "period") {
        const start = card.querySelector("[data-op='period-start']")?.value.trim();
        const end = card.querySelector("[data-op='period-end']")?.value.trim();
        if (start || end) filtros[pid].push({ coluna, valores: [start, end], type: "period" });
      } else {
        const val = card.querySelector("[data-op='exact-date']")?.value.trim();
        if (val) filtros[pid].push({ coluna, valores: [val], type: "exact" });
      }
    } else {
      const val = card.querySelector("[data-op='text-val']")?.value.trim();
      const op = card.querySelector("[data-op='text-op']")?.value || "contains";
      if (val) filtros[pid].push({ coluna, valores: [val], type: op });
    }
  });
  return filtros;
}

async function buscar() {
  const globalTerm = document.getElementById("global-search")?.value.trim().toLowerCase();
  const tableWrapper = document.getElementById("table-wrapper");
  if (tableWrapper) tableWrapper.innerHTML = '<p class="table-placeholder">Buscando…</p>';
  toggleLoading(true, "Filtrando dados...");
  await new Promise(r => setTimeout(r, 50));
  const filtrosPorPlanilha = coletarFiltros();
  const resultados = [];
  try {
    for (const p of planilhas) {
      const dados = await carregarDadosPlanilha(p.id);
      const filtros = filtrosPorPlanilha[String(p.id)] || [];
      const schema = p.schema || {};
      for (const linha of dados) {
        if (globalTerm) {
          if (!Object.values(linha).join(" ").toLowerCase().includes(globalTerm)) continue;
        }
        if (filtros.length > 0 && !linhaPassaFiltros(linha, filtros, schema)) continue;
        resultados.push({ _arquivo: p.nome, ...linha });
      }
    }
    totalResultados = resultados; paginaAtual = 1; renderPagina();
  } catch (err) { console.error(err); } finally { toggleLoading(false); }
}

function linhaPassaFiltros(linha, filtros, schema) {
  for (const f of filtros) {
    const { coluna, valores, type } = f;
    const rawVal = linha[coluna];
    const s = schema[coluna] || { type: 'text' };
    if (rawVal === undefined || rawVal === null) return false;

    if (s.type === 'number') {
      const num = parseNumber(rawVal, s.decimal || ",");
      if (isNaN(num)) return false;
      if (type === 'range') {
        const min = parseNumber(valores[0], s.decimal || ",");
        const max = parseNumber(valores[1], s.decimal || ",");
        if (!isNaN(min) && num < min) return false;
        if (!isNaN(max) && num > max) return false;
      } else if (type === 'exact') {
        const target = parseNumber(valores[0], s.decimal || ",");
        if (!isNaN(target) && num !== target) return false;
      }
    } else if (s.type === 'date') {
      const dt = parseDate(rawVal, s.format);
      if (!dt) return false;

      // Normalização para string YYYY-MM-DD para comparação segura sem fuso horário
      const dtString = dt.getFullYear() + "-" + 
                       String(dt.getMonth() + 1).padStart(2, '0') + "-" + 
                       String(dt.getDate()).padStart(2, '0');
      
      if (type === 'period') {
        // valores[0] e [1] já vêm do input como YYYY-MM-DD
        const startVal = valores[0];
        const endVal = valores[1];
        
        if (startVal && dtString < startVal) return false;
        if (endVal && dtString > endVal) return false;
      } else if (type === 'exact') {
        const targetVal = valores[0]; // YYYY-MM-DD
        if (targetVal && dtString !== targetVal) return false;
      }
    } else {
      const cell = String(rawVal).toLowerCase();
      const term = String(valores[0]).toLowerCase();
      if (type === "exact") { if (cell !== term) return false; }
      else if (type === "starts") { if (!cell.startsWith(term)) return false; }
      else if (type === "ends") { if (!cell.endsWith(term)) return false; }
      else { if (!cell.includes(term)) return false; }
    }
  }
  return true;
}

function getTipoLabel(type) { return { text: "ABC", number: "123", date: "DATA" }[type] || "ABC"; }
function getIconForType(type) {
  if (type === "number") return '<i class="ph ph-hash"></i>';
  if (type === "date") return '<i class="ph ph-calendar"></i>';
  return '<i class="ph ph-text-aa"></i>';
}
function parseNumber(val, decimalSep) {
  if (val === null || val === undefined || val === "") return NaN;
  let s = String(val).replace(/[R$\s]/g, "");
  if (decimalSep === ",") { s = s.replace(/\./g, "").replace(",", "."); }
  else { s = s.replace(/,/g, ""); }
  return parseFloat(s);
}
function parseDate(val, format) {
  if (!val) return null;
  const s = String(val).trim();

  // 1. Trata YYYY-MM-DD (formato do input date do navegador)
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1]);
    const m = parseInt(isoMatch[2]) - 1;
    const d = parseInt(isoMatch[3]);
    // Usando o construtor numérico, o JS assume Horário Local. 
    // new Date("2026-04-01") -> UTC (Errado)
    // new Date(2026, 3, 1)    -> Local (Correto)
    const date = new Date(y, m, d);
    return isNaN(date.getTime()) ? null : date;
  }

  // 2. Trata formatos de planilha (DD/MM/YYYY ou MM/DD/YYYY)
  const match = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(\s\d{2}:\d{2})?/);
  if (!match) return null;

  let d, m, y;
  if (format === "MM/DD/YYYY") {
    m = parseInt(match[1]) - 1;
    d = parseInt(match[2]);
    y = parseInt(match[3]);
  } else {
    d = parseInt(match[1]);
    m = parseInt(match[2]) - 1;
    y = parseInt(match[3]);
  }
  
  if (y < 100) y += 2000;

  let hh = 0, mm = 0;
  if (match[4]) {
    const timeParts = match[4].trim().split(":");
    hh = parseInt(timeParts[0]) || 0;
    mm = parseInt(timeParts[1]) || 0;
  }

  // Também usando construtor numérico para garantir Local Time
  const date = new Date(y, m, d, hh, mm);
  return isNaN(date.getTime()) ? null : date;
}
function atualizarChipsFiltrosAtivos() {
  const bar = document.getElementById("filtros-chips-bar");
  if (!bar) return;
  const chips = [];
  const globalVal = document.getElementById("global-search")?.value.trim();
  if (globalVal) { chips.push({ label: `Busca: "${globalVal}"`, onRemove: () => { document.getElementById("global-search").value = ""; atualizarChipsFiltrosAtivos(); } }); }
  document.querySelectorAll(".filtro-card--ativo").forEach(card => {
    const coluna = card.dataset.coluna;
    const tipo = card.dataset.type || "text";
    let resumo = "";
    if (tipo === "number") {
      const op = card.querySelector("[data-op='num-op']")?.value || "range";
      if (op === "range") {
        const min = card.querySelector("[data-op='range-min']")?.value.trim();
        const max = card.querySelector("[data-op='range-max']")?.value.trim();
        if (min && max) resumo = `${coluna}: ${min}–${max}`;
        else if (min) resumo = `${coluna} ≥ ${min}`;
        else if (max) resumo = `${coluna} ≤ ${max}`;
      } else {
        const val = card.querySelector("[data-op='exact-val']")?.value.trim();
        if (val) resumo = `${coluna} = ${val}`;
      }
    } else if (tipo === "date") {
      const op = card.querySelector("[data-op='date-op']")?.value || "period";
      if (op === "period") {
        const s = card.querySelector("[data-op='period-start']")?.value.trim();
        const e = card.querySelector("[data-op='period-end']")?.value.trim();
        if (s && e) resumo = `${coluna}: ${formatDateBR(s)}–${formatDateBR(e)}`;
        else if (s) resumo = `${coluna} de ${formatDateBR(s)}`;
        else if (e) resumo = `${coluna} até ${formatDateBR(e)}`;
      } else {
        const val = card.querySelector("[data-op='exact-date']")?.value.trim();
        if (val) resumo = `${coluna} = ${formatDateBR(val)}`;
      }
    } else {
      const val = card.querySelector("[data-op='text-val']")?.value.trim();
      const op = card.querySelector("[data-op='text-op']")?.value || "contains";
      const lbl = { contains: "contém", exact: "é", starts: "começa com", ends: "termina com" }[op];
      if (val) resumo = `${coluna} ${lbl} "${val}"`;
    }
    if (resumo) chips.push({ label: resumo, onRemove: () => { card.querySelectorAll("input").forEach(i => i.value = ""); card.classList.remove("filtro-card--ativo"); atualizarChipsFiltrosAtivos(); } });
  });
  if (!chips.length) { bar.innerHTML = '<span class="filtros-chips-vazio">Nenhum filtro ativo</span>'; return; }
  bar.innerHTML = "";
  chips.forEach(({ label, onRemove }) => {
    const chip = document.createElement("span"); chip.className = "filtro-chip";
    chip.innerHTML = `<span class="filtro-chip-label">${escHtml(label)}</span><button class="filtro-chip-remove"><i class="ph ph-x"></i></button>`;
    chip.querySelector(".filtro-chip-remove").addEventListener("click", onRemove);
    bar.appendChild(chip);
  });
}
function formatDateBR(iso) { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; }
function escHtml(str) { return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function toggleLoading(active, msg = "Processando...", percent = null) {
  let loader = document.getElementById("global-loader");
  if (!loader) {
    loader = document.createElement("div"); loader.id = "global-loader"; loader.className = "global-loader";
    loader.innerHTML = `<div class="loader-content"><div class="progress-container" id="progress-container" style="display:none"><div class="progress-bar" id="progress-bar"></div></div><p id="loader-text"></p></div>`;
    document.body.appendChild(loader);
  }
  loader.querySelector("#loader-text").textContent = msg;
  const pb = loader.querySelector("#progress-bar");
  const pc = loader.querySelector("#progress-container");
  if (percent !== null) { pc.style.display = "block"; pb.style.width = Math.min(100, Math.max(0, percent)) + "%"; } else { pc.style.display = "none"; }
  active ? loader.classList.add("active") : loader.classList.remove("active");
}
function initTheme(btn) {
  const isLight = localStorage.getItem("theme") === "light";
  document.body.classList.toggle("light-mode", isLight);
  btn?.addEventListener("click", () => { const L = document.body.classList.toggle("light-mode"); localStorage.setItem("theme", L ? "light" : "dark"); });
}
function initSettingsMenu(btn, menu) {
  btn?.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener("click", () => { if (menu) menu.hidden = true; });
}
function initMobileSidebar(btn) {
  btn?.addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
}
function abrirPopoverTipo(btn, planilha, coluna, schemaColAtual, card) {
  document.querySelector(".tipo-popover")?.remove();
  const tipoAtual = card.dataset.type || "text";
  const tipos = [{ v: "text", l: "Texto", i: "ph-text-aa" }, { v: "number", l: "Número", i: "ph-hash" }, { v: "date", l: "Data", i: "ph-calendar" }];
  const pop = document.createElement("div"); pop.className = "tipo-popover";
  pop.innerHTML = `<div class="tipo-popover-header">Tipo da coluna</div>` + tipos.map(t => `<button class="tipo-popover-opt${t.v === tipoAtual ? " active" : ""}" data-type="${t.v}"><i class="ph ${t.i}"></i> ${t.l}</button>`).join("");
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect(); pop.style.top = (r.bottom + window.scrollY + 6) + "px"; pop.style.left = Math.min(r.left, window.innerWidth - 180) + "px";
  pop.querySelectorAll(".tipo-popover-opt").forEach(opt => opt.addEventListener("click", async () => {
    const nt = opt.dataset.type; pop.remove(); if (nt === tipoAtual) return;
    const nsCol = { type: nt, decimal: nt === "number" ? "," : null, format: nt === "date" ? "DD/MM/YYYY" : null };
    planilha.schema = { ...(planilha.schema || {}), [coluna]: nsCol };
    await salvarSchemaLocal(planilha.id, planilha.schema);
    card.dataset.type = nt; btn.innerHTML = `${getIconForType(nt)} <span>${getTipoLabel(nt)}</span>`;
    const body = card.querySelector(".filtro-card-body");
    card.classList.remove("filtro-card--ativo"); preencherCardBody(body, planilha, coluna, nsCol, card); atualizarChipsFiltrosAtivos();
  }));
  setTimeout(() => document.addEventListener("click", function h(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener("click", h); } }), 0);
}
function renderPagina() {
  const colMap = new Map();
  totalResultados.forEach(row => Object.keys(row).forEach(k => { const n = k.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); if (!colMap.has(n)) colMap.set(n, k); }));
  ultimasColunas = [...colMap.values()];
  const totalP = Math.ceil(totalResultados.length / PAGE_SIZE);
  const start = (paginaAtual - 1) * PAGE_SIZE;
  renderTabela(totalResultados.slice(start, start + PAGE_SIZE));
  renderControlesPaginacao(totalP);
}
function renderTabela(rows) {
  const wrap = document.getElementById("table-wrapper");
  const bar = document.getElementById("results-bar");
  const cnt = document.getElementById("results-count");
  if (!rows.length) { if (wrap) wrap.innerHTML = '<p class="table-placeholder">Nenhum resultado.</p>'; if (bar) bar.hidden = true; return; }
  if (cnt) cnt.textContent = `${totalResultados.length.toLocaleString("pt-BR")} resultados encontrados`;
  if (bar) bar.hidden = false;
  const table = document.createElement("table"); table.className = "results-table";
  const head = document.createElement("thead"); const hr = document.createElement("tr");
  ultimasColunas.forEach(c => { const th = document.createElement("th"); th.textContent = c.startsWith("_") ? c.slice(1) : c; hr.appendChild(th); });
  head.appendChild(hr); table.appendChild(head);
  const body = document.createElement("tbody");
  rows.forEach(row => { const tr = document.createElement("tr"); ultimasColunas.forEach(c => { const td = document.createElement("td"); td.textContent = row[c] ?? ""; tr.appendChild(td); }); body.appendChild(tr); });
  table.appendChild(body);
  if (wrap) { wrap.innerHTML = ""; wrap.appendChild(table); }
}
function renderControlesPaginacao(total) {
  const el = document.getElementById("pagination"); if (!el) return;
  if (total <= 1) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<button class="btn-page" id="pg-prev" ${paginaAtual === 1 ? "disabled" : ""}>Anterior</button><span class="pagination-info">Página ${paginaAtual} de ${total}</span><button class="btn-page" id="pg-next" ${paginaAtual === total ? "disabled" : ""}>Próxima</button>`;
  document.getElementById("pg-prev")?.addEventListener("click", () => { if (paginaAtual > 1) { paginaAtual--; renderPagina(); } });
  document.getElementById("pg-next")?.addEventListener("click", () => { if (paginaAtual < total) { paginaAtual++; renderPagina(); } });
}
async function abrirModalExport() {
  if (!totalResultados.length) return;
  confirmarExport(ultimasColunas.map(c => ({ label: c, original: c })));
}
async function confirmarExport(configColunas) {
  toggleLoading(true, "Gerando CSV...");
  try {
    const head = configColunas.map(c => `"${c.label.replace(/"/g, '""')}"`).join(";");
    const rows = totalResultados.map(row => configColunas.map(c => `"${String(row[c.original] ?? "").replace(/"/g, '""')}"`).join(";"));
    const blob = new Blob(["\uFEFF" + [head, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `export_${Date.now()}.csv`; a.click();
  } catch (e) { console.error(e); } finally { toggleLoading(false); }
}
