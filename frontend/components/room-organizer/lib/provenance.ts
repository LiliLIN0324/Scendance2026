import type { FurnitureItem, ItemOrigin, ItemProvenance, RoomLayout } from './types';

export const ITEM_ORIGINS = ['proposal', 'import', 'template', 'cloud', 'venue', 'manual'] as const satisfies readonly ItemOrigin[];

export const ITEM_ORIGIN_LABELS: Record<ItemOrigin, string> = {
  proposal: '助手方案',
  import: '文件导入',
  template: '模板',
  cloud: '云端方案',
  venue: '场地工具',
  manual: '手动',
};

export function isItemProvenance(value: unknown): value is ItemProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (!ITEM_ORIGINS.includes(entry.origin as ItemOrigin)) return false;
  if (typeof entry.at !== 'string' || Number.isNaN(Date.parse(entry.at))) return false;
  return entry.ref === undefined || typeof entry.ref === 'string';
}

export function itemProvenance(origin: ItemOrigin, at = new Date(), ref?: string): ItemProvenance {
  return { origin, at: at.toISOString(), ...(ref ? { ref } : {}) };
}

export function provenanceText(provenance: ItemProvenance): string {
  return `${ITEM_ORIGIN_LABELS[provenance.origin]}@${provenance.at}${provenance.ref ? ` (${provenance.ref})` : ''}`;
}

/** Identity of the authored instance: a changed signature means the origin writer replaced it. */
export function itemSignature(item: FurnitureItem): string {
  return JSON.stringify([
    item.type,
    item.name,
    item.assetId ?? item.materialId ?? null,
    item.glbNode ?? null,
    item.width,
    item.depth,
    item.height,
    item.color,
    item.position ?? null,
    item.rotation ?? 0,
    item.elevation ?? 0,
    item.mirrored ?? false,
    item.groupId ?? null,
  ]);
}

function rewriteItems(layout: RoomLayout, rewrite: (item: FurnitureItem) => FurnitureItem): RoomLayout {
  let changed = false;
  const floors = layout.floors.map((floor) => {
    let floorChanged = false;
    const items = floor.items.map((item) => {
      const next = rewrite(item);
      if (next !== item) {
        floorChanged = true;
        changed = true;
      }
      return next;
    });
    return floorChanged ? { ...floor, items } : floor;
  });
  return changed ? { ...layout, floors } : layout;
}

/**
 * Stamp only the instances a proposal added or changed. Untouched items keep
 * their earlier provenance so a later AI pass cannot erase where they came from.
 */
export function stampChangedItems(
  previous: RoomLayout | undefined,
  next: RoomLayout,
  stamp: ItemProvenance
): RoomLayout {
  const before = new Map((previous?.floors ?? []).flatMap((floor) => floor.items).map((item) => [item.id, item]));
  return rewriteItems(next, (item) => {
    const prior = before.get(item.id);
    if (prior && itemSignature(prior) === itemSignature(item)) return item;
    return { ...item, provenance: stamp };
  });
}

/** An imported file claims every instance it did not already carry provenance for. */
export function stampImportedItems(layout: RoomLayout, stamp: ItemProvenance): RoomLayout {
  return rewriteItems(layout, (item) => (item.provenance ? item : { ...item, provenance: stamp }));
}
