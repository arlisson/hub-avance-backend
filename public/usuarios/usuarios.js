let searchEl = null;
let errorBox = null;
let appUsageErrorBox = null;
let supabaseClient = null;
let currentSession = null;
let currentView = "users";

// Paginação
const PAGE_SIZE = 25;
let currentPage = 1;
let totalUsers = 0;

// Filtros
let filterClienteEl   = null;
let filterTelefoniaEl = null;
let filterLinhasEl    = null;
let filterContratoEl  = null;
let filterOperadoraEl = null;

// Debounce do campo de busca
let searchDebounceTimer = null;

const METRICS = [
  { key: "access", label: "Acessos" },
  { key: "download", label: "Downloads" },
];

const APP_CATALOG = {
  desktop: {
    label: "Preenche Fácil",
    icon: "ph-desktop",
    metrics: METRICS,
  },
  agent: {
    label: "Agente de IA",
    icon: "ph-robot",
    metrics: METRICS,
  },
  protocol: {
    label: "Gerador de Protocolo",
    icon: "ph-file-text",
    metrics: METRICS,
  },
};

function showLoading(title, message) {
  if (window.AppLoading && typeof window.AppLoading.show === "function") {
    window.AppLoading.show({ title, message });
  }
}

function hideLoading() {
  if (window.AppLoading && typeof window.AppLoading.hide === "function") {
    window.AppLoading.hide();
  }
}
async function withLoading(title, message, task) {
  showLoading(title, message);
  try {
    return await task();
  } finally {
    hideLoading();
  }
}

// Monta os query params com base nos filtros e busca ativos
function buildQueryParams(page, limit) {
  const params = new URLSearchParams();
  params.set("page",  String(page));
  params.set("limit", String(limit));

  const search = (searchEl?.value || "").trim();
  if (search)                          params.set("search",            search);
  if (filterClienteEl?.value)          params.set("cliente_avance",    filterClienteEl.value);
  if (filterTelefoniaEl?.value)        params.set("has_mobile_service", filterTelefoniaEl.value);
  if (filterLinhasEl?.value)           params.set("active_lines",       filterLinhasEl.value);
  if (filterContratoEl?.value)         params.set("contract_type",      filterContratoEl.value);
  if (filterOperadoraEl?.value)        params.set("operator",           filterOperadoraEl.value);

  return params;
}

// Chamado quando filtro/busca muda: volta para página 1 e recarrega
function applyFiltersAndReload() {
  currentPage = 1;
  loadUsers(window.__USER_ACCESS_TOKEN__, 1, true);
  updateFilterBadge();
}

function updateResultCount(total, page, pageSize) {
  const el = document.getElementById("filter-result-count");
  if (!el) return;
  if (total === 0) {
    el.textContent = "Nenhum usuário encontrado";
    return;
  }
  const from = (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, total);
  el.textContent = `Exibindo ${from}–${to} de ${total.toLocaleString("pt-BR")} usuário${total !== 1 ? "s" : ""}`;
}

function updateFilterBadge() {
  const countEl  = document.getElementById("filter-active-count");
  const clearBtn = document.getElementById("btn-clear-filters");

  const active = [
    filterClienteEl?.value,
    filterTelefoniaEl?.value,
    filterLinhasEl?.value,
    filterContratoEl?.value,
    filterOperadoraEl?.value,
  ].filter(Boolean).length;

  if (countEl) {
    countEl.textContent = active > 0
      ? `${active} filtro${active > 1 ? "s" : ""} ativo${active > 1 ? "s" : ""}`
      : "";
    countEl.hidden = active === 0;
  }
  if (clearBtn) clearBtn.hidden = active === 0;
}

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
        loadUsers(window.__USER_ACCESS_TOKEN__, targetPage, false);
      });
    }
    return btn;
  };

  wrap.appendChild(mkBtn('<i class="ph ph-caret-left"></i>', page - 1, page === 1));

  // Janela de páginas
  const delta = 2;
  const range = [];
  for (let i = Math.max(1, page - delta); i <= Math.min(totalPages, page + delta); i++) {
    range.push(i);
  }
  if (range[0] > 1) {
    wrap.appendChild(mkBtn("1", 1, false));
    if (range[0] > 2) {
      const dots = document.createElement("span");
      dots.className = "page-dots";
      dots.textContent = "…";
      wrap.appendChild(dots);
    }
  }
  range.forEach((p) => wrap.appendChild(mkBtn(String(p), p, false, p === page)));
  if (range[range.length - 1] < totalPages) {
    if (range[range.length - 1] < totalPages - 1) {
      const dots = document.createElement("span");
      dots.className = "page-dots";
      dots.textContent = "…";
      wrap.appendChild(dots);
    }
    wrap.appendChild(mkBtn(String(totalPages), totalPages, false));
  }

  wrap.appendChild(mkBtn('<i class="ph ph-caret-right"></i>', page + 1, page === totalPages));
  container.appendChild(wrap);
}

document.addEventListener("DOMContentLoaded", async () => {
  const LOGIN_URL = "/login/login.html";
  const HUB_URL = "/hub/hub.html";

  searchEl = document.getElementById("search");
  errorBox = document.getElementById("errorBox");
  appUsageErrorBox = document.getElementById("appUsageErrorBox");

  try {
    await withLoading(
      "Carregando usuários",
      "Validando acesso e buscando dados...",
      async () => {
        try {
          supabaseClient = await window.getSupabaseClient();
        } catch {
          window.location.href = LOGIN_URL;
          return;
        }

        try {
          const { data: sessionData, error: sessionError } =
            await supabaseClient.auth.getSession();

          if (sessionError || !sessionData?.session) {
            window.location.href = LOGIN_URL;
            return;
          }

          currentSession = sessionData.session;
          window.__USER_ACCESS_TOKEN__ = currentSession.access_token;
        } catch {
          window.location.href = LOGIN_URL;
          return;
        }

        const user = currentSession.user;
        const email = user?.email || "";

        try {
          const { data: profile, error } = await supabaseClient
            .from("profiles")
            .select("protocol")
            .eq("id", user.id)
            .single();

          if (error) throw error;

          if (!profile?.protocol) {
            alert("Você não tem permissão para acessar esta tela.");
            window.location.href = HUB_URL;
            return;
          }
        } catch (err) {
          console.error("Erro ao validar acesso:", err);
          alert("Não foi possível validar sua permissão de acesso.");
          window.location.href = HUB_URL;
          return;
        }

        const userEmailEl = document.getElementById("user-email");
        if (userEmailEl) {
          userEmailEl.textContent = email;
          userEmailEl.title = email;
        }

        initSettingsMenu(
          document.getElementById("settings-btn"),
          document.getElementById("settings-menu")
        );
        initMobileSidebar(document.getElementById("mobile-menu-btn"));
        initTheme(document.getElementById("theme-toggle"));
        initNavigation();

        const menuBackHub = document.getElementById("menu-back-hub");
        if (menuBackHub) {
          menuBackHub.addEventListener("click", () => {
            window.location.href = HUB_URL;
          });
        }

        const menuLogout = document.getElementById("menu-logout");
        if (menuLogout) {
          menuLogout.addEventListener("click", async () => {
            try {
              await supabaseClient.auth.signOut();
            } finally {
              window.location.href = LOGIN_URL;
            }
          });
        }

        document
          .getElementById("btn-refresh-app-usage")
          ?.addEventListener("click", async () => {
            await loadAppUsageDashboard(true);
          });

        // Busca com debounce de 350ms
        searchEl?.addEventListener("input", () => {
          clearTimeout(searchDebounceTimer);
          searchDebounceTimer = setTimeout(() => applyFiltersAndReload(), 350);
        });

        // Inicializa referências dos filtros
        filterClienteEl   = document.getElementById("filter-cliente");
        filterTelefoniaEl = document.getElementById("filter-telefonia");
        filterLinhasEl    = document.getElementById("filter-linhas");
        filterContratoEl  = document.getElementById("filter-contrato");
        filterOperadoraEl = document.getElementById("filter-operadora");

        [filterClienteEl, filterTelefoniaEl, filterLinhasEl, filterContratoEl, filterOperadoraEl]
          .forEach((el) => el?.addEventListener("change", () => applyFiltersAndReload()));

        document.getElementById("btn-clear-filters")?.addEventListener("click", () => {
          if (filterClienteEl)   filterClienteEl.value   = "";
          if (filterTelefoniaEl) filterTelefoniaEl.value = "";
          if (filterLinhasEl)    filterLinhasEl.value    = "";
          if (filterContratoEl)  filterContratoEl.value  = "";
          if (filterOperadoraEl) filterOperadoraEl.value = "";
          applyFiltersAndReload();
        });

        document.getElementById("btn-export-excel")?.addEventListener("click", () => {
          exportFilteredUsersToExcel();
        });

        document.getElementById("filter-bar-toggle")?.addEventListener("click", () => {
          const body  = document.getElementById("filter-bar-body");
          const caret = document.getElementById("filter-caret");
          if (!body) return;
          const open = body.hidden;
          body.hidden = !open;
          if (caret) caret.className = open ? "ph ph-caret-up filter-caret" : "ph ph-caret-down filter-caret";
        });

        await loadUsers(currentSession.access_token, 1, false);
        await loadAppUsageDashboard(false);
      }
    );
  } catch (err) {
    console.error(err);
    setError(errorBox, "Erro ao carregar os dados da página.");
  }
});

async function loadUsers(token, page = 1, showLoader = true) {
  const task = async () => {
    try {
      setError(errorBox, "", true);

      const params = buildQueryParams(page, PAGE_SIZE);
      const resp   = await fetch(`/api/admin/users?${params.toString()}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data?.error || "Falha ao carregar usuários.");
      }

      const users = Array.isArray(data?.users) ? data.users : [];
      // Suporte a resposta com campo "total" ou inferência pelo tamanho da página
      totalUsers = Number.isFinite(data?.total)
        ? data.total
        : page === 1 && users.length < PAGE_SIZE
          ? users.length
          : (page - 1) * PAGE_SIZE + users.length + (users.length === PAGE_SIZE ? 1 : 0);

      currentPage = page;

      renderUsers(users);
      updateResultCount(totalUsers, page, PAGE_SIZE);
      renderPagination(totalUsers, page, PAGE_SIZE);
    } catch (e) {
      setError(errorBox, e?.message || "Erro ao carregar usuários.");
    }
  };

  if (!showLoader) {
    return await task();
  }

  return await withLoading(
    "Carregando usuários",
    "Buscando dados no banco...",
    task
  );
}

// Busca TODAS as páginas com os filtros ativos (usado apenas no export)
async function fetchAllFilteredUsers(token) {
  const limit   = 500;
  let   page    = 1;
  const results = [];

  while (true) {
    const params = buildQueryParams(page, limit);
    const resp   = await fetch(`/api/admin/users?${params.toString()}`, {
      method:  "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) throw new Error("Falha ao buscar usuários para exportação.");

    const data  = await resp.json();
    const users = Array.isArray(data?.users) ? data.users : [];
    results.push(...users);

    // Para quando vier menos que o limite (última página)
    if (users.length < limit) break;
    page++;
  }

  return results;
}

async function loadAppUsageDashboard(showLoader = true) {
  const task = async () => {
    try {
      setError(appUsageErrorBox, "", true);

      const records = await fetchAppUsageRecords();
      renderAppUsageDashboard(records);
    } catch (e) {
      setError(
        appUsageErrorBox,
        e?.message || "Erro ao carregar uso dos aplicativos."
      );
      renderAppUsageDashboard([]);
    }
  };

  if (!showLoader) {
    return await task();
  }

  return await withLoading(
    "Carregando painel",
    "Consultando uso dos aplicativos...",
    task
  );
}

async function fetchAppUsageRecords() {
  const tableResult = await tryFetchAppUsageTable();

  if (tableResult.success && tableResult.rows.length) {
    return normalizeTableRows(tableResult.rows);
  }

  return aggregateUsageFromUsers([]);
}

async function tryFetchAppUsageTable() {
  try {
    const { data, error } = await supabaseClient
      .from("app_access")
      .select("id, name, acessos, updated_at")
      .order("name", { ascending: true });

    if (error) {
      console.error("Erro ao buscar app_access:", error);
      return { success: false, rows: [] };
    }

    return { success: true, rows: Array.isArray(data) ? data : [] };
  } catch (err) {
    console.error("Erro inesperado ao buscar app_access:", err);
    return { success: false, rows: [] };
  }
}

function normalizeTableRows(rows) {
  return rows.map((row) => {
    const key = String(row?.name || "").trim().toLowerCase();

    return {
      key,
      label: getAppMeta(key)?.label || key || "Aplicativo",
      accesses: Number(row?.acessos || 0),
      updated_at: row?.updated_at || null,
    };
  });
}

function aggregateUsageFromUsers(users) {
  const totals = new Map();

  users.forEach((user) => {
    const usage =
      user?.app_usage && typeof user.app_usage === "object"
        ? user.app_usage
        : {};

    Object.entries(usage).forEach(([appKey, appData]) => {
      const current = totals.get(appKey) || {
        key: appKey,
        label: getAppMeta(appKey)?.label || appKey,
        accesses: 0,
        updated_at: null,
      };

      current.accesses += Number(appData?.access || 0);
      totals.set(appKey, current);
    });
  });

  return Array.from(totals.values()).sort((a, b) =>
    a.label.localeCompare(b.label, "pt-BR")
  );
}

function renderUsers(users) {
  const tbody = document.getElementById("users-table-body");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!users.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td colspan="8" style="text-align:center; color: var(--text-secondary); padding: 24px;">
        Nenhum usuário encontrado.
      </td>
    `;
    tbody.appendChild(tr);
    return;
  }

  users.forEach((u) => {
    const regiao = parseRegion(u.regiao);
    const cep = regiao.cep || u.cep || "";
    const cidade = regiao.cidade || "";
    const estado = regiao.estado || "";

    const summaryRow = document.createElement("tr");
    summaryRow.className = "user-summary-row";
    summaryRow.setAttribute("data-user-id", u.id);

    summaryRow.innerHTML = `
      <td>${escapeHtml(u.name || "")}</td>
      <td>${escapeHtml(u.email || "")}</td>
      <td>${escapeHtml(u.cpf || "")}</td>
      <td>${escapeHtml(u.whatsapp || "")}</td>
      <td>${escapeHtml(cidade)}</td>
      <td>${escapeHtml(estado)}</td>
      <td>
        <span class="badge ${u.protocol ? "success" : "muted"}">
          ${u.protocol ? "Sim" : "Não"}
        </span>
      </td>
      <td>
        <span class="badge ${u.cliente_avance ? "success" : "muted"}">
          ${u.cliente_avance ? "Sim" : "Não"}
        </span>
      </td>
    `;

    const detailsRow = document.createElement("tr");
    detailsRow.className = "user-details-row";
    detailsRow.hidden = true;

    detailsRow.innerHTML = `
      <td colspan="8">
        <div class="user-expanded-box">
          <div class="expand-section-title">Dados do cliente</div>

          <div class="user-card-grid">
            <div class="field">
              <label>Nome</label>
              <input class="input-dark-lite edit-name" value="${escapeAttr(
                u.name || ""
              )}" readonly />
            </div>

            <div class="field">
              <label>E-mail</label>
              <input class="input-dark-lite edit-email" value="${escapeAttr(
                u.email || ""
              )}" readonly />
            </div>

            <div class="field">
              <label>CPF/CNPJ</label>
              <input class="input-dark-lite edit-cpf" value="${escapeAttr(
                u.cpf || ""
              )}" readonly />
            </div>

            <div class="field">
              <label>WhatsApp</label>
              <input class="input-dark-lite edit-whatsapp" value="${escapeAttr(
                u.whatsapp || ""
              )}" readonly />
            </div>

            <div class="field">
              <label>CEP</label>
              <input class="input-dark-lite edit-cep" value="${escapeAttr(
                cep
              )}" readonly />
            </div>

            <div class="field">
              <label>Cidade</label>
              <input class="input-dark-lite edit-cidade" value="${escapeAttr(
                cidade
              )}" readonly />
            </div>

            <div class="field">
              <label>Estado</label>
              <input class="input-dark-lite edit-estado" value="${escapeAttr(
                estado
              )}" readonly />
            </div>

            <div class="field">
              <label>Telefonia ativa</label>
              <input class="input-dark-lite" value="${
                u.has_mobile_service ? "Sim" : "Não"
              }" readonly />
            </div>

            <div class="field">
              <label>Tipo de contrato</label>
              <input class="input-dark-lite edit-contract-type" value="${escapeAttr(
                u.contract_type || ""
              )}" readonly />
            </div>

            <div class="field">
              <label>Operadora</label>
              <input class="input-dark-lite edit-operator" value="${escapeAttr(
                u.operator || ""
              )}" readonly />
            </div>

            <div class="field">
              <label>Linhas ativas</label>
              <input class="input-dark-lite edit-active-lines" type="number" value="${
                Number.isFinite(u.active_lines) ? u.active_lines : ""
              }" readonly />
            </div>
          </div>

          <div class="expand-section-title" style="margin-top: 18px;">Permissões</div>

          <div class="field">
            <div class="inline-checks">
              <label>
                <input type="checkbox" class="edit-protocol" ${
                  u.protocol ? "checked" : ""
                }>
                Protocolo Agendor
              </label>

              <label>
                <input type="checkbox" class="edit-cliente-avance" ${
                  u.cliente_avance ? "checked" : ""
                }>
                Cliente Avance
              </label>
            </div>
          </div>

          <div class="expand-section-title" style="margin-top: 18px;">Uso dos aplicativos</div>
          ${renderUserAppUsageBlock(u.app_usage)}

          <div class="actions">
            <button class="btn-primary btn-save-user" type="button">Salvar alterações</button>
            <button class="btn-danger btn-delete-user" type="button">Excluir</button>
          </div>
        </div>
      </td>
    `;

    summaryRow.addEventListener("click", (e) => {
      const clickedFormElement = e.target.closest(
        "button, input, textarea, select, label"
      );
      if (clickedFormElement) return;

      detailsRow.hidden = !detailsRow.hidden;
      summaryRow.classList.toggle("expanded", !detailsRow.hidden);
    });

    const btnSave = detailsRow.querySelector(".btn-save-user");
    const btnDelete = detailsRow.querySelector(".btn-delete-user");
    const protocolEl = detailsRow.querySelector(".edit-protocol");
    const clienteEl = detailsRow.querySelector(".edit-cliente-avance");
    const nameEl = detailsRow.querySelector(".edit-name");
    const emailEl = detailsRow.querySelector(".edit-email");
    const cpfEl = detailsRow.querySelector(".edit-cpf");
    const whatsappEl = detailsRow.querySelector(".edit-whatsapp");
    const contractTypeEl = detailsRow.querySelector(".edit-contract-type");
    const operatorEl = detailsRow.querySelector(".edit-operator");
    const activeLinesEl = detailsRow.querySelector(".edit-active-lines");

    btnSave?.addEventListener("click", async () => {
      btnSave.disabled = true;
      if (btnDelete) btnDelete.disabled = true;

      try {
        const resp = await fetch("/api/admin/update-user", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${window.__USER_ACCESS_TOKEN__ || ""}`,
          },
          body: JSON.stringify({
            id: u.id,
            name: (nameEl?.value || "").trim(),
            email: (emailEl?.value || "").trim(),
            cpf: (cpfEl?.value || "").trim(),
            whatsapp: (whatsappEl?.value || "").trim(),
            contract_type: (contractTypeEl?.value || "").trim(),
            operator: (operatorEl?.value || "").trim(),
            active_lines:
              activeLinesEl?.value === ""
                ? null
                : Number(activeLinesEl.value),
            protocol: !!protocolEl?.checked,
            cliente_avance: !!clienteEl?.checked,
          }),
        });

        const data = await resp.json();

        if (!resp.ok) {
          throw new Error(data?.error || "Falha ao salvar.");
        }

        u.name = (nameEl?.value || "").trim();
        u.email = (emailEl?.value || "").trim();
        u.cpf = (cpfEl?.value || "").trim();
        u.whatsapp = (whatsappEl?.value || "").trim();
        u.contract_type = (contractTypeEl?.value || "").trim();
        u.operator = (operatorEl?.value || "").trim();
        u.active_lines =
          activeLinesEl?.value === "" ? null : Number(activeLinesEl.value);
        u.protocol = !!protocolEl?.checked;
        u.cliente_avance = !!clienteEl?.checked;

        applyFilterAndRender();
      } catch (e) {
        alert(e?.message || "Erro ao salvar usuário.");
      } finally {
        btnSave.disabled = false;
        if (btnDelete) btnDelete.disabled = false;
      }
    });

    btnDelete?.addEventListener("click", async () => {
      const confirmed = window.confirm(
        `Tem certeza que deseja excluir o usuário "${
          u.name || u.email || u.id
        }"?\n\nEssa ação não pode ser desfeita.`
      );

      if (!confirmed) return;

      btnDelete.disabled = true;
      if (btnSave) btnSave.disabled = true;

      try {
        const resp = await fetch("/api/admin/delete-user", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${window.__USER_ACCESS_TOKEN__ || ""}`,
          },
          body: JSON.stringify({ id: u.id }),
        });

        const data = await resp.json();

        if (!resp.ok) {
          throw new Error(
            data?.detail || data?.error || "Falha ao excluir usuário."
          );
        }

        // Recarrega a página atual após excluir
        await loadUsers(window.__USER_ACCESS_TOKEN__ || "", currentPage, false);
        await loadAppUsageDashboard(false);
        showFeedback("Usuário excluído com sucesso.", "success");
      } catch (e) {
        alert(e?.message || "Erro ao excluir usuário.");
      } finally {
        btnDelete.disabled = false;
        if (btnSave) btnSave.disabled = false;
      }
    });

    tbody.appendChild(summaryRow);
    tbody.appendChild(detailsRow);
  });
}

function renderUserAppUsageBlock(appUsage) {
  const usage = appUsage && typeof appUsage === "object" ? appUsage : {};
  const knownKeys = Object.keys(APP_CATALOG);
  const unknownKeys = Object.keys(usage).filter(
    (key) => !knownKeys.includes(key)
  );
  const orderedKeys = [...knownKeys.filter((key) => usage[key]), ...unknownKeys];

  if (!orderedKeys.length) {
    return `
      <div class="app-usage-box">
        <div class="hint">Nenhum uso registrado.</div>
      </div>
    `;
  }

  const rows = orderedKeys.map((appKey) => {
    const meta = getAppMeta(appKey) || {
      label: appKey,
      metrics: METRICS,
    };

    const appData = usage[appKey] || {};

    const metricsHtml = meta.metrics
      .map((metric) => {
        const value = Number(appData?.[metric.key] || 0);
        return `
          <div class="usage-metric">
            <span class="usage-metric-label">${escapeHtml(
              metric.label
            )}</span>
            <span class="usage-metric-value">${formatNumber(value)}</span>
          </div>
        `;
      })
      .join("");

    return `
      <div class="usage-product-row">
        <div class="usage-product-name">${escapeHtml(meta.label)}</div>
        <div class="usage-metrics-grid">
          ${metricsHtml}
        </div>
      </div>
    `;
  });

  return `
    <div class="app-usage-box">
      ${rows.join("")}
    </div>
  `;
}

function renderAppUsageDashboard(records) {
  const summaryGrid = document.getElementById("usage-summary-grid");
  const tbody = document.getElementById("app-usage-table-body");
  if (!summaryGrid || !tbody) return;

  summaryGrid.innerHTML = "";
  tbody.innerHTML = "";

  const orderedRecords = orderUsageRecords(records);

  if (!orderedRecords.length) {
    summaryGrid.innerHTML = `
      <div class="usage-summary-card">
        <div class="usage-summary-title">Nenhum dado disponível</div>
        <div class="usage-summary-date">Nenhum acesso registrado.</div>
      </div>
    `;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td colspan="4" style="text-align:center; color: var(--text-secondary); padding: 24px;">
        Nenhum dado de uso disponível.
      </td>
    `;
    tbody.appendChild(tr);
    return;
  }

  orderedRecords.forEach((record) => {
    const summaryCard = document.createElement("div");
    summaryCard.className = "usage-summary-card";
    summaryCard.innerHTML = `
      <div class="usage-summary-top">
        <div class="usage-summary-title">${escapeHtml(record.label)}</div>
        <span class="usage-summary-key">${escapeHtml(record.key)}</span>
      </div>
      <div class="usage-summary-number">${formatNumber(record.accesses)}</div>
      <div class="usage-summary-date">${formatDateTime(record.updated_at)}</div>
    `;
    summaryGrid.appendChild(summaryCard);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(record.label)}</td>
      <td>${escapeHtml(record.key)}</td>
      <td>${formatNumber(record.accesses)}</td>
      <td>${escapeHtml(formatDateTime(record.updated_at))}</td>
    `;
    tbody.appendChild(tr);
  });
}

function orderUsageRecords(records) {
  const map = new Map();

  Object.entries(APP_CATALOG).forEach(([key, meta]) => {
    map.set(key, {
      key,
      label: meta.label,
      accesses: 0,
      updated_at: null,
    });
  });

  records.forEach((record) => {
    if (!record?.key) return;
    map.set(record.key, {
      key: record.key,
      label: record.label || getAppMeta(record.key)?.label || record.key,
      accesses: Number(record.accesses || 0),
      updated_at: record.updated_at || null,
    });
  });

  return Array.from(map.values()).sort((a, b) =>
    a.label.localeCompare(b.label, "pt-BR")
  );
}

function initNavigation() {
  const navCards = Array.from(document.querySelectorAll(".nav-card"));
  navCards.forEach((item) => {
    item.addEventListener("click", () => {
      const view = item.dataset.view || "users";
      switchView(view);
    });
  });
}

function switchView(view) {
  currentView = view;

  document.querySelectorAll(".nav-card").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });

  const usersSection = document.getElementById("view-users");
  const appsSection = document.getElementById("view-apps-usage");
  const usersHeader = document.getElementById("page-header-users");
  const appsHeader = document.getElementById("page-header-apps");

  const showingUsers = view === "users";
  if (usersSection) usersSection.hidden = !showingUsers;
  if (appsSection) appsSection.hidden = showingUsers;
  if (usersHeader) usersHeader.hidden = !showingUsers;
  if (appsHeader) appsHeader.hidden = showingUsers;

  if (document.body.classList.contains("sidebar-open")) {
    document.body.classList.remove("sidebar-open");
  }
}

function parseRegion(regiao) {
  if (regiao && typeof regiao === "object") return regiao;
  if (typeof regiao === "string") {
    try {
      return JSON.parse(regiao);
    } catch {
      return {};
    }
  }
  return {};
}

function getAppMeta(appKey) {
  return APP_CATALOG[String(appKey || "").trim().toLowerCase()] || null;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("pt-BR");
}

function formatDateTime(value) {
  if (!value) return "Sem atualização";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem atualização";

  return date.toLocaleString("pt-BR");
}

function setError(element, message, hidden = false) {
  if (!element) return;
  element.textContent = message || "";
  element.hidden = hidden || !message;
}


async function exportFilteredUsersToExcel() {
  const exportBtn = document.getElementById("btn-export-excel");
  if (exportBtn) {
    exportBtn.disabled = true;
    exportBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Buscando dados…';
  }

  try {
    const users = await fetchAllFilteredUsers(window.__USER_ACCESS_TOKEN__ || "");

    if (!users.length) {
      alert("Nenhum usuário encontrado com os filtros atuais.");
      return;
    }

    const buildRow = (u) => {
      const regiao = parseRegion(u.regiao);
      return {
        "Nome":             u.name               || "",
        "E-mail":           u.email              || "",
        "CPF/CNPJ":         u.cpf                || "",
        "WhatsApp":         u.whatsapp           || "",
        "CEP":              regiao.cep           || u.cep || "",
        "Cidade":           regiao.cidade        || "",
        "Estado":           regiao.estado        || "",
        "Acesso Protocolo": u.protocol           ? "Sim" : "Não",
        "Cliente Avance":   u.cliente_avance     ? "Sim" : "Não",
        "Telefonia ativa":  u.has_mobile_service ? "Sim" : "Não",
        "Tipo de contrato": u.contract_type      || "",
        "Operadora":        u.operator           || "",
        "Linhas ativas":    Number.isFinite(u.active_lines) ? u.active_lines : "",
      };
    };

    const rows      = users.map(buildRow);
    const ws        = XLSX.utils.json_to_sheet(rows);
    const colWidths = Object.keys(rows[0]).map((key) => ({
      wch: Math.min(Math.max(key.length, ...rows.map((r) => String(r[key] ?? "").length)) + 2, 40),
    }));
    ws["!cols"] = colWidths;

    const wb    = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Usuários");

    const now   = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    XLSX.writeFile(wb, `usuarios_avance_${stamp}.xlsx`);
  } catch (e) {
    alert(e?.message || "Erro ao exportar.");
  } finally {
    if (exportBtn) {
      exportBtn.disabled = false;
      exportBtn.innerHTML = '<i class="ph ph-microsoft-excel-logo"></i> Exportar para Excel';
    }
  }
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

  const close = () => {
    menu.hidden = true;
  };

  const open = () => {
    menu.hidden = false;
  };

  const toggle = () => {
    if (menu.hidden) open();
    else close();
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });

  document.addEventListener("click", (e) => {
    const userbar = document.getElementById("sidebar-userbar");
    if (!userbar?.contains(e.target)) {
      close();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close();
    }
  });
}

function initMobileSidebar(menuBtn) {
  if (!menuBtn) return;

  menuBtn.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-open");
  });

  document.addEventListener("click", (e) => {
    if (!document.body.classList.contains("sidebar-open")) return;

    const sidebar = document.querySelector(".sidebar");
    if (!sidebar?.contains(e.target) && !menuBtn.contains(e.target)) {
      document.body.classList.remove("sidebar-open");
    }
  });
}

function initTheme(themeToggle) {
  if (!themeToggle) return;

  const savedTheme = localStorage.getItem("theme");
  const isLight = savedTheme === "light";

  document.body.classList.toggle("light-mode", isLight);
  document.body.classList.remove("dark-mode");
  updateThemeIcon(themeToggle);

  themeToggle.addEventListener("click", () => {
    const nowLight = document.body.classList.toggle("light-mode");
    document.body.classList.remove("dark-mode");
    localStorage.setItem("theme", nowLight ? "light" : "dark");
    updateThemeIcon(themeToggle);
  });
}

function updateThemeIcon(btn) {
  const icon = btn?.querySelector("i");
  const text = btn?.querySelector("span");
  const logo = document.querySelector(".company-logo");

  if (!icon || !text) return;

  const isLight = document.body.classList.contains("light-mode");

  if (isLight) {
    icon.className = "ph ph-moon";
    text.textContent = "Modo escuro";
  } else {
    icon.className = "ph ph-sun";
    text.textContent = "Modo claro";
  }

  if (logo) {
    logo.src = !isLight
      ? "../img/LogoEscuroSemFundo.png"
      : "../img/LogoClaraSemFundo.png";
  }
}