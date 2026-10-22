const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'word-edit-'));
  try {
    const context = vm.createContext({ Buffer, TextEncoder, TextDecoder, console });
    const modules = new Map();
    async function synthetic(key, values) {
      const m = new vm.SyntheticModule(Object.keys(values), function () { for (const [k,v] of Object.entries(values)) this.setExport(k,v); }, { context });
      modules.set(key,m); return m;
    }
    async function load(file) {
      if (modules.has(file)) return modules.get(file);
      const m = new vm.SourceTextModule(await fs.readFile(file,'utf8'), { context, identifier: file }); modules.set(file,m);
      await m.link(async (id,parent) => {
        if (modules.has(id)) return modules.get(id);
        if (id.startsWith('node:')) return synthetic(id,await import(id));
        if (id === '@deepseek-ai/dsh-tools') return synthetic(id,{defineTool:x=>x});
        if (id === '@deepseek-ai/schemastery') {
          // Only configuration assembly is stubbed; file tools and OOXML validation execute unchanged.
          const field = { default() { return this; }, description() { return this; } };
          return synthetic(id,{default:{ boolean:()=>field, object:()=>x=>({enablePptTools:true,...x}) }});
        }
        return load(path.resolve(path.dirname(parent.identifier),id));
      }); return m;
    }
    const m = await load(path.resolve('integrations/kodbox-file/vendor/dsh-office-tools/index.js')); await m.evaluate();
    const tools = new Map();
    const ctx = { tools:{register(tool){tools.set(tool.name,tool);return ()=>{};}},effect:fn=>fn(),fs:{
      resolve:async(p,o)=>path.resolve(o.cwd,p), contains:(r,t)=>!path.relative(r,t).startsWith('..'),processPath:p=>p,
      stat:async p=>fs.stat(p).then(s=>({type:s.isFile()?'file':'directory',size:s.size}),()=>undefined),readBytes:p=>fs.readFile(p)
    }};
    m.namespace.apply(ctx,{});
    const exec = { signal:new AbortController().signal,agent:{session:{header:{cwd:root}}} };
    await tools.get('word_create').execute({path:'sample.docx',title:'项目计划',paragraphs:['旧的说明','保留内容']},exec);
    const result = await tools.get('word_read').execute({path:'sample.docx',format:'paragraphs'},exec);
    const rows = JSON.parse(result.text);
    const before = await fs.readFile(path.join(root,'sample.docx'));
    await tools.get('word_update').execute({path:'sample.docx',edits:[{id:rows[1].id,expected_text:rows[1].text,action:'replace',text:'新的说明'}]},exec);
    const after = await tools.get('word_read').execute({path:'sample.docx'},exec);
    assert.match(after.text,/新的说明/); assert.doesNotMatch(after.text,/旧的说明/); assert.match(after.text,/保留内容/);
    const { readZipEntries } = await import('../integrations/kodbox-file/office-bytes.js');
    const original = readZipEntries(before), revised = readZipEntries(await fs.readFile(path.join(root,'sample.docx')));
    for (const part of original.filter(p=>p.name!=='word/document.xml')) assert.deepEqual(revised.find(p=>p.name===part.name).data,part.data);
    await assert.rejects(tools.get('word_update').execute({path:'sample.docx',edits:[{id:rows[1].id,expected_text:rows[1].text,action:'delete'}]},exec),/段落已变化/);
    console.log('Word public tools: create/read/edit, stale-edit rejection and unchanged package parts passed');
  } finally { await fs.rm(root,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
