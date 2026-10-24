# dshAsk 与 WorkBot 实现差异对比

核对日期：2026-10-20（Asia/Shanghai）。本文比较实现和部署，不以插件版本号推断功能强弱。

## 1. 结论

两套方案都把 KodBox 作为网盘权限和文件存储的权威，但执行模型不同：

- **dshAsk**：PHP 签发会话与空间凭证；共享 DSH 实例通过账号隔离适配器提供服务；Office 工具在服务端根据结构化参数直接生成文件，再将成果上传网盘。
- **WorkBot**：PHP 提供 SSO、身份委托、文件与能力市场接口；`workbot-dsh` 内的 supervisor 为不同用户启动独立 DSH 进程；云盘文件系统走 KodBox API，本机文件与 bash 经 RPC 派给 PC 客户端；Office 新建主要依靠客户端脚本生成及回传链路。
- **Office 能力并非同一种工具的不同包装**：当前 dshAsk 提供明确的 `word_create / excel_create / ppt_create` 参数接口；本次核对的 WorkBot 装配与自定义插件中未发现同名创建工具，其代码明确引导用 PC 上的 Python/Node 脚本生成 docx/xlsx/pptx。
- WorkBot 的能力市场、桌面端、远程执行和 KodBox 模型供应链覆盖面更广；dshAsk 在固定 Office 工具、当前会话成果归属和逐项确认执行上有更集中的实现。

这些是代码结构与现场配置结论，不代表已经完成两边 Office 输出质量、吞吐或安全隔离强度的实测排名。

## 2. 比较对象与证据范围

| 对象 | 样本 | 核对范围 |
| --- | --- | --- |
| 当前插件 | `/Users/fly/01_gits/dshAsk`，Git `c45f859bec70d70e441ed810e33f1d9ec1f7cf61`，package 版本 `1.1.0` | PHP、前端、DSH 集成、Office vendor、配置模板、测试与部署说明 |
| WorkBot 网盘插件 | `/Users/fly/Downloads/workbot`，package 版本 `0.1.0` | `app.php`、`static/main.js`、`class/MarketAudit.php`、package 配置 |
| WorkBot DSH | 节点 202，容器 `workbot-dsh`，容器 ID 前缀 `6e2517d3d87e` | 运行进程、挂载、启动器、supervisor、scratch 插件、profile bundle 及其实际源码 |
| WorkBot 镜像 | `workbot/dsh:0.1.5-rc.2-wb12` | 镜像 ID `sha256:b69a49ffcb997ec81e809ed1c707f337ae8724daa776caf6ceab4eb4e743f6a4` |
| 当前插件的 DSH 基线 | `smanx/deepseek-harness:devtools-min-0.2.1-rc.2` | 本仓库适配及此前部署健康检查；本文未对两代 DSH 内核逐文件全量 diff |

**范围限制：** 下载目录的 WorkBot PHP 样本不等于已证明是现场安装版本。本次没有确认该 PHP 文件与 WorkBot 实际网盘后端逐字节相同。PC 客户端执行器源码未取得，因此文件快照、脚本依赖及回传冲突处理只能确认服务端协议与调用方行为，不能宣称客户端所有实现均已验证。

本次远程操作仅用于读取源码与状态；没有修改或重启 `workbot-dsh`，没有调用模型、上传真实文件、发布能力包或读取用户会话正文与凭据值。

## 3. 总体架构与一次任务的路径

### 3.1 dshAsk

```text
KodBox 浏览器：右键/能力入口
  → dshAsk PHP：核对登录与插件权限，签发 askToken
  → /dsh/kodbox/task：绑定用户、空间、会话、独立工作目录
  → DSH：读取点名引用，执行结构化工具
  → 当前会话工作区：生成 Office 二进制
  → dshAsk saveFile / replaceFile：检查权限与产物归属
  → KodBox：保存文件
  → 工具结果与会话交付卡片：展示网盘预览
```

源码：[PHP 会话创建](../app.php#L755)、[DSH 集成](../integrations/kodbox-file/index.js#L650)、[创建后发布](../integrations/kodbox-file/index.js#L939)。

### 3.2 WorkBot

```text
KodBox 浏览器：跳板/右键
  → workbot PHP：loginToken、DSH cookie、wbAsk 上下文
  → 网关鉴权与用户后端选择
  → workbot-dsh supervisor/router
  → 该用户独立的 DSH 进程与 HOME
      ├─ 云盘 read/write/list → KodBox API（每次调用先向 PHP 借签）
      └─ bash / PC 文件 → poll/result RPC → PC 客户端
                           → 脚本生成 Office → 回传网盘
  → present / deliverables 事件 → KodBox fileView 预览
```

源码：WorkBot PHP `index:184`、`verify:223`、`outputAuthHeaders:509`、`openAsk:2808`；容器 `scratch-plugin/src/kodbox-api.ts`、`remote-bash.ts`、`kodbox-fs.ts`；`/usr/local/bin/workbot-supervisor.mjs`。

**现场确认：** supervisor 进程存在，同时观察到 8 个用户 DSH 子进程；监听端口包含 `3201、3202、3203、3206、3208、3209、3210、3213`。它们使用 `node --import tsx/esm apps/cli/src/bin.ts web --patch ./scratch-plugin/cordis.yml` 启动。容器对宿主只发布回环端口 `3199`，不是每用户各开一个 Docker 容器。

## 4. 核心差异总表

| 维度 | dshAsk | WorkBot | 实际影响 |
| --- | --- | --- | --- |
| DSH 用户运行单元 | 本次部署为共享进程，适配器检查账号与空间 | 一个容器内按用户启动 DSH 子进程与独立 HOME | 隔离的实现位置、进程数量与运维方式不同 |
| 网页入口 | `/dsh/`、`/dsh/kodbox/task` | 默认 `/workbot/`，SSO 跳板及网关按用户路由 | URL 与反代规则不能直接互换 |
| 上下文凭证 | `ask_` + 32 hex，4 小时 | `wb_` + 32 hex，4 小时，另需用户身份 | 两者 token 不能混用 |
| 文件系统 | 会话本地副本 + 显式网盘工具 | `KodBoxFileSystem extends RouterFs`，云盘 API 与 PC RPC 双域 | 直接移植文件读写工具会改变实际落盘位置 |
| Office 新建 | 服务端结构化生成 docx/xlsx/pptx | 服务端引导 PC 远程 bash 生成并回传 | 前者无需 PC 在线；后者依赖客户端环境 |
| 原生 bash | 网盘用户受适配器限制 | 本地服务端执行器关闭，改为远程 bash provider | WorkBot 有额外的客户端任务执行通道 |
| 新建成果重名 | 网盘创建采用 rename；替换受当前会话归属限制 | 通用 fsWrite 为覆盖；特定 PC 预览上传先删同名再上传 | 对原件保护的默认语义不同 |
| 附件上传 | 浏览器 → DSH → PHP/KodBox，并保留本地副本 | prepare 后由浏览器走 KodBox 原生上传 | 网络跳数、DSH 内存与缓存负担不同 |
| 能力扩展 | 声明式 JSON 能力与指令注入 | 能力包审核、分类、发布、撤回、卸载、重扫 | WorkBot 是包生命周期管理，不能只复制能力 JSON 替代 |
| 模型配置 | DSH 原生 provider + 定制管理员设置页 | 关闭两条原生接入线，从 KodBox aiDoc 接口获取模型清单 | 模型配置的权威来源不同 |
| 文件交付 | 创建/修改 hook 自动发布与附加预览 | `present` 提示规则 + bash 回传后自动 present | 两者都使用事件/元数据，单靠回答文本不保证出现卡片 |
| 管理操作确认 | 逐项 pending，浏览器 owner 确认 | 市场部分操作要求 confirm；通用文件 API 无同等统一 pending 队列证据 | `confirm=1` 与独立人工确认队列的强度不同 |

## 5. Office 创建与修改：详细对比

### 5.1 dshAsk 的生成器

实现位于 [vendor/dsh-office-tools/index.js](../integrations/kodbox-file/vendor/dsh-office-tools/index.js)，由集成层 `applyOfficeTools(ctx, { enablePptTools: true })` 注册。

| 工具 | 关键输入 | 文件构造 | 当前边界 |
| --- | --- | --- | --- |
| `word_create` | path、title、paragraphs、bullets、table、overwrite | `buildDocxText` 构建 Word XML 与关系部件，ZIP 打包 | 基础段落、列表和一个可选表格；参数没有完整的复杂版式接口 |
| `excel_create` | path、sheets[{name,rows}]、overwrite | 行列数据 → worksheet XML → workbook/关系/类型清单 → ZIP | 支持标量单元格与 `=` 公式；写入公式不等于执行公式重算 |
| `ppt_create` | path、title、slides、图片与坐标等 | 构建 16:9 演示文稿、幻灯片、关系、备注及图片部件 | 支持文本和图片布局，不能据此等同完整 PowerPoint 设计引擎 |

定位：Excel 注册 `:665`、PPT 注册 `:1528`、Word 注册 `:2018`；`saveOfficePackage:260` 统一校验并保存。

底层 [office-bytes.js](../integrations/kodbox-file/office-bytes.js) 自行处理 CRC32、ZIP local/central records、存储/deflate 压缩及二进制写入；不是通过改扩展名伪装 Office 文件，也不是调用桌面 Office。`saveOfficePackage` 最终经 `ctx.fs.processPath` 和 `writeOfficeFile` 写入本地工作区。这里应区分“使用 DSH 路径能力”与“Office 文件字节本身由插件写入”。

创建前检查扩展名与工作区，校验 Office 部件及打包结果，响应取消信号。`overwrite` 缺省为 false；实际 `assertMayCreate` 会尝试 `名称(1)` 等可用名称，而非一律报重名错误。

读写补充：

- `word_read / word_update` 支持文本提取及已有文档内容追加；不是任意 Word 元素编辑器。
- `excel_read` 通过独立 worker 调用 vendored SheetJS，覆盖旧 BIFF `.xls` 与 `.xlsx` 读取；有行数、单元格和输出字符限制。
- `excel_update` 处理已有 OOXML 部件，底层尽量保留未修改 ZIP 条目的原始压缩字节，针对单元格修改保留已有样式索引。
- 当前注册了 `ppt_create / ppt_read`，不能据此推断存在同等的 `ppt_update`。

### 5.2 dshAsk 创建后的网盘发布

[集成层 tools/execute hook](../integrations/kodbox-file/index.js#L939) 对创建和修改操作串行处理：

1. 使用当前会话绑定，而非从模型参数借用其他 token。
2. 校验真实路径，限制在当前会话工作区；同一文件的执行与发布用锁串行化。
3. 工具执行成功后，读取实际报告的输出路径并调用发布逻辑。
4. PHP `saveFile` 以 rename 策略建新文件，把生成的 source ID 记入 askToken 的 `generated`。
5. `replaceFile` 仅允许替换当前 askToken 已记录的生成文件，仍重新检查网盘写权限。
6. `tools/post-execute` 添加上传后的预览信息，前端按本轮成果生成卡片。

源码：[会话路径与文件锁](../integrations/kodbox-file/session-security.js)、[saveFile/replaceFile](../app.php#L679)。上传失败和本地生成成功是两个状态，不能把本地文件存在当作网盘交付已完成。

### 5.3 WorkBot 的 Office 执行链路

已读取的 `scratch-plugin/src/kodbox-file.ts:722、898、906` 明确引导：用 bash/Python/Node 生成 docx/pptx/xlsx/PDF/图片，使用当前目录下的相对路径；客户端在线时接管执行，并回传产物。

`remote-bash.ts` 的协议实现包括：

- `GET /kodbox/bash/poll`：客户端取出任务，移至 inFlight。
- `POST /kodbox/bash/result`：回传 exitCode、stdout、stderr 及上传文件信息。
- `resolveCloudExchange:207`：将当前云盘路径、明确引用的文件及跨空间附件信息打包给客户端。
- 默认执行 timeout 为 120 秒，可限制在 1～600 秒；另有服务端收尾超时与迟到结果处理。
- `autoPresent`：对回传上传清单过滤临时文件后追加 `deliverables/presented`，降低依赖模型主动调用 present 的程度。

**确证与限制：** 服务端代码和提示词描述了“执行前后快照比较，新增/修改回传”；实际执行快照比较的 PC 侧源码未取得，不能证明其差异算法、重名处理、失败重试或 Python 依赖版本。服务端文字写有 Windows `python` 与 python-docx，但这只是目标环境约定，不是本次对在线 PC 软件安装状态的实测。

### 5.4 Office 使用选择与移植代价

| 场景 | dshAsk 当前路径 | WorkBot 当前路径 |
| --- | --- | --- |
| 服务端独立生成基础表格/文档 | 结构化创建工具直接处理 | 已核对的通用 Office 生成链路依赖 PC 客户端 |
| 复杂模板或自定义脚本排版 | 需要扩展生成器或另接脚本执行服务 | PC 脚本方式可扩展，但效果取决于脚本与依赖 |
| 不允许在 PC 下载业务数据 | 生成与副本位于服务端 | 远程 bash 的交换链路会把引用文件提供给 PC，需符合部署策略 |
| 公式计算与版式渲染 | 不能仅凭创建工具或 capabilities 环境变量认定已计算/渲染 | 不能仅凭有 Python 就认定已计算/渲染 |
| 无客户端或客户端掉线 | 基础 Office 创建不依赖 PC | 服务端实现会检查在线状态并给出引导/失败，而不是自动改在服务器执行 |

不能把 dshAsk 生成器原样注册进 WorkBot 后就认为迁移完成：dshAsk 的 `saveOfficePackage` 需要可写本地路径，而 WorkBot 云盘 `processPath` 会返回 `kodbox:` 伪路径。应先决定在服务端临时目录生成后上传，还是在 PC 执行，再实现发布与归属校验。

## 6. 文件系统、附件与覆盖语义

### 6.1 云盘文件系统的现状

WorkBot `scratch-plugin/cordis.yml` 的顶部仍留有 WebDAV/rclone 早期说明，但实际插入 `kodbox-fs`；其 `src/kodbox-fs.ts` 定义 `KodBoxFileSystem extends RouterFs`，云盘域转换为 KodBox API，`/mnt/kodbox` 等只作为锚点。判断必须依据已装配类与执行方法，不能将旧注释当作当前存储实现。

WorkBot `RouterFs` 将 `/pc-local` 及已上报 PC 目录映射为 RPC；云盘文件系统的版本判断由路径、类型、体积、修改时间及可用 hash 生成。dshAsk 则通过 `kodbox_fetch` 与引用下载拿到会话副本，Office 在副本上运行，之后显式发布。

跨空间也有设计差异：dshAsk `createAskSession` 要求一次提问的引用属于同一选定空间，空间绑定随会话检查；WorkBot 的 `path-grant`、附件索引与 `resolveCommandAttachments` 允许为明确引用的其他空间附件建立授权与交换信息。此处是“会话空间范围”与“附件显式授权”的不同，不应简单比较为谁有权限检查、谁没有。

### 6.2 附件与额度

| 项目 | dshAsk | WorkBot |
| --- | --- | --- |
| 浏览器上传入口 | DSH `/kodbox/upload`，40 MiB 上限，转 PHP 上传 | PHP `attachPrepare` 返回个人空间 `WorkBot/cache/<session>`，客户端再走原生上传 |
| 上传字节是否经过 DSH | 是；还会写本地会话副本 | 附件直传通道不经过 DSH，之后工具处理文件是另一条链路 |
| WorkBot 直传策略 | 不适用 | prepare 下发 100 MiB、10 个文件及扩展名黑名单；不能据 prepare 响应断言所有原生上传限制已统一执行 |
| 兼容旧写入通道 | 不适用 | `fsStageWrite` 保留，旧暂存上限 32 MiB；不能与新直传上限混为一谈 |
| 缓存清理 | 会话缓存与网盘原件分开，本文未验证定时清理 | attachDiscard/Purge/List 与能力回收接口较完整；部分操作可能彻底删除固定缓存范围 |

### 6.3 覆盖与产物归属

WorkBot PHP `fsWrite:1071` 经 `canWrite` 后使用 `REPEAT_REPLACE`，允许覆盖有权限的目标。DSH 的 `/api/workbot.upload-local`（`kodbox-file.ts:975` 附近）为 PC 本地文件预览上传到 `WorkBot/PC-Files/<session>`，先删除同名再上传。该行为只说明这个具体通道，不能推断所有 WorkBot 上传都先删。

dshAsk 的新建与替换是分开的：新建重名改名，替换必须命中当前会话生成记录。这更强调保留原件，但也意味着过期或旧会话的产物不能无条件继续原位替换。

## 7. 身份认证、隔离与安全实现

### 7.1 dshAsk

- PHP 入口使用 `requireBrowserUser`，包含登录与插件使用权限；调用时重查用户、角色、空间权限。
- askToken 是短期上下文凭证；内部同时使用 KodBox accessToken/会话绑定机制，不能将 askToken TTL 等同所有内部凭证的寿命。
- askToken 文件通过临时文件、锁和 rename 写入，权限设为 0600；当前会话与成果归属均保存在服务端。
- `account-guard.js` 在共享 DSH 的 HTTP、RPC、WebSocket 和事件路径上按用户过滤；长连接每 15 秒重新检查登录和空间状态。
- `bootstrap-guard.js` 在保护器未就绪或卸载后拒绝相关请求；限制原生任意文件、宿主设置和终端入口。

**边界：** 工作区路径限制和请求过滤不等于每用户操作系统沙箱。共享 Node 进程中的其他插件、任意本机执行能力与原始文件权限仍需要独立评估。

### 7.2 WorkBot

- 网页 SSO 的 `loginToken` 为 `base64(name)|md5(name+apiLoginToken)`；该格式本身没有时间字段。校验端额外查用户是否仍启用。
- `dshBrowserCookie` 为用户 DSH authority 签发 HMAC-SHA256 浏览器 cookie，代码设为 30 天、HttpOnly、SameSite=Strict；有效权限仍取决于网关与后端检查，不能只看 cookie 寿命。
- supervisor 按用户维护 HOME、进程、端口与独立浏览器签名密钥；观察到的持久化 HOME 为 `/data/u<uid>/dsh`。
- DSH 数据调用已改为每用户 data ticket → PHP `signCall` → 目标 API 的两段流程；DSH 侧不再需要持有 KodBox appSecret 来自签任意用户身份。补充核对：`kodbox-api.ts:269` 有 120 秒签名缓存，命中时跳过借签，所以并非每个目标调用都会访问 PHP signCall。
- `signCall` 被实际调用时查询用户 `status=1`，绑定身份并限制签名路由；客户端还有一份更窄的 `ROUTE_ALLOW`。签名绑定 action/参数，但不能据此宣称同一请求绝对不可重放：本次未确认 nonce、一次性消费或短时签名过期检查。
- 桌面端还有 dev token、bashVerify 与 WebDAV 身份兼容接口，认证入口比 dshAsk 多。

**隔离限制：** 每用户进程与 HOME 能分开 DSH 状态，但这些子进程仍在同一个容器；后续读取 `/proc/<pid>/status` 确认这 8 个 DSH 子进程均为 UID 0；没有建立逐用户 Linux UID 隔离，也未证明逐用户 namespace、文件权限沙箱及密钥目录访问隔离。因此“每用户一进程”不等于已经具备强操作系统隔离。

### 7.3 需专项复核的代码点

以下是源码可定位的复核项，不作为已完成利用验证的漏洞结论：

| 位置 | 观察 | 应验证的实际条件 |
| --- | --- | --- |
| WorkBot PHP `makeLoginToken:914`、`deviceRegister:535` | 登录上下文缺失时可从 `Cookie::get('kodUserID')` 查用户兜底 | Cookie 是否经 KodBox 内核签名/校验，路由前置鉴权是否足够；不能只凭变量名认定可信或可伪造 |
| WorkBot PHP `outputAuthHeaders:509` | `isAdmin` 使用 `KodUser::isRoot() || roleID == '3'` | 自定义角色部署里是否与真实 administrator 权限一致 |
| WorkBot PHP `writeWbAskToken:2992` | 直接写 JSON，未像 dshAsk 显式 chmod 0600、临时文件 rename | 现场 umask、目录权限、并发读写失败处理 |
| WorkBot `wbSignRouteAllowed:2310` | PHP 允许较宽 explorer 模块正则及 workbot/aiDoc 插件路由 | 新端点加入后是否意外扩大可借签能力；Node/PHP 两份清单是否持续一致 |
| WorkBot PC 上传预览通道 | 删除同名后再上传 | 上传失败是否留下缺口，是否需要原子替换与更严格的 sessionId/路径验证 |
| WorkBot secret 目录与子进程 | supervisor 挂载并读取多用户密钥 | 子进程 OS 身份和访问权限是否允许读取其他用户文件 |
| dshAsk 共享 DSH 适配 | 动态保护运行时 HTTP/RPC/WS 与文件入口 | 上游升级后所有新接口是否继续受保护，运行时兼容检查是否覆盖 |

## 8. 管理操作与人工确认

当前 dshAsk 的网盘管理写操作会排成 pending 条目，多项目操作拆分。浏览器按 owner 身份确认某一条，服务端重新核对权限，使用锁防止重复执行；失败保留条目。主要实现为 PHP `enqueueAll`、`commitPending:1050`、`runPending`，DSH `/kodbox/pending` 与前端确认 UI。

WorkBot `kodbox-file.ts` 提供读写、移动、复制、删除、搜索、RAG、分享、回收站等工具，范围更广。市场发布、撤回、硬删除等 PHP 操作要求 `confirm=1`，但这是一项请求参数；不能自动视为模型无法伪造的浏览器人工确认。装配注释还描述角色审批策略，本文未执行真实审批流程，不把它等同 dshAsk 的逐项服务端 pending 机制。

## 9. 能力广场与能力市场

### 9.1 dshAsk：声明式能力

[AgentRegistry](../lib/AgentRegistry.php) 从 `agents/*.json` 及扩展目录读取 manifest，限制大小、ID、字段、分类并排除符号链接。能力以指令、输入要求及输出约束交给会话，分类包括 general、word、excel、powerpoint；它不执行 manifest 中的 PHP 或远程代码。

前端提供能力广场与 `/skill`、`/office` 选择。适合维护受控任务模板，但不是完整的第三方能力包发布平台。

### 9.2 WorkBot：能力包生命周期

PHP `MarketAudit` 负责 ZIP/TGZ/MD 包的识别、扫描、manifest 构造、分类、子能力与安全检查；市场端点覆盖审核、安装落盘、发布、撤回、卸载、回收、元数据修改与子项重建。DSH `dsh-capability-market` bundle 提供加载与 UI。

市场区分个人与 official，存放于网盘 `WorkBot/Market`。审核与文件操作主要在 KodBox PHP 中完成，DSH 负责调用与呈现。代码存在越界路径、符号链接、外联、可执行内容及体积限制逻辑，但不能把静态包审核描述为任意脚本的安全执行沙箱。

`MarketAudit` 声明上限包括 2000 条目、单文件 32 MiB、解压总量 256 MiB；是否在解压前后所有通道严格执行、是否能防压缩炸弹，需专项运行测试。下载包未附带其注释引用的完整验收脚本。

## 10. 模型、记忆与交付 UI

| 项目 | dshAsk | WorkBot |
| --- | --- | --- |
| 模型权威来源 | DSH provider 配置；自定义管理员设置页管理 llm-deepseek / llm-pi-ai | `workbot-llm.ts` 默认从 KodBox `plugin/aiDoc/apiKeyRefresh` 获取清单与调用配置 |
| 默认 provider 装配 | 保留原生接入，替换管理员 UI | scratch patch 明确禁用 llm-deepseek、llm-pi-ai，插入 workbot-llm |
| 模型刷新 | 由管理员接口与 DSH 配置机制驱动 | 启动刷新与定时刷新，默认 60 秒；不可达不应据旧注释推断自动回落原生 DeepSeek |
| 记忆网盘镜像 | 本次未发现同等专用模块 | `memory-mirror.ts`、`memory-search.ts` 提供镜像与检索模块 |
| 文件交付 | 自动上传后的 preview、按会话与轮次的成果记录 | present 事件驱动；bash uploaded 列表额外自动生成 present |
| 预览 | 网盘链接、右侧预览；文本另有预览逻辑 | `workbot-kodbox-preview` 使用 KodBox fileView iframe；PC 文件可先上传 |
| UI 扩展组织 | 一个主要 client.js，加管理员模块 | workspace UI、session link、preview、dir、plus-menu、soft-folding 等多个 bundle |

WorkBot 模型清单刷新失败时，`workbot-llm.ts:856` 保留已有路由表；首次尚无成功清单时则不会凭空恢复原生模型。它不是“每次接口不可达就立即清空所有旧模型”。

WorkBot 的实际用户 web profile 清单已读取，8 个用户均列出上述主要 bundles。本文没有读取用户模型密钥，也未通过模型接口做有效性或费用测试。

## 11. 部署、升级与故障面

| 维度 | dshAsk 当前部署 | WorkBot 现场实现 |
| --- | --- | --- |
| 代码来源 | PHP 插件与 DSH integrations 目录 bind mount | 镜像中源码与 bundle；用户 HOME 持久化 volume |
| 入口 | `scripts/docker-start.cjs` → DSH → TCP relay | workbot entrypoint/supervisor → 多个用户 DSH → Host 路由 |
| 持久化 | dsh/home、workspaces 与 KodBox site/data | `/data` volume；`/run/workbot/secrets`、config 只读挂载 |
| 升级配套 | PHP、集成、profile、启动器同步 | PHP、镜像、profile 模板、supervisor、密钥/用户同步与 PC 协议需配套 |
| 健康指标 | 进程 HTTP 与容器 healthy | 容器健康之外还需检查每用户进程、密钥与端口路由 |
| 额外故障点 | 共享 DSH 适配与会话凭证过期 | 用户实例未唤醒、密钥未发布、Host 基准不一致、PC 离线、回传失败、模型清单服务不可达 |

WorkBot supervisor 支持 always-on 与 lazy 生命周期策略、用户收敛、按需唤醒与端口映射。默认值不等于现场配置，本次只确认多用户进程实际运行，未对策略切换做操作性测试。

当前插件部署文档要求同源 `/dsh/`，但根 `package.json` 中 `dshUrl` 默认仍是 `http://127.0.0.1:3081/`。这是源码默认与推荐部署的不一致点，迁移或全新安装应显式设置；本文未修改该默认配置。

## 12. 测试与结论可信度

### 已进行

- 静态阅读两边 PHP、主要 DSH 自定义实现、配置装配与前端关键路径。
- 读取 WorkBot 运行容器、镜像 ID、挂载和实际 DSH 进程命令。
- 读取 WorkBot 用户 web profile 的 bundle 清单，仅输出模块信息，未读取会话内容或输出密钥。
- 对关键源码记录 SHA-256；Office 结论同时有工具注册/生成代码与远程执行代码支持。

### 沿用本会话此前的 dshAsk 验证记录

部署前执行 `sh tests/run.sh`，在 `tests/session-security.cjs:192` 对 `finalized.content.at(...)` 的断言处出现 TypeError，整套运行提前终止。随后单独运行其余 Office bytes、旧 XLS、model recovery、TCP relay、client、client experience、concurrent writes、account guard、bootstrap guard 与 launch-output 检查通过。文档检查另报告 `/kodbox/reference/add` 与 `plugin/dshAsk/skillText` 未登记。不能将这次结果写成“全套回归通过”，也不能只据测试失败认定所有生产预览都失败。

### 未进行

- WorkBot PC 客户端真实执行、Office 软件打开、重算、页面渲染和逐页视觉验收。
- 两边同一任务的耗时、内存、并发吞吐、费用与故障恢复对照。
- WorkBot 完整测试套件、真实能力发布及权限撤销端到端验证。
- Cookie fallback 利用、跨用户文件访问和容器内 OS 权限隔离专项测试。
- 两代 DSH 内核的完整 diff 或业务会话数据格式迁移验证。

## 13. 建议与兼容策略

1. **继续以服务端基础 Office 创建为目标**：保留 dshAsk 的结构化工具；扩展样式、模板、计算或渲染时分别增加实现与验收，不把 capabilities 字符串当作完成证据。
2. **引入复杂脚本生成**：可参考 WorkBot 的客户端任务/产物回传协议，但先决定 PC 执行是否符合数据策略，以及无客户端时的处理方式。
3. **借鉴账号进程拆分**：可让 dshAsk 改为每用户 DSH，但要同时设计 OS 身份、文件权限、凭据挂载与资源限制；只拆进程不足以解决所有隔离问题。
4. **借鉴能力市场**：优先复用包 manifest、审核与生命周期设计，保留当前声明式能力的轻量入口；不要直接把可执行包等同可信指令。
5. **保持明确的成果替换规则**：迁移 WorkBot 回传链路时保留 dshAsk 的当前会话生成记录，避免将通用覆盖接口直接接到所有模型产物。
6. **不要混用配置文件**：两代 DSH、不同 provider、路径能力及 bundle 接口均有差异，应按功能逐模块适配，再用同一 Office 样本验证生成、保存、修改、预览与错误回报。

## 14. 用户运行单元隔离：深度评价与简化决策

### 14.1 实测资源快照

2026-10-20 本次比较期间，节点 202 的只读快照如下。它不是等负载 benchmark，不用于推算“性能提高多少倍”。

| 项目 | WorkBot | dshAsk |
| --- | --- | --- |
| DSH 用户进程 | 8 个 | 此前确认的共享 DSH 实例 |
| docker stats 容器内存 | 2.309 GiB | 200.1 MiB |
| Docker PIDS 指标 | 220 | 19 |
| 单个用户 DSH 的 VmRSS | 312860～354288 KiB，约 306～346 MiB | 未单独读取主进程 RSS |
| WorkBot 子进程 UID | 8 个均为 0 | 本次未单独采样 UID |
| 同次 CPU 瞬时值 | 100.97% | 0.31% |

PIDS 包含线程等 Linux task，不等于有 220 个业务进程。RSS 可能重复计入共享页，不能求和后与容器内存直接比较。WorkBot CPU 约 100% 的瞬时值需排除启动、业务请求及后台任务后再判断，不能据此声称它空闲时恒占一核。多用户模型上下文、历史索引与会话状态不会因为合并进程自动消失。

### 14.2 两种隔离各保护什么

| 风险或诉求 | 每用户 DSH 进程 | 共享 DSH + 账号适配 |
| --- | --- | --- |
| 模块变量误共享 | 进程天然分开，多数单例只看见一个用户 | 必须为每个单例增加用户/会话作用域 |
| DSH 子进程崩溃 | 通常只影响该用户；supervisor/容器故障仍影响多人 | 主进程崩溃影响全部在线用户 |
| 同步 CPU 阻塞 | 每个进程有自己的事件循环，可由 OS 分配多核 | 同一事件循环可能拖慢全部用户；worker 才能分离部分工作 |
| Node/V8 基础内存 | 每个运行用户重复支付 | 可共享一份运行时、模块代码和部分连接/缓存 |
| 进程被完全攻破 | 是否能读其他用户数据取决于 OS 权限；现场均为 root，不应假设不可读 | 可访问同进程全部用户状态，内存中的隔离不再有效 |
| 撤销用户权限 | 同步器停进程 + 每次身份检查，效果依具体通道与缓存 | 每请求、工具调用、长连接持续重新检查，依赖覆盖完整性 |
| 上游新增 API | 用户私有实例可减少跨用户状态过滤需求，但仍需网关与 ACL | 必须确认新 API 的访问与结果过滤，通常默认拒绝 |
| 资源公平性 | 更方便按进程统计/终止，但同容器不自动具备逐用户硬配额 | 需要应用层队列、并发上限与用量归属 |
| 网盘越权 | 仍靠 KodBox 身份、ACL 与路径校验 | 同样靠 KodBox 身份、ACL 与路径校验 |

评价：WorkBot 的进程拆分有真实价值，主要是状态分离与部分故障隔离；现场 root 进程不能被描述为强租户沙箱。dshAsk 的节省来自共享运行时，但要求所有对外入口和状态都正确携带用户身份；它通过缩小可用能力范围降低这项工作的复杂度。

### 14.3 WorkBot 不能直接删 supervisor 改成一个进程

当前实现将“当前用户”放在进程环境与模块状态中：

| 代码依赖 | 当前含义 | 合并进程必须做的变更 |
| --- | --- | --- |
| `kodbox-api.ts:163` 的 `DSH_KODBOX_USERID`、`cachedTicket` | 一进程一用户、一份票据 | 从可信请求/任务上下文选用户；按用户存取凭据 |
| `kodbox-api.ts:269` 的 signCache | 键是 route + args；独立进程隐含用户 | 键必须含用户及凭据代次；撤销/轮换需清理 |
| `client-online.ts` 的单例 `lastPollAt` | 任一 poll 即当前用户 PC 在线 | 按 userID/deviceID 维护在线状态与设备选择 |
| `remote-bash.ts` 的 pending/inFlight 与 poll/result | 同进程队列隐含同一用户 | 任务绑定 owner、设备与 session；领取/回传都校验归属 |
| `attachment-index.ts` 的全局索引与 `$DSH_HOME` | 一个用户附件索引文件 | 按用户与会话分区，禁止跨账号按同名附件补全 |
| `index.ts` 的 resolvedUser、spaceMap、baselineCache、pcLocalPath | 一个用户身份、空间、客户端路径 | 用户作用域服务；持久化与缓存也需同样分区 |
| 独立 HOME 下的会话、记忆和 settings | 进程天然只打开本用户数据 | 显式 owner 数据访问层；列表、搜索、事件、导出都过滤 |
| 浏览器 authority 与 cookie | 用户端口对应独立实例和密钥 | 重建共享入口登录模型，并保留真实用户检查 |
| 模型目录与 provider adapter | 当前进程替一个用户取配置 | 用户相关可见模型与调用凭据不能用一个全局活动配置替换 |

例如：只把任务队列改成一个 Map，却没有在 poll/result 校验 userID，A 的客户端就可能领取 B 的命令；只复制 dshAsk 的 HTTP 过滤也不能修复 WorkBot 模块内部依然使用进程环境用户的问题。AsyncLocalStorage 可传递已验证身份，但不能自动修复模块单例、持久化目录、异步恢复任务和 RPC 任务归属。

### 14.4 效率收益与代价

**可获得：** 减少重复 Node/V8 启动、模块加载、后台计时器和部分模型/空间目录刷新；降低空闲常驻内存；同一进程可共享只读资源；入口不必为每用户维护实例唤醒、端口和 cookie authority。

**不会自动获得：** 模型推理加速、token 费用下降、PC Office 脚本加速、文件上传带宽下降或 KodBox API 减少。借签与 dshAsk 身份检查均有开销；若共享进程仍为每个用户执行相同后台工作，只是把任务搬到一个进程，不会消除业务工作量。

**主要付出：** 全面重构状态作用域，增加跨用户并发与权限撤销测试；共享主进程扩大故障影响；单事件循环减少部分 CPU 并行性；所有插件扩展和上游新接口都要经过租户适配审查。若保留远程 bash、PC 文件、跨空间附件、记忆与市场能力，改造范围明显大于只部署 dshAsk 现有功能。

容量估算可采用：`进程制内存 ≈ 常驻用户数 × 单用户基础开销 + 活跃状态`；`共享内存 ≈ 一份基础开销 + 全体活跃状态 + 租户索引`。现场约 300 多 MiB 的用户 RSS只能作为进一步测量线索，不是每新增用户固定成本，也不是合并后可全数消除的成本。

### 14.5 推荐路径

**当前建议：先优化 WorkBot 的用户进程生命周期，不立即改为全共享。** 理由是已经存在 lazy 策略与按需唤醒，而单用户假设散布于身份、文件、客户端与模型链路。对已有系统，缩减常驻进程通常比重写租户架构更容易验证和回滚。

1. 在测试部署评估 lazy：没有活跃会话、未完成任务、客户端连接或重要后台作业的用户可停机；持久化 HOME 保留；首访唤醒。不能简单把“网页没有请求”等同于“没有任务”。
2. 把允许常驻的核心用户与普通用户分开；衡量常驻数、冷启动时间、任务恢复、PC 重连和密钥更新。
3. 统计后台轮询与刷新。客户端 poll、模型清单、空间目录刷新应分别测量，不能把请求总数都归因于进程数。不要为了少一次校验无限延长授权缓存。
4. 对少数活跃用户先采用进程池/分组方案时，应明确一个 worker 仍只服务一个用户，或该 worker 已完成多租户改造；不能让未改造进程在不同用户请求间临时切环境变量。
5. 只有确认目标主要是网页问答、受控网盘工具和基础 Office，而且可以舍弃或重做桌面链路时，再评估 dshAsk 式共享服务。先收敛功能，再建立完整的用户状态接口，避免逐个修补串号点。

若目标是互不信任用户的强隔离，应沿相反方向增强：为执行单元使用独立 OS 身份/容器与凭据访问限制，而不是把 root 子进程简单合并。是否引入这些措施取决于实际威胁模型与执行能力，不以人数单独决定。

### 14.6 一个需要纠正的撤权细节

进一步核对发现 WorkBot `borrowSignature` 在调用 PHP 前检查 120 秒 route+args 缓存。故“PHP signCall 每次检查 status=1”是端点自身的事实，不等于每个下游 API 都实时经过该检查。缓存命中会暂时复用旧签名，是否还能被其他网关、目标端点或进程收敛阻止，要逐通道确认。相比之下，dshAsk account guard 只合并同时进行的身份检查，不跨请求保留已完成的身份缓存。优化性能时，应把撤权生效时间作为明确指标，而不是仅测平均响应时间。

### 14.7 迁移验收应证明的事实

若决定共享化，至少证明：A/B 同时列会话与搜索不串；A 的 PC 无法领取/回传 B 的任务；附件同名不跨用户；用户冻结、退出、撤销空间权限和凭据轮换按预期生效；重连、后台任务和恢复任务带有不可伪造的 owner；插件未就绪与升级新增入口默认拒绝；大任务不能无限占用其他用户资源；进程故障后的恢复和数据归属正确。

上线前应在相同 DSH 版本、同等功能、相同活跃用户与任务集下比较容器 working set/PSS、稳定 CPU、p95 延迟、首访唤醒、连接数和撤权延迟。当前 2.309 GiB 对 200.1 MiB 的快照不足以代替这组验收。

## 附录 A：源码定位索引

以下 W 路径为节点 202 的 `workbot-dsh` 容器内部路径，P 为本机下载插件，D 为当前仓库；行号仅对本次快照有效。

| 编号 | 路径/定位 | 说明 |
| --- | --- | --- |
| D1 | `app.php:58、87、755、1992、2033` | 入口、会话、身份和 token 持久化 |
| D2 | `app.php:679、709、740、1050` | 创建、成果归属、替换和确认执行 |
| D3 | `integrations/kodbox-file/index.js:852、939、963、975` | Office 注册、发布、预览和上传 |
| D4 | `integrations/kodbox-file/vendor/dsh-office-tools/index.js:260、665、1528、2018` | Office 包保存与三类创建工具 |
| D5 | `integrations/kodbox-file/office-bytes.js`、`office-package.js` | ZIP 二进制及校验 |
| D6 | `integrations/kodbox-file/account-guard.js`、`session-security.js` | 账号、会话与路径限制 |
| D7 | `lib/AgentRegistry.php`、`integrations/kodbox-file/kodbox-web.patch.yml` | 能力与装配 |
| P1 | `/Users/fly/Downloads/workbot/app.php:184、223、427、509` | SSO、浏览器 cookie 与后端身份头 |
| P2 | 同文件 `:535、914、959、992` | 设备注册及身份认证 |
| P3 | 同文件 `:1054、1071、1303、1652、1716` | 文件 API 与附件落点 |
| P4 | 同文件 `:1897、2335、2389` | 用户同步、数据票据与借签 |
| P5 | 同文件 `:2808、2863、2992` | wbAsk 创建、上下文和存储 |
| P6 | 同文件 `:3135、4167、4421、4569、5314` | 能力审核与生命周期 |
| P7 | `/Users/fly/Downloads/workbot/class/MarketAudit.php` | 包安全扫描与 manifest |
| W1 | `/usr/local/bin/workbot-supervisor.mjs` | 用户进程与 HOME、端口和密钥管理 |
| W2 | `/usr/local/bin/workbot-entrypoint.sh` | 模板初始化与 profile 合并 |
| W3 | `/opt/workbot/dsh/scratch-plugin/cordis.yml` | 自定义执行器、FS 与模型装配 |
| W4 | `/opt/workbot/dsh/scratch-plugin/src/kodbox-api.ts:103、275、420` | API 白名单与借签调用 |
| W5 | 同目录 `kodbox-fs.ts`、`router-fs.ts` | 云盘 API 与 PC RPC 文件系统 |
| W6 | 同目录 `remote-bash.ts:207、239、272、297` | 文件交换、自动交付与执行 RPC |
| W7 | 同目录 `kodbox-file.ts:722、898、975` | 脚本生成引导与本地文件预览上传 |
| W8 | 同目录 `workbot-llm.ts:843、968` | KodBox 模型刷新与适配器 |
| W9 | `/opt/workbot/home-template/profiles/web/package.json` | 内核与自定义 bundle 清单 |
| W10 | `/opt/workbot/home-template/profiles/web/node_modules/workbot-kodbox-preview/lib/index.js` | present 规则；同包 client.js 提供预览 |

## 附录 B：样本校验值

```text
dshAsk app.php
6f7b5565e09bd9598965f878d5850f747d85855b9a0029bb5555e085b5f0a3ce

Downloads/workbot/app.php
81b8ec59c39acadd2275a36eb58edda1d9206dc3a7fc5ec10b2f1cf206141ca2

Downloads/workbot/class/MarketAudit.php
6b6256c22985a573cdbdbf02575970c3b1c01791cc7dfb139d115c69ea8a3c36

workbot-dsh scratch-plugin/src/kodbox-file.ts
12016ae9014a705f7f7a49c3eb97a1ae8b7f45d7248d5404d1edc0a1ef34053b

workbot-dsh scratch-plugin/src/kodbox-fs.ts
77dc83199674c6db40bc349f902913ce11c5f7ed9cfe9db2527deefba47ee038

workbot-dsh scratch-plugin/src/remote-bash.ts
a578f4759f80625e91dc9ace857ff5bd13033e02fcc612f0ba184035436b4dc8

workbot-dsh /usr/local/bin/workbot-supervisor.mjs
8fcab629760b64bac905d0e2cd6c555a18bd8f8a5cc0d85986ca2ef080527895
```
