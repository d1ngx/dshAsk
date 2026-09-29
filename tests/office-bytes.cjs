'use strict';
const assert = require('node:assert/strict');

(async () => {
  const { buildBinaryZip, readZipEntries, replaceSheetData, upsertCell, addWorkbookSheet } = await import('../integrations/kodbox-file/office-bytes.js');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xd8]);
  const xml = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><w:t>中文</w:t>', 'utf8');
  const zip = buildBinaryZip([
    { name: 'word/media/image1.png', data: png },
    { name: 'word/document.xml', data: xml }
  ]);
  const entries = readZipEntries(zip);
  const image = entries.find((entry) => entry.name === 'word/media/image1.png');
  const document = entries.find((entry) => entry.name === 'word/document.xml');
  assert.deepEqual(image.data, png);
  assert.equal(document.data.toString('utf8'), xml.toString('utf8'));
  const copied = buildBinaryZip([
    { name: image.name, method: image.method, compressed: image.compressed, uncompressedSize: image.uncompressedSize, crc: image.crc },
    { name: 'word/document.xml', data: Buffer.from(xml.toString('utf8') + '<w:t>更多</w:t>', 'utf8') }
  ]);
  const again = readZipEntries(copied);
  assert.deepEqual(again.find((entry) => entry.name === 'word/media/image1.png').data, png);
  assert.match(again.find((entry) => entry.name === 'word/document.xml').data.toString('utf8'), /更多/);

  const worksheet = '<worksheet><dimension ref="A1"/><sheetData><row r="1"><c r="A1" s="3"><v>1</v></c></row></sheetData><drawing r:id="rId1"/></worksheet>';
  const replacement = '<?xml version="1.0"?><worksheet><dimension ref="A1:B1"/><sheetData><row r="1"><c r="A1"><v>2</v></c></row></sheetData></worksheet>';
  const replaced = replaceSheetData(worksheet, replacement);
  assert.match(replaced, /<drawing r:id="rId1"\/>/);
  assert.match(replaced, /<dimension ref="A1:B1"\/>/);
  const patched = upsertCell(replaced, 'B2', '中文');
  assert.match(patched, /<drawing r:id="rId1"\/>/);
  assert.match(patched, /<t xml:space="preserve">中文<\/t>/);
  const styled = upsertCell(worksheet, 'A1', '改');
  assert.match(styled, /<c r="A1" s="3" t="inlineStr">/);
  assert.doesNotMatch(styled, /<v>1<\/v>/);

  const added = addWorkbookSheet({
    workbook: '<workbook xmlns:r="r"><sheets><sheet name="旧" sheetId="1" r:id="rId1"/></sheets></workbook>',
    rels: '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    types: '<Types></Types>'
  }, '新表', '<worksheet><sheetData/></worksheet>');
  assert.match(added.workbook, /name="旧"/);
  assert.match(added.workbook, /name="新表"/);
  assert.equal(added.part, 'xl/worksheets/sheet2.xml');
  assert.match(added.types, /sheet2\.xml/);
  console.log('Office bytes: binary parts, UTF-8 text, sheet drawings and styled cells round-trip');
})().catch((error) => { console.error(error); process.exitCode = 1; });
