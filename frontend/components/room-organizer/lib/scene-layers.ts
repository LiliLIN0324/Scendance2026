import { preserveCurrentActivity, restoreDesignActivity, syncDesignWorkOrders } from '../../../lib/production-plan';
import type { DesignVariant, FurnitureItem, RoomLayout, VariantSaveMeta } from './types';
import { stripVariantBusinessKeys, type VariantBusinessKey } from './variant-business-keys';

export const MAX_DESIGNS = 20;
export function designSnapshot(layout: RoomLayout): Omit<RoomLayout, 'designBook'> {
  const { designBook: _book, ...snapshot } = layout;
  return snapshot;
}

/** 把保存元数据收敛成只含已定义键的变体片段；未传字段不写入，避免挂悬空 ref 或可选键带 undefined。 */
function variantMeta(meta?: VariantSaveMeta): Partial<DesignVariant> {
  return {
    ...(meta?.operationsRef ? { operationsRef: meta.operationsRef } : {}),
    ...(meta?.planRef ? { planRef: meta.planRef } : {}),
    ...(meta?.scan ? { scan: meta.scan } : {}),
    ...(meta?.summary ? { summary: meta.summary } : {}),
  };
}

export function addDesign(base: RoomLayout, candidate: RoomLayout, meta?: VariantSaveMeta): RoomLayout {
  base = syncDesignWorkOrders(base);
  candidate = preserveCurrentActivity(base, candidate);
  const book = base.designBook ?? { activeId: 'original', variants: [{ id: 'original', name: '原始方案', layout: variantSnapshot(base) }] };
  if (book.variants.length >= MAX_DESIGNS) throw new Error('本机已保留 20 个方案，请先在图层面板移除不再需要的方案。');
  const variants = book.variants.map(v => v.id === book.activeId ? { ...v, layout: variantSnapshot(base) } : v);
  const id = crypto.randomUUID();
  let letter = 0;
  while (variants.some(v => v.name === `AI 方案 ${String.fromCharCode(65 + letter)}`)) letter++;
  return { ...designSnapshot(candidate), designBook: { activeId: id, variants: [...variants, { id, name: `AI 方案 ${String.fromCharCode(65 + letter)}`, layout: variantSnapshot(candidate), ...variantMeta(meta) }] } };
}

export function switchDesign(base: RoomLayout, id: string): RoomLayout {
  if (!base.designBook?.variants.some(variant => variant.id === id) || id === base.designBook.activeId) return base;
  base = syncDesignWorkOrders(base);
  const book = base.designBook;
  const selected = book?.variants.find(v => v.id === id);
  if (!book || !selected || id === book.activeId) return base;
  return { ...restoreDesignActivity(base, selected.layout), ...(base.id ? { id: base.id } : {}), designBook: { activeId: id,
    variants: book.variants.map(v => v.id === book.activeId ? { ...v, layout: variantSnapshot(base) } : v) } };
}

/**
 * 变体条目快照：剥离 designBook、属整场活动的 eventProfile，以及业务副本三键
 * （eventOperations/productionPlan/venueScan）。几何与物料状态原样保留；
 * 顶层当前会话 layout 仍走 `designSnapshot`，保留现役业务字段，不由此函数剥离。
 */
function variantSnapshot(layout: RoomLayout): Omit<RoomLayout, 'designBook' | 'eventProfile' | VariantBusinessKey> {
  const { designBook: _book, eventProfile: _profile, ...rest } = layout;
  return stripVariantBusinessKeys(rest);
}

/** 把当前整包布局另存为一个手动过程态快照，不切换当前方案。 */
export function saveDesignSnapshot(base: RoomLayout, input: { name: string; note?: string; savedAt?: string }, meta?: VariantSaveMeta): RoomLayout {
  base = syncDesignWorkOrders(base);
  const book = base.designBook ?? { activeId: 'original', variants: [{ id: 'original', name: '原始方案', layout: variantSnapshot(base) }] };
  if (book.variants.length >= MAX_DESIGNS) throw new Error('本机已保留 20 个方案，请先移除不再需要的过程态。');
  const note = input.note?.trim();
  const id = crypto.randomUUID();
  const fallback = `过程态 ${book.variants.length}`;
  return { ...base, designBook: { activeId: book.activeId, variants: [...book.variants, {
    id,
    name: input.name.trim() || fallback,
    layout: variantSnapshot(base),
    origin: 'manual',
    savedAt: input.savedAt ?? new Date().toISOString(),
    ...(note ? { note } : {}),
    ...variantMeta(meta),
  }] } };
}

/** 移除一个非当前、非基线的过程态快照；当前态与「原始方案」保留。 */
export function removeDesignVariant(base: RoomLayout, id: string): RoomLayout {
  const book = base.designBook;
  if (!book || id === book.activeId || id === 'original') return base;
  const target = book.variants.find(variant => variant.id === id);
  if (!target) return base;
  return { ...base, designBook: { activeId: book.activeId, variants: book.variants.filter(variant => variant.id !== id) } };
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
