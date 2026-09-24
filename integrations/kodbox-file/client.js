window.__ModuleLoader__.load({
  id: "kodbox-office-tools",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const jsx = require("react/jsx-runtime");
    const react = require("react");
    const inject = ["uiWorkspace", "sessions", "commandUi", "conversation", "documentPreviews", "slots"];
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
        .then((response) => response.ok ? response.json() : null);
    }

    // Replace each "@path" placeholder with a native file chip, last one first
    // so earlier spans keep their offsets.
    function insertFileChips(input, files) {
      const text = files.map((file) => file.mention).join(" ") + " ";
      input.setDraft(text);
      let offset = text.length - 1;
      for (let index = files.length - 1; index >= 0; index -= 1) {
        const file = files[index];
        const start = offset - file.mention.length;
        const snapshot = input.state.getSnapshot();
        input.insertReference({
          source: "reference",
          ref: file.mention,
          label: file.name,
          appearance: "file",
          clipboardText: file.mention
        }, { start, end: offset, draftRev: snapshot.draftRev });
        offset = start - 1;
      }
    }

    function hideUnusedCommands(ctx) {
      const ui = ctx.commandUi;
      if (!ui || typeof ui.candidates !== "function" || ui.__kodboxHidden) return;
      ui.__kodboxHidden = true;
      const hidden = new Set(["export", "model"]);
      const original = ui.candidates.bind(ui);
      ui.candidates = async (session, req) => {
        const rows = await original(session, req);
        return rows.filter((row) => !hidden.has(row.name));
      };
    }

    function registerOfficeCommand(ctx) {
      ctx.commandUi.register({
        name: "office",
        description: () => "选择一项 KodBox Office 能力，填入输入框",
        available: () => true,
        ui: {
          kind: "popupSelect",
          async options(session) {
            const data = await catalog(session.sessionId);
            if (!data) return [{ id: "none", label: "当前会话不是 KodBox 问答", detail: "请从网盘重新打开" }];
            const options = [{ id: "ask", label: "普通问答", detail: "直接处理引用的网盘文件" }];
            for (const agent of data.agents || []) {
              const missing = agent.missingRequires || [];
              options.push({
                id: agent.id,
                label: agent.name,
                detail: missing.length ? "缺少 " + missing.join("、") : (agent.description || "")
              });
            }
            return options;
          },
          onSelect(option, session) {
            if (option.id === "none") return;
            const input = composer(ctx, session.sessionId);
            const text = option.id === "ask"
              ? "请根据引用的网盘文件回答。"
              : "【" + option.label + "】请处理引用的网盘文件，结果另存到原文件所在目录，不要覆盖原件。补充要求：";
            if (input && typeof input.setDraft === "function") {
              const current = input.state.getSnapshot().draft || "";
              input.setDraft(current.trim() ? current.replace(/\s*$/, " ") + text : text);
              return;
            }
            fetch(api("/kodbox/ask"), {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ sessionId: session.sessionId, agentId: option.id, request: text, style: "professional" })
            }).catch((error) => console.warn("KodBox office command failed:", error));
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

    function CloudPreview({ resourceAddress }) {
      const file = parseSessionFile(resourceAddress);
      const [state, setState] = react.useState({ loading: true });
      react.useEffect(() => {
        if (!file) { setState({ loading: false }); return undefined; }
        let live = true;
        let timer;
        let attempt = 0;
        const load = () => {
          fetch(api("/kodbox/preview?session=" + encodeURIComponent(file.sessionId) + "&path=" + encodeURIComponent(file.path)), { credentials: "same-origin" })
            .then((response) => response.json())
            .then((data) => {
              if (!live) return;
              if (data && data.href) { setState({ loading: false, ...data }); return; }
              if (attempt++ < 12) timer = setTimeout(load, 1000);
              else setState({ loading: false, ...(data || {}) });
            })
            .catch(() => {
              if (!live) return;
              if (attempt++ < 12) timer = setTimeout(load, 1000);
              else setState({ loading: false });
            });
        };
        load();
        return () => { live = false; clearTimeout(timer); };
      }, [resourceAddress]);
      const name = state.name || (file ? file.path.split("/").pop() : "");
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
          state.loading
            ? jsx.jsx("div", { style: { padding: 24, fontSize: 12, opacity: 0.6 }, children: "正在打开预览…" })
            : state.href
              ? jsx.jsx("iframe", { title: name, src: state.href, style: { flex: "auto", width: "100%", minHeight: 0, border: "none", background: "#fff" } })
              : jsx.jsx("div", { style: { padding: 24, fontSize: 12, opacity: 0.6 }, children: "这个文件还没有保存到网盘，用 kodbox_save 保存后即可预览。" })
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
      kodbox_save: "保存到原目录"
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
      const target = String(model.args.path || model.args.name || model.args.localPath || "");
      const shown = target.split("/").filter(Boolean).pop() || target;
      const localFile = toolName.startsWith("kodbox_") ? model.args.localPath : model.args.path;
      const produced = toolName === "kodbox_save";
      const openedPreview = react.useRef("");
      react.useEffect(() => {
        if (!produced || model.state !== "ok" || !localFile || typeof openFile !== "function") return undefined;
        if (openedPreview.current === localFile) return undefined;
        openedPreview.current = String(localFile);
        openFile(String(localFile));
        return undefined;
      }, [produced, model.state, localFile]);
      const preview = model.result && typeof model.result.preview === "string" ? model.result.preview : "";
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
                title: target,
                onClick: localFile && openFile ? () => openFile(String(localFile)) : undefined,
                style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, color: localFile ? "var(--dsw-alias-brand-primary, #4d6bfe)" : "var(--dsw-alias-label-tertiary)", cursor: localFile ? "pointer" : "default" },
                children: "📄 " + shown
              }) : null,
              status ? jsx.jsx("span", { style: { ...muted, flex: "none", color: model.state === "error" ? "#e5484d" : muted.color }, children: status }) : null,
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

    function registerCloudPreview(ctx) {
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

    function apply(ctx) {
      document.addEventListener("click", (event) => {
        const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
        if (!anchor) return;
        const href = anchor.href || "";
        if (href.indexOf("officeViewer") === -1 && href.indexOf("dshPreview=") === -1) return;
        event.preventDefault();
        window.open(href, "_blank", "noopener");
      });
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
          if (!files.length) return;
          let tries = 0;
          const write = () => {
            const input = composer(ctx, sessionId);
            if (input && typeof input.insertReference === "function") {
              if (!(input.state.getSnapshot().draft || "").trim()) insertFileChips(input, files);
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
