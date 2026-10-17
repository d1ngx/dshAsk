'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
(async () => {
  const security = await import('../integrations/kodbox-file/office-package.js');
  const { readZipEntries, buildBinaryZip } = await import('../integrations/kodbox-file/office-bytes.js');
  const filename = path.resolve('integrations/kodbox-file/vendor/dsh-office-tools/index.js');
  const context = vm.createContext({ Buffer, TextEncoder, TextDecoder, console });
  const modules = new Map();
  async function synthetic(key, values) {
    const module = new vm.SyntheticModule(Object.keys(values), function () { for (const [name, value] of Object.entries(values)) this.setExport(name, value); }, { context });
    modules.set(key, module); return module;
  }
  async function load(file) {
    if (modules.has(file)) return modules.get(file);
    let source = await fs.readFile(file, 'utf8');
    if (file === filename) source += '\nexport { buildDocxText, buildXlsxText, buildPptxText, sheetXml, gridOf };';
    const module = new vm.SourceTextModule(source, { context, identifier: file }); modules.set(file, module);
    await module.link(async (specifier, parent) => {
      if (modules.has(specifier)) return modules.get(specifier);
      if (specifier.startsWith('node:')) return synthetic(specifier, await import(specifier));
      if (specifier === '@deepseek-ai/dsh-tools') return synthetic(specifier, { defineTool: value => value });
      if (specifier === '@deepseek-ai/schemastery') return synthetic(specifier, { default: (await import(require('node:module').createRequire(path.resolve('.dsh-runtime/package.json')).resolve('@deepseek-ai/schemastery'))).default });
      if (specifier.endsWith('spreadsheet-read.js')) return synthetic(specifier, { readSpreadsheet() {} });
      return load(path.resolve(path.dirname(parent.identifier), specifier));
    }); return module;
  }
  const module = await load(filename); await module.evaluate();
  const b = module.namespace;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'office-package-'));
  const args = { title: '中文 & 标题\uFFFE\uD800', paragraphs: ['山静云初白 <测试>'], bullets: ['第一项'], table: { headers: ['列'], rows: [['值']] } };
  const word = Buffer.from(b.buildDocxText(args), 'utf8');
  const xlsx = Buffer.from(b.buildXlsxText(['诗词', '数据'].map((name, i) => ({ name, part: `worksheets/sheet${i+1}.xml`, content: b.sheetXml(b.gridOf([['中文', true, 42], [null, '=SUM(C1:C1)']])) }))), 'utf8');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64');
  const ctx = { fs: { async resolve(p) { return path.resolve('/tmp', p); }, contains() { return true; }, processPath(p) { return p; }, async stat() { return { type: 'file', size: png.length }; }, async readBytes() { return png; } } };
  const exec = { signal: new AbortController().signal, cwd: '/tmp', agent: { session: { header: { cwd: '/tmp' } } } };
  const ppt = await b.buildPptxText({ title: '封面', slides: [{ title: '无备注' }, { title: '有备注', notes: '仅第三页有备注' }] }, exec, ctx, { absolute: '/tmp/deck.pptx' });
  // A separate image fixture exercises actual binary embedding and internal relationships.
  const imagePpt = await b.buildPptxText({ slides: [{ title: '图片', images: [{ path: '/tmp/pixel.png', w: 1, h: 1 }] }] }, exec, ctx, { absolute: '/tmp/deck.pptx' });
  for (const [name, data] of [['test.docx', word], ['test.xlsx', xlsx], ['test.pptx', ppt.bytes], ['image.pptx', imagePpt.bytes]]) {
    assert.equal(security.validateOfficePackage(data), true); await fs.writeFile(path.join(dir, name), data);
  }
  const images = readZipEntries(imagePpt.bytes);
  assert.deepEqual(images.find(part => part.name.startsWith('ppt/media/')).data, png);
  assert.match(images.find(part => part.name === 'ppt/slides/slide1.xml').data.toString(), /r:embed=/);
  assert.doesNotMatch(images.find(part => part.name.endsWith('slide1.xml.rels')).data.toString(), /TargetMode="External"/);
  const toolCtx = { ...ctx, fs: { ...ctx.fs, async stat(target) { return target.endsWith('.png') ? { type: 'file', size: png.length } : undefined; } } };
  // Register against the real output filesystem path, then exercise the public tool.
  const toolMap = new Map();
  module.namespace.apply({ ...toolCtx, effect(fn) { fn(); }, tools: { register(tool) { toolMap.set(tool.name, tool); return () => {}; } } }, { enablePptTools: true });
  const created = await toolMap.get('ppt_create').execute({ path: path.join(dir, 'public.pptx'), slides: [{ title: '真实写入', notes: '备注', images: [{ path: path.join(dir, 'pixel.png'), w: 1, h: 1 }] }] }, { ...exec, agent: { session: { header: { cwd: dir } } } });
  assert(created.sizeBytes > png.length);
  security.validateOfficePackage(await fs.readFile(path.join(dir, 'public.pptx')));
  for (const [tool, arguments_] of [
    ['word_create', { path: path.join(dir, 'public.docx'), title: '中文测试', paragraphs: ['正文'] }],
    ['excel_create', { path: path.join(dir, 'public.xlsx'), sheets: [{ name: '测试', rows: [['中文', 1], ['内容', true]] }] }]
  ]) {
    await toolMap.get(tool).execute(arguments_, { ...exec, agent: { session: { header: { cwd: dir } } } });
    const bytes = await fs.readFile(arguments_.path);
    security.validateOfficePackage(bytes);
    assert(readZipEntries(bytes).some(part => part.method === 8), 'standard binary ZIP compression is used');
  }
  const entries = readZipEntries(xlsx);
  const corrupted = entries.map(part => part.name === '[Content_Types].xml' ? { ...part, data: Buffer.from(part.data.toString().replace(/<Override PartName="\/xl\/worksheets\/sheet1.xml"[^>]*\/>/, '')) } : part);
  assert.throws(() => security.validateOfficePackage(buildBinaryZip(corrupted.map(({name,data})=>({name,data})))), /内容类型/);
  const missingTarget = entries.filter(part => part.name !== 'xl/worksheets/sheet2.xml');
  assert.throws(() => security.validateOfficeParts(missingTarget), /不存在/);
  const check = spawnSync('python3', ['-c', `
import sys,zipfile,pathlib,xml.etree.ElementTree as E
for p in pathlib.Path(sys.argv[1]).iterdir():
 with zipfile.ZipFile(p) as z:
  assert z.testzip() is None
  assert all(not i.extra and not i.comment for i in z.infolist())
  for info in z.infolist():
   z.fp.seek(info.header_offset)
   assert z.fp.read(4)==b'PK\x03\x04'
  for n in z.namelist():
   if n.endswith(('.xml','.rels')): E.fromstring(z.read(n))
  if p.suffix == '.xlsx':
   rel=E.fromstring(z.read('xl/_rels/workbook.xml.rels'))
   assert any(e.attrib['Type'].endswith('/styles') for e in rel)
  if p.suffix == '.pptx':
   for n in z.namelist():
    if n.startswith('ppt/theme/'):
     root=E.fromstring(z.read(n))
     for stops in root.findall('.//{http://schemas.openxmlformats.org/drawingml/2006/main}gsLst'): assert len(stops)>=2
   types=E.fromstring(z.read('[Content_Types].xml'))
   declared={e.attrib.get('PartName') for e in types}
   for n in z.namelist():
    if n.startswith('ppt/notesSlides/') and n.endswith('.xml'): assert '/'+n in declared
print('Independent XML parser and ZIP CRC checks passed')
`, dir], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  console.log(check.stdout.trim()); console.log('Office package fixtures:', dir);
})().catch(error => { console.error(error); process.exitCode = 1; });
