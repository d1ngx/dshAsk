<?php
require __DIR__.'/bootstrap.php';
$_SERVER['REQUEST_METHOD']='POST';
$valid=array('agentId'=>'word-report','files'=>'[]','request'=>'生成周报','outputFormat'=>'docx','style'=>'minimal','currentPath'=>'{source:7}/');
try {
    KodUser::$logged=false; expect(!callApi('agents')->ok,'catalog requires login'); expect(!callApi('openAgent',$valid)->ok,'launch requires login'); KodUser::$logged=true;
    expect(count(callApi('agents')->data['agents'])===count(glob(__DIR__.'/../agents/*.json')),'catalog');
    $_SERVER['REQUEST_METHOD']='GET';expect(!callApi('openAgent',$valid)->ok,'POST required');$_SERVER['REQUEST_METHOD']='POST';
    foreach(array(array('agentId'=>'missing'),array('request'=>''),array('outputFormat'=>'exe'),array('style'=>'bad'),array('files'=>'{'),array('files'=>'[{"path": []}]'),array('currentPath'=>array()),array('request'=>str_repeat('x',12001))) as $override) expect(!callApi('openAgent',array_merge($valid,$override))->ok,'invalid task rejected');
    PluginBase::$config=array('disabledAgents'=>'word-report');expect(!callApi('openAgent',$valid)->ok,'disabled agent');
    PluginBase::$config=array('dshUrl'=>'https://dsh.example/?theme=dark#chat');
    $result=callApi('openAgent',$valid);expect($result->ok,'task prepared');expect(strpos($result->data['link'],'?theme=dark&kodAsk=')!==false && substr($result->data['link'],-5)==='#chat','query and fragment preserved');
    $context=callApi('context',array('token'=>$result->data['token']));expect($context->ok && $context->data['agentTask']['agent']['id']==='word-report','task persisted');expect($context->data['agentTask']['request']==='生成周报','request preserved');expect(!isset($context->data['accessToken']),'access token stays on the server');
    PluginBase::$config=array('dshUrl'=>'/dsh/');
    $classic=callApi('openAsk',array('files'=>'[]','currentPath'=>'{source:7}/'));expect($classic->ok,'classic ask works');expect(strpos($classic->data['link'],'/dsh/kodbox/task?token=')===0 && strpos($classic->data['link'],'&defer=1')!==false,'local handoff');
    expect(!isset(callApi('context',array('token'=>$classic->data['token']))->data['agentTask']),'classic context unchanged');
    expect(!callApi('context',array('token'=>'../test'))->ok,'invalid token rejected');
    FakeModel::$blankInfo=true;
    FakeModel::$rows=array(
        'User:2'=>array('name'=>'demo','nickName'=>'演示'),
        'User:1'=>array('name'=>'admin'),
        'Group:1'=>array('name'=>'企业网盘'),
        'SystemRole:3'=>array('name'=>'部门管理员'),
        'Auth'=>array(array('id'=>7,'name'=>'不可见'),array('id'=>6,'name'=>'拥有者'),array('id'=>2,'name'=>'查看者')),
    );
    IO::$items['{source:151}/']=array('name'=>'短篇小说_修钟人.md');
    IO::$items['{source:27}/']=array('name'=>'归档');
    $auth=privateCall('apiSummary',array(),array('explorer/index/setAuth',array(
        'path'=>'{source:151}/',
        'auth'=>json_encode(array(
            array('targetType'=>1,'targetID'=>'2','authID'=>'7'),
            array('targetType'=>1,'targetID'=>'1','authID'=>'6'),
        ), JSON_UNESCAPED_UNICODE),
    )));
    expect($auth==='设置「短篇小说_修钟人.md」的权限：demo（演示） 不可见，admin 拥有者','permission summary uses names');
    expect(strpos($auth,'userID')===false && strpos($auth,'authID')===false,'permission summary hides ids');
    $join=privateCall('apiSummary',array(),array('admin/member/addGroup',array('userID'=>'2','groupID'=>'1','authID'=>'2','password'=>'secret')));
    expect($join==='把「demo（演示）」加入「企业网盘」，权限为查看者','membership summary uses names');
    expect(strpos($join,'secret')===false,'password stays out of the summary');
    $move=privateCall('apiSummary',array(),array('explorer/index/pathCuteTo',array(
        'dataArr'=>json_encode(array(array('path'=>'{source:151}/','name'=>'短篇小说_修钟人.md','type'=>'file')), JSON_UNESCAPED_UNICODE),
        'path'=>'{source:27}/',
    )));
    expect($move==='移动「短篇小说_修钟人.md」到「归档」','move summary uses file names');
    $role=privateCall('apiSummary',array(),array('admin/role/edit',array('id'=>'3','auth'=>'admin.role.edit')));
    expect($role==='编辑角色「部门管理员」','role summary uses the role name');
    FakeModel::$blankInfo=false;
    echo "API: authentication, validation, persistence, URL and Q&A regression checks passed\n";
} finally {
    foreach(glob(DATA_PATH.'temp/dshAsk/*') ?: array() as $f)unlink($f);
    if(is_dir(DATA_PATH.'temp/dshAsk'))rmdir(DATA_PATH.'temp/dshAsk');
    if(is_dir(DATA_PATH.'temp'))rmdir(DATA_PATH.'temp');
    if(is_dir(DATA_PATH))rmdir(DATA_PATH);
}
