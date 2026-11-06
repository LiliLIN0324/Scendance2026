#!/usr/bin/env node
/** 用 esbuild 打包并运行一个 TypeScript 入口。
 *
 * 为什么需要它：仓库脚本原本靠 `node --experimental-transform-types` 跑 TS，
 * 但该 flag 在 Node 26 已被移除（`node --help` 里查不到），本机就跑不起来；
 * 而 TypeScript 参数属性（`constructor(public code: string)`）又不在 strip-only 模式下可用。
 * esbuild 是 vitest 自带的依赖，不新增依赖即可把 TS 打成纯 JS 再交给 node 执行。
 *
 * 用法：node scripts/run-ts.mjs scripts/local-agent-run.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = process.argv[2];
if (!entry) {
  console.error('用法：node scripts/run-ts.mjs <entry.ts>');
  process.exit(2);
}

let esbuild;
const require = createRequire(import.meta.url);
for (const candidate of ['esbuild', '../frontend/node_modules/esbuild']) {
  // 用 CJS 解析：esbuild 没有 exports 字段，ESM 的目录解析不认 "main"。
  try { esbuild = require(candidate); break; } catch { /* 换下一个候选路径 */ }
}
if (!esbuild) {
  console.error('找不到 esbuild：请先在 frontend 目录安装依赖（npm --prefix frontend ci）。');
  process.exit(1);
}

// bundle 必须落在仓库根目录下面：仓库代码里用 `new URL('../supabase/migrations/', import.meta.url)`
// 这类相对定位，挪到系统临时目录会指错；同时 node 才能从仓库的 node_modules 解析外部包。
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const directory = mkdtempSync(join(repositoryRoot, '.run-ts-'));
const output = join(directory, 'bundle.mjs');
try {
  // npm 包保持外部引用（运行时从 node_modules 解析），只打包仓库内的相对路径。
  await esbuild.build({
    entryPoints: [resolve(entry)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outfile: output,
    logLevel: 'warning',
  });
  const result = spawnSync(process.execPath, [output], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
