'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let client;
const source = fs.readFileSync('integrations/kodbox-file/client.js', 'utf8')
  .replace('exports.apply = apply;', 'exports.cloudDeliveries = cloudDeliveries; exports.guardEntry = guardEntry; exports.blockModel = blockModel; exports.currentSessionId = currentSessionId; exports.apply = apply;');
const pending = [];
vm.runInNewContext(source, { fetch: () => new Promise(resolve => pending.push(resolve)), window: { location: { pathname: '/dsh/' }, __ModuleLoader__: { load(definition) {
  client = definition.factory(() => ({}));
} } } });
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
  const first = ui.openSession(a), second = ui.openSession(b);
  pending[1]({ ok: true }); await second;
  pending[0]({ ok: true }); await first;
  assert.deepEqual(opened, [b]);
  const same = ui.openSession(b); pending[2]({ ok: true }); await same;
  assert.deepEqual(opened, [b]);
  const restored = ui.restoreSelection({}, { byId }); pending[3]({ ok: true }); await restored;
  assert.deepEqual(opened, [b, a]);
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
  console.log('Client: preview cards, turn isolation and competing navigation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
