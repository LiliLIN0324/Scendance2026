/**
 * 户外计划设施的 GLB 真模型层（从 outdoor-plan-3d 的 facility 模型段抽出，2026-11-12）。
 *
 * 原本「2D 设施 → 物料库 GLB」只在户外卡 3D（outdoor-plan-3d）渲染；主舞台 3D 只有
 * buildPlanFootprint 的低模占位。这里把「解析候选 → 载 GLB → 落位 → 藏占位」抽成共享
 * builder，两边同一套口径（docs/42 主线：退出户外后主画布也要看到 3D 素材）。
 *
 * 坐标口径（外层偏移由调用方承担，本模块只管内层落位）：
 * - 内层：`position = (prop.center.x - metrics.width / 2, 0, prop.center.z - metrics.depth / 2)`、
 *   `rotation.y = -(rotationDeg * π / 180) + (swap ? π / 2 : 0)`——与
 *   plan-footprint-builder 的 shapePoint / 占位体完全同式。
 * - 外层：户外 3D 的组补 `(siteFrame.cx, 0, -siteFrame.cy)`（ENU 世界）；主舞台壳体世界
 *   原点已居中，组放在 (0,0,0) 即可与分区色块对齐。
 *
 * 与 outdoor-plan-3d 场景物件层（item:* / venue-scan splat）的关系：那里仍用自己的
 * modelRunRef/modelRoots 机械，本模块自带 run guard 与 dispose，互不干扰。
 */

import * as THREE from 'three';
import {
  createCachedGlbModel,
  disposeOwnedModel,
  ensureGlbAsset,
  getGlbAssetState,
} from './glb-assets';
import {
  loadFacilityModelCandidates,
  resolveFacilityModels,
  selectFacilityModel,
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
    // 2D 画布顺时针为正；three 绕 Y 正向是逆时针，所以取负。
    // swap：模型长边换到占地长边（例如 7.5 m 长的餐车塞进 6×2.5 的格子）。
    rotationY: -(prop.rotationDeg * Math.PI) / 180 + (swap ? Math.PI / 2 : 0),
  };
}

/**
 * 物料库登记尺寸与 GLB 实际包围盒有出入时，模型不允许超出 2D 占地的兜底收缩。
 * dims 是登记坐标系下的实测包围盒；swap 后占位宽深互换。
 */
export function shrinkFactorFor(
  prop: PlanPropShape,
  candidate: FacilityModelCandidate & FacilityModelFit,
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
 * plan 编辑后同步既有模型位置（只挪位置不重摆新模型——与 outdoor-plan-3d
 * syncFootprint 的原语义一致；新设施等场景重挂时再落 GLB）。
 */
export function syncPlanModelPositions(
  layer: THREE.Object3D,
  props: readonly PlanPropShape[],
  metrics: PlanMetrics,
): void {
  props.forEach((prop) => {
    const object = layer.children.find((child) => child.userData.planPropId === prop.id);
    if (!object) return;
    const { position } = planModelTransform(prop, metrics, false);
    object.position.set(position[0], position[1], position[2]);
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
  /** plan 编辑后同步既有模型位置（不换代、不重摆新模型）。 */
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
  let placeholders = deps.placeholders;
  let run = 0;
  run += 1;
  const initialRun = run;

  const placeModel = (
    prop: PlanPropShape,
    metrics: PlanMetrics,
    candidate: FacilityModelCandidate & FacilityModelFit,
  ): void => {
    if (placedPropIds.has(prop.id)) return;
    placedPropIds.add(prop.id);
    const item = candidateItemFor(prop, candidate);
    void ensureGlbAsset(candidate.glbUrl, candidate.glbUrl)
      .then(() => {
        if (deps.isDisposed() || run !== initialRun) return;
        const model = createCachedGlbModel(item, false);
        if (!model) return;
        if (deps.isDisposed() || run !== initialRun) {
          disposeOwnedModel(model);
          return;
        }
        // 兜底：物料库登记的尺寸与 GLB 实际包围盒有出入时，模型不允许超出 2D 占地。
        const dims = getGlbAssetState(candidate.glbUrl)?.dimensions;
        if (dims) {
          const shrink = shrinkFactorFor(prop, candidate, dims);
          if (shrink < 1) model.scale.multiplyScalar(shrink);
        }
        const transform = planModelTransform(prop, metrics, candidate.swap);
        model.position.set(transform.position[0], transform.position[1], transform.position[2]);
        model.rotation.y = transform.rotationY;
        model.name = `plan-model-${prop.kind}`;
        model.userData.planPropId = prop.id;
        group.add(model);
        const placeholder = placeholders?.get(prop.id);
        if (placeholder) placeholder.visible = false;
      })
      .catch(() => {
        /* 模型拉不到（404 / CORS / 解析失败）：静默保留占位体（低模或 2D 贴纸）。 */
      });
  };

  const placeAll = (
    props: readonly PlanPropShape[],
    metrics: PlanMetrics,
    candidatesByTemplate?: ReadonlyMap<string, readonly FacilityModelCandidate[]> | undefined,
  ): void => {
    props.forEach((prop) => {
      if (placedPropIds.has(prop.id)) return;
      const chosen = selectFacilityModel(
        candidatesByTemplate?.get(prop.templateId) ?? resolveFacilityModels(prop.templateId),
        prop.width,
        prop.depth,
      );
      if (chosen) placeModel(prop, metrics, chosen);
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
    if (nextPlaceholders) placeholders = nextPlaceholders;
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

  return {
    group,
    syncPositions(props, metrics) {
      syncPlanModelPositions(group, props, metrics);
    },
    placeNew,
    dispose() {
      run += 1;
      group.children.slice().forEach((child) => disposeOwnedModel(child));
      group.parent?.remove(group);
    },
  };
}
