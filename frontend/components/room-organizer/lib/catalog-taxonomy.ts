import type { FurnitureCategory } from './types';

/**
 * Event-layout groups shared by the parametric catalog and the online prop rail.
 *
 * blueprint3d-modern hangs a Metadata record (name, item type) off each item and
 * lets a factory choose floor / wall / in-wall behaviour. react-planner registers
 * a category as `{ name, label }` and a property as `{ type, defaultValue }`,
 * with `length-measure` shown in the catalog unit. This table is that idea:
 * one name, one label, and a membership list. It is not a second catalog runtime,
 * and it does not store a second length. Lengths stay metres; `formatLengthMetres`
 * only labels them.
 */
export const CATALOG_GROUPS = [
  { key: 'stage', label: '舞台', icon: '台', members: ['stage'] },
  { key: 'checkin', label: '签到', icon: '签', members: ['checkin'] },
  { key: 'booth', label: '展位', icon: '展', members: ['booth', 'exhibition'] },
  { key: 'seating', label: '座席', icon: '席', members: ['seating'] },
  { key: 'tables', label: '桌台', icon: '桌', members: ['tables'] },
  { key: 'av', label: '视听', icon: '听', members: ['av', 'audio', 'lighting', 'digital', 'electronics', 'security'] },
  { key: 'decor', label: '布景', icon: '景', members: ['decor', 'plants'] },
  { key: 'signage', label: '导视', icon: '导', members: ['signage'] },
  { key: 'people', label: '人物', icon: '人', members: ['people'] },
  { key: 'catering', label: '餐饮', icon: '餐', members: ['catering', 'food', 'kitchen'] },
  { key: 'rest', label: '休息', icon: '休', members: ['rest', 'bedroom'] },
  { key: 'logistics', label: '后勤', icon: '后', members: ['logistics', 'storage', 'tools', 'bathroom'] },
  { key: 'structure', label: '结构', icon: '构', members: ['structure'] },
  { key: 'site', label: '场地', icon: '场', members: ['site', 'outdoor', 'sports', 'vehicles', 'scenes'] },
] as const satisfies readonly {
  key: FurnitureCategory;
  label: string;
  icon: string;
  members: readonly string[];
}[];

export type CatalogGroupKey = (typeof CATALOG_GROUPS)[number]['key'];

const GROUP_BY_MEMBER = new Map<string, CatalogGroupKey>();
for (const group of CATALOG_GROUPS) {
  GROUP_BY_MEMBER.set(group.key, group.key);
  for (const member of group.members) GROUP_BY_MEMBER.set(member, group.key);
}

/** The event group a stored category or online bucket belongs to. Unknown keys pass through. */
export function catalogGroupKey(bucketOrCategory: string): string {
  return GROUP_BY_MEMBER.get(bucketOrCategory) ?? bucketOrCategory;
}

/** Rail / legend label. Empty input is the catch-all chip, not a blank one. */
export function catalogGroupLabel(bucketOrCategory: string): string {
  if (!bucketOrCategory) return '其他';
  const key = catalogGroupKey(bucketOrCategory);
  return CATALOG_GROUPS.find(group => group.key === key)?.label ?? bucketOrCategory;
}

/**
 * A rail chip passes its group key. A raw bucket (`audio`) still matches itself,
 * so older filters keep working.
 */
export function matchesCatalogFilter(bucketOrCategory: string, filter: string): boolean {
  if (!filter) return true;
  if (bucketOrCategory === filter) return true;
  return catalogGroupKey(bucketOrCategory) === filter;
}
