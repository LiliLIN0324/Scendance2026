// @vitest-environment node
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStarterOutdoorPlan } from './outdoor-project-store';
import {
  applyFacilityAction,
  applyZoneAction,
  type FacilityAddInput,
  type FacilityPatch,
  type ZonePatch,
} from './plan-facility-actions';
import type { PlanPoint, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

const rect = (x0: number, y0: number, w: number, h: number): PlanPoint[] => [
  { x: x0, y: y0 },
  { x: x0 + w, y: y0 },
  { x: x0 + w, y: y0 + h },
  { x: x0, y: y0 + h },
];

function freshPlan(): SitePlanData {
  return structuredClone(createStarterOutdoorPlan());
}

function addBooth(plan: SitePlanData, position: PlanPoint, extra?: Partial<FacilityAddInput>) {
  const result = applyFacilityAction(plan, {
    kind: 'add',
    input: { templateId: 'booth-2x2', position, ...extra },
  });
  if (!result.ok) throw new Error(result.issue.message);
  return { plan: result.value, facility: result.value.facilities[result.value.facilities.length - 1]! };
}

function addZone(plan: SitePlanData, polygon: PlanPoint[], name = '签到区') {
  const result = applyZoneAction(plan, {
    kind: 'add',
    input: { semantic: 'checkin', name, polygon },
  });
  if (!result.ok) throw new Error(result.issue.message);
  return { plan: result.value, zone: result.value.zones[0]! };
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('facility CRUD（B-1 plan 写入口）', () => {
  it('add：落一件设施，生成 uuid，尺寸取模板，入参 plan 不被 mutate', () => {
    const plan = freshPlan();
    const before = JSON.stringify(plan);
    const result = applyFacilityAction(plan, {
      kind: 'add',
      input: { templateId: 'booth-2x2', position: { x: 5, y: 6 } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.facilities).toHaveLength(1);
    const facility = result.value.facilities[0]!;
    expect(facility.id).toBeTruthy();
    expect(facility.templateId).toBe('booth-2x2');
    expect(facility.position).toEqual({ x: 5, y: 6 });
    expect(facility.size).toEqual({ width: 2, depth: 2 });
    expect(facility.rotationDeg).toBe(0);
    expect(JSON.stringify(plan)).toBe(before);
  });

  it('add：未知模板 / 越界坐标拒收，plan 原样', () => {
    const plan = freshPlan();
    const badTemplate = applyFacilityAction(plan, {
      kind: 'add',
      input: { templateId: 'no-such-template', position: { x: 1, y: 1 } },
    });
    expect(badTemplate.ok).toBe(false);
    if (!badTemplate.ok) expect(badTemplate.issue.code).toBe('unknown-template');

    const outOfRange = applyFacilityAction(plan, {
      kind: 'add',
      input: { templateId: 'booth-2x2', position: { x: 6000, y: 1 } },
    });
    expect(outOfRange.ok).toBe(false);
    if (!outOfRange.ok) expect(outOfRange.issue.code).toBe('out-of-range');
    expect(plan.facilities).toHaveLength(0);
  });

  it('add：归属分区不存在时拒收', () => {
    const plan = freshPlan();
    const result = applyFacilityAction(plan, {
      kind: 'add',
      input: { templateId: 'booth-2x2', position: { x: 1, y: 1 }, zoneId: 'missing-zone' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe('unknown-zone');
  });

  it('add：动态模板落件，尺寸/名称取条目，templateId 保留条目 id', () => {
    const plan = freshPlan();
    const result = applyFacilityAction(plan, {
      kind: 'add',
      input: {
        templateId: 'oneplan:scale:chair',
        position: { x: 5, y: 6 },
        template: { name: '折叠椅', width: 0.6, depth: 0.6, note: '物料库模型' },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facility = result.value.facilities[0]!;
    expect(facility.templateId).toBe('oneplan:scale:chair');
    expect(facility.name).toBe('折叠椅');
    expect(facility.size).toEqual({ width: 0.6, depth: 0.6 });
  });

  it('add：动态模板宽深非法拒收，plan 原样', () => {
    const plan = freshPlan();
    const zero = applyFacilityAction(plan, {
      kind: 'add',
      input: {
        templateId: 'web:1-abc',
        position: { x: 1, y: 1 },
        template: { name: '挂件', width: 0, depth: 1 },
      },
    });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.issue.code).toBe('out-of-range');

    const tooBig = applyFacilityAction(plan, {
      kind: 'add',
      input: {
        templateId: 'web:1-abc',
        position: { x: 1, y: 1 },
        template: { name: '挂件', width: 101, depth: 1 },
      },
    });
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.issue.code).toBe('out-of-range');
    expect(plan.facilities).toHaveLength(0);
  });

  it('add：内置模板无动态槽时尺寸仍取模板目录', () => {
    const plan = freshPlan();
    const result = applyFacilityAction(plan, {
      kind: 'add',
      input: { templateId: 'toilet-2.4x1.2', position: { x: 2, y: 2 } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.facilities[0]!.size).toEqual({ width: 2.4, depth: 1.2 });
  });

  it('remove：按 id 删除；未知 id 返回 not-found 且 plan 不变', () => {
    const seeded = addBooth(freshPlan(), { x: 3, y: 3 });
    const removed = applyFacilityAction(seeded.plan, { kind: 'remove', id: seeded.facility.id });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.value.facilities).toHaveLength(0);

    const missing = applyFacilityAction(seeded.plan, { kind: 'remove', id: 'nope' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.issue.code).toBe('not-found');
    expect(seeded.plan.facilities).toHaveLength(1);
  });

  it('update：白名单字段逐项写入，原件不被 mutate', () => {
    const seeded = addBooth(freshPlan(), { x: 4, y: 4 });
    const patch: FacilityPatch = {
      name: '主签到台',
      color: '#336699',
      opacity: 0.8,
      notes: '靠近入口',
      unitPrice: 1200,
      heightM: 1.1,
      shape: 'rect',
      finish: 'linen',
    };
    const result = applyFacilityAction(seeded.plan, { kind: 'update', id: seeded.facility.id, patch });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.value.facilities[0]!;
    expect(next.name).toBe('主签到台');
    expect(next.color).toBe('#336699');
    expect(next.opacity).toBe(0.8);
    expect(next.notes).toBe('靠近入口');
    expect(next.unitPrice).toBe(1200);
    expect(next.heightM).toBe(1.1);
    expect(next.shape).toBe('rect');
    expect(next.finish).toBe('linen');
    expect(seeded.facility.name).toBeTruthy();
    expect(seeded.facility).not.toHaveProperty('unitPrice');
  });

  it('update：白名单外字段被剥离，记 unknown-field，不进 facility', () => {
    const seeded = addBooth(freshPlan(), { x: 4, y: 4 });
    const patch = {
      wallId: 'wall-1',
      structuralOpeningId: 'op-1',
      elevation: 0.5,
      mirrored: true,
      stairsShape: 'straight',
      sillHeight: 0.9,
      personAction: 'wave',
      walkRoute: 'r1',
      isCCTV: true,
      visionRange: 20,
      category: 'booth',
      handoff: { ref: 'x' },
    } as unknown as FacilityPatch;
    const result = applyFacilityAction(seeded.plan, { kind: 'update', id: seeded.facility.id, patch });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.value.facilities[0]!;
    for (const banned of ['wallId', 'structuralOpeningId', 'elevation', 'mirrored', 'stairsShape', 'sillHeight', 'personAction', 'walkRoute', 'isCCTV', 'visionRange', 'category', 'handoff']) {
      expect(next).not.toHaveProperty(banned);
    }
    expect(result.issues?.some(i => i.code === 'unknown-field')).toBe(true);
  });

  it('update：非法尺寸 / 角度 / 透明度 / 颜色拒收', () => {
    const seeded = addBooth(freshPlan(), { x: 4, y: 4 });
    const badSize = applyFacilityAction(seeded.plan, {
      kind: 'update',
      id: seeded.facility.id,
      patch: { size: { width: -2, depth: 2 } },
    });
    expect(badSize.ok).toBe(false);
    if (!badSize.ok) expect(badSize.issue.code).toBe('out-of-range');

    const badOpacity = applyFacilityAction(seeded.plan, {
      kind: 'update',
      id: seeded.facility.id,
      patch: { opacity: 1.5 },
    });
    expect(badOpacity.ok).toBe(false);

    const badColor = applyFacilityAction(seeded.plan, {
      kind: 'update',
      id: seeded.facility.id,
      patch: { color: 'green' },
    });
    expect(badColor.ok).toBe(false);
  });

  it('move：换位置；越界坐标拒收', () => {
    const seeded = addBooth(freshPlan(), { x: 4, y: 4 });
    const moved = applyFacilityAction(seeded.plan, { kind: 'move', id: seeded.facility.id, position: { x: 9, y: 10 } });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.facilities[0]!.position).toEqual({ x: 9, y: 10 });

    const outOfRange = applyFacilityAction(seeded.plan, { kind: 'move', id: seeded.facility.id, position: { x: 0, y: 9000 } });
    expect(outOfRange.ok).toBe(false);
    if (!outOfRange.ok) expect(outOfRange.issue.code).toBe('out-of-range');
  });

  it('rotate：写绝对角度并夹到 -360..360；非有限值拒收', () => {
    const seeded = addBooth(freshPlan(), { x: 4, y: 4 });
    const rotated = applyFacilityAction(seeded.plan, { kind: 'rotate', id: seeded.facility.id, rotationDeg: 400 });
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    expect(rotated.value.facilities[0]!.rotationDeg).toBe(360);

    const invalid = applyFacilityAction(seeded.plan, { kind: 'rotate', id: seeded.facility.id, rotationDeg: Number.NaN });
    expect(invalid.ok).toBe(false);
  });

  it('resize：宽深写入；非正数 / 超 100 m 拒收', () => {
    const seeded = addBooth(freshPlan(), { x: 4, y: 4 });
    const resized = applyFacilityAction(seeded.plan, { kind: 'resize', id: seeded.facility.id, size: { width: 3, depth: 2.5 } });
    expect(resized.ok).toBe(true);
    if (!resized.ok) return;
    expect(resized.value.facilities[0]!.size).toEqual({ width: 3, depth: 2.5 });

    const tooBig = applyFacilityAction(seeded.plan, { kind: 'resize', id: seeded.facility.id, size: { width: 120, depth: 2 } });
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.issue.code).toBe('out-of-range');
  });

  it('duplicate：新 uuid、+0.5m 偏移；原件不动；副本剥离 groupId/locked', () => {
    let seeded = addBooth(freshPlan(), { x: 4, y: 4 });
    const grouped = applyFacilityAction(seeded.plan, {
      kind: 'update',
      id: seeded.facility.id,
      patch: { groupId: 'g1', locked: true },
    });
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    seeded = { plan: grouped.value, facility: grouped.value.facilities[0]! };

    const copy = applyFacilityAction(seeded.plan, { kind: 'duplicate', id: seeded.facility.id });
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    expect(copy.value.facilities).toHaveLength(2);
    const [source, made] = copy.value.facilities;
    expect(made.id).not.toBe(source.id);
    expect(made.position).toEqual({ x: 4.5, y: 4.5 });
    expect(made.groupId).toBeUndefined();
    expect(made.locked).toBeUndefined();
    expect(source.groupId).toBe('g1');
    expect(source.locked).toBe(true);
  });

  it('setGroup：两件落同一新分组号；孤件不落组；clearGroup 剥离分组', () => {
    const first = addBooth(freshPlan(), { x: 2, y: 2 });
    const second = addBooth(first.plan, { x: 6, y: 6 });
    const grouped = applyFacilityAction(second.plan, { kind: 'setGroup', ids: [first.facility.id, second.facility.id] });
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    const groupId = grouped.value.facilities[0]!.groupId;
    expect(groupId).toBeTruthy();
    expect(grouped.value.facilities[1]!.groupId).toBe(groupId);

    const lone = applyFacilityAction(second.plan, { kind: 'setGroup', ids: [first.facility.id] });
    expect(lone.ok).toBe(true);
    if (!lone.ok) return;
    expect(lone.value.facilities[0]!.groupId).toBeUndefined();

    const cleared = applyFacilityAction(grouped.value, { kind: 'clearGroup', ids: [first.facility.id, second.facility.id] });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.value.facilities.every(f => f.groupId === undefined)).toBe(true);
  });

  it('setLocked / setShape / setFinish：单件标记写入；未知 id 拒收', () => {
    const seeded = addBooth(freshPlan(), { x: 4, y: 4 });
    const locked = applyFacilityAction(seeded.plan, { kind: 'setLocked', id: seeded.facility.id, locked: true });
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    expect(locked.value.facilities[0]!.locked).toBe(true);

    const shaped = applyFacilityAction(locked.value, { kind: 'setShape', id: seeded.facility.id, shape: 'round' });
    expect(shaped.ok).toBe(true);
    if (!shaped.ok) return;
    expect(shaped.value.facilities[0]!.shape).toBe('round');

    const finished = applyFacilityAction(shaped.value, { kind: 'setFinish', id: seeded.facility.id, finish: 'bare' });
    expect(finished.ok).toBe(true);
    if (!finished.ok) return;
    expect(finished.value.facilities[0]!.finish).toBe('bare');

    const missing = applyFacilityAction(seeded.plan, { kind: 'setLocked', id: 'nope', locked: true });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.issue.code).toBe('not-found');
  });

  it('未知 id：所有动作返回 not-found，plan 原样返回', () => {
    const plan = freshPlan();
    const actions = [
      { kind: 'update', id: 'nope', patch: {} },
      { kind: 'move', id: 'nope', position: { x: 1, y: 1 } },
      { kind: 'rotate', id: 'nope', rotationDeg: 90 },
      { kind: 'resize', id: 'nope', size: { width: 2, depth: 2 } },
      { kind: 'duplicate', id: 'nope' },
      { kind: 'setLocked', id: 'nope', locked: true },
      { kind: 'setShape', id: 'nope', shape: 'round' },
      { kind: 'setFinish', id: 'nope', finish: 'bare' },
    ] as const;
    for (const action of actions) {
      const result = applyFacilityAction(plan, action);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issue.code).toBe('not-found');
    }
    expect(plan.facilities).toHaveLength(0);
  });
});

describe('zone CRUD（B-1 plan 写入口）', () => {
  it('add：落一个分区，环校验复用既有纯函数', () => {
    const plan = freshPlan();
    const result = applyZoneAction(plan, {
      kind: 'add',
      input: { semantic: 'checkin', name: '签到区', polygon: rect(0, 0, 10, 10) },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.zones).toHaveLength(1);
    const zone = result.value.zones[0]!;
    expect(zone.id).toBeTruthy();
    expect(zone.semantic).toBe('checkin');
    expect(zone.name).toBe('签到区');
    expect(zone.polygon).toHaveLength(4);
  });

  it('add：退化环（不足三点 / 面积过小）拒收', () => {
    const plan = freshPlan();
    const twoPoints = applyZoneAction(plan, {
      kind: 'add',
      input: { semantic: 'stage', name: '舞台', polygon: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
    });
    expect(twoPoints.ok).toBe(false);
    if (!twoPoints.ok) expect(twoPoints.issue.code).toBe('too-few-vertices');
    expect(plan.zones).toHaveLength(0);
  });

  it('update：白名单字段写入；semantic 与契约外字段不进补丁', () => {
    const seeded = addZone(freshPlan(), rect(0, 0, 10, 10));
    const patch: ZonePatch = {
      name: '观众区',
      color: '#aa3333',
      opacity: 0.5,
      event: '潮乐之夜',
      environment: 'outdoor',
      purpose: 'audience',
      notes: '前排留通道',
    };
    const result = applyZoneAction(seeded.plan, { kind: 'update', id: seeded.zone.id, patch });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.value.zones[0]!;
    expect(next.name).toBe('观众区');
    expect(next.color).toBe('#aa3333');
    expect(next.opacity).toBe(0.5);
    expect(next.event).toBe('潮乐之夜');
    expect(next.environment).toBe('outdoor');
    expect(next.purpose).toBe('audience');
    expect(next.notes).toBe('前排留通道');
    expect(next.semantic).toBe('checkin');
  });

  it('update：契约外字段剥离并记 unknown-field；非法环拒收', () => {
    const seeded = addZone(freshPlan(), rect(0, 0, 10, 10));
    const patch = { semantic: 'stage', wallId: 'w1', mirrored: true } as unknown as ZonePatch;
    const result = applyZoneAction(seeded.plan, { kind: 'update', id: seeded.zone.id, patch });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.value.zones[0]!;
    expect(next).not.toHaveProperty('wallId');
    expect(next).not.toHaveProperty('mirrored');
    expect(next.semantic).toBe('checkin');
    expect(result.issues?.some(i => i.code === 'unknown-field')).toBe(true);

    const badRing = applyZoneAction(seeded.plan, {
      kind: 'update',
      id: seeded.zone.id,
      patch: { polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    });
    expect(badRing.ok).toBe(false);
  });

  it('remove：按 id 删除；未知 id 返回 not-found 且 plan 不变', () => {
    const seeded = addZone(freshPlan(), rect(0, 0, 10, 10));
    const removed = applyZoneAction(seeded.plan, { kind: 'remove', id: seeded.zone.id });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.value.zones).toHaveLength(0);

    const missing = applyZoneAction(seeded.plan, { kind: 'remove', id: 'nope' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.issue.code).toBe('not-found');
    expect(seeded.plan.zones).toHaveLength(1);
  });

  it('facility 可挂到已有分区；分区删除后设施引用由契约复核把关（本层不偷挂）', () => {
    let plan = freshPlan();
    const zone = addZone(plan, rect(0, 0, 10, 10));
    plan = zone.plan;
    const placed = applyFacilityAction(plan, {
      kind: 'add',
      input: { templateId: 'booth-2x2', position: { x: 5, y: 5 }, zoneId: zone.zone.id },
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.value.facilities[0]!.zoneId).toBe(zone.zone.id);
  });
});
