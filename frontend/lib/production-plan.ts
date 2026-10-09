import { uuid } from '../../supabase/functions/_shared/domain';
import { productionPlanSchema, type ProductionPlan } from '../../supabase/functions/_shared/production-plan-contract';
import type { FurnitureItem, RoomLayout } from '../components/room-organizer/lib/types';

/** Decimal yuan input, converted exactly to safe integer fen; blank means unknown. */
export function parseMoneyMinor(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('金额请填写非负数字，最多两位小数。');
  const [whole, fraction = ''] = text.split('.');
  const minor = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('金额超过可安全记录的范围。');
  return Number(minor);
}

export function formatMoneyMinor(value: number | null): string {
  if (value === null) return '';
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('金额记录无效。');
  const amount = BigInt(value), hundred = BigInt(100);
  return `${amount / hundred}.${String(amount % hundred).padStart(2, '0')}`;
}

export const productionReferenceKey = (id: string): string => uuid.safeParse(id).success ? id.toLowerCase() : id;
const key = productionReferenceKey;
const matches = (values: readonly string[], ids: readonly string[]) => values.some(value => ids.some(id => key(value) === key(id)));
const ordered = <T extends {id: string}>(rows: T[]) => [...rows].sort((a,b)=>key(a.id).localeCompare(key(b.id)));

/** Only explicit task-linked acquisitions expand the physical review scope. */
export function productionTaskObjectIds(plan: ProductionPlan | undefined, taskId: string): string[] {
  if (!plan) return [];
  const ids = new Map<string,string>();
  for (const row of productionPlanSchema.parse(plan).acquisitions) {
    if (!matches(row.taskIds,[taskId])) continue;
    for (const id of row.objectIds) if (!ids.has(key(id))) ids.set(key(id),id);
  }
  return [...ids.values()];
}

/** Financial estimates alone do not invalidate an on-site execution check. */
export function productionTaskBasis(plan: ProductionPlan | undefined, taskId: string, objectIds: readonly string[]): unknown | null {
  if (!plan) return null;
  const valid = productionPlanSchema.parse(plan);
  const staffing = ordered(valid.staffing.filter(row=>matches(row.taskIds,[taskId])));
  const acquisitions = ordered(valid.acquisitions.filter(row=>matches(row.taskIds,[taskId])||matches(row.objectIds,objectIds)));
  return staffing.length || acquisitions.length ? { dataKind:valid.dataKind,staffing,acquisitions } : null;
}

export function productionObjectBasis(plan: ProductionPlan | undefined, objectId: string): unknown | null {
  if (!plan) return null;
  const valid = productionPlanSchema.parse(plan);
  const acquisitions = ordered(valid.acquisitions.filter(row=>matches(row.objectIds,[objectId])));
  return acquisitions.length ? {dataKind:valid.dataKind,acquisitions} : null;
}

/** A design changes geometry; the current project's activity records remain authoritative. */
export function preserveCurrentActivity(base: RoomLayout, candidate: RoomLayout): RoomLayout {
  const { eventOperations: _operations, productionPlan: _production, designBook: _incomingBook, ...scene } = candidate;
  const book = syncDesignWorkOrders(base).designBook;
  const items = new Map(base.floors.flatMap(floor=>floor.items.map(item=>[key(item.id),item] as const)));
  return { ...scene, floors:scene.floors.map(floor=>({...floor,items:floor.items.map(item=>{
    const {handoff:_incomingHandoff,...physical}=item,previous=items.get(key(item.id));
    return previous?.handoff ? {...physical,handoff:structuredClone(previous.handoff)} : physical;
  })})),
    ...(base.eventOperations !== undefined ? {eventOperations:base.eventOperations} : {}),
    ...(base.productionPlan !== undefined ? {productionPlan:base.productionPlan} : {}),
    ...(book ? { designBook: book } : {}),
  };
}

/** Saved alternatives share work orders, while keeping their own geometry.
 * An existing item with no handoff explicitly clears its saved copies. Missing
 * items are untouched: another design may still contain them. No new schema or
 * mutable side cache is needed, so undo and local backups retain the same facts.
 */
export function syncDesignWorkOrders(layout: RoomLayout, source: RoomLayout = layout): RoomLayout {
  if (!layout.designBook) return layout;
  const items = new Map(source.floors.flatMap(floor => floor.items.map(item => [key(item.id), item] as const)));
  let changed = false;
  const variants = layout.designBook.variants.map(variant => {
    let variantChanged = false;
    const floors = variant.layout.floors.map(floor => {
      let floorChanged = false;
      const copies = floor.items.map(item => {
        const current = items.get(key(item.id));
        if (!current || JSON.stringify(item.handoff) === JSON.stringify(current.handoff)) return item;
        floorChanged = true;
        return copyWorkOrder(item, current);
      });
      if (!floorChanged) return floor;
      variantChanged = true;
      return { ...floor, items: copies };
    });
    if (!variantChanged) return variant;
    changed = true;
    return { ...variant, layout: { ...variant.layout, floors } };
  });
  return changed ? { ...layout, designBook: { ...layout.designBook, variants } } : layout;
}

function copyWorkOrder(item: FurnitureItem, source: FurnitureItem): FurnitureItem {
  const { handoff: _old, ...physical } = item;
  return source.handoff ? { ...physical, handoff: structuredClone(source.handoff) } : physical;
}

/** Only for an already saved alternative, never an incoming AI/template layout. */
export function restoreDesignActivity(base: RoomLayout, saved: RoomLayout): RoomLayout {
  const result = preserveCurrentActivity(base, saved);
  const present = new Set(base.floors.flatMap(floor => floor.items.map(item => key(item.id))));
  const savedItems = new Map(saved.floors.flatMap(floor => floor.items.map(item => [key(item.id), item] as const)));
  return { ...result, floors: result.floors.map(floor => ({ ...floor, items: floor.items.map(item => {
    const previous = savedItems.get(key(item.id));
    return !present.has(key(item.id)) && previous?.handoff ? copyWorkOrder(item, previous) : item;
  }) })) };
}
