param(
  [ValidateSet('synthetic','live')][string]$Mode='synthetic',
  [Parameter(Mandatory=$true)][ValidatePattern('^qwen[a-zA-Z0-9.-]{1,80}$')][string]$Model,
  [ValidateRange(1024,65535)][int]$Port=4256
)
$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script=Join-Path $PSScriptRoot 'local-chat-trial.cjs'
$node=(Get-Command node.exe -ErrorAction Stop).Source
$secure=$null;$buffer=[IntPtr]::Zero;$child=$null
try {
  $start=[Diagnostics.ProcessStartInfo]::new()
  $start.FileName=$node;$start.Arguments='"'+$script+'"';$start.WorkingDirectory=$root;$start.UseShellExecute=$false
  foreach($name in @('SCENDANCE_CHAT_TRIAL_KEY','SCENDANCE_CHAT_TRIAL_CONFIRM','SCENDANCE_LUX3D_ENABLED','SCENDANCE_LUX3D_KEY','SCENDANCE_LUX3D_SYNTHETIC','AGENT_CHAT_KEY','MINIMAX_API_KEY')){$start.EnvironmentVariables.Remove($name)}
  $start.EnvironmentVariables['SCENDANCE_CHAT_TRIAL_PROVIDER']='bailian-qwen'
  $start.EnvironmentVariables['SCENDANCE_BAILIAN_MODEL']=$Model
  $start.EnvironmentVariables['SCENDANCE_CHAT_TRIAL_MODE']=$Mode
  $start.EnvironmentVariables['SCENDANCE_CHAT_TRIAL_PORT']=[string]$Port
  if($Mode -eq 'live'){
    . (Join-Path $PSScriptRoot 'local-bailian-key.ps1')
    $keyPath=Get-LocalBailianKeyPath
    if(![IO.File]::Exists($keyPath)){throw '未找到百炼本机加密 Key，请先运行单独的百炼 Key 设置脚本。'}
    $secure=Read-LocalBailianKey $keyPath
    $buffer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $start.EnvironmentVariables['SCENDANCE_CHAT_TRIAL_KEY']=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($buffer)
    $start.EnvironmentVariables['SCENDANCE_CHAT_TRIAL_CONFIRM']='EXPLICIT_TRIAL'
    Write-Host '本机隔离试用将连接阿里云百炼北京；实际调用可能按账户计费。'
  }
  $child=[Diagnostics.Process]::Start($start)
  $start.EnvironmentVariables.Remove('SCENDANCE_CHAT_TRIAL_KEY')
  if($buffer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($buffer);$buffer=[IntPtr]::Zero}
  if($secure){$secure.Dispose();$secure=$null}
  $child.WaitForExit()
  exit $child.ExitCode
} finally {
  if($buffer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($buffer)}
  if($secure){$secure.Dispose()}
  if($child){$child.Dispose()}
}
