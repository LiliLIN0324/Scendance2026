param([ValidateSet('synthetic','live')][string]$Mode='live',[ValidateRange(1024,65535)][int]$Port=4248,[switch]$EnableLux3d)
$ErrorActionPreference='Stop'
$trialScript=Join-Path $PSScriptRoot 'start-local-chat-trial.ps1'
$powershellExe=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if(!(Test-Path -LiteralPath $trialScript -PathType Leaf) -or !(Test-Path -LiteralPath $powershellExe -PathType Leaf)) { throw '本机试用启动程序不可用。' }
if([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object {$_.Port -eq $Port}){throw '该端口已在使用，请选择其他本机试用端口。'}
# A visible window is required for the user to enter the Key privately on first setup.
# No credential appears in this command line; NoProfile avoids user profile startup errors.
# Request a normal window; whether it is visible depends on the caller's session.
# The child repairs its own module path. A user may run this from an interactive terminal.
[Environment]::SetEnvironmentVariable('SCENDANCE_CHAT_TRIAL_KEY',$null,'Process')
[Environment]::SetEnvironmentVariable('SCENDANCE_CHAT_TRIAL_CONFIRM',$null,'Process')
[Environment]::SetEnvironmentVariable('SCENDANCE_LUX3D_KEY',$null,'Process')
[Environment]::SetEnvironmentVariable('SCENDANCE_LUX3D_ENABLED',$null,'Process')
$arguments=@('-NoProfile','-NoExit','-File',('"'+$trialScript+'"'),'-Mode',$Mode,'-Port',[string]$Port)
if($EnableLux3d){$arguments+='-EnableLux3d'}
Start-Process -FilePath $powershellExe -ArgumentList $arguments -WindowStyle Normal | Out-Null
