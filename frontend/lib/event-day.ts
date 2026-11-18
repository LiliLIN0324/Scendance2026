import { eventOperationPhases, type EventOperationTask } from '../../supabase/functions/_shared/event-operations-contract';
import type { RoomLayout } from '../components/room-organizer/lib/types';

/** 流程单行的时长与完整性（P1-1）：时长只算不存；缺任一端即不完整。 */
export interface TaskTiming {
  durationMinutes: number | null;
  omissions: ('start' | 'end' | 'owner')[];
  complete: boolean;
}

export function taskTiming(task: EventOperationTask): TaskTiming {
  const omissions: TaskTiming['omissions'] = [];
  if (task.plannedStartAt === null) omissions.push('start');
  if (task.plannedEndAt === null) omissions.push('end');
  if (!task.ownerName.trim()) omissions.push('owner');
  const durationMinutes = task.plannedStartAt !== null && task.plannedEndAt !== null
    ? Math.round((Date.parse(task.plannedEndAt) - Date.parse(task.plannedStartAt)) / 60000) : null;
  return { durationMinutes: durationMinutes !== null && durationMinutes >= 0 ? durationMinutes : null, omissions,
    complete: omissions.length === 0 };
}

/** 三要素（起、止、具名负责人）不齐不得进 review；承接团队不能顶替负责人。 */
export function canEnterReview(task: EventOperationTask): boolean {
  return task.ownerName.trim().length > 0 && task.plannedStartAt !== null && task.plannedEndAt !== null
    && Date.parse(task.plannedEndAt) >= Date.parse(task.plannedStartAt);
}

/** 当天检查清单（P1-2）：按现场顺序分组，空组不出现；不合并物料点验。 */
const dayPhases = ['setup', 'event', 'teardown'] as const;
const phaseLabels: Record<(typeof dayPhases)[number], string> = { setup: '进场与布置', event: '签到与运行', teardown: '撤场' };

export interface DayChecklistItem {
  taskId: string;
  title: string;
  ownerName: string;
  plannedStartAt: string | null;
  status: EventOperationTask['status'];
  done: boolean;
}

export interface DayChecklistSection {
  phase: (typeof dayPhases)[number];
  label: string;
  items: DayChecklistItem[];
}

export function dayChecklist(layout: RoomLayout): { dataKind: 'unspecified' | 'rehearsal' | 'real'; sections: DayChecklistSection[] } {
  const operations = layout.eventOperations;
  if (!operations) return { dataKind: 'unspecified', sections: [] };
  const sections = dayPhases.flatMap(phase => {
    const items = operations.tasks.filter(task => task.phase === phase).sort((a, b) =>
      (a.plannedStartAt ?? '9999').localeCompare(b.plannedStartAt ?? '9999') || a.title.localeCompare(b.title))
      .map(task => ({ taskId: task.id, title: task.title, ownerName: task.ownerName,
        plannedStartAt: task.plannedStartAt, status: task.status, done: task.status === 'accepted' }));
    return items.length ? [{ phase, label: phaseLabels[phase], items }] : [];
  });
  return { dataKind: operations.dataKind, sections };
}

export const eventOperationPhaseOrder = eventOperationPhases;
