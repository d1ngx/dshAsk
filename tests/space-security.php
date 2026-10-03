<?php
require __DIR__.'/bootstrap.php';
$_SERVER['REQUEST_METHOD']='POST';
PluginBase::$config=array('dshUrl'=>'/dsh/');
try {
    expect(privateCall('helpFile', array(), array('kod/user/PC/6.1.md')) !== false, 'local manual nested file resolves');
    foreach (array('../app.php', '../readme.md', '/etc/passwd', "user-guide.md\0", 'missing.md') as $file) {
        expect(privateCall('helpFile', array(), array($file)) === false, 'help rejects missing/outside/non-markdown path');
    }

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
    FakeModel::$rows['User:7']=array('sourceInfo'=>array('sourceID'=>7),'groupInfo'=>array(array('groupID'=>1,'groupName'=>'企业网盘')));
    FakeModel::$rows['Source:groups']=array(array('targetID'=>1,'sourceID'=>9));
    $company=array('spaceId'=>'group_1','spacePath'=>'{source:9}/');
    $binding=callApi('spaceBinding',$company);
    expect($binding->ok && $binding->data['context']['spaceId']==='group_1','company switch mints a binding without an old ask token');
    expect($binding->data['context']['currentPath']==='{source:9}/' && !$binding->data['context']['files'],'new company chat starts at company root without personal references');
    expect(!isset($binding->data['context']['accessToken']),'access credential is not returned');
    expect(!callApi('spaceBinding',array('spaceId'=>'group_1','spacePath'=>'{source:7}/'))->ok,'space id and root must match');
    KodUser::$logged=false;
    expect(!callApi('spaceBinding',$company)->ok,'anonymous browser cannot mint a binding');
    KodUser::$logged=true;
    FakeModel::$rows['User:7']=array('sourceInfo'=>array('sourceID'=>7));
    expect(!callApi('spaceBinding',$company)->ok,'fresh membership overrides stale browser group list');
    echo "Space security: account binding, ancestry, mixed references, isolated credentials, revocation and recycle policy passed\n";
} finally { cleanupTokens(); }
