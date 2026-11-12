/**
 * 3D 物料卡 → 对应的 2D 平面贴纸。
 *
 * 先按名称/slug 在物件库清单里找最接近的一条；找不到时用该类目的代表贴纸，
 * 人物模型则跟劳动力角色用同一套图标。清单未载入时也能落到类目默认值。
 */
import { CROWD_GROUP_LABEL, materialGroupLabel } from './material-taxonomy';
import { crowdTypeIdForModelSlug, type CrowdTypeId } from './crowd-types';
import type { LibraryEntry } from './oneplan-library';
import type { OneplanStickerDescriptor } from './oneplan-stickers';
import { workerSticker } from './oneplan-stickers';

export const GENERIC_PLAN_STICKER: OneplanStickerDescriptor = {
  kind: 'icon',
  slug: 'information-point',
  icon: 'shapes',
};

/** 基础设施 17 类 + 不同人群：找不到具体贴纸时用的代表图标。 */
export const CATEGORY_PLAN_STICKERS: Readonly<Record<string, OneplanStickerDescriptor>> = {
  '视听设备': { kind: 'icon', slug: 'pa-speakers', icon: 'shapes' },
  '屏障': { kind: 'scale', slug: 'concrete-block', icon: 'shapes' },
  '品牌标识': { kind: 'icon', slug: 'feather-flag', icon: 'shapes' },
  '广播': { kind: 'icon', slug: 'camera-fixed', icon: 'shapes' },
  '电气设备': { kind: 'scale', slug: 'generator', icon: 'shapes' },
  '食品饮料': { kind: 'scale', slug: 'food-trailer', icon: 'truck' },
  '家具': { kind: 'scale', slug: 'chair', icon: 'shapes' },
  '地面及轨道': { kind: 'scale', slug: 'metal-trackway', icon: 'shapes' },
  '景点': { kind: 'scale', slug: 'stage', icon: 'layout-grid' },
  '安全保障': { kind: 'icon', slug: 'security-checkpoint', icon: 'user-plus' },
  '建筑物': { kind: 'scale', slug: 'tent', icon: 'tent' },
  '卫生间': { kind: 'scale', slug: 'portable-toilet', icon: 'door-open' },
  '交通管理': { kind: 'icon', slug: 'cone', icon: 'shapes' },
  '运输': { kind: 'icon', slug: 'load-zone', icon: 'route' },
  '车辆': { kind: 'scale', slug: 'van', icon: 'truck' },
  '废物处理': { kind: 'icon', slug: 'waste-and-recycling-point', icon: 'list' },
  '供水和卫生设施': { kind: 'icon', slug: 'hand-wash-station', icon: 'shapes' },
  [CROWD_GROUP_LABEL]: { kind: 'icon', slug: 'information-point', icon: 'users' },
};

export const CROWD_TYPE_PLAN_STICKERS: Readonly<Record<CrowdTypeId, OneplanStickerDescriptor>> = {
  staff: { kind: 'icon', slug: 'information-point', icon: 'users' },
  security: { kind: 'icon', slug: 'police', icon: 'users' },
  police: { kind: 'icon', slug: 'police', icon: 'users' },
  medical: { kind: 'icon', slug: 'first-aid-point', icon: 'users' },
  fire: { kind: 'icon', slug: 'fire-extinguisher', icon: 'users' },
  volunteer: { kind: 'icon', slug: 'welfare-point', icon: 'users' },
  manager: { kind: 'icon', slug: 'event-control', icon: 'users' },
  admin: { kind: 'icon', slug: 'event-control', icon: 'users' },
  performer: { kind: 'scale', slug: 'stage', icon: 'layout-grid' },
  exhibitor: { kind: 'scale', slug: 'market-stall', icon: 'tent' },
  audience: { kind: 'area', slug: 'crowd', icon: 'users' },
};

export interface PlanIconModel {
  name: string;
  originalName?: string;
  slug?: string;
  bucket?: string;
}

const MATCH_MIN_SCORE = 55;

function tokens(text: string): string[] {
  const latin = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const zh = text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  return [
    ...latin.filter(token => token.length >= 3 || token === 'tv' || token === 'led' || token === 'vip' || token === 'pa'),
    ...zh,
  ];
}

function haystack(model: PlanIconModel): string {
  return [model.name, model.originalName ?? '', model.slug ?? ''].join(' ').toLowerCase().replace(/[_-]+/g, ' ');
}

function entryScore(model: PlanIconModel, entry: LibraryEntry, group: string): number {
  const hay = haystack(model);
  const nameZh = entry.nameZh.trim();
  const nameEn = entry.nameEn.trim().toLowerCase();
  let score = 0;
  if (nameZh.length >= 2 && (model.name.includes(nameZh) || nameZh.includes(model.name.trim()))) score += 80;
  if (nameEn.length >= 3 && hay.includes(nameEn)) score += 70;
  const slugPhrase = entry.slug.replace(/-/g, ' ');
  if (slugPhrase.length >= 3 && hay.includes(slugPhrase)) score += 60;
  const modelTokens = new Set(tokens([model.name, model.originalName ?? '', model.slug ?? ''].join(' ')));
  const overlap = tokens([entry.nameZh, entry.nameEn, entry.slug].join(' ')).filter(token => modelTokens.has(token) || hay.includes(token));
  score += overlap.length * 12;
  if (group && entry.categoryZh.includes(group)) score += 8;
  if (entry.kind === 'scale') score += 3;
  return score;
}

function bestLibraryMatch(model: PlanIconModel, entries: readonly LibraryEntry[], group: string): LibraryEntry | null {
  let best: LibraryEntry | null = null;
  let bestScore = 0;
  for (const entry of entries) {
    const score = entryScore(model, entry, group);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return bestScore >= MATCH_MIN_SCORE ? best : null;
}

/** 给一张物料卡找对应的 2D 平面图标。 */
export function planStickerForModel(
  model: PlanIconModel,
  entries: readonly LibraryEntry[] = [],
): OneplanStickerDescriptor {
  const group = materialGroupLabel(model.bucket ?? '');
  if (group === CROWD_GROUP_LABEL) {
    const typeId = model.slug ? crowdTypeIdForModelSlug(model.slug) : null;
    if (typeId && CROWD_TYPE_PLAN_STICKERS[typeId]) return CROWD_TYPE_PLAN_STICKERS[typeId];
    const fromRole = workerSticker(model.name) ?? (model.originalName ? workerSticker(model.originalName) : null);
    if (fromRole) return fromRole;
  }
  const matched = bestLibraryMatch(model, entries, group);
  if (matched) return matched.sticker;
  return CATEGORY_PLAN_STICKERS[group] ?? GENERIC_PLAN_STICKER;
}
