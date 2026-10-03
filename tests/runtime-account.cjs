// Optional integration check against the locally installed DSH runtime; no model calls.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { randomBytes } = require('node:crypto');

(async () => {
  const repo = path.resolve(__dirname, '..');
  const runtime = path.join(repo, '.dsh-runtime/node_modules');
  const requireRuntime = createRequire(path.join(runtime, 'runtime-test.cjs'));
  const WebSocket = requireRuntime('ws');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-runtime-security-'));
  let child, socket;
  let log = '';
  const tokens = new Map([['ask_' + 'a'.repeat(32), '1'], ['ask_' + 'b'.repeat(32), '2']]);
  const backend = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const cookie = req.headers.cookie || '';
    const userID = /(?:^|;\s*)kod=a(?:;|$)/.test(cookie) ? '1' : /(?:^|;\s*)kod=b(?:;|$)/.test(cookie) ? '2' : '';
    const url = new URL(req.url, 'http://localhost');
    const route = [...url.searchParams.keys()][0];
    const spacePath = userID === '1' ? '{source:7}/' : '{source:8}/';
    let code = Boolean(userID), data = { userID, spacePath, workspaces: [{ id: 'home', type: 'home', name: '个人空间', path: spacePath }] };
    if (!['plugin/dshAsk/identity', 'plugin/dshAsk/spaceBinding'].includes(route)) code = code && tokens.get(url.searchParams.get('token')) === userID;
    if (code && ['plugin/dshAsk/sessionBinding', 'plugin/dshAsk/spaceBinding'].includes(route)) {
      const token = 'ask_' + randomBytes(16).toString('hex'); tokens.set(token, userID);
      data = { token, context: { ...data, spaceId: 'home', currentPath: spacePath, files: [] } };
    }
    res.end(JSON.stringify({ code, data: code ? data : 'not logged in' }));
  });
  try {
    await new Promise((resolve, reject) => { backend.once('error', reject); backend.listen(0, '127.0.0.1', resolve); });
    const profile = path.join(dir, 'profiles/web');
    await fs.mkdir(profile, { recursive: true });
    await fs.writeFile(path.join(profile, 'cordis.patch.yml'), '- insert:\n    - id: kodbox-office-tools\n      name: ' + JSON.stringify(path.join(repo, 'integrations/kodbox-file/index.js')) + '\n      config:\n        apiBase: http://127.0.0.1:' + backend.address().port + '/\n');
    child = spawn(process.execPath, ['--import', path.join(repo, 'integrations/kodbox-file/bootstrap-guard.js'), path.join(runtime, '.bin/dsh'), 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
      cwd: repo, env: { ...process.env, DSH_HOME: dir, DSH_KODBOX_HOME: path.join(dir, 'cache') }, stdio: ['ignore', 'pipe', 'pipe']
    });
    const url = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('runtime did not start')), 25000);
      const read = data => {
        log += data.toString();
        const found = /http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/.exec(log);
        if (found) { clearTimeout(timeout); resolve(found[0]); }
      };
      child.stdout.on('data', read); child.stderr.on('data', read);
      child.once('exit', code => { clearTimeout(timeout); reject(Error('runtime exited: ' + code)); });
    });
    const base = new URL(url).origin;
    let login;
    for (let i = 0; i < 50; i++) {
      login = await fetch(url, { redirect: 'manual' });
      if (login.status !== 503) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const dshCookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    assert(dshCookie, 'DSH launch exchange issued browser cookie');
    async function rpc(endpoint, args, cookie) {
      const response = await fetch(base + '/api/' + endpoint, {
        method: 'POST', headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: endpoint, payload: { args } })
      });
      return { status: response.status, text: await response.text() };
    }
    const ownCookie = 'kod=a; ' + dshCookie;
    const anonymous = await rpc('session/list', { _request: {} }, dshCookie);
    assert.equal(anonymous.status, 403, 'shared DSH credential alone is insufficient');
    const list = await rpc('session/list', { _request: {} }, ownCookie);
    assert.equal(list.status, 200, list.text);
    assert.deepEqual(JSON.parse(list.text).result.value.items, []);
    async function task(owner) {
      const response = await fetch(base + '/kodbox/task?defer=1&token=ask_' + owner.repeat(32), {
        headers: { cookie: 'kod=' + owner + '; ' + dshCookie }, redirect: 'manual'
      });
      assert.equal(response.status, 303, await response.text());
      return new URL(response.headers.get('location'), base).searchParams.get('kodboxSession');
    }
    const first = await task('a'), second = await task('a'), foreign = await task('b');
    const ownList = JSON.parse((await rpc('session/list', { _request: {} }, ownCookie)).text).result.value.items;
    assert.deepEqual(new Set(ownList.map(item => item.sessionId)), new Set([first, second]));
    assert.equal(ownList[0].cwd, ownList[1].cwd, 'sidebar groups share only presentation cwd');
    const records = await Promise.all([first, second].map(async id => JSON.parse(await fs.readFile(path.join(dir, 'cache/.handoffs', id + '.json'), 'utf8'))));
    assert.notEqual(records[0].workspacePath, records[1].workspacePath);
    assert.notEqual(records[0].token, records[1].token);
    const cross = await rpc('session/cancel', { request: { sessionId: foreign } }, ownCookie);
    assert.equal(JSON.parse(cross.text).result.error.code, 'kodbox/forbidden');
    const bypass = await rpc('session/create', { request: { cwd: '/tmp', sessionId: 'session-attacker' } }, ownCookie);
    assert.equal(JSON.parse(bypass.text).result.error.code, 'kodbox/forbidden');
    assert.equal((await fetch(base + '/api/file?path=/etc/passwd', { headers: { cookie: ownCookie } })).status, 403);
    socket = new WebSocket(base.replace('http:', 'ws:') + '/api/remote.mux', { headers: { cookie: ownCookie } });
    const frame = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('stream did not answer')), 5000);
      socket.on('error', reject);
      socket.on('open', () => socket.send(JSON.stringify({ type: 'open', streamId: 'control', endpoint: 'session/control', payload: { args: {} } })));
      socket.on('message', bytes => {
        const value = JSON.parse(bytes.toString());
        if (value.streamId === 'control' && (value.type === 'item' || value.type === 'error')) { clearTimeout(timeout); resolve(value); }
      });
    });
    assert.notEqual(frame.type, 'error', JSON.stringify(frame));
    const live = frame.value.value;
    assert(!Object.hasOwn(live.projections || live.queues, foreign), 'control stream does not expose the other account');
    const spaces = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('workspace stream did not answer')), 5000);
      const read = bytes => {
        const value = JSON.parse(bytes.toString());
        if (value.streamId !== 'spaces') return;
        if (value.type === 'item' || value.type === 'error') { clearTimeout(timeout); socket.off('message', read); resolve(value); }
      };
      socket.on('message', read);
      socket.send(JSON.stringify({ type: 'open', streamId: 'spaces', endpoint: 'workspace/follow', payload: { args: {} } }));
    });
    assert.notEqual(spaces.type, 'error', JSON.stringify(spaces));
    assert.equal(spaces.value.value.items.length, 1, 'two isolated task directories render as one space');
    assert.deepEqual(new Set(spaces.value.value.items[0].sessionIds), new Set([first, second]));
    const liveSpaceUpdates = [];
    socket.on('message', bytes => {
      const frame = JSON.parse(bytes.toString());
      if (frame.streamId === 'spaces' && frame.type === 'item') liveSpaceUpdates.push(frame.value);
    });
    const directories = await rpc('directoryPicker/list', {}, ownCookie);
    assert.equal(directories.status, 200);
    const visibleDirectories = JSON.parse(directories.text).result.value;
    assert.equal(visibleDirectories.crumbs.at(-1).name, '网盘空间');
    assert.ok(visibleDirectories.entries.some(item => item.name === '个人空间'), 'real directory picker shows the cloud name');
    tokens.clear(); // All prior ask tokens expired; the browser login remains valid.
    const resumed = await fetch(base + '/kodbox/gate', { method: 'POST', headers: { cookie: ownCookie, 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: first }) });
    assert.equal(resumed.status, 200, 'old history reopens with fresh browser-owned credentials after expiry');
    const renewed = JSON.parse(await fs.readFile(path.join(dir, 'cache/.handoffs', first + '.json'), 'utf8'));
    assert.notEqual(renewed.token, records[0].token);
    assert.equal(renewed.workspacePath, records[0].workspacePath, 'history recovery preserves original session files');
    const entered = await fetch(base + '/kodbox/enter', { method: 'POST', headers: { cookie: ownCookie, 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: spaces.value.value.items[0].workspaceId }) });
    assert.equal(entered.status, 200);
    const enteredData = await entered.json();
    const enteredSession = enteredData.sessionId;
    assert.equal(enteredData.summary.sessionId, enteredSession);
    assert.equal(enteredData.summary.agentAvailable, true);
    assert.equal(enteredData.summary.cwd, spaces.value.value.items[0].path, 'fast switch summary uses visible space grouping');
    for (let i = 0; i < 40 && !liveSpaceUpdates.some(update => update.workspace?.sessionIds.includes(enteredSession)); i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(liveSpaceUpdates.some(update => update.type === 'upsert' && update.workspace.sessionIds.includes(enteredSession)), 'newly selected space publishes its new session membership');
    assert.ok(liveSpaceUpdates.every(update => update.type !== 'baseline'), 'a live workspace stream cannot emit a second baseline');
    assert.ok(liveSpaceUpdates.every(update => !update.workspace?.sessionIds.includes(foreign)), 'live updates preserve account isolation');
    console.log('Actual DSH runtime: account-bound tasks, separate credentials/directories, grouped sidebar, native RPC and WebSocket isolation passed');
  } catch (error) {
    const safe = log.replace(/token=[A-Za-z0-9_-]+/g, 'token=[REDACTED]');
    console.error(safe.slice(-6000));
    throw error;
  } finally {
    socket?.terminate();
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => { child.once('exit', resolve); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000).unref(); });
    }
    await new Promise(resolve => backend.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
