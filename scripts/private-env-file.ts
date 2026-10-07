import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Inspect raw ACEs: GetAccessRules can hide the fact that an ACE is conditional.
export const windowsAclPolicy = `
function Test-PrivateAcl($Descriptor, [string]$CurrentSid) {
  $trusted = @($CurrentSid, 'S-1-5-18', 'S-1-5-32-544')
  if ($null -eq $Descriptor.Owner -or $Descriptor.Owner.Value -notin $trusted -or $null -eq $Descriptor.DiscretionaryAcl) { return $false }
  $metadataOnly = 0x120088 # ReadAttributes, ReadExtendedAttributes, ReadPermissions, Synchronize
  foreach ($ace in $Descriptor.DiscretionaryAcl) {
    if ($ace.AceType -notin @([System.Security.AccessControl.AceType]::AccessAllowed, [System.Security.AccessControl.AceType]::AccessDenied)) { return $false }
    if (([int]$ace.AceFlags -band 8) -ne 0) { continue } # InheritOnly does not apply to this file.
    if ($ace.AceType -eq [System.Security.AccessControl.AceType]::AccessAllowed -and $ace.SecurityIdentifier.Value -notin $trusted -and ($ace.AccessMask -band (-bnot $metadataOnly)) -ne 0) { return $false }
  }
  return $true
}
`;

export function hasPrivateFilePermissions(file: string, mode: number, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return (mode & 0o077) === 0;
  try {
    const result = spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', windowsAclPolicy + `
$ErrorActionPreference = 'Stop'
try {
  $acl = [System.IO.File]::GetAccessControl($env:SCENDANCE_PRIVATE_ENV_FILE, [System.Security.AccessControl.AccessControlSections]6)
  $descriptor = [System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if (Test-PrivateAcl $descriptor $sid) { [Console]::Write('PRIVATE'); exit 0 }
} catch {}
exit 1
`,
    ], {
      env: { ...process.env, SCENDANCE_PRIVATE_ENV_FILE: file },
      encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 1024,
    });
    return !result.error && result.status === 0 && result.stdout === 'PRIVATE' && !result.stderr;
  } catch {
    return false;
  }
}
