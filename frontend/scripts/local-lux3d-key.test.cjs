// Run with node --test scripts/local-lux3d-key.test.cjs. Uses disposable fake data only.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const helper=path.resolve(__dirname,'local-lux3d-key.ps1');
const fake='FAKE_LUX3D_FIXTURE_KEY_29481';
const quote=value=>`'${value.replace(/'/g,"''")}'`;
function ps(source){
 const code=`$ErrorActionPreference='Stop'\ntry {\n${source}\n} catch { [Console]::Error.WriteLine($_.Exception.GetType().FullName); exit 1 }\n`;
 const env={...process.env};delete env.PSModulePath;
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,env});
 assert.equal(result.status,0,`fixture failed: ${result.stderr}`);
 assert.ok(!result.stdout.includes(fake));assert.ok(!result.stderr.includes(fake));return result.stdout;
}
test('Lux3D DPAPI file is separate and fake key can be recovered only from its disposable path',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scendance-lux3d-test-')),file=path.join(dir,'fake-lux3d.dpapi');
 try{
  const result=ps(`. ${quote(helper)}\nif((Get-LocalLux3dKeyPath) -eq (Get-LocalTrialKeyPath)){throw 'paths overlap'}\n$key=ConvertTo-SecureString ${quote(fake)} -AsPlainText -Force\ntry{Save-LocalLux3dKey ${quote(file)} $key}finally{$key.Dispose()}\nWrite-Output 'separate'`);
  assert.match(result,/separate/);const encrypted=fs.readFileSync(file,'utf8');assert.ok(!encrypted.includes(fake));
  ps(`. ${quote(helper)}\n$key=Read-LocalTrialKey ${quote(file)}\n$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($key)\ntry{if([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) -cne ${quote(fake)}){throw 'mismatch'}}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr);$key.Dispose()}`);
  ps(`. ${quote(helper)}\n$key=ConvertTo-SecureString 'DIFFERENT_FAKE' -AsPlainText -Force\n$blocked=$false\ntry{Save-LocalLux3dKey ${quote(file)} $key}catch{$blocked=$true}finally{$key.Dispose()}\nif(!$blocked){throw 'overwrite was not blocked'}`);
  assert.equal(fs.readFileSync(file,'utf8'),encrypted);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('setup is explicit, does not load the MiniMax key or call external services',()=>{
 const setup=fs.readFileSync(path.join(__dirname,'setup-local-lux3d-key.ps1'),'utf8');
 assert.match(setup,/Read-Host[^\n]*-AsSecureString/);assert.match(setup,/\[IO\.File\]::Exists\(\$keyPath\)/);
 assert.doesNotMatch(setup,/Read-LocalTrialKey|Get-LocalTrialKeyPath|Invoke-WebRequest|Invoke-RestMethod|https?:\/\//);
 assert.match(setup,/不启用生成/);
});
