/**
 * 户外计划设施的 GLB 真模型层（从 outdoor-plan-3d 的 facility 模型段抽出，2026-11-12）。
 *
 * 原本「2D 设施 → 物料库 GLB」只在户外卡 3D（outdoor-plan-3d）渲染；主舞台 3D 只有
 * buildPlanFootprint 的低模占位。这里把「解析候选 → 载 GLB → 落位 → 藏占位」抽成共享
 * builder，两边同一套口径（docs/42 主线：退出户外后主画布也要看到 3D 素材）。
 *
 * 坐标口径（外层偏移由调用方承担，本模块只管内层落位）：
 * - 内层：`position = (prop.center.x - metrics.width / 2, 0, prop.center.z - metrics.depth / 2)`、
 *   `rotation.y = (rotationDeg * π / 180) + (swap ? π / 2 : 0)`——与
 *   plan-footprint-builder 的 shapePoint / 占位体完全同式。
 * - 外层：户外 3D 的组补 `(siteFrame.cx, 0, -siteFrame.cy)`（ENU 世界）；主舞台壳体世界
 *   原点已居中，组放在 (0,0,0) 即可与分区色块对齐。
 *
 * 与 outdoor-plan-3d 场景物件层（item:* / venue-scan splat）的关系：那里仍用自己的
 * modelRunRef/modelRoots 机械，本模块自带 run guard 与 dispose，互不干扰。
 */

import * as THREE from 'three';
import { findGeneratedFacilityModel, subscribeGeneratedFacilityModels } from '../lib/facility-generated-models';
import {
  createCachedGlbModel,
  disposeOwnedModel,
  ensureGlbAsset,
  getGlbAssetState,
} from './glb-assets';
import {
  fitFacilityModel,
  loadFacilityModelCandidates,
  loadFacilityModelOverride,
  resolveFacilityModels,
  selectFacilityModel,
  selectFacilityModelOverride,
  type FacilityModelCandidate,
  type FacilityModelFit,
} from '@/components/room-organizer/lib/plan-facility-models';
import type { PlanPropShape } from '@/components/room-organizer/lib/plan-footprint-geometry';
import type { FurnitureItem } from '@/components/room-organizer/lib/types';

export interface PlanMetrics {
  width: number;
  depth: number;
}

/** 2D 设施占地 → GLB 模型内层落位（与 plan-footprint-builder 的占位体同式）。 */
export function planModelTransform(
  prop: PlanPropShape,
  metrics: PlanMetrics,
  swap: boolean,
): { position: [number, number, number]; rotationY: number } {
  return {
    position: [prop.center.x - metrics.width / 2, 0, prop.center.z - metrics.depth / 2],
    // rotationDeg 为 ENU 逆时针为正；壳体 z = −y，three R_y(φ) 取 φ = rotationDeg。
    // swap：模型长边换到占地长边（例如 7.5 m 长的餐车塞进 6×2.5 的格子）。
    rotationY: (prop.rotationDeg * Math.PI) / 180 + (swap ? Math.PI / 2 : 0),
  };
}

/** 兜底收缩只用到的候选拟合字段（不必带 slug/name 等选模信息）。 */
export type ShrinkFit = Pick<FacilityModelCandidate, 'width' | 'depth' | 'glbUrl'> &
  Pick<FacilityModelFit, 'scale' | 'swap' | 'height'>;

/**
 * 物料库登记尺寸与 GLB 实际包围盒有出入时，模型不允许超出 2D 占地的兜底收缩。
 * dims 是登记坐标系下的实测包围盒；swap 后占位宽深互换。
 */
export function shrinkFactorFor(
  prop: PlanPropShape,
  candidate: ShrinkFit,
  dims: { width: number; depth: number; height: number },
): number {
  if (!(dims.width > 0 && dims.depth > 0 && dims.height > 0)) return 1;
  const applied = candidate.height / dims.height;
  const renderedWidth = dims.width * applied;
  const renderedDepth = dims.depth * applied;
  const footprintWidth = candidate.swap ? renderedDepth : renderedWidth;
  const footprintDepth = candidate.swap ? renderedWidth : renderedDepth;
  return Math.min(1, prop.width / footprintWidth, prop.depth / footprintDepth);
}

/** placeModel 的 FurnitureItem 构造（createCachedGlbModel 的入参，uniformScale 不变形）。 */
export function candidateItemFor(
  prop: PlanPropShape,
  candidate: FacilityModelCandidate & FacilityModelFit,
): FurnitureItem {
  return {
    id: `plan-model-${prop.id}`,
    type: 'glb-asset',
    name: candidate.name,
    width: candidate.width * candidate.scale,
    depth: candidate.depth * candidate.scale,
    height: candidate.height,
    color: '#ffffff',
    icon: '◇',
    glbUrl: candidate.glbUrl,
    uniformScale: true,
  };
}

/**
 * 从 footprint 组收集 prop.id → 低模占位体。
 * 约定：buildPlanFootprint 给每个设施占位对象写 `userData.planPropId`（plan-footprint-builder L215-224）。
 */
export function collectPlaceholdersByPropId(group: THREE.Object3D): Map<string, THREE.Object3D> {
  const map = new Map<string, THREE.Object3D>();
  group.children.forEach((child) => {
    const propId = child.userData.planPropId;
    if (typeof propId === 'string') map.set(propId, child);
  });
  return map;
}

/**
 * 设施 id 差集对账：新增 / 保留 / 移除三态（模型层孤儿剪枝的纯函数口径，便于单测）。
 */
export function diffPlanPropIds(
  prev: Iterable<string>,
  next: readonly string[],
): { added: string[]; kept: string[]; removed: string[] } {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  const added = next.filter((id) => !prevSet.has(id));
  const kept = next.filter((id) => prevSet.has(id));
  const removed = [...prevSet].filter((id) => !nextSet.has(id));
  return { added, kept, removed };
}

/** 落模时登记的候选拟合快照：编辑后按最新占地重算旋转/缩放用（不重选模型变体）。 */
type PlacedPropFit = ShrinkFit;

/**
 * plan 编辑后同步既有模型的落位：位置、旋转、兜底缩放都按最新 2D 占地重算，
 * 保证模型与黄框完全对齐；只改既有模型，不重摆新模型（新设施由 placeNew 落地）。
 */
export function syncPlanModelPositions(
  layer: THREE.Object3D,
  props: readonly PlanPropShape[],
  metrics: PlanMetrics,
): void {
  props.forEach((prop) => {
    const object = layer.children.find((child) => child.userData.planPropId === prop.id);
    if (!object) return;
    const fit = object.userData.planPropFit as PlacedPropFit | undefined;
    const swap = fit?.swap ?? false;
    const { position, rotationY } = planModelTransform(prop, metrics, swap);
    object.position.set(position[0], position[1], position[2]);
    object.rotation.y = rotationY;
    // 缩放：以落模基底系数为底，按最新占地等比跟随放大/缩小，实测越界再由 shrink 兜底。
    const base = object.userData.planPropBaseScale as readonly [number, number, number] | undefined;
    object.scale.set(base?.[0] ?? 1, base?.[1] ?? 1, base?.[2] ?? 1);
    if (fit) {
      const dims = fit.glbUrl ? getGlbAssetState(fit.glbUrl)?.dimensions : undefined;
      // 按最新占地重算 contain：框变大模型跟放大、变小跟缩小（方案甲：框即模型真实外廓）。
      // 落模基底系数相对当时 contain_old，故跟随倍率 = 新 contain / 落模 contain。
      const contain = fit.swap
        ? Math.min(prop.width / fit.depth, prop.depth / fit.width)
        : Math.min(prop.width / fit.width, prop.depth / fit.depth);
      const follow = fit.scale > 0 ? contain / fit.scale : 1;
      object.scale.set(
        (base?.[0] ?? 1) * follow,
        (base?.[1] ?? 1) * follow,
        (base?.[2] ?? 1) * follow,
      );
      if (dims) {
        const shrink = shrinkFactorFor(prop, fit, dims);
        object.scale.multiplyScalar(shrink);
      }
    }
  });
}

export interface PlanModelLayerDeps {
  /** 模型组挂载点（组本身由本模块创建，名字 plan-models；组的外层偏移由调用方设置）。 */
  parent: THREE.Object3D;
  props: readonly PlanPropShape[];
  metrics: PlanMetrics;
  /** prop.id → 低模占位体；模型成功落地才隐藏，失败静默保留占位。 */
  placeholders?: ReadonlyMap<string, THREE.Object3D> | undefined;
  isDisposed(): boolean;
}

export interface PlanModelLayer {
  /** 共享组（调用方设置外层偏移）。 */
  group: THREE.Group;
  /**
   * plan 编辑后同步既有模型位置（不换代、不重摆新模型）。
   * V-5a：设施的 modelOverride 变化（设置/切换/清除）时，已落的旧模型当场换掉——
   * 调用方（outdoor-plan-3d syncFootprint）只管照常调 syncPositions，override 切换即时生效。
   */
  syncPositions(props: readonly PlanPropShape[], metrics: PlanMetrics): void;
  /**
   * plan 编辑后新增的设施当场落地真模型（2026-11-12：原来要等图源/视口变化触发
   * 场景重挂，用户放个摩天轮只看得到占地轮廓）。重建后的占位表同步接管。
   */
  placeNew(
    props: readonly PlanPropShape[],
    metrics: PlanMetrics,
    placeholders?: ReadonlyMap<string, THREE.Object3D> | undefined,
  ): void;
  /** 换代号（晚到的模型直接丢）+ dispose 全部已落地模型 + 摘组。 */
  dispose(): void;
}

export function createPlanModelLayer(deps: PlanModelLayerDeps): PlanModelLayer {
  const group = new THREE.Group();
  group.name = 'plan-models';
  deps.parent.add(group);
  const placedPropIds = new Set<string>();
  /** V-5a：prop.id → 落位时的 modelOverride（含 undefined）；syncPositions 据此发现 override 变化换模型。 */
  const placedOverrides = new Map<string, string | undefined>();
  const placedUrls = new Map<string, string>();
  /** 当前 plan 里仍然存在的设施 id；删除剪枝与晚到模型回写都以此为准。 */
  const livePropIds = new Set(deps.props.map((prop) => prop.id));
  let placeholders = deps.placeholders;
  let currentProps = deps.props;
  let currentMetrics = deps.metrics;
  const generations = new Map<string, number>();
  let run = 0;
  run += 1;
  const initialRun = run;

  /**
   * 删除剪枝：plan 里已不存在的设施，把已落地的 GLB 从组里摘掉并释放几何/材质，
   * 同时从 placedPropIds 除名——否则旧模型会留在原位成孤儿（J1）。
   */
  const pruneRemoved = (props: readonly PlanPropShape[]): void => {
    const { removed } = diffPlanPropIds(placedPropIds, props.map((prop) => prop.id));
    if (removed.length === 0) return;
    const removedSet = new Set(removed);
    group.children.slice().forEach((child) => {
      const propId = child.userData.planPropId;
      if (typeof propId !== 'string' || !removedSet.has(propId)) return;
      disposeOwnedModel(child);
      group.remove(child);
      placedPropIds.delete(propId);
    });
  };

  const placeModel = (
    prop: PlanPropShape,
    _metrics: PlanMetrics,
    candidate: FacilityModelCandidate & FacilityModelFit,
  ): void => {
    if (placedPropIds.has(prop.id)) return;
    const generation = (generations.get(prop.id) ?? 0) + 1;
    generations.set(prop.id, generation);
    placedPropIds.add(prop.id);
    placedOverrides.set(prop.id, prop.modelOverride);
    placedUrls.set(prop.id, candidate.glbUrl);
    const item = candidateItemFor(prop, candidate);
    void ensureGlbAsset(candidate.glbUrl, candidate.glbUrl)
      .then(() => {
        if (deps.isDisposed() || run !== initialRun || generations.get(prop.id) !== generation || currentProps.find(p => p.id === prop.id)?.modelOverride !== prop.modelOverride) return;
        const liveProp = currentProps.find(p => p.id === prop.id);
        if (!liveProp) return;
        const model = createCachedGlbModel(item, false);
        if (!model) return;
        if (deps.isDisposed() || run !== initialRun) {
          disposeOwnedModel(model);
          return;
        }
        // 模型晚到前设施已被删除：不挂回组，直接释放，避免孤儿模型复活。
        if (!livePropIds.has(prop.id)) {
          disposeOwnedModel(model);
          return;
        }
        // 兜底：物料库登记的尺寸与 GLB 实际包围盒有出入时，模型不允许超出 2D 占地。
        // 先留一份落模基底缩放，编辑重算缩放时回到基底再乘新的收缩系数。
        const baseScale = model.scale.clone();
        const dims = getGlbAssetState(candidate.glbUrl)?.dimensions;
        if (dims) {
          const shrink = shrinkFactorFor(prop, candidate, dims);
          if (shrink < 1) model.scale.multiplyScalar(shrink);
        }
        const transform = planModelTransform(liveProp, currentMetrics, candidate.swap);
        model.position.set(transform.position[0], transform.position[1], transform.position[2]);
        model.rotation.y = transform.rotationY;
        model.name = `plan-model-${prop.kind}`;
        model.userData.planPropId = prop.id;
        model.userData.planPropBaseScale = [baseScale.x, baseScale.y, baseScale.z] as const;
        model.userData.planPropFit = {
          width: candidate.width,
          depth: candidate.depth,
          height: candidate.height,
          scale: candidate.scale,
          swap: candidate.swap,
          glbUrl: candidate.glbUrl,
        } satisfies PlacedPropFit;
        group.add(model);
        const placeholder = placeholders?.get(prop.id);
        if (placeholder) placeholder.visible = false;
      })
      .catch(() => {
        if (generations.get(prop.id) === generation) { placedPropIds.delete(prop.id); placedOverrides.delete(prop.id); }
        /* 模型拉不到时保留占位，后续可重试。 */
      });
  };

  /** 无 override 的自动挑选落位（V-5a：override 解析不到时也回这条既有路径）。 */
  const placeAuto = (
    prop: PlanPropShape,
    metrics: PlanMetrics,
    candidates: readonly FacilityModelCandidate[],
  ): void => {
    const chosen = selectFacilityModel(candidates, prop.width, prop.depth);
    if (chosen) placeModel(prop, metrics, chosen);
  };

  /**
   * V-5a：设施带 modelOverride（物料库 slug）时优先用 override 的模型，否则自动挑选原样。
   *
   * 两轮口径与既有逻辑一致（内置同步轮 → 在线候选异步轮）：
   * - 候选列表里有该 slug：直接落（两轮都查，内置轮命中即不等在线）；
   * - top-N 候选没有（候选位次变动/生成回填）：内置同步轮先不落、等在线候选轮；
   *   在线候选轮还没有就按 slug 全库直查（loadFacilityModelOverride）；
   * - 全部解析不到：回退自动挑选（placeAuto），不空崩。
   */
  const placeAll = (
    props: readonly PlanPropShape[],
    metrics: PlanMetrics,
    candidatesByTemplate?: ReadonlyMap<string, readonly FacilityModelCandidate[]> | undefined,
  ): void => {
    props.forEach((prop) => {
      if (placedPropIds.has(prop.id) || !currentProps.some(p => p.id === prop.id && p.modelOverride === prop.modelOverride)) return;
      const candidates = candidatesByTemplate?.get(prop.templateId) ?? resolveFacilityModels(prop.templateId);
      const overrideSlug = prop.modelOverride;
      if (overrideSlug) {
        const overridden = selectFacilityModelOverride(candidates, overrideSlug, prop.width, prop.depth);
        if (overridden) {
          placeModel(prop, metrics, overridden);
          return;
        }
        if (!candidatesByTemplate) return; // 内置同步轮没命中：等在线候选轮再兜底，不急着回退。
        void loadFacilityModelOverride(overrideSlug)
          .then((candidate) => {
            if (deps.isDisposed() || run !== initialRun || placedPropIds.has(prop.id) || !currentProps.some(p => p.id === prop.id && p.modelOverride === overrideSlug)) return;
            if (candidate) {
              placeModel(prop, metrics, { ...candidate, ...fitFacilityModel(prop.width, prop.depth, candidate) });
              return;
            }
            placeAuto(prop, metrics, candidates);
          })
          .catch(() => {
            if (deps.isDisposed() || run !== initialRun || placedPropIds.has(prop.id) || !currentProps.some(p => p.id === prop.id && p.modelOverride === overrideSlug)) return;
            placeAuto(prop, metrics, candidates);
          });
        return;
      }
      placeAuto(prop, metrics, candidates);
    });
  };

  // 先用内置映射（同步，不阻塞渲染），再用在线物料库异步兜底。
  placeAll(deps.props, deps.metrics);
  const templateIds = deps.props.map((prop) => prop.templateId);
  if (templateIds.length > 0) {
    void loadFacilityModelCandidates(templateIds)
      .then((candidatesByTemplate) => {
        if (deps.isDisposed() || run !== initialRun) return;
        placeAll(deps.props, deps.metrics, candidatesByTemplate);
      })
      .catch(() => {
        /* 模型库加载失败：继续用占位体。 */
      });
  }

  /** plan 编辑后新增的设施当场落地（与初挂同一套：内置同步 + 在线异步兜底）。 */
  const placeNew = (
    props: readonly PlanPropShape[],
    metrics: PlanMetrics,
    nextPlaceholders?: ReadonlyMap<string, THREE.Object3D> | undefined,
  ): void => {
    currentProps = props; currentMetrics = metrics;
    if (nextPlaceholders) placeholders = nextPlaceholders;
    livePropIds.clear();
    props.forEach((prop) => livePropIds.add(prop.id));
    // 先剪枝已删除设施的孤儿模型，再补新增；两者互不干扰。
    pruneRemoved(props);
    const pending = props.filter((prop) => !placedPropIds.has(prop.id));
    if (pending.length === 0) return;
    placeAll(pending, metrics);
    const pendingTemplateIds = pending.map((prop) => prop.templateId);
    void loadFacilityModelCandidates(pendingTemplateIds)
      .then((candidatesByTemplate) => {
        if (deps.isDisposed() || run !== initialRun) return;
        placeAll(pending, metrics, candidatesByTemplate);
      })
      .catch(() => {
        /* 模型库加载失败：继续用占位体。 */
      });
  };

  const unsubscribeRegistry = subscribeGeneratedFacilityModels(() => {
    if (deps.isDisposed() || run !== initialRun) return;
    for (const prop of currentProps) {
      const generated = prop.modelOverride ? findGeneratedFacilityModel(prop.modelOverride) : null;
      if (!generated || (placedPropIds.has(prop.id) && placedUrls.get(prop.id) === generated.glbUrl)) continue;
      for (const child of group.children.filter(child => child.userData.planPropId === prop.id)) { disposeOwnedModel(child); child.parent?.remove(child); }
      placedPropIds.delete(prop.id); placedOverrides.delete(prop.id);
      generations.set(prop.id, (generations.get(prop.id) ?? 0) + 1);
      placeModel(prop, currentMetrics, { ...generated, ...fitFacilityModel(prop.width, prop.depth, generated) });
    }
  });

  return {
    group,
    syncPositions(props, metrics) {
      currentProps = props; currentMetrics = metrics;
      syncPlanModelPositions(group, props, metrics);
      // V-5a：override 变化（设置/切换/清除）→ 旧的已落模型当场 dispose 换新，不整层重挂。
      const changed = props.filter(
        (prop) => placedPropIds.has(prop.id) && placedOverrides.get(prop.id) !== prop.modelOverride,
      );
      if (changed.length === 0) return;
      for (const prop of changed) {
        const placed = group.children.find((child) => child.userData.planPropId === prop.id);
        if (placed) {
          disposeOwnedModel(placed);
          placed.parent?.remove(placed);
        }
        generations.set(prop.id, (generations.get(prop.id) ?? 0) + 1);
        placedPropIds.delete(prop.id);
        placedOverrides.delete(prop.id);
      }
      placeAll(changed, metrics);
      void loadFacilityModelCandidates([...new Set(changed.map((prop) => prop.templateId))])
        .then((candidatesByTemplate) => {
          if (deps.isDisposed() || run !== initialRun) return;
          placeAll(changed, metrics, candidatesByTemplate);
        })
        .catch(() => {
          /* 模型库加载失败：override 走内置同步轮已尽力，占位体兜底。 */
        });
    },
    placeNew,
    dispose() {
      unsubscribeRegistry();
      run += 1;
      group.children.slice().forEach((child) => disposeOwnedModel(child));
      group.parent?.remove(group);
    },
  };
}
