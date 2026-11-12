import { describe, expect, it } from 'vitest';
import {
  facilityFootprintSpec,
  normalizeFacilitySize,
  normalizePlanFacilityFootprints,
  sizeWithDepth,
  sizeWithMajor,
  sizeWithWidth,
} from './facility-footprint-lock';
import { resolveFacilityModels } from './plan-facility-models';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

const BOUNDS = { minM: 0.5, maxM: 100 };

describe('facilityFootprintSpec（权威占地外廓）', () => {
  it('有真实 GLB 的模板：保留候选原始轴序，aspect=长边/短边、标记 hasModel', () => {
    const id = 'booth-2x2';
    const spec = facilityFootprintSpec(id);
    const model = resolveFacilityModels(id)[0]!;
    expect(spec.hasModel).toBe(true);
    expect(spec.width).toBeCloseTo(model.width, 6);
    expect(spec.depth).toBeCloseTo(model.depth, 6);
    expect(spec.aspect).toBeCloseTo(Math.max(model.width, model.depth) / Math.min(model.width, model.depth), 6);
    expect(spec.aspect).toBeGreaterThanOrEqual(1);
  });

  it('餐车 oneplan:scale:chuck-wagon 取首选箱货外廓，宽高比约 2.84', () => {
    const spec = facilityFootprintSpec('oneplan:scale:chuck-wagon');
    expect(spec.hasModel).toBe(true);
    expect(spec.aspect).toBeCloseTo(7.542 / 2.652, 2);
  });

  it('真机 id pack:fairs:chuck-wagon 在包清单未登记时仍命中箱货外廓（不误判 1:1）', () => {
    // 不调用 registerPackEntries，复现载入历史草稿时包索引为空的真机时序。
    const spec = facilityFootprintSpec('pack:fairs:chuck-wagon');
    expect(spec.hasModel).toBe(true);
    expect(spec.aspect).toBeCloseTo(7.542 / 2.652, 2);
  });

  it('完全未知 id 回落 misc 默认正方形，不抛错', () => {
    const spec = facilityFootprintSpec('totally-unknown-template-xyz');
    expect(spec.hasModel).toBe(false);
    expect(spec.aspect).toBeCloseTo(1, 6);
    expect(spec.width).toBe(spec.depth);
  });
});

describe('normalizeFacilitySize（历史自由比例吸附）', () => {
  it('餐车历史自由框：规模按长边保留，字段归到权威轴序（车长在 depth）', () => {
    const id = 'oneplan:scale:chuck-wagon';
    const spec = facilityFootprintSpec(id);
    const next = normalizeFacilitySize({ width: 5.6120307, depth: 3.0121111 }, id, BOUNDS);
    expect(next.depth).toBeCloseTo(5.6120307, 6); // 长边落 depth（权威轴序）
    expect(next.width).toBeCloseTo(5.6120307 / spec.aspect, 6);
    expect(Math.max(next.width, next.depth) / Math.min(next.width, next.depth)).toBeCloseTo(spec.aspect, 6);
    expect(next.depth).toBeGreaterThan(next.width); // 仍竖向（长轴沿 depth）
  });

  it('竖向框（depth>width）规整后保持竖向，长边长度不变', () => {
    const next = normalizeFacilitySize({ width: 2, depth: 5.612 }, 'oneplan:scale:chuck-wagon', BOUNDS);
    expect(next.depth).toBeCloseTo(5.612, 6);
    expect(next.depth).toBeGreaterThan(next.width);
    expect(next.depth / next.width).toBeCloseTo(facilityFootprintSpec('oneplan:scale:chuck-wagon').aspect, 6);
  });

  it('长边超界被夹到 max，短边随之等比（车长在 depth，故 depth=100）', () => {
    const next = normalizeFacilitySize({ width: 500, depth: 200 }, 'oneplan:scale:chuck-wagon', BOUNDS);
    expect(next.depth).toBe(100);
    expect(Math.max(next.width, next.depth) / Math.min(next.width, next.depth)).toBeCloseTo(facilityFootprintSpec('oneplan:scale:chuck-wagon').aspect, 6);
  });
});

describe('sizeWithWidth / sizeWithDepth / sizeWithMajor（面板等比联动）', () => {
  const id = 'oneplan:scale:chuck-wagon';

  it('改宽度，另一轴按比例联动，长边/短边比例恒定（车长在 depth）', () => {
    const base = { width: 2.652, depth: 7.542 }; // 权威原始轴序
    const next = sizeWithWidth(10, base, id, BOUNDS);
    expect(next.width).toBe(10);
    expect(Math.max(next.width, next.depth) / Math.min(next.width, next.depth)).toBeCloseTo(facilityFootprintSpec(id).aspect, 6);
  });

  it('改深度，另一轴按比例联动，比例恒定', () => {
    const base = { width: 2.652, depth: 7.542 };
    const next = sizeWithDepth(3, base, id, BOUNDS);
    expect(next.depth).toBe(3);
    expect(Math.max(next.width, next.depth) / Math.min(next.width, next.depth)).toBeCloseTo(facilityFootprintSpec(id).aspect, 6);
  });

  it('sizeWithMajor 以长边为锚等比缩放，保持权威轴序朝向', () => {
    const next = sizeWithMajor({ width: 2.652, depth: 7.542 }, 12, id, BOUNDS);
    expect(next.depth).toBe(12);
    expect(Math.max(next.width, next.depth) / Math.min(next.width, next.depth)).toBeCloseTo(facilityFootprintSpec(id).aspect, 6);
  });

  it('宽度低于下限时通过统一系数夹取，短边触 min 且不破比例', () => {
    const base = { width: 2.652, depth: 7.542 }; // 已规整，base 比例即权威 aspect
    const next = sizeWithWidth(0.1, base, id, BOUNDS);
    expect(next.width).toBe(0.5);
    expect(Math.max(next.width, next.depth) / Math.min(next.width, next.depth)).toBeCloseTo(facilityFootprintSpec(id).aspect, 6);
  });
});

describe('normalizePlanFacilityFootprints（载入存量自愈）', () => {
  const truckId = 'oneplan:scale:chuck-wagon';
  const makePlan = (facilities: SitePlanData['facilities']): SitePlanData => ({
    schemaVersion: 1,
    anchor: { lng: 120.1, lat: 30.2, crs: 'gcj-02', source: 'preset' },
    boundary: [],
    zones: [],
    facilities,
    routes: [],
    nodes: [],
    workers: [],
  });

  it('历史自由比例餐车被纠偏、中心/旋转不动，其余实体原样保留', () => {
    const plan = makePlan([
      {
        id: 'f1', templateId: truckId, name: '餐车', notes: '',
        position: { x: 3.8, y: 2.7 }, rotationDeg: 3.7,
        size: { width: 5.6120307, depth: 3.0121111 },
      },
    ]);
    const out = normalizePlanFacilityFootprints(plan);
    const f = out.facilities[0]!;
    expect(f.position).toEqual({ x: 3.8, y: 2.7 });
    expect(f.rotationDeg).toBe(3.7);
    expect(f.size.depth).toBeCloseTo(5.6120307, 6);
    expect(Math.max(f.size.width, f.size.depth) / Math.min(f.size.width, f.size.depth)).toBeCloseTo(facilityFootprintSpec(truckId).aspect, 6);
    // 非设施实体与信封字段保留。
    expect(out.anchor).toEqual(plan.anchor);
    expect(out.schemaVersion).toBe(1);
  });

  it('幂等：对已合规计划二次规整结果深度相等', () => {
    const plan = makePlan([
      {
        id: 'f2', templateId: 'booth-2x2', name: '摊位', notes: '',
        position: { x: 0, y: 0 }, rotationDeg: 0,
        size: { width: 2, depth: 2 },
      },
    ]);
    const once = normalizePlanFacilityFootprints(plan);
    const twice = normalizePlanFacilityFootprints(once);
    expect(twice).toEqual(once);
  });

  it('空设施计划安全透传', () => {
    const plan = makePlan([]);
    expect(normalizePlanFacilityFootprints(plan).facilities).toEqual([]);
  });
});

describe('对抗性不变量：任何畸形输入都收敛为「界内 + 严格等比」', () => {
  const truck = 'oneplan:scale:chuck-wagon';
  // 不同 kind 的代表性模板，证明比例取自各自外廓而非写死餐车。
  const kinds = ['oneplan:scale:chuck-wagon', 'booth-2x2', 'marquee-5x5', 'main-stage-deck', 'wc-block'];
  const hostileSizes = [
    { width: 0, depth: 0 },
    { width: -12, depth: -3 },
    { width: 0.0001, depth: 9999 },
    { width: 9999, depth: 0.0001 },
    { width: 1e9, depth: 1e-9 },
    { width: Number.POSITIVE_INFINITY, depth: Number.POSITIVE_INFINITY },
    { width: Number.NaN, depth: 2.6 },
    { width: 5.6, depth: Number.NaN },
    { width: Number.NaN, depth: Number.NaN },
  ];

  it('normalizeFacilitySize 对全部畸形输入输出有限、在界内、比例严格等于权威 aspect', () => {
    for (const id of kinds) {
      const aspect = facilityFootprintSpec(id).aspect;
      expect(Number.isFinite(aspect) && aspect >= 1).toBe(true);
      for (const bad of hostileSizes) {
        const out = normalizeFacilitySize({ ...bad }, id, BOUNDS);
        expect(Number.isFinite(out.width), `${id} width finite`).toBe(true);
        expect(Number.isFinite(out.depth), `${id} depth finite`).toBe(true);
        expect(out.width).toBeGreaterThanOrEqual(BOUNDS.minM - 1e-9);
        expect(out.depth).toBeGreaterThanOrEqual(BOUNDS.minM - 1e-9);
        expect(out.width).toBeLessThanOrEqual(BOUNDS.maxM + 1e-9);
        expect(out.depth).toBeLessThanOrEqual(BOUNDS.maxM + 1e-9);
        // 边长比（不分横竖）严格等于权威 aspect；朝向由谁长谁短单独承载。
        expect(Math.max(out.width, out.depth) / Math.min(out.width, out.depth)).toBeCloseTo(aspect, 6);
      }
    }
  });

  it('面板等比联动对 NaN/Infinity/负数目标值不炸、退回界内等比尺寸', () => {
    const base = { width: 2.652, depth: 7.542 };
    for (const target of [Number.NaN, Number.POSITIVE_INFINITY, -100, 0]) {
      const out = sizeWithWidth(target, base, truck, BOUNDS);
      expect(Number.isFinite(out.width) && Number.isFinite(out.depth)).toBe(true);
      expect(out.width).toBeGreaterThanOrEqual(BOUNDS.minM - 1e-9);
      expect(out.depth).toBeGreaterThanOrEqual(BOUNDS.minM - 1e-9);
      expect(out.width).toBeLessThanOrEqual(BOUNDS.maxM + 1e-9);
      expect(Math.max(out.width, out.depth) / Math.min(out.width, out.depth)).toBeCloseTo(
        facilityFootprintSpec(truck).aspect,
        6,
      );
    }
  });

  it('连续 100 次规整完全幂等，无浮点漂移（中心点由调用方保持，这里只验尺寸）', () => {
    let size = { width: 5.6120307, depth: 3.0121111 };
    let prev = normalizeFacilitySize(size, truck, BOUNDS);
    for (let i = 0; i < 100; i++) {
      const cur = normalizeFacilitySize(prev, truck, BOUNDS);
      expect(cur.width).toBeCloseTo(prev.width, 12);
      expect(cur.depth).toBeCloseTo(prev.depth, 12);
      prev = cur;
    }
  });

  it('不同种类物件的权威比例彼此不同且都 ≥1，没有被单一比例写死', () => {
    const aspects = kinds.map((id) => facilityFootprintSpec(id).aspect);
    aspects.forEach((a) => expect(a).toBeGreaterThanOrEqual(1));
    expect(new Set(aspects.map((a) => a.toFixed(3))).size).toBeGreaterThan(1);
  });
});
