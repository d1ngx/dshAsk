+window.__ModuleLoader__.load({
  id: "kodbox-office-tools",
  factory: () => {
    const module = { exports: {} };
    const exports = module.exports;
    const inject = ["uiWorkspace", "sessions", "commandUi", "conversation"];

    function cookieValue(name) {
      const prefix = name + "=";
      const item = document.cookie.split("; ").find((part) => part.startsWith(prefix));
      return item ? decodeURIComponent(item.slice(prefix.length)) : "";
    }

    function sessionFromLocation() {
      const target = new URL(window.location.href);
      const query = target.searchParams.get("kodboxSession") || "";
      const cookie = cookieValue("kodboxSession");
      const sessionId = /^kodbox-u\d+-[A-Za-z0-9_-]+$/.test(query) ? query : (/^kodbox-u\d+-[A-Za-z0-9_-]+$/.test(cookie) ? cookie : "");
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

    function registerOfficeCommand(ctx) {
      ctx.commandUi.register({
        name: "office",
        description: () => "选择一项 KodBox Office 能力，填入输入框",
        available: () => true,
        ui: {
          kind: "popupSelect",
          async options(session) {
            const response = await fetch("/kodbox/catalog?session=" + encodeURIComponent(session.sessionId), { credentials: "same-origin" });
            if (!response.ok) return [{ id: "none", label: "当前会话不是 KodBox 问答", detail: "请从网盘重新打开" }];
            const data = await response.json();
            const options = [{ id: "ask", label: "普通问答", detail: "直接处理选中的网盘文件" }];
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
              ? "请根据当前网盘选中文件回答。"
              : "请使用能力「" + option.label + "」处理当前网盘选中文件。先读取文件，再生成新副本，不要覆盖原件。补充要求：";
            if (input && typeof input.setDraft === "function") {
              input.setDraft(text);
              if (typeof input.notify === "function") input.notify("info", "已填入能力要求，补充后直接发送。");
              return;
            }
            fetch("/kodbox/ask", {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ sessionId: session.sessionId, agentId: option.id, request: text, style: "professional" })
            }).catch((error) => console.warn("KodBox office command failed:", error));
          }
        }
      });
    }

    function apply(ctx) {
      registerOfficeCommand(ctx);
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
        fetch("/kodbox/catalog?session=" + encodeURIComponent(sessionId), { credentials: "same-origin" }).then((response) => response.ok ? response.json() : null).then((data) => {
          const mentions = Array.isArray(data && data.mentions) ? data.mentions.filter((item) => typeof item === "string" && item.startsWith("@")) : [];
          const fromFiles = (data && data.files || []).filter((file) => file && file.name && file.type !== "folder" && !/[\u0000-\u001f\u007f-\u009f"]/u.test(file.name)).map((file) => /\s/u.test(file.name) ? '@"' + file.name + '"' : "@" + file.name);
          const tools = Array.isArray(data && data.tools) ? data.tools.filter((item) => /^[a-z_]+$/.test(item)) : [];
          const chips = mentions.concat(fromFiles.filter((item) => !mentions.includes(item)), tools);
          if (!chips.length) return;
          let tries = 0;
          const write = () => {
            const input = composer(ctx, sessionId);
            if (input && typeof input.setDraft === "function") {
              const current = input.state && input.state.getSnapshot ? input.state.getSnapshot().draft || "" : "";
              const missing = chips.filter((item) => !current.includes(item));
              if (missing.length) input.setDraft((missing.join(" ") + " " + current).trim() + " ");
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
        if (snapshot.byId[sessionId]) {
          ctx.uiWorkspace.openSession(sessionId);
          seedFiles();
          stop();
        }
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
