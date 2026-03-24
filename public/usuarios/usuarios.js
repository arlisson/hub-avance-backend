let searchEl = null;
let errorBox = null;
let appUsageErrorBox = null;
let currentView = "users";

// Paginação
const PAGE_SIZE = 25;
let currentPage = 1;
let totalUsers = 0;

// Filtros
let filterClienteEl = null;
let filterTelefoniaEl = null;
let filterLinhasEl = null;
let filterContratoEl = null;
let filterOperadoraEl = null; // mantido por compatibilidade
let selectedOperadoras = new Set();

// Debounce do campo de busca
let searchDebounceTimer = null;

const LOGIN_URL = "/login/login.html";
const HUB_URL = "/hub/hub.html";

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

function getAccessToken() {
  return (
    localStorage.getItem("auth_token") ||
    sessionStorage.getItem("auth_token") ||
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    sessionStorage.getItem("authToken") ||
    localStorage.getItem("access_token") ||
    sessionStorage.getItem("access_token") ||
    ""
  );
}

function clearAuthToken() {
  ["auth_token", "token", "authToken", "access_token"].forEach((key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });
}

async function apiFetch(url, options = {}) {
  const token = window.__USER_ACCESS_TOKEN__ || getAccessToken();

  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const err = new Error(
      data?.error || data?.detail || `Erro HTTP ${response.status}`
    );
    err.status = response.status;
    err.data = data;

    if (response.status === 401) {
      clearAuthToken();
    }

    throw err;
  }

  return data;
}

function buildQueryParams(page, limit) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", String(limit));

  const search = (searchEl?.value || "").trim();
  if (search) params.set("search", search);

  if (filterClienteEl?.value) {
    params.set("cliente_avance", filterClienteEl.value);
  }

  if (filterTelefoniaEl?.value) {
    params.set("has_mobile_service", filterTelefoniaEl.value);
  }

  if (filterLinhasEl?.value) {
    params.set("active_lines", filterLinhasEl.value);
  }

  if (filterContratoEl?.value) {
    params.set("contract_type", filterContratoEl.value);
  }

  // Mantém compatibilidade:
  // 1) envia múltiplos "operator" para o modelo novo de filtro melhorado
  // 2) se nada estiver selecionado no multiselect, cai no select simples antigo
  if (selectedOperadoras.size > 0) {
    selectedOperadoras.forEach((op) => params.append("operator", op));
  } else if (filterOperadoraEl?.value) {
    params.set("operador", filterOperadoraEl.value);
  }

  return params;
}

function applyFiltersAndReload() {
  currentPage = 1;
  loadUsers(1, true);
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
  const to = Math.min(page * pageSize, total);

  el.textContent = `Exibindo ${from}–${to} de ${total.toLocaleString("pt-BR")} usuário${total !== 1 ? "s" : ""}`;
}

function updateFilterBadge() {
  const countEl = document.getElementById("filter-active-count");
  const clearBtn = document.getElementById("btn-clear-filters");

  const active = [
    filterClienteEl?.value,
    filterTelefoniaEl?.value,
    filterLinhasEl?.value,
    filterContratoEl?.value,
    selectedOperadoras.size > 0 ? "1" : filterOperadoraEl?.value,
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
        loadUsers(targetPage, false);
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
  searchEl = document.getElementById("search");
  errorBox = document.getElementById("errorBox");
  appUsageErrorBox = document.getElementById("appUsageErrorBox");

  try {
    await withLoading(
      "Carregando usuários",
      "Validando acesso e buscando dados...",
      async () => {
        const token = getAccessToken();

        if (!token) {
          window.location.href = LOGIN_URL;
          return;
        }

        window.__USER_ACCESS_TOKEN__ = token;

        const profileResponse = await apiFetch("/api/me", {
          method: "GET",
        });

        const profile = profileResponse?.user || profileResponse || {};

        const hasAccess =
          profile?.role === "admin" ||
          profile?.role === "Administrador" ||
          profile?.protocol === true;

        if (!hasAccess) {
          alert("Você não tem permissão para acessar esta tela.");
          window.location.href = HUB_URL;
          return;
        }

        const email = profile?.email || "";

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
            clearAuthToken();
            window.location.href = LOGIN_URL;
          });
        }

        document
          .getElementById("btn-refresh-app-usage")
          ?.addEventListener("click", async () => {
            await loadAppUsageDashboard(true);
          });

        searchEl?.addEventListener("input", () => {
          clearTimeout(searchDebounceTimer);
          searchDebounceTimer = setTimeout(() => applyFiltersAndReload(), 350);
        });

        filterClienteEl = document.getElementById("filter-cliente");
        filterTelefoniaEl = document.getElementById("filter-telefonia");
        filterLinhasEl = document.getElementById("filter-linhas");
        filterContratoEl = document.getElementById("filter-contrato");
        filterOperadoraEl = document.getElementById("filter-operadora");

        [filterClienteEl, filterTelefoniaEl, filterLinhasEl, filterContratoEl]
          .forEach((el) => el?.addEventListener("change", () => applyFiltersAndReload()));

        // Compatibilidade com select simples antigo, se ele ainda existir na tela
        filterOperadoraEl?.addEventListener("change", () => {
          if (filterOperadoraEl.value) {
            selectedOperadoras.clear();
            syncOperadoraCheckboxesFromState();
            updateOperadoraLabel();
          }
          applyFiltersAndReload();
        });

        initOperadoraMultiSelect();

        document.getElementById("btn-clear-filters")?.addEventListener("click", () => {
          if (filterClienteEl) filterClienteEl.value = "";
          if (filterTelefoniaEl) filterTelefoniaEl.value = "";
          if (filterLinhasEl) filterLinhasEl.value = "";
          if (filterContratoEl) filterContratoEl.value = "";
          if (filterOperadoraEl) filterOperadoraEl.value = "";
          if (searchEl) searchEl.value = "";

          selectedOperadoras.clear();
          syncOperadoraCheckboxesFromState();
          updateOperadoraLabel();

          applyFiltersAndReload();
        });

        document.getElementById("btn-export-excel")?.addEventListener("click", () => {
          exportFilteredUsersToExcel();
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

        updateFilterBadge();
        await loadUsers(1, false);
        await loadAppUsageDashboard(false);
      }
    );
  } catch (err) {
    console.error(err);
    setError(errorBox, err?.message || "Erro ao carregar os dados da página.");
  }
});

function initOperadoraMultiSelect() {
  const operadoraBtn = document.getElementById("filter-operadora-btn");
  const operadoraDropdown = document.getElementById("filter-operadora-dropdown");

  if (!operadoraBtn || !operadoraDropdown) return;

  operadoraBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !operadoraDropdown.hidden;
    operadoraDropdown.hidden = isOpen;
    operadoraBtn.classList.toggle("is-open", !isOpen);
  });

  operadoraDropdown.querySelectorAll("input[type='checkbox']").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) {
        selectedOperadoras.add(cb.value);
      } else {
        selectedOperadoras.delete(cb.value);
      }

      // quando usa o multiselect, limpa o select simples antigo
      if (selectedOperadoras.size > 0 && filterOperadoraEl) {
        filterOperadoraEl.value = "";
      }

      updateOperadoraLabel();
      applyFiltersAndReload();
    });
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".filter-multiselect")) {
      operadoraDropdown.hidden = true;
      operadoraBtn.classList.remove("is-open");
    }
  });

  updateOperadoraLabel();
}

function syncOperadoraCheckboxesFromState() {
  document
    .querySelectorAll("#filter-operadora-dropdown input[type='checkbox']")
    .forEach((cb) => {
      cb.checked = selectedOperadoras.has(cb.value);
    });
}

function updateOperadoraLabel() {
  const operadoraLabel = document.getElementById("filter-operadora-label");
  if (!operadoraLabel) return;

  const count = selectedOperadoras.size;

  operadoraLabel.textContent =
    count === 0
      ? "Todas"
      : count === 1
        ? [...selectedOperadoras][0]
        : `${count} selecionadas`;
}

async function loadUsers(page = 1, showLoader = true) {
  const task = async () => {
    try {
      setError(errorBox, "", true);

      const params = buildQueryParams(page, PAGE_SIZE);
      const data = await apiFetch(`/api/admin/users?${params.toString()}`, {
        method: "GET",
      });

      const users = Array.isArray(data?.users) ? data.users : [];

      totalUsers = Number.isFinite(data?.total)
        ? Number(data.total)
        : page === 1 && users.length < PAGE_SIZE
          ? users.length
          : (page - 1) * PAGE_SIZE + users.length + (users.length === PAGE_SIZE ? 1 : 0);

      currentPage = page;

      renderUsers(users);
      updateResultCount(totalUsers, page, PAGE_SIZE);
      renderPagination(totalUsers, page, PAGE_SIZE);
    } catch (e) {
      setError(errorBox, e?.message || "Erro ao carregar usuários.");
      renderUsers([]);
      updateResultCount(0, 1, PAGE_SIZE);
      renderPagination(0, 1, PAGE_SIZE);
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

async function fetchAllFilteredUsers() {
  const limit = 500;
  let page = 1;
  const results = [];

  while (true) {
    const params = buildQueryParams(page, limit);
    const data = await apiFetch(`/api/admin/users?${params.toString()}`, {
      method: "GET",
    });

    const users = Array.isArray(data?.users) ? data.users : [];
    results.push(...users);

    if (users.length < limit) break;
    page++;
  }

  return results;
}

async function fetchAllUsersWithoutFilters() {
  const savedSearch = searchEl?.value || "";
  const savedCliente = filterClienteEl?.value || "";
  const savedTelefonia = filterTelefoniaEl?.value || "";
  const savedLinhas = filterLinhasEl?.value || "";
  const savedContrato = filterContratoEl?.value || "";
  const savedOperadora = filterOperadoraEl?.value || "";
  const savedSelectedOperadoras = new Set(selectedOperadoras);

  try {
    if (searchEl) searchEl.value = "";
    if (filterClienteEl) filterClienteEl.value = "";
    if (filterTelefoniaEl) filterTelefoniaEl.value = "";
    if (filterLinhasEl) filterLinhasEl.value = "";
    if (filterContratoEl) filterContratoEl.value = "";
    if (filterOperadoraEl) filterOperadoraEl.value = "";

    selectedOperadoras.clear();
    syncOperadoraCheckboxesFromState();
    updateOperadoraLabel();

    return await fetchAllFilteredUsers();
  } finally {
    if (searchEl) searchEl.value = savedSearch;
    if (filterClienteEl) filterClienteEl.value = savedCliente;
    if (filterTelefoniaEl) filterTelefoniaEl.value = savedTelefonia;
    if (filterLinhasEl) filterLinhasEl.value = savedLinhas;
    if (filterContratoEl) filterContratoEl.value = savedContrato;
    if (filterOperadoraEl) filterOperadoraEl.value = savedOperadora;

    selectedOperadoras = new Set(savedSelectedOperadoras);
    syncOperadoraCheckboxesFromState();
    updateOperadoraLabel();
  }
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
  const users = await fetchAllUsersWithoutFilters();
  return aggregateUsageFromUsers(users);
}

function aggregateUsageFromUsers(users) {
  const totals = new Map();

  users.forEach((user) => {
    const usage =
      user?.app_usage && typeof user.app_usage === "object"
        ? user.app_usage
        : parseJsonSafe(user?.app_usage, {});

    Object.entries(usage).forEach(([appKey, appData]) => {
      const normalizedKey = String(appKey || "").trim().toLowerCase();
      const current = totals.get(normalizedKey) || {
        key: normalizedKey,
        label: getAppMeta(normalizedKey)?.label || normalizedKey,
        accesses: 0,
        updated_at: null,
      };

      current.accesses += Number(appData?.access || 0);
      totals.set(normalizedKey, current);
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
    const nome = u.nome || "";
    const cpfCnpj = u.cpf_cnpj || "";
    const operador = u.operador || "";
    const regiao = parseRegion(u.regiao);
    const cep = u.cep || regiao.cep || "";
    const cidade = u.cidade || regiao.cidade || "";
    const estado = u.estado || regiao.estado || "";
    const hasMobile = u.has_mobile_service === true;

    const summaryRow = document.createElement("tr");
    summaryRow.className = "user-summary-row";
    summaryRow.setAttribute("data-user-id", u.id);

    summaryRow.innerHTML = `
      <td>${escapeHtml(nome)}</td>
      <td>${escapeHtml(u.email || "")}</td>
      <td>${escapeHtml(cpfCnpj)}</td>
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
              <input class="input-dark-lite edit-nome" value="${escapeAttr(nome)}" />
            </div>

            <div class="field">
              <label>E-mail</label>
              <input class="input-dark-lite edit-email" value="${escapeAttr(u.email || "")}" readonly />
            </div>

            <div class="field">
              <label>CPF/CNPJ</label>
              <input class="input-dark-lite edit-cpf-cnpj" value="${escapeAttr(cpfCnpj)}" />
            </div>

            <div class="field">
              <label>WhatsApp</label>
              <input class="input-dark-lite edit-whatsapp" value="${escapeAttr(u.whatsapp || "")}" />
            </div>

            <div class="field">
              <label>CEP</label>
              <input class="input-dark-lite edit-cep" value="${escapeAttr(cep)}" />
            </div>

            <div class="field">
              <label>Cidade</label>
              <input class="input-dark-lite edit-cidade" value="${escapeAttr(cidade)}" />
            </div>

            <div class="field">
              <label>Estado</label>
              <input class="input-dark-lite edit-estado" value="${escapeAttr(estado)}" />
            </div>

            <div class="field">
              <label>Telefonia ativa</label>
              <select class="input-dark-lite edit-has-mobile-service">
                <option value="true" ${hasMobile ? "selected" : ""}>Sim</option>
                <option value="false" ${!hasMobile ? "selected" : ""}>Não</option>
              </select>
            </div>

            <div class="field">
              <label>Tipo de contrato</label>
              <input class="input-dark-lite edit-contract-type" value="${hasMobile ? escapeAttr(u.contract_type || "") : ""}" />
            </div>

            <div class="field">
              <label>Operadora</label>
              <input class="input-dark-lite edit-operador" value="${hasMobile ? escapeAttr(operador) : ""}" />
            </div>

            <div class="field">
              <label>Linhas ativas</label>
              <input class="input-dark-lite edit-active-lines" type="number" value="${
                hasMobile && Number.isFinite(Number(u.active_lines)) ? Number(u.active_lines) : ""
              }" />
            </div>
          </div>

          <div class="expand-section-title" style="margin-top: 18px;">Permissões</div>

          <div class="field">
            <div class="inline-checks">
              <label>
                <input type="checkbox" class="edit-protocol" ${u.protocol ? "checked" : ""}>
                Protocolo Agendor
              </label>

              <label>
                <input type="checkbox" class="edit-cliente-avance" ${u.cliente_avance ? "checked" : ""}>
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
    const nomeEl = detailsRow.querySelector(".edit-nome");
    const cpfCnpjEl = detailsRow.querySelector(".edit-cpf-cnpj");
    const whatsappEl = detailsRow.querySelector(".edit-whatsapp");
    const cepEl = detailsRow.querySelector(".edit-cep");
    const cidadeEl = detailsRow.querySelector(".edit-cidade");
    const estadoEl = detailsRow.querySelector(".edit-estado");
    const hasMobileServiceEl = detailsRow.querySelector(".edit-has-mobile-service");
    const contractTypeEl = detailsRow.querySelector(".edit-contract-type");
    const operadorEl = detailsRow.querySelector(".edit-operador");
    const activeLinesEl = detailsRow.querySelector(".edit-active-lines");

    const contractTypeField = contractTypeEl?.closest(".field");
    const operadorField = operadorEl?.closest(".field");
    const activeLinesField = activeLinesEl?.closest(".field");

    function syncMobileFieldsForRow() {
      const hasMobileSelected =
        String(hasMobileServiceEl?.value || "").trim().toLowerCase() === "true";

      if (contractTypeField) {
        contractTypeField.hidden = !hasMobileSelected;
        contractTypeField.style.display = hasMobileSelected ? "" : "none";
      }

      if (operadorField) {
        operadorField.hidden = !hasMobileSelected;
        operadorField.style.display = hasMobileSelected ? "" : "none";
      }

      if (activeLinesField) {
        activeLinesField.hidden = !hasMobileSelected;
        activeLinesField.style.display = hasMobileSelected ? "" : "none";
      }

      if (!hasMobileSelected) {
        if (contractTypeEl) contractTypeEl.value = "";
        if (operadorEl) operadorEl.value = "";
        if (activeLinesEl) activeLinesEl.value = "";
      }
    }

    hasMobileServiceEl?.addEventListener("change", syncMobileFieldsForRow);
    syncMobileFieldsForRow();

    btnSave?.addEventListener("click", async () => {
      btnSave.disabled = true;
      if (btnDelete) btnDelete.disabled = true;

      try {
        const hasMobileRaw = String(hasMobileServiceEl?.value || "").trim().toLowerCase();
        const hasMobileSelected = hasMobileRaw === "true";

        if (hasMobileRaw !== "true" && hasMobileRaw !== "false") {
          throw new Error("Selecione se a telefonia está ativa.");
        }

        const payload = {
          id: u.id,
          nome: (nomeEl?.value || "").trim(),
          cpf_cnpj: (cpfCnpjEl?.value || "").trim(),
          whatsapp: (whatsappEl?.value || "").trim(),
          cep: (cepEl?.value || "").trim(),
          cidade: (cidadeEl?.value || "").trim(),
          estado: (estadoEl?.value || "").trim(),
          has_mobile_service: hasMobileSelected,
          protocol: !!protocolEl?.checked,
          cliente_avance: !!clienteEl?.checked,
        };

        if (hasMobileSelected) {
          const contractTypeValue = (contractTypeEl?.value || "").trim().toUpperCase();
          const operadorValue = (operadorEl?.value || "").trim();
          const activeLinesRaw = String(activeLinesEl?.value || "").trim();

          if (contractTypeValue !== "CPF" && contractTypeValue !== "CNPJ") {
            throw new Error("Selecione um tipo de contrato válido.");
          }

          if (!operadorValue) {
            throw new Error("Informe a operadora.");
          }

          if (activeLinesRaw === "") {
            throw new Error("Informe a quantidade de linhas ativas.");
          }

          const activeLinesValue = Number(activeLinesRaw);

          if (!Number.isInteger(activeLinesValue) || activeLinesValue < 0) {
            throw new Error("Informe uma quantidade válida de linhas ativas.");
          }

          payload.contract_type = contractTypeValue;
          payload.operador = operadorValue;
          payload.active_lines = activeLinesValue;
        }

        await apiFetch("/api/admin/update-user", {
          method: "POST",
          body: JSON.stringify(payload),
        });

        await loadUsers(currentPage, false);
        await loadAppUsageDashboard(false);

        if (typeof showFeedback === "function") {
          showFeedback("Usuário atualizado com sucesso.", "success");
        }
      } catch (e) {
        alert(e?.message || "Erro ao salvar usuário.");
      } finally {
        btnSave.disabled = false;
        if (btnDelete) btnDelete.disabled = false;
      }
    });

    btnDelete?.addEventListener("click", async () => {
      const confirmed = window.confirm(
        `Tem certeza que deseja excluir o usuário "${nome || u.email || u.id}"?\n\nEssa ação não pode ser desfeita.`
      );

      if (!confirmed) return;

      btnDelete.disabled = true;
      if (btnSave) btnSave.disabled = true;

      try {
        await apiFetch("/api/admin/delete-user", {
          method: "POST",
          body: JSON.stringify({ id: u.id }),
        });

        await loadUsers(currentPage, false);
        await loadAppUsageDashboard(false);

        if (typeof showFeedback === "function") {
          showFeedback("Usuário excluído com sucesso.", "success");
        }
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
  const usage =
    appUsage && typeof appUsage === "object"
      ? appUsage
      : parseJsonSafe(appUsage, {});

  const knownKeys = Object.keys(APP_CATALOG);
  const unknownKeys = Object.keys(usage).filter((key) => !knownKeys.includes(key));
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
            <span class="usage-metric-label">${escapeHtml(metric.label)}</span>
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

function parseJsonSafe(value, fallback = {}) {
  if (value && typeof value === "object") return value;

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return fallback;
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
    const users = await fetchAllFilteredUsers();

    if (!users.length) {
      alert("Nenhum usuário encontrado com os filtros atuais.");
      return;
    }

    const buildRow = (u) => {
      const regiao = parseRegion(u.regiao);
      const hasMobile = u.has_mobile_service === true;

      return {
        "Nome": u.nome || "",
        "E-mail": u.email || "",
        "CPF/CNPJ": u.cpf_cnpj || "",
        "WhatsApp": u.whatsapp || "",
        "CEP": u.cep || regiao.cep || "",
        "Cidade": u.cidade || regiao.cidade || "",
        "Estado": u.estado || regiao.estado || "",
        "Acesso Protocolo": u.protocol ? "Sim" : "Não",
        "Cliente Avance": u.cliente_avance ? "Sim" : "Não",
        "Telefonia ativa": hasMobile ? "Sim" : "Não",
        "Tipo de contrato": hasMobile ? (u.contract_type || "") : "",
        "Operadora": hasMobile ? (u.operador || "") : "",
        "Linhas ativas": hasMobile && Number.isFinite(Number(u.active_lines)) ? Number(u.active_lines) : "",
      };
    };

    const rows = users.map(buildRow);
    const ws = XLSX.utils.json_to_sheet(rows);

    const colWidths = Object.keys(rows[0]).map((key) => ({
      wch: Math.min(
        Math.max(key.length, ...rows.map((r) => String(r[key] ?? "").length)) + 2,
        40
      ),
    }));

    ws["!cols"] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Usuários");

    const now = new Date();
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