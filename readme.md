# 可道云 DSH 问答

在可道云个人空间或企业网盘中提问、引用文件、生成 Office 文档，并把结果保存回当前目录。

## 从这里开始

| 你要做什么 | 文档 |
|---|---|
| 使用问答、生成和预览文件 | [用户帮助](docs/user-guide.md) |
| 排查空间、凭证、预览问题 | [故障排查](docs/troubleshooting.md) |
| 安装配置、更新和回退 | [部署与升级](docs/deployment.md) |
| 对接接口、修改插件 | [开发接口](docs/development/api.md) |
| 理解权限、凭证与空间隔离 | [认证与架构](docs/说明.md) |
| 更新文档和截图 | [文档维护规范](docs/maintenance.md) |
| 浏览所有资料 | [文档索引](docs/index.md) |

当前验证基线：`smanx/deepseek-harness:devtools-min-0.2.0-rc.2`，2026-10-02。当前部署使用 Compose 独立 DSH 容器。

核心代码：`app.php` 负责可道云入口、凭证和文件接口；`integrations/kodbox-file/` 负责 DSH 工具、会话及前端预览；`agents/` 保存能力清单。

修改后运行 `sh tests/run.sh`；已安装匹配的 DSH 运行时后，额外运行 `node tests/runtime-account.cjs`。文档检查单独运行 `python3 scripts/check_docs.py`。
模型密钥、会话凭证、用户文件、`.dsh-runtime/` 和部署实例配置不要提交到仓库。
