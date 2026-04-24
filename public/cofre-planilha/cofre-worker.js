const DB_NAME = "CofrePlanilhasDB";
const DB_VERSION = 3;
const STORE_META = "planilhas_meta";
const STORE_DADOS = "planilhas_dados";

function abrirDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = () => reject("Erro ao abrir DB no Worker");
  });
}

function detectDelimiter(text) {
  const firstLine = text.split('\n')[0] || "";
  const commas = (firstLine.match(/,/g) || []).length;
  const semicolons = (firstLine.match(/;/g) || []).length;
  return semicolons > commas ? ';' : ',';
}

function parseCSVLine(text, delimiter) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    if (inQuotes) {
      if (char === '"' && nextChar === '"') { field += '"'; i++; }
      else if (char === '"') inQuotes = false;
      else field += char;
    } else {
      if (char === '"') inQuotes = true;
      else if (char === delimiter) { fields.push(field.trim()); field = ''; }
      else field += char;
    }
  }
  fields.push(field.trim());
  return fields;
}

// ── INFERÊNCIA DE TIPOS ───────────────────────────────────
function inferirEsquema(amostra, colunas) {
  const schema = {};
  colunas.forEach(col => {
    const valores = amostra.map(row => String(row[col] || "").trim()).filter(v => v !== "");
    if (valores.length === 0) {
      schema[col] = { type: "text" };
      return;
    }

    // Testar Data
    const dataMeta = testarData(valores);
    if (dataMeta) {
      schema[col] = { type: "date", format: dataMeta };
      return;
    }

    // Testar Número
    const numMeta = testarNumero(valores);
    if (numMeta) {
      schema[col] = { type: "number", decimal: numMeta };
      return;
    }

    schema[col] = { type: "text" };
  });
  return schema;
}

function testarData(valores) {
  const regexIso = /^\d{4}-\d{2}-\d{2}/;
  const regexBrEn = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;
  
  let possivelBr = 0; // DD/MM
  let possivelEn = 0; // MM/DD
  let isIso = 0;

  for (const v of valores.slice(0, 100)) {
    if (regexIso.test(v)) { isIso++; continue; }
    const match = v.match(regexBrEn);
    if (match) {
      const p1 = parseInt(match[1]);
      const p2 = parseInt(match[2]);
      if (p1 > 12) possivelBr++;
      if (p2 > 12) possivelEn++;
    } else {
      return null; // Se um valor não parece data, a coluna toda não é
    }
  }

  if (isIso > 0) return "YYYY-MM-DD";
  if (possivelEn > 0 && possivelBr === 0) return "MM/DD/YYYY";
  return "DD/MM/YYYY"; // Default para Brasil ou se ambíguo
}

function testarNumero(valores) {
  let virgulas = 0;
  let pontos = 0;
  let numericCount = 0;

  for (const v of valores.slice(0, 100)) {
    // Remove símbolos de moeda e espaços
    const clean = v.replace(/[R$\s]/g, "");
    if (/^-?\d+([.,]\d+)?$/.test(clean)) {
      numericCount++;
      if (clean.includes(",")) virgulas++;
      if (clean.includes(".")) pontos++;
    }
  }

  if (numericCount < valores.slice(0, 100).length * 0.8) return null;

  // Se tem mais vírgulas que pontos como separador único, ou se tem padrão 1.000,00
  if (virgulas > 0) return ",";
  return ".";
}

self.onmessage = async function ({ data }) {
  const { file, nome } = data;
  const CHUNK_SIZE = 10 * 1024 * 1024; 
  const BATCH_SIZE = 50000;           
  
  let offset = 0;
  let leftover = "";
  let colunas = null;
  let delimiter = null;
  let totalLinhas = 0;
  let batchBuffer = [];
  let fileId = null;
  let amostraParaSchema = [];

  try {
    const db = await abrirDB();

    fileId = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META], "readwrite");
      const req = tx.objectStore(STORE_META).add({ nome, colunas: [], schema: {} });
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => reject("Erro ao criar metadados");
    });

    while (offset < file.size) {
      const chunk = file.slice(offset, offset + CHUNK_SIZE);
      let text = await chunk.text();
      offset += CHUNK_SIZE;

      const percent = Math.min(100, Math.round((offset / file.size) * 100));
      self.postMessage({ type: 'progress', percent, msg: `Lendo arquivo: ${percent}%` });

      text = leftover + text;
      const lines = text.split(/\r?\n/);
      leftover = lines.pop();

      if (lines.length === 0) continue;
      if (!delimiter) delimiter = detectDelimiter(lines[0]);

      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i].trim();
        if (!rawLine) continue;

        const fields = parseCSVLine(rawLine, delimiter);
        
        if (!colunas) {
          colunas = fields.map(h => h || "Coluna_Sem_Nome");
        } else {
          const obj = {};
          for (let j = 0; j < colunas.length; j++) {
            obj[colunas[j]] = fields[j] !== undefined ? fields[j] : "";
          }
          batchBuffer.push(obj);
          if (amostraParaSchema.length < 200) amostraParaSchema.push(obj);
          totalLinhas++;

          if (batchBuffer.length >= BATCH_SIZE) {
            await salvarLote(db, fileId, batchBuffer);
            batchBuffer = [];
          }
        }
      }
    }

    if (leftover.trim()) {
      const fields = parseCSVLine(leftover.trim(), delimiter);
      if (colunas) {
        const obj = {};
        for (let j = 0; j < colunas.length; j++) {
          obj[colunas[j]] = fields[j] !== undefined ? fields[j] : "";
        }
        batchBuffer.push(obj);
        totalLinhas++;
      }
    }

    if (batchBuffer.length > 0) {
      await salvarLote(db, fileId, batchBuffer);
      batchBuffer = [];
    }

    // Gerar Schema baseado na amostra
    const schema = inferirEsquema(amostraParaSchema, colunas);

    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META], "readwrite");
      const store = tx.objectStore(STORE_META);
      const req = store.get(fileId);
      req.onsuccess = () => {
        const data = req.result;
        data.colunas = colunas;
        data.schema = schema;
        store.put(data);
        tx.oncomplete = resolve;
      };
      req.onerror = reject;
    });

    self.postMessage({ ok: true, id: fileId, colunas, schema, linhas: totalLinhas });

  } catch (err) {
    console.error(err);
    self.postMessage({ ok: false, error: err.message });
  }
};

function salvarLote(db, fileId, dados) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_DADOS], "readwrite");
    const store = tx.objectStore(STORE_DADOS);
    store.add({ fileId, dados });
    tx.oncomplete = resolve;
    tx.onerror = () => reject("Erro ao salvar lote no banco");
  });
}
