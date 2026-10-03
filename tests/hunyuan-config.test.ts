import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = mkdtempSync(join(tmpdir(), 'hunyuan-config-'));
const path = join(directory, '.env.hunyuan.local');
const script = fileURLToPath(new URL('../scripts/check-hunyuan-config.mjs', import.meta.url));
const secret = 'sk-private-test-only-value-not-for-disclosure';
const env = { HUNYUAN_API_MODE: 'tokenhub', HUNYUAN_API_KEY: secret, GENERATION_MAX_TASK_CENTS: '720',
  HUNYUAN_TERMS_URL: 'https://cloud.tencent.com/document/product/301/97822', HUNYUAN_TERMS_REVIEWED_AT: '2020-01-01' };
function check(changes = {}, mode = 0o600) {
  writeFileSync(path, Object.entries({ ...env, ...changes }).map(([key, value]) => `${key}=${value}`).join('\n'));
  chmodSync(path, mode);
  const result = spawnSync(process.execPath, [script, path], { encoding: 'utf8' });
  const output = result.stdout + result.stderr;
  expect(output).not.toContain(secret);
  return { code: result.status, output };
}
afterAll(() => rmSync(directory, { recursive: true, force: true }));
describe('independent Hunyuan secret file preflight', () => {
  it('checks only Hunyuan fields, without requiring or printing other service credentials', () => {
    expect(check().code).toBe(0);
    expect(check({ SUPABASE_SERVICE_ROLE_KEY: 'unrelated-secret' }).code).toBe(1);
  });
  it('rejects shared-readable files and incomplete keys', () => {
    expect(check({}, 0o644).code).toBe(1);
    expect(check({ HUNYUAN_API_KEY: 'sk-****' }).code).toBe(1);
    expect(check({ HUNYUAN_API_KEY: '' }).output).toContain('HUNYUAN_API_KEY: required');
  });
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
  });
});
