// Fake helper and key only; no real credential file or network.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');

test('live launcher injects only a separately retrieved fake Bailian key',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scendance-bailian-launch-')),scripts=path.join(dir,'frontend','scripts');fs.mkdirSync(scripts,{recursive:true});
 const launcher=path.join(scripts,'start-local-bailian-trial.ps1');fs.copyFileSync(path.join(__dirname,'start-local-bailian-trial.ps1'),launcher);
 const fixture=path.join(dir,'fixture.dpapi');fs.writeFileSync(fixture,'fake');
 fs.writeFileSync(path.join(scripts,'local-bailian-key.ps1'),"function Get-LocalBailianKeyPath { return $env:TEST_BAILIAN_PATH }\nfunction Read-LocalBailianKey([string]$Path) { if($Path -ne $env:TEST_BAILIAN_PATH){throw 'wrong path'};return ConvertTo-SecureString 'FAKE_BAILIAN_KEY' -AsPlainText -Force }\n");
 fs.writeFileSync(path.join(scripts,'local-chat-trial.cjs'),"const e=process.env;if(e.SCENDANCE_CHAT_TRIAL_KEY!=='FAKE_BAILIAN_KEY'||e.SCENDANCE_CHAT_TRIAL_PROVIDER!=='bailian-qwen'||e.SCENDANCE_BAILIAN_MODEL!=='qwen3.5-plus'||e.MINIMAX_API_KEY||e.SCENDANCE_LUX3D_KEY)process.exit(2);console.log('fixture-wiring-ok');");
 try{
  const env={...process.env,TEST_BAILIAN_PATH:fixture,MINIMAX_API_KEY:'FAKE_OTHER_KEY',SCENDANCE_LUX3D_KEY:'FAKE_OTHER_KEY'};
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',launcher,'-Mode','live','-Model','qwen3.5-plus','-Port','4269'],{encoding:'utf8',windowsHide:true,env,timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/fixture-wiring-ok/);assert.doesNotMatch(result.stdout+result.stderr,/FAKE_BAILIAN_KEY|FAKE_OTHER_KEY/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
