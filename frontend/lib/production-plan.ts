import { uuid } from '../../supabase/functions/_shared/domain';
import { productionPlanSchema, type ProductionPlan } from '../../supabase/functions/_shared/production-plan-contract';
import type { RoomLayout } from '../components/room-organizer/lib/types';

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

const key = (id: string) => uuid.safeParse(id).success ? id.toLowerCase() : id;
const matches = (values: readonly string[], ids: readonly string[]) => values.some(value => ids.some(id => key(value) === key(id)));
const ordered = <T extends {id: string}>(rows: T[]) => [...rows].sort((a,b)=>key(a.id).localeCompare(key(b.id)));

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
  const { eventOperations: _operations, productionPlan: _production, ...scene } = candidate;
  const items = new Map(base.floors.flatMap(floor=>floor.items.map(item=>[key(item.id),item] as const)));
  return { ...scene, floors:scene.floors.map(floor=>({...floor,items:floor.items.map(item=>{
    const {handoff:_incomingHandoff,...physical}=item,previous=items.get(key(item.id));
    return previous?.handoff ? {...physical,handoff:structuredClone(previous.handoff)} : physical;
  })})),
    ...(base.eventOperations !== undefined ? {eventOperations:base.eventOperations} : {}),
    ...(base.productionPlan !== undefined ? {productionPlan:base.productionPlan} : {}),
  };
}
