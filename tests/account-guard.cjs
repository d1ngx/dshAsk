'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const { installAccountGuard } = await import('../integrations/kodbox-file/account-guard.js');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-account-'));
  const a = 'kodbox-u1-home-1700000000001', b = 'kodbox-u2-home-1700000000002', other = 'kodbox-u1-group-1700000000003';
  const entries = new Map();
  for (const [id, userId, spaceId, spacePath] of [[a, '1', 'home', '{source:7}/'], [b, '2', 'home', '{source:8}/'], [other, '1', 'group', '{source:9}/']]) {
    const workspacePath = path.join(root, 'u-' + userId, spaceId, 'sessions', id);
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.writeFile(path.join(workspacePath, 'private.txt'), id);
    entries.set(id, { userId, spaceId, spacePath, workspacePath });
  }
  const users = new Map([
    ['user-a', { userID: '1', workspaces: [{ id: 'home', path: '{source:7}/' }] }],
    ['user-b', { userID: '2', workspaces: [{ id: 'home', path: '{source:8}/' }] }]
  ]);
  const invoked = [], disposers = [], sockets = [];
  const rows = [...entries].map(([sessionId, entry]) => ({ sessionId, cwd: entry.workspacePath, title: sessionId }));
  const groups = [...entries].map(([id, entry]) => ({ workspaceId: id, path: path.dirname(path.dirname(entry.workspacePath)), sessionIds: [id], title: id }));
  const outputs = {
    'session/list': { items: rows },
    'session/search': { items: rows.map(({ sessionId }) => ({ sessionId, snippet: 'private ' + sessionId })), hasMore: true },
    'session/control': { type: 'baseline', value: { queues: Object.fromEntries(rows.map(row => [row.sessionId, ['private']])), jobs: {}, projections: {} } },
    'workspace/follow': { type: 'baseline', value: { items: [...groups.map(item => ({ ...item, sessionIds: [] })), ...rows.map(row => ({ workspaceId: 'task-' + row.sessionId, path: row.cwd, sessionIds: [row.sessionId] }))], archivedSessionIds: [a, b, other] } },
    'session/follow': { type: 'snapshot', messages: ['own'] }
  };
  const gateway = {
    pendingRemoteEvents: new Map(), remoteEventClients: new Map(),
    async dispatchRpc(endpoint) { invoked.push(endpoint); return { ok: true, value: outputs[endpoint] || { accepted: true } }; },
    async openWireStream(endpoint) {
      invoked.push(endpoint);
      if (endpoint === '$events') return (async function* () {
        yield { type: 'ready', clientId: 'client-a', host: { home: '/private/server' } };
        yield { type: 'emit', event: 'api-session/added', args: [rows[0]] };
        yield { type: 'emit', event: 'api-session/added', args: [rows[1]] };
        yield { type: 'waterfall', agentId: b, eventId: 'private' };
        yield { type: 'emit', event: 'settings/document-updated', args: ['secret'] };
      })();
      return (async function* () { yield outputs[endpoint] || { type: 'changed' }; })();
    },
    deliverRemoteEvent() { invoked.push('delivery'); }
  };
  const route = { kind: 'prefix', path: '/api', async handler(req, res) {
    await new Promise(resolve => setImmediate(resolve));
    const value = await gateway.dispatchRpc(req.endpoint, req.payload, new AbortController().signal);
    res.writeHead(200); res.end(value);
  } };
  const web = {
    match() { return route; }, upgrades: new Map(),
    registerUpgrade(value) { this.upgrades.set(value.path, value); }
  };
  web.registerUpgrade({ path: '/api/remote.mux', handler(req, socket) {
    socket.on('message', async ({ endpoint, args, done }) => {
      try {
        const source = await gateway.openWireStream(endpoint, { args }, new AbortController().signal);
        const frames = []; for await (const frame of source) frames.push(frame);
        done({ frames });
      } catch { done({ denied: true }); }
    });
  } });
  try {
    installAccountGuard({ webServer: web, typertGateway: gateway, effect(fn) { disposers.push(fn()); } }, {
      loadEntry(id) { return entries.get(id); },
      async identity(cookie) { if (!users.has(cookie)) throw Error('logged out'); return structuredClone(users.get(cookie)); },
      async owner(entry, cookie) {
        const user = users.get(cookie);
        if (!user || entry.userId !== user.userID || !user.workspaces.some(space => space.path === entry.spacePath)) throw Error('not owner');
        return { userID: user.userID, spacePath: entry.spacePath };
      }
    });
    async function rpc(cookie, endpoint, args = {}, url = '/api/' + endpoint) {
      const req = Object.assign(new EventEmitter(), { headers: { cookie, 'x-kod-user-id': '1' }, endpoint, payload: { args }, destroy() {} });
      const res = { headersSent: false, writeHead(status) { this.status = status; this.headersSent = true; }, end(body) { this.body = body; } };
      await web.match(url).handler(req, res);
      return res;
    }
    assert.equal((await rpc('', 'session/list')).status, 403);
    assert.deepEqual((await rpc('user-a', 'session/list')).body.value.items.map(row => row.sessionId), [a]);
    assert.deepEqual((await rpc('user-b', 'session/list')).body.value.items.map(row => row.sessionId), [b]);
    assert.equal((await rpc('user-a', 'session/list')).body.value.items[0].cwd, groups[0].path);
    assert.equal((await rpc('user-a', 'session/search')).body.value.hasMore, false);
    for (const [endpoint, args] of [
      ['session/prompt', { request: { sessionId: b } }],
      ['session/prompt', { request: { sessionId: other } }],
      ['session/page', { request: { address: { kind: 'session', sessionId: b } } }],
      ['session/page', { request: { address: { kind: 'subagent', parentSessionId: a, childSessionId: b } } }],
      ['session/create', { request: { sessionId: a } }], ['session/fork', { request: { sessionId: a } }],
      ['directoryPicker/list', { path: '/' }], ['settings/update', {}], ['credentials/describe', {}],
      ['workspaceFiles/readAll', { workspaceFileScopeId: b, path: 'private.txt' }],
      ['workspaceFiles/readAll', { workspaceFileScopeId: a, path: entries.get(b).workspacePath + '/private.txt' }],
      ['$events/result', { clientId: 'client-b', eventId: 'private' }]
    ]) {
      const count = invoked.length;
      assert.equal((await rpc('user-a', endpoint, args)).body.ok, false, endpoint);
      assert.equal(invoked.length, count, 'denied request must never reach implementation');
    }
    assert.equal((await rpc('user-a', 'session/prompt', { request: { sessionId: a } })).body.ok, true);
    assert.equal((await rpc('user-a', 'workspaceFiles/readAll', { workspaceFileScopeId: a, path: 'private.txt' })).body.ok, true);
    assert.equal((await rpc('user-a', '', {}, '/api/file?path=/etc/passwd')).status, 403);
    const socket = new EventEmitter(); sockets.push(socket);
    socket.destroy = () => socket.emit('close'); socket.end = () => socket.emit('close');
    await web.upgrades.get('/api/remote.mux').handler({ headers: { cookie: 'user-a' } }, socket, Buffer.alloc(0));
    const stream = (endpoint, args = {}) => new Promise(done => socket.emit('message', { endpoint, args, done }));
    assert.equal((await stream('session/follow', { request: { address: { kind: 'session', sessionId: b } } })).denied, true);
    assert.equal((await stream('session/follow', { request: { address: { kind: 'session', sessionId: a } } })).frames.length, 1);
    assert.deepEqual(Object.keys((await stream('session/control')).frames[0].value.queues), [a]);
    assert.deepEqual((await stream('workspace/follow')).frames[0].value.items.map(row => row.workspaceId), [a]);
    const events = (await stream('$events')).frames;
    assert.equal(events.length, 2); assert.equal(events[0].host.home, ''); assert.equal(events[1].args[0].sessionId, a);
    users.set('user-a', { userID: '2', workspaces: [{ id: 'home', path: '{source:8}/' }] });
    assert.equal((await stream('session/control')).denied, true, 'existing socket cannot switch accounts');
    users.delete('user-a');
    assert.equal((await rpc('user-a', 'session/list')).status, 403, 'logout checked on next request');
    for (const dispose of disposers) dispose();
    assert.equal((await rpc('user-b', 'session/list')).status, 403, 'unload remains closed');
    console.log('Account guard: HTTP, socket context, user/space filtering, native bypass, raw files, logout and fail-closed unload passed');
  } finally {
    for (const socket of sockets) socket.destroy();
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
