param([ValidateSet('synthetic','live')][string]$Mode='synthetic',[ValidateRange(0,65535)][int]$Port=0,[switch]$EnableLux3d)
# Restrict this child process to Windows PowerShell's own module directory;
# inherited PowerShell 7 paths can prevent the built-in security module loading.
$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')
$ErrorActionPreference='Stop'
$scendanceRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$scendanceScript=Join-Path $PSScriptRoot 'local-chat-trial.cjs'
$scendanceNode=(Get-Command node.exe -ErrorAction Stop).Source
$scendanceBuffer=[IntPtr]::Zero
$scendanceLuxBuffer=[IntPtr]::Zero
$scendanceProcess=$null
$scendanceSecure=$null
$scendanceLuxSecure=$null
try {
  $scendanceStart=[System.Diagnostics.ProcessStartInfo]::new()
  $scendanceStart.FileName=$scendanceNode
  $scendanceStart.Arguments='"'+$scendanceScript+'"'
  $scendanceStart.WorkingDirectory=$scendanceRoot
  $scendanceStart.UseShellExecute=$false
  $scendanceStart.EnvironmentVariables.Remove('SCENDANCE_CHAT_TRIAL_KEY')
  $scendanceStart.EnvironmentVariables.Remove('SCENDANCE_CHAT_TRIAL_CONFIRM')
  foreach($name in @('SCENDANCE_LUX3D_ENABLED','SCENDANCE_LUX3D_KEY','SCENDANCE_LUX3D_TERMS_URL','SCENDANCE_LUX3D_REVIEWED_AT','SCENDANCE_LUX3D_RESERVATION_CENTS')){$scendanceStart.EnvironmentVariables.Remove($name)}
  $scendanceStart.EnvironmentVariables['SCENDANCE_CHAT_TRIAL_MODE']=$Mode
  if($Port -gt 0){$scendanceStart.EnvironmentVariables['SCENDANCE_CHAT_TRIAL_PORT']=[string]$Port}
  if($EnableLux3d){
    if($Mode -ne 'live'){throw '真实 Lux3D 仅可在真实本机试用中显式启用。'}
    # These are operator-supplied evidence and an internal reservation, not a vendor quote.
    $terms=$env:SCENDANCE_LUX3D_TERMS_URL;$reviewed=$env:SCENDANCE_LUX3D_REVIEWED_AT;$reserve=$env:SCENDANCE_LUX3D_RESERVATION_CENTS
    $uri=$null;$date=[DateTime]::MinValue
    if(![Uri]::TryCreate($terms,[UriKind]::Absolute,[ref]$uri) -or $uri.Scheme -ne 'https' -or $uri.UserInfo -or !$uri.IsDefaultPort -or $uri.Query -or $uri.Fragment -or !($uri.Host -eq 'aholo3d.cn' -or $uri.Host.EndsWith('.aholo3d.cn'))){throw '请先配置已核验的中国站服务条款地址。'}
    if(![DateTime]::TryParseExact($reviewed,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None,[ref]$date) -or $date.Date -gt [DateTime]::UtcNow.Date){throw '请先配置实际条款审阅日期。'}
    if($reserve -notmatch '^[1-9]\d{0,8}$'){throw '请先配置每任务内部预留金额；它不是供应商报价。'}
  }
  if($Mode -eq 'live') {
    Write-Host '本机独立试用：对话会发送到 MiniMax 中国站。'
    Write-Host '你已允许使用积分；套餐用尽后可能扣已购积分。调用次数实时显示；失败或结果未知即停止，发出后取消仍可能计费。'
    . (Join-Path $PSScriptRoot 'local-trial-key.ps1')
    $scendanceKeyPath=Get-LocalTrialKeyPath
    if([IO.File]::Exists($scendanceKeyPath)) {
      $scendanceSecure=Read-LocalTrialKey $scendanceKeyPath
      Write-Host '正在使用当前 Windows 用户保存的本机加密 Key。'
    } else {
      Write-Host '首次设置：Key 将加密保存在当前 Windows 用户的本机配置目录，之后本机试用可自动使用。'
      $scendanceSecure=Read-Host '输入订阅 Key（不会显示）' -AsSecureString
      Save-LocalTrialKey $scendanceKeyPath $scendanceSecure
      Write-Host '本机加密 Key 已保存。'
    }
    $scendanceBuffer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($scendanceSecure)
    $scendanceStart.EnvironmentVariables['SCENDANCE_CHAT_TRIAL_KEY']=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($scendanceBuffer)
    $scendanceStart.EnvironmentVariables['SCENDANCE_CHAT_TRIAL_CONFIRM']='EXPLICIT_TRIAL'
  }
  if($EnableLux3d){
    . (Join-Path $PSScriptRoot 'local-lux3d-key.ps1')
    $scendanceLuxSecure=Read-LocalTrialKey (Get-LocalLux3dKeyPath)
    $scendanceLuxBuffer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($scendanceLuxSecure)
    $scendanceStart.EnvironmentVariables['SCENDANCE_LUX3D_ENABLED']='1'
    $scendanceStart.EnvironmentVariables['SCENDANCE_LUX3D_KEY']=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($scendanceLuxBuffer)
    $scendanceStart.EnvironmentVariables['SCENDANCE_LUX3D_TERMS_URL']=$terms
    $scendanceStart.EnvironmentVariables['SCENDANCE_LUX3D_REVIEWED_AT']=$reviewed
    $scendanceStart.EnvironmentVariables['SCENDANCE_LUX3D_RESERVATION_CENTS']=$reserve
    Write-Host '本机试用已准备中国站文生 3D；实际费用以供应商账户为准，图生未开放。'
  }
  $scendanceProcess=[System.Diagnostics.Process]::Start($scendanceStart)
  $scendanceStart.EnvironmentVariables.Remove('SCENDANCE_CHAT_TRIAL_KEY')
  $scendanceStart.EnvironmentVariables.Remove('SCENDANCE_LUX3D_KEY')
  if($scendanceBuffer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($scendanceBuffer);$scendanceBuffer=[IntPtr]::Zero}
  if($scendanceSecure){$scendanceSecure.Dispose();$scendanceSecure=$null}
  if($scendanceLuxBuffer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($scendanceLuxBuffer);$scendanceLuxBuffer=[IntPtr]::Zero}
  if($scendanceLuxSecure){$scendanceLuxSecure.Dispose();$scendanceLuxSecure=$null}
  $scendanceProcess.WaitForExit()
  exit $scendanceProcess.ExitCode
} finally {
  if($scendanceBuffer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($scendanceBuffer)}
  if($scendanceSecure){$scendanceSecure.Dispose();$scendanceSecure=$null}
  if($scendanceLuxBuffer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($scendanceLuxBuffer)}
  if($scendanceLuxSecure){$scendanceLuxSecure.Dispose();$scendanceLuxSecure=$null}
  if($scendanceProcess){$scendanceProcess.Dispose()}
}
