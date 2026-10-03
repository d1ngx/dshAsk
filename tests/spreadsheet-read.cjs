const assert = require('node:assert/strict');
const XLSX = require('../integrations/kodbox-file/vendor/sheetjs/xlsx.cjs');

(async () => {
  const { readSpreadsheet } = await import('../integrations/kodbox-file/spreadsheet-read.js');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['子系统', '对接方式'], ['系统甲', '单点登录'], ['系统乙', '令牌校验']
  ]), '免登对接');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['编号'], [1]]), '说明');
  const bytes = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'biff8' }));
  assert.equal(bytes.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1');
  const result = await readSpreadsheet(bytes, '对接.xls');
  assert.deepEqual(result.sheets[0].rows[1], ['系统甲', '单点登录']);
  assert.equal(result.sheets.length, 2);
  const selected = await readSpreadsheet(bytes, '误改后缀.xlsx', { sheet: '免登对接', max_rows: 1 });
  assert.equal(selected.sheets.length, 1);
  assert.equal(selected.sheets[0].rows.length, 1);
  assert.equal(selected.sheets[0].truncated, true);
  await assert.rejects(readSpreadsheet(bytes, '对接.xls', { sheet: '不存在' }), /找不到工作表/);
  const abort = new AbortController(); abort.abort();
  assert.throws(() => readSpreadsheet(bytes, '对接.xls', {}, abort.signal), /abort/i);
  console.log('Legacy XLS: real BIFF8, Chinese cells, multiple sheets, renamed binary format, truncation and cancellation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
