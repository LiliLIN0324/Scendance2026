import {
  SCENE_PRESETS,
  scenePresetFacilityId,
  type ScenePresetKey,
} from './scene-presets';

/**
 * 物料卡 → 户外规划的拖放载荷（2026-11-16）。
 *
 * HTML5 的 `dragover` 阶段读不到 `dataTransfer`，所以物料卡拖起时把模型元数据
 * 记在模块级 store 里：2D 画布和 3D 地面在 dragover 就能拿到真实宽深画幽灵，
 * 松手时再用同一份载荷落成一条 `modelOverride` 设施。拖拽结束由卡片清掉。
 */
export interface PlanCatalogDrag {
  /** 物料库 slug（同时写进设施的 `modelOverride`，3D 按它加载 GLB）。 */
  slug: string;
  name: string;
  width: number;
  depth: number;
  /** 设施 templateId；契约上限 64 字符，长 slug 用短哈希，避免截断碰撞。 */
  templateId: string;
}

let current: PlanCatalogDrag | null = null;

/** 户外规划专用拖放类型：值里带完整载荷，松手时不再依赖可能被上一次拖拽污染的模块级 store。 */
export const PLAN_CATALOG_DRAG_MIME = 'application/x-sc-plan-catalog';

export function serializePlanCatalogDrag(payload: PlanCatalogDrag): string {
  return JSON.stringify(payload);
}

export function parsePlanCatalogDrag(raw: string): PlanCatalogDrag | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PlanCatalogDrag> | null;
    if (!value || typeof value !== 'object') return null;
    const { slug, name, width, depth, templateId } = value;
    if (typeof slug !== 'string' || !slug) return null;
    if (typeof name !== 'string' || !name) return null;
    if (typeof width !== 'number' || !(width > 0)) return null;
    if (typeof depth !== 'number' || !(depth > 0)) return null;
    if (typeof templateId !== 'string' || !templateId) return null;
    return { slug, name, width, depth, templateId };
  } catch {
    return null;
  }
}

/** FNV-1a 32 位：slug → 稳定的短 templateId（`web:` + 8 位 base36）。 */
export function catalogFacilityTemplateId(slug: string): string {
  let hash = 2166136261;
  for (let index = 0; index < slug.length; index += 1) {
    hash ^= slug.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = (hash >>> 0).toString(36);
  return `web:${slug.length.toString(36)}-${suffix}`;
}

/**
 * 场景预设 → 同一个户外设施落位通道。
 * slug 与 templateId 都带 `scene-preset:` 前缀，3D 模型层据此加载整馆 GLB，
 * 2D 则按预设真实宽深画占地；不再替换用户当前地图。
 */
export function planCatalogDragForScenePreset(key: ScenePresetKey): PlanCatalogDrag {
  const preset = SCENE_PRESETS[key];
  const id = scenePresetFacilityId(key);
  return {
    slug: id,
    name: preset.name,
    width: preset.width,
    depth: preset.depth,
    templateId: id,
  };
}

export function planCatalogDragFor(input: {
  slug: string;
  name: string;
  width: number;
  depth: number;
  /** 卡片左下角图标（OnePlan 贴纸）的 slug；有就沿用同一枚图标，2D 落位不是白框。 */
  stickerSlug?: string;
}): PlanCatalogDrag {
  const iconTemplate = input.stickerSlug ? `oneplan:icon:${input.stickerSlug}` : '';
  return {
    slug: input.slug,
    name: input.name,
    width: input.width,
    depth: input.depth,
    templateId: iconTemplate && iconTemplate.length <= 64 ? iconTemplate : catalogFacilityTemplateId(input.slug),
  };
}

export function setPlanCatalogDrag(payload: PlanCatalogDrag): void {
  current = payload;
}

export function getPlanCatalogDrag(): PlanCatalogDrag | null {
  return current;
}

export function clearPlanCatalogDrag(): void {
  current = null;
}
