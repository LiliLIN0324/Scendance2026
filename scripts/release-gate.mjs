#!/usr/bin/env node
// Release gate: one command for typecheck (root + frontend), core suites, and a production build.
// Usage: node scripts/release-gate.mjs [--full] [--skip-build]
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontend = resolve(root, 'frontend');
const args = new Set(process.argv.slice(2));

// 核心门禁套件：交付闭环 + 方案评分 + 地图锚点 + 人物路线 + 品牌 token。
// 全量测试用 --full；这里保持 1–2 分钟可跑完，适合每次提交前跑。
const CORE_TESTS = [
  'lib/plan-scoring.test.ts',
  'lib/plan-scoring-anti.test.ts',
  'lib/plan-approve.test.ts',
  'lib/plan-annotation.test.ts',
  'lib/flow-constraints.test.ts',
  'lib/door-privacy.test.ts',
  'components/room-organizer/lib/scene-delivery.test.ts',
  'components/room-organizer/lib/delivery-package-spec.test.ts',
  'components/room-organizer/lib/delivery-version.test.ts',
  'components/room-organizer/lib/delivery-package.test.ts',
  'components/room-organizer/lib/share.test.ts',
  'components/room-organizer/lib/scene-anchor.test.ts',
  'components/room-organizer/lib/schema.test.ts',
  'components/room-organizer/lib/person-route.test.ts',
  'components/room-organizer/lib/walk-collision.test.ts',
  'components/room-organizer/lib/geo-coords.test.ts',
  'components/room-organizer/three/people-anim.test.ts',
  'lib/brand-tokens.test.ts',
];

const steps = [
  { name: 'typecheck (root)', cwd: root, cmd: 'npx', argv: ['tsc', '--noEmit'] },
  { name: 'typecheck (frontend)', cwd: frontend, cmd: 'npx', argv: ['tsc', '--noEmit'] },
  args.has('--full')
    ? { name: 'tests (full)', cwd: frontend, cmd: 'npx', argv: ['vitest', 'run'] }
    : { name: 'tests (core)', cwd: frontend, cmd: 'npx', argv: ['vitest', 'run', ...CORE_TESTS] },
  ...(args.has('--skip-build') ? [] : [{
    name: 'build (static export)',
    cwd: frontend,
    cmd: 'npm',
    argv: ['run', 'build'],
    env: { NEXT_DIST_DIR: '.next-ci' },
  }]),
];

const missing = CORE_TESTS.filter(rel => !existsSync(resolve(frontend, rel)));
if (missing.length && !args.has('--full')) {
  console.error('[gate] 门禁套件清单里有不存在的文件：\n  ' + missing.join('\n  '));
  process.exit(2);
}

const bin = (name) => (process.platform === 'win32' ? `${name}.cmd` : name);
const startedAt = Date.now();

for (const [index, step] of steps.entries()) {
  const label = `[gate ${index + 1}/${steps.length}] ${step.name}`;
  console.log(`\n${label} …`);
  const t0 = Date.now();
  // 传单条命令行而不用 argv：Windows 下 .cmd 必须走 shell，argv+shell 会触发 DEP0190。
  const line = [bin(step.cmd), ...step.argv]
    .map(value => (/^[\w@./:=+-]+$/.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`))
    .join(' ');
  const result = spawnSync(line, {
    cwd: step.cwd,
    stdio: 'inherit',
    env: { ...process.env, ...(step.env ?? {}) },
    shell: true,
  });
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  if (result.status !== 0) {
    console.error(`\n${label} FAILED (exit ${result.status ?? result.signal ?? '?'}, ${seconds}s)`);
    process.exit(result.status ?? 1);
  }
  console.log(`${label} ok (${seconds}s)`);
}

console.log(`\n[gate] PASS — ${steps.length} steps in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
