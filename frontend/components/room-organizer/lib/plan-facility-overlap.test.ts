import { describe, expect, it } from 'vitest';
import {
  PLAN_FACILITY_OVERLAP_DUPLICATE_RATIO,
  facilityOverlapPairs,
  footprintOverlapArea,
  mayStackFacilities,
} from './plan-facility-overlap';
import type { PlanFacility } from '../../../../supabase/functions/_shared/site-plan';

/**
 * 2026-11-20 审计 K7：物料压物料以前完全不报。
 * 这些用例锁三件事：贴边不算重叠、允许叠放的类别不报、几乎完全重合按「像重复摆放」升级。
 */
let seq = 0;
const facility = (
  name: string,
  position: { x: number; y: number },
  size = { width: 3, depth: 3 },
  templateId = 'oneplan:scale:tent',
  rotationDeg = 0,
): PlanFacility => {
  seq += 1;
  return {
    id: `f-${seq}`,
    templateId,
    name,
    position,
    rotationDeg,
    size,
    notes: '',
  } as PlanFacility;
};

describe('plan-facility-overlap · 重叠判定', () => {
  it('两顶完全叠在一起的帐篷：比例接近 1，标记为像重复摆放', () => {
    const pairs = facilityOverlapPairs([facility('帐篷 A', { x: 10, y: 10 }), facility('帐篷 B', { x: 10, y: 10 })]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.ratio).toBeGreaterThan(0.95);
    expect(pairs[0]!.nearDuplicate).toBe(true);
  });

  it('部分重叠：报出来，但不升级为重复', () => {
    const pairs = facilityOverlapPairs([facility('帐篷 A', { x: 10, y: 10 }), facility('帐篷 B', { x: 12, y: 10 })]);
    expect(pairs).toHaveLength(1);
    // 3×3 帐篷错 2 m：重叠约三成（扣掉 5 cm 容差后略低）。
    expect(pairs[0]!.ratio).toBeGreaterThan(0.25);
    expect(pairs[0]!.ratio).toBeLessThan(0.45);
    expect(pairs[0]!.nearDuplicate).toBe(false);
  });

  it('紧贴（中心距 = 边长）不算重叠', () => {
    expect(facilityOverlapPairs([facility('帐篷 A', { x: 10, y: 10 }), facility('帐篷 B', { x: 13, y: 10 })])).toHaveLength(0);
  });

  it('浅于 5 cm 的压边不算重叠', () => {
    const pairs = facilityOverlapPairs([facility('帐篷 A', { x: 10, y: 10 }), facility('帐篷 B', { x: 12.97, y: 10 })]);
    expect(pairs).toHaveLength(0);
  });

  it('允许叠放的类别不报：地毯铺在帐篷下、椅子收在桌下、隔离栏贴着设施', () => {
    expect(facilityOverlapPairs([
      facility('帐篷', { x: 10, y: 10 }),
      facility('活动地毯', { x: 10, y: 10 }, { width: 6, depth: 6 }, 'oneplan:icon:rug'),
    ])).toHaveLength(0);
    expect(facilityOverlapPairs([
      facility('长条桌', { x: 10, y: 10 }, { width: 2, depth: 1 }),
      facility('椅子', { x: 10, y: 10 }, { width: 0.6, depth: 0.6 }),
    ])).toHaveLength(0);
    expect(facilityOverlapPairs([
      facility('帐篷', { x: 10, y: 10 }),
      facility('隔离栏', { x: 10, y: 10 }, { width: 3, depth: 0.2 }, 'oneplan:icon:stanchion'),
    ])).toHaveLength(0);
  });

  it('允许叠放的判定是双向的关键词口径', () => {
    expect(mayStackFacilities({ templateId: 'oneplan:icon:rug', name: '地毯' }, { templateId: 'x', name: '展位' })).toBe(true);
    expect(mayStackFacilities({ templateId: 'x', name: '椅子' }, { templateId: 'y', name: '签到桌' })).toBe(true);
    expect(mayStackFacilities({ templateId: 'x', name: '椅子' }, { templateId: 'y', name: '椅子' })).toBe(false);
    expect(mayStackFacilities({ templateId: 'x', name: '展位' }, { templateId: 'y', name: '展位' })).toBe(false);
  });

  it('旋转 45° 的重叠也能算（凸裁剪，不是采样）', () => {
    const area = footprintOverlapArea(
      [
        { x: 8.5, y: 8.5 }, { x: 11.5, y: 8.5 }, { x: 11.5, y: 11.5 }, { x: 8.5, y: 11.5 },
      ],
      [
        { x: 10, y: 8 }, { x: 12, y: 10 }, { x: 10, y: 12 }, { x: 8, y: 10 },
      ],
    );
    // 3×3 方形与斜放的 2√2 正方形：交集为八边形，面积实测 7 m²。
    expect(area).toBeCloseTo(7, 1);
  });

  it('阈值可调：把 duplicateRatio 调低，同样两件会被当成重复', () => {
    const a = facility('帐篷 A', { x: 10, y: 10 });
    const b = facility('帐篷 B', { x: 12, y: 10 });
    expect(facilityOverlapPairs([a, b], { duplicateRatio: 0.3 })[0]!.nearDuplicate).toBe(true);
    expect(PLAN_FACILITY_OVERLAP_DUPLICATE_RATIO).toBe(0.8);
  });

  it('设施多时也只按网格候选比较（同一格才可能成对）', () => {
    const many: PlanFacility[] = [];
    for (let i = 0; i < 60; i += 1) many.push(facility(`帐篷 ${i}`, { x: i * 5, y: 0 }));
    // 全部相距 5 m、3 m 见方 → 没有任何重叠。
    expect(facilityOverlapPairs(many)).toHaveLength(0);
  });
});
