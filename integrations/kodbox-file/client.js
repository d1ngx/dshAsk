window.__ModuleLoader__.load({
  id: "kodbox-office-tools",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const jsx = require("react/jsx-runtime");
    const react = require("react");
    const { FileTypeIcon } = require("@deepseek-ai/dsh-client-ui-primitives");
    let ctx;
    const inject = ["uiWorkspace", "uiSession", "sessions", "slots"];
    const cloudTitles = new Map();
    const SESSION_RE = /^kodbox-u\d+-[A-Za-z0-9_-]+$/;
    const PREVIEW_ID = "kodbox-office-tools/cloud-preview";
    const FILE_ADDRESS_PREFIX = "dsh-resource://file/";

    function currentSessionId(context) {
      const key = context.get("uiSession")?.adapter.current.getSnapshot().key;
      return typeof key === "string" ? key : "";
    }

    function cookieValue(name) {
      const prefix = name + "=";
      const item = document.cookie.split("; ").find((part) => part.startsWith(prefix));
      return item ? decodeURIComponent(item.slice(prefix.length)) : "";
    }

    function sessionFromLocation() {
      const target = new URL(window.location.href);
      const query = target.searchParams.get("kodboxSession") || "";
      const cookie = cookieValue("kodboxSession");
      let stored = "";
      try { stored = sessionStorage.getItem("kodboxSession") || ""; } catch (e) { stored = ""; }
      const sessionId = SESSION_RE.test(query) ? query : (SESSION_RE.test(cookie) ? cookie : (SESSION_RE.test(stored) ? stored : ""));
      if (stored) { try { sessionStorage.removeItem("kodboxSession"); } catch (e) {} }
      if (query) {
        target.searchParams.delete("kodboxSession");
        window.history.replaceState(window.history.state, "", target);
      }
      if (cookie) document.cookie = "kodboxSession=; Path=/; Max-Age=0; SameSite=Lax";
      return sessionId;
    }

    function composer(ctx, sessionId) {
      const scope = ctx.sessions.scope(sessionId);
      const conversation = scope?.get("conversation") || ctx.get("conversation");
      if (!scope || !conversation?.input) return undefined;
      try { return typeof conversation.input.for === "function" ? conversation.input.for(scope) : conversation.input; }
      catch { return undefined; }
    }

    function api(path) {
      const under = window.location.pathname === "/dsh" || window.location.pathname.startsWith("/dsh/");
      return (under ? "/dsh" : "") + path;
    }

    function catalog(sessionId) {
      return fetch(api("/kodbox/catalog?session=" + encodeURIComponent(sessionId)), { credentials: "same-origin" })
        .then((response) => response.ok ? response.json() : null)
        .then((data) => {
          for (const file of (data && data.files) || []) {
            if (file && file.rel && file.display) rememberCloudTitle(sessionId, file.rel, file.display);
          }
          return data;
        });
    }

    function rememberCloudTitle(sessionId, rel, display) {
      let titles = cloudTitles.get(sessionId);
      if (!titles) cloudTitles.set(sessionId, titles = new Map());
      titles.set(rel, display);
    }

    function cloudTitle(address) {
      const file = parseSessionFile(address);
      if (!file) return "预览";
      const titles = cloudTitles.get(file.sessionId);
      return titles?.get(file.path) || file.path.split("/").pop() || "预览";
    }

    let workspaceSwitch = null;
    const workspaceSwitchListeners = new Set();
    function setWorkspaceSwitch(value) {
      workspaceSwitch = value;
      for (const listener of workspaceSwitchListeners) listener();
    }

    function CurrentDirectory() {
      const switching = react.useSyncExternalStore(callback => {
        workspaceSwitchListeners.add(callback);
        return () => workspaceSwitchListeners.delete(callback);
      }, () => workspaceSwitch);
      const current = ctx.uiSession.adapter.current;
      const selected = react.useSyncExternalStore(callback => current.subscribe(callback), () => current.getSnapshot());
      const sessionId = typeof selected.key === "string" ? selected.key : "";
      const [state, setState] = react.useState(null);
      react.useEffect(() => {
        let live = true;
        if (SESSION_RE.test(sessionId)) catalog(sessionId).then(data => {
          if (live) setState({ sessionId, display: data?.scope?.display || data?.scope?.workspace || "" });
        }).catch(() => { if (live) setState({ sessionId, display: "" }); });
        return () => { live = false; };
      }, [sessionId]);
      if (switching) return jsx.jsx("div", { role: "status", "data-kodbox-current-directory": true,
        style: { padding: "6px 12px", fontSize: 12 }, children: "正在切换到　" + switching.title + "…" });
      if (!SESSION_RE.test(sessionId)) return null;
      const display = state?.sessionId === sessionId ? state.display : null;
      return jsx.jsx("div", { "data-kodbox-current-directory": true, role: "status",
        style: { padding: "6px 12px", fontSize: 12, color: "var(--dsw-alias-label-secondary)" },
        children: display === null ? "正在读取保存目录…" : display ? "保存到　" + display : "保存目录暂不可用，请从网盘重新打开问答"
      });
    }

    function showNotice(text, ok) {
      const message = String(text || "").replace(/\s+/g, " ").slice(0, 180);
      if (!message) return;
      const composerNode = document.querySelector("[contenteditable='true'], textarea");
      const box = composerNode && (composerNode.closest("form") || composerNode.parentElement);
      const host = box && box.parentElement;
      if (!host || !box) return;
      let bar = document.getElementById("kodbox-notice-bar");
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "kodbox-notice-bar";
        bar.style.cssText = "margin:0 0 8px;padding:6px 10px;border-radius:8px;font-size:13px;line-height:18px";
        host.insertBefore(bar, box);
      }
      bar.style.background = ok ? "rgba(46,160,67,.12)" : "rgba(229,72,77,.08)";
      bar.style.color = ok ? "#1a7f37" : "#e5484d";
      bar.textContent = message;
      clearTimeout(bar._hide);
      bar._hide = setTimeout(() => { if (bar.isConnected) bar.remove(); }, 8000);
    }

    function composerHost() {
      const composerNode = document.querySelector("[contenteditable='true'], textarea");
      const box = composerNode && (composerNode.closest("form") || composerNode.parentElement);
      const host = box && box.parentElement;
      return host && box ? { host, box } : null;
    }

    function postDecision(route, sessionId, pendingId) {
      return fetch(api("/kodbox/" + route), {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, id: pendingId })
      }).then(async (response) => {
        const text = await response.text();
        let data = null;
        try { data = JSON.parse(text); } catch {}
        if (!response.ok || !data || !data.ok) throw new Error((data && typeof data.data === "string" && data.data) || text || "未完成");
        const done = data.data && Array.isArray(data.data.done) ? data.data.done : [];
        const failed = done.find((item) => item && item.result && item.result.code === false);
        if (route === "confirm" && failed) throw new Error((typeof failed.result.data === "string" && failed.result.data) || "未完成");
        pendingState.done.add(pendingId);
        if (queueCache.ids) queueCache.ids.delete(pendingId);
        return data;
      });
    }

    function listPending(sessionId) {
      return fetch(api("/kodbox/pending"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId })
      }).then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok || !data || !data.ok) return [];
        return ((data.data && data.data.items) || []).filter((item) => item && /^[a-f0-9]{16}$/.test(String(item.id || "")));
      }).catch(() => []);
    }

    function armConfirm(input, sessionId) {
      if (!input || input.__kodboxConfirm || typeof input.submit !== "function") return;
      input.__kodboxConfirm = true;
      const original = input.submit.bind(input);
      input.submit = function (...args) {
        const draft = String(input.state.getSnapshot().draft || "").replace(/\s+/g, "");
        if (draft !== "确认" && draft !== "确认执行") return original(...args);
        if (input.__kodboxConfirming) return;
        input.__kodboxConfirming = true;
        listPending(sessionId).then((items) => {
          input.__kodboxConfirming = false;
          if (items.length !== 1) {
            if (items.length > 1) showNotice("有多条待确认，请点输入框上方对应的「确认执行」");
            else original(...args);
            return;
          }
          input.setDraft("");
          postDecision("confirm", sessionId, String(items[0].id)).then(() => {
            showNotice("已执行：" + (items[0].summary || "这条操作"), true);
          }).catch((error) => showNotice(error && error.message));
        }).catch(() => { input.__kodboxConfirming = false; });
      };
    }

    function paintPending(ctx, sessionId, items) {
      const place = composerHost();
      if (!place) return;
      let bar = document.getElementById("kodbox-pending-bar");
      if (!items.length) {
        if (bar) bar.remove();
        return;
      }
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "kodbox-pending-bar";
        bar.style.cssText = "margin:0 0 8px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-fill-secondary, rgba(77,107,254,.08));display:flex;flex-direction:column;gap:6px";
      }
      bar.replaceChildren();
      for (const item of items) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:8px;min-width:0";
        const label = document.createElement("span");
        label.style.cssText = "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--dsw-alias-label-secondary,#444)";
        label.textContent = item.summary || "待确认操作";
        const confirm = document.createElement("button");
        confirm.type = "button";
        confirm.textContent = "确认执行";
        confirm.style.cssText = "flex:none;border:none;border-radius:8px;padding:4px 10px;background:#4d6bfe;color:#fff;font-size:13px;cursor:pointer";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "取消";
        cancel.style.cssText = "flex:none;border:none;background:none;padding:4px 6px;font-size:13px;color:var(--dsw-alias-label-tertiary,#666);cursor:pointer";
        const note = document.createElement("span");
        note.style.cssText = "flex:none;font-size:13px;color:#e5484d";
        const run = (route) => {
          if (pendingState.inflight.has(item.id)) return;
          pendingState.inflight.add(item.id);
          note.style.color = "var(--dsw-alias-label-tertiary,#666)";
          note.textContent = route === "confirm" ? "正在执行…" : "正在取消…";
          postDecision(route, sessionId, String(item.id)).then(() => {
            pendingState.inflight.delete(item.id);
            showNotice((route === "confirm" ? "已执行：" : "已取消：") + (item.summary || "这条操作"), true);
            paintPending(ctx, sessionId, items.filter((entry) => entry.id !== item.id));
          }).catch((error) => {
            pendingState.inflight.delete(item.id);
            const message = String(error && error.message || "未完成");
            note.style.color = "#e5484d";
            note.textContent = message;
            showNotice(message);
          });
        };
        confirm.addEventListener("click", () => run("confirm"));
        cancel.addEventListener("click", () => run("cancel"));
        row.append(label, confirm, cancel, note);
        bar.append(row);
      }
      if (bar.parentElement !== place.host || bar.nextSibling !== place.box) place.host.insertBefore(bar, place.box);
    }

    function mountPending(ctx) {
      let ticket = 0;
      const tick = () => {
        const sessionId = currentSessionId(ctx);
        if (!sessionId || !/^kodbox-u\d+-/.test(sessionId)) {
          const gone = document.getElementById("kodbox-pending-bar");
          if (gone) gone.remove();
          return;
        }
        const input = composer(ctx, sessionId);
        if (input) armConfirm(input, sessionId);
        const mine = ++ticket;
        listPending(sessionId).then((items) => {
          if (mine !== ticket) return;
          const open = items.filter((item) => !pendingState.done.has(item.id));
          paintPending(ctx, sessionId, open);
        });
      };
      tick();
      const timer = setInterval(tick, 3000);
      if (ctx.sessions && ctx.sessions.list && typeof ctx.sessions.list.subscribe === "function") {
        ctx.effect(() => ctx.sessions.list.subscribe(tick), "kodbox-office-tools: pending session");
      }
      ctx.effect(() => clearInterval(timer), "kodbox-office-tools: pending bar");
    }

    function fileToken(raw) {
      const token = String(raw || "");
      const quoted = token.startsWith("@\"");
      const body = (quoted ? token.slice(2).replace(/"$/, "") : token.replace(/^@/, "")).replace(/\/+$/, "");
      const base = body.split("/").pop() || "";
      if (!body || !/\.[A-Za-z0-9]{1,8}$/.test(base)) return token;
      return quoted || /\s/u.test(body) ? "@\"" + body + "\"" : "@" + body;
    }

    function tidyFileMentions(text) {
      return String(text || "").replace(/@(?:\"[^\"\n]*\"|[^\s]+)/g, (token) => fileToken(token));
    }

    function insertFileChips(input, files, prefix) {
      const mentions = files.map((file) => fileToken(file.mention || ("@" + (file.rel || file.name || ""))));
      const head = prefix ? (String(prefix).replace(/\s+$/, "") + " ") : "";
      const text = head + mentions.filter(Boolean).join(" ") + (mentions.length ? " " : "");
      input.setDraft(text);
      let offset = text.length - (mentions.length ? 1 : 0);
      for (let index = mentions.length - 1; index >= 0; index -= 1) {
        const mention = mentions[index];
        if (!mention) continue;
        const start = offset - mention.length;
        const snapshot = input.state.getSnapshot();
        const label = mention.replace(/^@"?|"$/g, "").replace(/\/+$/, "");
        input.insertReference({
          source: "reference",
          ref: mention,
          label,
          appearance: "file",
          clipboardText: mention
        }, { start, end: offset, draftRev: snapshot.draftRev });
        offset = start - 1;
      }
    }

    function hideUnusedCommands(ctx) {
      const ui = ctx.commandUi;
      if (!ui || typeof ui.candidates !== "function" || ui.__kodboxHidden) return;
      ui.__kodboxHidden = true;
      const hidden = new Set(["export", "model", "compact", "feedback", "permission"]);
      const original = ui.candidates.bind(ui);
      ui.candidates = async (session, req) => {
        const rows = await original(session, req);
        return rows.filter((row) => !hidden.has(row.name));
      };
    }

    function registerPicker(ctx, name, description, match) {
      ctx.commandUi.register({
        name,
        description: () => description,
        available: () => true,
        ui: {
          kind: "popupSelect",
          async options(session) {
            const data = await catalog(session.sessionId);
            if (!data) return [{ id: "none", label: "当前会话不是 KodBox 问答", detail: "请从网盘重新打开" }];
            const options = [];
            for (const agent of data.agents || []) {
              if (!match(agent)) continue;
              const missing = agent.missingRequires || [];
              options.push({
                id: agent.id,
                label: agent.name,
                detail: missing.length ? "缺少 " + missing.join("、") : (agent.description || "")
              });
            }
            if (!options.length) options.push({ id: "none", label: "没有可用能力", detail: "" });
            return options;
          },
          onSelect(option, session) {
            if (option.id === "none") return;
            const input = composer(ctx, session.sessionId);
            const label = "【" + option.label + "】";
            const applyLabel = () => {
              if (!input || typeof input.setDraft !== "function") return;
              const current = tidyFileMentions(String(input.state.getSnapshot().draft || ""));
              const rest = current.replace(/^【[^】]*】\s*/, "");
              const mentions = rest.match(/@(?:\"[^\"\n]*\"|[^\s]+)/g) || [];
              if (mentions.length && typeof input.insertReference === "function") {
                insertFileChips(input, mentions.map((mention) => ({ mention })), label);
              } else {
                input.setDraft(rest.trim() ? label + rest : label);
              }
            };
            fetch(api("/kodbox/skill"), {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ sessionId: session.sessionId, agentId: option.id })
            }).then(async (response) => {
              const text = await response.text();
              let data = null;
              try { data = JSON.parse(text); } catch {}
              if (!response.ok || !data || !data.ok) throw new Error(text || "能力切换失败");
              applyLabel();
            }).catch((error) => showNotice(error && error.message));
          }
        }
      });
    }

    function registerOfficeCommand(ctx) {
      const office = new Set(["word", "excel", "powerpoint"]);
      registerPicker(ctx, "office", "选择一项 Office 能力，填入输入框", (agent) => office.has(agent.category));
      registerPicker(ctx, "skill", "选择一项通用能力，填入输入框", (agent) => agent.category === "general");
      registerMode(ctx, "help", "帮助文档", "help", "按管理员手册和用户手册回答");
      registerMode(ctx, "disk", "网盘设置", "settings", "调用当前用户有权限的网盘接口");
    }

    function registerMode(ctx, name, label, mode, description) {
      ctx.commandUi.register({
        name,
        description: () => description,
        available: () => true,
        ui: {
          kind: "action",
          run(session) {
            const input = composer(ctx, session.sessionId);
            const mark = "【" + label + "】";
            fetch(api("/kodbox/mode"), {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ sessionId: session.sessionId, mode })
            }).then(async (response) => {
              const text = await response.text();
              let data = null;
              try { data = JSON.parse(text); } catch {}
              if (!response.ok || !data || !data.ok) throw new Error(text || "模式切换失败");
              if (input && typeof input.setDraft === "function") {
                const current = String(input.state.getSnapshot().draft || "");
                const rest = current.replace(/^【(帮助文档|网盘设置)】\s*/, "");
                input.setDraft(rest.trim() ? mark + rest : mark);
              }
            }).catch((error) => showNotice(error && error.message));
          }
        }
      });
    }

    function parseSessionFile(address) {
      if (typeof address !== "string" || !address.startsWith(FILE_ADDRESS_PREFIX)) return undefined;
      const end = address.search(/[?#]/);
      const [scope, id, ...segments] = address.slice(FILE_ADDRESS_PREFIX.length, end === -1 ? undefined : end).split("/");
      if (scope !== "session" || !id || !segments.length) return undefined;
      try { return { sessionId: decodeURIComponent(id), path: segments.map(decodeURIComponent).join("/") }; }
      catch { return undefined; }
    }

    let sidebarRight = null;
    async function readCloudPreview(file) {
      const response = await fetch(api("/kodbox/preview?session=" + encodeURIComponent(file.sessionId) + "&path=" + encodeURIComponent(file.path)), { credentials: "same-origin" });
      if (response.status === 401 || response.status === 403) throw new Error("登录或文件访问权限已失效，请从网盘重新打开问答。");
      if (response.status === 404) throw new Error("文件暂不可用，可能已被移动或删除，请在网盘中确认。");
      if (!response.ok) throw new Error("暂时无法加载预览，请稍后重试。");
      const data = await response.json();
      if (!data?.href) throw new Error("该文件暂时没有可用预览，请在网盘中确认文件状态。");
      if (data.display) rememberCloudTitle(file.sessionId, file.path, data.display);
      return data;
    }

    function CloudPreview({ resourceAddress, tabId }) {
      const file = parseSessionFile(resourceAddress);
      const [loaded, setState] = react.useState(null);
      const [attempt, retry] = react.useState(0);
      react.useEffect(() => {
        let live = true;
        setState(null);
        if (!file) { setState({ address: resourceAddress, error: "无法识别这个文件，请从网盘重新打开。" }); return undefined; }
        readCloudPreview(file).then(data => {
          if (live) setState({ ...data, address: resourceAddress });
        }).catch(error => {
          if (live) setState({ address: resourceAddress, error: error instanceof TypeError ? "网络连接失败，请检查连接后重试。" : error.message });
        });
        return () => { live = false; };
      }, [resourceAddress, attempt]);
      const state = loaded?.address === resourceAddress ? loaded : null;
      if (!state?.href) return jsx.jsxs("div", { role: "status", style: { padding: 20, color: "var(--dsw-alias-label-secondary)", fontSize: 13 }, children: [
        jsx.jsx("p", { children: state?.error || "正在加载文件预览…" }),
        state?.error ? jsx.jsx("button", { type: "button", onClick: () => retry(value => value + 1), children: "重试预览" }) : null
      ] });
      const name = state.display || state.name || (file ? file.path.split("/").pop() : "");
      const box = { boxSizing: "border-box", width: "100%", height: "100%", display: "flex", flexDirection: "column", minHeight: 0, fontFamily: "var(--dsw-font, sans-serif)" };
      const bar = { flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))" };
      const button = { flex: "none", padding: "4px 10px", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))", background: "transparent", color: "var(--dsw-alias-label-secondary)", fontSize: 12, cursor: "pointer" };
      return jsx.jsxs("div", {
        style: box,
        children: [
          jsx.jsxs("div", {
            style: bar,
            children: [
              jsx.jsx("div", { style: { flex: "auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 600 }, children: name }),
              state.href ? jsx.jsx("button", { type: "button", style: button, onClick: () => window.open(state.href, "_blank", "noopener"), children: "新页面预览" }) : null
            ]
          }),
          state.href
            ? jsx.jsx("iframe", { title: name, src: state.href, style: { flex: "1 1 auto", width: "100%", height: "100%", minHeight: 360, border: "none", background: "#fff" } })
            : null
        ]
      });
    }

    const OFFICE_APPS = {
      word: { app: "Word", color: "#2b579a" },
      excel: { app: "Excel", color: "#217346" },
      ppt: { app: "PPT", color: "#c43e1c" }
    };
    const OFFICE_ACTIONS = { read: "读取", create: "新建", update: "修改" };
    const KODBOX_ACTIONS = {
      kodbox_context: "读取提问上下文",
      kodbox_workspaces: "列出个人空间和企业网盘",
      kodbox_list: "列出目录",
      kodbox_fetch: "下载到工作区",
      kodbox_save: "保存到原目录",
      kodbox_copy: "复制",
      kodbox_move: "移动",
      kodbox_rename: "重命名",
      kodbox_mkdir: "新建目录",
      kodbox_remove: "放入回收站",
      kodbox_help: "检索帮助",
      kodbox_api: "调用接口"
    };
    const pendingState = { done: new Set(), inflight: new Set() };
    const queueCache = { sessionId: "", ids: null, answered: new Set(), task: null, key: "", ticket: 0, waiters: new Map() };
    function refreshQueue(sessionId, needed) {
      if (!sessionId) return Promise.resolve(null);
      const idsNeeded = Array.isArray(needed) ? needed : [];
      if (queueCache.sessionId !== sessionId) {
        queueCache.sessionId = sessionId;
        queueCache.ids = null;
        queueCache.answered = new Set();
        queueCache.task = null;
        queueCache.waiters = new Map();
      }
      const covered = queueCache.ids && idsNeeded.every((id) => queueCache.ids.has(id) || pendingState.done.has(id));
      if (covered) return Promise.resolve(queueCache.ids);
      const key = sessionId + ":" + idsNeeded.slice().sort().join(",");
      if (queueCache.task && queueCache.key === key) return queueCache.task;
      const ticket = queueCache.ticket + 1;
      queueCache.ticket = ticket;
      queueCache.key = key;
      queueCache.waiters.set(ticket, idsNeeded);
      queueCache.task = fetch(api("/kodbox/pending"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId })
      }).then(async (response) => {
        const text = await response.text();
        let data = null;
        try { data = JSON.parse(text); } catch {}
        if (!response.ok || !data || !data.ok) throw new Error("queue");
        const ids = new Set(((data.data && data.data.items) || []).map((item) => item && item.id).filter(Boolean));
        if (queueCache.ticket === ticket) {
          queueCache.ids = ids;
          queueCache.waiters.forEach((wanted, started) => {
            if (started > ticket) return;
            wanted.forEach((id) => queueCache.answered.add(id));
            queueCache.waiters.delete(started);
          });
        }
        if (queueCache.key === key) queueCache.task = null;
        return ids;
      }).catch(() => {
        if (queueCache.key === key) queueCache.task = null;
        queueCache.waiters.delete(ticket);
        return queueCache.ticket === ticket ? queueCache.ids : null;
      });
      return queueCache.task;
    }
    function pendingEntries(result) {
      if (!result || result.pending !== true) return [];
      if (Array.isArray(result.items)) {
        return result.items.filter((item) => item && /^[a-f0-9]{16}$/.test(String(item.id || ""))).map((item) => ({ id: String(item.id), summary: typeof item.summary === "string" ? item.summary : "" }));
      }
      if (/^[a-f0-9]{16}$/.test(String(result.id || ""))) return [{ id: String(result.id), summary: typeof result.summary === "string" ? result.summary : "" }];
      return [];
    }
    const TOOL_NAMES = [
      ...Object.keys(OFFICE_APPS).flatMap((app) => Object.keys(OFFICE_ACTIONS).map((action) => app + "_" + action)),
      ...Object.keys(KODBOX_ACTIONS)
    ];

    function toolLabel(toolName) {
      if (KODBOX_ACTIONS[toolName]) return { badge: "网盘", color: "#4d6bfe", action: KODBOX_ACTIONS[toolName] };
      const [app, action] = toolName.split("_");
      const office = OFFICE_APPS[app];
      return { badge: "Office · " + (office ? office.app : app), color: office ? office.color : "#666", action: OFFICE_ACTIONS[action] || action };
    }

    function blockModel(block) {
      const settled = "kind" in block;
      const argsRaw = (settled ? block.call && block.call.argsRaw : block.argsRaw) || "";
      let args = {};
      try { args = JSON.parse(argsRaw) || {}; } catch {}
      const state = !settled ? "running" : block.error && block.error.code === "interrupted" ? "stopped" : block.isError ? "error" : "ok";
      let output = null;
      if (settled) {
        const parts = (block.content || []).map((item) => item.type === "text" ? item.text : JSON.stringify(item));
        if (!parts.length && block.error) parts.push(block.error.name + ": " + block.error.code);
        output = parts.join("\n") || null;
      }
      let result = null;
      if (output) { try { result = JSON.parse(output); } catch {} }
      // A successful tool can contain its own JSON plus the separately appended
      // cloud metadata. Joining those blocks is not a valid JSON document.
      if (settled) for (const part of block.content || []) {
        if (part.type !== "text") continue;
        try {
          const parsed = JSON.parse(part.text);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) result = { ...(result && typeof result === "object" ? result : {}), ...parsed };
        } catch {}
      }
      return { args, state, output, result };
    }

    // Use the same turn-local event contract and card styling as DSH deliverables.
    const cloudDeliveries = {
      kind: "kodbox-deliveries",
      match(event) {
        if (event.type === "turn/start") return { id: String(event.data.turn), role: "start" };
        if (event.type === "tool/call" || event.type === "tool/result") return { id: String(event.data.turn), role: "update" };
        return null;
      },
      start(_context, match) { return { turn: match.event.data.turn, calls: new Map(), files: [] }; },
      update(context, match) {
        const event = match.event;
        if (event.type === "tool/call") {
          const calls = new Map(context.state.calls);
          if (/^(word|excel|ppt)_(create|update)$|^(kodbox_save|write|edit|str_replace_editor)$/.test(event.data.name)) {
            let args = {};
            try { args = JSON.parse(event.data.arguments); } catch {}
            const path = args.file_path || args.path || args.localPath || args.name;
            if (typeof path === "string" && path.trim()) calls.set(String(event.data.callId), path);
          }
          return { ...context.state, calls };
        }
        const message = event.data.message;
        if (!message) return context.state;
        // Older versions uploaded successfully before their renderer rejected the
        // extra preview field. Only recover that exact case, then verify catalog.
        const legacyPreview = (message.content || []).some(part => part.type === "text" && /value\.preview.*not a declared property/.test(part.text || ""));
        if ((message.isError || message.error) && !legacyPreview) return context.state;
        const path = context.state.calls.get(String(message.source?.callId));
        return path ? { ...context.state, files: [...context.state.files, { path, seq: event.seq }] } : context.state;
      },
      buildLocationData(context, scope) {
        if (scope !== "turn" || !context.state) return null;
        return { kind: "turn", turn: context.state.turn, key: "kodbox-deliveries", value: context.state.files };
      }
    };

    function selectDeliveryFiles(paths, files) {
      const candidates = files.filter(file => file.ready && file.preview && file.rel);
      const selected = new Map();
      for (const path of paths) {
        const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
        let matches = candidates.filter(file => file.rel === normalized);
        if (!matches.length && normalized.startsWith("/")) {
          matches = candidates.filter(file => normalized.endsWith("/" + file.rel));
          const longest = Math.max(0, ...matches.map(file => file.rel.length));
          matches = matches.filter(file => file.rel.length === longest);
        }
        if (!matches.length && !normalized.includes("/")) matches = candidates.filter(file => file.name === normalized);
        // Never open a different directory's same-name file on an ambiguous match.
        if (matches.length === 1) selected.set(matches[0].rel, matches[0]);
      }
      return [...selected.values()];
    }

    function GeneratedFiles(props) {
      const files = props.turn.data.get("kodbox-deliveries") || [];
      const paths = [...new Set(files.filter(file => file.seq <= props.seq).map(file => file.path))];
      return paths.length ? jsx.jsx(GeneratedFileCards, { sessionId: props.sessionId, paths: JSON.stringify(paths) }) : null;
    }

    function GeneratedFileCards({ sessionId, paths }) {
      const [files, setFiles] = react.useState([]);
      react.useEffect(() => {
        let active = true;
        setFiles([]);
        if (!SESSION_RE.test(sessionId || "")) return undefined;
        const wanted = JSON.parse(paths);
        catalog(sessionId).then(data => {
          if (active) setFiles(selectDeliveryFiles(wanted, data?.files || []));
        }).catch(() => {});
        return () => { active = false; };
      }, [sessionId, paths]);
      if (!files.length) return null;
      return jsx.jsx("div", { className: "nyYjTG_root", "data-kodbox-generated-files": true, children:
        jsx.jsx("div", { className: "nyYjTG_presented", "data-presented-files-row": true, "data-single": files.length === 1 || undefined,
          children: files.map(file => jsx.jsxs("div", { className: "nyYjTG_file", "data-kodbox-file-card": true, children: [
            jsx.jsx("button", { type: "button", className: "nyYjTG_cardPreview", title: file.display || file.name,
              "aria-label": "在侧边栏预览 " + file.name, onClick: () => {
                if (sidebarRight) sidebarRight.openResource(sessionFileAddress(sessionId, file.rel));
                else window.open(file.preview, "_blank", "noopener");
              } }),
            jsx.jsx("span", { className: "nyYjTG_fileIcon", children: jsx.jsx(FileTypeIcon, { path: file.name, size: 20 }) }),
            jsx.jsx("div", { className: "nyYjTG_fileBody", children: jsx.jsxs("div", { className: "nyYjTG_details", children: [
              jsx.jsx("span", { className: "nyYjTG_fileName", children: file.name }),
              jsx.jsxs("span", { className: "nyYjTG_description", children: [
                jsx.jsx("span", { className: "nyYjTG_secondaryText", children: file.name.split(".").pop().toUpperCase() }),
                jsx.jsx("span", { className: "nyYjTG_previewHint", children: "在侧边栏预览" })
              ] })
            ] }) })
          ] }, file.rel))
        })
      });
    }

    function ToolBadgeRow({ toolName, block, openFile }) {
      const model = blockModel(block);
      const label = toolLabel(toolName);
      const [open, setOpen] = react.useState(false);
      const target = String(model.args.newName || model.args.name || model.args.path || model.args.localPath || model.args.route || "");
      const shown = target.split("/").filter(Boolean).pop() || target;
      const produced = /^(kodbox_save|write|word_create|excel_create|ppt_create)$/.test(toolName);
      const preview = model.result && typeof model.result.preview === "string" ? model.result.preview : "";
      const openSidePreview = (name) => {
        const sessionId = currentSessionId(ctx);
        if (!sessionId || !name || !sidebarRight) return;
        catalog(sessionId).then((data) => {
          const file = (data && data.files || []).find((item) => item && item.rel && item.name === name);
          if (!file || !file.rel) return;
          try { sidebarRight.openResource(sessionFileAddress(sessionId, file.rel)); } catch (e) {}
        }).catch(() => {});
      };
      const initialState = react.useRef(model.state);
      const openedPreview = react.useRef("");
      react.useEffect(() => {
        if (initialState.current === "ok") return undefined;
        if (!produced || model.state !== "ok") return undefined;
        const marker = preview || shown;
        if (!marker || openedPreview.current === marker) return undefined;
        openedPreview.current = marker;
        openSidePreview(shown);
        return undefined;
      }, [produced, model.state, preview, shown]);
      const entries = pendingEntries(model.result);
      const entryKey = entries.map((item) => item.id).join(",");
      const [notes, setNotes] = react.useState({});
      const [queueRev, setQueueRev] = react.useState(0);
      const sessionNow = () => currentSessionId(ctx);
      react.useEffect(() => {
        const sessionId = sessionNow();
        if (!entryKey || !sessionId) return undefined;
        refreshQueue(sessionId, entryKey.split(",").filter(Boolean)).then(() => setQueueRev((value) => value + 1));
        return undefined;
      }, [entryKey]);
      const decide = (route, pendingId) => {
        const sessionId = sessionNow();
        if (!sessionId || !pendingId || pendingState.inflight.has(pendingId)) return;
        pendingState.inflight.add(pendingId);
        setNotes((prev) => ({ ...prev, [pendingId]: route === "confirm" ? "正在执行…" : "正在取消…" }));
        fetch(api("/kodbox/" + route), {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, id: pendingId })
        }).then(async (response) => {
          const text = await response.text();
          let data = null;
          try { data = JSON.parse(text); } catch {}
          if (!response.ok || !data || !data.ok) throw new Error((data && typeof data.data === "string" && data.data) || text || "未完成");
          pendingState.inflight.delete(pendingId);
          const done = data.data && Array.isArray(data.data.done) ? data.data.done : [];
          const failed = done.find((item) => item && item.result && item.result.code === false);
          if (route === "confirm" && failed) {
            const message = (typeof failed.result.data === "string" && failed.result.data) || "未完成";
            setNotes((prev) => ({ ...prev, [pendingId]: message }));
            showNotice(message);
            return;
          }
          pendingState.done.add(pendingId);
          if (queueCache.ids) queueCache.ids.delete(pendingId);
          setNotes((prev) => ({ ...prev, [pendingId]: route === "cancel" ? "已取消" : "已执行" }));
          showNotice(route === "cancel" ? "已取消" : "已执行", true);
          setQueueRev((value) => value + 1);
        }).catch((error) => {
          pendingState.inflight.delete(pendingId);
          const message = String(error.message || "未完成");
          setNotes((prev) => ({ ...prev, [pendingId]: message }));
          showNotice(message);
          if (queueCache.ids) queueCache.ids.delete(pendingId);
          queueCache.answered.delete(pendingId);
          refreshQueue(sessionId, [pendingId]).then(() => setQueueRev((value) => value + 1));
        });
      };
      const queuedIds = queueRev >= 0 && queueCache.sessionId === sessionNow() ? queueCache.ids : null;
      const errorLine = model.state === "error" && model.output ? model.output.split("\n")[0] : "";
      const status = { running: "进行中…", error: "失败", stopped: "已中断", ok: "" }[model.state];
      const muted = { color: "var(--dsw-alias-label-tertiary)", fontSize: 13 };
      return jsx.jsxs("div", {
        "data-tool": toolName,
        "data-state": model.state,
        style: { display: "flex", flexDirection: "column" },
        children: [
          jsx.jsxs("div", {
            style: { display: "flex", alignItems: "center", gap: 8, minHeight: 26, minWidth: 0 },
            children: [
              jsx.jsx("span", {
                style: { flex: "none", padding: "1px 8px", borderRadius: 10, background: label.color, color: "#fff", fontSize: 12, lineHeight: "18px", fontWeight: 600 },
                children: label.badge
              }),
              jsx.jsx("span", { style: { flex: "none", fontSize: 14, color: "var(--dsw-alias-label-secondary)" }, children: label.action }),
              shown ? jsx.jsx("span", {
                title: shown,
                onClick: preview ? () => openSidePreview(shown) : undefined,
                style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, color: preview ? "var(--dsw-alias-brand-primary, #4d6bfe)" : "var(--dsw-alias-label-tertiary)", cursor: preview ? "pointer" : "default" },
                children: "📄 " + shown
              }) : null,
              status ? jsx.jsx("span", { style: { ...muted, flex: "none", color: model.state === "error" ? "#e5484d" : muted.color }, children: status }) : null,
              preview ? jsx.jsx("button", {
                type: "button",
                onClick: () => openSidePreview(shown),
                style: { ...muted, flex: "none", border: "none", background: "none", cursor: "pointer", padding: 0, color: "var(--dsw-alias-brand-primary, #4d6bfe)" },
                children: "打开"
              }) : null,
              preview ? jsx.jsx("a", {
                href: preview, target: "_blank", rel: "noopener",
                style: { flex: "none", fontSize: 13, color: "var(--dsw-alias-brand-primary, #4d6bfe)" },
                children: "新页面预览"
              }) : null,
              model.output ? jsx.jsx("button", {
                type: "button",
                onClick: () => setOpen((value) => !value),
                style: { ...muted, flex: "none", border: "none", background: "none", cursor: "pointer", padding: 0 },
                children: open ? "收起" : "详情"
              }) : null
            ]
          }),
          errorLine && !open ? jsx.jsx("div", { style: { ...muted, color: "#e5484d", paddingLeft: 4 }, children: errorLine }) : null,
          ...entries.map((entry) => {
            const seen = queueCache.sessionId === sessionNow() && queueCache.answered.has(entry.id);
            const openEntry = !pendingState.done.has(entry.id) && (!seen || (queuedIds && queuedIds.has(entry.id)));
            const note = notes[entry.id] || (!openEntry && seen ? "已不在待确认队列" : "");
            return jsx.jsxs("div", {
              style: { display: "flex", alignItems: "center", gap: 8, minHeight: 22, paddingLeft: 4 },
              children: [
                entry.summary ? jsx.jsx("span", { style: { ...muted, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: entry.summary }) : null,
                openEntry ? jsx.jsx("button", {
                  type: "button",
                  onClick: () => decide("confirm", entry.id),
                  style: { ...muted, flex: "none", border: "none", background: "none", cursor: "pointer", padding: 0, color: "var(--dsw-alias-brand-primary, #4d6bfe)" },
                  children: "确认执行"
                }) : null,
                openEntry ? jsx.jsx("button", {
                  type: "button",
                  onClick: () => decide("cancel", entry.id),
                  style: { ...muted, flex: "none", border: "none", background: "none", cursor: "pointer", padding: 0 },
                  children: "取消"
                }) : null,
                note ? jsx.jsx("span", { style: { ...muted, flex: "none", color: note === "已执行" || note === "已取消" ? muted.color : "#e5484d" }, children: note }) : null
              ]
            }, entry.id);
          }),
          open ? jsx.jsx("pre", {
            style: { margin: "4px 0 6px", padding: 8, maxHeight: 240, overflow: "auto", borderRadius: 6, background: "var(--dsw-alias-fill-secondary, rgba(0,0,0,.04))", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all" },
            children: model.output
          }) : null
        ]
      });
    }

    function registerToolRows(ctx) {
      if (!ctx.slots) return;
      for (const key of TOOL_NAMES) {
        ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({ name: "tool.call.toolview", key }, ToolBadgeRow));
      }
    }

    function CloudTab({ useTabInfo }) {
      const info = useTabInfo();
      const address = info && info.tab ? info.tab.contentId : "";
      const tabId = info && info.tab ? info.tab.id : "";
      return jsx.jsx(CloudPreview, { resourceAddress: address, tabId });
    }

    function registerCloudPreview(ctx) {
      if (ctx.sidebarRightTabs && ctx.slots) {
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: PREVIEW_ID,
          kind: "kodbox-office",
          patterns: ["*.docx", "*.doc", "*.xlsx", "*.xls", "*.pptx", "*.ppt", "*.wps", "*.et", "*.dps"],
          priority: "extension",
          canOpen: (address) => Boolean(parseSessionFile(address)),
          title: cloudTitle
        }), "kodbox-office-tools: cloud preview tab");
        ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
          name: "sidebar.right.pane.tab",
          key: PREVIEW_ID
        }, CloudTab)), "kodbox-office-tools: cloud preview tab body");
      }
      const previews = ctx.get("documentPreviews");
      if (!previews || !ctx.slots) return;
      ctx.effect(() => previews.register({
        id: PREVIEW_ID,
        extensions: ["docx", "doc", "xlsx", "xls", "pptx", "ppt", "wps", "et", "dps"],
        priority: "extension",
        title: () => "网盘预览",
        loading: "bytes-complete",
        wrap: false
      }), "kodbox-office-tools: cloud preview definition");
      ctx.effect(() => ctx.slots.inject("sidebar.right.tab.document", () => ctx.slots.register({
        name: "sidebar.right.tab.document",
        key: PREVIEW_ID
      }, CloudPreview)), "kodbox-office-tools: cloud preview body");
    }

    function sessionFileAddress(sessionId, rel) {
      const segments = String(rel || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
      return FILE_ADDRESS_PREFIX + "session/" + encodeURIComponent(sessionId) + "/" + segments;
    }

    function kodboxFolder(folder) {
      return /\/u-[1-9]\d*\/[^/]+(?:\/|$)/.test(String(folder || ""));
    }

    function hideUnbound(ctx) {
      const ui = ctx.uiWorkspace;
      if (!ui || !ui.workspaces || !ctx.sessions || !ctx.sessions.list) return;
      const snap = ctx.sessions.list.getSnapshot();
      for (const id of snap.ids || []) {
        const summary = snap.byId && snap.byId[id];
        if (!summary || !kodboxFolder(summary.cwd) || /^kodbox-u\d+-/.test(id)) continue;
        ui.workspaces.archiveSession(id).catch(() => {});
      }
    }

    function guardEntry(ctx, handoff = "") {
      const ui = ctx.uiWorkspace;
      if (!ui || ui.__kodboxGuard || !ctx.sessions || !ctx.sessions.list) return;
      ui.__kodboxGuard = true;
      const connect = ui.connectWorkspace.bind(ui);
      const open = ui.openSession.bind(ui);
      const openWorkspace = ui.openWorkspace && ui.openWorkspace.bind(ui);
      if (openWorkspace) ui.openWorkspace = async function (...args) {
        const workspace = this.workspaces?.list?.getSnapshot().items.find(item => item.workspaceId === args[0]);
        const switching = workspace && kodboxFolder(workspace.path) ? { title: workspace.title || "网盘空间" } : null;
        if (switching) setWorkspaceSwitch(switching);
        try { return await openWorkspace(...args); }
        catch (error) { showNotice(String(error?.message || error)); throw error; }
        finally { if (workspaceSwitch === switching) setWorkspaceSwitch(null); }
      };
      const fork = ui.forkSession.bind(ui);
      const restore = ui.restoreSelection.bind(ui);
      ui.restoreSelection = async function (workspaces, sessions) {
        if (handoff && sessions.byId[handoff]) return this.openSession(handoff);
        return restore(workspaces, sessions);
      };
      let navigation = 0;
      const denied = "这个对话没有网盘凭证，不能进入。请从网盘重新打开问答。";
      const reuseBlank = ui.reuseBlank.bind(ui);
      ui.reuseBlank = async function (workspaceId, sessionId) {
        if (SESSION_RE.test(sessionId || "")) return sessionId;
        return reuseBlank(workspaceId, sessionId);
      };
      ui.connectWorkspace = async function (workspaceId) {
        const items = this.workspaces && this.workspaces.list ? this.workspaces.list.getSnapshot().items : [];
        const workspace = (items || []).find((item) => item && item.workspaceId === workspaceId);
        if (!workspace || !kodboxFolder(workspace.path)) return connect(workspaceId);
        const response = await fetch(api("/kodbox/enter"), {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceId })
        });
        const text = await response.text();
        let data = null;
        try { data = JSON.parse(text); } catch {}
        if (!response.ok || !data || !data.sessionId) {
          const message = data?.error || data?.message || text || "无法新建对话，请稍后重试";
          showNotice(message);
          throw new Error(message);
        }
        // The HTTP handoff may beat the Session-added WebSocket event. Materialize
        // the authoritative catalog before native navigation tries to retain it.
        if (data.summary?.sessionId === data.sessionId && typeof ctx.sessions.handleSessionAdded === "function") {
          ctx.sessions.handleSessionAdded(data.summary);
        } else await ctx.sessions.refresh();
        return data.sessionId;
      };
      ui.openSession = async function (sessionId) {
        const attempt = ++navigation;
        const summary = ctx.sessions.list.getSnapshot().byId[sessionId];
        if (summary && kodboxFolder(summary.cwd)) {
          try {
            const response = await fetch(api("/kodbox/gate"), {
              method: "POST", credentials: "same-origin",
              headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId })
            });
            if (attempt !== navigation) return;
            if (!response.ok) { showNotice((await response.text()) || denied); return; }
          } catch { if (attempt === navigation) showNotice(denied); return; }
        }
        if (attempt !== navigation || this.mainReference?.sessionId === sessionId) return;
        open(sessionId);
      };
      ui.forkSession = function (sessionId) {
        const summary = ctx.sessions.list.getSnapshot().byId[sessionId];
        if (summary && kodboxFolder(summary.cwd)) {
          showNotice("网盘对话不能分叉。请在这一栏新建，凭证会保留在新对话上。");
          return undefined;
        }
        return fork(sessionId);
      };
      hideUnbound(ctx);
    }

    function apply(context) {
      try { return mount(context); }
      catch (error) { console.error("KodBox client startup failed:", error); throw error; }
    }

    function mount(context) {
      ctx = context;
      sidebarRight = ctx.get("sidebarRight") || null;
      const sessionId = sessionFromLocation();
      guardEntry(ctx, sessionId);
      const onClick = (event) => {
        const presented = event.target && event.target.closest ? event.target.closest("[data-presented-file]") : null;
        if (presented && !(event.target.closest && event.target.closest("button[aria-haspopup='menu']"))) {
          const titled = presented.querySelector("button[title]");
          const title = titled ? titled.getAttribute("title") || "" : "";
          if (title.indexOf("dsh-kodbox") !== -1 || title.indexOf("/tmp/") !== -1) {
            event.preventDefault();
            event.stopPropagation();
            const name = title.split("/").filter(Boolean).pop() || "";
            const sessionId = currentSessionId(ctx);
            if (!sessionId || !name || !sidebarRight) return;
            catalog(sessionId).then((data) => {
              const file = (data && data.files || []).find((item) => item && item.rel && item.name === name && item.preview);
              if (!file || !file.rel) {
                showNotice("这个文件还没有网盘预览。请从网盘重新打开问答后再生成。");
                return;
              }
              try { sidebarRight.openResource(sessionFileAddress(sessionId, file.rel)); }
              catch (e) { if (file.preview) window.open(file.preview, "_blank", "noopener"); }
            }).catch(() => {});
            return;
          }
        }
        const chip = event.target && event.target.closest ? event.target.closest("button[title], a[title], [data-kodbox-chip]") : null;
        const chipTitle = chip ? (chip.getAttribute("title") || "") : "";
        const localChip = chip && (chip.hasAttribute("data-kodbox-chip") || chipTitle.indexOf("dsh-kodbox") !== -1 || chipTitle.indexOf("/tmp/") !== -1 || chipTitle.indexOf("dsh-resource://") !== -1);
        if (localChip) {
          event.preventDefault();
          event.stopPropagation();
          const name = chip.getAttribute("data-kodbox-chip") || (chip.textContent || "").trim().split("/").filter(Boolean).pop() || "";
          const sessionId = currentSessionId(ctx);
          if (!sessionId || !name || !sidebarRight) return;
          catalog(sessionId).then((data) => {
            const file = (data && data.files || []).find((item) => item && item.rel && item.name === name);
            if (!file || !file.rel) return;
            try { sidebarRight.openResource(sessionFileAddress(sessionId, file.rel)); }
            catch (e) { if (file.preview) window.open(file.preview, "_blank", "noopener"); }
          }).catch(() => {});
          return;
        }
        const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
        if (!anchor) return;
        const raw = anchor.getAttribute("href") || "";
        const href = anchor.href || "";
        if (raw.indexOf("dsh-kodbox") !== -1 || raw.indexOf("dsh-resource://file") !== -1) {
          event.preventDefault();
          event.stopPropagation();
          const name = (anchor.textContent || "").trim();
          const sessionId = currentSessionId(ctx);
          if (!sessionId || !name || !sidebarRight) return;
          catalog(sessionId).then((data) => {
            const file = (data && data.files || []).find((item) => item && item.rel && item.name === name);
            if (!file || !file.rel) return;
            try { sidebarRight.openResource(sessionFileAddress(sessionId, file.rel)); }
            catch (e) { if (file.preview) window.open(file.preview, "_blank", "noopener"); }
          }).catch(() => {});
          return;
        }
        if (href.indexOf("officeViewer") === -1 && href.indexOf("dshPreview=") === -1 && href.indexOf("dshAsk/viewFile") === -1) return;
        event.preventDefault();
        event.stopPropagation();
        if ((anchor.textContent || "").trim() === "新页面预览") {
          window.open(href, "_blank", "noopener");
          return;
        }
        const sessionId = currentSessionId(ctx);
        if (!sessionId || !sidebarRight) {
          window.open(href, "_blank", "noopener");
          return;
        }
        const cloudPath = new URL(href, window.location.origin).searchParams.get("path") || "";
        catalog(sessionId).then((data) => {
          const files = data && data.files || [];
          const file = files.find((item) => item && item.preview && cloudPath && item.preview.indexOf(encodeURIComponent(cloudPath)) !== -1)
            || files.find((item) => item && item.name && item.name === (anchor.textContent || "").trim());
          if (!file || !file.rel) {
            window.open(href, "_blank", "noopener");
            return;
          }
          try { sidebarRight.openResource(sessionFileAddress(sessionId, file.rel)); }
          catch (e) { window.open(href, "_blank", "noopener"); }
        }).catch(() => window.open(href, "_blank", "noopener"));
      };
      document.addEventListener("click", onClick, true);
      const paintCloudTitles = (files) => {
        document.querySelectorAll("[data-textpreview-path]").forEach((node) => {
          const title = node.getAttribute("title") || node.getAttribute("data-textpreview-path") || "";
          const name = title.split("/").filter(Boolean).pop() || (node.textContent || "").trim().split("/").pop() || "";
          const file = (files || []).find((item) => item && item.display && item.name === name);
          const display = file ? file.display : "";
          if (!display || node.getAttribute("data-kodbox-display") === display) return;
          node.setAttribute("data-kodbox-display", display);
          node.setAttribute("title", display);
          const text = node.querySelector("span") || node;
          text.textContent = display;
        });
      };
      const rewritePreviewPaths = () => {
        const sessionId = currentSessionId(ctx);
        if (sessionId && document.querySelector("[data-textpreview-path]")) {
          catalog(sessionId).then((data) => paintCloudTitles(data && data.files)).catch(() => {});
        }
        document.querySelectorAll("[title*='dsh-kodbox']").forEach((node) => {
          const title = node.getAttribute("title") || "";
          const name = title.split("/").filter(Boolean).pop() || "";
          if (!name || node.getAttribute("data-kodbox-chip") === name) return;
          node.setAttribute("data-kodbox-chip", name);
          node.setAttribute("title", name);
        });
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const localPaths = [];
        let textNode;
        while ((textNode = walker.nextNode())) {
          if (textNode.nodeValue && textNode.nodeValue.indexOf("dsh-kodbox/") !== -1) localPaths.push(textNode);
        }
        for (const textNode of localPaths) {
          textNode.nodeValue = textNode.nodeValue.replace(/(?:\/private)?\/tmp\/dsh-kodbox\/[^\s)]+/g, (match) => match.split("/").pop());
        }
        const localLinks = [...document.querySelectorAll("a[href]")].filter((anchor) => {
          const link = anchor.getAttribute("href") || "";
          return link.indexOf("dsh-kodbox") !== -1 || link.indexOf("dsh-resource://file") !== -1;
        });
        if (localLinks.length && ctx.sessions && ctx.sessions.list) {
          const sessionId = currentSessionId(ctx);
          const detach = (anchor) => { anchor.removeAttribute("href"); };
          if (!sessionId) localLinks.forEach(detach);
          else catalog(sessionId).then((data) => {
            const files = data && data.files || [];
            for (const anchor of localLinks) {
              if (!anchor.isConnected) continue;
              const name = (anchor.textContent || "").trim();
              const file = files.find((item) => item && item.preview && item.name === name);
              if (file) anchor.setAttribute("href", file.preview);
              else detach(anchor);
            }
          }).catch(() => localLinks.forEach(detach));
        }
      };
      rewritePreviewPaths();
      const previewObserver = new MutationObserver(rewritePreviewPaths);
      previewObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["title"] });
      ctx.inject(["commandUi"], commandsCtx => {
        hideUnusedCommands(commandsCtx);
        registerOfficeCommand(commandsCtx);
      });
      registerToolRows(ctx);
      ctx.inject(["uiConversation"], deliveryCtx => {
        deliveryCtx.uiConversation.events.register(cloudDeliveries);
        deliveryCtx.slots.inject("conversation.chat.turnTail", () => deliveryCtx.slots.register({ name: "conversation.chat.turnTail", id: "kodbox-generated-files", order: 90 }, GeneratedFiles));
      });
      ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({ name: "conversation.input.dock", id: "kodbox-current-directory", order: 90 }, CurrentDirectory));
      mountPending(ctx);
      ctx.inject(["sidebarRight", "sidebarRightTabs"], previewCtx => {
        sidebarRight = previewCtx.sidebarRight;
        registerCloudPreview(previewCtx);
      });
      if (sessionId) openHandoff(ctx, sessionId);
    }

    function openHandoff(ctx, sessionId) {
      let opened = false;
      let disposed = false;
      let seedTimer;
      let timer;
      let unsubscribe = () => {};
      const stop = () => {
        if (opened) return;
        opened = true;
        unsubscribe();
        clearTimeout(timer);
      };
      const seedFiles = () => {
        catalog(sessionId).then((data) => {
          if (disposed || currentSessionId(ctx) !== sessionId) return;
          const files = (data && data.files || []).filter((file) => file && file.mention && file.ready && !file.generated);
          if (!files.length) return;
          let tries = 0;
          const write = () => {
            if (disposed || currentSessionId(ctx) !== sessionId) return;
            const input = composer(ctx, sessionId);
            if (input && typeof input.insertReference === "function") {
              const draft = String(input.state.getSnapshot().draft || "");
              if (!draft.trim()) insertFileChips(input, files);
              else if (tidyFileMentions(draft) !== draft) {
                const prefix = tidyFileMentions(draft).replace(/@(?:\"[^\"\n]*\"|[^\s]+)/g, " ").replace(/\s+/g, " ").trim();
                insertFileChips(input, files, prefix);
              }
              return;
            }
            if (tries++ < 80) seedTimer = setTimeout(write, 250);
          };
          write();
        }).catch((error) => console.warn("KodBox file references failed:", error));
      };
      const openWhenListed = () => {
        if (opened) return;
        const snapshot = ctx.sessions.list.getSnapshot();
        if (!snapshot.byId[sessionId]) return;
        stop();
        Promise.resolve(ctx.uiWorkspace.openSession(sessionId)).then(() => {
          let selectionTries = 0;
          const seedWhenSelected = () => {
            if (disposed || ctx.uiWorkspace.mainReference?.sessionId !== sessionId) return;
            if (currentSessionId(ctx) === sessionId) seedFiles();
            else if (selectionTries++ < 80) seedTimer = setTimeout(seedWhenSelected, 250);
          };
          seedWhenSelected();
        }).catch(() => {});
      };
      unsubscribe = ctx.sessions.list.subscribe(openWhenListed);
      if (opened) unsubscribe();
      else timer = setTimeout(stop, 20000);
      openWhenListed();
      void ctx.sessions.refresh().then(openWhenListed).catch((error) => {
        console.warn("KodBox DSH session navigation failed:", error);
      });
      ctx.effect(() => () => { disposed = true; stop(); clearTimeout(seedTimer); }, "kodbox-office-tools: open handoff session");
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = "kodbox-office-tools/client";
    return module.exports;
  }
});
