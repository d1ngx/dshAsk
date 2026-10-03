# 插件开发接口

最后核对：2026-10-03。对应 DSH `devtools-min-0.2.0-rc.2`；权威实现为 [app.php](../../app.php) 与 [DSH 服务端](../../integrations/kodbox-file/index.js)。本文描述本项目接口；可道云上游设置接口另见 [允许列表与参数](../kod/api.md)。这些接口目前没有独立版本协商，升级需配套更新 PHP 与 DSH 插件。

## 调用与认证约定

PHP 基址为同源 `/index.php?plugin/dshAsk/方法名`。常规参数通过查询串或表单传递，数组参数按说明 JSON 编码；不要把所有 PHP 请求改成 JSON body。`saveFile`、`replaceFile` 的 body 是原始文件字节，元数据通过查询串传递。普通响应使用可道云 `show_json` 的 `{code,data,info?}`，必须检查 `code`；HTTP 200 本身不代表操作成功。文件、页面、跳转与登录检查另行说明。

下表认证标记：B 为可道云浏览器登录与插件权限；T 为有效问答 token；O 为浏览器登录账号必须拥有该 token。T 通常执行 `bindAskUser`，重新检查账号、空间和路径权限；`catalog`、`compose` 只读取有效 token 记录。token 参数接受 `token` 或 `askToken`，有效期当前为 4 小时。DSH 启动 token 与问答 token 用途不同，不可混用。

浏览器调用 DSH 使用同源 Cookie，JSON POST 使用 `Content-Type: application/json`。外部地址通常为 `/dsh/kodbox/...`，下表列的是服务内路径。DSH 登录之外，还需验证当前可道云身份与会话归属；不能通过传入 userID 或猜 sessionId 授权。

## PHP 入口与会话

| 路由 | 认证 | 输入及行为 |
| --- | --- | --- |
| `plugin/dshAsk/enter` | B | 跳转 DSH 启动入口，不创建文件交接 |
| `plugin/dshAsk/index` | B | 使用当前目录创建问答并跳转 |
| `plugin/dshAsk/openAsk` | B | `files` 为 JSON 文件数组，`currentPath`；返回交接 link、token 等，勿记录完整响应 |
| `plugin/dshAsk/plaza` | B | `files`、当前目录；返回能力广场 HTML |
| `plugin/dshAsk/agents` | B | 返回 schemaVersion、agents、invalidManifestCount |
| `plugin/dshAsk/openAgent` | B，POST | `agentId,files,currentPath,request,outputFormat,style`；创建任务交接，不表示执行完成 |
| `plugin/dshAsk/capabilities` | B | 返回执行器能力名称列表 |
| `plugin/dshAsk/help` | B | GET：`file` 为 docs 下的 Markdown 相对路径，默认 user-guide.md；返回本地 HTML 阅读页，越界或不存在返回 404 |
| `plugin/dshAsk/identity` | B | 返回 userID、当前可见 workspaces，并重新检查用户权限 |
| `plugin/dshAsk/spaceBinding` | B，POST | `spaceId,spacePath` 必须与可见空间同时匹配；可选 currentPath 仅允许空间内目录；返回新 token、context，供新对话或本人历史访问恢复使用 |
| `plugin/dshAsk/sessionBinding` | O，POST | token；可选 `empty` 清空文件引用并回到空间根目录；派生新 token、context |
| `plugin/dshAsk/context` | T | 返回当前目录、引用文件和空间等上下文，移除内部 accessToken、pending、generated、expire |
| `plugin/dshAsk/owner` | O | 返回 userID、spacePath；只验证归属 |
| `plugin/dshAsk/workspaces` | T 或 B | 有 token 时按绑定身份校验；否则读取登录账号可见空间 |
| `plugin/dshAsk/catalog` | T | 返回 agents、files、currentPath；能力不包含内部 instructions |
| `plugin/dshAsk/compose` | T | `request` 非空且最多 12000 字节；`agentId` 默认 ask，另有 outputFormat、style；返回 prompt，不执行任务 |
| `plugin/dshAsk/loginGate` | 登录检查 | 供 nginx auth_request：已登录返回 200 和 X-Kod-User-Id 等头，否则 401 |
| `plugin/dshAsk/needLogin` | 回跳处理 | HTML 请求跳转登录，API 请求返回 401 JSON；仅接受受限同站回跳路径 |

`files` 元素采用网盘上下文对象，例如 `{path,name,type,pathDisplay,sourceID,targetType}`；网盘路径形如 `{source:123}/`，不可当成本地文件路径。style 支持 professional、minimal、vibrant、preserve；outputFormat 取对应 agent 清单中的 outputs。

## PHP 文件与设置

以下写入请求建议使用 POST；表中明确标记 POST 的接口在服务端强制检查方法。不要依赖旧接口兼容其他方法的行为。

| 路由 | 认证 | 输入及结果 |
| --- | --- | --- |
| `plugin/dshAsk/listPath` | T | `path`；目录摘要 |
| `plugin/dshAsk/fileInfo` | T | `filePath` 文件 ID，返回当前文件信息；保留原生读取权限，只额外允许当前账号个人 `.dsh` 内的附件 |
| `plugin/dshAsk/fileContent` | T | `filePath`，可选 page；通过原生 editor 获取文本、编码与 pageInfo，最多 40 MiB |
| `plugin/dshAsk/fileBytes` | T | `filePath`；同上读取授权，流式返回原始文件，仅用于需本地解析的格式 |
| `plugin/dshAsk/fetch` | T | `path`；文件字节和 X-Kod-Name，单文件最多 40 MiB |
| `plugin/dshAsk/viewFile` | 网盘登录及文件访问权限 | `path`；网盘文件预览/输出，可能返回 HTML、文件或错误状态 |
| `plugin/dshAsk/uploadAttachment` | T | `name`，body 为原始字节，最多 40 MiB；服务端固定存入当前账号个人空间 `.dsh` 缓存，重名改名；成功 info 为网盘路径，企业会话也不写入企业空间 |
| `plugin/dshAsk/saveFile` | T | `path` 目录、`name`，body 为 1 字节～40 MiB 的文件字节；立即创建，重名自动改名；成功 info 为网盘路径 |
| `plugin/dshAsk/replaceFile` | T | `path`，body 为文件字节；仅更新当前会话自己生成的文件，成功 info 为网盘路径 |
| `plugin/dshAsk/manageCopy` | T | `from,to`；加入待确认队列 |
| `plugin/dshAsk/manageMove` | T | `from,to`；加入待确认队列 |
| `plugin/dshAsk/manageRename` | T | `path,newName`；加入待确认队列 |
| `plugin/dshAsk/manageMkdir` | T | `path` 形如 `{source:123}/新目录`；加入待确认队列 |
| `plugin/dshAsk/manageRemove` | T | `path`；排队放入回收站，不永久删除 |
| `plugin/dshAsk/callApi` | T，settings 模式 | `route,params`；params 为对象或 JSON 字符串，只允许上游目录中的接口；读取立即执行，写入分项排队 |
| `plugin/dshAsk/setMode` | O，POST | `mode` 为 ask、help、settings |
| `plugin/dshAsk/listPending` | O | 返回 items，每项包含 id、summary |
| `plugin/dshAsk/commitPending` | O，POST | `id` 为 16 位小写十六进制；执行一项，检查 data.done 中的 result.code |
| `plugin/dshAsk/cancelPending` | O，POST | `id`；取消一项，正在执行的项不能取消 |

确认操作不能由模型携带 token 代替用户点击。执行中断导致结果未知时，先在网盘核对，不自动重放写请求。创建文档立即保存与网盘管理操作排队是两种不同流程。

## DSH 浏览器桥接

| 服务内路由 | 方法与输入 | 成功响应/行为 |
| --- | --- | --- |
| `/kodbox/upload` | POST：sessionId、name 查询串，body 为原始字节 | 需同源登录和对话归属验证；最多 40 MiB；先保存个人网盘缓存，再返回 DSH `{ok:true,value:{receiptId,file}}` 原生附件回执；缓存文件不属于生成产物 |
| `/kodbox/task` | GET：token，可选 prompt、defer | 建立交接会话并跳转 |
| `/kodbox/enter` | POST：workspaceId | `{ok:true,sessionId,summary}`；summary 用于立即登记新会话，省去全量历史刷新；用浏览器身份申请新的 spaceBinding，不借旧会话 token |
| `/kodbox/gate` | POST：sessionId | `{ok:true}`，验证进入该会话的资格 |
| `/kodbox/reference/remove` | POST：sessionId、rel | 当前账号会话归属验证；仅移除该会话引用，保留网盘与本地文件 |
| `/kodbox/catalog` | GET：session | agents、files、cachePath、scope；scope 包含 workspace、display、path |
| `/kodbox/preview` | GET：session、path | `{ok:true,name,display,href}`；尚未保存时 `{ok:false,ready:false,...}` |
| `/kodbox/ask` | POST：sessionId、request，可选 agentId、outputFormat、style | `{ok:true}`，仅代表问题已提交 |
| `/kodbox/skill` | POST：sessionId、agentId | `{ok:true}`，设置当前能力说明 |
| `/kodbox/mode` | POST：sessionId、mode | `{ok:true,mode}` |
| `/kodbox/pending` | POST：sessionId | `{ok:true,data}`，data.items 为待确认项 |
| `/kodbox/confirm` | POST：sessionId、id | `{ok:true,data}`，仍需检查内部执行结果 |
| `/kodbox/cancel` | POST：sessionId、id | `{ok:true,data}` |

错误响应目前有 JSON 与纯文本两类，状态包括 400、401、404、500、502；客户端先检查 HTTP 状态和 Content-Type，再解析。不要把所有错误都显示成“凭证过期”。例如空间权限变化应显示服务器给出的权限原因，预览未就绪应提示等待或重试。

同源浏览器请求示例（sessionId 来自当前已授权会话）：

```js
const response = await fetch('/dsh/kodbox/gate', {
  method: 'POST', credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId }),
});
if (!response.ok) throw new Error(await response.text());
const result = await response.json();
```

## 开发时必须保持的流程

1. 文件交接：openAsk → task → 当前会话绑定 → 工具读取会话工作目录 → 保存网盘 → 文件卡片调用 preview → 网盘预览。
2. 选择空间：identity → 检查 workspaceId 的真实目录 → spaceBinding → 新会话。子目录上下文由网盘进入时传入。
3. 管理写入：工具排队 → 浏览器 pending → 用户逐项 confirm/cancel → 检查实际执行结果。

工具凭证只取当前会话绑定，不接受工具参数或共享环境变量中的备用凭证。会话、文件引用和产物映射均按账号及空间隔离。DSH 0.2 的网关/工作区接口兼容在 account-guard.js、bootstrap-guard.js 和 profile 中维护；升级时运行 [维护检查](../maintenance.md)，不要只修改前端以绕过权限报错。

`kodbox_info` 和 `kodbox_read` 优先通过网盘读取最新信息与文本，`read` 对已引用附件使用相同接口。Office 格式才按需下载解析。不得修改冻结的工具参数；生成结果使用对话目录，个人 `.dsh` 仅存放输入附件，缓存目录不能成为成果保存目标。

旧版 `.xls` 使用 `excel_read` 的 BIFF 解析器直接读取，`kodbox_read` 也会按文件信息分派表格解析。解析在限时、限内存的 worker 中执行，不执行宏、外部链接或公式。只允许保存生成成果，`kodbox_save.name` 不能改变格式；修改后缀不会转换文件。工具展示按账号绑定会话和问答/帮助/设置模式过滤，保留服务端执行授权。

### 模型工具参数异常恢复

`model-recovery.js` 只处理已绑定网盘会话的 `MALFORMED_RESPONSE` 且错误包含 `tool input is invalid JSON` 的请求。通过原生 `agent/request-error` 返回重试决策，以 `llm/retry` / `llm/retry-started` 记录状态；同一 turn、step、provider 最多 2 次，等待 500/1000 ms。计数读取会话事件，重新加载插件后仍受限。取消会话或卸载插件会取消等待。禁止修补、执行不完整 JSON，其他错误交给原生恢复策略。

### 网盘引用与编辑器

右键选择的文件通过会话 `scopeNote` 传入模型，包含授权文件名、网盘 ID 和本地相对路径。客户端恢复 DSH 原生输入引用、附件区域和历史提问渲染。引用的 `clipboardText` 必须保留，原生编辑器也用它持久保存草稿。`installQuestionCopy` 仅在复制输入框和历史提问时排除引用，不改变引用存储或提交序列化。历史对话再次点击时允许调用原生加载器，以便加载失败后重试。Office 读取参数 `{source:N}/` 在 `producedPath` 中保留为网盘 ID，不解析为工作区本地路径；仍须匹配当前会话授权文件才允许读取。

### 模式工具与斜线选择

网盘会话的工具按当前模式提供，并在模型 wire schema 中移除 `deferLoading`，保证帮助模式的单个手册工具可以直接调用，避免所有工具均 deferred 而被提供方拒绝。未绑定网盘的智能体保持原设置。斜线选择命令时同步更新标签一次，模式/能力接口返回后不再重写草稿，保留等待期间用户继续输入的内容。

### 模式切换与工具历史

帮助、问答、设置模式均保留只读 `kodbox_context` 作为原生历史中的立即加载工具。仅清除当前 schema 的 deferLoading 不足以解决历史切换：DSH 的 addition-only 投影会将后来新增的工具重新标记为延迟加载。runtime-account 测试覆盖此原生投影，避免全工具延迟导致 INVALID_REQUEST。

权限接口按 action 分类：getData/getAllParent/getAllChildren/getGroupUser/getAllChildrenByUser 即时读取，其余修改需确认。个人空间不接受部门文档权限接口。分享 get/add 已开放，add 可传 randomPassword=1，由服务器生成并持久化密码；密码不进入操作摘要。编辑、删除分享暂使用网盘原生入口。旧版误排队的权限查询禁止执行，应取消后重新查询。
