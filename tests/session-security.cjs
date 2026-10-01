'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { EventEmitter } = require('node:events');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-security-'));
  try {
    const security = await import('../integrations/kodbox-file/session-security.js');
    const frozen = Object.freeze({ isError: false, content: Object.freeze([{ type: "text", text: "created" }]), value: Object.freeze({ path: "诗.docx" }) });
    const attached = security.attachCloudPreview(frozen, "/index.php?plugin/officeViewer/index&path=%7Bsource%3A1%7D%2F");
    assert.equal(attached.content.length, 2);
    assert.equal(attached.content[0].text, "created");
    assert.equal(JSON.parse(attached.content[1].text).preview, attached.value.preview);
    assert.equal(security.questionTitle([{ type: "text", text: "【Word】请写一首诗\n并保存为文档" }]), "请写一首诗 并保存为文档");
    assert.equal(security.questionTitle("\u001b[31m问题\u001b[0m"), "问题");
    assert.equal(attached.value.path, "诗.docx");
    assert.equal(typeof attached.value.preview, "string");
    assert.equal(security.attachCloudPreview({ isError: true, content: [] }, "/preview").isError, true);
    assert.equal(security.attachCloudPreview({ isError: true, content: [] }, "/preview").content.length, 0);
    assert.equal(security.createsCloudFile('word_create'), true);
    assert.equal(security.revisesCloudFile('word_create'), false);
    assert.equal(security.createsCloudFile('word_update'), false);
    assert.equal(security.revisesCloudFile('word_update'), true);
    assert.equal(security.revisesCloudFile('excel_update'), true);
    assert.equal(security.createsCloudFile('word_read'), false);
    assert.equal(security.revisesCloudFile('ppt_read'), false);
    assert.equal(security.isCitationCache({ files: { 'a.docx': { generated: false } } }, 'a.docx'), true);
    assert.equal(security.isCitationCache({ files: { 'a.docx': { generated: true } } }, 'a.docx'), false);
    assert.equal(security.isCitationCache({ files: {} }, 'a.docx'), false);
    const realHome = path.join(root, 'private', 'dsh');
    const linkHome = path.join(root, 'tmp');
    const workspace = path.join(realHome, 'u-1', 'space', 'sessions', 's');
    await fs.mkdir(workspace, { recursive: true });
    await fs.symlink(realHome, linkHome);
    assert.equal(security.withinReal(path.join(linkHome, 'u-1'), workspace), true);
    assert.equal(security.withinReal(path.join(linkHome, 'u-1'), path.join(realHome, 'u-2', 'other')), false);
    await fs.mkdir(path.join(realHome, 'u-1', 'outside-link'), { recursive: true });
    await fs.symlink(path.join(root, 'private'), path.join(realHome, 'u-1', 'outside-link', 'escape'));
    assert.equal(security.withinReal(path.join(linkHome, 'u-1'), path.join(realHome, 'u-1', 'outside-link', 'escape')), false);
    const sessionA = 'kodbox-u1-home-1700000000001', sessionB = 'kodbox-u2-home-1700000000002';
    const a = path.join(root, 'u-1', 'space', 'sessions', sessionA);
    const b = path.join(root, 'u-2', 'space', 'sessions', sessionB);
    await fs.mkdir(a, { recursive: true }); await fs.mkdir(b, { recursive: true });
    await fs.writeFile(path.join(a, 'own.txt'), 'own'); await fs.writeFile(path.join(b, 'private.txt'), 'private');
    await fs.symlink(b, path.join(a, 'escape'));
    await fs.symlink(path.join(b, 'missing'), path.join(a, 'dangling'));
    assert.equal(await security.workspacePath(a, 'own.txt'), await fs.realpath(path.join(a, 'own.txt')));
    assert.equal(await security.workspacePath(a, 'new/deep/file.txt', true), path.join(await fs.realpath(a), 'new/deep/file.txt'));
    for (const requested of [path.join(b, 'private.txt'), '../other.txt', 'escape/private.txt', 'escape/new.txt', 'dangling/new.txt']) {
      await assert.rejects(security.workspacePath(a, requested, true), undefined, requested);
    }
    const tokenA = 'ask_' + 'a'.repeat(32), tokenB = 'ask_' + 'b'.repeat(32);
    const bindings = path.join(root, '.handoffs'); await fs.mkdir(bindings);
    await fs.writeFile(path.join(bindings, sessionA + '.json'), JSON.stringify({ token: tokenA, userId: '1', spaceId: 'home', spacePath: '{source:7}/', workspacePath: a, scopePath: '{source:7}/', files: {} }));
    await fs.writeFile(path.join(bindings, sessionB + '.json'), JSON.stringify({ token: tokenB, userId: '2', spaceId: 'home', spacePath: '{source:8}/', workspacePath: b, scopePath: '{source:8}/', files: {} }));
    const calls = []; let expired = true; let ownerAllowed = false;
    const context = vm.createContext({ URL, URLSearchParams, Buffer, AbortSignal, console, process: { env: { DSH_KODBOX_HOME: root } },
      fetch: async (address, options = {}) => {
        const url = new URL(address); const route = [...url.searchParams.keys()][0]; const token = url.searchParams.get('token');
        calls.push({ route, token, options });
        if (route.endsWith('/owner')) return { ok: true, json: async () => ({ code: ownerAllowed, data: ownerAllowed ? { userID: 1, spacePath: '{source:7}/' } : 'not owner' }) };
        if (expired && token === tokenA) return { ok: true, json: async () => ({ code: false, data: 'expired' }) };
        if (route.endsWith('/sessionBinding')) return { ok: true, json: async () => ({ code: ownerAllowed, data: { token: 'ask_' + String(created.length + 1).padStart(32, '0'), context: { userID: '1', spaceId: 'home', spacePath: '{source:7}/', currentPath: '{source:7}/', workspaces: [{ type: 'home', id: 'home', name: '个人空间', path: '{source:7}/' }] } } }) };
        if (route.endsWith('/saveFile')) return { ok: true, json: async () => ({ code: true, data: 'saved', info: '{source:100}/' }) };
        return { ok: true, json: async () => ({ code: true, data: { userID: token === tokenA ? 1 : 2, currentPath: '{source:7}/', workspaces: [{ type: 'home', id: 'home', name: '个人空间', path: '{source:7}/' }] } }) };
      }
    });
    const modules = new Map();
    async function synthetic(id, values) {
      const module = new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context, identifier: id });
      modules.set(id, module); return module;
    }
    async function load(filename) {
      if (modules.has(filename)) return modules.get(filename);
      const module = new vm.SourceTextModule(await fs.readFile(filename, 'utf8'), { context, identifier: filename, initializeImportMeta(meta) { meta.url = pathToFileURL(filename).href; } });
      modules.set(filename, module);
      await module.link(async (specifier, referencing) => {
        if (modules.has(specifier)) return modules.get(specifier);
        if (specifier.startsWith('node:')) return synthetic(specifier, await import(specifier));
        if (specifier === '@deepseek-ai/dsh-tools') return synthetic(specifier, { defineTool: x => x });
        if (specifier === '@deepseek-ai/dsh-llm') return synthetic(specifier, { createUserMessage: x => x });
        if (specifier.endsWith('/account-guard.js')) return synthetic(specifier, { installAccountGuard() {} });
        if (specifier.includes('vendor/')) return synthetic(specifier, { apply() {} });
        return load(path.resolve(path.dirname(referencing.identifier), specifier));
      });
      return module;
    }
    const plugin = await load(path.resolve(__dirname, '../integrations/kodbox-file/index.js')); await plugin.evaluate();
    const tools = new Map(), hooks = new Map(), routes = new Map(), created = [], titles = [];
    plugin.namespace.apply({ tools: { register(tool) { tools.set(tool.name, tool); }, get(name) { return tools.get(name); } },
      on(event, handler) { hooks.set(event, handler); }, emit() {}, effect(fn) { fn(); },
      webServer: { register(route) { routes.set(route.path, route.handler); } }, systemPrompt: { section() {} },
      agentDefaultModel: { currentSelection() { return {}; } }, agents: { async create(options) { created.push(options); return { agent: { session: { id: options.sessionId }, followup() {} } }; } },
      workspaceRegistry: { async create() { return { async attachSession() {} }; } }, sessionTitle: { rename(session, title) { titles.push(title); } },
      connection: { browserAuth: { isAuthenticated() { return true; } } }, logger: { warn() {} }
    }, { apiBase: 'http://kodbox.test/' });
    const execA = { agent: { session: { id: sessionA, cwd: a } } }, execB = { agent: { session: { id: sessionB, cwd: b } } };
    await assert.rejects(tools.get('kodbox_context').execute({}, execA), /expired/);
    assert.equal(calls.length, 1, 'no preflight probe or fallback HTTP requests');
    assert.equal(calls[0].token, tokenA);
    calls.length = 0;
    await assert.rejects(tools.get('kodbox_context').execute({ askToken: tokenB }, { agent: { session: { id: 'ordinary', cwd: b } } }), /missing/);
    assert.equal(calls.length, 0, 'unbound session cannot inherit credentials by cwd or tool argument');
    assert.equal(JSON.parse(await tools.get('kodbox_context').execute({}, execB)).userID, 2);
    expired = false; calls.length = 0;
    await assert.rejects(tools.get('kodbox_save').execute({ localPath: path.join(b, 'private.txt'), name: 'copy.txt' }, execA));
    assert.equal(calls.length, 0, 'cross-user file never uploaded');
    const saved = JSON.parse(await tools.get('kodbox_save').execute({ localPath: 'own.txt', name: 'own.txt' }, execA));
    assert.equal(saved.cloudPath, '{source:100}/');
    assert.equal(calls.filter(c => c.route.endsWith('/saveFile')).length, 1);
    assert.equal(calls.every(c => c.token === tokenA), true);
    const writer = { ...execA, name: 'write', arguments: { file_path: 'own.txt' } };
    const result = Object.freeze({ value: { path: 'own.txt' }, content: [{ type: 'text', text: 'written' }] });
    const executed = await hooks.get('tools/execute')(writer, async () => result);
    assert.equal(executed, result, 'around-dispatch must keep the original canonical tool result');
    const finalized = await hooks.get('tools/post-execute')(writer, executed, async () => ({ kind: 'accept' }));
    assert.equal(finalized.kind, 'accept');
    assert.equal(JSON.parse(finalized.content.at(-1).text).savedToKodbox, true);
    assert.match(JSON.parse(finalized.content.at(-1).text).preview, /dshAsk\/viewFile/);
    calls.length = 0;
    const ordinary = { name: 'write', arguments: { file_path: path.join(b, 'private.txt') }, agent: { session: { id: 'ordinary', cwd: b } } };
    await hooks.get('tools/pre-execute')(ordinary, async () => {});
    await hooks.get('tools/execute')(ordinary, async () => ({ value: 'ok' }));
    assert.equal(calls.length, 0, 'ordinary writes are not auto-published to a KodBox user');
    await assert.rejects(hooks.get('tools/pre-execute')({ ...execA, name: 'write', arguments: { file_path: path.join(b, 'private.txt') } }, async () => { throw new Error('must not execute'); }), /工作区/);
    function request(route, query) {
      return new Promise((resolve, reject) => {
        const req = new EventEmitter(); Object.assign(req, { method: 'GET', url: route + '?' + query, headers: { cookie: 'mock-browser-cookie' } });
        const res = { headersSent: false, writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; }, end(body) { resolve({ status: this.status, headers: this.headers, body }); } };
        try { routes.get(route)(req, res); } catch (e) { reject(e); }
      });
    }
    calls.length = 0;
    const denied = await request('/kodbox/catalog', 'session=' + sessionA);
    assert.notEqual(denied.status, 200); assert.equal(calls.length, 1); assert.equal(calls[0].route.endsWith('/owner'), true);
    ownerAllowed = true;
    assert.equal((await request('/kodbox/catalog', 'session=' + sessionA)).status, 200);
    const firstTask = await request('/kodbox/task', 'token=' + tokenA + '&defer=1');
    const secondTask = await request('/kodbox/task', 'token=' + tokenA + '&defer=1');
    assert.equal(firstTask.status, 303); assert.equal(secondTask.status, 303);
    assert.equal(created.length, 2); assert.notEqual(created[0].sessionId, created[1].sessionId);
    assert.equal(titles.length, 0, 'handoffs do not pin session titles to directory names');
    const event = { type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '请生成项目计划' }] } };
    hooks.get('session/event')({ id: created[0].sessionId, snapshotEvents() { return [event]; } }, event);
    assert.deepEqual(titles, ['请生成项目计划']);
    const secondEvent = { ...event, seq: 2 };
    hooks.get('session/event')({ id: created[0].sessionId, snapshotEvents() { return [event, secondEvent]; } }, secondEvent);
    assert.equal(titles.length, 1, 'later prompts do not overwrite the first question or manual renames');
    assert.notEqual(created[0].meta.cwd, created[1].meta.cwd, 'same-user tasks have separate caches');
    for (const task of created) {
      assert.equal(security.contained(await fs.realpath(path.join(root, 'u-1')), task.meta.cwd), true);
      assert.equal(path.basename(task.meta.cwd), task.sessionId);
    }
    console.log('Session security: strict tokens, no preflight probes, path traversal/symlinks, upload boundaries, unbound writes, browser ownership and task isolation passed');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
