const {spawn}=require('node:child_process');
const fs=require('node:fs');
const target='/kodbox-data/dsh-launch-token';
try { fs.unlinkSync(target); } catch(e) { if(e.code!=='ENOENT') throw e; }
const {createRelay}=require('/opt/kodbox-dsh/integrations/kodbox-file/tcp-relay.cjs');
const proxy=createRelay(3079);
proxy.listen(3081,'0.0.0.0');
const trusted=new Set(['localhost','127.0.0.1','host.docker.internal']);
for (const host of (process.env.DSH_TRUSTED_HOSTS||'').split(',')) { const name=host.trim(); if (name) trusted.add(name); }
const child=spawn(process.execPath,['--import','/opt/kodbox-dsh/integrations/kodbox-file/bootstrap-guard.js','/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js','web','--host','127.0.0.1','--port','3079','--no-open',...[...trusted].flatMap(h=>['--trusted-host',h])],{stdio:['ignore','pipe','pipe']});
function output(stream,dest){let pending=''; stream.on('data',data=>{pending+=data;let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end+1);pending=pending.slice(end+1);const match=line.match(/token=([A-Za-z0-9_-]{16,128})/);if(match){fs.writeFileSync(target+'.tmp',match[1]+'\n',{mode:0o600});fs.chmodSync(target+'.tmp',0o600);fs.chownSync(target+'.tmp',101,101);fs.renameSync(target+'.tmp',target);}dest.write(line.replace(/token=[A-Za-z0-9_-]+/g,'token=[REDACTED]'));}if(pending.length>65536)pending='';});stream.on('end',()=>dest.write(pending.replace(/token=[A-Za-z0-9_-]+/g,'token=[REDACTED]')));}
output(child.stdout,process.stdout);output(child.stderr,process.stderr);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
