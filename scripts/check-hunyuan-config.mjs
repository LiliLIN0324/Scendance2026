import { readFileSync, lstatSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { hasPrivateFilePermissions } from './private-env-file.ts';

const file = process.argv[2];
const allowed = ['HUNYUAN_API_MODE', 'HUNYUAN_API_KEY', 'GENERATION_MAX_TASK_CENTS', 'HUNYUAN_TERMS_URL', 'HUNYUAN_TERMS_REVIEWED_AT'];
const problems = [];
let env = {};
try {
  const stat = lstatSync(file);
  if (!stat.isFile() || !hasPrivateFilePermissions(file, stat.mode)) {
    problems.push('ENV_FILE: use a private regular file (POSIX 0600; Windows ACL limited to this user, SYSTEM and Administrators)');
  } else {
    env = parseEnv(readFileSync(file, 'utf8'));
  }
} catch { problems.push('ENV_FILE: supply a readable configuration file path'); }
for (const key of allowed) if (!env[key]?.trim()) problems.push(`${key}: required`);
if (Object.keys(env).some(key => !allowed.includes(key))) problems.push('ENV_FILE: only the five Hunyuan fields are permitted; do not upload other service settings');
if (env.HUNYUAN_API_MODE && env.HUNYUAN_API_MODE !== 'tokenhub') problems.push('HUNYUAN_API_MODE: must be tokenhub');
if (env.HUNYUAN_API_KEY && !/^sk-[A-Za-z0-9_-]{20,}$/.test(env.HUNYUAN_API_KEY)) problems.push('HUNYUAN_API_KEY: expected a full TokenHub API Key');
const cents = env.GENERATION_MAX_TASK_CENTS;
if (cents && (!/^\d+$/.test(cents) || !Number.isSafeInteger(Number(cents)) || Number(cents) < 1 || Number(cents) > 15000)) problems.push('GENERATION_MAX_TASK_CENTS: expected integer cents from 1 to 15000');
if (env.HUNYUAN_TERMS_URL) {
  try {
    const url = new URL(env.HUNYUAN_TERMS_URL);
    if (url.protocol !== 'https:' || url.hostname !== 'cloud.tencent.com' || url.username || url.password || !url.pathname.startsWith('/document/')) throw new Error();
  } catch { problems.push('HUNYUAN_TERMS_URL: expected the applicable official Tencent terms URL'); }
}
if (env.HUNYUAN_TERMS_REVIEWED_AT) {
  const date = env.HUNYUAN_TERMS_REVIEWED_AT;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date > today) problems.push('HUNYUAN_TERMS_REVIEWED_AT: expected a real YYYY-MM-DD date, not in the future');
}
if (problems.length) {
  console.error(`Hunyuan configuration failed:\n${problems.map(value => `- ${value}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('Hunyuan configuration passed. No secret values printed. No provider request or cloud change performed.');
}
