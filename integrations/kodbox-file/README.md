# KodBox Office Tools for DSH

本插件整合网盘上下文、帮助检索、管理操作及 Word/Excel/PowerPoint 工具。Office 实现来自 vendor/dsh-office-tools，许可证随源码保留；profile 无需再加载第二个 Office 插件。

当前核对版本：DSH devtools-min-0.2.0-rc.2（2026-10-02）。安装与实例维护见 [部署说明](../../docs/deployment.md)，路由、参数及认证见 [开发接口](../../docs/development/api.md)，测试及文档更新见 [维护约定](../../docs/maintenance.md)。

工具的 askToken 只来自当前会话绑定，不从工具参数、共享环境变量或其他会话借用。网盘路径不是本地路径；Office 工具读取当前会话工作目录中的副本，产物保存成功后映射到网盘文件卡片。浏览器侧凭证校验与工具侧 token 校验各自保留。

/kodbox/task 接收网盘交接；/kodbox/enter 为当前登录账号选定的空间签发新会话。前端模块由同一插件提供，反代前缀通常为 /dsh/。认证、SameSite Cookie、启动保护和网关隔离必须随配套 profile 一起部署。
