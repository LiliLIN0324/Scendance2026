import { eventOperationsSchema, eventOperationTaskSchema, type EventOperationTask, type EventOperations } from '../../supabase/functions/_shared/event-operations-contract';
import { productionReferenceKey } from './production-plan';
import type { RoomLayout } from '../components/room-organizer/lib/types';

/**
 * 材料起草（P1-0）：把制作需求里尚无任务的行转成待确认草案。
 * 只搬运计划里已有的标题、方式与物件编号；不补数量、价格、供应商或时间。
 */
const methodLabels = {
  existing: '调拨', rental: '租赁', purchase: '采购', fabrication: '制作', unspecified: '准备',
} as const;

export interface MaterialTaskDraft {
  acquisitionId: string;
  method: keyof typeof methodLabels;
  task: EventOperationTask;
  /** 说明起草依据，不是事实判断，也不代表已落实。 */
  reason: string;
}

const key = productionReferenceKey;

export function draftMaterialTasks(layout: RoomLayout): MaterialTaskDraft[] {
  const plan = layout.productionPlan, operations = layout.eventOperations;
  if (!plan) return [];
  if (operations && operations.dataKind !== plan.dataKind) throw new Error('制作资料与活动安排性质不同，请先核对。');
  const existing = new Set((operations?.tasks ?? []).map(task => key(task.id)));
  return plan.acquisitions.flatMap(acquisition => {
    const linkedIds = acquisition.taskIds.map(key);
    if (linkedIds.some(id => existing.has(id))) return [];
    const title = `${methodLabels[acquisition.method]}：${acquisition.title}`.slice(0, 120).trim();
    return [{
      acquisitionId: acquisition.id, method: acquisition.method,
      task: eventOperationTaskSchema.parse({ id: crypto.randomUUID(), title, phase: 'preparation',
        objectIds: [...acquisition.objectIds] }),
      reason: linkedIds.length > 0 ? '原关联任务已不在活动安排中' : '该需求尚无对应任务',
    }];
  });
}

/** 追加草案到现有安排，保留资料性质并拒绝重复编号；不写入任何地方。 */
export function appendMaterialTasks(operations: EventOperations, drafts: readonly MaterialTaskDraft[]): EventOperations {
  const current = eventOperationsSchema.parse(operations);
  const known = new Set(current.tasks.map(task => key(task.id)));
  const added = drafts.map(draft => eventOperationTaskSchema.parse(draft.task)).filter(task => !known.has(key(task.id)));
  return eventOperationsSchema.parse({ ...current, tasks: [...current.tasks, ...added] });
}
