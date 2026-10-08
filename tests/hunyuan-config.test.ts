import { afterAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasPrivateFilePermissions, windowsAclPolicy } from '../scripts/private-env-file.ts';

const directory = mkdtempSync(join(tmpdir(), 'hunyuan-config-'));
const path = join(directory, "配置 [test] ' $().env");
const script = fileURLToPath(new URL('../scripts/check-hunyuan-config.mjs', import.meta.url));
const secret = 'sk-private-test-only-value-not-for-disclosure';
const env = { HUNYUAN_API_MODE: 'tokenhub', HUNYUAN_API_KEY: secret, GENERATION_MAX_TASK_CENTS: '720',
  HUNYUAN_TERMS_URL: 'https://cloud.tencent.com/document/product/301/97822', HUNYUAN_TERMS_REVIEWED_AT: '2020-01-01' };
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
function runPowerShell(code: string, extra: Record<string, string> = {}) {
  const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);\n" + code], {
    env: { ...process.env, SCENDANCE_TEST_FILE: path, ...extra },
    encoding: 'utf8', windowsHide: true, timeout: 5000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe('');
  return result.stdout;
}
function setTestAcl(shared = false, empty = false) {
  // Only this suite's freshly created fake-credential file is modified, never its parent.
  runPowerShell(`
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [System.Security.AccessControl.FileSecurity]::new()
$acl.SetAccessRuleProtection($true, $false)
if ($env:SCENDANCE_TEST_EMPTY -ne '1') {
  foreach ($id in @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')) {
    $identity = [System.Security.Principal.SecurityIdentifier]::new($id)
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'Allow'))
  }
  if ($env:SCENDANCE_TEST_SHARED -eq '1') {
    $everyone = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0')
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($everyone, 'Read', 'Allow'))
  }
}
[System.IO.File]::SetAccessControl($env:SCENDANCE_TEST_FILE, $acl)
`, { SCENDANCE_TEST_SHARED: shared ? '1' : '0', SCENDANCE_TEST_EMPTY: empty ? '1' : '0' });
}
function check(changes = {}, mode = 0o600) {
  writeFileSync(path, Object.entries({ ...env, ...changes }).map(([key, value]) => `${key}=${value}`).join('\n'));
  if (process.platform === 'win32') setTestAcl(mode !== 0o600);
  else chmodSync(path, mode);
  const result = spawnSync(process.execPath, [script, path], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
  expect(result.error).toBeUndefined();
  const output = result.stdout + result.stderr;
  expect(output).not.toContain(secret);
  return { code: result.status, output };
}
afterAll(() => {
  if (process.platform === 'win32' && existsSync(path)) setTestAcl();
  rmSync(directory, { recursive: true, force: true });
});
describe('independent Hunyuan secret file preflight', () => {
  it('checks only Hunyuan fields, without requiring or printing other service credentials', () => {
    expect(check().code).toBe(0);
    expect(check({ SUPABASE_SERVICE_ROLE_KEY: 'unrelated-secret' }).code).toBe(1);
  }, 15000);
  it('rejects shared-readable files and incomplete keys', () => {
    expect(check({}, 0o644).code).toBe(1);
    expect(check({ HUNYUAN_API_KEY: 'sk-****' }).code).toBe(1);
    expect(check({ HUNYUAN_API_KEY: '' }).output).toContain('HUNYUAN_API_KEY: required');
  }, 15000);
  it.each(['0', '-1', '7.2', '15001', 'NaN'])('rejects invalid cents: %s', value => {
    expect(check({ GENERATION_MAX_TASK_CENTS: value }).code).toBe(1);
  });
  it.each(['2025-02-30', '9999-01-01', '2026/10/03'])('rejects invalid terms dates: %s', value => {
    expect(check({ HUNYUAN_TERMS_REVIEWED_AT: value }).code).toBe(1);
  });
  it('rejects insecure and unofficial terms URLs', () => {
    for (const value of ['http://cloud.tencent.com/document/terms', 'https://example.com/terms', 'https://user:secret@cloud.tencent.com/document/terms']) {
      expect(check({ HUNYUAN_TERMS_URL: value }).code).toBe(1);
    }
  }, 15000);
});

describe('private configuration permissions', () => {
  it.each([0o600, 0o400, 0o700])('keeps the existing owner-only POSIX behavior for %s', mode => {
    expect(hasPrivateFilePermissions(path, mode, 'linux')).toBe(true);
  });
  it.each([0o644, 0o640, 0o604, 0o660, 0o666])('rejects POSIX group or other access for %s', mode => {
    expect(hasPrivateFilePermissions(path, mode, 'linux')).toBe(false);
  });
  it('rejects a non-file or nonexistent path without disclosing credentials', () => {
    for (const candidate of [directory, join(directory, 'missing.env')]) {
      const result = spawnSync(process.execPath, [script, candidate], { encoding: 'utf8', windowsHide: true });
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toContain(secret);
    }
  });
});

describe.skipIf(process.platform !== 'win32')('Windows ACL protection', () => {
  function policy(sddl: string, kind = '') {
    return runPowerShell(windowsAclPolicy + `
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$descriptor = [System.Security.AccessControl.RawSecurityDescriptor]::new($env:SCENDANCE_TEST_SDDL.Replace('CURRENT', $sid))
if ($env:SCENDANCE_TEST_ACE -eq 'callback') {
  $raw = [System.Security.AccessControl.RawAcl]::new(2, 1)
  $ace = [System.Security.AccessControl.CommonAce]::new([System.Security.AccessControl.AceFlags]::None, [System.Security.AccessControl.AceQualifier]::AccessAllowed, 1, [System.Security.Principal.SecurityIdentifier]::new($sid), $true, [byte[]]@(0,0,0,0))
  $raw.InsertAce(0, $ace)
  $descriptor.DiscretionaryAcl = $raw
}
if (Test-PrivateAcl $descriptor $sid) { [Console]::Write('ALLOW') } else { [Console]::Write('REJECT') }
`, { SCENDANCE_TEST_SDDL: sddl, SCENDANCE_TEST_ACE: kind });
  }

  it('reads ACLs for Unicode and shell-special paths without modifying them', () => {
    expect(check().code).toBe(0);
    const readAcl = "$ErrorActionPreference='Stop'; [Console]::Write([System.IO.File]::GetAccessControl($env:SCENDANCE_TEST_FILE).Sddl)";
    const before = runPowerShell(readAcl);
    vi.stubEnv('PSModulePath', join(directory, 'missing-modules'));
    try { expect(hasPrivateFilePermissions(path, 0o666)).toBe(true); }
    finally { vi.unstubAllEnvs(); }
    expect(runPowerShell(readAcl)).toBe(before);
  }, 15000);

  it('accepts current-user, SYSTEM, Administrators and metadata-only access', () => {
    expect(policy('O:CURRENTD:(A;;FA;;;CURRENT)(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x120088;;;WD)')).toBe('ALLOW');
  });

  it.each(['WD', 'AU', 'BU', 'S-1-5-21-111-222-333-444'])('rejects broad or other identity %s', identity => {
    expect(policy(`O:CURRENTD:(A;;FA;;;CURRENT)(A;ID;FR;;;${identity})`)).toBe('REJECT');
  });

  it.each(['0x1', '0x2', '0x4', '0x20', '0x10000', '0x40000', '0x80000', '0x08000000'])
    ('rejects non-metadata or unknown permission bits %s', rights => {
      expect(policy(`O:CURRENTD:(A;;FA;;;CURRENT)(A;;${rights};;;WD)`)).toBe('REJECT');
    });

  it.each(['(D;;FR;;;WD)(A;;FR;;;WD)', '(A;;FR;;;WD)(D;;FR;;;WD)'])
    ('does not let DENY hide an unsafe ALLOW: %s', rules => {
      expect(policy(`O:CURRENTD:(A;;FA;;;CURRENT)${rules}`)).toBe('REJECT');
    });

  it('rejects an untrusted owner and a null DACL, but recognizes a restrictive empty DACL', () => {
    expect(policy('O:S-1-5-21-111-222-333-444D:(A;;FA;;;CURRENT)')).toBe('REJECT');
    expect(policy('O:CURRENTD:NO_ACCESS_CONTROL')).toBe('REJECT');
    expect(policy('O:CURRENTD:')).toBe('ALLOW');
  }, 15000);

  it('rejects unsupported callback and object ACEs even for a trusted identity', () => {
    expect(policy('O:CURRENTD:(A;;FA;;;CURRENT)', 'callback')).toBe('REJECT');
    expect(policy('O:CURRENTD:(OA;;FR;11111111-2222-3333-4444-555555555555;;CURRENT)')).toBe('REJECT');
  }, 15000);

  it('fails closed when the ACL probe cannot start or the file is absent', () => {
    expect(hasPrivateFilePermissions(join(directory, 'missing.env'), 0o600)).toBe(false);
    vi.stubEnv('SystemRoot', join(directory, 'missing-windows'));
    try { expect(hasPrivateFilePermissions(path, 0o600)).toBe(false); }
    finally { vi.unstubAllEnvs(); }
  });

  it('still requires readable contents after a restrictive ACL passes', () => {
    check();
    setTestAcl(false, true);
    try {
      const result = spawnSync(process.execPath, [script, path], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toContain(secret);
    } finally { setTestAcl(); }
  }, 15000);
});
