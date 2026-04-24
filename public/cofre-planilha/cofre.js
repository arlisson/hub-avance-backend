const LOGIN_URL = "/login/login.html";
const HUB_URL = "/paginaUnificada/index.html";
const WARN_ROWS = 50_000;
const PAGE_SIZE = 200;

/**
 * ── ARQUITETURA DE ESTADO ──────────────────────────────────
 * Centralizamos os filtros aqui para não depender do DOM.
 */
let planilhas = [];     // [{ id, nome, colunas, schema }]
let filtrosState = {};  // { [planilhaId]: { [coluna]: { type, op, values: [] } } }
let globalSearchState = "";

let totalResultados = [];
let paginaAtual = 1;
let ultimasColunas = [];

// ── BANCO DE DADOS (IndexedDB) ─────────────────────────────
const DB_NAME = "CofrePlanilhasDB";
const DB_VERSION = 3;
const STORE_META = "planilhas_meta";
const STORE_DADOS = "planilhas_dados";

function abrirDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: "id", autoIncrement: true });
      if (db.objectStoreNames.contains(STORE_DADOS)) db.deleteObjectStore(STORE_DADOS);
      const ds = db.createObjectStore(STORE_DADOS, { keyPath: "id", autoIncrement: true });
      ds.createIndex("fileId", "fileId", { unique: false });
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = () => reject("Erro ao abrir banco");
  });
}

async function carregarPlanilhasLocais() {
  const db = await abrirDB();
  return new Promise((resolve) => {
    const tx = db.transaction([STORE_META], "readonly");
    const req = tx.objectStore(STORE_META).getAll();
    req.onsuccess = () => resolve(req.result);
  });
}

async function carregarDadosPlanilha(fileId) {
  const db = await abrirDB();
  return new Promise((resolve) => {
    const tx = db.transaction([STORE_DADOS], "readonly");
    const req = tx.objectStore(STORE_DADOS).index("fileId").getAll(Number(fileId));
    req.onsuccess = () => resolve(req.result.reduce((acc, b) => acc.concat(b.dados), []));
  });
}

async function salvarSchemaLocal(id, schema) {
  const db = await abrirDB();
  const tx = db.transaction([STORE_META], "readwrite");
  const store = tx.objectStore(STORE_META);
  const req = store.get(Number(id));
  req.onsuccess = () => {
    const data = req.result;
    if (data) { data.schema = schema; store.put(data); }
  };
}

// ── CORE: FILTROS E BUSCA ──────────────────────────────────

function sincronizarEstadoFiltro(pid, coluna, data) {
  if (!filtrosState[pid]) filtrosState[pid] = {};
  if (!data || (data.values && data.values.every(v => !v))) {
    delete filtrosState[pid][coluna];
  } else {
    filtrosState[pid][coluna] = data;
  }
  atualizarChipsFiltrosAtivos();
}

function linhaPassaFiltros(linha, planilhaId, schema) {
  const filtrosPlanilha = filtrosState[String(planilhaId)];
  if (!filtrosPlanilha) return true;

  for (const [coluna, f] of Object.entries(filtrosPlanilha)) {
    const rawVal = linha[coluna];
    const s = schema[coluna] || { type: 'text' };
    if (rawVal === undefined || rawVal === null) return false;

    if (s.type === 'number') {
      const num = parseNumber(rawVal, s.decimal || ",");
      if (isNaN(num)) return false;
      if (f.op === 'range') {
        const min = parseNumber(f.values[0], s.decimal || ",");
        const max = parseNumber(f.values[1], s.decimal || ",");
        if (!isNaN(min) && num < min) return false;
        if (!isNaN(max) && num > max) return false;
      } else if (f.op === 'exact') {
        const target = parseNumber(f.values[0], s.decimal || ",");
        if (!isNaN(target) && num !== target) return false;
      }
    } else if (s.type === 'date') {
      const dt = parseDate(rawVal, s.format);
      if (!dt) return false;
      const dtStr = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, '0') + "-" + String(dt.getDate()).padStart(2, '0');
      if (f.op === 'period') {
        if (f.values[0] && dtStr < f.values[0]) return false;
        if (f.values[1] && dtStr > f.values[1]) return false;
      } else if (f.op === 'exact') {
        if (f.values[0] && dtStr !== f.values[0]) return false;
      }
    } else {
      const cell = String(rawVal).toLowerCase();
      const term = String(f.values[0]).toLowerCase();
      if (f.op === "exact") { if (cell !== term) return false; }
      else if (f.op === "starts") { if (!cell.startsWith(term)) return false; }
      else if (f.op === "ends") { if (!cell.endsWith(term)) return false; }
      else { if (!cell.includes(term)) return false; }
    }
  }
  return true;
}

async function buscar() {
  const tableWrapper = document.getElementById("table-wrapper");
  if (tableWrapper) tableWrapper.innerHTML = '<p class="table-placeholder">Buscando…</p>';
  toggleLoading(true, "Filtrando dados...");
  await new Promise(r => setTimeout(r, 50));

  const resultados = [];
  try {
    const term = globalSearchState.trim().toLowerCase();
    for (const p of planilhas) {
      const dados = await carregarDadosPlanilha(p.id);
      const schema = p.schema || {};
      for (const linha of dados) {
        if (term && !Object.values(linha).join(" ").toLowerCase().includes(term)) continue;
        if (!linhaPassaFiltros(linha, p.id, schema)) continue;
        resultados.push({ _arquivo: p.nome, ...linha });
      }
    }
    totalResultados = resultados; paginaAtual = 1; renderPagina();
  } catch (err) { console.error(err); } finally { toggleLoading(false); }
}

// ── UI: GERENCIADOR DE FILTROS ─────────────────────────────

function renderFiltrosPanel() {
  const lista = document.getElementById("filtros-lista");
  if (!lista || !planilhas.length) return;
  lista.innerHTML = "";

  // 1. Busca Global
  const gsBox = document.createElement("div");
  gsBox.className = "global-search-box";
  gsBox.innerHTML = `<div class="input-with-icon"><i class="ph ph-magnifying-glass"></i><input type="text" id="global-search" placeholder="Busca rápida..." class="global-search-input" value="${globalSearchState}"></div>`;
  lista.appendChild(gsBox);
  gsBox.querySelector("input").addEventListener("input", (e) => { globalSearchState = e.target.value; atualizarChipsFiltrosAtivos(); });

  // 2. Abas e Engrenagem
  const tabsContainer = document.createElement("div");
  tabsContainer.className = "filtro-tabs";
  const drawer = document.createElement("div");
  drawer.className = "filtro-drawer-novo";

  planilhas.forEach((p, i) => {
    const tab = document.createElement("button");
    tab.className = `filtro-tab-item${i === 0 ? " active" : ""}`;
    tab.innerHTML = `<i class="ph ph-file-csv"></i> <span>${escHtml(p.nome.length > 20 ? p.nome.slice(0, 17) + "…" : p.nome)}</span>`;
    
    const configBtn = document.createElement("button");
    configBtn.className = "filtro-tab-config";
    configBtn.innerHTML = '<i class="ph ph-gear-six"></i>';
    configBtn.title = "Configurar tipos desta planilha";
    configBtn.onclick = (e) => { e.stopPropagation(); abrirModalSchema(p); };

    const tabWrap = document.createElement("div");
    tabWrap.style.display = "flex"; tabWrap.style.alignItems = "center"; tabWrap.style.gap = "4px";
    tabWrap.appendChild(tab); tabWrap.appendChild(configBtn);

    tab.onclick = () => {
      tabsContainer.querySelectorAll(".filtro-tab-item").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      drawer.querySelectorAll(".filtro-panel-planilha").forEach(panel => panel.hidden = panel.dataset.planilhaId !== String(p.id));
    };

    tabsContainer.appendChild(tabWrap);

    // Painéis de filtros
    const panel = document.createElement("div");
    panel.className = "filtro-panel-planilha";
    panel.dataset.planilhaId = p.id;
    panel.hidden = i !== 0;

    const colEsquerda = document.createElement("div"); colEsquerda.className = "filtro-col-filtros";
    const colDireita = document.createElement("div"); colDireita.className = "filtro-col-filtros";

    p.colunas.forEach((col, idx) => {
      const card = criarCartaoColuna(p, col);
      if (idx % 2 === 0) colEsquerda.appendChild(card); else colDireita.appendChild(card);
    });

    panel.appendChild(colEsquerda); panel.appendChild(colDireita);
    drawer.appendChild(panel);
  });

  lista.appendChild(tabsContainer);
  lista.appendChild(drawer);
}

function criarCartaoColuna(planilha, coluna) {
  const schemaCol = planilha.schema?.[coluna] || { type: 'text' };
  const card = document.createElement("div");
  card.className = "filtro-card";
  const state = filtrosState[planilha.id]?.[coluna];
  if (state) card.classList.add("filtro-card--ativo");

  const header = document.createElement("div");
  header.className = "filtro-card-header";
  header.innerHTML = `
    <button class="filtro-card-type-btn">${getIconForType(schemaCol.type)} <span>${getTipoLabel(schemaCol.type)}</span></button>
    <span class="filtro-card-nome">${escHtml(coluna)}</span>
    <i class="ph ph-caret-down filtro-card-chevron"></i>
  `;

  const body = document.createElement("div");
  body.className = "filtro-card-body";
  body.hidden = true;
  preencherCardBody(body, planilha, coluna, card);

  header.onclick = () => {
    body.hidden = !body.hidden;
    card.classList.toggle("filtro-card--open", !body.hidden);
  };
  header.querySelector(".filtro-card-type-btn").onclick = (e) => {
    e.stopPropagation();
    abrirPopoverTipo(e.currentTarget, planilha, coluna, card);
  };

  card.appendChild(header); card.appendChild(body);
  return card;
}

function preencherCardBody(body, planilha, coluna, card) {
  const schemaCol = planilha.schema?.[coluna] || { type: 'text' };
  const pid = planilha.id;
  const current = filtrosState[pid]?.[coluna] || { op: schemaCol.type === 'number' ? 'range' : (schemaCol.type === 'date' ? 'period' : 'contains'), values: ["", ""] };

  if (schemaCol.type === "number") {
    body.innerHTML = `
      <div class="filtro-card-row">
        <select class="filtro-card-op-select"><option value="range" ${current.op==='range'?'selected':''}>Intervalo</option><option value="exact" ${current.op==='exact'?'selected':''}>Exato</option></select>
      </div>
      <div class="inputs-area"></div>`;
    const renderInputs = (op) => {
      const area = body.querySelector(".inputs-area");
      if (op === "range") {
        area.innerHTML = `<div class="filtro-card-row"><div class="filtro-card-field"><label>Mín</label><input type="number" step="any" class="v1" value="${current.values[0]||''}"></div><div class="filtro-card-field"><label>Máx</label><input type="number" step="any" class="v2" value="${current.values[1]||''}"></div></div>`;
      } else {
        area.innerHTML = `<div class="filtro-card-row"><div class="filtro-card-field"><label>Valor</label><input type="number" step="any" class="v1" value="${current.values[0]||''}"></div></div>`;
      }
    };
    renderInputs(current.op);
    body.querySelector("select").onchange = (e) => renderInputs(e.target.value);
  } else if (schemaCol.type === "date") {
    body.innerHTML = `
      <div class="filtro-card-row">
        <select class="filtro-card-op-select"><option value="period" ${current.op==='period'?'selected':''}>Período</option><option value="exact" ${current.op==='exact'?'selected':''}>Dia Fixo</option></select>
      </div>
      <div class="inputs-area"></div>`;
    const renderInputs = (op) => {
      const area = body.querySelector(".inputs-area");
      if (op === "period") {
        area.innerHTML = `<div class="filtro-card-row"><div class="filtro-card-field"><label>De</label><input type="date" class="v1" value="${current.values[0]||''}"></div><div class="filtro-card-field"><label>Até</label><input type="date" class="v2" value="${current.values[1]||''}"></div></div>`;
      } else {
        area.innerHTML = `<div class="filtro-card-row"><div class="filtro-card-field"><label>Data</label><input type="date" class="v1" value="${current.values[0]||''}"></div></div>`;
      }
    };
    renderInputs(current.op);
    body.querySelector("select").onchange = (e) => renderInputs(e.target.value);
  } else {
    body.innerHTML = `
      <div class="filtro-card-row filtro-card-row--text">
        <select class="filtro-card-op-select"><option value="contains" ${current.op==='contains'?'selected':''}>Contém</option><option value="exact" ${current.op==='exact'?'selected':''}>Exato</option><option value="starts" ${current.op==='starts'?'selected':''}>Começa</option></select>
        <input type="text" class="v1" placeholder="Digite..." value="${current.values[0]||''}" style="flex:1; padding:7px; border:1px solid var(--border-color); border-radius:8px; background:rgba(0,0,0,0.2); color:white; outline:none">
      </div>`;
  }

  const limparBtn = document.createElement("button");
  limparBtn.className = "filtro-card-limpar"; limparBtn.innerHTML = '<i class="ph ph-x"></i> Limpar';
  limparBtn.onclick = () => { body.querySelectorAll("input").forEach(i => i.value = ""); sincronizarEstadoFiltro(pid, coluna, null); card.classList.remove("filtro-card--ativo"); };
  body.appendChild(limparBtn);

  body.oninput = () => {
    const op = body.querySelector("select").value;
    const v1 = body.querySelector(".v1")?.value || "";
    const v2 = body.querySelector(".v2")?.value || "";
    const ativo = !!(v1 || v2);
    card.classList.toggle("filtro-card--ativo", ativo);
    sincronizarEstadoFiltro(pid, coluna, ativo ? { op, values: [v1, v2] } : null);
  };
}

// ── UI: GERENCIADOR DE SCHEMA (EM LOTE) ─────────────────────

function abrirModalSchema(planilha) {
  const overlay = document.getElementById("schema-modal-overlay");
  const tbody = document.getElementById("schema-table-body");
  tbody.innerHTML = "";

  planilha.colunas.forEach(col => {
    const s = planilha.schema?.[col] || { type: 'text' };
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><div style="font-weight:600; color:var(--text-primary)">${escHtml(col)}</div></td>
      <td>
        <select class="schema-type-select" data-col="${escHtml(col)}">
          <option value="text" ${s.type==='text'?'selected':''}>Texto (ABC)</option>
          <option value="number" ${s.type==='number'?'selected':''}>Número (123)</option>
          <option value="date" ${s.type==='date'?'selected':''}>Data (DD/MM)</option>
        </select>
      </td>
      <td class="schema-config-cell">
        ${s.type === 'number' ? `Sep. Decimal: <input type="text" class="s-decimal" value="${s.decimal||','}" style="width:30px; text-align:center">` : ''}
        ${s.type === 'date' ? `Formato: <select class="s-format"><option value="DD/MM/YYYY" ${s.format==='DD/MM/YYYY'?'selected':''}>DD/MM/YYYY</option><option value="MM/DD/YYYY" ${s.format==='MM/DD/YYYY'?'selected':''}>MM/DD/YYYY</option></select>` : ''}
      </td>
    `;
    
    tr.querySelector(".schema-type-select").onchange = (e) => {
      const type = e.target.value;
      const configCell = tr.querySelector(".schema-config-cell");
      if (type === 'number') configCell.innerHTML = `Sep. Decimal: <input type="text" class="s-decimal" value="," style="width:30px; text-align:center">`;
      else if (type === 'date') configCell.innerHTML = `Formato: <select class="s-format"><option value="DD/MM/YYYY">DD/MM/YYYY</option><option value="MM/DD/YYYY">MM/DD/YYYY</option></select>`;
      else configCell.innerHTML = "";
    };
    tbody.appendChild(tr);
  });

  overlay.hidden = false;
  document.getElementById("btn-fechar-schema").onclick = () => overlay.hidden = true;
  document.getElementById("btn-salvar-schema").onclick = async () => {
    const novoSchema = {};
    tbody.querySelectorAll("tr").forEach(tr => {
      const col = tr.querySelector(".schema-type-select").dataset.col;
      const type = tr.querySelector(".schema-type-select").value;
      const config = { type };
      if (type === 'number') config.decimal = tr.querySelector(".s-decimal").value || ",";
      if (type === 'date') config.format = tr.querySelector(".s-format").value;
      novoSchema[col] = config;
    });
    planilha.schema = novoSchema;
    await salvarSchemaLocal(planilha.id, novoSchema);
    overlay.hidden = true;
    renderFiltrosPanel();
    buscar();
  };
}

// ── HELPERS E INICIALIZAÇÃO ───────────────────────────────

function atualizarChipsFiltrosAtivos() {
  const bar = document.getElementById("filtros-chips-bar");
  if (!bar) return;
  bar.innerHTML = "";
  const chips = [];

  if (globalSearchState) {
    chips.push({ label: `Busca: "${globalSearchState}"`, onRemove: () => { globalSearchState = ""; renderFiltrosPanel(); buscar(); } });
  }

  for (const [pid, cols] of Object.entries(filtrosState)) {
    const p = planilhas.find(x => String(x.id) === pid);
    for (const [col, f] of Object.entries(cols)) {
      let resumo = `${col}: `;
      if (f.op === 'range') resumo += `${f.values[0]||'∞'} a ${f.values[1]||'∞'}`;
      else if (f.op === 'period') resumo += `${formatDateBR(f.values[0])||'∞'} a ${formatDateBR(f.values[1])||'∞'}`;
      else if (f.op === 'exact' && p?.schema?.[col]?.type === 'date') resumo += `= ${formatDateBR(f.values[0])}`;
      else resumo += `${f.op === 'exact' ? '=' : f.op} "${f.values[0]}"`;

      chips.push({ label: resumo, onRemove: () => { delete filtrosState[pid][col]; renderFiltrosPanel(); buscar(); } });
    }
  }

  if (!chips.length) { bar.innerHTML = '<span class="filtros-chips-vazio">Nenhum filtro ativo</span>'; return; }
  chips.forEach(c => {
    const span = document.createElement("span"); span.className = "filtro-chip";
    span.innerHTML = `<span class="filtro-chip-label">${escHtml(c.label)}</span><button class="filtro-chip-remove"><i class="ph ph-x"></i></button>`;
    span.querySelector("button").onclick = c.onRemove;
    bar.appendChild(span);
  });
}

function parseNumber(val, sep) {
  if (!val && val !== 0) return NaN;
  let s = String(val).replace(/[R$\s]/g, "");
  if (sep === ",") s = s.replace(/\./g, "").replace(",", "."); else s = s.replace(/,/g, "");
  return parseFloat(s);
}

function parseDate(val, format) {
  if (!val) return null;
  const s = String(val).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(\s\d{2}:\d{2})?/);
  if (!m) return null;
  let d, mm, y;
  if (format === "MM/DD/YYYY") { mm = parseInt(m[1]) - 1; d = parseInt(m[2]); y = parseInt(m[3]); }
  else { d = parseInt(m[1]); mm = parseInt(m[2]) - 1; y = parseInt(m[3]); }
  if (y < 100) y += 2000;
  return new Date(y, mm, d, m[4]?parseInt(m[4].trim().split(":")[0]):0, m[4]?parseInt(m[4].trim().split(":")[1]):0);
}

function escHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function formatDateBR(iso) { if (!iso) return ""; const b = iso.split("-"); return b.length===3 ? `${b[2]}/${b[1]}/${b[0]}` : iso; }

function toggleLoading(a, m = "Processando...", p = null) {
  let l = document.getElementById("global-loader");
  if (!l) {
    l = document.createElement("div"); l.id = "global-loader"; l.className = "global-loader";
    l.innerHTML = `<div class="loader-content"><div class="progress-container" id="progress-container" style="display:none"><div class="progress-bar" id="progress-bar"></div></div><p id="loader-text"></p></div>`;
    document.body.appendChild(l);
  }
  l.querySelector("#loader-text").textContent = m;
  const pb = l.querySelector("#progress-bar"), pc = l.querySelector("#progress-container");
  if (p !== null) { pc.style.display = "block"; pb.style.width = p + "%"; } else pc.style.display = "none";
  a ? l.classList.add("active") : l.classList.remove("active");
}

document.addEventListener("DOMContentLoaded", async () => {
  initTheme(document.getElementById("theme-toggle"));
  initSettingsMenu(document.getElementById("settings-btn"), document.getElementById("settings-menu"));
  initMobileSidebar(document.getElementById("mobile-menu-btn"));
  
  planilhas = await carregarPlanilhasLocais();
  renderLista(); renderFiltrosPanel();

  document.getElementById("upload-area")?.onclick = () => document.getElementById("file-input").click();
  document.getElementById("file-input")?.onchange = (e) => handleFiles(e.target.files);
  document.getElementById("btn-buscar")?.onclick = buscar;
  document.getElementById("btn-limpar-tudo")?.onclick = limparTudo;
  document.getElementById("btn-configurar-filtros")?.onclick = () => { document.getElementById("filtros-modal-overlay").hidden = false; };
  document.getElementById("btn-fechar-filtros")?.onclick = () => { document.getElementById("filtros-modal-overlay").hidden = true; };
  document.getElementById("btn-aplicar-filtros")?.onclick = () => { document.getElementById("filtros-modal-overlay").hidden = true; buscar(); };
});

async function handleFiles(files) {
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith(".csv")) continue;
    toggleLoading(true, `Lendo ${f.name}...`);
    const res = await parsearArquivo(f);
    planilhas.push({ id: res.id, nome: f.name, colunas: res.colunas, schema: {} });
  }
  toggleLoading(false); renderLista(); renderFiltrosPanel();
}

function parsearArquivo(file) {
  return new Promise((resolve) => {
    const w = new Worker('./cofre-worker.js?v=' + Date.now());
    w.postMessage({ file, nome: file.name });
    w.onmessage = ({ data }) => { if (data.ok) resolve(data); w.terminate(); };
  });
}

async function limparTudo() {
  if (!confirm("Apagar tudo?")) return;
  await (await abrirDB()).transaction([STORE_META, STORE_DADOS], "readwrite").objectStore(STORE_META).clear();
  planilhas = []; filtrosState = {}; totalResultados = []; renderLista(); renderFiltrosPanel();
}

function renderLista() {
  const l = document.getElementById("file-list"); if (!l) return;
  l.innerHTML = planilhas.length ? "" : '<li class="file-list-empty">Vazio</li>';
  planilhas.forEach(p => {
    const li = document.createElement("li"); li.className = "file-item";
    li.innerHTML = `<i class="ph ph-file-csv" style="color:var(--accent-cyan)"></i><span class="file-item-name">${escHtml(p.nome)}</span><button class="del"><i class="ph ph-trash"></i></button>`;
    li.querySelector(".del").onclick = async () => {
      const db = await abrirDB();
      db.transaction([STORE_META, STORE_DADOS], "readwrite").objectStore(STORE_META).delete(p.id);
      planilhas = planilhas.filter(x => x.id !== p.id); renderLista(); renderFiltrosPanel();
    };
    l.appendChild(li);
  });
}

function renderPagina() {
  const rows = totalResultados.slice((paginaAtual-1)*PAGE_SIZE, paginaAtual*PAGE_SIZE);
  const wrap = document.getElementById("table-wrapper");
  if (!rows.length) { wrap.innerHTML = '<p class="table-placeholder">Nenhum resultado.</p>'; return; }
  
  const colMap = new Map();
  totalResultados.forEach(row => Object.keys(row).forEach(k => { if (!k.startsWith("_")) colMap.set(k.toLowerCase(), k); }));
  ultimasColunas = ["_arquivo", ...colMap.values()];

  let h = `<table class="results-table"><thead><tr>${ultimasColunas.map(c => `<th>${escHtml(c==='_arquivo'?'Arquivo':c)}</th>`).join("")}</tr></thead><tbody>`;
  rows.forEach(r => { h += `<tr>${ultimasColunas.map(c => `<td>${escHtml(r[c]||"")}</td>`).join("")}</tr>`; });
  wrap.innerHTML = h + "</tbody></table>";
  
  document.getElementById("results-bar").hidden = false;
  document.getElementById("results-count").textContent = `${totalResultados.length} resultados`;
  renderPagination();
}

function renderPagination() {
  const tot = Math.ceil(totalResultados.length / PAGE_SIZE);
  const p = document.getElementById("pagination");
  p.hidden = tot <= 1;
  p.innerHTML = `<button ${paginaAtual===1?'disabled':''} id="prev">Anterior</button><span>${paginaAtual}/${tot}</span><button ${paginaAtual===tot?'disabled':''} id="next">Próximo</button>`;
  p.querySelector("#prev").onclick = () => { paginaAtual--; renderPagina(); };
  p.querySelector("#next").onclick = () => { paginaAtual++; renderPagina(); };
}

function initTheme(b) { const isL = localStorage.getItem("theme")==="light"; document.body.classList.toggle("light-mode", isL); b?.onclick = () => { const L = document.body.classList.toggle("light-mode"); localStorage.setItem("theme", L?"light":"dark"); }; }
function initSettingsMenu(b, m) { b?.onclick = (e) => { e.stopPropagation(); m.hidden = !m.hidden; }; document.onclick = () => m && (m.hidden = true); }
function initMobileSidebar(b) { b?.onclick = () => document.body.classList.toggle("sidebar-open"); }
function abrirPopoverTipo(btn, p, col, card) { /* Reuso simplificado para o exemplo, integra com o schema em lote */ abrirModalSchema(p); }
async function abrirModalExport() { /* lógica de export aqui */ }
