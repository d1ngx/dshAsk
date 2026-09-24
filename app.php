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
		header('Cache-Control: no-store');
		$file = rtrim(DATA_PATH, '/') . '/dsh-launch-token';
		$token = is_file($file) ? trim((string)file_get_contents($file)) : '';
		if (!preg_match('/^[A-Za-z0-9_-]{16,128}$/', $token)) {
			show_tips('DSH 还没有就绪，请稍后再打开 /dsh/');
		}
		header('Location: /dsh/?token=' . rawurlencode($token));
		exit;
	}

	public function index() {
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
		if (!KodUser::isLogin()) {
			show_json(LNG('dshAsk.error.notLogin'), false);
		}
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
		if (!KodUser::isLogin()) show_json(LNG('dshAsk.error.notLogin'), false);
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
		if (!KodUser::isLogin()) show_json(LNG('dshAsk.error.notLogin'), false);
		header('Cache-Control: no-store');
		$registry = $this->agentRegistry();
		show_json(array('schemaVersion' => 1, 'agents' => $registry->all(), 'invalidManifestCount' => count($registry->errors())), true);
	}

	/** Create a task handoff. This endpoint does not claim the DSH task has executed. */
	public function openAgent() {
		if (!KodUser::isLogin()) show_json(LNG('dshAsk.error.notLogin'), false);
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
		if (!KodUser::isLogin()) show_json(LNG('dshAsk.error.notLogin'), false);
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
		return "[DSH_HANDOFF]\n调用 kodbox_context，askToken=" . $token . "。成功取得上下文后再处理任务；不要把此 token 写入输出文件或回复。";
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
	 * DSH 用 askToken 拉取问答上下文（含 accessToken，供官方 explorer API）
	 * 允许未登录访问：凭据是不可猜测的 askToken（pluginAuthOpen）
	 */
	public function context() {
		header('Cache-Control: no-store');
		$token = isset($this->in['token']) ? $this->in['token'] : '';
		if (!$token) $token = isset($this->in['askToken']) ? $this->in['askToken'] : '';
		$record = $this->readAskToken($token);
		if (!$record) {
			show_json(LNG('dshAsk.error.tokenInvalid'), false);
		}
		unset($record['expire'], $record['accessToken']);
		show_json($record, true);
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
		if ($this->askTokenInput()) $this->bindAskUser();
		$user = $this->userFromAskOrSession();
		if (!$user) {
			show_json(LNG('dshAsk.error.notLogin'), false);
		}
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
		$bytes = file_get_contents('php://input');
		if (!is_string($bytes) || $bytes === '' || strlen($bytes) > 41943040) show_json(LNG('dshAsk.error.agentInput'), false);
		$this->in['path'] = rtrim($folder, '/') . '/' . $name;
		$this->in['content'] = $bytes;
		Action('explorer.index')->mkfile();
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
			'workspaces'  => $this->listWorkspaces($user),
			'apiBase'     => rtrim(APP_HOST, '/') . '/',
			'expire'      => time() + self::TOKEN_TTL,
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
		if (defined('MY_HOME') && MY_HOME) {
			$workspaces[] = array(
				'type'     => 'home',
				'id'       => 'home',
				'name'     => '个人空间',
				'path'     => MY_HOME,
				'canWrite' => $this->pathCanWrite(MY_HOME),
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

	/** Act as the user recorded on the ask token. A DSH request has no KodBox browser session to restore. */
	private function bindAskUser() {
		$record = $this->readAskToken($this->askTokenInput());
		if (!$record || empty($record['userID'])) show_json(LNG('dshAsk.error.tokenInvalid'), false);
		$user = Model('User')->getInfoFull($record['userID']);
		if (!is_array($user) || empty($user['userID']) || (isset($user['status']) && strval($user['status']) === '0')) {
			show_json(LNG('dshAsk.error.tokenInvalid'), false);
		}
		Session::set('kodUser', $user);
		KodUser::set($user['userID']);
		if (!defined('USER_ID')) KodUser::init($user['userID']);
		if (!defined('MY_HOME') && !empty($user['sourceInfo']['sourceID'])) define('MY_HOME', KodIO::make($user['sourceInfo']['sourceID']));
		if (!defined('MY_DESKTOP') && !empty($user['sourceInfo']['desktop'])) define('MY_DESKTOP', KodIO::make($user['sourceInfo']['desktop']));
		$GLOBALS['isRoot'] = 0;
		$role = Model('SystemRole')->listData($user['roleID']);
		if (is_array($role) && isset($role['administrator']) && $role['administrator'] == '1') $GLOBALS['isRoot'] = 1;
		return $record;
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
		$written = @file_put_contents($file, $encoded, LOCK_EX);
		if ($written !== strlen($encoded)) { @unlink($file); return false; }
		@chmod($file, 0600);
		return true;
	}

	private function readAskToken($token) {
		if (!$token || !is_string($token) || strlen($token) > 80) return false;
		if (!preg_match('/^ask_[a-f0-9]{32}$/', $token)) return false;
		$file = $this->askTokenFile($token);
		if (!is_file($file)) return false;
		$data = json_decode(@file_get_contents($file), true);
		if (!is_array($data) || empty($data['expire']) || $data['expire'] < time()) {
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
