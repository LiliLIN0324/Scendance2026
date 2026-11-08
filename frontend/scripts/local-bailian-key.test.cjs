// Disposable fake credentials only; never reads the user's provider files.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const helper=path.resolve(__dirname,'local-bailian-key.ps1');
const luxHelper=path.resolve(__dirname,'local-lux3d-key.ps1');
const fake='FAKE_BAILIAN_FIXTURE_KEY_47382';
const quote=value=>`'${value.replace(/'/g,"''")}'`;
function ps(source){
 const code=`$ErrorActionPreference='Stop'\ntry {\n${source}\n} catch { [Console]::Error.WriteLine($_.Exception.GetType().FullName); exit 1 }\n`;
 const env={...process.env};delete env.PSModulePath;
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,env});
 assert.equal(result.status,0,`fixture failed: ${result.stderr}`);
 assert.ok(!result.stdout.includes(fake));assert.ok(!result.stderr.includes(fake));return result.stdout;
}
test('Bailian DPAPI uses a separate file, survives another process and never overwrites',()=>{
 const root=fs.realpathSync(os.tmpdir());const dir=fs.mkdtempSync(path.join(root,'scendance-bailian-test-'));
 assert.equal(path.dirname(fs.realpathSync(dir)).toLowerCase(),root.toLowerCase());
 const file=path.join(dir,'fake-bailian.dpapi');
 try{
  ps(`. ${quote(helper)}\n. ${quote(luxHelper)}\nif((Get-LocalBailianKeyPath) -eq (Get-LocalTrialKeyPath) -or (Get-LocalBailianKeyPath) -eq (Get-LocalLux3dKeyPath)){throw 'paths overlap'}\n$key=ConvertTo-SecureString ${quote(fake)} -AsPlainText -Force\ntry{Save-LocalBailianKey ${quote(file)} $key}finally{$key.Dispose()}`);
  const encrypted=fs.readFileSync(file,'utf8');assert.ok(!encrypted.includes(fake));
  ps(`. ${quote(helper)}\n$key=Read-LocalBailianKey ${quote(file)}\n$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($key)\ntry{if([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) -cne ${quote(fake)}){throw 'mismatch'}}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr);$key.Dispose()}`);
  ps(`. ${quote(helper)}\n$key=ConvertTo-SecureString 'DIFFERENT_FAKE' -AsPlainText -Force\n$blocked=$false\ntry{Save-LocalBailianKey ${quote(file)} $key}catch{$blocked=$true}finally{$key.Dispose()}\nif(!$blocked){throw 'overwrite was not blocked'}`);
  assert.equal(fs.readFileSync(file,'utf8'),encrypted);
  fs.writeFileSync(file,'invalid-data');
  ps(`. ${quote(helper)}\n$blocked=$false\ntry{Read-LocalBailianKey ${quote(file)}}catch{$blocked=$true}\nif(!$blocked){throw 'corrupt record accepted'}`);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('setup asks privately and does not read another key or contact a service',()=>{
 const setup=fs.readFileSync(path.join(__dirname,'setup-local-bailian-key.ps1'),'utf8');
 assert.match(setup,/Read-Host[^\n]*-AsSecureString/);assert.match(setup,/\[IO\.File\]::Exists\(\$keyPath\)/);
 assert.doesNotMatch(setup,/Read-LocalTrialKey|Read-LocalBailianKey|Get-LocalTrialKeyPath|Get-LocalLux3dKeyPath|Invoke-WebRequest|Invoke-RestMethod|https?:\/\//);
});
test('Windows PowerShell setup writes a mocked secure input only to its isolated file',()=>{
 const root=fs.realpathSync(os.tmpdir());const dir=fs.mkdtempSync(path.join(root,'scendance-bailian-setup-'));
 assert.equal(path.dirname(fs.realpathSync(dir)).toLowerCase(),root.toLowerCase());
 const fakePath=path.join(dir,'fixture.dpapi');
 try{
  fs.copyFileSync(path.join(__dirname,'local-trial-key.ps1'),path.join(dir,'local-trial-key.ps1'));
  const source=fs.readFileSync(helper,'utf8');
  const needle="return Join-Path $base 'Scendance\\local-trial\\bailian-key.dpapi'";
  assert.equal(source.split(needle).length,2);
  fs.writeFileSync(path.join(dir,'local-bailian-key.ps1'),source.replace(needle,`return ${quote(fakePath)}`),'utf8');
  fs.copyFileSync(path.join(__dirname,'setup-local-bailian-key.ps1'),path.join(dir,'setup-local-bailian-key.ps1'));
  ps(`function global:Read-Host {param([string]$Prompt,[switch]$AsSecureString) if(!$AsSecureString){throw 'insecure input'}; ConvertTo-SecureString ${quote(fake)} -AsPlainText -Force}\n& ${quote(path.join(dir,'setup-local-bailian-key.ps1'))}`);
  assert.ok(fs.existsSync(fakePath));assert.ok(!fs.readFileSync(fakePath,'utf8').includes(fake));
  const saved=fs.readFileSync(fakePath,'utf8');
  ps(`function global:Read-Host {throw 'existing record should not prompt'}\n& ${quote(path.join(dir,'setup-local-bailian-key.ps1'))}`);
  assert.equal(fs.readFileSync(fakePath,'utf8'),saved);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('setup reports only a fixed failure when the underlying exception contains sensitive text',()=>{
 const root=fs.realpathSync(os.tmpdir());const dir=fs.mkdtempSync(path.join(root,'scendance-bailian-failure-'));
 assert.equal(path.dirname(fs.realpathSync(dir)).toLowerCase(),root.toLowerCase());
 try{
  fs.copyFileSync(path.join(__dirname,'local-trial-key.ps1'),path.join(dir,'local-trial-key.ps1'));
  fs.copyFileSync(path.join(__dirname,'setup-local-bailian-key.ps1'),path.join(dir,'setup-local-bailian-key.ps1'));
  const source=fs.readFileSync(helper,'utf8');const needle="return Join-Path $base 'Scendance\\local-trial\\bailian-key.dpapi'";
  assert.equal(source.split(needle).length,2);assert.equal(source.split('Save-LocalTrialKey $Path $Key').length,2);
  const isolated=source.replace(needle,`return ${quote(path.join(dir,'fixture.dpapi'))}`).replace('Save-LocalTrialKey $Path $Key',`throw ${quote(fake)}`);
  fs.writeFileSync(path.join(dir,'local-bailian-key.ps1'),isolated,'utf8');
  const output=ps(`function global:Read-Host {param([string]$Prompt,[switch]$AsSecureString) ConvertTo-SecureString ${quote(fake)} -AsPlainText -Force}\ntry{& ${quote(path.join(dir,'setup-local-bailian-key.ps1'))}}catch{Write-Output 'expected_failure'}`);
  assert.match(output,/expected_failure/);
  assert.equal(fs.existsSync(path.join(dir,'fixture.dpapi')),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
