'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let client, selected = { key: 'kodbox-u1-home-a' };
const requests = [];
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
  'exports.openHandoff = openHandoff; exports.selectDeliveryFiles = selectDeliveryFiles; exports.rememberCloudTitle = rememberCloudTitle; exports.cloudTitle = cloudTitle; exports.readCloudPreview = readCloudPreview; exports.CurrentDirectory = CurrentDirectory; exports.CloudPreview = CloudPreview; exports.setContext = value => { ctx = value; }; exports.apply = apply;');
vm.runInNewContext(source, { TypeError, setTimeout, clearTimeout, fetch: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
  window: { location: { pathname: '/dsh/' }, __ModuleLoader__: { load(definition) {
    client = definition.factory(name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : {});
  } } }
});
client.setContext(context);
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
  assert.equal(requests.length, before, 'catalog waits for the session gate');
  selected = { key: id }; releaseGate(); await flush();
  assert.equal(requests.length, before + 1);
  selected = { key: 'kodbox-u1-home-other' };
  requests[before].resolve({ ok: true, json: async () => ({ files: [{ mention: '@报告.docx', ready: true }] }) });
  await flush(); dispose();
  console.log('Client experience: per-session titles, directory race, preview failure and retry passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
