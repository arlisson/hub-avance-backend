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

  const wrap = document.createElement("div");
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
  select.innerHTML = `
    <option value="contains">Contém</option>
    <option value="exact">Exato</option>
    <option value="starts">Começa com</option>
    <option value="ends">Termina com</option>
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
    const item = chk.closest(".filtro-col-item");
    const tagsBox = item?.querySelector(".filtro-col-tags");
    const type = item?.querySelector(".filtro-col-type")?.value || "contains";
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
async function buscar() {
  const globalTerm = document.getElementById("global-search")?.value.trim().toLowerCase();
  const tableWrapper = document.getElementById("table-wrapper");
  const resultsBar = document.getElementById("results-bar");

  if (tableWrapper) tableWrapper.innerHTML = '<p class="table-placeholder">Buscando…</p>';
  if (resultsBar) resultsBar.hidden = true;
  toggleLoading(true, "Filtrando dados...");
  await new Promise(r => setTimeout(r, 0)); // yield para o spinner aparecer antes do processamento

  const filtros = coletarFiltros();
  const resultados = [];

  for (const p of planilhas) {
    const dados = await carregarDadosPlanilha(p.id);
    const fp = filtros[String(p.id)] || [];
    for (const linha of dados) {
      if (globalTerm) {
        const valoresLinha = Object.values(linha).join(" ").toLowerCase();
        if (!valoresLinha.includes(globalTerm)) continue;
      }
      if (!fp.length || linhaPassaFiltros(linha, fp)) {
        resultados.push({ _arquivo: p.nome, ...linha });
      }
    }
  }

  totalResultados = resultados;
  paginaAtual = 1;
  renderPagina();
  toggleLoading(false);
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
