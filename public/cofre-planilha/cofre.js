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

// ── HELPERS DE TIPO ───────────────────────────────────────
function getIconForType(type) {
  if (type === "number") return '<i class="ph ph-hash"></i>';
  if (type === "date") return '<i class="ph ph-calendar"></i>';
  return '<i class="ph ph-text-aa"></i>';
}
function getTipoLabel(type) {
  if (type === "number") return "Número";
  if (type === "date") return "Data";
  return "Texto";
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
      const terms = (Array.isArray(f.values) ? f.values : [f.values[0]])
        .map(v => String(v ?? "").toLowerCase())
        .filter(Boolean);
      if (terms.length) {
        const casa = terms.some(term => {
          if (f.op === "exact") return cell === term;
          if (f.op === "starts") return cell.startsWith(term);
          if (f.op === "ends") return cell.endsWith(term);
          return cell.includes(term);
        });
        if (!casa) return false;
      }
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
    tabWrap.className = "filtro-tab-wrap";
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
        <select class="filtro-card-op-select"><option value="range" ${current.op === 'range' ? 'selected' : ''}>Intervalo</option><option value="exact" ${current.op === 'exact' ? 'selected' : ''}>Exato</option></select>
      </div>
      <div class="inputs-area"></div>`;
    const renderInputs = (op) => {
      const area = body.querySelector(".inputs-area");
      if (op === "range") {
        area.innerHTML = `<div class="filtro-card-row"><div class="filtro-card-field"><label class="filtro-card-field-label">Mín</label><input type="number" step="any" class="filtro-card-input v1" value="${current.values[0] || ''}"></div><div class="filtro-card-field"><label class="filtro-card-field-label">Máx</label><input type="number" step="any" class="filtro-card-input v2" value="${current.values[1] || ''}"></div></div>`;
      } else {
        area.innerHTML = `<div class="filtro-card-row"><div class="filtro-card-field"><label class="filtro-card-field-label">Valor</label><input type="number" step="any" class="filtro-card-input v1" value="${current.values[0] || ''}"></div></div>`;
      }
    };
    renderInputs(current.op);
    body.querySelector("select").onchange = (e) => renderInputs(e.target.value);
  } else if (schemaCol.type === "date") {
    body.innerHTML = `
      <div class="filtro-card-row">
        <select class="filtro-card-op-select"><option value="period" ${current.op === 'period' ? 'selected' : ''}>Período</option><option value="exact" ${current.op === 'exact' ? 'selected' : ''}>Dia Fixo</option></select>
      </div>
      <div class="inputs-area"></div>`;
    const renderInputs = (op) => {
      const area = body.querySelector(".inputs-area");
      if (op === "period") {
        area.innerHTML = `<div class="filtro-card-row"><div class="filtro-card-field"><label class="filtro-card-field-label">De</label><input type="date" class="filtro-card-input v1" value="${current.values[0] || ''}"></div><div class="filtro-card-field"><label class="filtro-card-field-label">Até</label><input type="date" class="filtro-card-input v2" value="${current.values[1] || ''}"></div></div>`;
      } else {
        area.innerHTML = `<div class="filtro-card-row"><div class="filtro-card-field"><label class="filtro-card-field-label">Data</label><input type="date" class="filtro-card-input v1" value="${current.values[0] || ''}"></div></div>`;
      }
    };
    renderInputs(current.op);
    body.querySelector("select").onchange = (e) => renderInputs(e.target.value);
  } else {
    body.innerHTML = `
      <div class="filtro-card-row filtro-card-row--text">
        <select class="filtro-card-op-select"><option value="contains" ${current.op === 'contains' ? 'selected' : ''}>Contém</option><option value="exact" ${current.op === 'exact' ? 'selected' : ''}>Exato</option><option value="starts" ${current.op === 'starts' ? 'selected' : ''}>Começa</option><option value="ends" ${current.op === 'ends' ? 'selected' : ''}>Termina</option></select>
      </div>
      <div class="filtro-card-tags"></div>
      <span class="filtro-card-tags-hint">Tecle Enter para adicionar várias palavras (qualquer uma corresponde)</span>`;

    const tagsBox = body.querySelector(".filtro-card-tags");
    const tagInput = document.createElement("input");
    tagInput.type = "text";
    tagInput.className = "filtro-card-tag-input";
    tagInput.placeholder = "Digite e tecle Enter...";
    tagsBox.appendChild(tagInput);

    const syncText = () => {
      const op = body.querySelector(".filtro-card-op-select").value;
      const terms = [...tagsBox.querySelectorAll(".filtro-card-tag-text")].map(s => s.textContent);
      const typing = tagInput.value.trim();
      if (typing) terms.push(typing);
      const ativo = terms.length > 0;
      card.classList.toggle("filtro-card--ativo", ativo);
      sincronizarEstadoFiltro(pid, coluna, ativo ? { op, values: terms } : null);
    };

    const addTag = (value) => {
      const tag = document.createElement("span");
      tag.className = "filtro-card-tag";
      const txt = document.createElement("span");
      txt.className = "filtro-card-tag-text";
      txt.textContent = value;
      const rem = document.createElement("button");
      rem.type = "button"; rem.className = "filtro-card-tag-remove";
      rem.innerHTML = '<i class="ph ph-x"></i>';
      rem.onclick = () => { tag.remove(); syncText(); };
      tag.appendChild(txt); tag.appendChild(rem);
      tagsBox.insertBefore(tag, tagInput);
    };

    // Restaura valores já existentes no estado
    (Array.isArray(current.values) ? current.values : [current.values[0]])
      .filter(v => v !== undefined && v !== null && v !== "")
      .forEach(v => addTag(String(v)));

    tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        const val = tagInput.value.trim().replace(/,$/, "");
        if (val) { addTag(val); tagInput.value = ""; }
        syncText();
      } else if (e.key === "Backspace" && !tagInput.value) {
        tagsBox.querySelector(".filtro-card-tag:last-of-type")?.remove();
        syncText();
      }
    });
    tagInput.addEventListener("input", syncText);
    tagInput.addEventListener("blur", () => {
      const val = tagInput.value.trim();
      if (val) { addTag(val); tagInput.value = ""; syncText(); }
    });
    body.querySelector(".filtro-card-op-select").addEventListener("change", syncText);
  }

  const limparBtn = document.createElement("button");
  limparBtn.className = "filtro-card-limpar"; limparBtn.innerHTML = '<i class="ph ph-x"></i> Limpar';
  limparBtn.onclick = () => { body.querySelectorAll("input").forEach(i => i.value = ""); body.querySelectorAll(".filtro-card-tag").forEach(t => t.remove()); sincronizarEstadoFiltro(pid, coluna, null); card.classList.remove("filtro-card--ativo"); };
  body.appendChild(limparBtn);

  // Apenas número/data usam o handler genérico; texto sincroniza pelas próprias tags.
  if (schemaCol.type !== "text") {
    body.oninput = () => {
      const op = body.querySelector("select").value;
      const v1 = body.querySelector(".v1")?.value || "";
      const v2 = body.querySelector(".v2")?.value || "";
      const ativo = !!(v1 || v2);
      card.classList.toggle("filtro-card--ativo", ativo);
      sincronizarEstadoFiltro(pid, coluna, ativo ? { op, values: [v1, v2] } : null);
    };
  }
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
      <td><div class="schema-col-name">${escHtml(col)}</div></td>
      <td>
        <select class="schema-type-select" data-col="${escHtml(col)}">
          <option value="text" ${s.type === 'text' ? 'selected' : ''}>Texto (ABC)</option>
          <option value="number" ${s.type === 'number' ? 'selected' : ''}>Número (123)</option>
          <option value="date" ${s.type === 'date' ? 'selected' : ''}>Data (DD/MM)</option>
        </select>
      </td>
      <td class="schema-config-cell">
        ${s.type === 'number' ? `<span class="schema-config-label">Sep. Decimal: <input type="text" class="s-decimal" value="${s.decimal || ','}"></span>` : ''}
        ${s.type === 'date' ? `<span class="schema-config-label">Formato: <select class="s-format"><option value="DD/MM/YYYY" ${s.format === 'DD/MM/YYYY' ? 'selected' : ''}>DD/MM/YYYY</option><option value="MM/DD/YYYY" ${s.format === 'MM/DD/YYYY' ? 'selected' : ''}>MM/DD/YYYY</option></select></span>` : ''}
      </td>
    `;

    tr.querySelector(".schema-type-select").onchange = (e) => {
      const type = e.target.value;
      const configCell = tr.querySelector(".schema-config-cell");
      if (type === 'number') configCell.innerHTML = `<span class="schema-config-label">Sep. Decimal: <input type="text" class="s-decimal" value=","></span>`;
      else if (type === 'date') configCell.innerHTML = `<span class="schema-config-label">Formato: <select class="s-format"><option value="DD/MM/YYYY">DD/MM/YYYY</option><option value="MM/DD/YYYY">MM/DD/YYYY</option></select></span>`;
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
      if (f.op === 'range') resumo += `${f.values[0] || '∞'} a ${f.values[1] || '∞'}`;
      else if (f.op === 'period') resumo += `${formatDateBR(f.values[0]) || '∞'} a ${formatDateBR(f.values[1]) || '∞'}`;
      else if (f.op === 'exact' && p?.schema?.[col]?.type === 'date') resumo += `= ${formatDateBR(f.values[0])}`;
      else {
        const vals = (Array.isArray(f.values) ? f.values : [f.values[0]]).filter(v => v !== undefined && v !== null && v !== "");
        const joined = vals.map(v => `"${v}"`).join(" ou ");
        resumo += `${f.op === 'exact' ? '=' : f.op} ${joined || `"${f.values[0] ?? ''}"`}`;
      }

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
  return new Date(y, mm, d, m[4] ? parseInt(m[4].trim().split(":")[0]) : 0, m[4] ? parseInt(m[4].trim().split(":")[1]) : 0);
}

function escHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function formatDateBR(iso) { if (!iso) return ""; const b = iso.split("-"); return b.length === 3 ? `${b[2]}/${b[1]}/${b[0]}` : iso; }

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

  // Autenticação e exibição do email
  try {
    const meResp = await apiFetch("/api/profile");
    if (!meResp?.ok || !meResp?.user) throw new Error("Não autenticado");
    const emailEl = document.getElementById("user-email");
    if (emailEl) { emailEl.textContent = meResp.user.email || ""; emailEl.title = meResp.user.email || ""; }
  } catch (err) {
    if (err?.status === 401) { window.location.href = LOGIN_URL; return; }
  }

  document.getElementById("menu-logout")?.addEventListener("click", async () => {
    try { await apiFetch("/api/logout", { method: "POST" }); } catch { }
    window.location.href = LOGIN_URL;
  });
  document.getElementById("menu-back-hub")?.addEventListener("click", () => { window.location.href = HUB_URL; });

  planilhas = await carregarPlanilhasLocais();
  renderLista(); renderFiltrosPanel();

  document.getElementById("file-input")?.addEventListener("change", (e) => handleFiles(e.target.files));
  document.getElementById("btn-buscar")?.addEventListener("click", buscar);
  document.getElementById("btn-limpar-tudo")?.addEventListener("click", limparTudo);
  document.getElementById("btn-configurar-filtros")?.addEventListener("click", () => { document.getElementById("filtros-modal-overlay").hidden = false; });
  document.getElementById("btn-fechar-filtros")?.addEventListener("click", () => { document.getElementById("filtros-modal-overlay").hidden = true; });
  document.getElementById("btn-aplicar-filtros")?.addEventListener("click", () => { document.getElementById("filtros-modal-overlay").hidden = true; buscar(); });
  document.getElementById("btn-export")?.addEventListener("click", abrirModalExport);
});

async function handleFiles(files) {
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith(".csv")) continue;
    toggleLoading(true, `Lendo ${f.name}...`);
    try {
      const res = await parsearArquivo(f);
      planilhas.push({ id: res.id, nome: f.name, colunas: res.colunas, schema: res.schema || {} });
    } catch (err) {
      alert(`Erro ao processar "${f.name}": ${err.message || err}`);
    }
  }
  toggleLoading(false); renderLista(); renderFiltrosPanel();
}

function parsearArquivo(file) {
  return new Promise((resolve, reject) => {
    const w = new Worker('./cofre-worker.js?v=2');
    w.postMessage({ file, nome: file.name });
    w.onmessage = ({ data }) => {
      if (data.type === "progress") {
        toggleLoading(true, data.msg || `Lendo ${file.name}...`, data.percent);
        return;
      }
      w.terminate();
      if (data.ok) resolve(data); else reject(new Error(data.error || "Falha no worker"));
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || "Erro no worker")); };
  });
}

async function apiFetch(url, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const resp = await fetch(url, { method, credentials: "include", headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { ok: false, error: text || "Resposta inválida." }; }
  if (!resp.ok) { const err = new Error(data?.error || "Erro na requisição."); err.status = resp.status; err.response = data; throw err; }
  return data;
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
    li.innerHTML = `<i class="ph ph-file-csv file-item-icon"></i><span class="file-item-name">${escHtml(p.nome)}</span><button class="del"><i class="ph ph-trash"></i></button>`;
    li.querySelector(".del").onclick = async () => {
      const db = await abrirDB();
      db.transaction([STORE_META, STORE_DADOS], "readwrite").objectStore(STORE_META).delete(p.id);
      planilhas = planilhas.filter(x => x.id !== p.id); renderLista(); renderFiltrosPanel();
    };
    l.appendChild(li);
  });
}

function renderPagina() {
  const rows = totalResultados.slice((paginaAtual - 1) * PAGE_SIZE, paginaAtual * PAGE_SIZE);
  const wrap = document.getElementById("table-wrapper");
  if (!rows.length) { wrap.innerHTML = '<p class="table-placeholder">Nenhum resultado.</p>'; return; }

  const colMap = new Map();
  totalResultados.forEach(row => Object.keys(row).forEach(k => { if (!k.startsWith("_")) colMap.set(k.toLowerCase(), k); }));
  ultimasColunas = ["_arquivo", ...colMap.values()];

  let h = `<table class="results-table"><thead><tr>${ultimasColunas.map(c => `<th>${escHtml(c === '_arquivo' ? 'Arquivo' : c)}</th>`).join("")}</tr></thead><tbody>`;
  rows.forEach(r => { h += `<tr>${ultimasColunas.map(c => `<td>${escHtml(r[c] || "")}</td>`).join("")}</tr>`; });
  wrap.innerHTML = h + "</tbody></table>";

  document.getElementById("results-bar").hidden = false;
  document.getElementById("results-count").textContent = `${totalResultados.length} resultados`;
  renderPagination();
}

function renderPagination() {
  const tot = Math.ceil(totalResultados.length / PAGE_SIZE);
  const p = document.getElementById("pagination");
  p.hidden = tot <= 1;
  p.innerHTML = `<button class="btn-page" ${paginaAtual === 1 ? 'disabled' : ''} id="prev"><i class="ph ph-caret-left"></i> Anterior</button><span class="pagination-info">${paginaAtual} / ${tot}</span><button class="btn-page" ${paginaAtual === tot ? 'disabled' : ''} id="next">Próximo <i class="ph ph-caret-right"></i></button>`;
  p.querySelector("#prev").onclick = () => { paginaAtual--; renderPagina(); };
  p.querySelector("#next").onclick = () => { paginaAtual++; renderPagina(); };
}

function initTheme(b) { const isL = localStorage.getItem("theme") === "light"; document.body.classList.toggle("light-mode", isL); b?.addEventListener("click", () => { const L = document.body.classList.toggle("light-mode"); localStorage.setItem("theme", L ? "light" : "dark"); }); }
function initSettingsMenu(b, m) { b?.addEventListener("click", (e) => { e.stopPropagation(); m.hidden = !m.hidden; }); document.addEventListener("click", () => m && (m.hidden = true)); }
function initMobileSidebar(b) { b?.addEventListener("click", () => document.body.classList.toggle("sidebar-open")); }
function abrirPopoverTipo(btn, p, col, card) { /* Reuso simplificado para o exemplo, integra com o schema em lote */ abrirModalSchema(p); }
function abrirModalExport() {
  if (!ultimasColunas.length) {
    alert("Nenhum resultado para exportar. Faça uma busca primeiro.");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay"; overlay.id = "export-modal";
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title"><i class="ph ph-arrows-out-line-vertical"></i> Configurar exportação</h2>
        <p class="modal-sub">Arraste (ou use as setas) para ordenar e remova as colunas que não quer. Marque duas ou mais para fundir em uma só.</p>
      </div>
      <div class="export-filename-field">
        <label for="export-filename">Nome do arquivo</label>
        <div class="export-filename-input">
          <input type="text" id="export-filename" value="resultado_cofre" spellcheck="false">
          <span class="export-filename-ext">.csv</span>
        </div>
      </div>
      <div class="export-fuse-bar">
        <button type="button" class="export-fuse-btn" id="btn-fundir" disabled><i class="ph ph-arrows-merge"></i> Fundir selecionadas (0)</button>
        <span class="export-fuse-hint">Marque colunas equivalentes (ex.: Telefone e Celular) para uni-las.</span>
      </div>
      <ul class="col-reorder-list" id="col-reorder-list"></ul>
      <div class="modal-actions">
        <button class="btn-modal-cancel" id="export-modal-cancel">Cancelar</button>
        <button class="btn-primary" id="export-modal-confirm"><i class="ph ph-download-simple"></i> Exportar</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const reorderList = document.getElementById("col-reorder-list");
  ultimasColunas.forEach((col) => {
    const label = col === "_arquivo" ? "Arquivo" : (col.startsWith("_") ? col.slice(1) : col);
    reorderList.appendChild(criarItemExport({ cols: [col], label }));
  });

  document.getElementById("export-modal-cancel")?.addEventListener("click", fecharModalExport);
  document.getElementById("export-modal-confirm")?.addEventListener("click", confirmarExport);
  document.getElementById("btn-fundir")?.addEventListener("click", () => fundirSelecionadas(reorderList));

  reorderList.addEventListener("click", (e) => {
    const item = e.target.closest(".col-reorder-item");
    if (!item) return;
    if (e.target.closest(".col-delete-btn")) { item.remove(); atualizarBotaoFundir(); return; }
    if (e.target.closest(".col-move-up")) { const prev = item.previousElementSibling; if (prev) prev.before(item); return; }
    if (e.target.closest(".col-move-down")) { const next = item.nextElementSibling; if (next) next.after(item); return; }
  });
  reorderList.addEventListener("change", (e) => {
    if (!e.target.classList.contains("col-select-check")) return;
    e.target.closest(".col-reorder-item")?.classList.toggle("selected", e.target.checked);
    atualizarBotaoFundir();
  });

  iniciarDragAndDrop(reorderList);
}

// Cria um <li> da lista de exportação (via DOM p/ evitar escaping do JSON).
function criarItemExport({ cols, label, fused = false }) {
  const li = document.createElement("li");
  li.className = "col-reorder-item";
  li.draggable = true;
  li.dataset.cols = JSON.stringify(cols);
  li.dataset.label = label;

  const check = document.createElement("input");
  check.type = "checkbox"; check.className = "col-select-check"; check.title = "Selecionar para fundir";

  const handle = document.createElement("i");
  handle.className = "ph ph-dots-six-vertical drag-handle";

  const labelWrap = document.createElement("div");
  labelWrap.className = "col-reorder-label";
  if (fused) {
    const input = document.createElement("input");
    input.type = "text"; input.className = "col-fused-name"; input.value = label; input.spellcheck = false;
    input.title = "Nome da coluna resultante";
    const badge = document.createElement("span");
    badge.className = "col-source-badge";
    badge.textContent = "Fundida: " + cols.map(c => (c === "_arquivo" ? "Arquivo" : c)).join(" + ");
    labelWrap.appendChild(input); labelWrap.appendChild(badge);
  } else {
    const span = document.createElement("span");
    span.textContent = label;
    labelWrap.appendChild(span);
  }

  const up = document.createElement("button");
  up.type = "button"; up.className = "col-move-btn col-move-up"; up.title = "Mover para cima";
  up.innerHTML = '<i class="ph ph-caret-up"></i>';
  const down = document.createElement("button");
  down.type = "button"; down.className = "col-move-btn col-move-down"; down.title = "Mover para baixo";
  down.innerHTML = '<i class="ph ph-caret-down"></i>';
  const del = document.createElement("button");
  del.type = "button"; del.className = "col-delete-btn"; del.title = "Remover coluna";
  del.innerHTML = '<i class="ph ph-x"></i>';

  li.append(check, handle, labelWrap, up, down, del);
  return li;
}

function atualizarBotaoFundir() {
  const btn = document.getElementById("btn-fundir");
  if (!btn) return;
  const n = document.querySelectorAll("#col-reorder-list .col-select-check:checked").length;
  btn.disabled = n < 2;
  btn.innerHTML = `<i class="ph ph-arrows-merge"></i> Fundir selecionadas (${n})`;
}

function fundirSelecionadas(lista) {
  const marcados = [...lista.querySelectorAll(".col-reorder-item")].filter(li => li.querySelector(".col-select-check")?.checked);
  if (marcados.length < 2) return;

  const cols = [];
  marcados.forEach(li => JSON.parse(li.dataset.cols).forEach(c => cols.push(c)));
  const label = marcados[0].dataset.label || cols[0];

  const fundido = criarItemExport({ cols, label, fused: true });
  marcados[0].replaceWith(fundido);
  marcados.slice(1).forEach(li => li.remove());
  atualizarBotaoFundir();
}

function fecharModalExport() { document.getElementById("export-modal")?.remove(); }

// Lê o valor de uma coluna numa linha, com fallback case-insensitive.
function getCellValue(row, col) {
  if (col === "_arquivo") return row._arquivo ?? "";
  let v = row[col];
  if (v === undefined) {
    const alvo = String(col).toLowerCase();
    for (const k of Object.keys(row)) {
      if (k.toLowerCase() === alvo) { v = row[k]; break; }
    }
  }
  return v === undefined || v === null ? "" : String(v);
}

async function confirmarExport() {
  const lista = document.getElementById("col-reorder-list");
  const config = [...lista.querySelectorAll(".col-reorder-item")].map(li => {
    const cols = JSON.parse(li.dataset.cols);
    const nomeFundido = li.querySelector(".col-fused-name")?.value.trim();
    let label = nomeFundido || li.dataset.label || cols[0];
    if (cols.length === 1 && cols[0] === "_arquivo") label = "Arquivo";
    return { cols, label };
  });

  if (!config.length) {
    alert("Selecione ao menos uma coluna para exportar.");
    return;
  }

  // Nome do arquivo (sanitizado, com sufixo .csv garantido)
  const rawNome = (document.getElementById("export-filename")?.value || "").trim() || "resultado_cofre";
  const nomeArquivo = rawNome.replace(/[\\/:*?"<>|]+/g, "_").replace(/\.csv$/i, "") + ".csv";

  fecharModalExport();
  toggleLoading(true, "Gerando exportação CSV...");

  // Pequeno delay para garantir que o loader renderize antes de travar a thread
  await new Promise(r => setTimeout(r, 50));

  // Exporta EXATAMENTE o que foi filtrado na busca atual
  const resultados = totalResultados;

  if (!resultados || !resultados.length) {
    toggleLoading(false);
    alert("Nenhum resultado para exportar.");
    return;
  }

  try {
    const cabecalho = config.map(c => `"${c.label.replace(/"/g, '""')}"`).join(";");
    const linhasCSV = resultados.map(linha => {
      return config.map(c => {
        // Fusão: primeiro valor preenchido entre as colunas de origem.
        let valor = "";
        for (const col of c.cols) {
          const v = getCellValue(linha, col);
          if (v !== "") { valor = v; break; }
        }
        return `"${valor.replace(/"/g, '""')}"`;
      }).join(";");
    });

    // Adiciona o BOM (﻿) para garantir que o Excel entenda o UTF-8 (Acentos)
    const csvContent = "﻿" + [cabecalho, ...linhasCSV].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nomeArquivo; a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert("Ocorreu um erro ao gerar o CSV.");
    console.error("Erro na exportação CSV:", error);
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
