# Windows only. The encoded value is encrypted by DPAPI for the current user.
# This file is dot-sourced by the local trial launcher, not by the application.
function Get-LocalTrialKeyPath {
  $base=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  if ([string]::IsNullOrWhiteSpace($base)) { throw '无法确定当前用户的本机配置目录。' }
  return Join-Path $base 'Scendance\local-trial\minimax-key.dpapi'
}

function Test-LocalTrialKeyShape([Security.SecureString]$Key) {
  if(!$Key -or $Key.Length -lt 1 -or $Key.Length -gt 4096){return $false}
  $buffer=[IntPtr]::Zero
  try {
    $buffer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Key)
    for($i=0;$i -lt $Key.Length;$i++){
      $char=[Runtime.InteropServices.Marshal]::ReadInt16($buffer,$i*2)
      if($char -lt 0x21 -or $char -gt 0x7e){return $false}
    }
    return $true
  } finally {if($buffer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($buffer)}}
}

function Save-LocalTrialKey([string]$Path,[Security.SecureString]$Key) {
  if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw '本机 Key 加密仅支持 Windows。'}
  if (!(Test-LocalTrialKeyShape $Key)) { throw 'Key 格式不符合要求，本机试用未启动。' }
  $directory=Split-Path -Parent $Path
  [IO.Directory]::CreateDirectory($directory) | Out-Null
  # Windows PowerShell without an explicit key uses CurrentUser DPAPI.
  $encrypted=ConvertFrom-SecureString -SecureString $Key
  $bytes=[Text.Encoding]::ASCII.GetBytes($encrypted)
  $stream=$null
  try {
    # Never overwrite an existing credential, even if two setup windows race.
    $stream=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    $stream.Write($bytes,0,$bytes.Length)
    $stream.Flush($true)
  } finally {
    if($stream){$stream.Dispose()}
    [Array]::Clear($bytes,0,$bytes.Length)
    $encrypted=$null
  }
}

function Read-LocalTrialKey([string]$Path) {
  if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw '本机 Key 加密仅支持 Windows。'}
  $info=[IO.FileInfo]::new($Path)
  if(!$info.Exists -or $info.Length -lt 1 -or $info.Length -gt 16384) { throw '本机 Key 记录无法读取，请重新设置。' }
  try {
    $encrypted=[IO.File]::ReadAllText($Path,[Text.Encoding]::ASCII)
    $key=ConvertTo-SecureString -String $encrypted -ErrorAction Stop
    if(!(Test-LocalTrialKeyShape $key)) { throw 'invalid' }
    return $key
  } catch { throw '本机 Key 记录无法解密，请检查当前 Windows 用户或重新设置。' }
  finally { $encrypted=$null }
}
