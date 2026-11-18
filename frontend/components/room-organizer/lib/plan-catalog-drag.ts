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
let token = 0;
let clearTimer: ReturnType<typeof setTimeout> | null = null;

/** text/plain 兜底：部分浏览器在 drop 里读不到自定义 MIME，dragend 还可能先于 drop 清掉模块级记录。 */
export const PLAN_CATALOG_TEXT_PREFIX = 'sc-plan-catalog:';

function cancelClearTimer(): void {
  if (clearTimer !== null) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
}

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

export function catalogDragFromText(raw: string): PlanCatalogDrag | null {
  if (!raw.startsWith(PLAN_CATALOG_TEXT_PREFIX)) return null;
  return parsePlanCatalogDrag(raw.slice(PLAN_CATALOG_TEXT_PREFIX.length));
}

export function setPlanCatalogDrag(payload: PlanCatalogDrag): void {
  cancelClearTimer();
  token += 1;
  current = payload;
}

export function getPlanCatalogDrag(): PlanCatalogDrag | null {
  return current;
}

/**
 * 拖拽结束。drop 在有的浏览器里晚于 dragend：立刻清空会让松手读不到载荷，幽灵停在画布上。
 * 推迟到下一拍；期间若又拖起新的一件，或 drop 已经取走，这次清空作废。
 */
export function clearPlanCatalogDrag(): void {
  const seen = token;
  cancelClearTimer();
  clearTimer = setTimeout(() => {
    clearTimer = null;
    if (token === seen) current = null;
  }, 0);
}

/** drop 读到载荷后立刻作废，避免下一拍的 dragend 清空把紧接着的新拖拽也清掉。 */
export function consumePlanCatalogDrag(): void {
  cancelClearTimer();
  token += 1;
  current = null;
}

/** 自定义 MIME、text/plain 前缀、模块级记录，谁先读到用谁。 */
export function readPlanCatalogDrag(mime: string, text: string): PlanCatalogDrag | null {
  return parsePlanCatalogDrag(mime) ?? catalogDragFromText(text) ?? current;
}

/** 拖起时写入两份载荷：自定义 MIME，以及 drop 一定能读到的 text/plain 前缀。 */
export function attachPlanCatalogDrag(transfer: DataTransfer, payload: PlanCatalogDrag): void {
  setPlanCatalogDrag(payload);
  const json = serializePlanCatalogDrag(payload);
  transfer.setData(PLAN_CATALOG_DRAG_MIME, json);
  transfer.setData('text/plain', `${PLAN_CATALOG_TEXT_PREFIX}${json}`);
}
