#!/usr/bin/env node
// 生成 docs/DOC-MAP.md：全仓 markdown 台账。
//
// 用法：
//   node scripts/doc-scan.mjs            # 写入 docs/DOC-MAP.md
//   node scripts/doc-scan.mjs --check    # 只比对，不写；有差异退出 1（可挂 CI）
//   node scripts/doc-scan.mjs --stdout   # 打到标准输出
//
// 口径：
// - 排除 node_modules / .next / out / .git / vendor；agent 草稿目录单列，不参与“可读文档”计数。
// - 「最后改动」取该文件最近一次 git 提交日期（一次 git log 全量解析，不逐文件起进程）；
//   未入库文件标「未入库」，方便一眼看出哪些只在本机。
// - 「首句」取自文件自身：首个一级标题，没有标题则取首个非空正文行，截断 64 字。
// - 本页只回答「有哪些、多大、什么时候动过」，不写结论、不替代 docs/INDEX.md。

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, 'docs', 'DOC-MAP.md');
const SKIP_DIRS = new Set([
  'node_modules', '.next', 'out', '.git', 'vendor', '.turbo',
  // 本地草稿/产物目录：被 .gitignore 排除，也不该进台账（否则 .local/ 里的临时比对文件会被当成文档）
  '.local', '.tmp', '.temp', '.cache', '.reports', 'coverage', 'artifacts', 'output', 'exports',
]);
const AGENT_DIRS = ['.zwork', '.zcode', '.trae', '.agents', '.memsearch'];
const SUMMARY_MAX = 64;

const args = new Set(process.argv.slice(2));

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), acc);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      acc.push(relative(ROOT, join(dir, entry.name)).split(sep).join('/'));
    }
  }
  return acc;
}

function gitDates() {
  const map = new Map();
  let raw = '';
  try {
    raw = execFileSync(
      'git',
      ['-c', 'core.quotepath=false', 'log', '--pretty=format:__%cs', '--name-only', '--no-renames'],
      { cwd: ROOT, maxBuffer: 512 * 1024 * 1024, encoding: 'utf8' },
    );
  } catch {
    return map;
  }
  let date = '';
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('__')) {
      date = line.slice(2).trim();
    } else if (line && date && !map.has(line)) {
      map.set(line, date);
    }
  }
  return map;
}

function summarize(rel) {
  let text = '';
  try {
    text = readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    return '';
  }
  text = text.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  let heading = '';
  let body = '';
  let inCode = false;
  for (const line of lines.slice(0, 120)) {
    const t = line.trim();
    if (t.startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode || !t) continue;
    if (!heading && /^#\s+\S/.test(t)) {
      heading = t.replace(/^#\s+/, '');
      continue;
    }
    if (!body && !t.startsWith('|') && !t.startsWith('>') && !t.startsWith('<!--') && !/^#{2,6}\s/.test(t)) {
      body = t;
    }
    if (heading && body) break;
  }
  const pick = (heading || body)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!pick) return '（无标题、无正文首句）';
  return pick.length > SUMMARY_MAX ? `${pick.slice(0, SUMMARY_MAX)}…` : pick;
}

const allMd = walk(ROOT).sort();
const dates = gitDates();

const records = allMd.map(rel => {
  const st = statSync(join(ROOT, rel));
  return {
    rel,
    bytes: st.size,
    date: dates.get(rel) || '',
    summary: summarize(rel),
  };
});

const isAgent = rel => AGENT_DIRS.some(d => rel.startsWith(`${d}/`));
const readable = records.filter(r => !isAgent(r.rel));
const agent = records.filter(r => isAgent(r.rel));

function bucketOf(rel) {
  if (isAgent(rel)) return 'agent 草稿（未入库）';
  const parts = rel.split('/');
  if (parts.length === 1) return '仓库根';
  const top = parts[0];
  if (top === 'docs') {
    if (parts.length === 2) return 'docs/（根目录）';
    const sub = parts[1];
    if (sub === 'plans') return 'docs/plans/';
    if (sub === 'archive') return 'docs/archive/';
    if (sub === 'evidence') return 'docs/evidence/';
    if (sub === 'research') return 'docs/research/';
    return 'docs/ 其他子目录';
  }
  if (top === 'frontend') return 'frontend/';
  if (top === 'tools') return 'tools/';
  return '其他模块';
}

const BUCKET_ORDER = [
  'docs/（根目录）',
  'docs/plans/',
  'docs/archive/',
  'docs/evidence/',
  'docs/research/',
  'docs/ 其他子目录',
  'frontend/',
  'tools/',
  '其他模块',
  '仓库根',
  'agent 草稿（未入库）',
];

const buckets = new Map();
for (const r of records) {
  const b = bucketOf(r.rel);
  if (!buckets.has(b)) buckets.set(b, []);
  buckets.get(b).push(r);
}

const kb = n => (n / 1024).toFixed(1);
const mb = n => (n / 1024 / 1024).toFixed(1);
const totalBytes = records.reduce((s, r) => s + r.bytes, 0);
const readableBytes = readable.reduce((s, r) => s + r.bytes, 0);
const untracked = records.filter(r => !r.date).length;

const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const cn = n => (n <= 10 ? CN[n] : n < 20 ? `十${CN[n - 10]}` : String(n));

function row(r) {
  const name = r.rel.split('/').pop().replace(/\|/g, '\\|');
  const fromDocs = relative(join(ROOT, 'docs'), join(ROOT, r.rel)).split(sep).join('/');
  const href = fromDocs.replace(/[ ()]/g, c => encodeURIComponent(c));
  return `| [${name}](<${href}>) | ${kb(r.bytes)} | ${r.date || '未入库'} | ${r.summary.replace(/\|/g, '\\|')} |`;
}

// —— 自动体检 ——
const rootDocs = readable.filter(r => r.rel.startsWith('docs/') && r.rel.split('/').length === 2);
const numbered = rootDocs
  .map(r => ({ r, m: r.rel.match(/^docs\/(\d{2})-(.+)\.md$/) }))
  .filter(x => x.m);
const byNumber = new Map();
for (const x of numbered) {
  const n = x.m[1];
  if (!byNumber.has(n)) byNumber.set(n, []);
  byNumber.get(n).push(x.r.rel.split('/').pop());
}
const duplicates = [...byNumber.entries()].filter(([, v]) => v.length > 1);
const usedNumbers = [...byNumber.keys()].map(Number).sort((a, b) => a - b);
const maxNumber = Math.max(...usedNumbers);
const missing = [];
for (let i = 1; i <= maxNumber; i += 1) if (!byNumber.has(String(i).padStart(2, '0'))) missing.push(String(i).padStart(2, '0'));
const plansNoDate = (buckets.get('docs/plans/') || []).filter(r => !/^\d{4}-\d{2}-\d{2}-/.test(r.rel.split('/').pop())).length;
const heaviest = [...records].sort((a, b) => b.bytes - a.bytes).slice(0, 6);

const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const lines = [];

lines.push('# Scendance 文档地图（DOC-MAP）');
lines.push('');
lines.push('> **本页由脚本生成，不要手改。** 重新生成：`node scripts/doc-scan.mjs`（Node ≥ 20，无依赖）。');
lines.push(`> 生成时间：${stamp}；扫描口径见页尾「生成口径」。`);
lines.push('> 分工：本页只回答「有哪些文件、多大、什么时候动过」；**要读什么看 [README.md](README.md)**，按用途归类看 [INDEX.md](INDEX.md)。');
lines.push('');
lines.push('## 一、全景');
lines.push('');
lines.push('| 位置 | md | 体量 | 收什么 |');
lines.push('| --- | ---: | ---: | --- |');
const BUCKET_NOTE = {
  'docs/（根目录）': '现行规格 / 计划 / 参考：编号文档 + 无编号页',
  'docs/plans/': '在建方案、交接、批次交付记录',
  'docs/archive/': '历史：report / plan / research / visual / legacy / example',
  'docs/evidence/': '实测证据（回执、截图说明、探针记录）',
  'docs/research/': '调研长文',
  'docs/ 其他子目录': 'contracts / quality / oneplan-icons / release-notes',
  'frontend/': '前端模块自带说明',
  'tools/': '离线工具说明',
  '其他模块': 'assets / data / deliverables / supabase / learning-library 等',
  '仓库根': '协作、交接、变更、记忆',
  'agent 草稿（未入库）': 'agent 运行产物与会话草稿，不参与文档体系',
};
for (const b of BUCKET_ORDER) {
  const list = buckets.get(b) || [];
  if (!list.length) continue;
  const sum = list.reduce((s, r) => s + r.bytes, 0);
  lines.push(`| ${b} | ${list.length} | ${mb(sum)} MB | ${BUCKET_NOTE[b] || ''} |`);
}
lines.push(`| **合计** | **${records.length}** | **${mb(totalBytes)} MB** | 其中可读文档 ${readable.length} 份（${mb(readableBytes)} MB），agent 草稿 ${agent.length} 份 |`);
lines.push('');

let section = 1;
const SECTION_TITLE = {
  'docs/（根目录）': '`docs/` 根目录',
  'docs/plans/': '`docs/plans/`（在建，按最后改动倒序）',
  'docs/archive/': '`docs/archive/`（历史，原文不改写）',
  'docs/evidence/': '`docs/evidence/`（证据）',
  'docs/research/': '`docs/research/`（调研长文）',
  'docs/ 其他子目录': '`docs/` 其余子目录',
  'frontend/': '`frontend/`',
  'tools/': '`tools/`',
  '其他模块': '其他模块',
  '仓库根': '仓库根',
  'agent 草稿（未入库）': 'agent 草稿（未入库）',
};

for (const b of BUCKET_ORDER) {
  let list = buckets.get(b) || [];
  if (!list.length) continue;
  if (b === 'docs/archive/' || b === 'docs/evidence/') {
    list = [...list].sort((a, c) => a.rel.localeCompare(c.rel, 'zh'));
  } else {
    list = [...list].sort((a, c) => (c.date || '').localeCompare(a.date || '') || a.rel.localeCompare(c.rel, 'zh'));
  }
  section += 1;
  lines.push(`## ${cn(section)}、${SECTION_TITLE[b] || b}（${list.length} 份）`);
  lines.push('');
  lines.push('| 文件 | KB | 最后改动 | 首句 |');
  lines.push('| --- | ---: | --- | --- |');
  for (const r of list) lines.push(row(r));
  lines.push('');
}

section += 1;
lines.push(`## ${cn(section)}、自动体检（每次生成重算）`);
lines.push('');
const numberedCount = numbered.length;
lines.push(`1. **编号占用**：\`docs/\` 根 ${numberedCount} 份编号文档，占用 01–${String(maxNumber).padStart(2, '0')}；缺号 ${missing.length} 个（${missing.join('/') || '无'}）。`);
lines.push(duplicates.length
  ? `2. **重号**：${duplicates.map(([n, v]) => `${n} 号 ${v.length} 份（${v.map(x => `\`${x}\``).join(' / ')}）`).join('；')}。`
  : '2. **重号**：无。');
lines.push(`3. **\`docs/plans/\` 命名**：${plansNoDate} 份无日期前缀（文件名看不出新旧，只能看本表的时间列）。`);
lines.push(`4. **未入库**：${untracked} 份 md 没有 git 记录（含 agent 草稿）；这些只在本机，别处 checkout 拿不到。`);
lines.push(`5. **体量最大**：${heaviest.map(r => `\`${r.rel}\` ${kb(r.bytes)} KB`).join('、')}。`);
lines.push('');
lines.push('## 生成口径');
lines.push('');
lines.push('- 扫描整个工作副本，排除 `node_modules` / `.next` / `out` / `.git` / `vendor` / `.turbo`；`.zwork`、`.zcode`、`.trae`、`.agents`、`.memsearch` 单列为 agent 草稿，`.local/` 为统一临时区（整目录跳过）。');
lines.push('- `最后改动` = 该文件最近一次 git 提交日期（一次 `git log` 全量解析）；无记录写「未入库」。');
lines.push('- `首句` = 文件首个一级标题；无标题则取首个非空正文行；截断 64 字。是文件自述，不是评审结论。');
lines.push('- 本页不写结论、不替代 INDEX。要改本页格式，改 `scripts/doc-scan.mjs` 后重跑，不要直接编辑。');
lines.push('');

const output = `${lines.join('\n')}`;
const previous = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';

// 自引用两处会让 --check 永远不通过：生成时间每分钟变，本页自身那行的 KB 也随
// 文件大小浮动（改了时间戳就改字节数）。比对时统一剔除这两行。
const normalize = s =>
  s
    .split('\n')
    .filter(l => !l.startsWith('> 生成时间：') && !l.startsWith('| [DOC-MAP.md]'))
    .join('\n');

if (args.has('--stdout')) {
  process.stdout.write(output);
} else if (args.has('--check')) {
  if (normalize(previous) !== normalize(output)) {
    console.error('docs/DOC-MAP.md 与扫盘结果不一致，请重跑 node scripts/doc-scan.mjs');
    process.exit(1);
  }
  console.log('docs/DOC-MAP.md 与扫盘结果一致');
} else {
  writeFileSync(OUT, output, 'utf8');
  console.log(`写入 docs/DOC-MAP.md：${records.length} 份 md（可读 ${readable.length}，agent 草稿 ${agent.length}），${mb(totalBytes)} MB`);
}
