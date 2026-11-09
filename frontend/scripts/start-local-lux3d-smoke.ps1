param([ValidateSet('synthetic','live')][string]$Mode='synthetic')
$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')
$ErrorActionPreference='Stop'
$node=(Get-Command node.exe -ErrorAction Stop).Source
$script=Join-Path $PSScriptRoot 'local-lux3d-smoke.cjs'
$root=Split-Path -Parent $PSScriptRoot
$buffer=[IntPtr]::Zero
$secure=$null
$process=$null
try {
  $start=[Diagnostics.ProcessStartInfo]::new()
  $start.FileName=$node
  $start.Arguments='"'+$script+'"'
  $start.WorkingDirectory=$root
  $start.UseShellExecute=$false
  foreach($name in @('SCENDANCE_LUX3D_SMOKE_KEY','SCENDANCE_LUX3D_SMOKE_CONFIRM','SCENDANCE_CHAT_TRIAL_KEY','SCENDANCE_CHAT_TRIAL_CONFIRM','LUX3D_API_KEY','AGENT_CHAT_KEY','TOKENDANCE_API_KEY','NODE_OPTIONS','NODE_PATH','NODE_USE_ENV_PROXY','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy')){$start.EnvironmentVariables.Remove($name)}
  $start.EnvironmentVariables['SCENDANCE_LUX3D_SMOKE_MODE']=$Mode
  if($Mode -eq 'live') {
    . (Join-Path $PSScriptRoot 'local-lux3d-key.ps1')
    $keyPath=Get-LocalLux3dKeyPath
    $secure=Read-LocalTrialKey $keyPath
    $buffer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $start.EnvironmentVariables['SCENDANCE_LUX3D_SMOKE_KEY']=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($buffer)
    $start.EnvironmentVariables['SCENDANCE_LUX3D_SMOKE_CONFIRM']='explicit-local-smoke'
  }
  $process=[Diagnostics.Process]::Start($start)
  $start.EnvironmentVariables.Remove('SCENDANCE_LUX3D_SMOKE_KEY')
  if($buffer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($buffer);$buffer=[IntPtr]::Zero}
  if($secure){$secure.Dispose();$secure=$null}
  $process.WaitForExit()
  exit $process.ExitCode
} finally {
  if($buffer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($buffer)}
  if($secure){$secure.Dispose()}
  if($process){$process.Dispose()}
}
