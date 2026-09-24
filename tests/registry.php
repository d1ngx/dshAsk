<?php
require __DIR__ . '/../lib/AgentRegistry.php';
function check($value, $message) { if (!$value) throw new Exception($message); }
$dir = sys_get_temp_dir() . '/dsh-agents-' . bin2hex(random_bytes(8));
mkdir($dir);
try {
    $builtins = __DIR__ . '/../agents';
    $r = new DshAskAgentRegistry($builtins);
    check(count($r->all()) === 9 && !$r->errors(), 'builtins load');
    $word = $r->get('word-polish');
    check(DshAskAgentRegistry::accepts($word, array(array('name'=>'REPORT.DOCX','type'=>'file'))), 'case insensitive format');
    check(!DshAskAgentRegistry::accepts($word, array()), 'requires input');
    check(!DshAskAgentRegistry::accepts($word, array(array('name'=>'a.docx','type'=>'folder'))), 'reject folders');
    check(!DshAskAgentRegistry::accepts($word, array(array('name'=>'a.docx','type'=>'file'),array('name'=>'b.xlsx','type'=>'file'))), 'reject mixed incompatible selection');
    check(DshAskAgentRegistry::accepts($r->get('ppt-create'), array()), 'creation allows empty');
    check(!DshAskAgentRegistry::accepts($word, array(array('name'=>'a.doc','type'=>'file'))), 'reject legacy format');
    copy(__DIR__ . '/../examples/team-weekly-report.json', $dir . '/team.json');
    file_put_contents($dir . '/duplicate.json', json_encode($word));
    file_put_contents($dir . '/broken.json', '{');
    $r = new DshAskAgentRegistry($builtins, $dir, array('excel-clean'));
    check(count($r->all()) === 9, 'extension added and disabled agent removed');
    check($r->get('team-weekly-report')['source'] === 'extension', 'extension source');
    check($r->get('word-polish')['source'] === 'builtin', 'cannot override builtins');
    check(count($r->errors()) === 2, 'invalid and duplicate manifests isolated');
    check(!$r->get('excel-clean') && !$r->get(array()), 'disabled and invalid ids');
    $invalid = $word; $invalid['extensions'] = array('../docx');
    check(DshAskAgentRegistry::validate($invalid) !== '', 'invalid extension rejected');
    $task = DshAskAgentRegistry::task($word, array(), '排版', 'docx', 'minimal');
    check($task['policy']['preserveSource'] && $task['policy']['writeMode'] === 'new-copy', 'safe output policy');
    check(strpos($task['prompt'], '排版') !== false && strpos($task['prompt'], 'fileSave') !== false, 'task includes request and binary constraints');
    echo "Registry: 15 checks passed\n";
} finally {
    foreach (glob($dir . '/*') as $file) unlink($file);
    rmdir($dir);
}
