let currentPage = 1;
let totalLeads = 0;

let searchEl = null;
let filterStatusEl = null;
let filterServicoEl = null;
let errorBox = null;
let searchDebounce = null;

const PAGE_SIZE = 25;
const LOGIN_URL = "/login/login.html";
const HUB_URL = "/paginaUnificada/index.html";

// ── Loading ────────────────────────────────────────────────────────────────
function showLoading(title, message) {
  window.AppLoading?.show?.({ title, message });
}
function hideLoading() {
  window.AppLoading?.hide?.();
}
async function withLoading(title, message, task) {
  showLoading(title, message);
  try {
    return await task();
  } finally {
    hideLoading();
  }
}

// ── Auth helpers ───────────────────────────────────────────────────────────
function getAuthToken() {
  return localStorage.getItem("auth_token") || "";
}

function clearAuthToken() {
  localStorage.removeItem("auth_token");
}

function buildAuthHeaders(extra = {}) {
  const token = getAuthToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function apiFetch(url, options = {}) {
  const resp = await fetch(url, {
    ...options,
    headers: buildAuthHeaders(options.headers || {}),
  });

  let data = null;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }

  if (!resp.ok) {
    throw new Error(data?.error || data?.message || `Erro HTTP ${resp.status}`);
  }

  return data;
}

async function getCurrentSession() {
  return apiFetch("/api/me", { method: "GET" });
}

async function getCurrentProfile() {
  return apiFetch("/api/profile", { method: "GET" });
}

async function doLogout() {
  try {
    await apiFetch("/api/logout", { method: "POST" });
  } catch {
    // ignora
  } finally {
    clearAuthToken();
  }
}

// ── Query params ───────────────────────────────────────────────────────────
function buildParams(page, limit) {
  const p = new URLSearchParams();
  p.set("page", String(page));
  p.set("limit", String(limit));

  const search = (searchEl?.value || "").trim();
  const status = filterStatusEl?.value || "";
  const servico = filterServicoEl?.value || "";

  if (search) p.set("search", search);
  if (status) p.set("atendido", status);
  if (servico) p.set("servico", servico);

  return p;
}

// ── Filter badge ───────────────────────────────────────────────────────────
function updateFilterBadge() {
  const countEl = document.getElementById("filter-active-count");
  const clearBtn = document.getElementById("btn-clear-filters");

  const active = [filterStatusEl?.value, filterServicoEl?.value].filter(Boolean)
    .length;

  if (countEl) {
    countEl.textContent =
      active > 0
        ? `${active} filtro${active > 1 ? "s" : ""} ativo${active > 1 ? "s" : ""}`
        : "";
    countEl.hidden = active === 0;
  }

  if (clearBtn) clearBtn.hidden = active === 0;
}

// ── Result count ───────────────────────────────────────────────────────────
function updateResultCount(total, page, pageSize) {
  const el = document.getElementById("filter-result-count");
  if (!el) return;

  if (total === 0) {
    el.textContent = "Nenhum lead encontrado";
    return;
  }

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  el.textContent = `Exibindo ${from}–${to} de ${total.toLocaleString("pt-BR")} lead${total !== 1 ? "s" : ""}`;
}

// ── Pagination ─────────────────────────────────────────────────────────────
function renderPagination(total, page, pageSize) {
  const container = document.getElementById("pagination-controls");
  if (!container) return;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  container.innerHTML = "";
  if (totalPages <= 1) return;

  const wrap = document.createElement("div");
  wrap.className = "pagination";

  const mkBtn = (label, targetPage, disabled, active = false) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "page-btn" + (active ? " active" : "");
    btn.disabled = disabled;
    btn.innerHTML = label;

    if (!disabled) {
      btn.addEventListener("click", () => {
        currentPage = targetPage;
        loadLeads(targetPage, false);
      });
    }

    return btn;
  };

  wrap.appendChild(mkBtn('<i class="ph ph-caret-left"></i>', page - 1, page === 1));

  const delta = 2;
  const range = [];
  for (let i = Math.max(1, page - delta); i <= Math.min(totalPages, page + delta); i++) {
    range.push(i);
  }

  if (range[0] > 1) {
    wrap.appendChild(mkBtn("1", 1, false));
    if (range[0] > 2) {
      const d = document.createElement("span");
      d.className = "page-dots";
      d.textContent = "…";
      wrap.appendChild(d);
    }
  }

  range.forEach((p) => wrap.appendChild(mkBtn(String(p), p, false, p === page)));

  if (range[range.length - 1] < totalPages) {
    if (range[range.length - 1] < totalPages - 1) {
      const d = document.createElement("span");
      d.className = "page-dots";
      d.textContent = "…";
      wrap.appendChild(d);
    }
    wrap.appendChild(mkBtn(String(totalPages), totalPages, false));
  }

  wrap.appendChild(
    mkBtn('<i class="ph ph-caret-right"></i>', page + 1, page === totalPages),
  );

  container.appendChild(wrap);
}

// ── Render table ───────────────────────────────────────────────────────────
function renderLeads(leads) {
  const tbody = document.getElementById("leads-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!leads.length) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td colspan="6" style="text-align:center;color:var(--text-secondary);padding:24px;">Nenhum lead encontrado.</td>`;
    tbody.appendChild(tr);
    return;
  }

  leads.forEach((lead) => {
    const summaryRow = document.createElement("tr");
    summaryRow.className = "user-summary-row";
    summaryRow.innerHTML = `
      <td>${escapeHtml(lead.nome || "")}</td>
      <td>${escapeHtml(lead.whatsapp || "")}</td>
      <td>${escapeHtml(lead.cpf || "")}</td>
      <td>${lead.servico
        ? `<span class="badge-servico">${escapeHtml(formatServico(lead.servico))}</span>`
        : `<span style="color:var(--text-secondary);font-size:12px">—</span>`}
      </td>
      <td>${formatDate(lead.created_at)}</td>
      <td>
        <span class="badge ${lead.atendido ? "success" : "warning"}">
          ${lead.atendido ? "Atendido" : "Pendente"}
        </span>
      </td>
    `;

    const detailsRow = document.createElement("tr");
    detailsRow.className = "user-details-row";
    detailsRow.hidden = true;
    detailsRow.innerHTML = `
      <td colspan="6">
        <div class="user-expanded-box">
          <div class="expand-section-title">Dados do lead</div>
          <div class="user-card-grid">
            <div class="field">
              <label>Nome</label>
              <input class="input-dark-lite" value="${escapeAttr(lead.nome || "")}" readonly />
            </div>
            <div class="field">
              <label>WhatsApp</label>
              <input class="input-dark-lite" value="${escapeAttr(lead.whatsapp || "")}" readonly />
            </div>
            <div class="field">
              <label>CPF/CNPJ</label>
              <input class="input-dark-lite" value="${escapeAttr(lead.cpf || "")}" readonly />
            </div>
            <div class="field">
              <label>Serviço de interesse</label>
              <input class="input-dark-lite" value="${escapeAttr(formatServico(lead.servico) || "")}" readonly />
            </div>
          </div>

          ${buildDadosHtml(lead.dados)}

          <div class="actions-lead">
            ${lead.atendido
              ? `<button class="btn-desfazer-atendido btn-toggle-atendido" type="button" data-id="${escapeAttr(lead.id)}">
                   <i class="ph ph-arrow-u-up-left"></i> Desfazer atendimento
                 </button>`
              : `<button class="btn-atendido btn-toggle-atendido" type="button" data-id="${escapeAttr(lead.id)}">
                   <i class="ph ph-check-circle"></i> Marcar como atendido
                 </button>`}
          </div>
        </div>
      </td>
    `;

    summaryRow.addEventListener("click", (e) => {
      if (e.target.closest("button, input")) return;
      detailsRow.hidden = !detailsRow.hidden;
      summaryRow.classList.toggle("expanded", !detailsRow.hidden);
    });

    detailsRow.querySelector(".btn-toggle-atendido")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const newAtendido = !lead.atendido;
      btn.disabled = true;

      try {
        await apiFetch("/api/admin/leads", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: lead.id,
            atendido: newAtendido,
          }),
        });

        await loadLeads(currentPage, false);
        if (typeof showFeedback === "function") {
          showFeedback("Lead atualizado com sucesso.", "success");
        }
      } catch (err) {

        alert(err?.message || "Erro ao atualizar o lead.");
       
        btn.disabled = false;
      }
    });

    tbody.appendChild(summaryRow);
    tbody.appendChild(detailsRow);
  });
}

function buildDadosHtml(dados) {
  if (!dados || typeof dados !== "object" || !Object.keys(dados).length) {
    return `
      <div class="expand-section-title" style="margin-top:18px;">Respostas do formulário</div>
      <p class="dado-empty">Nenhuma resposta registrada.</p>
    `;
  }

  const items = Object.entries(dados)
    .map(([key, value]) => {
      const displayValue =
        value === null || value === undefined || value === ""
          ? `<span class="dado-empty">Não informado</span>`
          : escapeHtml(String(value));

      return `
      <div class="dado-item">
        <div class="dado-key">${escapeHtml(key)}</div>
        <div class="dado-value">${displayValue}</div>
      </div>
    `;
    })
    .join("");

  return `
    <div class="expand-section-title" style="margin-top:18px;">Respostas do formulário</div>
    <div class="dados-grid">${items}</div>
  `;
}

// ── Load leads ─────────────────────────────────────────────────────────────
async function loadLeads(page = 1, showLoader = true) {
  const task = async () => {
    setError(errorBox, "", true);

    try {
      const params = buildParams(page, PAGE_SIZE);
      const data = await apiFetch(`/api/admin/leads?${params.toString()}`, {
        method: "GET",
      });

      const leads = Array.isArray(data?.leads) ? data.leads : [];
      totalLeads = Number.isFinite(data?.total) ? data.total : leads.length;
      currentPage = page;

      renderLeads(leads);
      updateResultCount(totalLeads, page, PAGE_SIZE);
      renderPagination(totalLeads, page, PAGE_SIZE);
    } catch (err) {
      setError(errorBox, err?.message || "Erro ao carregar leads.");
    }
  };

  return showLoader
    ? withLoading("Carregando leads", "Buscando dados...", task)
    : task();
}

// ── Fetch all for Excel ────────────────────────────────────────────────────
async function fetchAllLeads() {
  const limit = 500;
  let page = 1;
  const results = [];

  while (true) {
    const params = buildParams(page, limit);
    const data = await apiFetch(`/api/admin/leads?${params.toString()}`, {
      method: "GET",
    });

    const leads = Array.isArray(data?.leads) ? data.leads : [];
    results.push(...leads);

    if (leads.length < limit) break;
    page++;
  }

  return results;
}

async function exportToExcel() {
  const btn = document.getElementById("btn-export-excel");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Buscando dados…';
  }

  try {
    const leads = await fetchAllLeads();

    if (!leads.length) {
      alert("Nenhum lead encontrado com os filtros atuais.");
      return;
    }

    const rows = leads.map((l) => ({
      Nome: l.nome || "",
      WhatsApp: l.whatsapp || "",
      "CPF/CNPJ": l.cpf || "",
      Serviço: formatServico(l.servico) || "",
      Data: formatDate(l.created_at),
      Status: l.atendido ? "Atendido" : "Pendente",
      ...(l.dados && typeof l.dados === "object"
        ? Object.fromEntries(
            Object.entries(l.dados).map(([k, v]) => [`Resp: ${k}`, v ?? ""]),
          )
        : {}),
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Object.keys(rows[0]).map((key) => ({
      wch: Math.min(
        Math.max(key.length, ...rows.map((r) => String(r[key] ?? "").length)) + 2,
        40,
      ),
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Leads");

    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    XLSX.writeFile(wb, `leads_avance_${stamp}.xlsx`);
  } catch (err) {
    alert(err?.message || "Erro ao exportar.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML =
        '<i class="ph ph-microsoft-excel-logo"></i> Exportar para Excel';
    }
  }
}

// ── Dropdown helper ────────────────────────────────────────────────────────
function initSingleDropdown({ btnId, dropdownId, labelId, hiddenEl, onSelect }) {
  const btn = document.getElementById(btnId);
  const dropdown = document.getElementById(dropdownId);
  const label = document.getElementById(labelId);

  btn?.addEventListener("click", () => {
    const isOpen = !dropdown.hidden;

    document.querySelectorAll(".filter-multiselect-dropdown").forEach((d) => {
      d.hidden = true;
    });
    document.querySelectorAll(".filter-multiselect-btn.is-open").forEach((b) => {
      b.classList.remove("is-open");
    });

    if (!isOpen) {
      dropdown.hidden = false;
      btn.classList.add("is-open");
    }
  });

  dropdown?.querySelectorAll(".filter-single-item").forEach((li) => {
    li.addEventListener("click", () => {
      if (hiddenEl) hiddenEl.value = li.dataset.value;
      if (label) label.textContent = li.textContent;

      dropdown.querySelectorAll(".filter-single-item").forEach((el) =>
        el.classList.remove("is-selected"),
      );
      li.classList.add("is-selected");
      dropdown.hidden = true;
      btn?.classList.remove("is-open");
      onSelect?.();
    });
  });
}

function resetSingleDropdown({ dropdownId, labelId, hiddenEl, defaultLabel }) {
  if (hiddenEl) hiddenEl.value = "";

  const lbl = document.getElementById(labelId);
  if (lbl) lbl.textContent = defaultLabel;

  const dd = document.getElementById(dropdownId);
  if (dd) {
    dd.querySelectorAll(".filter-single-item").forEach((li) =>
      li.classList.remove("is-selected"),
    );
    dd.querySelector(".filter-single-item")?.classList.add("is-selected");
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────
function applyAndReload() {
  currentPage = 1;
  loadLeads(1, false);
  updateFilterBadge();
}

function setError(el, message, hidden = false) {
  if (!el) return;
  el.textContent = message || "";
  el.hidden = hidden || !message;
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

function formatServico(value) {
  const v = String(value || "").toLowerCase();
  if (v === "movel") return "Telefonia móvel";
  if (v === "internet") return "Internet";
  if (v === "fixa") return "Telefonia fixa";
  return value || "";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function initSettingsMenu(btn, menu) {
  if (!btn || !menu) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#sidebar-userbar")) menu.hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") menu.hidden = true;
  });
}

function initMobileSidebar(btn) {
  btn?.addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
}

function initTheme(btn) {
  if (!btn) return;

  if (localStorage.getItem("theme") === "light") {
    document.body.classList.add("light-mode");
    btn.querySelector("span").textContent = "Modo escuro";
    btn.querySelector("i").className = "ph ph-moon";
  }

  btn.addEventListener("click", () => {
    const isLight = document.body.classList.toggle("light-mode");
    btn.querySelector("span").textContent = isLight ? "Modo escuro" : "Modo claro";
    btn.querySelector("i").className = isLight ? "ph ph-moon" : "ph ph-sun";
    localStorage.setItem("theme", isLight ? "light" : "dark");
  });
}

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  searchEl = document.getElementById("search");
  filterStatusEl = document.getElementById("filter-status");
  filterServicoEl = document.getElementById("filter-servico");
  errorBox = document.getElementById("errorBox");

  try {
    await withLoading("Carregando leads", "Validando acesso...", async () => {
      const token = getAuthToken();
      if (!token) {
        window.location.href = LOGIN_URL;
        return;
      }

      const sessionData = await getCurrentSession();
      if (!sessionData?.ok || !sessionData?.user) {
        clearAuthToken();
        window.location.href = LOGIN_URL;
        return;
      }

      const profileData = await getCurrentProfile();
      const profile = profileData?.user || {};
      const user = sessionData.user;

      if (!profile?.protocol && !user?.protocol) {
        alert("Você não tem permissão para acessar esta tela.");
        window.location.href = HUB_URL;
        return;
      }

      const email = user?.email || "";
      const emailEl = document.getElementById("user-email");
      if (emailEl) {
        emailEl.textContent = email;
        emailEl.title = email;
      }

      initSettingsMenu(
        document.getElementById("settings-btn"),
        document.getElementById("settings-menu"),
      );
      initMobileSidebar(document.getElementById("mobile-menu-btn"));
      initTheme(document.getElementById("theme-toggle"));

      document.getElementById("menu-back-hub")?.addEventListener("click", () => {
        window.location.href = HUB_URL;
      });

      document.getElementById("menu-logout")?.addEventListener("click", async () => {
        await doLogout();
        window.location.href = LOGIN_URL;
      });

      document.addEventListener("click", (e) => {
        if (!e.target.closest(".filter-multiselect")) {
          document.querySelectorAll(".filter-multiselect-dropdown").forEach((d) => {
            d.hidden = true;
          });
          document.querySelectorAll(".filter-multiselect-btn.is-open").forEach((b) =>
            b.classList.remove("is-open"),
          );
        }
      });

      document.getElementById("filter-bar-toggle")?.addEventListener("click", () => {
        const body = document.getElementById("filter-bar-body");
        const caret = document.getElementById("filter-caret");
        if (!body) return;

        const open = body.hidden;
        body.hidden = !open;

        if (caret) {
          caret.className = open
            ? "ph ph-caret-up filter-caret"
            : "ph ph-caret-down filter-caret";
        }
      });

      searchEl?.addEventListener("input", () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(applyAndReload, 350);
      });

      initSingleDropdown({
        btnId: "filter-status-btn",
        dropdownId: "filter-status-dropdown",
        labelId: "filter-status-label",
        hiddenEl: filterStatusEl,
        onSelect: applyAndReload,
      });

      initSingleDropdown({
        btnId: "filter-servico-btn",
        dropdownId: "filter-servico-dropdown",
        labelId: "filter-servico-label",
        hiddenEl: filterServicoEl,
        onSelect: applyAndReload,
      });

      document.getElementById("btn-clear-filters")?.addEventListener("click", () => {
        resetSingleDropdown({
          dropdownId: "filter-status-dropdown",
          labelId: "filter-status-label",
          hiddenEl: filterStatusEl,
          defaultLabel: "Todos",
        });

        resetSingleDropdown({
          dropdownId: "filter-servico-dropdown",
          labelId: "filter-servico-label",
          hiddenEl: filterServicoEl,
          defaultLabel: "Todos",
        });

        if (searchEl) searchEl.value = "";
        applyAndReload();
      });

      document
        .getElementById("btn-export-excel")
        ?.addEventListener("click", exportToExcel);

      await loadLeads(1, false);
    });
  } catch (err) {
    console.error(err);
    setError(errorBox, "Erro ao carregar a página.");
  }
});