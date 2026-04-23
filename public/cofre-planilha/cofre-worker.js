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

self.onmessage = async function ({ data }) {
  const { file, nome } = data;
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB para leitura de texto
  const BATCH_SIZE = 50000;           // 50k linhas para gravação no banco
  
  let offset = 0;
  let leftover = "";
  let colunas = null;
  let delimiter = null;
  let totalLinhas = 0;
  let batchBuffer = [];
  let fileId = null;

  try {
    const db = await abrirDB();

    // 1. Cria a entrada de metadados primeiro para obter o ID do arquivo
    fileId = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META], "readwrite");
      const req = tx.objectStore(STORE_META).add({ nome, colunas: [] }); // Colunas virão depois
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => reject("Erro ao criar metadados");
    });

    while (offset < file.size) {
      const chunk = file.slice(offset, offset + CHUNK_SIZE);
      let text = await chunk.text();
      offset += CHUNK_SIZE;

      // Envia progresso para a UI
      const percent = Math.round((offset / file.size) * 100);
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
          totalLinhas++;

          // Grava o lote se atingir o tamanho definido
          if (batchBuffer.length >= BATCH_SIZE) {
            await salvarLote(db, fileId, batchBuffer);
            batchBuffer = []; // Limpa RAM imediatamente
          }
        }
      }
    }

    // Processa última sobra
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

    // Salva o que sobrou no buffer
    if (batchBuffer.length > 0) {
      await salvarLote(db, fileId, batchBuffer);
      batchBuffer = [];
    }

    // Atualiza metadados com as colunas reais encontradas
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META], "readwrite");
      const store = tx.objectStore(STORE_META);
      const req = store.get(fileId);
      req.onsuccess = () => {
        const data = req.result;
        data.colunas = colunas;
        store.put(data);
        tx.oncomplete = resolve;
      };
      req.onerror = reject;
    });

    self.postMessage({ ok: true, id: fileId, colunas, linhas: totalLinhas });

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
