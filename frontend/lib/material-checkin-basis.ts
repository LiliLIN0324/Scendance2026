import { canonical } from '../../supabase/functions/_shared/domain';
import { eventOperationTaskSchema, type EventOperationTask } from '../../supabase/functions/_shared/event-operations-contract';
import { materialCheckinLedgerSchema, type MaterialCheckinLedger } from '../../supabase/functions/_shared/material-checkin-contract';
import { productionPlanSchema } from '../../supabase/functions/_shared/production-plan-contract';
import type { RoomLayout } from '../components/room-organizer/lib/types';
import { productionReferenceKey } from './production-plan';

const idFields = new Set(['id', 'acquisitionId', 'targetId', 'supersedesId']);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize).sort((a, b) => compare(canonical(a), canonical(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => compare(a, b))
    .map(([name, child]) => [name, idFields.has(name) && typeof child === 'string' ? child.toLowerCase() : normalize(child)]));
  return value;
}

/** Immutable related facts only: a change invalidates a task's old basis, never completes it or infers stock. */
export function materialCheckinTaskBasis(
  layout: RoomLayout, task: Pick<EventOperationTask, 'id' | 'objectIds'>, ledger?: MaterialCheckinLedger,
): unknown | null {
  if (ledger === undefined) return null;
  const valid = materialCheckinLedgerSchema.parse(ledger);
  if (!layout.id || valid.projectId !== layout.id) throw new Error('点验账册与当前项目不一致，不能用于任务复核。');
  if (layout.productionPlan === undefined) return null;
  const plan = productionPlanSchema.parse(layout.productionPlan);
  const taskId = productionReferenceKey(eventOperationTaskSchema.shape.id.parse(task.id));
  const objectIds = new Set(eventOperationTaskSchema.shape.objectIds.parse(task.objectIds).map(productionReferenceKey));
  const acquisitions = new Set(plan.acquisitions.filter(row => row.taskIds.some(id => productionReferenceKey(id) === taskId) ||
    row.objectIds.some(id => objectIds.has(productionReferenceKey(id)))).map(row => row.id.toLowerCase()));
  const sheets = valid.sheets.filter(sheet => acquisitions.has(sheet.acquisitionId.toLowerCase()));
  if (!sheets.length) return null;
  return normalize({ projectId: valid.projectId, dataKind: valid.dataKind, sheets });
}
