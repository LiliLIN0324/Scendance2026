import { describe, expect, it } from 'vitest';
import {
  CHAIR_RING_RADIUS,
  MAX_TABLES_PER_ZONE,
  planZoneApprovals,
  planZones,
  TABLE_DIAMETER,
  ZONE_INSET,
} from './plan-approve';
import type { PlanAnnotation, ZoneSemanticType } from './plan-annotation';

function zone(
  id: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  zoneType?: ZoneSemanticType,
  label = '圆桌区',
): PlanAnnotation {
  return {
    id,
    kind: 'zone',
    label,
    stageNo: 1,
    geometry: { kind: 'rect', x, z, width, depth },
    ...(zoneType ? { zoneType } : {}),
  };
}

const isTable = (p: { spec: { type: string } }) => p.spec.type === 'dining-table';
const isChair = (p: { spec: { type: string } }) => p.spec.type === 'dining-chair';

describe('planZoneApprovals / planZones', () => {
  it('空 zone 标注数组返回空列表', () => {
    expect(planZoneApprovals([], 0.5)).toEqual([]);
    expect(planZones([], 0.5).placements).toEqual([]);
  });

  it('宽高 <= 0 的退化矩形：placement 空，skipped 给原因', () => {
    const ann = zone('z1', 0, 0, 0, 2);
    const out = planZones([ann], 0.5);
    expect(out.placements).toEqual([]);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0].reason).toContain('画得太小');
  });

  it('内缩后放不下一张桌的小矩形按圆桌配方跳过', () => {
    const small = zone('z1', 0, 0, 1.0, 1.0);
    const out = planZones([small], 0.5);
    expect(out.placements).toEqual([]);
    expect(out.skipped[0].reason).toContain('圆桌区');
  });

  it('足够大的矩形按 pitch 落网格点，且每桌 4 把椅子', () => {
    const ann = zone('z1', -4.5, -4.5, 9, 9);
    const items = planZoneApprovals([ann], 0.5);
    expect(items.filter(isTable)).toHaveLength(MAX_TABLES_PER_ZONE);
    expect(items.filter(isChair)).toHaveLength(MAX_TABLES_PER_ZONE * 4);
  });

  it('椅子相对桌心落在 CHAIR_RING_RADIUS 环上', () => {
    const ann = zone('z1', -4.5, -4.5, 9, 9);
    const items = planZoneApprovals([ann], 0.5);
    for (const t of items.filter(isTable)) {
      const ring = items.filter(
        (i) => isChair(i) && Math.abs(Math.hypot(i.x - t.x, i.z - t.z) - CHAIR_RING_RADIUS) < 0.05,
      );
      expect(ring).toHaveLength(4);
    }
  });

  it('网格点被矩形边界裁剪：桌心必须落在内缩区内', () => {
    const ann = zone('z1', -4.5, -4.5, 9, 9);
    const inset = ZONE_INSET + TABLE_DIAMETER / 2;
    for (const p of planZoneApprovals([ann], 0.5)) {
      if (!isTable(p)) continue;
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

  it('密度旋钮不报错（密档 pitch 更小）', () => {
    const ann = zone('z1', -6, -3, 12, 6);
    const sparse = planZoneApprovals([ann], 0);
    const dense = planZoneApprovals([ann], 1);
    expect(sparse.filter(isTable)).toHaveLength(MAX_TABLES_PER_ZONE);
    expect(dense.filter(isTable)).toHaveLength(MAX_TABLES_PER_ZONE);
  });

  // ---- 第 11 批：四种语义 zone ----

  it('签到区：一字排开签到台，每台配一把工作椅', () => {
    const ann = zone('c1', 0, 0, 6, 2, 'checkin', '签到区');
    const out = planZones([ann], 0.5);
    expect(out.skipped).toEqual([]);
    const desks = out.placements.filter((p) => p.spec.name === '签到台');
    const chairs = out.placements.filter((p) => p.spec.name === '工作椅');
    // 6m 可用 ≈ 5.4m / 1.8m → 3 台
    expect(desks.length).toBeGreaterThanOrEqual(2);
    expect(desks).toHaveLength(chairs.length);
    // 椅子在桌子后面（z 更大）
    for (let i = 0; i < desks.length; i++) {
      expect(chairs[i].z).toBeGreaterThan(desks[i].z);
    }
  });

  it('签到区太小被跳过并说人话', () => {
    const out = planZones([zone('c1', 0, 0, 1, 1, 'checkin')], 0.5);
    expect(out.placements).toEqual([]);
    expect(out.skipped[0].reason).toContain('签到区');
  });

  it('打卡区：一面背景墙 + 两盆绿植，前方留空', () => {
    const ann = zone('p1', 0, 0, 4, 3, 'photo', '打卡区');
    const out = planZones([ann], 0.5);
    expect(out.skipped).toEqual([]);
    expect(out.placements.filter((p) => p.spec.name === '打卡背景墙')).toHaveLength(1);
    expect(out.placements.filter((p) => p.spec.name === '绿植')).toHaveLength(2);
    // 只落 3 件，不往人站立的空地里塞家具
    expect(out.placements).toHaveLength(3);
  });

  it('打卡区太窄被跳过并说人话', () => {
    const out = planZones([zone('p1', 0, 0, 1, 1, 'photo')], 0.5);
    expect(out.placements).toEqual([]);
    expect(out.skipped[0].reason).toContain('打卡区');
  });

  it('休息区：两排长椅对坐、中间留通道', () => {
    const ann = zone('r1', 0, 0, 5, 3, 'rest', '休息区');
    const out = planZones([ann], 0.5);
    expect(out.skipped).toEqual([]);
    const benches = out.placements.filter((p) => p.spec.name === '长椅');
    // 5m → 两排 × 每排 2 张 = 4 张
    expect(benches.length).toBeGreaterThanOrEqual(2);
    expect(benches.length % 2).toBe(0);
  });

  it('休息区太浅被跳过并说人话', () => {
    const out = planZones([zone('r1', 0, 0, 5, 1, 'rest')], 0.5);
    expect(out.placements).toEqual([]);
    expect(out.skipped[0].reason).toContain('休息区');
  });

  it('混合多区：placement 带对的 zoneType，skipped 逐区罗列', () => {
    const out = planZones(
      [
        zone('a', -4.5, -4.5, 9, 9),
        zone('b', 0, 0, 1, 1, 'checkin', '签到区'),
        zone('c', 0, 0, 4, 3, 'photo', '打卡区'),
      ],
      0.5,
    );
    const types = new Set(out.placements.map((p) => p.zoneType));
    expect(types).toEqual(new Set(['roundtable', 'photo']));
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0].zoneId).toBe('b');
  });

  // ---- 第 12 批：对抗用例 A / G / 未知类型降级 ----

  it('A. 极小签到区 0.8×0.6m → skipped 含「太小」或「签到区」', () => {
    const out = planZones([zone('tiny', 0, 0, 0.8, 0.6, 'checkin', '迷你签到')], 0.5);
    expect(out.placements).toEqual([]);
    expect(out.skipped.length).toBeGreaterThanOrEqual(1);
    const joined = out.skipped.map((s) => s.reason).join('\n');
    expect(joined).toMatch(/太小|签到区/);
  });

  it('G. 4 类 zone 混合（roundtable+checkin+photo+rest）→ planZones 不崩，每类都有产出或各自 skipped', () => {
    const out = planZones(
      [
        zone('r', -8, -3, 4, 4, 'roundtable', '圆桌区'),
        zone('c', -2, -3, 4, 2, 'checkin', '签到区'),
        zone('p',  3, -3, 4, 3, 'photo', '打卡区'),
        zone('s', -2,  1, 5, 3, 'rest', '休息区'),
      ],
      0.5,
    );
    // 不崩就行；每类要么有 placements 要么在 skipped 里出现。
    const seenZoneTypes = new Set(out.placements.map((p) => p.zoneType));
    const seenSkippedIds = new Set(out.skipped.map((s) => s.zoneId));
    const expected = ['r', 'c', 'p', 's'];
    for (const id of expected) {
      const hasPlacement = [...seenZoneTypes].length > 0 && out.placements.some((p) => p.zoneId === id);
      const isSkipped = seenSkippedIds.has(id);
      expect(hasPlacement || isSkipped).toBe(true);
    }
  });

  it('未知 zoneType（如 "storage"）→ 不摆任何家具，skipped 含「未知」或「通用」', () => {
    // 用类型断言注入一个 4 类之外的字符串，模拟未来扩展或外部非法值。
    const unknownZone = {
      ...zone('x', 0, 0, 5, 4),
      zoneType: 'storage' as unknown as ZoneSemanticType,
    };
    const out = planZones([unknownZone], 0.5);
    expect(out.placements).toEqual([]);
    expect(out.skipped.length).toBe(1);
    expect(out.skipped[0].zoneId).toBe('x');
    expect(out.skipped[0].reason).toMatch(/未知|通用/);
  });
});
