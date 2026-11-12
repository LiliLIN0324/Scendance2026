// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  candidateItemFor,
  collectPlaceholdersByPropId,
  createPlanModelLayer,
  planModelTransform,
  shrinkFactorFor,
  syncPlanModelPositions,
} from './plan-model-layer';
import {
  loadFacilityModelCandidates,
  loadFacilityModelOverride,
  resolveFacilityModels,
  selectFacilityModel,
  selectFacilityModelOverride,
  type FacilityModelCandidate,
  type FacilityModelFit,
} from '@/components/room-organizer/lib/plan-facility-models';
import type { PlanPropShape } from '@/components/room-organizer/lib/plan-footprint-geometry';
import { createCachedGlbModel, disposeOwnedModel } from './glb-assets';

vi.mock('./glb-assets', () => ({
  ensureGlbAsset: vi.fn(() => Promise.resolve()),
  createCachedGlbModel: vi.fn(() => new THREE.Group()),
  getGlbAssetState: vi.fn(() => null),
  disposeOwnedModel: vi.fn(),
}));

const CANDIDATE: FacilityModelCandidate = {
  slug: 'event-tent-05m',
  name: '5m 帐篷',
  glbUrl: '/showcase/assets/library/model/event-tent-05m.glb',
  width: 5,
  depth: 5,
  height: 3,
};
const FITTED: FacilityModelCandidate & FacilityModelFit = { ...CANDIDATE, scale: 1, swap: false };

vi.mock('@/components/room-organizer/lib/plan-facility-models', () => ({
  resolveFacilityModels: vi.fn(() => [CANDIDATE]),
  selectFacilityModel: vi.fn(() => FITTED),
  loadFacilityModelCandidates: vi.fn(() => Promise.resolve(new Map())),
  fitFacilityModel: vi.fn(() => ({ scale: 1, swap: false, height: 3 })),
  selectFacilityModelOverride: vi.fn(),
  loadFacilityModelOverride: vi.fn(),
}));

const flush = async (): Promise<void> => {
  for (let round = 0; round < 4; round += 1) await Promise.resolve();
};

function prop(
  id: string,
  overrides: Partial<{ x: number; z: number; width: number; depth: number; rotationDeg: number }> = {},
  modelOverride?: string,
): PlanPropShape {
  return {
    id,
    templateId: 'oneplan:icon:tent',
    kind: 'tent',
    label: '帐篷',
    center: { x: overrides.x ?? 60, z: overrides.z ?? 30 },
    width: overrides.width ?? 5,
    depth: overrides.depth ?? 5,
    rotationDeg: overrides.rotationDeg ?? 0,
    ...(modelOverride !== undefined ? { modelOverride } : {}),
  };
}

describe('plan model layer pure math', () => {
  const metrics = { width: 100, depth: 60 };

  it('places models with the same inner offset as footprint placeholders (shapePoint 口径)', () => {
    const transform = planModelTransform(prop('p1'), metrics, false);
    // plan-footprint-builder L218：object.position.set(center.x - w/2, 0, center.z - d/2)
    expect(transform.position).toEqual([10, 0, 0]);
    expect(transform.rotationY).toBe(0);
  });

  it('negates the 2D clockwise rotation and adds 90° for swapped models', () => {
    const rotated = planModelTransform(prop('p1', { rotationDeg: 90 }), metrics, false);
    expect(rotated.rotationY).toBeCloseTo(-Math.PI / 2, 12);
    const swapped = planModelTransform(prop('p1'), metrics, true);
    expect(swapped.rotationY).toBeCloseTo(Math.PI / 2, 12);
  });

  it('shrinks models that would overflow the 2D footprint and keeps fitting ones at 1', () => {
    // 候选登记 5×5×3、实测包围盒 6×6×3 → 按高度换算渲染 6×6，超出 2D 占地 5×5 → 5/6。
    const shrink = shrinkFactorFor(prop('p1', { width: 5, depth: 5 }), FITTED, { width: 6, depth: 6, height: 3 });
    expect(shrink).toBeCloseTo(5 / 6, 12);
    expect(shrinkFactorFor(prop('p1'), FITTED, { width: 5, depth: 5, height: 3 })).toBe(1);
    // swap 后占位宽深互换。
    const swapped = shrinkFactorFor(prop('p1', { width: 5, depth: 5 }), { ...FITTED, swap: true }, { width: 6, depth: 6, height: 3 });
    expect(swapped).toBeCloseTo(5 / 6, 12);
    expect(shrinkFactorFor(prop('p1'), FITTED, { width: 0, depth: 0, height: 0 })).toBe(1);
  });

  it('builds the uniform-scaled glb item the cache factory expects', () => {
    const item = candidateItemFor(prop('p1'), FITTED);
    expect(item.id).toBe('plan-model-p1');
    expect(item.type).toBe('glb-asset');
    expect(item.glbUrl).toBe(FITTED.glbUrl);
    expect(item.uniformScale).toBe(true);
    expect(item.width).toBe(FITTED.width * FITTED.scale);
  });

  it('collects placeholder objects keyed by planPropId', () => {
    const group = new THREE.Group();
    const a = new THREE.Group();
    a.userData.planPropId = 'p1';
    group.add(a);
    group.add(new THREE.Group()); // 无标记不收
    const map = collectPlaceholdersByPropId(group);
    expect(map.get('p1')).toBe(a);
    expect(map.size).toBe(1);
  });

  it('sync repositions existing models only (不重摆新模型)', () => {
    const layer = new THREE.Group();
    const model = new THREE.Group();
    model.userData.planPropId = 'p1';
    layer.add(model);
    syncPlanModelPositions(layer, [prop('p1', { x: 10, z: 20 }), prop('p2')], metrics);
    expect(model.position.x).toBeCloseTo(10 - metrics.width / 2, 9);
    expect(model.position.z).toBeCloseTo(20 - metrics.depth / 2, 9);
    // p2 没有已落地模型：不新建。
    expect(layer.children).toHaveLength(1);
  });
});

describe('plan model layer assembly', () => {
  beforeEach(() => {
    vi.mocked(createCachedGlbModel).mockClear();
    vi.mocked(disposeOwnedModel).mockClear();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lands the model under the footprint placeholder and hides it', async () => {
    const parent = new THREE.Scene();
    const placeholder = new THREE.Group();
    placeholder.userData.planPropId = 'p1';
    const footprint = new THREE.Group();
    footprint.add(placeholder);
    const layer = createPlanModelLayer({
      parent,
      props: [prop('p1')],
      metrics: { width: 100, depth: 60 },
      placeholders: collectPlaceholdersByPropId(footprint),
      isDisposed: () => false,
    });
    expect(layer.group.name).toBe('plan-models');
    expect(layer.group.parent).toBe(parent);
    await flush();
    expect(vi.mocked(createCachedGlbModel)).toHaveBeenCalledTimes(1);
    const model = layer.group.children[0] as THREE.Object3D;
    expect(model.userData.planPropId).toBe('p1');
    expect(model.position.x).toBeCloseTo(10, 9);
    expect(model.position.z).toBeCloseTo(0, 9);
    expect(placeholder.visible).toBe(false);
    // 外层偏移由调用方承担（户外 ENU 中心）。
    layer.group.position.set(20, 0, -15);
    expect(layer.group.position.x).toBe(20);
    layer.dispose();
    expect(vi.mocked(disposeOwnedModel)).toHaveBeenCalled();
    expect(layer.group.parent).toBeNull();
  });

  it('drops late models after dispose and keeps the placeholder untouched', async () => {
    const parent = new THREE.Scene();
    const placeholder = new THREE.Group();
    placeholder.userData.planPropId = 'p1';
    const layer = createPlanModelLayer({
      parent,
      props: [prop('p1')],
      metrics: { width: 100, depth: 60 },
      placeholders: new Map([['p1', placeholder]]),
      isDisposed: () => false,
    });
    layer.dispose(); // 换代：已 resolve 的 placeModel 被 run guard 丢弃
    const createdBefore = vi.mocked(createCachedGlbModel).mock.calls.length;
    await flush();
    expect(vi.mocked(createCachedGlbModel).mock.calls.length).toBe(createdBefore);
    expect(layer.group.parent).toBeNull();
    expect(disposeOwnedModel).not.toHaveBeenCalled();
    expect(placeholder.visible).not.toBe(false);
    void loadFacilityModelCandidates;
    void resolveFacilityModels;
    void selectFacilityModel;
  });

  it('placeNew 落地编辑后新增的设施并隐藏新占位（2026-11-12：新设施不再等场景重挂）', async () => {
    const parent = new THREE.Scene();
    const layer = createPlanModelLayer({
      parent,
      props: [prop('p1')],
      metrics: { width: 100, depth: 60 },
      isDisposed: () => false,
    });
    await flush();
    expect(layer.group.children).toHaveLength(1);
    // 编辑后重建的 footprint 组带新占位（p2），placeNew 用它隐藏贴纸。
    const newPlaceholder = new THREE.Group();
    newPlaceholder.userData.planPropId = 'p2';
    const rebuiltFootprint = new THREE.Group();
    rebuiltFootprint.add(newPlaceholder);
    layer.placeNew([prop('p1'), prop('p2')], { width: 100, depth: 60 }, collectPlaceholdersByPropId(rebuiltFootprint));
    // p1 已落地不重摆；p2 当场落模型（ensureGlbAsset resolve 后）。
    await flush();
    expect(vi.mocked(createCachedGlbModel)).toHaveBeenCalledTimes(2);
    expect(layer.group.children).toHaveLength(2);
    expect(newPlaceholder.visible).toBe(false);
    const model2 = layer.group.children.find((child) => child.userData.planPropId === 'p2');
    expect(model2).toBeDefined();
    layer.dispose();
  });
});

describe('plan model layer modelOverride (V-5a)', () => {
  const OVERRIDE: FacilityModelCandidate = {
    slug: 'override-tent',
    name: 'override 帐篷',
    glbUrl: '/showcase/assets/library/model/override-tent.glb',
    width: 4,
    depth: 4,
    height: 2.5,
  };
  const metrics = { width: 100, depth: 60 };

  beforeEach(() => {
    vi.mocked(createCachedGlbModel).mockClear();
    vi.mocked(disposeOwnedModel).mockClear();
    vi.mocked(selectFacilityModel).mockClear();
    vi.mocked(selectFacilityModelOverride).mockClear().mockImplementation((candidates, slug) => {
      const found = (candidates as readonly FacilityModelCandidate[]).find((candidate) => candidate.slug === slug);
      return found ? { ...found, scale: 1, swap: false } : null;
    });
    vi.mocked(loadFacilityModelCandidates).mockClear().mockImplementation(() => Promise.resolve(new Map()));
    vi.mocked(loadFacilityModelOverride).mockClear().mockImplementation(() => Promise.resolve(null));
  });

  it('override 在候选里：直接落 override 模型，不走自动挑选', async () => {
    const parent = new THREE.Scene();
    const layer = createPlanModelLayer({
      parent,
      props: [prop('p1', {}, CANDIDATE.slug)],
      metrics,
      isDisposed: () => false,
    });
    await flush();
    expect(vi.mocked(selectFacilityModelOverride)).toHaveBeenCalledWith([CANDIDATE], CANDIDATE.slug, 5, 5);
    expect(vi.mocked(selectFacilityModel)).not.toHaveBeenCalled();
    const item = vi.mocked(createCachedGlbModel).mock.calls[0]?.[0];
    expect(item?.glbUrl).toBe(CANDIDATE.glbUrl);
    layer.dispose();
  });

  it('override 不在 top-N 候选：等在线轮按 slug 全库直查，命中后照落', async () => {
    vi.mocked(loadFacilityModelOverride).mockImplementation(() => Promise.resolve(OVERRIDE));
    const parent = new THREE.Scene();
    const layer = createPlanModelLayer({
      parent,
      props: [prop('p1', {}, OVERRIDE.slug)],
      metrics,
      isDisposed: () => false,
    });
    // 内置同步轮没命中 override：此时一个模型都没落（不急着回退）。
    expect(layer.group.children).toHaveLength(0);
    await flush();
    expect(vi.mocked(loadFacilityModelOverride)).toHaveBeenCalledWith(OVERRIDE.slug);
    expect(vi.mocked(createCachedGlbModel)).toHaveBeenCalledTimes(1);
    const item = vi.mocked(createCachedGlbModel).mock.calls[0]?.[0];
    expect(item?.glbUrl).toBe(OVERRIDE.glbUrl);
    layer.dispose();
  });

  it('override 指向不存在的模型：回退自动挑选，不空崩', async () => {
    const parent = new THREE.Scene();
    const layer = createPlanModelLayer({
      parent,
      props: [prop('p1', {}, 'no-such-model')],
      metrics,
      isDisposed: () => false,
    });
    await flush();
    expect(vi.mocked(loadFacilityModelOverride)).toHaveBeenCalledWith('no-such-model');
    // 自动挑选路径接管：selectFacilityModel → FITTED。
    expect(vi.mocked(selectFacilityModel)).toHaveBeenCalled();
    const item = vi.mocked(createCachedGlbModel).mock.calls[0]?.[0];
    expect(item?.glbUrl).toBe(FITTED.glbUrl);
    layer.dispose();
  });

  it('syncPositions：override 从 A 切到 B 当场换模型（dispose 旧模型 + 重落），清除回自动也换', async () => {
    const parent = new THREE.Scene();
    const layer = createPlanModelLayer({
      parent,
      props: [prop('p1', {}, CANDIDATE.slug)],
      metrics,
      isDisposed: () => false,
    });
    await flush();
    expect(vi.mocked(createCachedGlbModel).mock.calls[0]?.[0]?.glbUrl).toBe(CANDIDATE.glbUrl);
    expect(disposeOwnedModel).not.toHaveBeenCalled();

    // 切到另一个 override：旧模型 dispose、新模型按 override 落（在线候选轮命中）。
    const B: FacilityModelCandidate = { ...OVERRIDE, slug: 'override-tent-b', glbUrl: '/showcase/assets/library/model/override-tent-b.glb' };
    vi.mocked(loadFacilityModelCandidates).mockImplementation(() => Promise.resolve(new Map([['oneplan:icon:tent', [CANDIDATE, B]]])));
    layer.syncPositions([prop('p1', {}, B.slug)], metrics);
    expect(disposeOwnedModel).toHaveBeenCalledTimes(1);
    await flush();
    expect(vi.mocked(createCachedGlbModel).mock.calls[1]?.[0]?.glbUrl).toBe(B.glbUrl);

    // 清除 override（undefined）：回到自动挑选的模型。
    layer.syncPositions([prop('p1')], metrics);
    expect(disposeOwnedModel).toHaveBeenCalledTimes(2);
    await flush();
    expect(vi.mocked(createCachedGlbModel).mock.calls[2]?.[0]?.glbUrl).toBe(FITTED.glbUrl);
    layer.dispose();
  });
});
