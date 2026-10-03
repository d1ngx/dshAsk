const { parentPort, workerData } = require('node:worker_threads');
const XLSX = require('./vendor/sheetjs/xlsx.cjs');

try {
  const maxRows = Math.min(10000, Math.max(1, Math.floor(workerData.max_rows || 5000)));
  const workbook = XLSX.read(Buffer.from(workerData.bytes), {
    type: 'buffer', sheetRows: maxRows + 1, cellFormula: false,
    cellHTML: false, cellText: true, bookVBA: false
  });
  const names = workerData.sheet === undefined ? workbook.SheetNames : [workerData.sheet];
  if (names.some(name => !workbook.SheetNames.includes(name))) throw Error(`找不到工作表，可用：${workbook.SheetNames.join('、')}`);
  let cells = 0, chars = 0;
  const sheets = names.map(name => {
    const sheet = workbook.Sheets[name];
    const source = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null, blankrows: false });
    const rows = [];
    let truncated = false;
    for (const row of source) {
      const count = row.reduce((sum, value) => sum + String(value ?? '').length, 0);
      if (rows.length >= maxRows || cells + row.length > 100000 || chars + count > 200000) { truncated = true; break; }
      rows.push(row); cells += row.length; chars += count;
    }
    const fullRange = sheet['!fullref'] || sheet['!ref'];
    if (fullRange && XLSX.utils.decode_range(fullRange).e.r >= maxRows) truncated = true;
    return { name, rows, truncated };
  });
  parentPort.postMessage({ value: { path: workerData.path, sheets, sizeBytes: workerData.bytes.length } });
} catch (error) {
  parentPort.postMessage({ error: `无法解析表格：${error.message}。修改扩展名不会转换格式，请勿创建或重命名网盘副本来绕过解析。` });
}
