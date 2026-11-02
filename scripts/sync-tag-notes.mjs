#!/usr/bin/env node
/**
 * 把 CHANGELOG.md 的版本段落同步成 GitHub **annotated tag 的注释**（Tags 页展示的就是它）。
 * 用法：
 *   node scripts/sync-tag-notes.mjs              # 全部版本
 *   node scripts/sync-tag-notes.mjs v3.2.0       # 只同步一个
 *   node scripts/sync-tag-notes.mjs --dry-run    # 只打印
 *   node scripts/sync-tag-notes.mjs --no-push    # 只重建本地 tag，不推送
 *
 * 做法：保留 tag 指向的提交不变，用 CHANGELOG 段落重建 annotated tag，然后 --force 推同一路径。
 * 规范见 docs/RELEASE-NOTES-STANDARD.md 第 8 节。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VERSION_HEADING = /^## (v\d+\.\d+\.\d+) · (.+?) · (\d{4}-\d{2}-\d{2})$/;
const APPENDIX_HEADING = /^## 附录 · 过程记录/;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const push = !args.includes('--no-push');
const requested = args.filter(arg => /^v\d+\.\d+\.\d+$/.test(arg));

const lines = readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/);
const appendixAt = lines.findIndex(line => APPENDIX_HEADING.test(line));
const bodyLines = appendixAt === -1 ? lines : lines.slice(0, appendixAt);

const entries = [];
let current = null;
for (const line of bodyLines) {
  const heading = line.match(VERSION_HEADING);
  if (heading) {
    if (current) current.body = current.body.trim();
    current = { version: heading[1], title: heading[2], body: '' };
    entries.push(current);
    continue;
  }
  if (current) current.body += `${line}\n`;
}
if (current) current.body = current.body.trim();

const git = gitArgs => execFileSync('git', gitArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const localTags = new Set(git(['tag', '--list']).split(/\r?\n/).filter(Boolean));
const targets = requested.length > 0 ? entries.filter(entry => requested.includes(entry.version)) : entries;
const unknown = requested.filter(version => !targets.some(entry => entry.version === version));
if (unknown.length > 0) {
  console.error(`CHANGELOG.md 里找不到：${unknown.join(', ')}`);
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), 'scendance-tag-'));
let rebuilt = 0;

for (const entry of targets) {
  if (!localTags.has(entry.version)) {
    console.log(`· ${entry.version} 跳过：本地没有这个 tag`);
    continue;
  }
  const commit = git(['rev-list', '-n', '1', entry.version]).trim();
  const messageFile = join(workDir, `${entry.version}.txt`);
  writeFileSync(messageFile, `${entry.version} ${entry.title}\n\n${entry.body}\n`, 'utf8');
  if (dryRun) {
    console.log(`[dry-run] 重建 ${entry.version} → ${commit.slice(0, 7)}，注释 ${entry.body.length} 字符${push ? '，并 --force 推送' : ''}`);
    continue;
  }
  git(['tag', '-d', entry.version]);
  git(['tag', '-a', entry.version, commit, '-F', messageFile]);
  if (push) execFileSync('git', ['push', '--force', 'origin', `refs/tags/${entry.version}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  rebuilt += 1;
  console.log(`✓ ${entry.version} ${entry.title}（${entry.body.length} 字符${push ? '，已推送' : ''}）`);
}

if (!dryRun) console.log(`\n重建 ${rebuilt} 个 tag。`);