# Lux3D credentials are separate from the MiniMax trial credential.
. (Join-Path $PSScriptRoot 'local-trial-key.ps1')

function Get-LocalLux3dKeyPath {
  $base=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  if([string]::IsNullOrWhiteSpace($base)){throw '无法确定当前用户的本机配置目录。'}
  return Join-Path $base 'Scendance\local-trial\lux3d-key.dpapi'
}

function Save-LocalLux3dKey([string]$Path,[Security.SecureString]$Key) {
  Save-LocalTrialKey $Path $Key
}
