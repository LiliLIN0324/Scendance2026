#!/usr/bin/env node
/**
 * 静态导出收尾：把 out/_internal-learning（OnePlan 版权参考图，仅本机 dev 报告页用）从产物里剥除。
 *
 * 背景：`frontend/public/_internal-learning/`（~170MB，44 张 OnePlan「Site plans we love」参考图）
 * 会被 `next build` 原样拷进 `out/`；不剥除的话每次部署都把版权图带上线，
 * 且该页在 dev-only 口径下本来就不该对外（页面本身对缺图有「参考图缺失」降级，不受影响）。
 */
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'out', '_internal-learning');

if (existsSync(target)) {
  rmSync(target, { recursive: true, force: true });
  console.log('[strip-internal-learning] 已从静态导出剥除 out/_internal-learning（版权参考图仅本机保留）');
} else {
  console.log('[strip-internal-learning] out/_internal-learning 不存在，无需剥除');
}
