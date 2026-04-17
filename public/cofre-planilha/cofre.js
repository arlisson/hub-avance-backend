// Gera ou recupera session_id persistido no localStorage
let sessionId = localStorage.getItem("cofre_session_id");
if (!sessionId) {
  sessionId = crypto.randomUUID();
  localStorage.setItem("cofre_session_id", sessionId);
}

const headers = () => ({ "x-session-id": sessionId });

// DOM refs
const uploadArea  = document.getElementById("upload-area");
const fileInput   = document.getElementById("file-input");
const uploadStatus = document.getElementById("upload-status");
const fileList    = document.getElementById("file-list");
const selColuna   = document.getElementById("sel-coluna");
const inpValor    = document.getElementById("inp-valor");
const btnBuscar   = document.getElementById("btn-buscar");
const resultsHeader = document.getElementById("results-header");
const resultsCount  = document.getElementById("results-count");
const btnExport   = document.getElementById("btn-export");
const tableWrapper  = document.getElementById("table-wrapper");

// ── SESSÃO ──────────────────────────────────────────────
window.addEventListener("beforeunload", () => {
  navigator.sendBeacon(
    "/api/planilhas",
    new Blob([JSON.stringify({})], { type: "application/json" })
  );
});

// Alternativa mais confiável: fetch keepalive
window.addEventListener("beforeunload", () => {
  fetch("/api/planilhas", {
    method: "DELETE",
    headers: { ...headers() },
    keepalive: true,
  }).catch(() => {});
});

// ── UPLOAD ──────────────────────────────────────────────
uploadArea.addEventListener("click", () => fileInput.click());

uploadArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadArea.classList.add("drag-over");
});
uploadArea.addEventListener("dragleave", () => uploadArea.classList.remove("drag-over"));
uploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadArea.classList.remove("drag-over");
  handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener("change", () => handleFiles(fileInput.files));

async function handleFiles(files) {
  for (const file of files) {
    setStatus("Enviando " + file.name + "…", "");
    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch("/api/planilhas/upload", {
        method: "POST",
        headers: headers(),
        body: fd,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setStatus(`${file.name} carregado (${data.linhas} linhas)`, "ok");
    } catch (err) {
      setStatus("Erro: " + err.message, "err");
    }
  }
  fileInput.value = "";
  await carregarLista();
  await carregarColunas();
}

function setStatus(msg, tipo) {
  uploadStatus.textContent = msg;
  uploadStatus.className = "upload-status" + (tipo ? " " + tipo : "");
}

// ── LISTA DE PLANILHAS ──────────────────────────────────
async function carregarLista() {
  try {
    const res = await fetch("/api/planilhas", { headers: headers() });
    const data = await res.json();
    if (!data.ok) return;

    fileList.innerHTML = "";

    if (!data.planilhas.length) {
      fileList.innerHTML = '<li class="file-list-empty">Nenhuma planilha carregada.</li>';
      return;
    }

    for (const p of data.planilhas) {
      const li = document.createElement("li");
      li.className = "file-item";
      li.innerHTML = `
        <i class="ph ph-file-xls" style="color:var(--accent);flex-shrink:0"></i>
        <span class="file-item-name" title="${p.nome_arquivo}">${p.nome_arquivo}</span>
        <button class="btn-delete-file" data-id="${p.id}" title="Remover">
          <i class="ph ph-trash"></i>
        </button>
      `;
      fileList.appendChild(li);
    }

    fileList.querySelectorAll(".btn-delete-file").forEach((btn) => {
      btn.addEventListener("click", () => deletarPlanilha(Number(btn.dataset.id)));
    });
  } catch {}
}

async function deletarPlanilha(id) {
  await fetch(`/api/planilhas/${id}`, { method: "DELETE", headers: headers() }).catch(() => {});
  await carregarLista();
  await carregarColunas();
}

// ── COLUNAS ─────────────────────────────────────────────
async function carregarColunas() {
  try {
    const res = await fetch("/api/planilhas/colunas", { headers: headers() });
    const data = await res.json();
    if (!data.ok) return;

    const valorAtual = selColuna.value;
    selColuna.innerHTML = '<option value="">-- Todas as colunas --</option>';
    for (const col of data.colunas) {
      const opt = document.createElement("option");
      opt.value = col;
      opt.textContent = col;
      selColuna.appendChild(opt);
    }
    if (valorAtual) selColuna.value = valorAtual;
  } catch {}
}

// ── BUSCA ────────────────────────────────────────────────
btnBuscar.addEventListener("click", buscar);
inpValor.addEventListener("keydown", (e) => { if (e.key === "Enter") buscar(); });

async function buscar() {
  const coluna = selColuna.value;
  const valor  = inpValor.value.trim();

  tableWrapper.innerHTML = '<p class="table-placeholder">Buscando…</p>';
  resultsHeader.hidden = true;

  try {
    const params = new URLSearchParams();
    if (coluna) params.set("coluna", coluna);
    if (valor)  params.set("valor", valor);

    const res = await fetch(`/api/planilhas/buscar?${params}`, { headers: headers() });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    renderTabela(data.resultados, data.total);
  } catch (err) {
    tableWrapper.innerHTML = `<p class="table-placeholder" style="color:var(--danger)">${err.message}</p>`;
  }
}

function renderTabela(rows, total) {
  if (!rows.length) {
    tableWrapper.innerHTML = '<p class="table-placeholder">Nenhum resultado encontrado.</p>';
    resultsHeader.hidden = true;
    return;
  }

  resultsCount.textContent = `${total} resultado${total !== 1 ? "s" : ""} encontrado${total !== 1 ? "s" : ""}`;
  resultsHeader.hidden = false;

  const colunas = Object.keys(rows[0]);
  const table = document.createElement("table");
  table.className = "results-table";

  const thead = document.createElement("thead");
  const trHead = document.createElement("tr");
  for (const col of colunas) {
    const th = document.createElement("th");
    th.textContent = col;
    trHead.appendChild(th);
  }
  thead.appendChild(trHead);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const col of colunas) {
      const td = document.createElement("td");
      td.textContent = row[col] ?? "";
      td.title = String(row[col] ?? "");
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  tableWrapper.innerHTML = "";
  tableWrapper.appendChild(table);
}

// ── EXPORTAR ────────────────────────────────────────────
btnExport.addEventListener("click", () => {
  const coluna = selColuna.value;
  const valor  = inpValor.value.trim();
  const params = new URLSearchParams();
  if (coluna) params.set("coluna", coluna);
  if (valor)  params.set("valor", valor);

  const a = document.createElement("a");
  a.href = `/api/planilhas/exportar?${params}&sid=${encodeURIComponent(sessionId)}`;
  a.click();
});

// O fetch com header não funciona para download direto — adicionar session via query param
// já foi tratado acima; atualizar o controller para ler de req.query.sid também:

// ── INIT ────────────────────────────────────────────────
carregarLista();
carregarColunas();
