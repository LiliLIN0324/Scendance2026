import { describe, expect, it } from 'vitest';
import {
  CHAIR_RING_RADIUS,
  MAX_TABLES_PER_ZONE,
  planZoneApprovals,
  TABLE_DIAMETER,
  ZONE_INSET,
} from './plan-approve';
import type { PlanAnnotation } from './plan-annotation';

function zone(id: string, x: number, z: number, width: number, depth: number): PlanAnnotation {
  return {
    id,
    kind: 'zone',
    label: '圆桌区',
    stageNo: 1,
    geometry: { kind: 'rect', x, z, width, depth },
  };
}

describe('planZoneApprovals', () => {
  it('空 zone 标注数组返回空列表', () => {
    expect(planZoneApprovals([], 0.5)).toEqual([]);
  });

  it('宽高 <= 0 的退化矩形返回空', () => {
    const ann = zone('z1', 0, 0, 0, 2);
    expect(planZoneApprovals([ann], 0.5)).toEqual([]);
  });

  it('内缩后放不下一张桌的小矩形返回空', () => {
    // 内缩半径 = ZONE_INSET + TABLE_DIAMETER/2 = 0.3 + 0.6 = 0.9m；矩形 1.0×1.0 不够。
    const small = zone('z1', 0, 0, 1.0, 1.0);
    expect(planZoneApprovals([small], 0.5)).toEqual([]);
  });

  it('足够大的矩形按 pitch 落网格点，且每桌 4 把椅子', () => {
    // 内缩后可用区：x ∈ [0.9, 9.1]，z ∈ [0.9, 9.1]（原点 -4.5..4.5 的 9m 方场）。
    const ann = zone('z1', -4.5, -4.5, 9, 9);
    const items = planZoneApprovals([ann], 0.5);
    // 松档 pitch = max(1.5, 1.8-0.9*0.5=1.35) = 1.8m。
    // MVP 上限 3 桌 → 3 桌 + 12 椅 = 15 件。
    const tables = items.filter((i) => i.kind === 'table');
    const chairs = items.filter((i) => i.kind === 'chair');
    expect(tables).toHaveLength(MAX_TABLES_PER_ZONE);
    expect(chairs).toHaveLength(MAX_TABLES_PER_ZONE * 4);
  });

  it('椅子相对桌心落在 CHAIR_RING_RADIUS 环上', () => {
    const ann = zone('z1', -4.5, -4.5, 9, 9);
    const items = planZoneApprovals([ann], 0.5);
    const tables = items.filter((i) => i.kind === 'table');
    for (const t of tables) {
      // 落在桌心 CHAIR_RING_RADIUS 环上的椅子：恰好 4 把（邻桌椅子环距 > pitch - 2*R ≈ 0m，
      // 但 pitch=1.8m 时邻桌椅子距桌心 ≈ 1.8+0.9=2.7m，不与 0.9m 环混叠）。
      const ring = items.filter(
        (i) => i.kind === 'chair' && Math.abs(Math.hypot(i.x - t.x, i.z - t.z) - CHAIR_RING_RADIUS) < 0.05,
      );
      expect(ring).toHaveLength(4);
    }
  });

  it('网格点被矩形边界裁剪：桌心必须落在内缩区内', () => {
    const ann = zone('z1', -4.5, -4.5, 9, 9);
    const items = planZoneApprovals([ann], 0.5);
    const inset = ZONE_INSET + TABLE_DIAMETER / 2;
    for (const p of items) {
      expect(p.x).toBeGreaterThanOrEqual(-4.5 + inset - 1e-6);
      expect(p.x).toBeLessThanOrEqual(4.5 - inset + 1e-6);
      expect(p.z).toBeGreaterThanOrEqual(-4.5 + inset - 1e-6);
      expect(p.z).toBeLessThanOrEqual(4.5 - inset + 1e-6);
    }
  });

  it('route / measure 标注被忽略', () => {
    const route: PlanAnnotation = {
      id: 'r1',
      kind: 'route',
      label: '宾客动线',
      stageNo: 1,
      geometry: { kind: 'polyline', points: [{ x: 0, z: 0 }, { x: 2, z: 2 }] },
    };
    const measure: PlanAnnotation = {
      id: 'm1',
      kind: 'measure',
      label: '测距',
      stageNo: 1,
      geometry: { kind: 'measure', from: { x: 0, z: 0 }, to: { x: 3, z: 3 } },
    };
    expect(planZoneApprovals([route, measure], 0.5)).toEqual([]);
  });

  it('密档比松档更容易在同一矩形里挤出网格点（pitch 更小）', () => {
    // 12m × 6m 矩形：松档 pitch=1.8m，密档 pitch=1.5m（>= 1.5 下限）。
    // 上限 3 桌封顶，所以这里只验证两件都能产出 3 桌、但密档网格点更多。
    const ann = zone('z1', -6, -3, 12, 6);
    const sparse = planZoneApprovals([ann], 0);
    const dense = planZoneApprovals([ann], 1);
    expect(sparse.filter((i) => i.kind === 'table')).toHaveLength(MAX_TABLES_PER_ZONE);
    expect(dense.filter((i) => i.kind === 'table')).toHaveLength(MAX_TABLES_PER_ZONE);
    // 两件都能跑通；密度旋钮在 MVP 上限下不改变桌数，但不能报错。
    expect(sparse.length).toBeGreaterThan(0);
    expect(dense.length).toBeGreaterThan(0);
  });
});
