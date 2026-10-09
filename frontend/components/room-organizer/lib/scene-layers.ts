import { preserveCurrentActivity, restoreDesignActivity, syncDesignWorkOrders } from '../../../lib/production-plan';
import type { FurnitureItem, RoomLayout } from './types';

export const MAX_DESIGNS = 20;
export function designSnapshot(layout: RoomLayout): Omit<RoomLayout, 'designBook'> {
  const { designBook: _book, ...snapshot } = layout;
  return snapshot;
}

export function addDesign(base: RoomLayout, candidate: RoomLayout): RoomLayout {
  base = syncDesignWorkOrders(base);
  candidate = preserveCurrentActivity(base, candidate);
  const book = base.designBook ?? { activeId: 'original', variants: [{ id: 'original', name: '原始方案', layout: designSnapshot(base) }] };
  if (book.variants.length >= MAX_DESIGNS) throw new Error('本机已保留 20 个方案，请先在图层面板移除不再需要的方案。');
  const variants = book.variants.map(v => v.id === book.activeId ? { ...v, layout: designSnapshot(base) } : v);
  const id = crypto.randomUUID();
  let letter = 0;
  while (variants.some(v => v.name === `AI 方案 ${String.fromCharCode(65 + letter)}`)) letter++;
  return { ...designSnapshot(candidate), designBook: { activeId: id, variants: [...variants, { id, name: `AI 方案 ${String.fromCharCode(65 + letter)}`, layout: designSnapshot(candidate) }] } };
}

export function switchDesign(base: RoomLayout, id: string): RoomLayout {
  if (!base.designBook?.variants.some(variant => variant.id === id) || id === base.designBook.activeId) return base;
  base = syncDesignWorkOrders(base);
  const book = base.designBook;
  const selected = book?.variants.find(v => v.id === id);
  if (!book || !selected || id === book.activeId) return base;
  return { ...restoreDesignActivity(base, selected.layout), ...(base.id ? { id: base.id } : {}), designBook: { activeId: id,
    variants: book.variants.map(v => v.id === book.activeId ? { ...v, layout: designSnapshot(base) } : v) } };
}

export function materialLayers(items: readonly FurnitureItem[]): { id: string; name: string; itemIds: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    if (item.venueEntranceId || item.structuralOpeningId || item.structuralColumnId) continue;
    const type = `${item.materialId ?? ''} ${item.type} ${item.name}`;
    const name = /chair|seat|sofa|椅|座|沙发/i.test(type) ? '全部椅子' : /table|desk|桌/i.test(type) ? '全部桌子' : '其他物料';
    groups.set(name, [...(groups.get(name) ?? []), item.id]);
  }
  return [...groups].map(([name, itemIds]) => ({ id: name, name, itemIds }));
}

export function batchLayerEdit(items: readonly FurnitureItem[], ids: ReadonlySet<string>, delta: { x: number; y: number; z: number; color?: string }): FurnitureItem[] {
  // User-facing X/Y are horizontal; the renderer stores that plane as x/z.
  return items.map(item => {
    if (!ids.has(item.id) || item.locked || item.venueEntranceId || item.structuralOpeningId || item.structuralColumnId) return item;
    const elevation = (item.elevation ?? 0) + delta.z;
    if (delta.z && (elevation < (item.glbNode ? -100 : 0) || elevation > (item.glbNode ? 100 : 30))) throw new Error('部分物料的高度超出允许范围，整组保持原位。');
    return { ...item, ...(item.position && (delta.x || delta.y) ? { position: { x: item.position.x + delta.x, z: item.position.z + delta.y } } : {}),
      ...(delta.z ? { elevation } : {}),
      ...(delta.color && !item.glbUrl ? { color: delta.color } : {}) };
  });
}
