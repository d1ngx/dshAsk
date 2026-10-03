<?php
/**
 * dshAsk — KodBox 网页目录右键调用 DSH 问答
 *
 * 与 plugins/dsh（WorkPal / SSO / 本地客户端）完全独立。
 * 插件功能：
 *   1. 个人空间 + 企业网盘（含部门）右键打开 /dsh/ 问答
 *   2. 签发短期 askToken + KodBox accessToken，供 DSH 调用官方 explorer 文件接口
 *   3. 可扩展的 Office agent 能力广场，向 DSH 交接文档任务
 *
 * DSH 侧通过 explorer/list/path、explorer/editor/fileGet 等官方 API 操作文件，
 * 见 https://doc.kodcloud.com/v2/#/explorer/file
 */
require_once __DIR__ . '/lib/AgentRegistry.php';

class dshAskPlugin extends PluginBase {
	public $pluginName = 'dshAsk';
	const TOKEN_TTL = 14400; // 4 hours
	private $runLock = null;
	private $runLockFile = '';
	private $labelCache = array();
	private $authNames = null;
	private static $clearRoleCache = null;

	public function __construct() {
		parent::__construct();
	}

	public function regist() {
		$this->hookRegist(array(
			'user.commonJs.insert' => 'dshAskPlugin.echoJs',
		));
	}

	public function echoJs() {
		$user = Session::get('kodUser');
		if (!is_array($user)) return;
		$this->echoFile('static/main.js');
	}

	public function install() {
		$dataDir = $this->askTokenDir();
		if (!is_dir($dataDir)) {
			@mkdir($dataDir, 0775, true);
		}
		return true;
	}

	public function onChangeStatus($status) {
		if ($status) $this->install();
		return true;
	}

	/**
	 * 左侧菜单 / 轻应用入口：签发空选中上下文后跳转到 DSH
	 */
	/** Send a browser that opened /dsh/ without a DSH cookie to the current launch token. */
	public function enter() {
		$this->requireBrowserUser();
		header('Cache-Control: no-store');
		header('Referrer-Policy: no-referrer');
		$file = rtrim(DATA_PATH, '/') . '/dsh-launch-token';
		$token = is_file($file) ? trim((string)file_get_contents($file)) : '';
		if (!preg_match('/^[A-Za-z0-9_-]{16,128}$/', $token)) {
			show_tips('DSH 还没有就绪，请稍后再打开 /dsh/');
		}
		header('Location: /dsh/?token=' . rawurlencode($token));
		exit;
	}

	public function index() {
		$this->requireBrowserUser();
		$payload = $this->createAskSession(array(), $this->currentExplorerPath());
		if (!$payload) {
			show_json(LNG('dshAsk.error.notLogin'), false);
		}
		$this->useLocalHandoff($payload, '', true);
		header('Location: ' . $payload['link']);
		exit;
	}

	/**
	 * 右键打开问答：写入选中文件上下文，返回 DSH 链接
	 * POST files=[{path,name,type,pathDisplay,sourceID,targetType}]
	 *      currentPath=
	 */
	public function openAsk() {
		$this->requireBrowserUser();
		$files = $this->parseFilesInput();
		$currentPath = isset($this->in['currentPath']) ? $this->in['currentPath'] : '';
		if (!$currentPath) $currentPath = $this->currentExplorerPath();
		if (empty($files) && !$currentPath) {
			show_json(LNG('dshAsk.error.pathRequired'), false);
		}
		$payload = $this->createAskSession($files, $currentPath);
		if (!$payload) {
			show_json(LNG('dshAsk.error.notLogin'), false);
		}
		$this->useLocalHandoff($payload, '', true);
		show_json($payload, true);
	}

	/** Capability plaza; selected context stays within the logged-in browser. */
	public function plaza() {
		$this->requireBrowserUser();
		header('Content-Type: text/html; charset=utf-8');
		header('Cache-Control: no-store');
		header('Referrer-Policy: no-referrer');
		$boot = array(
			'api' => rtrim(APP_HOST, '/') . '/index.php?plugin/dshAsk/',
			'files' => $this->parseFilesInput(),
			'currentPath' => $this->currentExplorerPath(),
		);
		$html = file_get_contents(__DIR__ . '/static/plaza.html');
		$bootJson = json_encode($boot, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE);
		echo str_replace('/*DSH_BOOT*/', 'window.DSH_BOOT = ' . $bootJson . ';', $html);
		exit;
	}

	public function agents() {
		$this->requireBrowserUser();
		header('Cache-Control: no-store');
		$registry = $this->agentRegistry();
		show_json(array('schemaVersion' => 1, 'agents' => $registry->all(), 'invalidManifestCount' => count($registry->errors())), true);
	}

	/** Create a task handoff. This endpoint does not claim the DSH task has executed. */
	public function openAgent() {
		$this->requireBrowserUser();
		if (!isset($_SERVER['REQUEST_METHOD']) || $_SERVER['REQUEST_METHOD'] !== 'POST') show_json('POST required', false);
		$id = isset($this->in['agentId']) ? $this->in['agentId'] : '';
		$agent = $this->agentRegistry()->get($id);
		if (!$agent) show_json(LNG('dshAsk.error.agentInvalid'), false);
		$files = $this->parseFilesInput();
		if (!DshAskAgentRegistry::accepts($agent, $files)) show_json(LNG('dshAsk.error.agentFiles'), false);
		$request = isset($this->in['request']) ? $this->in['request'] : '';
		$style = isset($this->in['style']) ? $this->in['style'] : 'professional';
		$output = isset($this->in['outputFormat']) ? $this->in['outputFormat'] : $agent['outputs'][0];
		$current = isset($this->in['currentPath']) ? $this->in['currentPath'] : '';
		if (!is_string($request) || strlen($request) > 12000 || (!$files && trim($request) === '') ||
			!is_string($current) || strlen($current) > 4096 || !in_array($output, $agent['outputs'], true) ||
			!in_array($style, array('professional', 'minimal', 'vibrant', 'preserve'), true)) {
			show_json(LNG('dshAsk.error.agentInput'), false);
		}
		$task = DshAskAgentRegistry::task($agent, $files, trim($request), $output, $style);
		$payload = $this->createAskSession($files, $current, $task);
		if (!$payload) show_json(LNG('dshAsk.error.notLogin'), false);
		// The token is scoped to this task and expires with the ask session. It is
		// carried only in the DSH handoff prompt so kodbox-file can bind the session;
		// it is never written to the shared DSH profile or a model log by this plugin.
		$payload['prompt'] = $task['prompt'] . "\n\n" . $this->handoffPrompt($payload['token']);
		$this->useLocalHandoff($payload, $payload['prompt'], false);
		show_json($payload, true);
	}

	/** Capability list for the DSH question picker. Authorized by the ask token. */
	public function catalog() {
		header('Cache-Control: no-store');
		$record = $this->readAskToken($this->askTokenInput());
		if (!$record) show_json(LNG('dshAsk.error.tokenInvalid'), false);
		$installed = $this->officeCapabilities();
		$agents = array();
		foreach ($this->agentRegistry()->all() as $agent) {
			$missing = array();
			foreach ($agent['requires'] as $need) if (!in_array($need, $installed, true)) $missing[] = $need;
			$agent['missingRequires'] = $missing;
			unset($agent['instructions']);
			$agents[] = $agent;
		}
		show_json(array(
			'agents' => $agents,
			'files' => isset($record['files']) ? $record['files'] : array(),
			'currentPath' => isset($record['currentPath']) ? $record['currentPath'] : '',
		), true);
	}

	/** Turn a DSH question plus an optional capability into one handoff prompt. */
	public function compose() {
		header('Cache-Control: no-store');
		$token = $this->askTokenInput();
		$record = $this->readAskToken($token);
		if (!$record) show_json(LNG('dshAsk.error.tokenInvalid'), false);
		$request = isset($this->in['request']) ? $this->in['request'] : '';
		$agentId = isset($this->in['agentId']) ? $this->in['agentId'] : 'ask';
		if (!is_string($request) || strlen($request) > 12000 || trim($request) === '') show_json(LNG('dshAsk.error.agentInput'), false);
		if ($agentId === '' || $agentId === 'ask') {
			show_json(array('prompt' => trim($request) . "\n\n" . $this->handoffPrompt($token)), true);
		}
		$agent = $this->agentRegistry()->get($agentId);
		if (!$agent) show_json(LNG('dshAsk.error.agentInvalid'), false);
		$files = isset($record['files']) && is_array($record['files']) ? $record['files'] : array();
		if (!DshAskAgentRegistry::accepts($agent, $files)) show_json(LNG('dshAsk.error.agentFiles'), false);
		$style = isset($this->in['style']) ? $this->in['style'] : 'professional';
		$output = isset($this->in['outputFormat']) ? $this->in['outputFormat'] : $agent['outputs'][0];
		if (!in_array($output, $agent['outputs'], true) || !in_array($style, array('professional', 'minimal', 'vibrant', 'preserve'), true)) {
			show_json(LNG('dshAsk.error.agentInput'), false);
		}
		$missing = array();
		foreach ($agent['requires'] as $need) if (!in_array($need, $this->officeCapabilities(), true)) $missing[] = $need;
		if ($missing) show_json('执行器缺少：' . implode('、', $missing), false);
		$task = DshAskAgentRegistry::task($agent, $files, trim($request), $output, $style);
		show_json(array('prompt' => $task['prompt'] . "\n\n" . $this->handoffPrompt($token)), true);
	}

	public function capabilities() {
		$this->requireBrowserUser();
		show_json(array('schemaVersion' => 1, 'capabilities' => $this->officeCapabilities()), true);
	}

	private function officeCapabilities() {
		$names = array();
		$raw = getenv('DSH_OFFICE_CAPABILITIES');
		if (is_string($raw) && $raw !== '') foreach (explode(',', $raw) as $name) {
			$name = trim($name);
			if (preg_match('/^[a-z0-9][a-z0-9-]{1,63}$/', $name)) $names[] = $name;
		}
		return array_values(array_unique($names));
	}

	private function askTokenInput() {
		$token = isset($this->in['token']) ? $this->in['token'] : '';
		if (!$token && isset($this->in['askToken'])) $token = $this->in['askToken'];
		return is_string($token) ? $token : '';
	}

	private function handoffPrompt($token) {
		return "[DSH_HANDOFF]\n先调用 kodbox_context 取得上下文，再处理任务。凭证由会话自动附带，不要在工具参数或回复里写 token。";
	}

	/** Local DSH must enter /kodbox/task so the process can attach its launch token. */
	private function useLocalHandoff(&$payload, $prompt, $defer) {
		$link = $payload['link'];
		$origin = '';
		$prefix = '';
		if (preg_match('#^(https?://(?:127\.0\.0\.1|localhost)(?::\d+)?)(.*)$#i', $link, $match)) {
			$origin = $match[1];
			if (strpos($match[2], '/dsh') === 0) $prefix = '/dsh';
		} elseif (strpos($link, '/dsh') === 0) {
			$prefix = '/dsh';
		} else {
			return;
		}
		$payload['link'] = $origin . $prefix . '/kodbox/task?token=' . rawurlencode($payload['token']);
		if ($prompt !== '') $payload['link'] .= '&prompt=' . rawurlencode($prompt);
		if ($defer) $payload['link'] .= '&defer=1';
	}

	private function agentRegistry() {
		$base = defined('DATA_PATH') ? DATA_PATH : (BASIC_PATH . 'data/');
		$config = $this->getConfig();
		$disabled = explode(',', (string)_get($config, 'disabledAgents', ''));
		return new DshAskAgentRegistry(__DIR__ . '/agents', rtrim($base, '/') . '/dshAsk/agents', $disabled);
	}

	/**
	 * DSH 用 askToken 拉取问答上下文；内部凭证与产物归属不对外返回
	 * 允许未登录访问：凭据是不可猜测的 askToken（pluginAuthOpen）
	 */
	public function context() {
		header('Cache-Control: no-store');
		$record = $this->bindAskUser();
		if (!$record) {
			show_json(LNG('dshAsk.error.tokenInvalid'), false);
		}
		unset($record['expire'], $record['accessToken'], $record['pending'], $record['generated']);
		show_json($record, true);
	}

	/** Render shipped documentation on the current KodBox origin. */
	public function help() {
		$this->requireBrowserUser();
		$file = isset($this->in['file']) ? $this->in['file'] : 'user-guide.md';
		$full = $this->helpFile($file);
		if (!$full) { http_response_code(404); echo '帮助文档不存在'; exit; }
		$body = file_get_contents($full);
		$boot = json_encode(array('file' => $file, 'markdown' => $body), JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
		header('Content-Type: text/html; charset=utf-8');
		header('Cache-Control: no-store');
		header('X-Frame-Options: SAMEORIGIN');
		header('Referrer-Policy: same-origin');
		$html = file_get_contents(__DIR__ . '/static/help.html');
		echo str_replace(array('/*HELP_BOOT*/', '<!--HELP_TEXT-->'), array('window.HELP_DOC=' . $boot . ';', htmlspecialchars($body, ENT_QUOTES, 'UTF-8')), $html);
		exit;
	}

	private function helpFile($file) {
		if (!is_string($file) || strlen($file) > 512 || strpos($file, "\0") !== false || strpos($file, '\\') !== false || !preg_match('/\.md$/i', $file)) return false;
		$root = realpath(__DIR__ . '/docs');
		$full = $root ? realpath($root . '/' . $file) : false;
		return $full && strpos($full, $root . DIRECTORY_SEPARATOR) === 0 && is_file($full) ? $full : false;
	}

	/** Browser identity is resolved by KodBox, never from a client user-id header. */
	public function identity() {
		header('Cache-Control: no-store');
		$user = $this->requireBrowserUser();
		$fresh = Model('User')->getInfoFull($user['userID']);
		$GLOBALS['isRoot'] = $this->userIsRoot($fresh) ? 1 : 0;
		$this->requirePluginUser($fresh);
		show_json(array('userID' => strval($user['userID']), 'workspaces' => $this->listWorkspaces($fresh)), true);
	}

	/** Every new conversation gets its own credential, pending queue and artifact ownership. */
	public function spaceBinding() {
		header('Cache-Control: no-store');
		if (!isset($_SERVER['REQUEST_METHOD']) || $_SERVER['REQUEST_METHOD'] !== 'POST') show_json('POST required', false);
		$browser = $this->requireBrowserUser();
		$user = Model('User')->getInfoFull($browser['userID']);
		$this->requirePluginUser($user);
		$GLOBALS['isRoot'] = $this->userIsRoot($user) ? 1 : 0;
		$space = null;
		foreach ($this->listWorkspaces($user) as $candidate) {
			if (!empty($candidate['path']) && strval($candidate['id']) === _get($this->in, 'spaceId', '') && $candidate['path'] === _get($this->in, 'spacePath', '')) {
				$space = $candidate; break;
			}
		}
		if (!$space) show_json('当前账号没有这个网盘空间的访问权限，请刷新空间列表', false);
		Session::set('kodUser', $user);
		$this->in['currentDisplay'] = $space['name'];
		$payload = $this->createAskSession(array(), $space['path']);
		$record = $this->readAskToken($payload['token']);
		unset($record['accessToken'], $record['pending'], $record['generated'], $record['expire']);
		show_json(array('token' => $payload['token'], 'context' => $record), true);
	}

	/** Derive a conversation from an explicitly supplied, still-owned file handoff. */
	public function sessionBinding() {
		if (!isset($_SERVER['REQUEST_METHOD']) || $_SERVER['REQUEST_METHOD'] !== 'POST') show_json('POST required', false);
		list(, $record) = $this->ownedToken();
		if (empty($record['spacePath'])) show_json('请从网盘重新打开问答以绑定空间', false);
		$record['pending'] = array();
		$record['generated'] = array();
		$record['mode'] = 'ask';
		$record['expire'] = time() + self::TOKEN_TTL;
		if (!empty($this->in['empty'])) {
			$record['files'] = array();
			$record['currentPath'] = $record['spacePath'];
			$record['currentDisplay'] = '';
			unset($record['agentTask']);
		}
		$token = 'ask_' . bin2hex(random_bytes(16));
		if (!$this->writeAskToken($token, $record)) show_json(LNG('dshAsk.error.tokenIssue'), false);
		unset($record['accessToken'], $record['pending'], $record['generated'], $record['expire']);
		show_json(array('token' => $token, 'context' => $record), true);
	}

	/**
	 * Nginx auth_request：已登录 KodBox 返回 200 + X-Kod-User-Id，否则 401。
	 * 方法名不能叫 authCheck：PluginBase 已占用。
	 */
	public function loginGate() {
		header('Cache-Control: no-store');
		if (KodUser::isLogin()) {
			$user = Session::get('kodUser');
			$userID = isset($user['userID']) ? intval($user['userID']) : 0;
			$name = isset($user['name']) ? $user['name'] : '';
			header('X-Kod-User-Id: ' . $userID);
			header('X-Kod-Userid: ' . $userID);
			header('X-Kod-User-Name: ' . rawurlencode($name));
			http_response_code(200);
			echo 'ok';
			exit;
		}
		http_response_code(401);
		echo 'login required';
		exit;
	}

	/**
	 * Nginx 401 回跳：页面去 KodBox 登录，API 保持 401 JSON。
	 */
	public function needLogin() {
		$back = isset($_SERVER['HTTP_X_ORIGINAL_URI']) ? $_SERVER['HTTP_X_ORIGINAL_URI'] : '/dsh/';
		if (!is_string($back) || $back === '' || $back[0] !== '/' || strpos($back, '//') !== false || strpos($back, '\\') !== false) {
			$back = '/dsh/';
		}
		if (strpos($back, '/dsh') !== 0 && strpos($back, '/api') !== 0 && strpos($back, '/plugins/') !== 0 && strpos($back, '/browser-desktop') !== 0) {
			$back = '/dsh/';
		}
		$accept = isset($_SERVER['HTTP_ACCEPT']) ? $_SERVER['HTTP_ACCEPT'] : '';
		$isHtml = (stripos($accept, 'text/html') !== false);
		$host = isset($_SERVER['HTTP_X_FORWARDED_HOST']) ? $_SERVER['HTTP_X_FORWARDED_HOST'] : (isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '');
		$host = preg_replace('/[^A-Za-z0-9\\-\\.:\\[\\]]/', '', $host);
		$proto = isset($_SERVER['HTTP_X_FORWARDED_PROTO']) ? $_SERVER['HTTP_X_FORWARDED_PROTO'] : ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http');
		if ($proto !== 'https') $proto = 'http';
		$link = ($host ? ($proto . '://' . $host) : rtrim(APP_HOST, '/')) . $back;
		if (KodUser::isLogin() && $isHtml) {
			header('Location: ' . $link);
			exit;
		}
		if (!$isHtml) {
			http_response_code(401);
			header('Content-Type: application/json; charset=utf-8');
			echo json_encode(array('ok' => false, 'error' => LNG('dshAsk.error.notLogin')));
			exit;
		}
		header('Location: ' . APP_HOST . 'index.php?user/index/autoLogin&link=' . rawurlencode($link));
		exit;
	}

	/**
	 * 当前用户可见空间：个人空间 + 企业网盘 + 部门空间
	 * 供 DSH 工具 kodbox_workspaces 使用（askToken 或登录态）
	 */
	public function workspaces() {
		if ($this->askTokenInput()) {
			$record = $this->bindAskUser();
			show_json($record['workspaces'], true);
		}
		$user = $this->requireBrowserUser();
		show_json($this->listWorkspaces($user), true);
	}

	/** List a cloud folder as the ask-token user. Plugin routes skip the explorer CSRF check. */
	public function listPath() {
		$this->bindAskUser();
		$path = isset($this->in['path']) ? $this->in['path'] : '';
		if (!is_string($path) || $path === '' || strlen($path) > 4096) show_json(LNG('dshAsk.error.agentInput'), false);
		$data = Action('explorer.list')->path($path);
		if (!$data) show_json(LNG('explorer.error'), false);
		show_json($this->summarizeList($data), true);
	}

	/** Stream one cloud file. The DSH tool writes it into the session workspace. */
	public function fetch() {
		$this->bindAskUser();
		$path = isset($this->in['path']) ? $this->in['path'] : '';
		if (!is_string($path) || $path === '' || strlen($path) > 4096) show_json(LNG('dshAsk.error.agentInput'), false);
		$info = IO::info($path);
		if (!is_array($info) || (isset($info['type']) && $info['type'] === 'folder')) show_json(LNG('dshAsk.error.agentFiles'), false);
		if (isset($info['size']) && intval($info['size']) > 41943040) show_json(LNG('dshAsk.error.agentInput'), false);
		header('X-Kod-Name: ' . rawurlencode(isset($info['name']) ? $info['name'] : 'file'));
		$this->in['path'] = $path;
		$this->in['download'] = 1;
		Action('explorer.index')->fileOut();
	}

	/** Show a cloud file to the logged-in browser. Any KodBox client can open it; the DSH disk path is not used. */
	public function viewFile() {
		if (!KodUser::isLogin()) {
			header('HTTP/1.1 401');
			header('Content-Type: text/plain; charset=utf-8');
			echo '请先登录网盘';
			exit;
		}
		$path = isset($this->in['path']) ? $this->in['path'] : '';
		if (!is_string($path) || $path === '' || strlen($path) > 4096) {
			header('HTTP/1.1 400');
			exit;
		}
		$info = IO::info($path);
		if (!is_array($info) || (isset($info['type']) && $info['type'] === 'folder')) {
			header('HTTP/1.1 404');
			header('Content-Type: text/plain; charset=utf-8');
			echo '文件不存在';
			exit;
		}
		$name = isset($info['name']) ? $info['name'] : 'file';
		$ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
		if ($ext === 'md' || $ext === 'markdown') {
			$body = IO::fileSubstr($info['path'], 0, 1048576);
			if (!is_string($body)) $body = '';
			$json = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
			header('Content-Type: text/html; charset=utf-8');
			header('X-Frame-Options: SAMEORIGIN');
			echo '<!doctype html><meta charset="utf-8"><title>' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8') . '</title>';
			echo '<style>html,body{height:100%}body{margin:0;background:#fff;color:#1f2328}#doc{box-sizing:border-box;min-height:100%;max-width:860px;margin:0 auto;padding:16px 18px;font:13px/1.55 -apple-system,sans-serif;white-space:pre-wrap}#doc h1{font-size:1.25em}#doc h2{font-size:1.1em}#doc h3{font-size:1em}#doc h1,#doc h2,#doc h3{line-height:1.3}#doc pre{overflow:auto;padding:8px 10px;background:#f6f8fa;border-radius:6px;font-size:12px;white-space:pre-wrap}#doc code{font-family:ui-monospace,monospace;font-size:12px}#doc table{border-collapse:collapse}#doc td,#doc th{border:1px solid #d0d7de;padding:4px 8px}</style>';
			echo '<article id="doc">' . htmlspecialchars($body, ENT_QUOTES, 'UTF-8') . '</article>';
			echo '<script src="/static/app/vender/markdown/markdown-it.min.js"></script><script>';
			echo 'if (window.markdownit) document.getElementById("doc").innerHTML=markdownit({html:false,linkify:true}).render(' . $json . ');';
			echo '</script>';
			exit;
		}
		if (in_array($ext, array('txt', 'csv', 'json', 'log'), true)) {
			$body = IO::fileSubstr($info['path'], 0, 1048576);
			if (!is_string($body)) $body = '';
			header('Content-Type: text/html; charset=utf-8');
			header('X-Frame-Options: SAMEORIGIN');
			echo '<!doctype html><meta charset="utf-8"><title>' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8') . '</title>';
			echo '<pre style="white-space:pre-wrap;word-break:break-word;font:14px/1.6 sans-serif;margin:16px">';
			echo htmlspecialchars($body, ENT_QUOTES, 'UTF-8');
			echo '</pre>';
			exit;
		}
		$this->in['path'] = $info['path'];
		$this->in['download'] = 0;
		Action('explorer.index')->fileOut();
	}

	/** Copy or move a cloud item. Paths are each file or folder's own {source:id}/. */
	public function manageCopy() { $this->queueTransfer('copy'); }
	public function manageMove() { $this->queueTransfer('move'); }

	private function manageTransfer($method) {
		$this->bindAskUser();
		$from = isset($this->in['from']) ? $this->in['from'] : '';
		$to = isset($this->in['to']) ? $this->in['to'] : '';
		$this->assertCloudId($from);
		$this->in['dataArr'] = json_encode(array(array('path' => $from)));
		$this->in['path'] = $this->resolveCloudFolder($to);
		$this->in['fileRepeat'] = 'rename';
		Action('explorer.index')->$method();
	}

	/** Copy and move wait for one user confirm. Rename, mkdir, and recycle use the same queue. */
	private function queueTransfer($kind) {
		$record = $this->bindAskUser();
		$from = isset($this->in['from']) ? $this->in['from'] : '';
		$to = isset($this->in['to']) ? $this->in['to'] : '';
		$this->assertCloudId($from);
		$this->enqueue($this->askTokenInput(), array(
			'kind' => $kind,
			'from' => $from,
			'to' => $to,
			'summary' => ($kind === 'copy' ? '复制 ' : '移动 ') . $this->cloudLabel($from) . ' → ' . $this->cloudLabel($to),
		));
	}

	public function manageRename() {
		$this->bindAskUser();
		$path = isset($this->in['path']) ? $this->in['path'] : '';
		$this->assertCloudId($path);
		$name = isset($this->in['newName']) ? $this->in['newName'] : '';
		if (!is_string($name) || !preg_match('/^[^\\/\\\\:*?"<>|]{1,180}$/u', $name)) show_json(LNG('dshAsk.error.agentInput'), false);
		$this->enqueue($this->askTokenInput(), array(
			'kind' => 'rename',
			'path' => $path,
			'newName' => $name,
			'summary' => '重命名 ' . $this->cloudLabel($path) . ' → ' . $name,
		));
	}

	public function manageMkdir() {
		$this->bindAskUser();
		$path = isset($this->in['path']) ? $this->in['path'] : '';
		if (!is_string($path) || !preg_match('/^\{source:\d+\}\/[^\\/\\\\:*?"<>|]{1,180}$/u', $path)) show_json(LNG('dshAsk.error.agentInput'), false);
		$this->enqueue($this->askTokenInput(), array(
			'kind' => 'mkdir',
			'path' => $path,
			'summary' => '新建目录 ' . $this->cloudLabel($path),
		));
	}

	/** Move one cloud item to the recycle bin. Does not delete permanently. */
	public function manageRemove() {
		$record = $this->bindAskUser();
		$path = isset($this->in['path']) ? $this->in['path'] : '';
		$this->assertCloudId($path);
		$this->enqueue($this->askTokenInput(), array(
			'kind' => 'remove',
			'path' => $path,
			'summary' => '放入回收站 ' . $this->cloudLabel($path),
		));
	}

	/** IO::info('{source:N}/子名') returns the parent, so a trailing name is used as-is. */
	private function cloudLabel($path) {
		if (!is_string($path) || $path === '') return '';
		if (preg_match('#^\{source:\d+\}/([^/{}]+)/?$#u', $path, $match)) return $match[1];
		$info = IO::info($path);
		if (is_array($info) && !empty($info['name']) && is_string($info['name'])) return $info['name'];
		$trimmed = rtrim($path, '/');
		if (preg_match('#/([^/{}]+)$#u', $trimmed, $match)) return $match[1];
		return $path;
	}

	private function spareCloudName($itemPath, $name) {
		$parent = IO::pathFather($itemPath);
		$data = $parent ? Action('explorer.list')->path($parent) : array();
		$taken = array();
		foreach (array('fileList', 'folderList') as $key) {
			$list = (is_array($data) && isset($data[$key]) && is_array($data[$key])) ? $data[$key] : array();
			foreach ($list as $item) {
				if (is_array($item) && isset($item['name'])) $taken[$item['name']] = true;
			}
		}
		if (!isset($taken[$name])) return $name;
		$ext = pathinfo($name, PATHINFO_EXTENSION);
		$stem = $ext === '' ? $name : substr($name, 0, -strlen($ext) - 1);
		for ($i = 1; $i < 50; $i++) {
			$next = $ext === '' ? $stem . '(' . $i . ')' : $stem . '(' . $i . ').' . $ext;
			if (!isset($taken[$next])) return $next;
		}
		return $name;
	}

	private function assertCloudId($path) {
		if (!is_string($path) || !preg_match('/^\{source:\d+\}\/$/', $path)) show_json(LNG('dshAsk.error.agentInput'), false);
	}

	/** Accept a folder's own {source:id}/, or {source:parent}/子目录名 from kodbox_mkdir. */
	private function resolveCloudFolder($path) {
		if (!is_string($path)) show_json(LNG('dshAsk.error.agentInput'), false);
		if (preg_match('/^\{source:\d+\}$/', $path)) $path .= '/';
		if (preg_match('/^\{source:\d+\}\/$/', $path)) return $path;
		if (!preg_match('/^(\{source:\d+\}\/)([^\\/\\\\:*?"<>|]{1,180})$/u', $path, $match)) show_json(LNG('dshAsk.error.agentInput'), false);
		$data = Action('explorer.list')->path($match[1]);
		$folders = (is_array($data) && isset($data['folderList']) && is_array($data['folderList'])) ? $data['folderList'] : array();
		foreach ($folders as $item) {
			if (is_array($item) && isset($item['name']) && $item['name'] === $match[2] && !empty($item['path'])) return $item['path'];
		}
		show_json('找不到目录「' . $match[2] . '」。请使用 kodbox_list 或 kodbox_mkdir 返回的 {source:数字}/', false);
	}

	/** Save bytes as a new cloud file. Existing names are renamed, not overwritten. */
	public function saveFile() {
		$this->bindAskUser();
		$folder = isset($this->in['path']) ? $this->in['path'] : '';
		$name = isset($this->in['name']) ? $this->in['name'] : '';
		if (!is_string($folder) || $folder === '' || strlen($folder) > 4096 || !is_string($name) || !preg_match('/^[^\\/\\\\:*?"<>|]{1,180}$/u', $name)) {
			show_json(LNG('dshAsk.error.agentInput'), false);
		}
		$folder = $this->saveFolder($folder);
		if (!$folder) show_json(LNG('explorer.error'), false);
		if (!$this->pathCanWrite($folder)) show_json(LNG('explorer.noPermissionWriteAll'), false);
		$bytes = file_get_contents('php://input', false, null, 0, 41943041);
		if (!is_string($bytes) || $bytes === '' || strlen($bytes) > 41943040) show_json(LNG('dshAsk.error.agentInput'), false);
		$this->createGeneratedFile($folder, $name, $bytes);
	}

	/** Use the native IO create result: show_json's exception mode drops its info field. */
	private function createGeneratedFile($folder, $name, $bytes) {
		$path = rtrim($folder, '/') . '/' . $name;
		Action('explorer.index')->pathAllowCheck($path);
		$created = IO::mkfile($path, $bytes, 'rename');
		if (!$created) show_json(IO::getLastError(LNG('explorer.saveError')), false);
		$info = IO::info($created);
		$cloudPath = (is_array($info) && isset($info['type']) && $info['type'] === 'file' &&
			!empty($info['path']) && preg_match('/^\{source:\d+\}\/$/', $info['path'])) ? $info['path'] : '';
		if ($cloudPath === '') $this->abandonGenerated($created, false);
		$token = $this->askTokenInput();
		$outcome = array('ok' => false, 'invalid' => false);
		for ($try = 0; $try < 2; $try++) {
			$outcome = $this->commitToken($token, function ($record) use ($cloudPath) {
				if (!isset($record['generated']) || !is_array($record['generated'])) $record['generated'] = array();
				$record['generated'][$cloudPath] = true;
				return $record;
			});
			if (!empty($outcome['ok']) || !empty($outcome['invalid'])) break;
		}
		if (empty($outcome['ok'])) $this->abandonGenerated($cloudPath, !empty($outcome['invalid']));
		show_json(LNG('explorer.saveSuccess'), true, $cloudPath);
	}

	/** Drop a file created in this request when its ownership cannot be stored. */
	private function abandonGenerated($path, $invalid) {
		if (!IO::remove($path, false)) show_json('文件已创建，但无法记录产物归属，请到网盘核对', false);
		if ($invalid) show_json(LNG('dshAsk.error.tokenInvalid'), false);
		show_json(LNG('explorer.saveError'), false);
	}

	/** Replace a file that this user created during the current ask session. Originals are never replaced. */
	public function replaceFile() {
		$record = $this->bindAskUser();
		$path = isset($this->in['path']) ? $this->in['path'] : '';
		if (!is_string($path) || !preg_match('/^\{source:\d+\}\/$/', $path)) show_json(LNG('dshAsk.error.agentInput'), false);
		$info = IO::info($path);
		if (!is_array($info) || empty($info['path']) || (isset($info['type']) && $info['type'] === 'folder')) show_json(LNG('common.pathNotExists'), false);
		if (empty($record['generated'][$path])) show_json(LNG('explorer.noPermissionWriteAll'), false);
		if (!$this->pathCanWrite($info['path'])) show_json(LNG('explorer.noPermissionWriteAll'), false);
		$bytes = file_get_contents('php://input', false, null, 0, 41943041);
		if (!is_string($bytes) || $bytes === '' || strlen($bytes) > 41943040) show_json(LNG('dshAsk.error.agentInput'), false);
		$result = IO::setContent($info['path'], $bytes);
		if (!$result) show_json(IO::getLastError(LNG('explorer.saveError')), false);
		show_json(LNG('explorer.saveSuccess'), true, $info['path']);
	}

	private function createAskSession($files, $currentPath, $agentTask = null) {
		$user = Session::get('kodUser');
		if (!is_array($user) || empty($user['userID'])) {
			return false;
		}
		$config = $this->getConfig();
		$dshUrl = trim(_get($config, 'dshUrl', '/dsh/'));
		if ($dshUrl === '') {
			show_json(LNG('dshAsk.error.dshUrlEmpty'), false);
		}
		$spaces = $this->listWorkspaces($user);
		$probe = $currentPath ?: (!empty($files[0]['path']) ? $files[0]['path'] : '');
		$space = null;
		foreach ($spaces as $candidate) {
			if (!empty($candidate['path']) && $this->pathInSpace($probe, $candidate['path'])) { $space = $candidate; break; }
		}
		if (!$space) show_json('当前目录不属于可访问的网盘空间', false);
		foreach ($files as $file) {
			if (empty($file['path']) || !$this->pathInSpace($file['path'], $space['path'])) show_json('一次提问只能引用同一空间的文件', false);
		}
		$accessToken = $this->issueAccessToken();
		if (!$accessToken) {
			show_json(LNG('dshAsk.error.tokenIssue'), false);
		}
		$token = 'ask_' . bin2hex(random_bytes(16));
		$record = array(
			'userID'      => $user['userID'],
			'userName'    => isset($user['name']) ? $user['name'] : '',
			'accessToken' => $accessToken,
			'files'       => $files,
			'currentPath' => $currentPath,
			'currentDisplay' => (isset($this->in['currentDisplay']) && is_string($this->in['currentDisplay']) && strlen($this->in['currentDisplay']) <= 4096) ? $this->in['currentDisplay'] : '',
			'workspaces'  => array($space),
			'spacePath'   => $space['path'],
			'spaceId'     => strval($space['id']),
			'apiBase'     => rtrim(APP_HOST, '/') . '/',
			'expire'      => time() + self::TOKEN_TTL,
			'mode'        => 'ask',
			'pending'     => array(),
			'generated'   => array(),
		);
		if ($agentTask !== null) $record['agentTask'] = $agentTask;
		if (!$this->writeAskToken($token, $record)) show_json(LNG('dshAsk.error.tokenIssue'), false);
		// Preserve configured query strings and fragments.
		$fragment = '';
		$hash = strpos($dshUrl, '#');
		if ($hash !== false) { $fragment = substr($dshUrl, $hash); $dshUrl = substr($dshUrl, 0, $hash); }
		$sep = (strpos($dshUrl, '?') === false) ? '?' : '&';
		return array(
			'token' => $token,
			'link'  => $dshUrl . $sep . 'kodAsk=' . rawurlencode($token) . $fragment,
		);
	}

	/**
	 * 签发 KodBox explorer API 用的 accessToken。
	 * Action('user.index')->accessToken() 在插件请求里常因 Session::sign() 为空而得到空串，
	 * 这里用 KOD_SESSION_ID cookie / session_id 兜底，编码算法与官方 accessToken() 一致。
	 */
	private function issueAccessToken() {
		$sign = $this->sessionSign();
		$systemPass = Model('SystemOption')->get('systemPassword');
		if (!$systemPass || !$sign) return '';
		$pass = substr(md5('kodbox_' . $systemPass), 0, 15);
		try {
			$token = Mcrypt::encode($sign, $pass, 3600 * 24 * 30);
		} catch (Throwable $e) {
			return '';
		}
		return $this->isUsableAccessToken($token) ? $token : '';
	}

	private function sessionSign() {
		$sign = '';
		try {
			$sign = Session::sign();
		} catch (Throwable $e) {
			$sign = '';
		}
		if ($this->isUsableSessionSign($sign)) return $sign;
		if (defined('SESSION_ID')) {
			$sign = Cookie::get(SESSION_ID);
			if (!$this->isUsableSessionSign($sign) && !empty($_COOKIE[SESSION_ID])) {
				$sign = $_COOKIE[SESSION_ID];
			}
		}
		if (!$this->isUsableSessionSign($sign)) {
			$sign = session_id();
		}
		return $this->isUsableSessionSign($sign) ? $sign : '';
	}

	private function isUsableSessionSign($sign) {
		return is_string($sign) && strlen($sign) > 8;
	}

	private function isUsableAccessToken($token) {
		return is_string($token) && strlen($token) > 16;
	}

	private function parseFilesInput() {
		$raw = isset($this->in['files']) ? $this->in['files'] : '';
		if (is_array($raw)) {
			$list = $raw;
		} else {
			if (!is_string($raw) || strlen($raw) > 262144) show_json(LNG('dshAsk.error.agentInput'), false);
			$list = json_decode($raw, true);
			if ($raw !== '' && !is_array($list)) show_json(LNG('dshAsk.error.agentInput'), false);
		}
		if (!is_array($list)) return array();
		if (count($list) > 100) show_json(LNG('dshAsk.error.agentInput'), false);
		$files = array();
		foreach ($list as $item) {
			if (!is_array($item) || empty($item['path'])) show_json(LNG('dshAsk.error.agentInput'), false);
			foreach (array('path', 'name', 'type', 'pathDisplay', 'sourceID', 'targetType') as $key) {
				if (isset($item[$key]) && ((!is_string($item[$key]) && !is_numeric($item[$key])) || strlen((string)$item[$key]) > 4096)) show_json(LNG('dshAsk.error.agentInput'), false);
			}
			$files[] = array(
				'path'        => $item['path'],
				'name'        => isset($item['name']) ? $item['name'] : '',
				'type'        => isset($item['type']) ? $item['type'] : '',
				'pathDisplay' => isset($item['pathDisplay']) ? $item['pathDisplay'] : '',
				'sourceID'    => isset($item['sourceID']) ? $item['sourceID'] : '',
				'targetType'  => isset($item['targetType']) ? $item['targetType'] : '',
			);
		}
		return $files;
	}

	private function currentExplorerPath() {
		if (isset($this->in['currentPath']) && $this->in['currentPath']) {
			return $this->in['currentPath'];
		}
		if (defined('MY_HOME') && MY_HOME) return MY_HOME;
		return '';
	}

	private function listWorkspaces($user) {
		$workspaces = array();
		$home = !empty($user['sourceInfo']['sourceID']) ? '{source:' . intval($user['sourceInfo']['sourceID']) . '}/' : (defined('MY_HOME') ? MY_HOME : '');
		if ($home) {
			$workspaces[] = array(
				'type'     => 'home',
				'id'       => 'home',
				'name'     => '个人空间',
				'path'     => $home,
				'canWrite' => $this->pathCanWrite($home),
			);
		}

		$groups = isset($user['groupInfo']) && is_array($user['groupInfo']) ? $user['groupInfo'] : array();
		$groupIDs = array();
		foreach ($groups as $g) {
			$gid = isset($g['groupID']) ? $g['groupID'] : '';
			if ($gid) $groupIDs[] = $gid;
		}
		$groupSources = array();
		if (!empty($groupIDs) && method_exists(Model('Source'), 'sourceRootGroup')) {
			$groupSources = Model('Source')->sourceRootGroup($groupIDs);
			$groupSources = array_to_keyvalue($groupSources, 'targetID');
		}
		foreach ($groups as $group) {
			$groupID = isset($group['groupID']) ? $group['groupID'] : '';
			if (!$groupID) continue;
			$name = isset($group['groupName']) ? $group['groupName'] : ('group_' . $groupID);
			if ($groupID == '1' && $name === '') $name = '企业网盘';
			$src = isset($groupSources[$groupID]) ? $groupSources[$groupID] : false;
			$groupPath = ($src && isset($src['sourceID'])) ? ('{source:' . $src['sourceID'] . '}/') : '';
			$workspaces[] = array(
				'type'     => ($groupID == '1') ? 'company' : 'group',
				'id'       => 'group_' . $groupID,
				'name'     => $name,
				'path'     => $groupPath,
				'canWrite' => $groupPath ? $this->pathCanWrite($groupPath) : 0,
			);
		}
		return $workspaces;
	}

	private function pathCanWrite($path) {
		try {
			return Action('explorer.auth')->canWrite($path) ? 1 : 0;
		} catch (Exception $e) {
			return 0;
		}
	}

	/**
	 * Folder that receives a generated file: the given folder, or the parent of a file path.
	 * KodBox file paths look like {source:N}/ and IO::info ignores a name appended to them.
	 */
	private function saveFolder($path) {
		$info = IO::info($path);
		if (!is_array($info) || empty($info['path'])) return false;
		if (isset($info['type']) && $info['type'] !== 'folder') {
			$father = IO::pathFather($info['path']);
			return is_string($father) && $father !== '' ? $father : false;
		}
		return $info['path'];
	}

	/** Hidden English folder for temporary cloud files. Generated copies do not go here. */
	private function tempFolder($space) {
		$name = '.dsh';
		$parent = rtrim($space, '/');
		if (substr($parent, -strlen('/' . $name)) === '/' . $name) return $this->saveFolder($parent . '/');
		$parent .= '/';
		$data = Action('explorer.list')->path($parent);
		$folders = (is_array($data) && isset($data['folderList']) && is_array($data['folderList'])) ? $data['folderList'] : array();
		foreach ($folders as $item) {
			if (is_array($item) && isset($item['name']) && $item['name'] === $name && !empty($item['path'])) return $item['path'];
		}
		$created = IO::mkdir($parent . $name);
		return is_string($created) && $created !== '' ? $created : false;
	}

	private function summarizeList($data) {
		$pick = function ($items) {
			$rows = array();
			if (!is_array($items)) return $rows;
			foreach ($items as $item) {
				if (!is_array($item)) continue;
				$rows[] = array(
					'name' => isset($item['name']) ? $item['name'] : '',
					'path' => isset($item['path']) ? $item['path'] : '',
					'type' => isset($item['type']) ? $item['type'] : '',
					'size' => isset($item['size']) ? $item['size'] : 0,
				);
			}
			return $rows;
		};
		$current = isset($data['current']) && is_array($data['current']) ? $data['current'] : array();
		return array(
			'path' => isset($current['path']) ? $current['path'] : '',
			'folders' => $pick(isset($data['folderList']) ? $data['folderList'] : array()),
			'files' => $pick(isset($data['fileList']) ? $data['fileList'] : array()),
		);
	}

	/**
	 * Call one allowlisted KodBox API as the ask-token user.
	 * Reads run immediately. Writes are queued until the logged-in owner confirms.
	 * Login, password, and binary transfer are not included.
	 */
	public function callApi() {
		$record = $this->bindAskUser();
		if (!isset($record['mode']) || $record['mode'] !== 'settings') show_json('只有网盘设置模式可以调用管理接口', false);
		$route = isset($this->in['route']) ? $this->in['route'] : '';
		$catalog = $this->apiCatalog();
		if (!is_string($route) || !isset($catalog[$route])) show_json('该接口不在网盘设置允许列表中', false);
		$this->authorizeApi($route);
		$params = $this->apiParams();
		if (strpos($route, 'explorer/') === 0) $this->assertScopeInputs($record, $params);
		if (!empty($catalog[$route])) {
			$this->enqueueAll($this->askTokenInput(), $this->expandApiItems($route, $params));
		}
		$this->freshInput($params);
		$this->dispatchApi($route);
	}

	/** Browser session must match the ask token. The model cannot call this with the token alone. */
	public function setMode() {
		if (!isset($_SERVER['REQUEST_METHOD']) || $_SERVER['REQUEST_METHOD'] !== 'POST') show_json('POST required', false);
		list($token) = $this->ownedToken();
		$mode = isset($this->in['mode']) ? $this->in['mode'] : '';
		if (!in_array($mode, array('ask', 'help', 'settings'), true)) show_json(LNG('dshAsk.error.agentInput'), false);
		$this->updateToken($token, function ($record) use ($mode) {
			$record['mode'] = $mode;
			return $record;
		});
		show_json(array('mode' => $mode), true);
	}

	/** Run one queued write. The item stays queued until the action succeeds, so a failed click can be retried. */
	public function commitPending() {
		if (!isset($_SERVER['REQUEST_METHOD']) || $_SERVER['REQUEST_METHOD'] !== 'POST') show_json('POST required', false);
		list($token) = $this->ownedToken();
		$id = $this->pendingId();
		$item = $this->updateToken($token, function ($record) use ($id, $token) {
			$pending = (isset($record['pending']) && is_array($record['pending'])) ? $record['pending'] : array();
			$found = null;
			foreach ($pending as $index => $entry) {
				if (!is_array($entry) || !isset($entry['id']) || $entry['id'] !== $id) continue;
				$running = isset($entry['runningAt']) ? intval($entry['runningAt']) : 0;
				if ($this->runLockBusy($token, $id)) show_json('这条操作正在执行', false);
				if ($running > 0) show_json('上次执行结果未知，请先到网盘核对。可以取消这条，再重新发起。', false);
				if (!$this->takeRunLock($token, $id)) show_json(LNG('dshAsk.error.tokenIssue'), false);
				$entry['runningAt'] = time();
				$pending[$index] = $entry;
				$found = $entry;
				break;
			}
			if (!$found) show_json('没有这条待确认的操作', false);
			$record['pending'] = $pending;
			$record['_taken'] = $found;
			return $record;
		});
		try {
			$result = $this->captureJson(function () use ($item) { $this->runPending($item); });
			$ok = is_array($result) && !empty($result['code']);
			$this->updateToken($token, function ($record) use ($id, $ok) {
				$pending = (isset($record['pending']) && is_array($record['pending'])) ? $record['pending'] : array();
				$next = array();
				foreach ($pending as $entry) {
					if (!is_array($entry) || !isset($entry['id']) || $entry['id'] !== $id) { $next[] = $entry; continue; }
					if ($ok) continue;
					unset($entry['runningAt']);
					$next[] = $entry;
				}
				$record['pending'] = $next;
				$this->releaseRunLock();
				return $record;
			});
			show_json(array('done' => array(array(
				'id' => $id,
				'summary' => isset($item['summary']) ? $item['summary'] : '',
				'result' => $result,
			))), true);
		} finally {
			$this->releaseRunLock();
		}
	}

	/** Ids still waiting. The browser uses this after a refresh so a finished row does not offer confirm again. */
	public function listPending() {
		list(, $record) = $this->ownedToken();
		$rows = array();
		$pending = (isset($record['pending']) && is_array($record['pending'])) ? $record['pending'] : array();
		foreach ($pending as $entry) {
			if (!is_array($entry) || empty($entry['id'])) continue;
			$rows[] = array(
				'id' => $entry['id'],
				'summary' => isset($entry['summary']) ? $entry['summary'] : '',
			);
		}
		show_json(array('items' => $rows), true);
	}

	public function cancelPending() {
		if (!isset($_SERVER['REQUEST_METHOD']) || $_SERVER['REQUEST_METHOD'] !== 'POST') show_json('POST required', false);
		list($token) = $this->ownedToken();
		$id = $this->pendingId();
		$this->updateToken($token, function ($record) use ($id, $token) {
			$split = $this->splitPending($record, $id);
			if (!$split['item']) show_json('没有这条待确认的操作', false);
			if ($this->runLockBusy($token, $id)) show_json('这条操作正在执行，不能取消', false);
			$record['pending'] = $split['rest'];
			@unlink($this->runLockPath($token, $id));
			return $record;
		});
		show_json(array('cancelled' => $id), true);
	}

	private function requireBrowserUser() {
		if (!KodUser::isLogin()) {
			http_response_code(401);
			show_json(LNG('dshAsk.error.notLogin'), false);
		}
		$user = Session::get('kodUser');
		$this->requirePluginUser($user);
		return $user;
	}

	private function requirePluginUser($user) {
		if (!is_array($user) || empty($user['userID']) || (isset($user['status']) && strval($user['status']) === '0')) {
			show_json(LNG('dshAsk.error.notLogin'), false);
		}
		$config = $this->getConfig();
		if (isset($config['pluginAuth']) && !Action('user.authPlugin')->checkAuthValue($config['pluginAuth'], $user)) {
			http_response_code(403);
			show_json(LNG('explorer.noPermissionAction'), false);
		}
	}

	/** Validate browser ownership without changing the session to the token's user. */
	public function owner() {
		header('Cache-Control: no-store');
		list(, $record) = $this->ownedToken();
		show_json(array('userID' => $record['userID'], 'spacePath' => isset($record['spacePath']) ? $record['spacePath'] : ''), true);
	}

	private function ownedToken() {
		$user = $this->requireBrowserUser();
		$token = $this->askTokenInput();
		$record = $this->readAskToken($token);
		if (!$record || !is_array($user) || strval($record['userID']) !== strval($user['userID'])) {
			show_json(LNG('dshAsk.error.tokenInvalid'), false);
		}
		$this->requireCurrentSpace($record, Model('User')->getInfoFull($user['userID']));
		return array($token, $record);
	}

	/** Compare source ancestry, not display names or textual prefixes of source IDs. */
	private function pathInSpace($path, $root) {
		if (!is_string($path) || !is_string($root) || !preg_match('#^(\{source:\d+\}/)(.*)$#u', $path, $match)) return false;
		if (strpos($match[2], '\\') !== false || strpos($match[2], "\0") !== false) return false;
		foreach (explode('/', $match[2]) as $part) if ($part === '..' || $part === '.') return false;
		$cursor = $match[1];
		$seen = array();
		for ($i = 0; $i < 128; $i++) {
			if ($cursor === $root) return true;
			if (!$cursor || isset($seen[$cursor])) return false;
			$seen[$cursor] = true;
			$cursor = IO::pathFather($cursor);
		}
		return false;
	}

	private function requireCurrentSpace($record, $user) {
		$GLOBALS['isRoot'] = $this->userIsRoot($user) ? 1 : 0;
		$this->requirePluginUser($user);
		foreach ($this->listWorkspaces($user) as $space) {
			if (!empty($record['spacePath']) && $space['path'] === $record['spacePath']) return;
		}
		show_json('空间授权已失效，请从网盘重新打开问答', false);
	}

	private function assertScopeInputs($record, $fields) {
		foreach (array('path', 'from', 'to') as $key) {
			if (isset($fields[$key]) && !$this->pathInSpace($fields[$key], $record['spacePath'])) show_json('不能操作本次提问空间以外的文件', false);
		}
		if (isset($fields['dataArr'])) {
			$items = is_array($fields['dataArr']) ? $fields['dataArr'] : json_decode($fields['dataArr'], true);
			if (!is_array($items) || !$items) show_json(LNG('dshAsk.error.agentInput'), false);
			foreach ($items as $item) {
				if (!is_array($item) || empty($item['path']) || !$this->pathInSpace($item['path'], $record['spacePath'])) show_json('不能操作本次提问空间以外的文件', false);
			}
		}
	}

	private function apiParams() {
		$params = array();
		if (!isset($this->in['params'])) return $params;
		$decoded = is_array($this->in['params']) ? $this->in['params'] : json_decode($this->in['params'], true);
		if (!is_array($decoded)) return $params;
		foreach ($decoded as $key => $value) {
			if (!is_string($key) || !preg_match('/^[A-Za-z][A-Za-z0-9_]{0,40}$/', $key)) continue;
			if ($key === 'confirm' || $key === 'route' || $key === 'token' || $key === 'accessToken' || $key === 'shiftDelete') continue;
			if (is_array($value)) $value = json_encode($value, JSON_UNESCAPED_UNICODE);
			if (!is_scalar($value)) continue;
			$params[$key] = strval($value);
		}
		return $params;
	}

	private function pendingId() {
		$id = isset($this->in['id']) ? $this->in['id'] : '';
		if (!is_string($id) || !preg_match('/^[a-f0-9]{16}$/', $id)) show_json('没有这条待确认的操作', false);
		return $id;
	}

	private function splitPending($record, $id) {
		$list = (isset($record['pending']) && is_array($record['pending'])) ? $record['pending'] : array();
		$item = null;
		$rest = array();
		foreach ($list as $entry) {
			if ($item === null && is_array($entry) && isset($entry['id']) && $entry['id'] === $id) $item = $entry;
			else $rest[] = $entry;
		}
		return array('item' => $item, 'rest' => $rest);
	}

	/** Drop leftover fields so one queued call cannot change the next. Recycle never becomes a real delete. */
	private function freshInput($fields) {
		$token = $this->askTokenInput();
		$this->in = array('token' => $token);
		foreach ($fields as $key => $value) {
			if ($key === 'shiftDelete' || $key === 'confirm' || $key === 'route' || $key === 'accessToken') continue;
			$this->in[$key] = $value;
		}
	}

	/** Check the target action, not ACTION (which still names the plugin route). */
	private function authorizeApi($route) {
		if (KodUser::isRoot()) return;
		$user = Session::get('kodUser');
		$roleID = (is_array($user) && isset($user['roleID'])) ? $user['roleID'] : false;
		$role = $this->currentRoleAuth($roleID);
		$key = strtolower(str_replace('/', '.', $route));
		if (!is_array($role) || empty($role['allowAction'][$key])) {
			show_json(LNG('explorer.noPermissionAction'), false);
		}
	}

	/** Drop one role from KodBox's process cache, then read it again. Other roles stay warm. */
	private function currentRoleAuth($roleID) {
		$auth = Action('user.authRole');
		if (self::$clearRoleCache === null) {
			self::$clearRoleCache = \Closure::bind(function ($roleID) {
				if (!is_array(self::$authRole) || !array_key_exists($roleID, self::$authRole)) return;
				unset(self::$authRole[$roleID]);
			}, null, $auth);
		}
		if (self::$clearRoleCache && $roleID !== false && $roleID !== null && $roleID !== '') {
			try { (self::$clearRoleCache)($roleID); } catch (Throwable $error) {}
		}
		return $auth->userRoleAuth($roleID);
	}

	private function dispatchApi($route) {
		$this->authorizeApi($route);
		if (strpos($route, 'explorer/') === 0) {
			$record = $this->readAskToken($this->askTokenInput());
			if (!$record || empty($record['spacePath']) || (!isset($this->in['path']) && !isset($this->in['dataArr']))) show_json('文件接口必须指定当前空间的路径', false);
			$this->assertScopeInputs($record, $this->in);
		}
		if ($route === 'explorer/index/pathDelete') $this->requireRecycle();
		$parts = explode('/', $route);
		if (count($parts) !== 3) show_json('该接口不在网盘设置允许列表中', false);
		$action = Action($parts[0] . '.' . $parts[1]);
		$method = $parts[2];
		if (!is_object($action) || !method_exists($action, $method)) show_json('接口不可用', false);
		$action->$method();
	}

	private function requireRecycle() {
		$recycle = Model('UserOption')->get('recycleOpen');
		if ($recycle === 0 || $recycle === '0' || $recycle === false) show_json('回收站已关闭，已取消删除', false);
	}

	private function runPending($item) {
		$kind = isset($item['kind']) ? $item['kind'] : '';
		if ($kind === 'api') {
			$route = isset($item['route']) ? $item['route'] : '';
			$catalog = $this->apiCatalog();
			if (!isset($catalog[$route]) || empty($catalog[$route])) show_json('该接口不在网盘设置允许列表中', false);
			$params = (isset($item['params']) && is_array($item['params'])) ? $item['params'] : array();
			$this->freshInput($params);
			$this->bindAskUser();
			$this->dispatchApi($route);
			return;
		}
		if ($kind === 'remove') {
			$path = isset($item['path']) ? $item['path'] : '';
			$this->assertCloudId($path);
			$this->freshInput(array(
				'path' => $path,
				'dataArr' => json_encode(array(array('path' => $path))),
			));
			$this->bindAskUser();
			$this->requireRecycle();
			Action('explorer.index')->pathDelete();
			return;
		}
		if ($kind === 'rename') {
			$path = isset($item['path']) ? $item['path'] : '';
			$name = isset($item['newName']) ? $item['newName'] : '';
			$this->freshInput(array('path' => $path, 'newName' => $name));
			$this->bindAskUser();
			$this->assertCloudId($path);
			if (!is_string($name) || !preg_match('/^[^\\/\\\\:*?"<>|]{1,180}$/u', $name)) show_json(LNG('dshAsk.error.agentInput'), false);
			$this->in['newName'] = $this->spareCloudName($path, $name);
			Action('explorer.index')->pathRename();
			return;
		}
		if ($kind === 'mkdir') {
			$path = isset($item['path']) ? $item['path'] : '';
			$this->freshInput(array('path' => $path, 'fileRepeat' => 'rename'));
			$this->bindAskUser();
			if (!is_string($path) || !preg_match('/^\{source:\d+\}\/[^\\/\\\\:*?"<>|]{1,180}$/u', $path)) show_json(LNG('dshAsk.error.agentInput'), false);
			Action('explorer.index')->mkdir();
			return;
		}
		if ($kind === 'copy' || $kind === 'move') {
			$this->freshInput(array(
				'from' => isset($item['from']) ? $item['from'] : '',
				'to' => isset($item['to']) ? $item['to'] : '',
			));
			$this->manageTransfer($kind === 'copy' ? 'pathCopyTo' : 'pathCuteTo');
		}
	}

	private function hiddenParam($key) {
		return (bool)preg_match('/password|passwd|secret|accesstoken|(^|_)(pwd|token)$/i', $key);
	}

	private function apiSummary($route, $params) {
		$text = $this->apiSummaryText($route, is_array($params) ? $params : array());
		if (function_exists('mb_substr')) return mb_substr($text, 0, 120);
		return substr($text, 0, 180);
	}

	/** A sentence a person can confirm. Names replace user, group, role, and permission ids. */
	private function apiSummaryText($route, $params) {
		switch ($route) {
			case 'explorer/index/setAuth':
				return $this->summaryAuthChange('设置', $this->field($params, 'path'), $this->field($params, 'auth'));
			case 'explorer/userShare/add':
				return $this->summaryShare('分享', $params);
			case 'explorer/userShare/edit':
				return $this->summaryShare('修改分享', $params);
			case 'explorer/userShare/del':
				return '取消分享' . $this->dataNames($params);
			case 'explorer/index/mkdir':
				return '新建目录' . $this->quote($this->cloudLabel($this->field($params, 'path')));
			case 'explorer/index/mkfile':
				return '新建文件' . $this->quote($this->cloudLabel($this->field($params, 'path')));
			case 'explorer/index/pathRename':
				return '把' . $this->quote($this->namedPath($params, 'path')) . '重命名为' . $this->quote($this->field($params, 'newName'));
			case 'explorer/index/pathCopyTo':
				return '复制' . $this->dataNames($params) . '到' . $this->quote($this->namedPath($params, 'path'));
			case 'explorer/index/pathCuteTo':
				return '移动' . $this->dataNames($params) . '到' . $this->quote($this->namedPath($params, 'path'));
			case 'explorer/index/pathDelete':
				return '放入回收站' . $this->dataNames($params);
			case 'explorer/fav/add':
				return '收藏' . $this->quote($this->field($params, 'name') !== '' ? $this->field($params, 'name') : $this->namedPath($params, 'path'));
			case 'explorer/fav/del':
				return '取消收藏' . $this->quote($this->field($params, 'name'));
			case 'admin/group/add':
				return '新建部门' . $this->quote($this->field($params, 'name')) . $this->parentSuffix($params);
			case 'admin/group/edit':
				return '编辑部门' . $this->quote($this->namedGroup($params));
			case 'admin/group/remove':
				return '删除部门' . $this->quote($this->groupName($this->field($params, 'groupID')));
			case 'admin/member/add':
				return '新增用户' . $this->quote($this->accountLabel($params));
			case 'admin/member/edit':
				return '编辑用户' . $this->quote($this->namedUser($params));
			case 'admin/member/addGroup':
				return '把' . $this->quote($this->personName($this->field($params, 'userID'))) . '加入' . $this->quote($this->groupName($this->field($params, 'groupID'))) . '，权限为' . $this->authName($this->field($params, 'authID'));
			case 'admin/member/removeGroup':
				return '把' . $this->quote($this->personName($this->field($params, 'userID'))) . '移出' . $this->quote($this->groupName($this->field($params, 'groupID')));
			case 'admin/member/status':
				return ($this->field($params, 'status') === '1' ? '启用用户' : '禁用用户') . $this->quote($this->personName($this->field($params, 'userID')));
			case 'admin/member/remove':
				return '删除用户' . $this->quote($this->personName($this->field($params, 'userID')));
			case 'admin/role/add':
				return '新增角色' . $this->quote($this->field($params, 'name'));
			case 'admin/role/edit':
				return '编辑角色' . $this->quote($this->namedRole($params));
			case 'admin/role/remove':
				return '删除角色' . $this->quote($this->roleName($this->field($params, 'id') !== '' ? $this->field($params, 'id') : $this->field($params, 'roleID')));
			case 'admin/auth/add':
				return '新增文档权限' . $this->quote($this->field($params, 'name'));
			case 'admin/auth/edit':
				return '编辑文档权限' . $this->quote($this->namedAuth($params));
			case 'admin/auth/remove':
				return '删除文档权限' . $this->quote($this->authName($this->field($params, 'id')));
		}
		return $route;
	}

	private function summaryAuthChange($verb, $path, $auth) {
		$parts = $this->authParts($auth);
		$text = $verb . $this->quote($this->cloudLabel($path)) . '的权限';
		return $parts ? $text . '：' . implode('，', $parts) : $text;
	}

	private function summaryShare($verb, $params) {
		$text = $verb . $this->quote($this->field($params, 'title'));
		$parts = $this->authParts($this->field($params, 'authTo'));
		return $parts ? $text . '给 ' . implode('、', $parts) : $text;
	}

	private function authParts($auth) {
		$parts = array();
		foreach ($this->jsonList($auth) as $row) {
			if (!is_array($row)) continue;
			$type = isset($row['targetType']) ? intval($row['targetType']) : 1;
			$target = isset($row['targetID']) ? strval($row['targetID']) : '';
			$right = $this->authName(isset($row['authID']) ? $row['authID'] : '');
			if ($target === '0') $who = '部门内所有人';
			elseif ($type === 2) $who = $this->groupName($target);
			else $who = $this->personName($target);
			if ($who === '') continue;
			$parts[] = $right !== '' ? $who . ' ' . $right : $who;
		}
		return $parts;
	}

	private function parentSuffix($params) {
		$parent = $this->field($params, 'parentID');
		if ($parent === '' || $parent === '0') return '';
		return '，上级为' . $this->quote($this->groupName($parent));
	}

	private function namedUser($params) {
		$written = $this->accountLabel($params);
		if ($written !== '') return $written;
		return $this->personName($this->field($params, 'userID'));
	}

	private function namedGroup($params) {
		$name = $this->field($params, 'name');
		return $name !== '' ? $name : $this->groupName($this->field($params, 'groupID'));
	}

	private function namedRole($params) {
		$name = $this->field($params, 'name');
		$id = $this->field($params, 'id') !== '' ? $this->field($params, 'id') : $this->field($params, 'roleID');
		return $name !== '' ? $name : $this->roleName($id);
	}

	private function namedAuth($params) {
		$name = $this->field($params, 'name');
		return $name !== '' ? $name : $this->authName($this->field($params, 'id'));
	}

	private function namedPath($params, $key) {
		return $this->cloudLabel($this->field($params, $key));
	}

	private function accountLabel($params) {
		$name = $this->field($params, 'name');
		$nick = $this->field($params, 'nickName');
		if ($name !== '' && $nick !== '' && $name !== $nick) return $name . '（' . $nick . '）';
		return $name !== '' ? $name : $nick;
	}

	private function dataNames($params) {
		$names = array();
		foreach ($this->jsonList($this->field($params, 'dataArr')) as $row) {
			if (is_string($row) && $row !== '') { $names[] = $row; continue; }
			if (!is_array($row)) continue;
			$name = isset($row['name']) && is_string($row['name']) ? $row['name'] : '';
			if ($name === '' && isset($row['path'])) $name = $this->cloudLabel($row['path']);
			if ($name !== '') $names[] = $name;
		}
		$names = array_slice($names, 0, 3);
		return $names ? '「' . implode('」「', $names) . '」' : '';
	}

	private function quote($text) {
		$text = trim(strval($text));
		return $text === '' ? '' : '「' . $text . '」';
	}

	private function field($params, $key) {
		return (isset($params[$key]) && is_scalar($params[$key])) ? trim(strval($params[$key])) : '';
	}

	private function jsonList($value) {
		if (is_array($value)) return array_is_list($value) ? $value : array($value);
		if (!is_string($value) || $value === '') return array();
		$decoded = json_decode($value, true);
		if (!is_array($decoded)) return array();
		return array_is_list($decoded) ? $decoded : array($decoded);
	}

	private function personName($id) {
		if ($id === '' || $id === '0') return $id === '0' ? '部门内所有人' : '';
		$row = $this->modelRow('User', $id);
		$name = isset($row['name']) ? trim(strval($row['name'])) : '';
		$nick = isset($row['nickName']) ? trim(strval($row['nickName'])) : '';
		if ($name !== '' && $nick !== '' && $name !== $nick) return $name . '（' . $nick . '）';
		if ($name !== '') return $name;
		if ($nick !== '') return $nick;
		return '用户' . $id;
	}

	private function groupName($id) {
		if ($id === '' || $id === '0') return '';
		$row = $this->modelRow('Group', $id);
		$name = isset($row['name']) ? trim(strval($row['name'])) : '';
		return $name !== '' ? $name : ('部门' . $id);
	}

	private function roleName($id) {
		if ($id === '') return '';
		$row = $this->modelRow('SystemRole', $id);
		$name = isset($row['name']) ? trim(strval($row['name'])) : '';
		return $name !== '' ? $name : ('角色' . $id);
	}

	private function authName($id) {
		$id = strval($id);
		if ($id === '') return '';
		$names = $this->authCatalog();
		return isset($names[$id]) && $names[$id] !== '' ? $names[$id] : ('权限' . $id);
	}

	private function authCatalog() {
		if (is_array($this->authNames)) return $this->authNames;
		$this->authNames = array();
		try {
			$object = Model('Auth');
			if (!method_exists($object, 'listData')) return $this->authNames;
			$data = $object->listData();
			$list = array();
			if (is_array($data) && isset($data['list']) && is_array($data['list'])) $list = $data['list'];
			elseif (is_array($data) && array_is_list($data)) $list = $data;
			foreach ($list as $row) {
				if (!is_array($row) || !isset($row['id'])) continue;
				$this->authNames[strval($row['id'])] = isset($row['name']) ? trim(strval($row['name'])) : '';
			}
		} catch (Throwable $error) {
			$this->authNames = array();
		}
		return $this->authNames;
	}

	private function modelRow($model, $id) {
		$id = strval($id);
		$key = $model . ':' . $id;
		if (array_key_exists($key, $this->labelCache)) return $this->labelCache[$key];
		$row = array();
		$object = null;
		try { $object = Model($model); } catch (Throwable $error) { $object = null; }
		if ($object) {
			$methods = $model === 'User' ? array('getInfoFull', 'getInfo') : array('getInfo', 'listData');
			foreach ($methods as $method) {
				if (!method_exists($object, $method)) continue;
				try { $got = $object->$method($id); } catch (Throwable $error) { continue; }
				if (!is_array($got)) continue;
				$row = $got;
				if ($this->rowNamed($got)) break;
			}
			if (!$this->rowNamed($row)) {
				try { $found = $this->findRow($object, $model, $id); } catch (Throwable $error) { $found = null; }
				if (is_array($found)) $row = $found;
			}
		}
		$this->labelCache[$key] = $row;
		return $row;
	}

	private function rowNamed($row) {
		if (!is_array($row)) return false;
		foreach (array('name', 'nickName') as $key) {
			if (isset($row[$key]) && trim(strval($row[$key])) !== '') return true;
		}
		return false;
	}

	private function findRow($object, $model, $id) {
		$field = $model === 'Group' ? 'groupID' : ($model === 'User' ? 'userID' : 'id');
		if (!method_exists($object, 'where')) return null;
		$query = $object->where(array($field => $id));
		if (!is_object($query) || !method_exists($query, 'find')) return null;
		$found = $query->find();
		return is_array($found) ? $found : null;
	}

	/** One queued confirm per dataArr entry. A single click cannot apply a hidden list. */
	private function expandApiItems($route, $params) {
		$data = (isset($params['dataArr']) && is_string($params['dataArr'])) ? json_decode($params['dataArr'], true) : null;
		if (!is_array($data) || !array_is_list($data) || count($data) <= 1) {
			return array(array(
				'kind' => 'api',
				'route' => $route,
				'params' => $params,
				'summary' => $this->apiSummary($route, $params),
			));
		}
		$items = array();
		foreach ($data as $row) {
			if (!is_array($row)) continue;
			$one = $params;
			$one['dataArr'] = json_encode(array($row), JSON_UNESCAPED_UNICODE);
			$items[] = array(
				'kind' => 'api',
				'route' => $route,
				'params' => $one,
				'summary' => $this->apiSummary($route, $one),
			);
		}
		if (!$items) show_json(LNG('dshAsk.error.agentInput'), false);
		return $items;
	}

	private function enqueue($token, $item) {
		$this->enqueueAll($token, array($item));
	}

	private function enqueueAll($token, $items) {
		if (!$items) show_json(LNG('dshAsk.error.agentInput'), false);
		$reply = $this->updateToken($token, function ($record) use ($items) {
			if (isset($record['mode']) && $record['mode'] === 'help') show_json('帮助文档模式不操作网盘', false);
			$pending = (isset($record['pending']) && is_array($record['pending'])) ? $record['pending'] : array();
			if (count($pending) + count($items) > 20) show_json('待确认操作已满，请先确认或取消', false);
			$out = array();
			foreach ($items as $item) {
				if (isset($item['kind']) && $item['kind'] === 'api' && (!isset($record['mode']) || $record['mode'] !== 'settings')) {
					show_json('只有网盘设置模式可以调用管理接口', false);
				}
				$item['id'] = bin2hex(random_bytes(8));
				$pending[] = $item;
				$out[] = array(
					'pending' => true,
					'id' => $item['id'],
					'summary' => isset($item['summary']) ? $item['summary'] : '',
				);
			}
			$record['pending'] = $pending;
			if (count($out) === 1) {
				$record['_taken'] = array(
					'pending' => true,
					'id' => $out[0]['id'],
					'summary' => $out[0]['summary'],
					'count' => count($pending),
					'confirm' => '输入框上方的确认执行',
				);
			} else {
				$record['_taken'] = array(
					'pending' => true,
					'items' => $out,
					'count' => count($pending),
					'confirm' => '输入框上方的确认执行',
				);
			}
			return $record;
		});
		show_json($reply, true);
	}

	/** True while the worker that took this item is still alive. A dead process drops the lock at once. */
	private function runLockBusy($token, $id) {
		$file = $this->runLockPath($token, $id);
		if (!is_file($file)) return false;
		$lock = @fopen($file, 'c');
		if (!$lock) return true;
		$busy = !flock($lock, LOCK_EX | LOCK_NB);
		if (!$busy) flock($lock, LOCK_UN);
		fclose($lock);
		return $busy;
	}

	private function takeRunLock($token, $id) {
		$file = $this->runLockPath($token, $id);
		$dir = dirname($file);
		if (!is_dir($dir)) @mkdir($dir, 0775, true);
		$lock = @fopen($file, 'c');
		if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
			if (is_resource($lock)) fclose($lock);
			return false;
		}
		$this->runLock = $lock;
		$this->runLockFile = $file;
		return true;
	}

	private function releaseRunLock() {
		if (is_resource($this->runLock)) {
			flock($this->runLock, LOCK_UN);
			fclose($this->runLock);
		}
		$this->runLock = null;
		if ($this->runLockFile !== '') {
			@unlink($this->runLockFile);
			$this->runLockFile = '';
		}
	}

	private function runLockPath($token, $id) {
		$safe = preg_replace('/[^a-zA-Z0-9_]/', '', $token . '_' . $id);
		return $this->askTokenDir() . 'run_' . $safe . '.lock';
	}

	/** Serialize read-modify-write on a sidecar lock. The JSON itself is replaced atomically. */
	private function updateToken($token, $mutate) {
		$outcome = $this->commitToken($token, $mutate);
		if (!empty($outcome['invalid'])) show_json(LNG('dshAsk.error.tokenInvalid'), false);
		if (empty($outcome['ok'])) show_json(LNG('dshAsk.error.tokenIssue'), false);
		return $outcome['taken'];
	}

	private function commitToken($token, $mutate) {
		$lock = $this->openTokenLock($token);
		if (!$lock) return array('ok' => false, 'invalid' => false, 'taken' => null);
		try {
			$record = $this->readAskToken($token);
			if (!is_array($record)) return array('ok' => false, 'invalid' => true, 'taken' => null);
			$next = $mutate($record);
			$taken = (is_array($next) && isset($next['_taken'])) ? $next['_taken'] : null;
			if (is_array($next)) unset($next['_taken']);
			if (!is_array($next) || !$this->writeAskToken($token, $next)) return array('ok' => false, 'invalid' => false, 'taken' => null);
			return array('ok' => true, 'invalid' => false, 'taken' => $taken);
		} finally {
			flock($lock, LOCK_UN);
			fclose($lock);
		}
	}

	private function openTokenLock($token) {
		$file = $this->askTokenDir() . 'lock_' . preg_replace('/[^a-zA-Z0-9_]/', '', $token) . '.lock';
		$dir = dirname($file);
		if (!is_dir($dir)) @mkdir($dir, 0775, true);
		$lock = @fopen($file, 'c');
		if (!$lock || !flock($lock, LOCK_EX)) {
			if (is_resource($lock)) fclose($lock);
			return false;
		}
		return $lock;
	}

	/** Run one KodBox action and keep its JSON instead of ending the request. */
	private function captureJson($callback) {
		$GLOBALS['SHOW_OUT_EXCEPTION'] = true;
		try {
			$callback();
		} catch (Throwable $error) {
			$GLOBALS['SHOW_OUT_EXCEPTION'] = false;
			$decoded = json_decode($error->getMessage(), true);
			return is_array($decoded) ? $decoded : array('code' => false, 'data' => $error->getMessage());
		}
		$GLOBALS['SHOW_OUT_EXCEPTION'] = false;
		return array('code' => false, 'data' => '操作没有返回结果');
	}

	/** route => true when the call changes data and needs confirm. */
	private function apiCatalog() {
		$read = array(
			'explorer/list/path' => false,
			'explorer/index/pathInfo' => false,
			'admin/group/get' => false,
			'admin/group/getByID' => false,
			'admin/group/search' => false,
			'admin/member/get' => false,
			'admin/member/getByID' => false,
			'admin/member/search' => false,
			'admin/role/get' => false,
			'admin/auth/get' => false,
			'user/view/options' => false,
		);
		$write = array(
			'explorer/index/mkdir', 'explorer/index/pathRename', 'explorer/index/pathCuteTo', 'explorer/index/pathCopyTo',
			'explorer/index/pathDelete', 'explorer/index/mkfile', 'explorer/index/setAuth', 'explorer/fav/add',
			'admin/group/add', 'admin/group/edit', 'admin/group/remove',
			'admin/member/add', 'admin/member/edit', 'admin/member/addGroup', 'admin/member/removeGroup', 'admin/member/status', 'admin/member/remove',
			'admin/role/add', 'admin/role/edit', 'admin/role/remove',
			'admin/auth/add', 'admin/auth/edit', 'admin/auth/remove',
		);
		foreach ($write as $route) $read[$route] = true;
		return $read;
	}

	/** Act as the user recorded on the ask token. A DSH request has no KodBox browser session to restore. */
	private function bindAskUser() {
		$record = $this->readAskToken($this->askTokenInput());
		if (!$record || empty($record['userID'])) show_json(LNG('dshAsk.error.tokenInvalid'), false);
		$browser = Session::get('kodUser');
		if (KodUser::isLogin() && is_array($browser) && !empty($browser['userID']) && strval($browser['userID']) !== strval($record['userID'])) {
			show_json('当前网盘账号与提问账号不匹配', false);
		}
		$user = Model('User')->getInfoFull($record['userID']);
		if (!is_array($user) || empty($user['userID']) || (isset($user['status']) && strval($user['status']) === '0')) {
			show_json(LNG('dshAsk.error.tokenInvalid'), false);
		}
		$GLOBALS['isRoot'] = $this->userIsRoot($user) ? 1 : 0;
		$this->requirePluginUser($user);
		Session::set('kodUser', $user);
		KodUser::set($user['userID']);
		if (!defined('USER_ID')) KodUser::init($user['userID']);
		if (!defined('MY_HOME') && !empty($user['sourceInfo']['sourceID'])) define('MY_HOME', KodIO::make($user['sourceInfo']['sourceID']));
		if (!defined('MY_DESKTOP') && !empty($user['sourceInfo']['desktop'])) define('MY_DESKTOP', KodIO::make($user['sourceInfo']['desktop']));
		$this->requireCurrentSpace($record, $user);
		$this->assertScopeInputs($record, $this->in);
		return $record;
	}

	private function userIsRoot($user) {
		$role = Model('SystemRole')->listData(isset($user['roleID']) ? $user['roleID'] : false);
		return is_array($role) && isset($role['administrator']) && $role['administrator'] == '1';
	}

	private function userFromAskOrSession() {
		if (KodUser::isLogin()) {
			return Session::get('kodUser');
		}
		$token = isset($this->in['token']) ? $this->in['token'] : '';
		if (!$token) $token = isset($this->in['askToken']) ? $this->in['askToken'] : '';
		$record = $this->readAskToken($token);
		if (!$record || empty($record['userID'])) return false;
		$user = Model('User')->getInfoFull($record['userID']);
		return is_array($user) ? $user : false;
	}

	private function writeAskToken($token, $record) {
		$file = $this->askTokenFile($token);
		$dir = dirname($file);
		if (!is_dir($dir)) @mkdir($dir, 0775, true);
		$encoded = json_encode($record, JSON_UNESCAPED_UNICODE);
		if ($encoded === false) return false;
		$tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
		$written = @file_put_contents($tmp, $encoded, LOCK_EX);
		if ($written !== strlen($encoded)) { @unlink($tmp); return false; }
		@chmod($tmp, 0600);
		if (!@rename($tmp, $file)) { @unlink($tmp); return false; }
		@chmod($file, 0600);
		return true;
	}

	private function readAskToken($token) {
		if (!$token || !is_string($token) || strlen($token) > 80) return false;
		if (!preg_match('/^ask_[a-f0-9]{32}$/', $token)) return false;
		$file = $this->askTokenFile($token);
		if (!is_file($file)) return false;
		$data = json_decode(@file_get_contents($file), true);
		if (!is_array($data) || empty($data['expire'])) return false;
		if ($data['expire'] < time()) {
			@unlink($file);
			return false;
		}
		return $data;
	}

	private function askTokenDir() {
		$base = defined('DATA_PATH') ? DATA_PATH : (BASIC_PATH . 'data/');
		return rtrim($base, '/') . '/temp/dshAsk/';
	}

	private function askTokenFile($token) {
		$safe = preg_replace('/[^a-zA-Z0-9_]/', '', $token);
		return $this->askTokenDir() . $safe . '.json';
	}
}
