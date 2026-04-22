const DB_NAME    = "CofrePlanilhasDB";
const DB_VERSION = 2;
const STORE_META  = "planilhas_meta";
const STORE_DADOS = "planilhas_dados";

function abrirDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains(STORE_DADOS)) db.createObjectStore(STORE_DADOS, { keyPath: "id" });
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror   = () => reject("Erro ao abrir DB no Worker");
  });
}

function detectDelimiter(text) {
  // Pega a primeira linha para analisar se tem mais vírgulas ou ponto e vírgulas
  const firstLine = text.split('\n')[0] || "";
  const commas = (firstLine.match(/,/g) || []).length;
  const semicolons = (firstLine.match(/;/g) || []).length;
  return semicolons > commas ? ';' : ',';
}

function parseCSV(text) {
  const delimiter = detectDelimiter(text);
  const lines = [];
  let currentLine = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    let char = text[i];
    let nextChar = text[i + 1];
    
    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"';
        i++; // pula a próxima aspa escapada
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        currentLine.push(currentField);
        currentField = '';
      } else if (char === '\n' || char === '\r') {
        currentLine.push(currentField);
        // Ignora linhas totalmente vazias
        if (currentLine.join('').trim() !== '') {
            lines.push(currentLine);
        }
        currentLine = [];
        currentField = '';
        if (char === '\r' && nextChar === '\n') i++; // lida com quebra de linha do Windows
      } else {
        currentField += char;
      }
    }
  }
  
  // Pega o último campo se o arquivo não terminar com quebra de linha
  if (currentField !== '' || currentLine.length > 0) {
    currentLine.push(currentField);
    if (currentLine.join('').trim() !== '') {
       lines.push(currentLine);
    }
  }
  
  return lines;
}

function formatarParaJSON(linhasCSV) {
  if (linhasCSV.length < 2) return { colunas: [], dados: [] };
  
  // A primeira linha são os cabeçalhos
  const colunas = linhasCSV[0].map(h => h.trim());
  const dados = [];
  
  // As demais são os dados
  for (let i = 1; i < linhasCSV.length; i++) {
    const obj = {};
    for (let j = 0; j < colunas.length; j++) {
      // Garante que o cabeçalho exista (evita colunas sem nome)
      const headerName = colunas[j] || `Coluna_${j+1}`; 
      obj[headerName] = linhasCSV[i][j] !== undefined ? linhasCSV[i][j].trim() : '';
    }
    dados.push(obj);
  }
  
  return { colunas, dados };
}

self.onmessage = async function ({ data }) {
  const { file, nome } = data;
  
  try {
    // Lê o arquivo diretamente como texto
    const text = await file.text();
    
    // Processa o CSV
    const linhasBrutas = parseCSV(text);
    const { colunas, dados } = formatarParaJSON(linhasBrutas);

    if (!dados.length) {
      self.postMessage({ ok: false, error: "Arquivo CSV está vazio ou sem dados válidos." });
      return;
    }

    // Salva no banco de dados local
    const db = await abrirDB();
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META, STORE_DADOS], "readwrite");
      const metaStore = tx.objectStore(STORE_META);
      const dadosStore = tx.objectStore(STORE_DADOS);

      const req = metaStore.add({ nome, colunas });
      req.onsuccess = (e) => {
        const id = e.target.result;
        dadosStore.add({ id, dados });
        tx.oncomplete = () => resolve({ id, colunas, linhas: dados.length });
      };
      req.onerror = () => reject("Erro ao salvar no banco local do navegador.");
    });

    self.postMessage({ ok: true, ...result });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};