/**
 * M2 迁移纯函数层的共享坐标帧与小工具。
 *
 * 坐标口径复用 `plan-item-bridge` 的壳体 → 平面逆变换（z 南翻成 y 北，边界外接框两轴缩放）；
 * 供 `plan-layout-migration`（zone/worker/route）与 `plan-facility-migration`（facility）共同引用，
 * 避免两个执行器相互 import 形成循环依赖。
 */

import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import { planBoundaryBounds, planPointOfScene } from './plan-item-bridge';

/** 实体 id 生成器（与 plan-candidate 同口径；缺省走 crypto.randomUUID）。 */
export type MigrationUuidGen = () => string;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** 壳体 → 平面逆变换帧（与 `plan-item-bridge.shellToPlan` 同公式）。 */
export interface MigrationFrame {
  bounds: NonNullable<ReturnType<typeof planBoundaryBounds>> | null;
  scaleX: number;
  scaleZ: number;
}

export function makeFrame(boundary: readonly PlanPoint[], shellWidth: number, shellDepth: number): MigrationFrame {
  const bounds = planBoundaryBounds(boundary);
  const usable = bounds !== null
    && Number.isFinite(shellWidth) && Number.isFinite(shellDepth)
    && shellWidth >= 1 && shellDepth >= 1;
  if (!usable || bounds === null) return { bounds: null, scaleX: 1, scaleZ: 1 };
  return {
    bounds,
    scaleX: shellWidth / bounds.width,
    scaleZ: shellDepth / bounds.height,
  };
}

/** 壳体点（x 东、z 南）→ 平面点（x 东、y 北）；边界退化时退成直接翻轴。 */
export function framePoint(frame: MigrationFrame, x: number, z: number): PlanPoint {
  if (frame.bounds === null || !Number.isFinite(x) || !Number.isFinite(z)) return planPointOfScene(x, z);
  const { bounds, scaleX, scaleZ } = frame;
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, bounds.minX + x / scaleX)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, bounds.maxY - z / scaleZ)),
  };
}

export function hexOrUndefined(color: string | undefined): string | undefined {
  return color !== undefined && HEX_COLOR.test(color) ? color : undefined;
}
