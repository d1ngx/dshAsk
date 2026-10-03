import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { sessionUserId, withinReal, workspacePath } from "./session-security.js";

const calls = new AsyncLocalStorage();
const denied = () => new Error("请使用当前网盘账号和空间中已绑定的对话");
const failure = () => ({ ok: false, error: { code: "kodbox/forbidden", message: denied().message, details: {} } });
const sessionMethods = new Set(["prompt", "rename", "cancel", "updateQueue", "selectModel", "attachment", "page", "follow"]);
const fileMethods = new Set(["list", "read", "readAll", "readBytes", "readRelated", "stat", "changes"]);

/** An explicit allowlist: newly installed DSH RPCs never become public by accident. */
export function accountPolicy(ctx, services) {
  const owns = (principal, id) => {
    if (!principal || sessionUserId(id) !== principal.userID) return false;
    const entry = services.loadEntry(id);
    return Boolean(entry && entry.userId === principal.userID && entry.spacePath &&
      principal.workspaces.some(space => space.path === entry.spacePath && String(space.id) === entry.spaceId));
  };
  const summary = (principal, item) => {
    if (!owns(principal, item?.sessionId)) return null;
    const entry = services.loadEntry(item.sessionId);
    // Grouping is presentation metadata. Actual Session cwd remains a private task directory.
    return { ...item, cwd: path.dirname(path.dirname(entry.workspacePath)) };
  };
  const workspaces = (principal, items) => {
    const byPath = new Map(items.map(item => [item.path, item]));
    const groups = new Map();
    for (const item of items) for (const id of item.sessionIds || []) {
      if (!owns(principal, id)) continue;
      const entry = services.loadEntry(id);
      if (item.path !== entry.workspacePath) continue;
      const parent = byPath.get(path.dirname(path.dirname(entry.workspacePath)));
      if (!parent) continue;
      if (!groups.has(parent.workspaceId)) groups.set(parent.workspaceId, { ...parent, sessionIds: [] });
      groups.get(parent.workspaceId).sessionIds.push(id);
    }
    return [...groups.values()];
  };
  async function userRoot(principal) {
    const dir = path.join(services.homeRoot, `u-${principal.userID}`);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return realpathSync(dir);
  }
  function oneSegment(name) {
    return typeof name === "string" && name !== "" && name !== "." && name !== ".." && !/[/\\\u0000]/.test(name);
  }
  async function authorize(state, endpoint, args = {}) {
    if (!state?.principal || state.closed) throw denied();
    const principal = state.principal;
    if (["$events", "session/list", "session/search", "session/control", "session/modelCatalog", "session/canOpenWorkspacePath", "workspace/follow"].includes(endpoint)) return;
    // The in-app folder browser can only see this account's cache. An empty list starts there, never at the host home.
    if (endpoint === "directoryPicker/list" || endpoint === "directoryPicker/createDirectory" || endpoint === "workspace/create") {
      if (!services.homeRoot) throw denied();
      const root = await userRoot(principal);
      if (endpoint === "directoryPicker/list") {
        if (typeof args.path !== "string" || args.path === "") args.path = root;
        else if (!withinReal(root, args.path)) throw denied();
        return;
      }
      if (endpoint === "directoryPicker/createDirectory") {
        if (!withinReal(root, args.path) || !oneSegment(args.name)) throw denied();
        return;
      }
      if (!withinReal(root, args.request?.path)) throw denied();
      return;
    }
    const [namespace, method] = endpoint.split("/");
    let id;
    if (namespace === "session" && sessionMethods.has(method)) {
      const request = args.request;
      if (request?.address && request.address.kind !== "session") throw denied();
      id = request?.sessionId || request?.address?.sessionId;
    } else if (namespace === "workspaceFiles" && fileMethods.has(method)) id = args.workspaceFileScopeId;
    else if (namespace === "fileReferences" && method === "list") id = args.agentId;
    else if (namespace === "skills" && method === "list") id = args.request?.sessionId;
    else if (endpoint === "workspace/archiveSession") id = args.request?.sessionId;
    else throw denied(); // Includes unbound create/fork, host settings, native directory dialogs and arbitrary file URLs.
    if (!owns(principal, id)) throw denied();
    const entry = services.loadEntry(id);
    const owner = await services.owner(entry, state.cookie);
    if (String(owner.userID) !== principal.userID || owner.spacePath !== entry.spacePath) throw denied();
    if (namespace === "workspaceFiles" && method !== "changes") {
      const requested = args.path;
      if (requested !== "." || method !== "list") await workspacePath(entry.workspacePath, requested);
      if (method === "readRelated") await workspacePath(entry.workspacePath, path.resolve(entry.workspacePath, path.dirname(requested), args.relativePath || ""));
    }
    if (namespace === "fileReferences" && (path.isAbsolute(args.query || "") || /(?:^|\/)\.\.(?:\/|$)/.test(args.query || ""))) throw denied();
  }
  function filter(principal, endpoint, value) {
    if (endpoint === "session/canOpenWorkspacePath") return false;
    if (endpoint === "session/list") return { items: (value.items || []).map(item => summary(principal, item)).filter(Boolean) };
    if (endpoint === "session/search") return { items: (value.items || []).filter(item => owns(principal, item.sessionId)), hasMore: false };
    if (endpoint === "session/control") {
      if (value.type !== "baseline") return owns(principal, value.sessionId) ? value : null;
      const keyed = rows => Object.fromEntries(Object.entries(rows || {}).filter(([id]) => owns(principal, id)));
      const source = value.value || {};
      const next = {};
      // Keep whichever maps this DSH version sends. 0.2 baselines are projections only; older ones also send queues and jobs.
      for (const key of Object.keys(source)) {
        const field = source[key];
        next[key] = field && typeof field === "object" && !Array.isArray(field) ? keyed(field) : field;
      }
      return { type: "baseline", value: next };
    }
    if (endpoint === "workspace/archiveSession") return { archivedSessionIds: (value.archivedSessionIds || []).filter(id => owns(principal, id)) };
    if (endpoint === "directoryPicker/list" && value && typeof value.path === "string" && services.homeRoot) {
      const root = realpathSync(path.join(services.homeRoot, `u-${principal.userID}`));
      const keep = item => item && withinReal(root, item.path);
      return { ...value, home: root, crumbs: (value.crumbs || []).filter(keep), entries: (value.entries || []).filter(keep) };
    }
    if (endpoint === "workspace/follow") {
      const pins = ids => (ids || []).filter(id => owns(principal, id));
      if (value.type === "baseline") return { type: "baseline", value: {
        items: workspaces(principal, value.value.items || []),
        archivedSessionIds: (value.value.archivedSessionIds || []).filter(id => owns(principal, id)),
        pinnedSessionIds: pins(value.value.pinnedSessionIds)
      } };
      if (value.type === "upsert") {
        if (!(value.workspace.sessionIds || []).some(id => owns(principal, id))) return null;
        const items = ctx.workspaceRegistry.list().map(item => ({ workspaceId: item.id, path: item.path, title: item.title,
          sessionIds: [...item.sessionIds], createdAt: item.createdAt, updatedAt: item.updatedAt }));
        // A follow generation permits one opening baseline only. Publish a group
        // delta, including the committed record even if registry observers lag it.
        const changed = value.workspace;
        const merged = items.filter(item => item.workspaceId !== changed.workspaceId).concat(changed);
        const parentPath = path.dirname(path.dirname(changed.path));
        const group = workspaces(principal, merged).find(item => item.path === parentPath);
        return group ? { type: "upsert", workspace: group } : null;
      }
      if (value.type === "archived") return { type: "archived", archivedSessionIds: (value.archivedSessionIds || []).filter(id => owns(principal, id)) };
      if (value.type === "pinned") return { type: "pinned", pinnedSessionIds: pins(value.pinnedSessionIds) };
      // Ordering/removal are not exposed for shared space groups.
      return null;
    }
    if (endpoint === "$events") {
      if (value.type === "ready") return { ...value, host: { home: "" } };
      if (value.type === "waterfall") return owns(principal, value.agentId) ? value : null;
      if (value.type !== "emit") return null;
      if (value.event === "api-session/added") {
        const item = summary(principal, value.args?.[0]);
        return item ? { ...value, args: [item] } : null;
      }
      if (["api-session/activity", "api-session/error", "api-session/removed", "api-session/status"].includes(value.event)) return owns(principal, value.args?.[0]) ? value : null;
      return null;
    }
    return value;
  }
  return { owns, authorize, filter };
}

/** Adapter for the installed DSH WebServer + Typert carrier. No vendor files are patched.
 * A missing carrier hook stops installation; silently reverting to DSH's shared login is unsafe.
 */
export function installAccountGuard(ctx, services) {
  const web = ctx.webServer, gateway = ctx.typertGateway;
  if (typeof web?.match !== "function" || !(web.upgrades instanceof Map) || typeof web.registerUpgrade !== "function" ||
      typeof gateway?.dispatchRpc !== "function" || typeof gateway.openWireStream !== "function" || typeof gateway.deliverRemoteEvent !== "function") {
    web?.server?.close();
    web?.server?.closeAllConnections();
    throw new Error("KodBox account isolation requires the supported DSH HTTP and stream carriers");
  }
  const policy = accountPolicy(ctx, services);
  const inflight = new Map(), eventOwners = new Map(), sockets = new Set();
  let active = true;
  const identity = async cookie => {
    if (!cookie || !active) throw denied();
    // Coalesce simultaneous checks only; no cached login survives a logout or permission change.
    const key = createHash("sha256").update(cookie).digest("hex");
    let task = inflight.get(key);
    if (!task) {
      task = services.identity(cookie).then(value => {
        if (!/^[1-9]\d*$/.test(String(value?.userID || "")) || !Array.isArray(value.workspaces)) throw denied();
        return { userID: String(value.userID), workspaces: value.workspaces };
      }).finally(() => inflight.delete(key));
      inflight.set(key, task);
    }
    return task;
  };
  const newState = async req => {
    const cookie = req.headers.cookie || "";
    return { cookie, principal: await identity(cookie), closed: false };
  };
  const match = web.match;
  web.match = function (pathname) {
    const route = match.call(this, pathname);
    if (!route || pathname.startsWith("/plugins/")) return route;
    return { ...route, handler: async (req, res) => {
      try {
        if (!active) throw denied();
        if (pathname.startsWith("/api/") && (route.kind !== "prefix" || route.path !== "/api" || ctx.connection?.fetchRoutes?.has(pathname))) throw denied();
        if (pathname.startsWith("/api/") && pathname !== "/api/remote.mux" && !/^\/api\/[A-Za-z_$][\w$]*\/[A-Za-z_$][\w$]*$/.test(pathname)) throw denied();
        // /api/file accepts arbitrary host paths and has no session identity: never expose it.
        if (pathname === "/api" || pathname === "/api/file") throw denied();
        if (!pathname.startsWith("/api/") && !pathname.startsWith("/kodbox/")) throw denied();
        if (req.headers["content-length"] && Number(req.headers["content-length"]) > 2 * 1024 * 1024) {
          res.writeHead(413); res.end("request too large"); return;
        }
        const state = await newState(req);
        let received = 0;
        req.on("data", chunk => {
          received += chunk.length;
          if (received > 2 * 1024 * 1024) {
            state.closed = true;
            req.destroy();
          }
        });
        return await calls.run(state, () => route.handler(req, res));
      } catch {
        if (!res.headersSent) { res.writeHead(403, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); res.end(denied().message); }
        else res.destroy();
      }
    } };
  };
  const dispatch = gateway.dispatchRpc;
  gateway.dispatchRpc = async function (endpoint, payload, ...carrierArgs) {
    const state = calls.getStore();
    try {
      if (!active || !state || state.closed) throw denied();
      if (endpoint === "$events/result") {
        const result = payload?.args;
        const owner = eventOwners.get(result?.clientId);
        const pending = this.pendingRemoteEvents.get(result?.eventId);
        if (!owner || owner.cookie !== state.cookie || owner.closed || !policy.owns(state.principal, pending?.frame?.agentId)) throw denied();
      } else {
        if (payload && (endpoint === "directoryPicker/list" || endpoint === "directoryPicker/createDirectory" || endpoint === "workspace/create") && payload.args == null) payload.args = {};
        await policy.authorize(state, endpoint, payload?.args);
      }
      const result = await dispatch.call(this, endpoint, payload, ...carrierArgs);
      if (result.ok && endpoint === "session/list" && services.presentSessions) {
        return { ...result, value: policy.filter(state.principal, endpoint, { ...result.value, items: await services.presentSessions(state.principal, result.value.items || []) }) };
      }
      return result.ok ? { ...result, value: policy.filter(state.principal, endpoint, result.value) } : result;
    } catch { return failure(); }
  };
  const deliver = gateway.deliverRemoteEvent;
  gateway.deliverRemoteEvent = function (pending, client) {
    const state = eventOwners.get(client.id);
    if (active && state && !state.closed && policy.owns(state.principal, pending.frame.agentId)) return deliver.call(this, pending, client);
  };
  const open = gateway.openWireStream;
  gateway.openWireStream = async function (endpoint, payload, ...carrierArgs) {
    const state = calls.getStore();
    if (!active || !state || state.closed) throw denied();
    const current = await identity(state.cookie);
    if (current.userID !== state.principal.userID) throw denied();
    state.principal = current;
    if (payload && (endpoint === "directoryPicker/list" || endpoint === "directoryPicker/createDirectory" || endpoint === "workspace/create") && payload.args == null) payload.args = {};
    await policy.authorize(state, endpoint, payload?.args);
    const source = await open.call(this, endpoint, payload, ...carrierArgs);
    const instance = this;
    return (async function* () {
      let clientId;
      try {
        for await (const frame of source) {
          if (!active || state.closed) throw denied();
          if (endpoint === "$events" && frame.type === "ready") {
            clientId = frame.clientId;
            eventOwners.set(clientId, state);
            const client = instance.remoteEventClients.get(clientId);
            if (client) for (const pending of instance.pendingRemoteEvents.values()) instance.deliverRemoteEvent(pending, client);
          }
          const filtered = policy.filter(state.principal, endpoint, frame);
          if (filtered !== null) yield filtered;
        }
      } finally { if (clientId) eventOwners.delete(clientId); }
    })();
  };
  const protectUpgrade = route => ({ ...route, handler: async (req, socket, head) => {
    try {
      if (!active || route.path !== "/api/remote.mux") throw denied();
      const state = await newState(req);
      const emit = socket.emit;
      // EventEmitter does not propagate AsyncLocalStorage when listeners are registered.
      // Bind socket event delivery so every logical stream has the authenticated caller.
      socket.emit = function (...args) { return calls.run(state, () => emit.apply(this, args)); };
      sockets.add(socket);
      let checking = false;
      const timer = setInterval(async () => {
        if (checking) return;
        checking = true;
        try {
          const current = await identity(state.cookie);
          if (current.userID !== state.principal.userID || JSON.stringify(current.workspaces) !== JSON.stringify(state.principal.workspaces)) throw denied();
        } catch { state.closed = true; socket.destroy(); }
        finally { checking = false; }
      }, 15000);
      timer.unref();
      socket.once("close", () => { state.closed = true; clearInterval(timer); sockets.delete(socket); socket.emit = emit; });
      await calls.run(state, () => route.handler(req, socket, head));
    } catch { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); }
  } });
  for (const [key, route] of web.upgrades) web.upgrades.set(key, protectUpgrade(route));
  const registerUpgrade = web.registerUpgrade;
  web.registerUpgrade = function (route) { return registerUpgrade.call(this, protectUpgrade(route)); };
  if (web.server) web.server[Symbol.for("kodbox.accountGuard.ready")] = true;
  // Keep the perimeter closed if this security plugin is unloaded. Restart to change its configuration.
  ctx.effect(() => () => {
    active = false;
    if (web.server) web.server[Symbol.for("kodbox.accountGuard.ready")] = false;
    for (const socket of sockets) socket.destroy();
  }, "kodbox account authorization");
}
