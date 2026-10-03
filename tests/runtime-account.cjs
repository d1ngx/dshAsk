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
  const { pathToFileURL } = require('node:url');
  const { projectToolUpdates } = await import(pathToFileURL(path.join(path.dirname(path.dirname(await fs.realpath(path.join(runtime, '.bin/dsh')))), 'node_modules/@deepseek-ai/dsh-llm/lib/types/content.js')));
  const context = {name: 'kodbox_context'}, help = {name: 'kodbox_help'};
  const updates = [{messageId: 'switch-help', additions: [help]}];
  const messages = [{id: 'switch-help', role: 'developer', content: [{type: 'tool-addition', toolName: help.name}]}];
  const history = {tools: [context], updates};
  assert(projectToolUpdates(messages, [help], 'addition-only', history).tools.every(t => t.deferLoading), 'reproduces all-deferred mode switch');
  assert(projectToolUpdates(messages, [context, help], 'addition-only', history).tools.some(t => !t.deferLoading), 'stable context survives native history projection');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-runtime-security-'));
  let child, socket;
  let log = '';
  const tokens = new Map([['ask_' + 'a'.repeat(32), '1'], ['ask_' + 'b'.repeat(32), '2']]);
  const uploaded = [];
  const backend = http.createServer(async (req, res) => {
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
    const uploadOwner = tokens.get(url.searchParams.get('token'));
    if (uploadOwner && route === 'plugin/dshAsk/uploadAttachment') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      uploaded.push({ userID: uploadOwner, name: url.searchParams.get('name'), bytes: Buffer.concat(chunks) });
      res.end(JSON.stringify({ code: true, data: 'saved', info: '{source:99}/' })); return;
    }
    if (code && route === 'plugin/dshAsk/setMode') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      data = { mode: new URLSearchParams(Buffer.concat(chunks).toString()).get('mode') };
    }
    res.end(JSON.stringify({ code, data: code ? data : 'not logged in' }));
  });
  try {
    await new Promise((resolve, reject) => { backend.once('error', reject); backend.listen(0, '127.0.0.1', resolve); });
    const profile = path.join(dir, 'profiles/web');
    await fs.mkdir(profile, { recursive: true });
    const probe = path.join(dir, 'tool-probe.mjs');
    await fs.writeFile(probe, `export const inject = ['webServer','agents','tools'];
export function apply(ctx) { ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/kodbox/test-tool-surface', async handler(req,res) {
  const url = new URL(req.url,'http://localhost');
  const agent = ctx.agents.get(new URL(req.url,'http://localhost').searchParams.get('session'));
  res.setHeader('content-type','application/json');
  if (url.searchParams.get('read') === 'xls') {
    res.end(JSON.stringify(await ctx.tools.get('excel_read').execute({path:'legacy.xls'}, {agent,signal:new AbortController().signal}))); return;
  }
  const schemas = url.searchParams.has('wire') ? ctx.tools.wireSchemas(agent).schemas : ctx.tools.schemas(agent);
  res.end(JSON.stringify(url.searchParams.has('full') ? schemas : schemas.map(tool => tool.name)));
} })); }`);
    await fs.writeFile(path.join(profile, 'cordis.patch.yml'), '- insert:\n    - id: kodbox-office-tools\n      name: ' + JSON.stringify(path.join(repo, 'integrations/kodbox-file/index.js')) + '\n      config:\n        apiBase: http://127.0.0.1:' + backend.address().port + '/\n    - id: tool-probe\n      name: ' + JSON.stringify(probe) + '\n');
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
    async function toolSurface() {
      return fetch(base + '/kodbox/test-tool-surface?session=' + first, { headers: { cookie: ownCookie } }).then(response => response.json());
    }
    const surface = await toolSurface();
    const wireSurface = await fetch(base + '/kodbox/test-tool-surface?session=' + first + '&wire=1', { headers: { cookie: ownCookie } }).then(response => response.json());
    assert.ok(!wireSurface.includes('subagent'));
    assert.ok(!wireSurface.includes('bash'));
    assert.ok(wireSurface.includes('excel_read'));

    assert.ok(surface.includes('excel_read'));
    assert.ok(surface.includes('word_create'));
    for (const name of ['bash','glob','grep','subagent','web_fetch','kodbox_api','kodbox_rename']) assert.ok(!surface.includes(name), name + ' is hidden from the ask model');
    for (const mode of ['help', 'settings', 'ask']) {
      const response = await fetch(base + '/kodbox/mode', { method: 'POST', headers: { cookie: ownCookie, 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: first, mode }) });
      assert.equal(response.status, 200, await response.text());
      const visible = await toolSurface();
      const modelTools = await fetch(base + '/kodbox/test-tool-surface?session=' + first + '&wire=1&full=1', { headers: { cookie: ownCookie } }).then(response => response.json());
      assert.ok(modelTools.length > 0);
      assert.ok(modelTools.every(tool => tool.deferLoading !== true), mode + ' includes eagerly loaded tools');
      if (mode === 'help') assert.deepEqual(visible.slice().sort(), ['kodbox_context', 'kodbox_help']);
      if (mode === 'settings') { assert.ok(visible.includes('kodbox_api')); assert.ok(!visible.includes('excel_read')); }
      if (mode === 'ask') { assert.ok(visible.includes('excel_read')); assert.ok(!visible.includes('kodbox_api')); }
    }
    const attachmentBytes = Buffer.from('本地附件测试');
    const attachment = await fetch(base + '/kodbox/upload?' + new URLSearchParams({ sessionId: first, name: '资料.txt' }), {
      method: 'POST', headers: { cookie: ownCookie, 'content-type': 'application/octet-stream' }, body: attachmentBytes
    });
    const upload = await attachment.json();
    assert.equal(attachment.status, 200, JSON.stringify(upload));
    assert.equal(upload.ok, true);
    assert.equal(upload.value.file.name, '资料.txt');
    assert.ok(upload.value.receiptId);
    assert.equal(uploaded.length, 1);
    assert.deepEqual(uploaded[0].bytes, attachmentBytes);
    const uploadRecord = JSON.parse(await fs.readFile(path.join(dir, 'cache/.handoffs', first + '.json'), 'utf8'));
    const cached = Object.values(uploadRecord.files).find(file => file.uploaded);
    assert.equal(cached.display, '个人空间/.dsh/资料.txt');
    assert.equal(cached.generated, false);
    assert.deepEqual(await fs.readFile(path.join(uploadRecord.workspacePath, cached.rel)), attachmentBytes);
    for (const [sessionId, name] of [[foreign, '资料.txt'], [first, '../escape.txt']]) {
      const rejected = await fetch(base + '/kodbox/upload?' + new URLSearchParams({ sessionId, name }), {
        method: 'POST', headers: { cookie: ownCookie, 'content-type': 'application/octet-stream' }, body: attachmentBytes
      });
      assert.equal(rejected.status, 400);
    }
    assert.equal(uploaded.length, 1, 'invalid or foreign uploads never reach cloud storage');
    const largeBytes = Buffer.alloc(2 * 1024 * 1024 + 1, 42);
    const largeUpload = await fetch(base + '/kodbox/upload?' + new URLSearchParams({ sessionId: first, name: 'large.bin' }), {
      method: 'POST', headers: { cookie: ownCookie, 'content-type': 'application/octet-stream' }, body: largeBytes
    });
    assert.equal(largeUpload.status, 200, await largeUpload.text());
    assert.deepEqual(uploaded[1].bytes, largeBytes, 'raw file upload is not truncated by the ordinary 2 MiB RPC limit');

    const commandMenu = JSON.parse((await rpc('commands/list', { agentId: first }, ownCookie)).text).result;
    assert.equal(commandMenu.ok, true, 'slash and plus menus can load the bound session command catalog');
    assert.ok(Array.isArray(commandMenu.value));
    assert.ok(commandMenu.value.some(command => command.name === 'goal'));
    assert.equal(JSON.parse((await rpc('commands/list', { agentId: foreign }, ownCookie)).text).result.error.code, 'kodbox/forbidden');
    const ownList = JSON.parse((await rpc('session/list', { _request: {} }, ownCookie)).text).result.value.items;
    assert.deepEqual(new Set(ownList.map(item => item.sessionId)), new Set([first, second]));
    assert.equal(ownList[0].cwd, ownList[1].cwd, 'sidebar groups share only presentation cwd');
    const records = await Promise.all([first, second].map(async id => JSON.parse(await fs.readFile(path.join(dir, 'cache/.handoffs', id + '.json'), 'utf8'))));
    const XLSX = require('../integrations/kodbox-file/vendor/sheetjs/xlsx.cjs');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['系统','对接'],['系统甲','单点登录']]), '业务');
    await fs.writeFile(path.join(records[0].workspacePath, 'legacy.xls'), Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'biff8' })));
    const xls = await fetch(base + '/kodbox/test-tool-surface?session=' + first + '&read=xls', { headers: { cookie: ownCookie } }).then(response => response.json());
    assert.deepEqual(xls.sheets[0].rows[1], ['系统甲','单点登录'], 'real excel_read parses BIFF8 without renaming or conversion');
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
    const removeBody = JSON.stringify({ sessionId: first, rel: cached.rel });
    const foreignRemoval = await fetch(base + '/kodbox/reference/remove', { method: 'POST', headers: { cookie: 'kod=b; ' + dshCookie, 'content-type': 'application/json' }, body: removeBody });
    assert.notEqual(foreignRemoval.status, 200, 'another account cannot remove this reference');
    const removal = await fetch(base + '/kodbox/reference/remove', { method: 'POST', headers: { cookie: ownCookie, 'content-type': 'application/json' }, body: removeBody });
    assert.equal(removal.status, 200, await removal.text());
    const afterRemoval = JSON.parse(await fs.readFile(path.join(dir, 'cache/.handoffs', first + '.json'), 'utf8'));
    assert.equal(afterRemoval.files[cached.rel].referenceRemoved, true);
    assert.deepEqual(await fs.readFile(path.join(uploadRecord.workspacePath, cached.rel)), attachmentBytes, 'removing a reference never deletes its file');
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
