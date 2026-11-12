#!/usr/bin/env node
/**
 * 主包体积守卫（小程序主包上限 2 MB）。
 *
 * 为什么要有：README 的「包体清单」是一次性手抄的，加了几张引导图就悄悄逼近上限，
 * 没人守的话，等开发者工具报「主包超限」才发现，返工要删素材。
 *
 * 口径与 project.config.json → packOptions.ignore 对齐（同一个排除集），
 * 所以这里算出来的数 = 真正上传的主包大小。
 *
 * 用法：
 *   node miniprogram/scripts/check-package-size.mjs
 *   node miniprogram/scripts/check-package-size.mjs --budget 1800000   # 自定义预警线
 *
 * 退出码：0 = 在预算内；1 = 超上限或超预警线。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MINI_ROOT = path.resolve(here, '..');

// 微信小程序主包上限 2 MB（字节）。
const HARD_LIMIT = 2 * 1024 * 1024;
// 预警线：到 90% 就该动手，不要等撞墙。
const DEFAULT_BUDGET = Math.floor(HARD_LIMIT * 0.9);

// 与 project.config.json → packOptions.ignore 保持一致。
const IGNORED_FOLDERS = new Set(['scripts', 'node_modules']);
const IGNORED_FILES = new Set(['README.md', 'package-lock.json']);

function parseArgs(argv) {
  const out = { budget: DEFAULT_BUDGET };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--budget') {
      out.budget = Number(argv[i + 1]);
      i += 1;
    }
  }
  return out;
}

function walk(dir, onFile) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_FOLDERS.has(entry.name)) continue;
      walk(full, onFile);
    } else if (entry.isFile()) {
      if (IGNORED_FILES.has(entry.name)) continue;
      onFile(full);
    }
  }
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const groups = new Map();

  walk(MINI_ROOT, file => {
    const relative = path.relative(MINI_ROOT, file);
    const top = relative.includes(path.sep) ? relative.split(path.sep)[0] : '（根文件）';
    if (!groups.has(top)) groups.set(top, { files: 0, bytes: 0 });
    const entry = groups.get(top);
    entry.files += 1;
    entry.bytes += fs.statSync(file).size;
  });

  const rows = [...groups.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
  let totalBytes = 0;
  let totalFiles = 0;
  for (const [, entry] of rows) {
    totalBytes += entry.bytes;
    totalFiles += entry.files;
  }

  console.log('主包清单（口径同 packOptions.ignore）');
  console.log('-'.repeat(64));
  console.log(`${'分组'.padEnd(26)}${'文件数'.padStart(8)}${'字节'.padStart(12)}`);
  for (const [name, entry] of rows) {
    console.log(`${name.padEnd(26)}${String(entry.files).padStart(8)}${String(entry.bytes).padStart(12)}`);
  }
  console.log('-'.repeat(64));
  console.log(`${'合计'.padEnd(26)}${String(totalFiles).padStart(8)}${String(totalBytes).padStart(12)}`);

  const ratio = totalBytes / HARD_LIMIT;
  console.log(`\n主包 ${formatBytes(totalBytes)} / 上限 ${formatBytes(HARD_LIMIT)}（${(ratio * 100).toFixed(1)}%）`);
  console.log(`预警线 ${formatBytes(args.budget)}`);

  if (totalBytes > HARD_LIMIT) {
    console.error(`\n✗ 超主包上限 ${formatBytes(totalBytes - HARD_LIMIT)}，必须减素材或改分包。`);
    process.exit(1);
  }
  if (totalBytes > args.budget) {
    console.error(`\n✗ 超过预警线 ${formatBytes(totalBytes - args.budget)}，加素材前先想清楚。`);
    process.exit(1);
  }
  console.log(`✓ 在预算内，余量 ${formatBytes(HARD_LIMIT - totalBytes)}。`);
}

main();
