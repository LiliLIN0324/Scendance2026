# Bailian credentials are stored separately from other provider credentials.
. (Join-Path $PSScriptRoot 'local-trial-key.ps1')

function Get-LocalBailianKeyPath {
  $base=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  if([string]::IsNullOrWhiteSpace($base)){throw '无法确定当前用户的本机配置目录。'}
  return Join-Path $base 'Scendance\local-trial\bailian-key.dpapi'
}

function Save-LocalBailianKey([string]$Path,[Security.SecureString]$Key) {
  Save-LocalTrialKey $Path $Key
}

function Read-LocalBailianKey([string]$Path) {
  Read-LocalTrialKey $Path
}
