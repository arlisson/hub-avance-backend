importScripts('./xlsx.min.js');

self.onmessage = function ({ data }) {
  const { buffer } = data;
  try {
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const dados = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    self.postMessage({ ok: true, dados });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};
