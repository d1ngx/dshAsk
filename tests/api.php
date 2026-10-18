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
    PluginBase::$config=array('dshUrl'=>'http://127.0.0.1:3081/');
    $loopback=callApi('openAsk',array('files'=>'[]','currentPath'=>'{source:7}/'));expect($loopback->ok && strpos($loopback->data['link'],'/dsh/kodbox/task?token=')===0 && strpos($loopback->data['link'],'127.0.0.1')===false,'loopback DSH stays on the KodBox origin');
    $skill=callApi('skillText',array('token'=>$classic->data['token'],'agentId'=>'excel-style'));expect($skill->ok && $skill->data['name']==='Excel 表格美化' && strpos($skill->data['instructions'],'列宽')!==false,'skill text comes from the agent registry');
    expect(!callApi('skillText',array('token'=>$classic->data['token'],'agentId'=>'../excel-style'))->ok,'skill id cannot leave the registry');
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
    expect(!privateCall('apiIsWrite',array(),array('explorer/index/setAuth',array('action'=>'getData'))),'permission query is read only');
    expect(privateCall('apiIsWrite',array(),array('explorer/index/setAuth',array('auth'=>'[]'))),'permission mutation needs confirmation');
    expect(privateCall('apiIsWrite',array(),array('explorer/userShare/add',array())),'share creation needs confirmation');
    foreach (array('getData','getAllParent','getAllChildren','getGroupUser','getAllChildrenByUser') as $action) expect(!privateCall('apiIsWrite',array(),array('explorer/index/setAuth',array('action'=>$action))), 'native permission read never queued');
    foreach (array('', 'clearChildren', 'setAllChildrenByUser', 'chmod') as $action) expect(privateCall('apiIsWrite',array(),array('explorer/index/setAuth',array('action'=>$action))), 'native permission write still confirmed');
    IO::$items['{source:151}/']['targetType']='user';
    expect(!privateCall('requireGroupAuthPath',array(),array(array('path'=>'{source:151}/')))->ok,'personal document permissions rejected before queue');
    IO::$items['{source:151}/']['targetType']='group';
    expect(privateCall('requireGroupAuthPath',array(),array(array('path'=>'{source:151}/')))===null,'department document permissions accepted');
    $display=privateCall('apiResultDisplay',array(),array(array('id'=>'abc','route'=>'explorer/userShare/add','summary'=>'分享文档','params'=>array('isLink'=>1,'password'=>'test-only-password','timeTo'=>0)),array('data'=>array('url'=>'/s/native-share'))));
    expect(strpos($display['url'],'/s/native-share')!==false && $display['password']==='test-only-password' && $display['expires']==='永久有效','confirmed share displays native URL and exact password');
    expect(!isset(privateCall('apiResultDisplay',array(),array(array('id'=>'def','route'=>'admin/member/edit','params'=>array('password'=>'hidden')),array('data'=>array())))['password']),'unrelated API passwords never displayed');
    expect(privateCall('publicShareUrl',array(),array('http://app/index.php?sitemap/share/test','https://disk.example:8443'))==='https://disk.example:8443/index.php?sitemap/share/test','public share URL replaces internal origin and preserves route');
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
    IO::$items['{source:12}/']=array('name'=>'测试文档.docx','parent'=>'{source:7}/');
    IO::$items['{source:99}/']=array('name'=>'其他空间.docx','parent'=>'{source:1}/');
    FakeModel::$rows['Source:12']=array('sourceID'=>'12','parentID'=>'7','parentLevel'=>',0,7,');
    FakeModel::$rows['Source:99']=array('sourceID'=>'99','parentID'=>'1','parentLevel'=>',0,1,');
    FakeModel::$rows['Share:2']=array('shareID'=>'2','userID'=>'7','sourceID'=>'12','title'=>'测试文档.docx');
    FakeModel::$rows['Share:8']=array('shareID'=>'8','userID'=>'7','sourceID'=>'99','title'=>'其他空间.docx');
    FakeModel::$rows['Share:9']=array('shareID'=>'9','userID'=>'8','sourceID'=>'12','title'=>'别人的.docx');
    $space=array('userID'=>'7','spacePath'=>'{source:7}/');
    expect(privateCall('assertShareScope',array(),array($space,'explorer/userShare/del',array('dataArr'=>'["2"]')))===null,'own share in the current space can be cancelled');
    FakeModel::$blankShare=true;
    expect(privateCall('assertShareScope',array(),array($space,'explorer/userShare/del',array('dataArr'=>'["2"]')))===null,'share row is loaded from the share table when getInfo is absent');
    FakeModel::$blankShare=false;
    expect(!privateCall('assertShareScope',array(),array($space,'explorer/userShare/del',array('dataArr'=>'["8"]')))->ok,'share outside the current space is rejected');
    expect(!privateCall('assertShareScope',array(),array($space,'explorer/userShare/del',array('dataArr'=>'["9"]')))->ok,'another user share is rejected');
    expect(!privateCall('assertShareScope',array(),array($space,'explorer/userShare/edit',array('shareID'=>'nope')))->ok,'non numeric share id is rejected');
    expect(privateCall('apiIsWrite',array(),array('explorer/userShare/del',array())),'share delete needs confirmation');
    expect(privateCall('apiIsWrite',array(),array('explorer/userShare/edit',array())),'share edit needs confirmation');
    $items=privateCall('expandApiItems',array(),array('explorer/userShare/del',array('dataArr'=>'["2","8"]')));
    expect(is_array($items) && count($items)===1 && $items[0]['params']['dataArr']==='["2","8"]' && strpos($items[0]['summary'], '测试文档.docx')!==false && strpos($items[0]['summary'], '共 2 条')!==false, 'share cancels are one confirmation');
    IO::$items['{source:12}/']=array('name'=>'测试文档.docx','parent'=>'{source:1}/');
    FakeModel::$rows['Source:12']=array('sourceID'=>'12','parentID'=>'7','parentLevel'=>',0,7,');
    expect(privateCall('pathInSpace',array(),array('{source:12}/','{source:7}/')),'source parent admits a file when the path driver points elsewhere');
    expect(privateCall('assertShareScope',array(),array($space,'explorer/userShare/del',array('dataArr'=>'["2"]')))===null,'share in space is accepted from the source parent chain');
    FakeModel::$rows['Source:99']=array('sourceID'=>'99','parentID'=>'1','parentLevel'=>',0,1,');
    expect(!privateCall('pathInSpace',array(),array('{source:99}/','{source:7}/')),'another space source stays outside');
    expect(privateCall('apiSummary',array(),array('explorer/userShare/edit',array('shareID'=>'2')))==='修改分享「测试文档.docx」','share edit summary uses the stored title');
    $caps=privateCall('officeCapabilities',array());
    expect(in_array('office-docx',$caps,true) && in_array('office-xlsx',$caps,true) && in_array('office-pptx',$caps,true),'bundled word, excel and ppt tools count as installed');
    echo "API: authentication, validation, persistence, URL and Q&A regression checks passed\n";
} finally {
    foreach(glob(DATA_PATH.'temp/dshAsk/*') ?: array() as $f)unlink($f);
    if(is_dir(DATA_PATH.'temp/dshAsk'))rmdir(DATA_PATH.'temp/dshAsk');
    if(is_dir(DATA_PATH.'temp'))rmdir(DATA_PATH.'temp');
    if(is_dir(DATA_PATH))rmdir(DATA_PATH);
}
