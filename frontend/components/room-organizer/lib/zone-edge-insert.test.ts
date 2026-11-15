import { describe, expect, it } from 'vitest';
import { planRingAreaM2 } from '../../../../supabase/functions/_shared/site-plan';
import { insertRingVertex, PLAN_MIN_ZONE_AREA_M2, removeRingVertex } from './site-plan-editing';
import { nearestMergeTarget, nearestRingEdge } from './site-plan-snap';
import { planPointToPixel, type PlanViewport } from './outdoor-plan-canvas';

/**
 * 锁定画布里「点边中段加顶点」这条链的两步契约（2026-11-15 用户指令）：
 * 先用 nearestRingEdge 找出被点的是哪条边、投影点在哪，再用 insertRingVertex 插进去。
 * 组件里就是这两步，所以这里测它们拼起来的行为，避免两边口径漂移。
 */
/** 视口取 zoom 22（约 0.032 m/px，≈31 px/m）：接近实机编辑时的比例，
 *  否则 10 m 的方块只有 5 px，「12 px 就合并」会把整块当成同一个点。 */
const view: PlanViewport = { lng: 120.141306, lat: 30.2545, zoom: 22, canvasW: 1200, canvasH: 800 };

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

/** 把米制点换算成像素，模拟一次「点到某条边中间」（用组件同一套坐标换算，不另猜公式）。 */
function pxOf(point: { x: number; y: number }) {
  return planPointToPixel(point, view);
}

describe('分区边中段插点', () => {
  it('点在底边中间 → 命中第 0 条边，投影点落在中间', () => {
    const edge = nearestRingEdge(square, pxOf({ x: 5, y: 0 }), view)!;
    expect(edge).not.toBeNull();
    expect(edge.index).toBe(0);
    expect(edge.point.x).toBeCloseTo(5, 1);
    expect(edge.point.y).toBeCloseTo(0, 1);
  });

  it('插点后是 5 个顶点，形状不变、面积基本不变', () => {
    const edge = nearestRingEdge(square, pxOf({ x: 5, y: 0 }), view)!;
    const inserted = insertRingVertex(square, edge.index, edge.point, {
      minAreaM2: PLAN_MIN_ZONE_AREA_M2,
      label: '分区「舞台区 1」',
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    expect(inserted.value).toHaveLength(5);
    // 新点插在第 0 条边之后
    expect(inserted.value[1]!.x).toBeCloseTo(5, 1);
    expect(planRingAreaM2(inserted.value)).toBeCloseTo(planRingAreaM2(square), 6);
  });

  it('离边太远（超过命中半径）不算命中，靠调用方自己比 distPx', () => {
    const edge = nearestRingEdge(square, pxOf({ x: 5, y: 30 }), view)!;
    expect(edge.distPx).toBeGreaterThan(9);
  });
});

describe('分区顶点删除（点一下就删，两侧自动相连）', () => {
  const five = [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('删中间的共线顶点 → 回到 4 个点，面积不变（两侧顶点直接连上）', () => {
    const removed = removeRingVertex(five, 1, { minAreaM2: PLAN_MIN_ZONE_AREA_M2, label: '分区「舞台区 1」' });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.value).toHaveLength(4);
    expect(removed.value.map(p => [p.x, p.y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(planRingAreaM2(removed.value)).toBeCloseTo(planRingAreaM2(five), 6);
  });

  it('只剩 3 个点时删不动（分区至少 3 个顶点）', () => {
    const triangle = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    const removed = removeRingVertex(triangle, 0, { minAreaM2: PLAN_MIN_ZONE_AREA_M2, label: '分区「舞台区 1」' });
    expect(removed.ok).toBe(false);
    if (removed.ok) return;
    expect(removed.issue.message).toContain('分区');
  });
});

describe('拖动顶点靠近就被吞', () => {
  it('拖到邻居 12 px 内 → 命中那个邻居（合并目标）', () => {
    const target = nearestMergeTarget(square, 0, pxOf({ x: 10, y: 0 }), view);
    expect(target).toBe(1);
  });

  it('离得远就不吸（返回 null）', () => {
    expect(nearestMergeTarget(square, 0, pxOf({ x: 5, y: 5 }), view)).toBeNull();
  });

  it('不会把自己当成目标', () => {
    expect(nearestMergeTarget(square, 0, pxOf({ x: 0, y: 0 }), view)).toBeNull();
  });

  it('盘上的像素阈值真的生效：12 px 内吸、外不吸', () => {
    const base = pxOf({ x: 10, y: 0 });
    // 往左 6 px（≈0.19 m）还算近；往左 20 px 就不该吸了。
    expect(nearestMergeTarget(square, 0, { x: base.x - 6, y: base.y }, view)).toBe(1);
    expect(nearestMergeTarget(square, 0, { x: base.x - 20, y: base.y }, view)).toBeNull();
  });
});
