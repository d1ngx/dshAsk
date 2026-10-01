<?php
require __DIR__.'/bootstrap.php';
$_SERVER['REQUEST_METHOD']='POST';
PluginBase::$config=array('dshUrl'=>'/dsh/');
try {
    IO::$items['{source:71}/']=array('parent'=>'{source:7}/');
    IO::$items['{source:72}/']=array('parent'=>'{source:71}/');
    IO::$items['{source:81}/']=array('parent'=>'{source:8}/');
    $input=array('files'=>'[]','currentPath'=>'{source:71}/');
    $token=callApi('openAsk',$input)->data['token'];
    $context=callApi('context',array('token'=>$token))->data;
    expect($context['spacePath']==='{source:7}/' && count($context['workspaces'])===1,'token binds one space');
    expect(privateCall('pathInSpace',array(),array('{source:72}/report.docx','{source:7}/')),'source ancestry admits descendants');
    foreach(array('{source:81}/','{source:7}/../escape','/tmp/private','{source:7}/a/../../escape') as $path) {
        expect(!privateCall('pathInSpace',array(),array($path,'{source:7}/')),'outside path rejected: '.$path);
    }
    expect(!callApi('openAsk',array('files'=>'[{"path":"{source:81}/","name":"private"}]','currentPath'=>'{source:7}/'))->ok,'mixed-space references rejected');
    expect(!callApi('fetch',array('token'=>$token,'path'=>'{source:81}/'))->ok,'cross-space download rejected');
    expect(!callApi('saveFile',array('token'=>$token,'path'=>'{source:81}/','name'=>'copy.txt'))->ok,'cross-space upload rejected');
    $one=callApi('sessionBinding',array('token'=>$token))->data;
    $two=callApi('sessionBinding',array('token'=>$token,'empty'=>'1'))->data;
    expect($one['token']!==$two['token'] && $one['token']!==$token,'each conversation has a new token');
    expect($two['context']['currentPath']==='{source:7}/' && !$two['context']['files'],'new space conversation clears prior references');
    Session::$user['userID']=8;
    expect(!callApi('sessionBinding',array('token'=>$token))->ok,'other account cannot derive credentials');
    expect(!callApi('context',array('token'=>$token))->ok && Session::$user['userID']===8,'token cannot change browser identity');
    Session::$user['userID']=7;
    callApi('setMode',array('token'=>$token,'mode'=>'settings'));
    FakeAction::$allow=array('explorer.index.pathdelete'=>1);
    $params=array('dataArr'=>json_encode(array(array('path'=>'{source:71}/'))));
    $queued=callApi('callApi',array('token'=>$token,'route'=>'explorer/index/pathDelete','params'=>json_encode($params)));
    expect($queued->ok,'deletion queued');
    $id=callApi('listPending',array('token'=>$token))->data['items'][0]['id'];
    FakeModel::$recycle=0;
    $before=FakeAction::$calls;
    $result=callApi('commitPending',array('token'=>$token,'id'=>$id));
    expect(!$result->data['done'][0]['result']['code'] && FakeAction::$calls===$before,'settings deletion cannot bypass disabled recycle bin');
    FakeModel::$recycle=1;
    $result=callApi('commitPending',array('token'=>$token,'id'=>$id));
    expect($result->data['done'][0]['result']['code'] && FakeAction::$calls===$before+1,'retry uses current recycle policy');
    FakeModel::$rows['User:7']=array('sourceInfo'=>array('sourceID'=>8));
    expect(!callApi('owner',array('token'=>$token))->ok,'revoked space membership rejects old binding');
    expect(!callApi('sessionBinding',array('token'=>$token))->ok,'revoked space cannot mint new binding');
    echo "Space security: account binding, ancestry, mixed references, isolated credentials, revocation and recycle policy passed\n";
} finally { cleanupTokens(); }
