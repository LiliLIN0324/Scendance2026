#!/usr/bin/env node
/**
 * CHANGELOG.md 规范检查（规范见 docs/RELEASE-NOTES-STANDARD.md）。
 * 用法：node scripts/check-changelog.mjs [--file CHANGELOG.md]
 * 退出码 1 = 有版本没达标；0 = 全部达标。
 */
import { readFileSync } from 'node:fs';

const fileIndex = process.argv.indexOf('--file');
const file = fileIndex > -1 ? process.argv[fileIndex + 1] : 'CHANGELOG.md';

const VERSION_HEADING = /^## v(\d+)\.(\d+)\.(\d+) · (.+?) · (\d{4}-\d{2}-\d{2})$/;
const APPENDIX_HEADING = /^## 附录 · 过程记录/;
const SECTION_LABELS = ['你能直接用到的', '改好了什么', '边界与未做'];
const FORBIDDEN = ['若干', '优化了体验', '多项改进', '详见下文', '预计', '即将'];
const MIN_BULLETS = 6;
const MIN_BULLET_CHARS = 18;
const MIN_SUMMARY_CHARS = 40;
const MIN_TOTAL_CHARS = 260;

/** 去掉 markdown 记法与空白后的字数（中文按字算，英文按词算，近似即可）。 */
const chars = text => text
  .replace(/\*\*/g, '')
  .replace(/`[^`]*`/g, 'code')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\s+/g, '')
  .length;

const source = readFileSync(file, 'utf8');
const lines = source.split(/\r?\n/);

// 附录之前才是「版本段落」区。
const appendixAt = lines.findIndex(line => APPENDIX_HEADING.test(line));
const bodyLines = appendixAt === -1 ? lines : lines.slice(0, appendixAt);

const blocks = [];
let current = null;
for (const line of bodyLines) {
  if (/^## /.test(line)) {
    current = { heading: line, headingIndex: blocks.length, lines: [] };
    blocks.push(current);
    continue;
  }
  if (current) current.lines.push(line);
}

const problems = [];
const versions = [];
for (const block of blocks) {
  const match = block.heading.match(VERSION_HEADING);
  if (!match) {
    problems.push(`第 ${block.headingIndex + 1} 个「## 」段不是合法版本行：${block.heading}\n  期望：## vX.Y.Z · 短标题 · YYYY-MM-DD（历史实施记录请移到文末「## 附录 · 过程记录」）`);
    continue;
  }
  const [, major, minor, patch, title, date] = match;
  const version = `v${major}.${minor}.${patch}`;
  const text = block.lines.join('\n');
  const entryProblems = [];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) entryProblems.push('日期不是 YYYY-MM-DD');
  if (title.trim().length === 0 || chars(title) > 12) entryProblems.push(`短标题超过 12 字：「${title}」`);

  const summaryText = text.split(/\n\*\*|\n- /)[0] ?? '';
  if (chars(summaryText) < MIN_SUMMARY_CHARS) {
    entryProblems.push(`摘要段只有 ${chars(summaryText)} 字（下限 ${MIN_SUMMARY_CHARS}）：${summaryText.trim().slice(0, 40)}…`);
  }
  for (const label of SECTION_LABELS) {
    if (!text.includes(`**${label}**`)) entryProblems.push(`缺段落「**${label}**」`);
  }

  const bullets = text.split('\n').filter(line => /^- /.test(line.trim()));
  if (bullets.length < MIN_BULLETS) entryProblems.push(`只有 ${bullets.length} 条 bullet（下限 ${MIN_BULLETS}）`);
  for (const bullet of bullets) {
    if (chars(bullet.replace(/^- /, '')) < MIN_BULLET_CHARS) {
      entryProblems.push(`bullet 太短（< ${MIN_BULLET_CHARS} 字）：${bullet.trim().slice(0, 34)}…`);
    }
    for (const word of FORBIDDEN) {
      if (bullet.includes(word)) entryProblems.push(`bullet 含禁用语「${word}」：${bullet.trim().slice(0, 34)}…`);
    }
  }
  if (chars(text) < MIN_TOTAL_CHARS) entryProblems.push(`整段只有 ${chars(text)} 字（下限 ${MIN_TOTAL_CHARS}）`);

  versions.push({ version, date, problems: entryProblems });
  for (const problem of entryProblems) problems.push(`${version}：${problem}`);
}

// 版本号不许重复。
const seen = new Set();
for (const item of versions) {
  if (seen.has(item.version)) problems.push(`版本号重复出现：${item.version}`);
  seen.add(item.version);
}

// 最新版本必须与 package.json / frontend/package.json 的三个版本号一致。
try {
  const declared = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const declaredFrontend = JSON.parse(readFileSync('frontend/package.json', 'utf8')).version;
  const newest = versions[0]?.version;
  for (const [where, value] of [['package.json', declared], ['frontend/package.json', declaredFrontend]]) {
    if (newest && `v${value}` !== newest) {
      problems.push(`${where} 的 version=${value}，与 CHANGELOG 最新版本 ${newest} 不一致（发版时三处一起改）`);
    }
  }
} catch (error) {
  problems.push(`读不到 package.json 的版本号：${error.message}`);
}

// 顺序：语义版本必须从新到旧。
const parsed = versions.map(item => item.version.slice(1).split('.').map(Number));
for (let i = 1; i < parsed.length; i += 1) {
  const prev = parsed[i - 1];
  const next = parsed[i];
  const greater = prev[0] - next[0] || prev[1] - next[1] || prev[2] - next[2];
  if (greater < 0) problems.push(`版本顺序不对：${versions[i - 1].version} 应排在 ${versions[i].version} 之后`);
}

for (const item of versions) {
  const state = item.problems.length === 0 ? 'PASS' : `${item.problems.length} problem(s)`;
  console.log(`${state.padEnd(16)} ${item.version}  ${item.date}`);
}

if (problems.length > 0) {
  console.error(`\n✗ ${file} 有 ${problems.length} 处不符合 docs/RELEASE-NOTES-STANDARD.md：`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(`\n✓ ${versions.length} 个版本全部符合规范。`);