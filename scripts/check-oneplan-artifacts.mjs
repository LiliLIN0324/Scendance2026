#!/usr/bin/env node
/**
 * 构建后守卫（方案 C）：台账不得进产物。
 *
 * `next build`（output: 'export'）会把 `public/` 原样复制进 `out/`，所以只要有人把
 * ATTRIBUTION.md / NAMES.md / gallery.html / 完整台账再放回 `public/oneplan-icons/`，
 * 它们就会跟着产物上线。本脚本在构建后扫一遍产物，命中就非零退出，让构建红掉。
 *
 * 检查项：
 *   1. 台账文件名（ATTRIBUTION.md、NAMES.md、gallery.html、manifest.audit.json）出现在产物里；
 *   2. 产物里 oneplan-icons 下的文本文件（json/html/md/txt）含来源或校验信息
 *      （cdn.oneplan.io、sha256、original_sha256）；
 *   3. `--strict`：oneplan-icons 下除图标资源目录（icon/ scale-fg/ scale-bg/ area/ categories/）
 *      之外的文件一律报错——将来切到方案 A/B（整目录不进产物）时用它。
 *
 * 用法：
 *   node scripts/check-oneplan-artifacts.mjs
 *   node scripts/check-oneplan-artifacts.mjs --strict
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const strict = process.argv.includes('--strict');

const TARGETS = [
  path.join(repo, 'frontend/out'),
  path.join(repo, 'frontend/.next'),
].filter(existsSync);

const LEDGER_FILE = /oneplan-icons[\\/](ATTRIBUTION\.md|NAMES\.md|gallery\.html|manifest\.audit\.json)$/i;
const PROVENANCE = /cdn\.oneplan\.io|original_sha256|"sha256"\s*:/i;
const TEXT_FILE = /\.(json|html|md|txt)$/i;
const ASSET_DIR = /^(icon|scale-fg|scale-bg|area|categories)\//;

/** 递归列出目录下所有文件（不跟随符号链接）。 */
function walk(dir, into = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, into);
    else into.push(full);
  }
  return into;
}

if (TARGETS.length === 0) {
  console.log('check-oneplan-artifacts: 没有产物目录（先跑 next build）——跳过。');
  process.exit(0);
}

const violations = [];
let scanned = 0;
let published = 0;

for (const root of TARGETS) {
  for (const file of walk(root)) {
    scanned += 1;
    const rel = path.relative(repo, file).replace(/\\/g, '/');
    const marker = '/oneplan-icons/';
    const at = rel.indexOf(marker);
    if (at < 0) continue;
    const inner = rel.slice(at + marker.length);

    if (LEDGER_FILE.test(rel)) {
      violations.push(`${rel} — 台账文件不该进产物（应在 docs/oneplan-icons/）`);
      continue;
    }
    if (strict && !ASSET_DIR.test(inner)) {
      violations.push(`${rel} — --strict：oneplan-icons 下只允许图标资源`);
      continue;
    }
    if (TEXT_FILE.test(rel) && PROVENANCE.test(readFileSync(file, 'utf8'))) {
      violations.push(`${rel} — 含来源/校验信息（cdn.oneplan.io 或 sha256），台账字段应留在 docs`);
      continue;
    }
    published += 1;
  }
}

console.log(
  `check-oneplan-artifacts: 扫描 ${scanned} 个产物文件，oneplan-icons 下随产物发布 ${published} 个（图标资源），违规 ${violations.length} 条。`,
);

if (violations.length > 0) {
  for (const line of violations) console.error(`  ✗ ${line}`);
  console.error('方案 C 口径：台账（ATTRIBUTION/NAMES/gallery/完整 manifest）只放 docs/oneplan-icons/，public 只留运行期清单。');
  process.exit(1);
}
