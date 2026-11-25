// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { afterEach } from 'vitest';
import { PlanThumb } from './plan-thumb';
import { Minimap } from './minimap';
import type { ResolvedGround } from '../lib/plan-ground';
import { makeLayout } from '../lib/__testfixtures__/fixtures';

/** 把渲染器换成记录器：只关心「缩略图把 ground 交给渲染器了吗」。 */
const calls: Record<string, unknown>[] = [];
vi.mock('../canvas-2d/render', () => ({
  render2DTopDown: (options: Record<string, unknown>) => { calls.push(options); },
  addFloorPlanRepaintHandler: () => () => {},
}));

/** 迁移后形态：layout 已被停写字节，底图只剩在 plan.ground 里。 */
const GROUND: ResolvedGround = {
  image: 'data:image/png;base64,GROUND',
  opacity: 0.94,
  satelliteRef: true,
  polygon: undefined,
  center: undefined,
  frame: undefined,
  source: 'layout',
};

afterEach(() => {
  cleanup();
  calls.length = 0;
});

describe('PlanThumb 读贴地正源（S2 批 4）', () => {
  it('给了 ground 就交给渲染器；layout 没有字节也不再丢底图', () => {
    const layout = makeLayout({ width: 10, height: 8 });
    delete (layout as unknown as Record<string, unknown>).floorPlanImage;
    render(<PlanThumb layout={layout} ground={GROUND} width={180} height={130} showFloorPlan eager />);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ground).toBe(GROUND);
    expect((calls[0]!.layout as Record<string, unknown>).floorPlanImage).toBeUndefined();
  });

  it('不给 ground 时选项里没有这个键，与改前逐字等价', () => {
    const layout = makeLayout({ width: 10, height: 8 });
    render(<PlanThumb layout={layout} width={180} height={130} showFloorPlan eager />);
    expect(calls).toHaveLength(1);
    expect('ground' in calls[0]!).toBe(false);
  });

  it('小地图把 ground 原样递给缩略图（3D 视图那一块也读正源）', () => {
    const layout = makeLayout({ width: 10, height: 8 });
    render(<Minimap layout={layout} floor={layout.floors[0]!} selectedItemId={null} ground={GROUND} />);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ground).toBe(GROUND);
  });
});
