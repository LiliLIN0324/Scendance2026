# User runs this from a visible terminal. No provider call is made here.
$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'local-lux3d-key.ps1')
$keyPath=Get-LocalLux3dKeyPath
if([IO.File]::Exists($keyPath)) {
  Write-Host '本机 Lux3D 加密凭据已存在；未读取、修改或覆盖。'
  return
}
Write-Host '仅设置本机 Lux3D API Key，与 MiniMax Key 分开保存。'
Write-Host '请使用中国站 Lux3D API Key；此步骤不启用生成，也不会访问 Aholo。'
Write-Host '生成前仍需核对账户站点、服务条款及预算。'
$secure=$null
try {
  $secure=Read-Host '输入 Lux3D API Key（不会显示）' -AsSecureString
  Save-LocalLux3dKey $keyPath $secure
  Write-Host 'Lux3D Key 已按当前 Windows 用户加密保存；功能仍未启用。'
} finally {
  if($secure){$secure.Dispose()}
}
