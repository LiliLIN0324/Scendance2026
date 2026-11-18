import type { LibraryEntry } from './oneplan-library';

/**
 * 「室内」段（用户 2026-11-18 三轮收敛后的口径）。
 *
 * 原来我把整格「建筑物」升成一级段，里面全装着帐篷、厕所、垃圾箱、龙门架——用户纠正：
 * 这一段只放室内真会用到的那几件，其余回「基础设施 · 建筑物」原位。
 *
 * 现在固定四类，顺序即树里的顺序：
 *   楼梯、电梯（垂直交通）→ 墙体、窗户（本地补的两个图标）→ 门系列（单开/双开/推拉/旋转/卷帘/折叠）
 *
 * 门原本挂在「活动区域·流线与通行 / 出入口与通行图标」那组，跟入口、出口、闸门、储物柜混在一起；
 * 用户 2026-11-18 指出「门在这里啊，把该挪出来的挪出来」——门是建筑构件，不是通行图标，
 * 所以从这里统一挑走，入口那组只留入口/出口/通道/闸门/储物柜这类通行符号。
 *
 * 只做展示与归类，不改 manifest 的 category 口径，也不往落盘数据里加字段。
 */
export const INDOOR_ROW_LABEL = '室内';

/** 门系列：库里六个门型，全部从「入口和通道图标」挪到室内段。 */
export const DOOR_SLUGS = [
  'door',
  'double-door',
  'sliding-door',
  'revolving-door',
  'roller-shutter',
  'folding-door',
] as const;

/** 室内段的固定条目（slug 顺序即树的顺序）。 */
export const INDOOR_SLUG_ORDER = [
  'stairs',
  'elevator',
  'wall',
  'window',
  ...DOOR_SLUGS,
] as const;

export type IndoorSlug = (typeof INDOOR_SLUG_ORDER)[number];

export function isIndoorEntry(entry: LibraryEntry): boolean {
  return (INDOOR_SLUG_ORDER as readonly string[]).includes(entry.slug);
}

/** 把室内条目从任何一划里挑走（入口图标、基础设施·建筑物都用它，免得两处各写一份）。 */
export function withoutIndoor<T extends LibraryEntry>(entries: readonly T[]): T[] {
  return entries.filter(entry => !isIndoorEntry(entry));
}

/**
 * 一段里同一 slug 只出一件：楼梯在库里是 scale 两版（scale-fg / scale-bg，带占地），
 * 优先取 scale；其余走 icon。缺的条目直接跳过，不占空位。
 */
export function indoorItems(entries: readonly LibraryEntry[]): LibraryEntry[] {
  const bySlug = new Map<string, LibraryEntry>();
  for (const entry of entries) {
    if (!isIndoorEntry(entry)) continue;
    const current = bySlug.get(entry.slug);
    if (!current || (current.kind !== 'scale' && entry.kind === 'scale')) bySlug.set(entry.slug, entry);
  }
  return INDOOR_SLUG_ORDER.flatMap(slug => {
    const entry = bySlug.get(slug);
    return entry ? [entry] : [];
  });
}
