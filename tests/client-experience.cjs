'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let client, selected = { key: 'kodbox-u1-home-a' };
const requests = [];
let copiedText, selectionFragment;
const listeners = new Map();
let states = [], cursor = 0, effects = [], cleanups = [];
const react = {
  useState(initial) {
    const index = cursor++;
    if (!(index in states)) states[index] = initial;
    return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
  },
  useEffect(effect) { effects.push(effect); },
  useSyncExternalStore(_subscribe, read) { return read(); }
};
const jsx = (_tag, props) => props;
const context = { uiSession: { adapter: { current: { getSnapshot: () => selected, subscribe() {} } } } };
const source = fs.readFileSync('integrations/kodbox-file/client.js', 'utf8').replace('exports.apply = apply;',
  'exports.pendingEntries = pendingEntries; exports.showApiResults = showApiResults; exports.listPending = listPending; exports.registerMode = registerMode; exports.installQuestionCopy = installQuestionCopy; exports.questionParts = questionParts; exports.fileToken = fileToken; exports.insertFileChips = insertFileChips; exports.openHandoff = openHandoff; exports.selectDeliveryFiles = selectDeliveryFiles; exports.rememberCloudTitle = rememberCloudTitle; exports.cloudTitle = cloudTitle; exports.readCloudPreview = readCloudPreview; exports.setWorkspaceSwitch = setWorkspaceSwitch; exports.CurrentDirectory = CurrentDirectory; exports.CloudPreview = CloudPreview; exports.setContext = value => { ctx = value; }; exports.apply = apply;');
vm.runInNewContext(source, { document: { getElementById() { return null; }, querySelector() { return null; }, addEventListener(name, handler) { listeners.set(name, handler); }, removeEventListener(name) { listeners.delete(name); } }, TypeError, setTimeout, clearTimeout, fetch: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
  window: { getSelection: () => ({ rangeCount: 1, anchorNode: { nodeType: 1, closest: () => ({}) }, getRangeAt: () => ({ cloneContents: () => selectionFragment }) }), location: { pathname: '/dsh/' }, __ModuleLoader__: { load(definition) {
    client = definition.factory(name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : name === '@deepseek-ai/dsh-client-ui-primitives' ? { writeClipboard: async text => { copiedText = text; return true; } } : {});
  } } }
});
client.setContext(context);
assert.equal(client.pendingEntries(JSON.stringify({pending: true, id: 'a'.repeat(16), summary: '分享'})).length, 1, 'API string results retain their pending operation ID');
assert.equal(client.fileToken('@报告.docx'), '@"报告.docx"');
assert.equal(client.fileToken('@"有 空格.xlsx"'), '@"有 空格.xlsx"');
let batch;
client.insertFileChips({ addFiles(refs, ids) { batch = { refs, ids }; return true; } }, [{ mention: '@报告.docx' }]);
assert.equal(batch.refs.length, 1);
assert.equal(batch.refs[0].clipboardText, '@"报告.docx"', 'reference text remains available to native draft persistence');
assert.equal(batch.refs[0].ref, '@"报告.docx"');
let draft = '', references = [];
client.insertFileChips({ setDraft(text) { draft = text; }, state: { getSnapshot: () => ({ draftRev: 1 }) }, insertReference(ref, range) { references.push({ ref, range }); } }, [{ mention: '@报告.docx' }]);
assert.equal(draft, '@"报告.docx"\n');
assert.equal(draft.slice(references[0].range.start, references[0].range.end), '@"报告.docx"');
assert.equal(draft.slice(references[0].range.end), '\n');
assert.deepEqual(JSON.parse(JSON.stringify(client.questionParts('@"报告.docx"总结内容 200 字 docx'))), { body: '总结内容 200 字 docx', files: [{ ref: '报告.docx', name: '报告.docx' }] });
assert.equal(client.questionParts('@.uploads/id/报告.xlsx总结 200 字').body, '总结 200 字');
assert.equal(client.questionParts('普通提问 邮箱 a@b.com').body, '普通提问 邮箱 a@b.com');

const flush = () => new Promise(resolve => setImmediate(resolve));
const render = (component, props) => { cursor = 0; effects = []; return component(props); };
const mountEffects = () => { cleanups.forEach(stop => stop?.()); cleanups = effects.map(effect => effect()); };
const address = (id, path) => `dsh-resource://file/session/${id}/${encodeURIComponent(path)}`;
(async () => {
  client.rememberCloudTitle('a', '报告.docx', '项目一/报告.docx');
  client.rememberCloudTitle('b', '报告.docx', '项目二/报告.docx');
  assert.equal(client.cloudTitle(address('a', '报告.docx')), '项目一/报告.docx');
  assert.equal(client.cloudTitle(address('b', '报告.docx')), '项目二/报告.docx');
  assert.equal(client.cloudTitle(address('c', '报告.docx')), '报告.docx');
  const files = ['项目一/报告.docx', '项目二/报告.docx'].map(rel => ({ rel, name: '报告.docx', ready: true, preview: '/preview' }));
  assert.equal(client.selectDeliveryFiles(['报告.docx'], files).length, 0, 'ambiguous names must not open both files');
  assert.equal(client.selectDeliveryFiles(['/workspace/项目二/报告.docx'], files)[0].rel, '项目二/报告.docx');
  assert.equal(client.selectDeliveryFiles(['项目一/报告.docx', '项目一/报告.docx'], files).length, 1);

  client.setWorkspaceSwitch({ title: '企业网盘' });
  assert.equal(render(client.CurrentDirectory).children, '正在切换到　企业网盘…', 'space switching gives immediate feedback');
  client.setWorkspaceSwitch(null);
  render(client.CurrentDirectory); mountEffects();
  selected = { key: 'kodbox-u1-home-b' };
  assert.equal(render(client.CurrentDirectory).children, '正在读取保存目录…'); mountEffects();
  requests[1].resolve({ ok: true, json: async () => ({ scope: { display: '项目二' } }) }); await flush();
  requests[0].resolve({ ok: true, json: async () => ({ scope: { display: '项目一' } }) }); await flush();
  assert.equal(render(client.CurrentDirectory).children, '保存到　项目二');
  selected = { key: null };
  assert.equal(render(client.CurrentDirectory), null);
  cleanups.forEach(stop => stop?.()); states = []; cleanups = [];

  const props = { resourceAddress: address('a', '报告.docx') };
  render(client.CloudPreview, props); mountEffects();
  requests[2].resolve({ ok: false, status: 403 }); await flush();
  let view = render(client.CloudPreview, props);
  assert.match(view.children[0].children, /权限已失效/);
  assert.equal(view.children[1].children, '重试预览');
  view.children[1].onClick(); render(client.CloudPreview, props); mountEffects();
  requests[3].resolve({ ok: true, json: async () => ({ href: '/preview', name: '报告.docx' }) }); await flush();
  view = render(client.CloudPreview, props);
  assert.equal(view.children[1].src, '/preview');
  const other = { resourceAddress: address('b', '报告.docx') };
  view = render(client.CloudPreview, other);
  assert.equal(view.children[0].children, '正在加载文件预览…', 'never show the old file during navigation');
  let releaseGate, dispose;
  const id = 'kodbox-u1-home-c';
  const handoff = {
    get: name => context[name],
    uiWorkspace: { mainReference: { sessionId: id }, openSession: () => new Promise(resolve => { releaseGate = resolve; }) },
    sessions: {
      list: { getSnapshot: () => ({ byId: { [id]: {} } }), subscribe: () => () => {} },
      refresh: async () => {},
      scope: () => { throw new Error('must not touch a composer after navigating away'); }
    },
    effect: factory => { dispose = factory(); }
  };
  const before = requests.length;
  client.openHandoff(handoff, id);
  assert.equal(requests.length, before, 'opening a handoff never seeds or fetches into the draft');
  selected = { key: id }; releaseGate(); await flush();
  selected = { key: 'kodbox-u1-home-other' };
  assert.equal(requests.length, before + 1);
  requests[before].resolve({ ok: true, json: async () => ({ files: [{ mention: '@报告.docx', ready: true }] }) });
  await flush(); dispose();
  let modeDefinition, writes = 0, modeDraft = '/help 怎么设置用户权限';
  const modeInput = { state: { getSnapshot: () => ({ draft: modeDraft }) }, setDraft(value) { writes++; modeDraft = value; } };
  client.registerMode({ commandUi: { register(value) { modeDefinition = value; } }, sessions: { scope: () => ({ get: () => ({ input: modeInput }) }) } }, 'help', '帮助文档', 'help', 'test');
  const modeRequestIndex = requests.length;
  const modeOperation = modeDefinition.ui.run({ sessionId: id });
  assert.equal(modeDraft, '【帮助文档】 怎么设置用户权限');
  assert.equal(writes, 1, 'command label is inserted synchronously before network settlement');
  modeDraft += '，保留我继续输入的内容';
  requests[modeRequestIndex].resolve({ ok: true, text: async () => '{"ok":true}' });
  await modeOperation;
  assert.equal(writes, 1, 'mode response never rewrites the draft or caret');
  assert.ok(modeDraft.endsWith('保留我继续输入的内容'));
  client.setContext({get: name => context[name]});
  const pendingIndex = requests.length;
  const pendingLoad = client.listPending(id);
  requests[pendingIndex].resolve({ok: true, json: async () => ({ok: true, data: {items: [{id: 'a'.repeat(16)}], results: []}})});
  assert.equal((await pendingLoad).length, 1, 'result display cannot swallow the confirmation queue');
  let disposeCopy;
  client.installQuestionCopy({ get: name => context[name], effect(factory) { disposeCopy = factory(); } });
  let copiedBody, prevented = false;
  selectionFragment = { textContent: '总结内容 70 字 docx', querySelectorAll: selector => selector.includes('data-composer-chip') ? [{ remove() {} }] : [] };
  listeners.get('copy')({ clipboardData: { setData(type, value) { copiedBody = value; } }, preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
  assert.equal(copiedBody, '总结内容 70 字 docx');
  assert.equal(prevented, true);
  const bubble = { cloneNode: () => ({ textContent: '@"报告.docx"总结内容 70 字 docx', querySelectorAll: () => [] }) };
  listeners.get('click')({ target: { closest: () => ({ closest: () => ({ querySelector: () => bubble }) }) }, preventDefault() {}, stopImmediatePropagation() {} });
  await flush();
  assert.equal(copiedText, '总结内容 70 字 docx');
  const filename = '余杭区数据资源管理局-余杭区政务云盘系统-N2026020413351271571-2026020562647000004.xlsx';
  const nativeBubble = { cloneNode() {
    let value = filename + ' 总结文件内容 80 字 docx';
    const chip = { getAttribute: () => '@"' + filename + '"', replaceWith(tail) { value = value.replace(filename, tail); } };
    return { get textContent() { return value; }, querySelectorAll: selector => selector === '[data-ref-chip="file"]' ? [chip] : [] };
  } };
  listeners.get('click')({ target: { closest: () => ({ closest: () => ({ querySelector: () => nativeBubble }) }) }, preventDefault() {}, stopImmediatePropagation() {} });
  await flush();
  assert.equal(copiedText, '总结文件内容 80 字 docx', 'native highlighted labels have no @ in visible text; remove the file node before copying');
  selectionFragment = {textContent: '@"20260330 [Update testcase] KOD Cloud POC on HCS Detailed testcase - for 100k use" 生成外链 密码随机 有效期 7 天', querySelectorAll: () => []};
  listeners.get('copy')({clipboardData: {setData(_type, value) {copiedBody=value;}}, preventDefault() {}, stopImmediatePropagation() {}});
  assert.equal(copiedBody, '生成外链 密码随机 有效期 7 天', 'quoted file names without extension stay out of copied question');
  const shortBubble = {cloneNode: () => ({textContent: '@"20260330 [Update testcase] KOD Cloud POC on HCS Detailed testcase - for 100k use" 生成外链 密码随机 有效期 7 天', querySelectorAll: () => []})};
  listeners.get('click')({target: {closest: () => ({closest: () => ({querySelector: () => shortBubble})})}, preventDefault() {}, stopImmediatePropagation() {}});
  await flush();
  assert.equal(copiedText, '生成外链 密码随机 有效期 7 天', 'history copy excludes quoted reference without extension');
  assert.equal(client.questionParts('【网盘设置】 生成外链 密码随机').body, '生成外链 密码随机');
  assert.equal(client.questionParts('【帮助文档】 怎么设置用户权限').body, '怎么设置用户权限');
  assert.equal(client.questionParts('正文【保留内容】').body, '正文【保留内容】');
  disposeCopy();
  console.log('Client experience: per-session titles, directory race, preview failure and retry passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
