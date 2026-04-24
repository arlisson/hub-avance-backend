const LOGIN_URL = "/login/login.html";
const HUB_URL = "/paginaUnificada/index.html";
const WARN_ROWS = 50_000; // 50k linhas — avisa sobre filtros lentos
const PAGE_SIZE = 200;               // linhas por página na tabela de resultados

// ── ESTADO LOCAL ──────────────────────────────────────────
let planilhas = []; // [{ id, nome, colunas }] — dados ficam só no IndexedDB
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

async function salvarPlanilhaLocal({ nome, colunas, dados }) {
  try {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META, STORE_DADOS], "readwrite");
      const metaStore = tx.objectStore(STORE_META);
      const dadosStore = tx.objectStore(STORE_DADOS);
      const req = metaStore.add({ nome, colunas });
      req.onsuccess = (e) => {
        const id = e.target.result;
        dadosStore.add({ id, dados });
        resolve(id);
      };
      req.onerror = () => reject("Erro ao salvar planilha");
    });
  } catch (err) { console.error(err); }
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
      
      // 1. Remove os metadados
      tx.objectStore(STORE_META).delete(idNum);
      
      // 2. Remove todos os lotes vinculados no STORE_DADOS usando um cursor no índice
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

// ── INIT ──────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const themeToggle = document.getElementById("theme-toggle");
  const settingsBtn = document.getElementById("settings-btn");
  const settingsMenu = document.getElementById("settings-menu");
  const menuBackHub = document.getElementById("menu-back-hub");
  const menuLogout = document.getElementById("menu-logout");
  const mobileMenuBtn = document.getElementById("mobile-menu-btn");
  const userEmailEl = document.getElementById("user-email");

  initTheme(themeToggle);
  initSettingsMenu(settingsBtn, settingsMenu);
  initMobileSidebar(mobileMenuBtn);

  menuBackHub?.addEventListener("click", () => { window.location.href = HUB_URL; });
  menuLogout?.addEventListener("click", async () => {
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
  const fileInput = document.getElementById("file-input");

  uploadArea?.addEventListener("dragover", (e) => { e.preventDefault(); uploadArea.classList.add("drag-over"); });
  uploadArea?.addEventListener("dragleave", () => uploadArea.classList.remove("drag-over"));
  uploadArea?.addEventListener("drop", (e) => { e.preventDefault(); uploadArea.classList.remove("drag-over"); handleFiles(e.dataTransfer.files); });
  fileInput?.addEventListener("change", () => handleFiles(fileInput.files));

  document.getElementById("btn-buscar")?.addEventListener("click", buscar);
  document.getElementById("btn-export")?.addEventListener("click", abrirModalExport);
  document.getElementById("btn-limpar-tudo")?.addEventListener("click", limparTudo);

  // modal de filtros
  document.getElementById("btn-configurar-filtros")?.addEventListener("click", abrirModalFiltros);
  document.getElementById("btn-fechar-filtros")?.addEventListener("click", fecharModalFiltros);
  document.getElementById("btn-fechar-sem-buscar")?.addEventListener("click", fecharModalFiltros);
  document.getElementById("filtros-modal-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "filtros-modal-overlay") fecharModalFiltros();
  });
  document.getElementById("btn-aplicar-filtros")?.addEventListener("click", () => {
    fecharModalFiltros();
    buscar();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") fecharModalFiltros();
  });
});

// ── UPLOAD ────────────────────────────────────────────────
async function handleFiles(files) {
  const fileInput = document.getElementById("file-input");
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setStatus(`Upload bloqueado: "${file.name}" não é um arquivo CSV.`, "err");
      continue;
    }

    toggleLoading(true, `Processando ${file.name}...`);
    setStatus(`Processando ${file.name}…`, "");

    try {
      // O worker faz o parse do CSV e salva direto no IndexedDB
      // Só recebemos os metadados (id, colunas, total de linhas)
      const { id, colunas, linhas } = await parsearArquivo(file);

      planilhas.push({ id, nome: file.name, colunas });

      const isLargeRows = linhas > WARN_ROWS;
      if (isLargeRows) {
        setStatus(
          `${file.name} — ${linhas.toLocaleString("pt-BR")} linhas salvas. Filtros podem ser mais lentos em dispositivos antigos.`,
          "warn"
        );
      } else {
        setStatus(`${file.name} — ${linhas.toLocaleString("pt-BR")} linhas salvas`, "ok");
      }

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
    const worker = new Worker('./cofre-worker.js?v=' + Date.now());

    // Timeout longo de 5 minutos para arquivos CSV gigantes
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("Tempo limite excedido. O arquivo é grande demais para ser processado de uma vez."));
    }, 300_000);

    // Envia o objeto File direto para o worker
    worker.postMessage({ file, nome: file.name });

    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        toggleLoading(true, data.msg, data.percent);
        return;
      }
      clearTimeout(timeout);
      worker.terminate();
      data.ok ? resolve(data) : reject(new Error(data.error));
    };

    worker.onerror = (err) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(err.message || "Erro desconhecido no processamento do arquivo."));
    };
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
  totalResultados = [];
  paginaAtual = 1;
  renderLista();
  renderFiltrosPanel();

  const tableWrapper = document.getElementById("table-wrapper");
  if (tableWrapper) tableWrapper.innerHTML = '<p class="table-placeholder">Faça upload de planilhas e clique em Buscar.</p>';
  const resultsBar = document.getElementById("results-bar");
  if (resultsBar) resultsBar.hidden = true;
  const pagination = document.getElementById("pagination");
  if (pagination) pagination.hidden = true;

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
      <i class="ph ph-file-csv" style="color:var(--accent-cyan);flex-shrink:0"></i>
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
function abrirModalFiltros() {
  const overlay = document.getElementById("filtros-modal-overlay");
  if (!overlay) return;
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
  document.getElementById("global-search")?.focus();
}

function fecharModalFiltros() {
  const overlay = document.getElementById("filtros-modal-overlay");
  if (!overlay) return;
  overlay.hidden = true;
  document.body.style.overflow = "";
  // atualiza badge do botão com contagem de filtros ativos
  const count = document.querySelectorAll(".filtro-card--ativo").length
    + (document.getElementById("global-search")?.value.trim() ? 1 : 0);
  const btn = document.getElementById("btn-configurar-filtros");
  if (btn) btn.classList.toggle("has-filters", count > 0);
}

function renderFiltrosPanel() {
  const lista = document.getElementById("filtros-lista");
  if (!lista) return;
  lista.innerHTML = "";

  if (!planilhas.length) {
    lista.innerHTML = '<p class="filtro-vazio">Faça upload de planilhas para ver os filtros.</p>';
    return;
  }

  // 1. Busca global
  const globalSearchBox = document.createElement("div");
  globalSearchBox.className = "global-search-box";
  globalSearchBox.innerHTML = `
    <div class="input-with-icon">
      <i class="ph ph-magnifying-glass"></i>
      <input type="text" id="global-search" placeholder="Busca rápida em todos os dados..." class="global-search-input">
    </div>
  `;
  lista.appendChild(globalSearchBox);
  globalSearchBox.querySelector("#global-search").addEventListener("input", atualizarChipsFiltrosAtivos);

  // 2. Navegação por Abas (se houver mais de uma planilha)
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
        
        drawer.querySelectorAll(".filtro-panel-planilha").forEach(panel => {
          panel.hidden = panel.dataset.planilhaId !== String(p.id);
        });
        
        const colInput = document.getElementById("coluna-search");
        if (colInput) { colInput.value = ""; filtrarColunasVisiveis(""); }
      });
      
      tabsContainer.appendChild(tab);
    });
    lista.appendChild(tabsContainer);
  }

  // 3. Busca de coluna
  const colSearch = document.createElement("div");
  colSearch.className = "filtro-coluna-search";
  colSearch.innerHTML = `
    <div class="input-with-icon">
      <i class="ph ph-list-magnifying-glass"></i>
      <input type="text" id="coluna-search" placeholder="Encontrar uma coluna específica..." class="coluna-search-input">
    </div>
  `;
  lista.appendChild(colSearch);
  colSearch.querySelector("#coluna-search").addEventListener("input", (e) => filtrarColunasVisiveis(e.target.value));

  // 4. Painéis de colunas — um por planilha, todos no DOM (preserva filtros ao trocar aba)
  planilhas.forEach((p, i) => {
    const panel = document.createElement("div");
    panel.className = "filtro-panel-planilha";
    panel.dataset.planilhaId = p.id;
    panel.hidden = i !== 0;
    for (const col of p.colunas) {
      panel.appendChild(criarCartaoColuna(p, col, p.schema?.[col]));
    }
    drawer.appendChild(panel);
  });

  lista.appendChild(drawer);
}

function filtrarColunasVisiveis(termo) {
  const t = termo.trim().toLowerCase();
  const activePanel = document.querySelector(".filtro-panel-planilha:not([hidden])");
  if (!activePanel) return;
  activePanel.querySelectorAll(".filtro-card").forEach(card => {
    card.hidden = t !== "" && !card.dataset.coluna.toLowerCase().includes(t);
  });
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
  typeBtn.title = "Clique para mudar o tipo (Texto, Número ou Data)";
  typeBtn.innerHTML = `${getIconForType(tipo)} <span>${getTipoLabel(tipo)}</span>`;
  typeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    abrirPopoverTipo(typeBtn, planilha, coluna, schemaCol, card);
  });

  const nome = document.createElement("span");
  nome.className = "filtro-card-nome";
  nome.textContent = coluna;
  nome.title = coluna;

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
        <select class="filtro-card-op-select num-op-select" data-planilha="${pid}" data-coluna="${col}" data-op="num-op">
          <option value="range">Intervalo (De/Até)</option>
          <option value="exact">Valor Exato (=)</option>
        </select>
      </div>
      <div class="num-inputs-area">
        <div class="filtro-card-row">
          <div class="filtro-card-field">
            <label class="filtro-card-field-label">Mínimo</label>
            <input type="number" class="filtro-card-input filtro-card-input-principal" step="any"
              data-planilha="${pid}" data-coluna="${col}" data-op="range-min">
          </div>
          <div class="filtro-card-field">
            <label class="filtro-card-field-label">Máximo</label>
            <input type="number" class="filtro-card-input" step="any"
              data-planilha="${pid}" data-coluna="${col}" data-op="range-max">
          </div>
        </div>
      </div>
    `;

    const opSelect = body.querySelector(".num-op-select");
    const inputsArea = body.querySelector(".num-inputs-area");

    opSelect.addEventListener("change", () => {
      const isRange = opSelect.value === "range";
      if (isRange) {
        inputsArea.innerHTML = `
          <div class="filtro-card-row">
            <div class="filtro-card-field">
              <label class="filtro-card-field-label">Mínimo</label>
              <input type="number" class="filtro-card-input filtro-card-input-principal" step="any"
                data-planilha="${pid}" data-coluna="${col}" data-op="range-min">
            </div>
            <div class="filtro-card-field">
              <label class="filtro-card-field-label">Máximo</label>
              <input type="number" class="filtro-card-input" step="any"
                data-planilha="${pid}" data-coluna="${col}" data-op="range-max">
            </div>
          </div>
        `;
      } else {
        inputsArea.innerHTML = `
          <div class="filtro-card-row">
            <div class="filtro-card-field">
              <label class="filtro-card-field-label">Valor exato</label>
              <input type="number" class="filtro-card-input filtro-card-input-principal" step="any"
                data-planilha="${pid}" data-coluna="${col}" data-op="exact-val" placeholder="Ex: 123">
            </div>
          </div>
        `;
      }
      card.classList.remove("filtro-card--ativo");
      atualizarChipsFiltrosAtivos();
    });
  } else if (tipo === "date") {
    body.innerHTML = `
      <div class="filtro-card-row">
        <div class="filtro-card-field">
          <label class="filtro-card-field-label">De</label>
          <input type="date" class="filtro-card-input filtro-card-input-principal"
            data-planilha="${pid}" data-coluna="${col}" data-op="period-start">
        </div>
        <div class="filtro-card-field">
          <label class="filtro-card-field-label">Até</label>
          <input type="date" class="filtro-card-input"
            data-planilha="${pid}" data-coluna="${col}" data-op="period-end">
        </div>
      </div>
    `;
  } else {
    body.innerHTML = `
      <div class="filtro-card-row filtro-card-row--text">
        <select class="filtro-card-op-select" data-planilha="${pid}" data-coluna="${col}" data-op="text-op">
          <option value="contains">Contém</option>
          <option value="exact">Exato</option>
          <option value="starts">Começa com</option>
          <option value="ends">Termina com</option>
        </select>
        <input type="text" class="filtro-card-input filtro-card-input-principal" placeholder="Digite para filtrar..."
          data-planilha="${pid}" data-coluna="${col}" data-op="text-val">
      </div>
    `;
  }

  const limparBtn = document.createElement("button");
  limparBtn.type = "button";
  limparBtn.className = "filtro-card-limpar";
  limparBtn.innerHTML = '<i class="ph ph-x"></i> Limpar este campo';
  limparBtn.addEventListener("click", () => {
    body.querySelectorAll("input").forEach(i => i.value = "");
    card.classList.remove("filtro-card--ativo");
    atualizarChipsFiltrosAtivos();
  });
  body.appendChild(limparBtn);

  body.addEventListener("input", () => {
    const inputs = body.querySelectorAll("input");
    const temValor = Array.from(inputs).some(i => i.value.trim() !== "");
    card.classList.toggle("filtro-card--ativo", temValor);
    atualizarChipsFiltrosAtivos();
  });
}

function atualizarChipsFiltrosAtivos() {
  const bar = document.getElementById("filtros-chips-bar");
  if (!bar) return;

  const chips = [];

  const globalVal = document.getElementById("global-search")?.value.trim();
  if (globalVal) {
    chips.push({
      label: `Busca: "${globalVal}"`,
      onRemove: () => {
        const el = document.getElementById("global-search");
        if (el) el.value = "";
        atualizarChipsFiltrosAtivos();
      }
    });
  }

  document.querySelectorAll(".filtro-card--ativo").forEach(card => {
    const coluna = card.dataset.coluna;
    const tipo = card.dataset.type || "text";
    let resumo = "";

    if (tipo === "number") {
      const min = card.querySelector("[data-op='range-min']")?.value.trim();
      const max = card.querySelector("[data-op='range-max']")?.value.trim();
      if (min && max) resumo = `${coluna}: ${min} – ${max}`;
      else if (min) resumo = `${coluna} ≥ ${min}`;
      else if (max) resumo = `${coluna} ≤ ${max}`;
    } else if (tipo === "date") {
      const s = card.querySelector("[data-op='period-start']")?.value.trim();
      const e = card.querySelector("[data-op='period-end']")?.value.trim();
      if (s && e) resumo = `${coluna}: ${formatDateBR(s)} – ${formatDateBR(e)}`;
      else if (s) resumo = `${coluna} de ${formatDateBR(s)}`;
      else if (e) resumo = `${coluna} até ${formatDateBR(e)}`;
    } else {
      const val = card.querySelector("[data-op='text-val']")?.value.trim();
      const op = card.querySelector("[data-op='text-op']")?.value || "contains";
      const opLabel = { contains: "contém", exact: "é", starts: "começa com", ends: "termina com" }[op] || "contém";
      if (val) resumo = `${coluna} ${opLabel} "${val}"`;
    }

    if (resumo) {
      chips.push({
        label: resumo,
        onRemove: () => {
          card.querySelectorAll("input").forEach(i => i.value = "");
          card.classList.remove("filtro-card--ativo");
          atualizarChipsFiltrosAtivos();
        }
      });
    }
  });

  if (!chips.length) {
    bar.innerHTML = '<span class="filtros-chips-vazio">Nenhum filtro ativo</span>';
    return;
  }

  bar.innerHTML = "";
  chips.forEach(({ label, onRemove }) => {
    const chip = document.createElement("span");
    chip.className = "filtro-chip";
    chip.innerHTML = `<span class="filtro-chip-label">${escHtml(label)}</span><button type="button" class="filtro-chip-remove" title="Remover filtro"><i class="ph ph-x"></i></button>`;
    chip.querySelector(".filtro-chip-remove").addEventListener("click", onRemove);
    bar.appendChild(chip);
  });

  if (chips.length > 1) {
    const limparBtn = document.createElement("button");
    limparBtn.type = "button";
    limparBtn.className = "filtros-limpar-tudo";
    limparBtn.textContent = "Limpar tudo";
    limparBtn.addEventListener("click", () => {
      const el = document.getElementById("global-search");
      if (el) el.value = "";
      document.querySelectorAll(".filtro-card--ativo").forEach(c => {
        c.querySelectorAll("input").forEach(i => i.value = "");
        c.classList.remove("filtro-card--ativo");
      });
      atualizarChipsFiltrosAtivos();
    });
    bar.appendChild(limparBtn);
  }
}

function formatDateBR(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function abrirPopoverTipo(btn, planilha, coluna, schemaColAtual, card) {
  document.querySelector(".tipo-popover")?.remove();

  const tipoAtual = schemaColAtual?.type || "text";
  const tipos = [
    { value: "text", label: "Texto", icon: "ph-text-aa" },
    { value: "number", label: "Número", icon: "ph-hash" },
    { value: "date", label: "Data", icon: "ph-calendar" },
  ];

  const pop = document.createElement("div");
  pop.className = "tipo-popover";
  pop.innerHTML = `
    <div class="tipo-popover-header">Tipo da coluna</div>
    ${tipos.map(t => `
      <button type="button" class="tipo-popover-opt${t.value === tipoAtual ? " active" : ""}" data-type="${t.value}">
        <i class="ph ${t.icon}"></i> ${t.label}
        ${t.value === tipoAtual ? '<i class="ph ph-check" style="margin-left:auto"></i>' : ""}
      </button>
    `).join("")}
  `;
  document.body.appendChild(pop);

  const rect = btn.getBoundingClientRect();
  pop.style.top = (rect.bottom + window.scrollY + 6) + "px";
  pop.style.left = Math.min(rect.left, window.innerWidth - 180) + "px";

  pop.querySelectorAll(".tipo-popover-opt").forEach(optBtn => {
    optBtn.addEventListener("click", async () => {
      const novoTipo = optBtn.dataset.type;
      pop.remove();
      if (novoTipo === tipoAtual) return;

      const novoSchemaCol = {
        type: novoTipo,
        decimal: novoTipo === "number" ? "," : null,
        format: novoTipo === "date" ? "DD/MM/YYYY" : null
      };
      const novoSchema = { ...(planilha.schema || {}), [coluna]: novoSchemaCol };

      await salvarSchemaLocal(planilha.id, novoSchema);
      planilha.schema = novoSchema;

      card.dataset.type = novoTipo;
      btn.innerHTML = getIconForType(novoTipo);
      btn.title = `Tipo: ${getTipoLabel(novoTipo)}. Clique para alterar.`;

      const body = card.querySelector(".filtro-card-body");
      if (body) {
        card.querySelectorAll("input").forEach(i => i.value = "");
        card.classList.remove("filtro-card--ativo");
        preencherCardBody(body, planilha, coluna, novoSchemaCol, card);
        atualizarChipsFiltrosAtivos();
      }
    });
  });

  setTimeout(() => {
    document.addEventListener("click", function handler(e) {
      if (!pop.contains(e.target) && e.target !== btn) {
        pop.remove();
        document.removeEventListener("click", handler);
      }
    });
  }, 0);
}

function getTipoLabel(type) {
  return { text: "ABC", number: "123", date: "DATA" }[type] || "ABC";
}

function criarItemColuna() {} // mantido por compatibilidade — substituído por criarCartaoColuna
function adicionarTag() {}   // mantido por compatibilidade — não mais utilizado

function coletarFiltros() {
  const filtros = {};

  document.querySelectorAll(".filtro-card--ativo").forEach(card => {
    const pid = card.dataset.planilha;
    const coluna = card.dataset.coluna;
    const tipo = card.dataset.type || "text";

    if (!filtros[pid]) filtros[pid] = [];

    if (tipo === "number") {
      const min = card.querySelector("[data-op='range-min']")?.value.trim();
      const max = card.querySelector("[data-op='range-max']")?.value.trim();
      if (min || max) filtros[pid].push({ coluna, valores: [min || "", max || ""], type: "range" });
    } else if (tipo === "date") {
      const start = card.querySelector("[data-op='period-start']")?.value.trim();
      const end = card.querySelector("[data-op='period-end']")?.value.trim();
      if (start || end) {
        const fmt = v => { if (!v) return ""; const [y, m, d] = v.split("-"); return `${d}/${m}/${y}`; };
        filtros[pid].push({ coluna, valores: [fmt(start), fmt(end)], type: "period" });
      }
    } else {
      const val = card.querySelector("[data-op='text-val']")?.value.trim();
      const op = card.querySelector("[data-op='text-op']")?.value || "contains";
      if (val) filtros[pid].push({ coluna, valores: [val], type: op });
    }
  });

  return filtros;
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
        data.schema = schema;
        store.put(data);
        tx.oncomplete = resolve;
      };
      req.onerror = reject;
    });
  } catch (err) { console.error(err); }
}


// ── BUSCA ─────────────────────────────────────────────────
async function buscar() {
  const globalTerm = document.getElementById("global-search")?.value.trim().toLowerCase();
  const tableWrapper = document.getElementById("table-wrapper");
  const resultsBar = document.getElementById("results-bar");

  if (tableWrapper) tableWrapper.innerHTML = '<p class="table-placeholder">Buscando…</p>';
  if (resultsBar) resultsBar.hidden = true;
  toggleLoading(true, "Filtrando dados...");
  
  // Forçar o navegador a processar o loader antes de travar a thread
  await new Promise(r => setTimeout(r, 50));

  const filtrosPorPlanilha = coletarFiltros();
  const resultados = [];

  try {
    for (const p of planilhas) {
      const dados = await carregarDadosPlanilha(p.id);
      const filtrosDestaPlanilha = filtrosPorPlanilha[String(p.id)] || [];
      const schemaPlanilha = p.schema || {};

      for (const linha of dados) {
        // 1. Filtro Global
        if (globalTerm) {
          const valoresLinha = Object.values(linha).join(" ").toLowerCase();
          if (!valoresLinha.includes(globalTerm)) continue;
        }

        // 2. Filtros Específicos de Coluna
        if (filtrosDestaPlanilha.length > 0) {
          if (!linhaPassaFiltros(linha, filtrosDestaPlanilha, schemaPlanilha)) {
            continue;
          }
        }
        
        resultados.push({ _arquivo: p.nome, ...linha });
      }
    }

    totalResultados = resultados;
    paginaAtual = 1;
    renderPagina();
  } catch (err) {
    console.error("Erro durante a busca:", err);
    if (tableWrapper) tableWrapper.innerHTML = `<p class="table-placeholder err">Erro ao filtrar: ${err.message}</p>`;
  } finally {
    toggleLoading(false);
  }
}

function linhaPassaFiltros(linha, filtros, schema) {
  for (const f of filtros) {
    const { coluna, valores, type } = f;
    const rawValue = linha[coluna];
    const s = schema[coluna] || { type: 'text' };
    
    // Se a célula for nula/indefinida e houver filtro, não passa (exceto se o filtro for vazio, mas coletarFiltros já ignora vazios)
    if (rawValue === undefined || rawValue === null) return false;

    if (s.type === 'number') {
      const num = parseNumber(rawValue, s.decimal || ",");
      if (isNaN(num)) return false;

      if (type === 'range') {
        const min = parseNumber(valores[0], s.decimal || ",");
        const max = parseNumber(valores[1], s.decimal || ",");
        if (!isNaN(min) && num < min) return false;
        if (!isNaN(max) && num > max) return false;
      }
    } else if (s.type === 'date') {
      const dt = parseDate(rawValue, s.format);
      if (!dt) return false;

      if (type === 'period') {
        // No coletarFiltros, datas são convertidas para DD/MM/YYYY para o chip, 
        // mas aqui precisamos comparar objetos Date.
        // Importante: valores[0] e valores[1] vem do input date (YYYY-MM-DD)
        const start = parseDate(valores[0], "YYYY-MM-DD");
        const end = parseDate(valores[1], "YYYY-MM-DD");
        
        if (start && dt < start) return false;
        if (end && dt > end) return false;
      }
    } else {
      const cell = String(rawValue).toLowerCase();
      const term = String(valores[0]).toLowerCase();
      
      if (type === "exact") {
        if (cell !== term) return false;
      } else if (type === "starts") {
        if (!cell.startsWith(term)) return false;
      } else if (type === "ends") {
        if (!cell.endsWith(term)) return false;
      } else {
        // default: contains
        if (!cell.includes(term)) return false;
      }
    }
  }
  return true;
}

// ── PARSE HELPERS ─────────────────────────────────────────
function parseNumber(val, decimalSep) {
  if (val === null || val === undefined || val === "") return NaN;
  let s = String(val).replace(/[R$\s]/g, "");
  if (decimalSep === ",") {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  return parseFloat(s);
}

function parseDate(val, format) {
  if (!val) return null;
  const s = String(val).trim();
  
  // ISO format YYYY-MM-DD HH:mm:ss ou YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    // Substituir espaço por T para garantir compatibilidade ISO (YYYY-MM-DDTHH:mm:ss)
    const normalized = s.includes(" ") ? s.replace(" ", "T") : s;
    const d = new Date(normalized);
    return isNaN(d.getTime()) ? null : d;
  }

  const match = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(\s\d{2}:\d{2}(:\d{2})?)?/);
  if (!match) return null;

  let d, m, y;
  if (format === "MM/DD/YYYY") {
    m = parseInt(match[1]) - 1;
    d = parseInt(match[2]);
    y = parseInt(match[3]);
  } else {
    // Default DD/MM/YYYY
    d = parseInt(match[1]);
    m = parseInt(match[2]) - 1;
    y = parseInt(match[3]);
  }
  
  if (y < 100) y += 2000;

  // Extrair hora, minuto, segundo se existirem
  let hh = 0, mm = 0, ss = 0;
  if (match[4]) {
    const timeParts = match[4].trim().split(":");
    hh = parseInt(timeParts[0]) || 0;
    mm = parseInt(timeParts[1]) || 0;
    ss = parseInt(timeParts[2]) || 0;
  }

  const date = new Date(y, m, d, hh, mm, ss);
  return isNaN(date.getTime()) ? null : date;
}

function renderTabela(rows) {
  const tableWrapper = document.getElementById("table-wrapper");
  const resultsBar = document.getElementById("results-bar");
  const resultsCount = document.getElementById("results-count");

  if (!rows.length) {
    if (tableWrapper) tableWrapper.innerHTML = '<p class="table-placeholder">Nenhum resultado encontrado.</p>';
    if (resultsBar) resultsBar.hidden = true;
    const pag = document.getElementById("pagination");
    if (pag) pag.hidden = true;
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

  const total = totalResultados.length;
  const inicio = (paginaAtual - 1) * PAGE_SIZE + 1;
  const fim = Math.min(paginaAtual * PAGE_SIZE, total);
  if (resultsCount) {
    resultsCount.textContent = total > PAGE_SIZE
      ? `Exibindo ${inicio.toLocaleString("pt-BR")}–${fim.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} resultados`
      : `${total.toLocaleString("pt-BR")} resultado${total !== 1 ? "s" : ""} encontrado${total !== 1 ? "s" : ""}`;
  }
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
  thead.appendChild(trHead); table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const col of ultimasColunas) {
      const td = document.createElement("td");
      const val = row[col] ?? "";
      td.textContent = val; td.title = String(val);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  if (tableWrapper) { tableWrapper.innerHTML = ""; tableWrapper.appendChild(table); }
}

// ── PAGINAÇÃO ─────────────────────────────────────────────
function renderPagina() {
  const colMap = new Map();
  for (const row of totalResultados) {
    for (const k of Object.keys(row)) {
      const norm = k.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (!colMap.has(norm)) colMap.set(norm, k);
    }
  }
  ultimasColunas = [...colMap.values()];

  const totalPaginas = Math.ceil(totalResultados.length / PAGE_SIZE);
  const inicio = (paginaAtual - 1) * PAGE_SIZE;
  const fim = Math.min(inicio + PAGE_SIZE, totalResultados.length);
  renderTabela(totalResultados.slice(inicio, fim));
  renderControlesPaginacao(totalPaginas);
}

function renderControlesPaginacao(totalPaginas) {
  const el = document.getElementById("pagination");
  if (!el) return;

  if (totalPaginas <= 1) { el.hidden = true; return; }

  el.hidden = false;
  el.innerHTML = `
    <button class="btn-page" id="pg-prev" ${paginaAtual === 1 ? "disabled" : ""}>
      <i class="ph ph-caret-left"></i> Anterior
    </button>
    <span class="pagination-info">Página ${paginaAtual} de ${totalPaginas}</span>
    <button class="btn-page" id="pg-next" ${paginaAtual === totalPaginas ? "disabled" : ""}>
      Próxima <i class="ph ph-caret-right"></i>
    </button>
  `;

  document.getElementById("pg-prev")?.addEventListener("click", () => {
    if (paginaAtual > 1) {
      paginaAtual--;
      renderPagina();
      document.getElementById("table-wrapper")?.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
  document.getElementById("pg-next")?.addEventListener("click", () => {
    if (paginaAtual < totalPaginas) {
      paginaAtual++;
      renderPagina();
      document.getElementById("table-wrapper")?.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
}

// ── EXPORTAR COM RESOLUÇÃO DE CONFLITOS ──────────────────
async function abrirModalExport() {
  if (!totalResultados.length) return;

  const colSources = analisarConflitosColunas();
  const conflitos = [];
  for (const [col, sources] of colSources.entries()) {
    if (sources.size > 1) {
      conflitos.push({ coluna: col, arquivos: Array.from(sources) });
    }
  }

  if (conflitos.length > 0) {
    abrirModalResolucao(conflitos, colSources);
  } else {
    const finalCols = ultimasColunas.map(c => ({ id: c, label: c, source: null, original: c }));
    renderModalOrdenacao(finalCols);
  }
}

function analisarConflitosColunas() {
  const colSources = new Map(); // NomeColuna -> Set(NomesArquivos)
  for (const row of totalResultados) {
    const file = row._arquivo;
    for (const key of Object.keys(row)) {
      if (key === "_arquivo" || key.startsWith("_")) continue;
      if (!colSources.has(key)) colSources.set(key, new Set());
      colSources.get(key).add(file);
    }
  }
  return colSources;
}

function abrirModalResolucao(conflitos, colSources) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "resolve-modal";
  overlay.innerHTML = `
    <div class="modal" style="width: 520px">
      <div class="modal-header">
        <h2 class="modal-title"><i class="ph ph-warning-circle" style="color:var(--accent-cyan)"></i> Colunas duplicadas</h2>
        <p class="modal-sub">Identificamos colunas com o mesmo nome em arquivos diferentes. Como deseja exportar cada uma?</p>
      </div>
      <ul class="conflict-list" id="conflict-list">
        ${conflitos.map(c => `
          <li class="conflict-item">
            <div class="conflict-header">
              <i class="ph ph-columns" style="color:var(--accent-cyan)"></i>
              <span class="conflict-col-name">${escHtml(c.coluna)}</span>
            </div>
            <div class="conflict-question">Deseja unir ou manter separado?</div>
            <div class="conflict-choices">
              <label class="conflict-option">
                <input type="radio" name="choice-${escHtml(c.coluna)}" value="merge" checked>
                <span>Unir colunas</span>
              </label>
              <label class="conflict-option">
                <input type="radio" name="choice-${escHtml(c.coluna)}" value="split">
                <span>Manter separado</span>
              </label>
            </div>
            <div class="conflict-files">Presente em: ${c.arquivos.map(f => escHtml(f)).join(", ")}</div>
          </li>
        `).join("")}
      </ul>
      <div class="modal-actions" style="margin-top:10px">
        <button class="btn-modal-cancel" id="btn-resolve-cancel" style="background:transparent; border:1px solid var(--border-color); box-shadow:none; color:var(--text-secondary)"> 
          Cancelar
        </button>
        <button class="btn-primary" id="btn-resolve-confirm">
          Continuar <i class="ph ph-caret-right"></i>
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  document.getElementById("btn-resolve-cancel").onclick = () => overlay.remove();

  document.getElementById("btn-resolve-confirm").onclick = () => {
    const escolhas = {};
    conflitos.forEach(c => {
      const radio = document.querySelector(`input[name="choice-${c.coluna}"]:checked`);
      escolhas[c.coluna] = radio.value === "merge";
    });
    
    overlay.remove();
    const finalCols = gerarConfiguracaoColunas(colSources, escolhas);
    renderModalOrdenacao(finalCols);
  };
}

function gerarConfiguracaoColunas(colSources, escolhas) {
  const finalCols = [];
  finalCols.push({ id: "_arquivo", label: "Origem (Arquivo)", source: null, original: "_arquivo" });

  for (const [col, sources] of colSources.entries()) {
    const deveFundir = escolhas[col] !== false;

    if (!deveFundir && sources.size > 1) {
      for (const src of sources) {
        finalCols.push({ 
          id: `${col} (${src})`, 
          label: col, 
          source: src,
          original: col 
        });
      }
    } else {
      finalCols.push({ 
        id: col, 
        label: col, 
        source: null,
        original: col
      });
    }
  }
  return finalCols;
}

function renderModalOrdenacao(configColunas) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay"; 
  overlay.id = "export-modal";
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title"><i class="ph ph-arrows-out-line-vertical"></i> Ordenar colunas</h2>
        <p class="modal-sub">Arraste para definir a ordem final no arquivo CSV.</p>
      </div>
      <ul class="col-reorder-list" id="col-reorder-list">
        ${configColunas.map((col) => `
          <li class="col-reorder-item" draggable="true" 
              data-id="${escHtml(col.id)}" 
              data-label="${escHtml(col.label)}"
              data-source="${escHtml(col.source || "")}"
              data-original="${escHtml(col.original)}">
            <i class="ph ph-dots-six-vertical drag-handle"></i>
            <div class="col-reorder-label">
              <span>${escHtml(col.label.startsWith("_") ? col.label.slice(1) : col.label)}</span>
              ${col.source ? `<span class="col-source-badge" style="font-size:9px; color:var(--accent-cyan); opacity:0.8; font-style:italic">Origem: ${escHtml(col.source)}</span>` : ""}
            </div>
            <button type="button" class="col-delete-btn" title="Remover"><i class="ph ph-x"></i></button>
          </li>`).join("")}
      </ul>
      <div class="modal-actions">
        <button class="btn-modal-cancel" id="export-modal-cancel">Cancelar</button>
        <button class="btn-primary" id="export-modal-confirm"><i class="ph ph-download-simple"></i> Exportar</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.getElementById("export-modal-cancel").onclick = () => overlay.remove();
  document.getElementById("export-modal-confirm").onclick = () => confirmarExport();

  iniciarDragAndDrop(document.getElementById("col-reorder-list"));
  
  document.getElementById("col-reorder-list").onclick = (e) => {
    const btn = e.target.closest(".col-delete-btn");
    if (btn) btn.closest(".col-reorder-item").remove();
  };
}

async function confirmarExport() {
  const lista = document.getElementById("col-reorder-list");
  const configColunas = [...lista.querySelectorAll(".col-reorder-item")].map(li => ({
    id: li.dataset.id,
    label: li.dataset.label,
    source: li.dataset.source || null,
    original: li.dataset.original
  }));

  document.getElementById("export-modal").remove();
  toggleLoading(true, "Gerando exportação CSV...");
  await new Promise(r => setTimeout(r, 50));

  try {
    const cabecalho = configColunas.map(c => `"${c.id.replace(/"/g, '""')}"`).join(";");
    const linhasCSV = totalResultados.map(row => {
      return configColunas.map(col => {
        let valor = "";
        if (col.id === "_arquivo") valor = row._arquivo;
        else if (col.source) valor = (row._arquivo === col.source) ? (row[col.original] ?? "") : "";
        else valor = row[col.original] ?? "";
        return `"${String(valor).replace(/"/g, '""')}"`;
      }).join(";");
    });

    const csvContent = "\uFEFF" + [cabecalho, ...linhasCSV].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `exportacao_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error(error); alert("Erro ao gerar exportação.");
  } finally {
    toggleLoading(false);
  }
}

function iniciarDragAndDrop(lista) {
  if (!lista) return;

  const overlay = lista.closest(".modal-overlay");
  if (!overlay) return;

  let dragSrc = null;
  let placeholder = null;

  function moverPlaceholder(clientY) {
    // Filtrar apenas itens reais, ignorando o que está sendo arrastado e o próprio placeholder
    const items = [...lista.querySelectorAll(".col-reorder-item:not(.dragging)")];
    if (!items.length) return;

    let nearest = null;
    let nearestDist = Infinity;

    for (const item of items) {
      const rect = item.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const dist = Math.abs(clientY - mid);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = item;
      }
    }

    if (nearest) {
      const rect = nearest.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (clientY < mid) {
        nearest.before(placeholder);
      } else {
        nearest.after(placeholder);
      }
    }
  }

  lista.addEventListener("dragstart", (e) => {
    const item = e.target.closest(".col-reorder-item");
    if (!item) return;

    dragSrc = item;
    e.dataTransfer.effectAllowed = "move";
    
    placeholder = document.createElement("li");
    placeholder.className = "col-reorder-placeholder";
    placeholder.style.height = item.offsetHeight + "px";
    
    // Pequeno delay para a classe dragging não afetar a imagem de drag do navegador
    setTimeout(() => {
      item.classList.add("dragging");
      item.after(placeholder);
    }, 0);
  });

  overlay.addEventListener("dragover", (e) => {
    if (!dragSrc || !placeholder) return;
    e.preventDefault();
    moverPlaceholder(e.clientY);
  });

  overlay.addEventListener("drop", (e) => {
    if (!dragSrc || !placeholder) return;
    e.preventDefault();
    placeholder.replaceWith(dragSrc);
    dragSrc.classList.remove("dragging");
    dragSrc = null;
    placeholder = null;
  });

  overlay.addEventListener("dragend", () => {
    if (!dragSrc) return;
    placeholder?.remove();
    dragSrc.classList.remove("dragging");
    dragSrc = null;
    placeholder = null;
  });
}

function toggleLoading(active, msg = "Processando...", percent = null) {
  let loader = document.getElementById("global-loader");
  if (!loader) {
    loader = document.createElement("div");
    loader.id = "global-loader";
    loader.className = "global-loader";
    loader.innerHTML = `
      <div class="loader-content">
        <div class="progress-container" id="progress-container" style="display:none">
          <div class="progress-bar" id="progress-bar"></div>
        </div>
        <p id="loader-text"></p>
      </div>
    `;
    document.body.appendChild(loader);
  }
  
  const text = loader.querySelector("#loader-text");
  const progCont = loader.querySelector("#progress-container");
  const progBar = loader.querySelector("#progress-bar");

  if (text) text.textContent = msg;
  
  if (percent !== null) {
    const p = Math.min(100, Math.max(0, percent));
    if (progCont) progCont.style.display = "block";
    if (progBar) progBar.style.width = p + "%";
  } else {
    if (progCont) progCont.style.display = "none";
  }

  if (active) loader.classList.add("active");
  else {
    loader.classList.remove("active");
    if (progBar) progBar.style.width = "0%";
  }
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

function getIconForType(type) {
  if (type === "number") return '<i class="ph ph-hash"></i>';
  if (type === "date") return '<i class="ph ph-calendar"></i>';
  return '<i class="ph ph-text-aa"></i>';
}

function initSettingsMenu(btn, menu) {
  if (!btn || !menu) return;
  const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  const open = () => { menu.hidden = false; btn.setAttribute("aria-expanded", "true"); };
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
