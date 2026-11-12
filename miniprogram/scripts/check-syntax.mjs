#!/usr/bin/env node
/**
 * 小程序 JS 语法体检（node --check 逐文件）。
 *
 * 为什么要有：小程序没有编译期类型检查，语法错只在开发者工具里报一句
 * “Component is not found” 之类的运行时错；截图/冒烟脚本又只在装了
 * 开发者工具的机器上能跑。node --check 零依赖、跨平台，适合进 CI 当第一道闸。
 *
 * 范围：miniprogram/ 下我们自己写的 .js。
 * 排除：
 *   - scripts/：.mjs 用 ESM，node --check 按 CJS 解析会误报，交给各自运行；
 *   - miniprogram_npm/：TDesign 的构建产物，本身是 ESM（import/export），
 *     node --check 按 CJS 解析会误报 80 个文件；它是 vendored 代码，
 *     真正的编译校验由微信开发者工具负责（见 verify-devtools.mjs）。
 *
 * 退出码：0 = 全部通过；1 = 有文件语法错。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MINI_ROOT = path.resolve(here, '..');
const SKIP_DIRS = new Set(['node_modules', 'scripts', 'miniprogram_npm']);

function collect(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collect(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** 只留报错的关键行，别把整个文件内容糊在日志里。 */
function firstLines(text, count = 6) {
  return String(text || '')
    .split('\n')
    .filter(line => line.trim() && !line.includes('Warning:') && !line.includes('trace-warnings'))
    .slice(0, count)
    .join('\n');
}

function main() {
  const files = collect(MINI_ROOT, []);
  const failures = [];
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      failures.push({ file: path.relative(MINI_ROOT, file), message: firstLines(result.stderr) });
    }
  }

  console.log(`[check-syntax] 扫了 ${files.length} 个 .js 文件`);
  if (!failures.length) {
    console.log('[check-syntax] 全部通过');
    return;
  }
  for (const failure of failures) {
    console.error(`\n✗ ${failure.file}\n${failure.message}`);
  }
  console.error(`\n[check-syntax] ${failures.length} 个文件语法错`);
  process.exit(1);
}

main();
