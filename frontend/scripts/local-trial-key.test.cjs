// Run with: node --test scripts/local-trial-key.test.cjs
// Uses only a disposable fixture; never reads the user's saved credential.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const helper=path.resolve(__dirname,'local-trial-key.ps1');
const fixture='FIXTURE_ONLY_TEST_KEY_94739';
const quote=value=>`'${value.replace(/'/g,"''")}'`;
function ps(source){
 // Only the public synthetic fixture is encoded in this test command.
 const code=`$ErrorActionPreference='Stop'\ntry {\n${source}\n} catch { [Console]::Error.WriteLine($_.Exception.GetType().FullName); [Console]::Error.WriteLine($_.Exception.Message); [Console]::Error.WriteLine($_.InvocationInfo.ScriptLineNumber); exit 1 }\n`;
 const env={...process.env};delete env.PSModulePath;
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,env});
 assert.equal(result.status,0,`PowerShell fixture failed: ${result.stderr}`);
 assert.ok(!result.stdout.includes(fixture));assert.ok(!result.stderr.includes(fixture));
 return result.stdout;
}
test('current-user protected key survives a new process without plaintext file',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scendance-dpapi-test-'));
 const file=path.join(dir,'secret.dpapi');
 try {
  ps(`. ${quote(helper)}\n$key=ConvertTo-SecureString ${quote(fixture)} -AsPlainText -Force\ntry { Save-LocalTrialKey ${quote(file)} $key } finally { $key.Dispose() }`);
  const encrypted=fs.readFileSync(file,'utf8');assert.ok(encrypted.length>fixture.length);assert.ok(!encrypted.includes(fixture));
  const result=ps(`. ${quote(helper)}\n$key=Read-LocalTrialKey ${quote(file)}\n$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($key)\ntry { if([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) -cne ${quote(fixture)}) { throw 'mismatch' }; Write-Output 'verified' } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr);$key.Dispose() }`);
  assert.match(result,/verified/);
  ps(`. ${quote(helper)}\n$key=ConvertTo-SecureString 'DIFFERENT_FIXTURE' -AsPlainText -Force\n$blocked=$false\ntry { Save-LocalTrialKey ${quote(file)} $key } catch { $blocked=$true } finally { $key.Dispose() }\nif(!$blocked){throw 'overwrite was not blocked'}`);
  assert.equal(fs.readFileSync(file,'utf8'),encrypted);
  const invalid=path.join(dir,'invalid.dpapi');
  ps(`. ${quote(helper)}\n$key=ConvertTo-SecureString 'invalid fixture with spaces' -AsPlainText -Force\n$blocked=$false\ntry { Save-LocalTrialKey ${quote(invalid)} $key } catch { $blocked=$true } finally { $key.Dispose() }\nif(!$blocked){throw 'invalid fixture was accepted'}`);
  assert.equal(fs.existsSync(invalid),false);
  fs.writeFileSync(file,'not-encrypted');
  ps(`. ${quote(helper)}\n$blocked=$false\ntry { Read-LocalTrialKey ${quote(file)} | Out-Null } catch { $blocked=$true }\nif(!$blocked){throw 'corruption was not blocked'}`);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('the visible launcher bypasses user profiles and passes no credential',()=>{
 const launcher=fs.readFileSync(path.join(__dirname,'open-local-chat-trial.ps1'),'utf8');
 assert.match(launcher,/-NoProfile/);assert.match(launcher,/Start-Process[\s\S]*-WindowStyle Normal/);
 assert.match(fs.readFileSync(path.join(__dirname,'start-local-chat-trial.ps1'),'utf8'),/\$env:PSModulePath=\[IO\.Path\]::Combine\(\$PSHOME,'Modules'\)/);
 assert.doesNotMatch(launcher,/Read-Host|ExecutionPolicy/);
 assert.match(launcher,/SetEnvironmentVariable\('SCENDANCE_CHAT_TRIAL_KEY',\$null,'Process'\)/);
});
