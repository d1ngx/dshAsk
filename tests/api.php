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
    echo "API: authentication, validation, persistence, URL and Q&A regression checks passed\n";
} finally {
    foreach(glob(DATA_PATH.'temp/dshAsk/*') ?: array() as $f)unlink($f);
    if(is_dir(DATA_PATH.'temp/dshAsk'))rmdir(DATA_PATH.'temp/dshAsk');
    if(is_dir(DATA_PATH.'temp'))rmdir(DATA_PATH.'temp');
    if(is_dir(DATA_PATH))rmdir(DATA_PATH);
}
