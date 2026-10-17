'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  async function scenario(result, dispose = false, file = "admin-models") {
    let bundle, cleanup, mounted;
    const sandbox = { window: { location: { pathname: '/dsh/' }, __ModuleLoader__: { load(value) { bundle = value; } } },
      fetch: async (url, options) => {
        assert.equal(url, '/index.php?plugin/dshAsk/identity');
        assert.equal(options.credentials, 'same-origin');
        return { ok: true, json: async () => result };
      } };
    vm.runInNewContext(fs.readFileSync(`integrations/kodbox-file/${file}/client.js`, 'utf8'), sandbox);
    const store = { defineStore(spec) { return { create() {
      const state = spec.init();
      return { getSnapshot: () => state, actions: Object.fromEntries(Object.entries(spec.actions).map(([key, fn]) => [key, (...args) => fn(state, ...args)])) };
    } }; }, createSnapshotStore(initial) { return { getSnapshot: () => initial, update(fn) { fn(initial); } }; } };
    const mod = bundle.factory(name => name === '@deepseek-ai/dsh-client-store' ? store : {});
    mod.apply({ effect(fn) { cleanup = fn(); }, plugin(value) { mounted = value; } });
    if (dispose) cleanup();
    await flush(); await flush();
    return mounted;
  }
  assert.equal(await scenario({ code: true, data: { isAdmin: false } }), undefined);
  assert.equal(await scenario({ code: false, data: { isAdmin: true } }), undefined);
  assert.equal(await scenario({ code: true, data: { isAdmin: 'true' } }), undefined);
  assert.equal(await scenario({ code: true, data: { isAdmin: true } }, true), undefined);
  const mounted = await scenario({ code: true, data: { isAdmin: true } });
  assert(mounted);
  const shell = await scenario({ code: true, data: { isAdmin: true } }, false, 'admin-settings-shell');
  assert(shell);
  assert.equal(await scenario({ code: true, data: { isAdmin: false } }, false, 'admin-settings-shell'), undefined);
  const slots = [];
  const declared = new Set(['sidebar.settings', 'sidebar.toggle.badge']);
  const waiting = new Map();
  const ledger = {
    inject(name, fn) { if (declared.has(name)) fn(); else { const callbacks = waiting.get(name) || []; callbacks.push(fn); waiting.set(name, callbacks); } },
    register(spec) {
      slots.push(spec);
      for (const name of Object.keys(spec.children || {})) {
        declared.add(name);
        for (const callback of waiting.get(name) || []) callback();
        waiting.delete(name);
      }
      return () => {};
    },
    entries(name) { return slots.filter(item => item.name === name).map(options => ({ options })); },
    getVersion() { return slots.length; }, subscribe() { return () => {}; }
  };
  let reads = 0;
  const ctx = {
    effect(fn) { fn(); }, locale: { register() {}, bind: () => key => key },
    remote: { $on() {}, settings: { async describe() { reads++; return { ok: true, value: { writable: true, namespaces: [] } }; } },
      llm: { async listProviders() { return { ok: true, value: [] }; }, async listConfigurableProviders() { return { ok: true, value: [] }; } },
      credentials: {}, session: { async modelCatalog() { return { ok: true, value: { providers: [] } }; } } },
    configForms: { describe() { throw Error('LAN must not use the unavailable upstream mirror'); }, get() {} },
    settingsSchema: {}, slots: ledger, on() {}, get() { return { state: {}, reconnect() {} }; },
    shortcuts: { catalog: {}, register() { return () => {}; } }
  };
  mounted.apply(ctx);
  assert.equal(slots.length, 0, 'model content waits for the parent settings slot');
  shell.apply(ctx);
  const modelSlots = slots.filter(item => item.name === 'settings.section');
  assert.deepEqual(modelSlots.map(item => item.id), ['models']);
  const launcher = slots.find(item => item.name === 'sidebar.settings');
  assert(launcher && launcher.children['settings.section'], 'settings launcher declares the models parent slot');
  assert(slots.some(item => item.name === 'settings.trigger'));
  const state = launcher.store.create();
  state.actions.openSection('models');
  assert.equal(state.getSnapshot().open, true);
  assert.equal(state.getSnapshot().activeId, 'models');
  const controller = modelSlots[0].inject().controller;
  await controller.load();
  assert.equal(reads, 1);
  assert.equal(controller.store.getSnapshot().status, 'ready');
  assert.equal(controller.store.getSnapshot().writable, true);
  await controller.load();
  assert.equal(reads, 2, 'reload obtains current persisted host settings');
  console.log('Admin models: role-gated activation, teardown, models-only slot and LAN host configuration reads passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
