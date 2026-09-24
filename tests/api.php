<?php
class JsonResult extends Exception { public $data; public $ok; public function __construct($data, $ok) { $this->data=$data; $this->ok=$ok; } }
function show_json($data, $ok) { throw new JsonResult($data, $ok); }
function LNG($key) { return $key; }
function _get($data, $key, $default) { return isset($data[$key]) ? $data[$key] : $default; }
class PluginBase { public $in=array(); public static $config=array(); public function __construct() {} public function getConfig() { return self::$config; } }
class KodUser { public static $logged=true; public static function isLogin(){return self::$logged;} }
class Session { public static function get($key){return array('userID'=>7,'name'=>'tester');} public static function sign(){return 'valid-session-sign';} }
class Mcrypt { public static function encode($sign,$pass,$ttl){return 'test-access-token-123456789';} }
class FakeModel { public function get($key){return 'system-password';} }
function Model($name){return new FakeModel;}
define('APP_HOST','https://kodbox.example/');
define('DATA_PATH',sys_get_temp_dir().'/dsh-api-'.bin2hex(random_bytes(8)).'/');
require __DIR__.'/../app.php';
function callApi($method,$input=array()) { $p=new dshAskPlugin; $p->in=$input; try{$p->$method();}catch(JsonResult $r){return $r;} throw new Exception('Missing response'); }
function expect($value,$message){if(!$value)throw new Exception($message);}
$_SERVER['REQUEST_METHOD']='POST';
$valid=array('agentId'=>'word-report','files'=>'[]','request'=>'生成周报','outputFormat'=>'docx','style'=>'minimal','currentPath'=>'{source:7}/');
try {
    KodUser::$logged=false; expect(!callApi('agents')->ok,'catalog requires login'); expect(!callApi('openAgent',$valid)->ok,'launch requires login'); KodUser::$logged=true;
    expect(count(callApi('agents')->data['agents'])===9,'catalog');
    $_SERVER['REQUEST_METHOD']='GET';expect(!callApi('openAgent',$valid)->ok,'POST required');$_SERVER['REQUEST_METHOD']='POST';
    foreach(array(array('agentId'=>'missing'),array('request'=>''),array('outputFormat'=>'exe'),array('style'=>'bad'),array('files'=>'{'),array('files'=>'[{"path": []}]'),array('currentPath'=>array()),array('request'=>str_repeat('x',12001))) as $override) expect(!callApi('openAgent',array_merge($valid,$override))->ok,'invalid task rejected');
    PluginBase::$config=array('disabledAgents'=>'word-report');expect(!callApi('openAgent',$valid)->ok,'disabled agent');
    PluginBase::$config=array('dshUrl'=>'/dsh/?theme=dark#chat');
    $result=callApi('openAgent',$valid);expect($result->ok,'task prepared');expect(strpos($result->data['link'],'?theme=dark&kodAsk=')!==false && substr($result->data['link'],-5)==='#chat','query and fragment preserved');
    $context=callApi('context',array('token'=>$result->data['token']));expect($context->ok && $context->data['agentTask']['agent']['id']==='word-report','task persisted');expect($context->data['agentTask']['request']==='生成周报','request preserved');expect(!isset($context->data['accessToken']),'access token stays on the server');
    $classic=callApi('openAsk',array('files'=>'[]','currentPath'=>'{source:7}/'));expect($classic->ok,'classic ask works');
    expect(!isset(callApi('context',array('token'=>$classic->data['token']))->data['agentTask']),'classic context unchanged');
    expect(!callApi('context',array('token'=>'../test'))->ok,'invalid token rejected');
    echo "API: authentication, validation, persistence, URL and Q&A regression checks passed\n";
} finally {
    foreach(glob(DATA_PATH.'temp/dshAsk/*') ?: array() as $f)unlink($f);
    if(is_dir(DATA_PATH.'temp/dshAsk'))rmdir(DATA_PATH.'temp/dshAsk');
    if(is_dir(DATA_PATH.'temp'))rmdir(DATA_PATH.'temp');
    if(is_dir(DATA_PATH))rmdir(DATA_PATH);
}
