#!/usr/bin/env node
/**
 * 把 CHANGELOG.md 的版本段落同步成 GitHub Release（规范见 docs/RELEASE-NOTES-STANDARD.md 第 8 节）。
 * 用法：
 *   node scripts/sync-github-releases.mjs              # 同步全部版本
 *   node scripts/sync-github-releases.mjs v3.2.0 v3.1.0
 *   node scripts/sync-github-releases.mjs --dry-run
 * 依赖：gh CLI 已登录（gh auth status）。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VERSION_HEADING = /^## (v\d+\.\d+\.\d+) · (.+?) · (\d{4}-\d{2}-\d{2})$/;
const APPENDIX_HEADING = /^## 附录 · 过程记录/;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const requested = args.filter(arg => /^v\d+\.\d+\.\d+$/.test(arg));

const lines = readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/);
const appendixAt = lines.findIndex(line => APPENDIX_HEADING.test(line));
const bodyLines = appendixAt === -1 ? lines : lines.slice(0, appendixAt);

/** @type {{version: string, title: string, date: string, body: string}[]} */
const entries = [];
let current = null;
for (const line of bodyLines) {
  const heading = line.match(VERSION_HEADING);
  if (heading) {
    if (current) current.body = current.body.trim();
    current = { version: heading[1], title: heading[2], date: heading[3], body: '' };
    entries.push(current);
    continue;
  }
  if (current) current.body += `${line}\n`;
}
if (current) current.body = current.body.trim();

const targets = requested.length > 0
  ? entries.filter(entry => requested.includes(entry.version))
  : entries;

const missing = requested.filter(version => !targets.some(entry => entry.version === version));
if (missing.length > 0) {
  console.error(`CHANGELOG.md 里找不到：${missing.join(', ')}`);
  process.exit(1);
}

const gh = (ghArgs, options = {}) => execFileSync('gh', ghArgs, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  ...options,
});

const existing = new Set();
try {
  const raw = gh(['release', 'list', '--limit', '200', '--json', 'tagName']);
  for (const item of JSON.parse(raw)) existing.add(item.tagName);
} catch (error) {
  console.error(`读不到已有 Release（gh release list 失败）：${error.stderr ?? error.message}`);
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), 'scendance-release-'));
const tags = new Set(execFileSync('git', ['tag', '--list'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean));
let created = 0;
let updated = 0;

for (const entry of targets) {
  const title = `${entry.version} ${entry.title}`;
  const bodyFile = join(workDir, `${entry.version}.md`);
  writeFileSync(bodyFile, `${entry.body}\n`, 'utf8');
  const action = existing.has(entry.version) ? 'edit' : 'create';
  if (action === 'create' && !tags.has(entry.version)) {
    console.log(`· ${entry.version} 跳过：仓库没有这个 tag（先打 tag 再同步）`);
    continue;
  }
  const command = action === 'edit'
    ? ['release', 'edit', entry.version, '--title', title, '--notes-file', bodyFile]
    : ['release', 'create', entry.version, '--title', title, '--notes-file', bodyFile, '--verify-tag', '--latest=false'];
  if (dryRun) {
    console.log(`[dry-run] gh ${command.join(' ')}   (${entry.body.length} 字符)`);
    continue;
  }
  try {
    gh(command);
    if (action === 'edit') updated += 1;
    else created += 1;
    console.log(`${action === 'edit' ? '↻' : '+'} ${title}`);
  } catch (error) {
    console.error(`✗ ${entry.version} 同步失败：${error.stderr ?? error.message}`);
    process.exitCode = 1;
  }
}

if (!dryRun) console.log(`\n完成：新建 ${created} 个，更新 ${updated} 个。`);