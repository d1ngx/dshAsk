window.__ModuleLoader__.load({
  id: "kodbox-office-tools",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const jsx = require("react/jsx-runtime");
    const react = require("react");
    const inject = ["uiWorkspace", "sessions", "commandUi", "conversation", "documentPreviews", "sidebarRight", "sidebarRightTabs", "slots"];
    const cloudTitles = new Map();
    const SESSION_RE = /^kodbox-u\d+-[A-Za-z0-9_-]+$/;
    const PREVIEW_ID = "kodbox-office-tools/cloud-preview";
    const FILE_ADDRESS_PREFIX = "dsh-resource://file/";

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
      if (!scope || !ctx.conversation || !ctx.conversation.input) return undefined;
      try { return ctx.conversation.input.for(scope); }
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
            if (file && file.rel && file.display) cloudTitles.set(file.rel, file.display);
          }
          return data;
        });
    }

    function cloudTitle(address) {
      const file = parseSessionFile(address);
      if (!file) return "预览";
      for (const [rel, display] of cloudTitles) {
        if (file.path === rel || file.path.endsWith("/" + rel)) return display;
      }
      const nested = file.path.match(/\/u-\d+\/(.+)$/);
      return nested ? nested[1] : (file.path.split("/").pop() || "预览");
    }

    // Replace each "@path" placeholder with a native file chip, last one first
    // so earlier spans keep their offsets.
    function showScopeBar(display) {
      const existing = document.getElementById("kodbox-scope-bar");
      if (!display) {
        if (existing) existing.remove();
        return;
      }
      const place = (composerNode) => {
        const box = composerNode.closest("form") || composerNode.parentElement;
        const host = box && box.parentElement;
        if (!host) return;
        let bar = document.getElementById("kodbox-scope-bar");
        if (!bar) {
          bar = document.createElement("div");
          bar.id = "kodbox-scope-bar";
          bar.style.cssText = "margin:0 0 8px;padding:6px 10px;border-radius:8px;background:var(--dsw-alias-fill-secondary, rgba(77,107,254,.08));color:var(--dsw-alias-label-secondary,#444);font-size:13px;line-height:18px";
        }
        bar.textContent = "当前目录　" + display;
        if (bar.nextSibling !== box) host.insertBefore(bar, box);
      };
      const composerNode = document.querySelector("[contenteditable='true'], textarea");
      if (composerNode) place(composerNode);
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
            if (input && typeof input.setDraft === "function") {
              const current = tidyFileMentions(String(input.state.getSnapshot().draft || ""));
              const rest = current.replace(/^【[^】]*】\s*/, "");
              const mentions = rest.match(/@(?:\"[^\"\n]*\"|[^\s]+)/g) || [];
              if (mentions.length && typeof input.insertReference === "function") {
                insertFileChips(input, mentions.map((mention) => ({ mention })), label);
              } else {
                input.setDraft(rest.trim() ? label + rest : label);
              }
            }
            fetch(api("/kodbox/skill"), {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ sessionId: session.sessionId, agentId: option.id })
            }).catch((error) => console.warn("KodBox skill failed:", error));
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
          kind: "popupSelect",
          async options() { return [{ id: mode, label, detail: description }]; },
          onSelect(option, session) {
            const input = composer(ctx, session.sessionId);
            const mark = "【" + label + "】";
            if (input && typeof input.setDraft === "function") {
              const current = String(input.state.getSnapshot().draft || "");
              const rest = current.replace(/^【(帮助文档|网盘设置)】\s*/, "");
              input.setDraft(rest.trim() ? mark + rest : mark);
            }
            fetch(api("/kodbox/mode"), {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ sessionId: session.sessionId, mode: option.id })
            }).catch((error) => console.warn("KodBox mode failed:", error));
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
    function closeTab(tabId) {
      if (!tabId || !sidebarRight || typeof sidebarRight.closeTab !== "function") return;
      try { sidebarRight.closeTab(tabId); } catch (e) {}
    }

    function CloudPreview({ resourceAddress, tabId }) {
      const file = parseSessionFile(resourceAddress);
      const [state, setState] = react.useState({ loading: true });
      react.useEffect(() => {
        if (!file) { setState({ loading: false }); return undefined; }
        let live = true;
        const load = () => {
          fetch(api("/kodbox/preview?session=" + encodeURIComponent(file.sessionId) + "&path=" + encodeURIComponent(file.path)), { credentials: "same-origin" })
            .then((response) => response.json())
            .then((data) => {
              if (!live) return;
              if (data && data.href) {
                if (data.display && file.path) cloudTitles.set(file.path, data.display);
                setState({ loading: false, ...data });
                return;
              }
              closeTab(tabId);
              setState({ loading: false, closed: true });
            })
            .catch(() => { if (live) { closeTab(tabId); setState({ loading: false, closed: true }); } });
        };
        load();
        return () => { live = false; };
      }, [resourceAddress, tabId]);
      if (!state.href) return null;
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
      kodbox_remove: "放入回收站"
    };
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
      return { args, state, output, result };
    }

    function ToolBadgeRow({ toolName, block, openFile }) {
      const model = blockModel(block);
      const label = toolLabel(toolName);
      const [open, setOpen] = react.useState(false);
      const target = String(model.args.newName || model.args.name || model.args.path || model.args.localPath || "");
      const shown = target.split("/").filter(Boolean).pop() || target;
      const produced = toolName === "kodbox_save";
      const preview = model.result && typeof model.result.preview === "string" ? model.result.preview : "";
      const openSidePreview = (name) => {
        const sessionId = ctx.sessions && ctx.sessions.list ? ctx.sessions.list.getSnapshot().current : "";
        if (!sessionId || !name || !ctx.sidebarRight) return;
        catalog(sessionId).then((data) => {
          const file = (data && data.files || []).find((item) => item && item.rel && item.name === name);
          if (!file || !file.rel) return;
          try { ctx.sidebarRight.openResource(sessionFileAddress(sessionId, file.rel)); } catch (e) {}
        }).catch(() => {});
      };
      const initialState = react.useRef(model.state);
      const openedPreview = react.useRef("");
      react.useEffect(() => {
        if (initialState.current === "ok") return undefined;
        if (!produced || model.state !== "ok" || !preview) return undefined;
        if (openedPreview.current === preview) return undefined;
        openedPreview.current = preview;
        openSidePreview(shown);
        return undefined;
      }, [produced, model.state, preview, shown]);
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
      if (!ctx.documentPreviews || !ctx.slots) return;
      ctx.effect(() => ctx.documentPreviews.register({
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

    function apply(ctx) {
      sidebarRight = ctx.sidebarRight || null;
      const onClick = (event) => {
        const chip = event.target && event.target.closest ? event.target.closest("button[title], a[title], [data-kodbox-chip]") : null;
        const chipTitle = chip ? (chip.getAttribute("title") || "") : "";
        const localChip = chip && (chip.hasAttribute("data-kodbox-chip") || chipTitle.indexOf("dsh-kodbox") !== -1 || chipTitle.indexOf("/tmp/") !== -1 || chipTitle.indexOf("dsh-resource://") !== -1);
        if (localChip) {
          event.preventDefault();
          event.stopPropagation();
          const name = chip.getAttribute("data-kodbox-chip") || (chip.textContent || "").trim().split("/").filter(Boolean).pop() || "";
          const sessionId = ctx.sessions && ctx.sessions.list ? ctx.sessions.list.getSnapshot().current : "";
          if (!sessionId || !name || !ctx.sidebarRight) return;
          catalog(sessionId).then((data) => {
            const file = (data && data.files || []).find((item) => item && item.rel && item.name === name);
            if (!file || !file.rel) return;
            try { ctx.sidebarRight.openResource(sessionFileAddress(sessionId, file.rel)); }
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
          const sessionId = ctx.sessions && ctx.sessions.list ? ctx.sessions.list.getSnapshot().current : "";
          if (!sessionId || !name || !ctx.sidebarRight) return;
          catalog(sessionId).then((data) => {
            const file = (data && data.files || []).find((item) => item && item.rel && item.name === name);
            if (!file || !file.rel) return;
            try { ctx.sidebarRight.openResource(sessionFileAddress(sessionId, file.rel)); }
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
        const sessionId = ctx.sessions && ctx.sessions.list ? ctx.sessions.list.getSnapshot().current : "";
        if (!sessionId || !ctx.sidebarRight) {
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
          try { ctx.sidebarRight.openResource(sessionFileAddress(sessionId, file.rel)); }
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
        const sessionId = ctx.sessions && ctx.sessions.list ? ctx.sessions.list.getSnapshot().current : "";
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
          const sessionId = ctx.sessions.list.getSnapshot().current;
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
      hideUnusedCommands(ctx);
      registerOfficeCommand(ctx);
      registerToolRows(ctx);
      registerCloudPreview(ctx);
      const sessionId = sessionFromLocation();
      if (!sessionId) return;

      let opened = false;
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
          const files = (data && data.files || []).filter((file) => file && file.mention && file.ready && !file.generated);
          const scope = data && data.scope;
          const folder = scope && scope.display && scope.workspace && scope.display !== scope.workspace ? scope.display : "";
          if (folder) {
            let barTries = 0;
            const paint = () => { showScopeBar(folder); if (!document.getElementById("kodbox-scope-bar") && barTries++ < 40) setTimeout(paint, 250); };
            paint();
          }
          if (!files.length) return;
          let tries = 0;
          const write = () => {
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
            if (tries++ < 80) setTimeout(write, 250);
          };
          write();
        }).catch((error) => console.warn("KodBox file references failed:", error));
      };
      const openWhenListed = () => {
        if (opened) return;
        const snapshot = ctx.sessions.list.getSnapshot();
        if (!snapshot.byId[sessionId]) return;
        stop();
        ctx.uiWorkspace.openSession(sessionId);
        seedFiles();
      };
      unsubscribe = ctx.sessions.list.subscribe(openWhenListed);
      if (opened) unsubscribe();
      else timer = setTimeout(stop, 20000);
      openWhenListed();
      void ctx.sessions.refresh().then(openWhenListed).catch((error) => {
        console.warn("KodBox DSH session navigation failed:", error);
      });
      ctx.effect(() => stop, "kodbox-office-tools: open handoff session");
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = "kodbox-office-tools/client";
    return module.exports;
  }
});
