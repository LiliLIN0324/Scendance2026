import { describe, expect, it } from 'vitest';
import { planRingAreaM2 } from '../../../../supabase/functions/_shared/site-plan';
import { findZoneBoundsOverflow, pullRingIntoBounds, zoneOverflowReason } from './plan-zone-bounds';
import { zoneOutsideBoundaryIssue } from './site-plan-editing';

/** 40×40 的场地，左下角在原点。 */
const boundary = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 40, y: 40 },
  { x: 0, y: 40 },
];

/** 比场地大一圈的设计范围。 */
const scope = [
  { x: -20, y: -20 },
  { x: 60, y: -20 },
  { x: 60, y: 60 },
  { x: -20, y: 60 },
];

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const zone = (id: string, polygon: { x: number; y: number }[]) => ({ id, name: `分区${id}`, polygon });

const boundsOfPoints = (ring: readonly { x: number; y: number }[]) => ({
  minX: Math.min(...ring.map(p => p.x)),
  maxX: Math.max(...ring.map(p => p.x)),
  minY: Math.min(...ring.map(p => p.y)),
  maxY: Math.max(...ring.map(p => p.y)),
});

describe('分区越界判定', () => {
  it('完全在边界内就不报——贴边也不算越界', () => {
    const list = findZoneBoundsOverflow({ boundary, designScope: scope, zones: [zone('a', rect(0, 0, 10, 10))] });
    expect(list).toEqual([]);
  });

  it('一个顶点出了边界就报，并给得出收进结果', () => {
    const list = findZoneBoundsOverflow({ boundary, designScope: scope, zones: [zone('a', rect(35, 35, 10, 10))] });
    expect(list).toHaveLength(1);
    expect(list[0]!.outsideBoundary).toBe(true);
    expect(list[0]!.outsideScope).toBe(false);
    expect(list[0]!.pulled).not.toBeNull();
    expect(zoneOutsideBoundaryIssue(list[0]!.pulled!, boundary)).toBeNull();
  });

  it('在边界内但出了更小的设计范围，只报范围那一项', () => {
    const smallScope = rect(10, 10, 10, 10);
    const list = findZoneBoundsOverflow({
      boundary,
      designScope: smallScope,
      zones: [zone('a', rect(25, 25, 6, 6))],
    });
    expect(list).toHaveLength(1);
    expect(list[0]!.outsideBoundary).toBe(false);
    expect(list[0]!.outsideScope).toBe(true);
    expect(list[0]!.pulled).not.toBeNull();
    expect(zoneOutsideBoundaryIssue(list[0]!.pulled!, smallScope)).toBeNull();
  });

  it('边界/范围都没画时不判越界——没有基准就没有出界', () => {
    const list = findZoneBoundsOverflow({ boundary: [], designScope: [], zones: [zone('a', rect(200, 200, 10, 10))] });
    expect(list).toEqual([]);
  });

  it('多个越界分区按原顺序返回，名字带出来', () => {
    const list = findZoneBoundsOverflow({
      boundary,
      designScope: scope,
      zones: [zone('a', rect(38, 2, 8, 8)), zone('b', rect(2, 38, 8, 8)), zone('c', rect(2, 2, 5, 5))],
    });
    expect(list.map(z => z.zoneId)).toEqual(['a', 'b']);
  });
});

describe('一键收进', () => {
  it('小分区整体偏出去 → 平移收进，形状与面积都不变', () => {
    const original = rect(41, 10, 6, 5);
    const pulled = pullRingIntoBounds(original, boundary, scope)!;
    expect(pulled).not.toBeNull();
    expect(pulled.method).toBe('translate');
    expect(zoneOutsideBoundaryIssue(pulled.points, boundary)).toBeNull();
    expect(planRingAreaM2(pulled.points)).toBeCloseTo(planRingAreaM2(original), 4);
  });

  it('平移后是贴着内沿的（自动贴边），不是浮在中间', () => {
    const pulled = pullRingIntoBounds(rect(41, 10, 6, 5), boundary, scope)!;
    const bb = boundsOfPoints(pulled.points);
    // 只需要一条边贴住：右边刚好落在 x=40 上（容差给一个网格步长）。
    expect(Math.min(Math.abs(bb.maxX - 40), Math.abs(bb.minX - 0))).toBeLessThan(0.6);
  });

  it('尺寸优先：只缩刚够进去的那一点（8×44 → 缩到 ~44→40，不是缩成一团）', () => {
    const original = rect(10, -2, 8, 44);
    const pulled = pullRingIntoBounds(original, boundary, scope)!;
    expect(pulled.method).toBe('shrink');
    expect(zoneOutsideBoundaryIssue(pulled.points, boundary)).toBeNull();
    const ratio = planRingAreaM2(pulled.points) / planRingAreaM2(original);
    expect(ratio).toBeGreaterThan(0.75);
    // 而且贴边：上下两侧的剩余缝隙里至少一侧接近 0。
    const bb = boundsOfPoints(pulled.points);
    expect(Math.min(Math.abs(bb.minY - 0), Math.abs(bb.maxY - 40))).toBeLessThan(0.6);
  });

  it('分区比边界还大 → 按比例收缩，矩形还是矩形', () => {
    const huge = rect(-30, -30, 120, 120);
    const pulled = pullRingIntoBounds(huge, boundary, scope)!;
    expect(pulled.method).toBe('shrink');
    expect(zoneOutsideBoundaryIssue(pulled.points, boundary)).toBeNull();
    expect(planRingAreaM2(pulled.points)).toBeLessThan(planRingAreaM2(huge));
    // 保形：宽高比不变（120×120 缩完仍是正方形）
    const w = Math.abs(pulled.points[1]!.x - pulled.points[0]!.x);
    const h = Math.abs(pulled.points[3]!.y - pulled.points[0]!.y);
    expect(w / h).toBeCloseTo(1, 2);
  });

  it('已经在里面时原样返回，不乱动坐标', () => {
    const inside = rect(5, 5, 4, 4);
    const pulled = pullRingIntoBounds(inside, boundary, scope)!;
    expect(pulled.points).toEqual(inside);
  });

  it('收进结果要同时满足边界和设计范围（取交集）', () => {
    const smallScope = rect(10, 10, 10, 10);
    const pulled = pullRingIntoBounds(rect(0, 0, 14, 14), boundary, smallScope)!;
    expect(zoneOutsideBoundaryIssue(pulled.points, boundary)).toBeNull();
    expect(zoneOutsideBoundaryIssue(pulled.points, smallScope)).toBeNull();
  });

  it('少于 3 点的退化环不动（返回 null）', () => {
    expect(pullRingIntoBounds([{ x: 1, y: 1 }, { x: 2, y: 2 }], boundary, scope)).toBeNull();
  });
});

describe('越界原因文案', () => {
  const base = { zoneId: 'a', zoneName: 'A', pulled: null, pulledMethod: null } as const;
  it('两项都超时说两项', () => {
    expect(zoneOverflowReason({ ...base, outsideBoundary: true, outsideScope: true })).toBe('超出用地红线和设计范围');
  });
  it('只超边界', () => {
    expect(zoneOverflowReason({ ...base, outsideBoundary: true, outsideScope: false })).toBe('超出用地红线');
  });
  it('只超范围', () => {
    expect(zoneOverflowReason({ ...base, outsideBoundary: false, outsideScope: true })).toBe('超出设计范围');
  });
});
