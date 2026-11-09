# Run in a user-visible terminal. This setup does not contact a provider.
$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')
$ErrorActionPreference='Stop'
$secure=$null
$phase='准备'
try {
  . (Join-Path $PSScriptRoot 'local-bailian-key.ps1')
  $keyPath=Get-LocalBailianKeyPath
  if([IO.File]::Exists($keyPath)) {
    Write-Host '本机百炼加密凭据已存在；未读取、修改或覆盖。'
    return
  }
  Write-Host '仅设置本机百炼 API Key，与其他模型的 Key 分开保存。'
  Write-Host '此步骤不会连接百炼，也不会发起模型请求。'
  $phase='输入'
  $secure=Read-Host '输入百炼 API Key（不会显示）' -AsSecureString
  $phase='保存'
  Save-LocalBailianKey $keyPath $secure
  Write-Host '百炼 Key 已按当前 Windows 用户加密保存。'
} catch {
  Write-Host "百炼 Key $phase 阶段未完成，未输出密钥或错误原文。"
  Write-Host '请保留此窗口并告诉助手上述阶段；不要发送 Key。'
  throw '本机百炼凭据设置未完成。'
} finally {
  if($secure){$secure.Dispose()}
}
