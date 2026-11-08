// Only fake scripts/configuration: no access to the user's DPAPI files or network.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

test('invalid Lux3D configuration fails before loading any credential',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scendance-lux-launch-')),scripts=path.join(dir,'frontend','scripts');fs.mkdirSync(scripts,{recursive:true});
 const file=path.join(scripts,'start-local-chat-trial.ps1');fs.copyFileSync(path.join(__dirname,'start-local-chat-trial.ps1'),file);
 const guard="function Get-LocalTrialKeyPath { throw 'KEY_ACCESS_FORBIDDEN' }\nfunction Get-LocalLux3dKeyPath { throw 'KEY_ACCESS_FORBIDDEN' }\nfunction Read-LocalTrialKey { throw 'KEY_ACCESS_FORBIDDEN' }\n";
 fs.writeFileSync(path.join(scripts,'local-trial-key.ps1'),guard);fs.writeFileSync(path.join(scripts,'local-lux3d-key.ps1'),guard);
 try{
  const cases=[{mode:'synthetic',values:{}},{mode:'live',values:{}},{mode:'live',values:{SCENDANCE_LUX3D_TERMS_URL:'https://example.invalid/fake',SCENDANCE_LUX3D_REVIEWED_AT:'2000-01-01',SCENDANCE_LUX3D_RESERVATION_CENTS:'100'}}];
  for(const item of cases){
   const env={...process.env,PSModulePath:'C:\\fixture-invalid-modules'};
   for(const key of ['SCENDANCE_CHAT_TRIAL_KEY','SCENDANCE_LUX3D_KEY','SCENDANCE_LUX3D_TERMS_URL','SCENDANCE_LUX3D_REVIEWED_AT','SCENDANCE_LUX3D_RESERVATION_CENTS'])delete env[key];
   Object.assign(env,item.values);
   const child=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',file,'-Mode',item.mode,'-Port','4269','-EnableLux3d'],{encoding:'utf8',windowsHide:true,env,timeout:10000});
   assert.notEqual(child.status,0);assert.ok(!`${child.stdout}${child.stderr}`.includes('KEY_ACCESS_FORBIDDEN'));assert.equal(child.error,undefined);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('explicit local launch injects only fake separate credentials into its fake child',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scendance-lux-wiring-')),scripts=path.join(dir,'frontend','scripts');fs.mkdirSync(scripts,{recursive:true});
 const file=path.join(scripts,'start-local-chat-trial.ps1');fs.copyFileSync(path.join(__dirname,'start-local-chat-trial.ps1'),file);
 const fakeMinimax=path.join(dir,'fake-minimax.dpapi'),fakeLux=path.join(dir,'fake-lux.dpapi');fs.writeFileSync(fakeMinimax,'fixture');fs.writeFileSync(fakeLux,'fixture');
 const helper="function Get-LocalTrialKeyPath { return $env:TEST_MINIMAX_PATH }\nfunction Read-LocalTrialKey([string]$Path) { if($Path -eq $env:TEST_MINIMAX_PATH){return ConvertTo-SecureString 'FAKE_MINIMAX_KEY' -AsPlainText -Force}; if($Path -eq $env:TEST_LUX_PATH){return ConvertTo-SecureString 'FAKE_LUX3D_KEY' -AsPlainText -Force}; throw 'unexpected path' }\n";
 fs.writeFileSync(path.join(scripts,'local-trial-key.ps1'),helper);
 fs.writeFileSync(path.join(scripts,'local-lux3d-key.ps1'),"function Get-LocalLux3dKeyPath { return $env:TEST_LUX_PATH }\n");
 fs.writeFileSync(path.join(scripts,'local-chat-trial.cjs'),"const e=process.env;if(e.SCENDANCE_CHAT_TRIAL_KEY!=='FAKE_MINIMAX_KEY'||e.SCENDANCE_LUX3D_KEY!=='FAKE_LUX3D_KEY'||e.SCENDANCE_LUX3D_ENABLED!=='1'||e.SCENDANCE_LUX3D_TERMS_URL!=='https://labs.aholo3d.cn/agreement/test-only'||e.SCENDANCE_LUX3D_REVIEWED_AT!=='2000-01-01'||e.SCENDANCE_LUX3D_RESERVATION_CENTS!=='100')process.exit(2);console.log('fixture-wiring-ok');");
 try{
  const env={...process.env,PSModulePath:'C:\\synthetic-invalid-modules',TEST_MINIMAX_PATH:fakeMinimax,TEST_LUX_PATH:fakeLux,SCENDANCE_LUX3D_TERMS_URL:'https://labs.aholo3d.cn/agreement/test-only',SCENDANCE_LUX3D_REVIEWED_AT:'2000-01-01',SCENDANCE_LUX3D_RESERVATION_CENTS:'100'};
  for(const key of ['SCENDANCE_CHAT_TRIAL_KEY','SCENDANCE_LUX3D_KEY'])delete env[key];
  const child=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',file,'-Mode','live','-Port','4269','-EnableLux3d'],{encoding:'utf8',windowsHide:true,env,timeout:10000});
  assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/fixture-wiring-ok/);
  assert.ok(!`${child.stdout}${child.stderr}`.includes('FAKE_MINIMAX_KEY'));assert.ok(!`${child.stdout}${child.stderr}`.includes('FAKE_LUX3D_KEY'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
