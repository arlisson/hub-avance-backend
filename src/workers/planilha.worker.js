import ExcelJS from "exceljs";

function extrairValorCelula(val) {
  if (val == null) return "";
  if (typeof val === "object" && "result" in val) return val.result ?? "";
  if (val instanceof Date) return val.toLocaleString("pt-BR");
  return val;
}

export default async function ({ filePath }) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    worksheets: "emit",
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    entries: "emit",
  });

  const dados = [];
  let headers = null;

  await new Promise((resolve, reject) => {
    workbook.on("worksheet", (sheet) => {
      sheet.on("row", (row) => {
        const values = row.values.slice(1);
        if (!headers) {
          headers = values.map((v) => (v == null ? "" : String(v)));
          return;
        }
        const obj = {};
        headers.forEach((h, i) => { obj[h] = extrairValorCelula(values[i]); });
        dados.push(obj);
      });
    });
    workbook.on("end", resolve);
    workbook.on("error", reject);
    workbook.read().catch(reject);
  });

  return dados;
}
