'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let client;
const source = fs.readFileSync('integrations/kodbox-file/client.js', 'utf8')
  .replace('exports.apply = apply;', 'exports.cloudDeliveries = cloudDeliveries; exports.guardEntry = guardEntry; exports.blockModel = blockModel; exports.currentSessionId = currentSessionId; exports.apply = apply;');
const pending = [];
vm.runInNewContext(source, {
  fetch: () => new Promise(resolve => pending.push(resolve)),
  URL, URLSearchParams, setInterval, clearInterval, setTimeout, clearTimeout,
  NodeFilter: { SHOW_TEXT: 4 },
  MutationObserver: class { observe() {} disconnect() {} },
  document: {
    cookie: '', body: {},
    addEventListener() {}, removeEventListener() {},
    getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    createTreeWalker() { return { nextNode() { return null; } }; }
  },
  window: {
    location: { href: 'http://127.0.0.1/dsh/', pathname: '/dsh/' },
    history: { state: null, replaceState() {} },
    sessionStorage: { getItem() { return ''; }, removeItem() {} },
    __ModuleLoader__: { load(definition) { client = definition.factory(() => ({})); } }
  }
});
const model = client.blockModel({ kind: 'result', call: { argsRaw: '{"name":"诗.docx"}' }, content: [
  { type: 'text', text: 'Created document' },
  { type: 'text', text: '{"savedToKodbox":true,"preview":"/preview"}' }
] });
assert.equal(model.state, 'ok');
assert.equal(model.result.preview, '/preview');
assert.equal(model.args.name, '诗.docx');
const context = { get(name) {
  assert.equal(name, 'uiSession');
  return { adapter: { current: { getSnapshot: () => ({ key: 'kodbox-u1-home-task' }) } } };
} };
assert.equal(client.currentSessionId(context), 'kodbox-u1-home-task');
assert.equal(client.currentSessionId({ get: () => undefined }), '');
assert.equal(client.inject.includes('conversation'), false);
let state = client.cloudDeliveries.start(null, { event: { data: { turn: 1 } } });
const update = event => { state = client.cloudDeliveries.update({ state }, { event }); };
update({ type: 'tool/call', data: { turn: 1, callId: 'one', name: 'word_create', arguments: '{"path":"诗.docx"}' } });
update({ type: 'tool/result', seq: 10, data: { message: { source: { callId: 'one' }, isError: true } } });
assert.equal(state.files.length, 0);
update({ type: 'tool/result', seq: 11, data: { message: { source: { callId: 'one' } } } });
assert.equal(state.files[0].path, '诗.docx');
assert.equal(client.cloudDeliveries.buildLocationData({ state }, 'turn').key, 'kodbox-deliveries');
assert.equal(client.cloudDeliveries.start(null, { event: { data: { turn: 2 } } }).files.length, 0);
// A late gate response cannot replace a newer selection or release the same reference twice.
(async () => {
  const opened = [];
  const ui = {
    connectWorkspace() {}, forkSession() {}, reuseBlank() {},
    restoreSelection() { throw new Error('handoff must replace startup restoration'); },
    openSession(id) { opened.push(id); this.mainReference = { sessionId: id }; }
  };
  const a = 'kodbox-u1-home-a', b = 'kodbox-u1-home-b';
  const byId = { [a]: { cwd: '/dsh-workspaces/u-1/home/a' }, [b]: { cwd: '/dsh-workspaces/u-1/home/b' } };
  client.guardEntry({ uiWorkspace: ui, sessions: { list: { getSnapshot: () => ({ byId }) } } }, a);
  assert.equal(await ui.reuseBlank('home', a), a, '0.2.0 blank reuse keeps the KodBox session');
  const first = ui.openSession(a), second = ui.openSession(b);
  pending[1]({ ok: true }); await second;
  pending[0]({ ok: true }); await first;
  assert.deepEqual(opened, [b]);
  const same = ui.openSession(b); pending[2]({ ok: true }); await same;
  assert.deepEqual(opened, [b, b], "reopening the selected session reaches the native loader for retry");
  const restored = ui.restoreSelection({}, { byId }); pending[3]({ ok: true }); await restored;
  assert.deepEqual(opened, [b, b, a]);
  let refreshFinished = false, releaseRefresh;
  const pickerUi = { connectWorkspace() { throw Error('must use bound entry'); }, openSession() {}, forkSession() {}, restoreSelection() {}, reuseBlank() {},
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'company', path: '/dsh-workspaces/u-1/company' }] }) } } };
  client.guardEntry({ uiWorkspace: pickerUi, sessions: { list: { getSnapshot: () => ({ byId: {} }) },
    refresh: () => new Promise(resolve => { releaseRefresh = () => { refreshFinished = true; resolve(); }; }) } });
  let connected = false;
  const entering = pickerUi.connectWorkspace('company').then(id => { connected = true; assert.equal(id, b); assert.equal(refreshFinished, true); });
  pending[4]({ ok: true, text: async () => JSON.stringify({ sessionId: b }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(connected, false, 'navigation waits until server-created session is catalogued');
  releaseRefresh(); await entering;
  let fastSummary;
  const fastUi = { ...pickerUi, __kodboxGuard: false };
  client.guardEntry({ uiWorkspace: fastUi, sessions: { list: { getSnapshot: () => ({ byId: {} }) },
    handleSessionAdded(summary) { fastSummary = summary; }, refresh() { throw Error('fast switch must not load the entire history'); } } });
  const fast = fastUi.connectWorkspace('company');
  pending[5]({ ok: true, text: async () => JSON.stringify({ sessionId: b, summary: { sessionId: b, agentAvailable: true } }) });
  assert.equal(await fast, b);
  assert.equal(fastSummary.sessionId, b);
  const owned = 'kodbox-u1-home-owned';
  let recreated = 0;
  const bootUi = {
    connectWorkspace() {}, openSession() {}, openWorkspace() {}, forkSession() {}, restoreSelection() {},
    restoreBlank() { recreated += 1; },
    createNamed(request) { if (request.sessionId) recreated += 1; return request.sessionId || 'fresh'; },
    workspaces: { list: { getSnapshot: () => ({ items: [], archivedSessionIds: [] }) } }
  };
  client.apply({
    uiWorkspace: bootUi,
    uiSession: { adapter: { current: { getSnapshot: () => ({ key: '' }), subscribe() { return () => {}; } } } },
    sessions: { list: { getSnapshot: () => ({ ids: [], byId: {} }), subscribe() { return () => {}; } }, scope() {} },
    slots: { inject(_name, register) { register(); }, register() {} },
    get() {}, inject() {}, effect(run) { run(); }
  });
  assert.equal(bootUi.__kodboxGuard, true);
  assert.equal(typeof bootUi.reuseBlank, 'undefined', '0.2.1 has no reuseBlank to bind');
  assert.equal(await bootUi.restoreBlank('space', owned), owned);
  assert.equal(await bootUi.createNamed({ sessionId: owned }), owned);
  assert.equal(await bootUi.createNamed({ workspaceId: 'space' }), 'fresh');
  assert.equal(recreated, 0, 'web boot must not require reuseBlank or recreate a KodBox session');
  let nativeCreate = 0;
  const blankUi = {
    connectWorkspace() { nativeCreate += 1; return 'native'; },
    connectBlank() { nativeCreate += 1; return 'native-blank'; },
    createNamed() { nativeCreate += 1; return 'native-named'; },
    openSession() {}, openWorkspace() {}, forkSession() {}, restoreSelection() {},
    workspaces: { list: { getSnapshot: () => ({ items: [
      { workspaceId: 'company', path: '/dsh-workspaces/u-1/company' },
      { workspaceId: 'local', path: '/tmp/local' }
    ], archivedSessionIds: [] }) } }
  };
  client.guardEntry({ uiWorkspace: blankUi, sessions: { list: { getSnapshot: () => ({ ids: [], byId: {} }) },
    handleSessionAdded() {} } });
  const created = blankUi.connectBlank('company');
  pending[6]({ ok: true, text: async () => JSON.stringify({ sessionId: owned, summary: { sessionId: owned, agentAvailable: true } }) });
  assert.equal(await created, owned);
  const named = blankUi.createNamed({ workspaceId: 'company' });
  pending[7]({ ok: true, text: async () => JSON.stringify({ sessionId: owned, summary: { sessionId: owned } }) });
  assert.equal(await named, owned);
  assert.equal(await blankUi.connectBlank('local'), 'native-blank');
  assert.equal(await blankUi.createNamed({ workspaceId: 'local' }), 'native-named');
  assert.equal(nativeCreate, 2, 'only a non-KodBox workspace may use native session create');
  console.log('Client: preview cards, turn isolation and competing navigation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
