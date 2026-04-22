const LOGIN_URL    = "/login/login.html";
const HUB_URL      = "/paginaUnificada/index.html";
const WARN_ROWS    = 50_000; // 50k linhas — avisa sobre filtros lentos
const PAGE_SIZE    = 200;               // linhas por página na tabela de resultados

// ── ESTADO LOCAL ──────────────────────────────────────────
let planilhas       = []; // [{ id, nome, colunas }] — dados ficam só no IndexedDB
let nextId          = 1;
let ultimasColunas  = [];
let totalResultados = [];
let paginaAtual     = 1;

// ── BANCO DE DADOS LOCAL (IndexedDB) ──────────────────────
const DB_NAME    = "CofrePlanilhasDB";
const DB_VERSION = 2;
const STORE_META  = "planilhas_meta";
const STORE_DADOS = "planilhas_dados";

function abrirDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    const timeout = setTimeout(() => reject("Timeout ao abrir banco de dados"), 5000);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      // Remove store legado do v1 (dados eram armazenados juntos com metadados)
      if (db.objectStoreNames.contains("planilhas")) {
        db.deleteObjectStore("planilhas");
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_DADOS)) {
        db.createObjectStore(STORE_DADOS, { keyPath: "id" });
      }
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
      const tx        = db.transaction([STORE_META, STORE_DADOS], "readwrite");
      const metaStore  = tx.objectStore(STORE_META);
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
      const tx    = db.transaction([STORE_META], "readonly");
      const req   = tx.objectStore(STORE_META).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject("Erro ao carregar planilhas");
    });
  } catch (err) { console.error(err); return []; }
}

async function removerPlanilhaLocal(id) {
  try {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META, STORE_DADOS], "readwrite");
      tx.objectStore(STORE_META).delete(Number(id));
      tx.objectStore(STORE_DADOS).delete(Number(id));
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject("Erro ao remover planilha");
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
      tx.onerror    = () => reject();
    });
  } catch (err) { console.error(err); }
}

async function carregarDadosPlanilha(id) {
  try {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction([STORE_DADOS], "readonly");
      const req = tx.objectStore(STORE_DADOS).get(Number(id));
      req.onsuccess = () => resolve(req.result?.dados ?? []);
      req.onerror   = () => reject("Erro ao carregar dados");
    });
  } catch (err) { console.error(err); return []; }
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
    const worker = new Worker('./cofre-worker.js');
    
    // Timeout longo de 5 minutos para arquivos CSV gigantes
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("Tempo limite excedido. O arquivo é grande demais para ser processado de uma vez."));
    }, 300_000); 

    // Envia o objeto File direto para o worker (muito mais eficiente em memória)
    worker.postMessage({ file, nome: file.name });
    
    worker.onmessage = ({ data }) => { 
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
async function buscar() {
  const globalTerm   = document.getElementById("global-search")?.value.trim().toLowerCase();
  const tableWrapper = document.getElementById("table-wrapper");
  const resultsBar   = document.getElementById("results-bar");

  if (tableWrapper) tableWrapper.innerHTML = '<p class="table-placeholder">Buscando…</p>';
  if (resultsBar) resultsBar.hidden = true;
  toggleLoading(true, "Filtrando dados...");
  await new Promise(r => setTimeout(r, 0)); // yield para o spinner aparecer antes do processamento

  const filtros    = coletarFiltros();
  const resultados = [];

  for (const p of planilhas) {
    const dados = await carregarDadosPlanilha(p.id);
    const fp    = filtros[String(p.id)] || [];
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
  const resultsBar   = document.getElementById("results-bar");
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

  const total  = totalResultados.length;
  const inicio = (paginaAtual - 1) * PAGE_SIZE + 1;
  const fim    = Math.min(paginaAtual * PAGE_SIZE, total);
  if (resultsCount) {
    resultsCount.textContent = total > PAGE_SIZE
      ? `Exibindo ${inicio.toLocaleString("pt-BR")}–${fim.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} resultados`
      : `${total.toLocaleString("pt-BR")} resultado${total !== 1 ? "s" : ""} encontrado${total !== 1 ? "s" : ""}`;
  }
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
  const fim    = Math.min(inicio + PAGE_SIZE, totalResultados.length);
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

async function confirmarExport() {
  const lista = document.getElementById("col-reorder-list");
  const colunasOrdenadas = [...lista.querySelectorAll(".col-reorder-item")].map(li => li.dataset.col);
  fecharModalExport();

  toggleLoading(true, "Gerando exportação...");
  await new Promise(r => setTimeout(r, 0));

  const filtros    = coletarFiltros();
  const resultados = [];
  for (const p of planilhas) {
    const dados = await carregarDadosPlanilha(p.id);
    const fp    = filtros[String(p.id)] || [];
    for (const linha of dados) {
      if (!fp.length || linhaPassaFiltros(linha, fp))
        resultados.push({ _arquivo: p.nome, ...linha });
    }
  }
  toggleLoading(false);
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
