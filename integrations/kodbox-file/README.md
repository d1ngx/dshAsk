# KodBox Office Tools for DSH

这是一个整合版 DSH 插件，单个插件入口同时注册 KodBox 上下文/目录工具，以及 Word、Excel、PowerPoint 工具。Office 工具基于开源 `dsh-office-tools@1.0.3`，源码与 MIT 许可证保存在 `vendor/dsh-office-tools`，profile 不再单独加载第二个 Office 插件。

工具包括 `kodbox_context`、`kodbox_workspaces`、`kodbox_list`、`word_create/read/update`、`excel_create/read/update`、`ppt_create/read`。Office 工具通过 DSH 官方文件服务操作当前会话工作区；KodBox 工具使用一次性 `askToken` 获取网盘上下文与目录信息。

`askToken` 优先来自工具参数，其次来自 `KODBOX_ASK_TOKEN`。任务交接路由从本次 URL 获取 token 并注入当前会话，不将 token 写入共享 profile。KodBox 路径不是本地路径；Office 工具操作 DSH 会话工作区中的文件。

浏览器端也由同一插件提供。`/kodbox/task` 创建会话后，已登录浏览器进入 `/?kodboxSession=<sessionId>`。尚未登录时先返回本站页面，再由脚本打开带启动 token 的地址：DSH 的登录 cookie 是 `SameSite=Strict`，从 KodBox 直接 303 过去时浏览器不会在下一步带上它。客户端选中刚创建的交接会话，并在页面上提供普通问答或 Office 能力选项。需启用 Web client module loader；该 profile 已使用 DSH web app bundle。
