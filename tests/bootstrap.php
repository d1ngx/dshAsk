<?php
class JsonResult extends Exception {
    public $data; public $ok; public $info;
    public function __construct($data, $ok, $info = '') { parent::__construct(is_string($data) ? $data : 'JSON'); $this->data=$data; $this->ok=$ok; $this->info=$info; }
}
function show_json($data, $ok = true, $info = '') {
    // Match KodBox's exception branch, which intentionally does not include info.
    if (!empty($GLOBALS['SHOW_OUT_EXCEPTION'])) throw new Exception(json_encode(array('data'=>$data,'code'=>$ok)));
    throw new JsonResult($data, $ok, $info);
}
function LNG($key) { return $key; }
function _get($data, $key, $default = null) { return isset($data[$key]) ? $data[$key] : $default; }
class PluginBase { public $in=array(); public static $config=array(); public function __construct() {} public function getConfig() { return self::$config; } }
class KodUser {
    public static $logged=true;
    public static function isLogin(){return self::$logged;}
    public static function isRoot(){return !empty($GLOBALS['isRoot']);}
    public static function set($id) {}
    public static function init($id) { if (!defined('USER_ID')) define('USER_ID', $id); }
}
class Session {
    public static $user=array('userID'=>7,'name'=>'tester','roleID'=>2,'status'=>1);
    public static function get($key){return self::$user;}
    public static function set($key,$value){self::$user=$value;}
    public static function sign(){return 'valid-session-sign';}
}
class Mcrypt { public static function encode($sign,$pass,$ttl){return 'test-access-token-123456789';} }
class FakeModel {
    public static $administrator=0;
    public static $rows=array();
    public static $blankInfo=false;
    public $model='';
    public function get($key){return 'system-password';}
    public function getInfo($id){
        if (self::$blankInfo) return array();
        $key=$this->model.':'.$id;
        return isset(self::$rows[$key]) && is_array(self::$rows[$key]) ? self::$rows[$key] : array();
    }
    public function getInfoFull($id){
        $key=$this->model.':'.$id;
        $stored=isset(self::$rows[$key]) && is_array(self::$rows[$key]) ? self::$rows[$key] : array();
        $row=$stored ? $stored : $this->getInfo($id);
        if (!isset($row['userID'])) $row['userID']=$id;
        if (!isset($row['name'])) $row['name']='tester';
        if (!isset($row['roleID'])) $row['roleID']=2;
        if (!isset($row['status'])) $row['status']=1;
        return $row;
    }
    public function listData($id=false){
        if ($this->model==='Auth' && ($id===false || $id===null || $id==='')) {
            return array('list'=>isset(self::$rows['Auth']) && is_array(self::$rows['Auth']) ? self::$rows['Auth'] : array());
        }
        if ($id===false || $id===null || $id==='') return array('administrator'=>self::$administrator);
        $key=$this->model.':'.$id;
        if (isset(self::$rows[$key]) && is_array(self::$rows[$key])) {
            $row=self::$rows[$key];
            if (!isset($row['administrator'])) $row['administrator']=self::$administrator;
            return $row;
        }
        return array('administrator'=>self::$administrator);
    }
}
function Model($name){$model=new FakeModel;$model->model=$name;return $model;}
class FakeAction {
    public static $allow=array(); public static $calls=0; public static $pluginAllowed=true; public static $writable=true;
    protected static $authRole;
    public function userRoleAuth($roleID=false){
        if (!is_array(self::$authRole)) self::$authRole = array();
        $key = ($roleID === false || $roleID === null || $roleID === '') ? 0 : $roleID;
        if (isset(self::$authRole[$key])) return self::$authRole[$key];
        self::$authRole[$key] = array('allowAction'=>self::$allow);
        return self::$authRole[$key];
    }
    public function checkAuthValue($auth,$user){
        if (is_array($auth) && isset($auth['user']) && $auth['user'] === 'admin') return (bool)KodUser::isRoot();
        return self::$pluginAllowed;
    }
    public function canWrite($path){return self::$writable;}
    public function pathAllowCheck(&$path){}
    public function edit(){self::$calls++;show_json('edited',true);}
    public function get(){self::$calls++;show_json(array('ok'=>true),true);}
}
function Action($name){return new FakeAction;}
class IO {
    public static $items=array(); public static $next=100;
    public static function info($path){return isset(self::$items[$path]) ? self::$items[$path] : false;}
    public static function mkfile($path,$bytes,$repeat){
        if($repeat!=='rename')throw new Exception('must never overwrite');
        $cloud='{source:'.self::$next++.'}/';
        self::$items[$cloud]=array('path'=>$cloud,'name'=>basename($path),'type'=>'file','createTime'=>time(),'createUser'=>7);
        return $cloud;
    }
    public static function remove($path, $recycle = true) {
        if (!isset(self::$items[$path])) return false;
        unset(self::$items[$path]);
        return true;
    }
    public static function getLastError($fallback) { return $fallback; }
}
define('APP_HOST','https://kodbox.example/');
define('DATA_PATH',sys_get_temp_dir().'/dsh-api-'.bin2hex(random_bytes(8)).'/');
require __DIR__.'/../app.php';
function callApi($method,$input=array()) { $p=new dshAskPlugin; $p->in=$input; try{$p->$method();}catch(JsonResult $r){return $r;} throw new Exception('Missing response: '.$method); }
function expect($value,$message){if(!$value)throw new Exception($message);}
function privateCall($method,$input,$args=array()) {
    $p=new dshAskPlugin; $p->in=$input;
    $r=new ReflectionMethod($p,$method);
    try{return $r->invokeArgs($p,$args);}catch(JsonResult $result){return $result;}
}
function cleanupTokens(){
    foreach(glob(DATA_PATH.'temp/dshAsk/*') ?: array() as $f)unlink($f);
    if(is_dir(DATA_PATH.'temp/dshAsk'))rmdir(DATA_PATH.'temp/dshAsk');
    if(is_dir(DATA_PATH.'temp'))rmdir(DATA_PATH.'temp');
    if(is_dir(DATA_PATH))rmdir(DATA_PATH);
}
