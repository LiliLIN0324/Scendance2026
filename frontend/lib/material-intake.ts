import { eventOperationsSchema, type EventOperationTask, type EventOperations } from '../../supabase/functions/_shared/event-operations-contract';

/**
 * 材料起草（P1-0）：把粘贴材料逐行变成可勾选的流程单草案。
 * 只承认原文明写的时刻与负责人；日期未定时不生成时刻，缺负责人就留空。
 */
export interface IntakeDraft {
  id: string;
  title: string;
  phase: EventOperationTask['phase'];
  ownerName: string;
  /** 原文里写到的时刻（如有），仅作引用，不构成排期。 */
  timeText: string | null;
  sourceQuote: string;
  sourceLine: number;
}

const bullet = /^\s*(?:[-*•]|\d+[.)])\s*/;
const heading = /^\s*#{1,6}\s*/;
const ownerPattern = /(?:负责人|执行人)\s*[：:]\s*([^\s，,；;。]+)/;
const timePattern = /(?:^|\s)((?:[01]?\d|2[0-3]):[0-5]\d)(?:\s*[-–~至]\s*((?:[01]?\d|2[0-3]):[0-5]\d))?/;

/** 同一份材料重复粘贴时给出同样的顺序与内容（id 除外），便于人眼对照。 */
export function parseMaterialIntake(text: string): IntakeDraft[] {
  const drafts: IntakeDraft[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim() || heading.test(raw)) return;
    const quote = raw.trim();
    let body = quote.replace(bullet, '').trim();
    const owner = ownerPattern.exec(body)?.[1]?.trim() ?? '';
    body = body.replace(ownerPattern, '').replace(/[（(]\s*[)）]/g, '').trim();
    const timeMatch = timePattern.exec(body);
    const timeText = timeMatch ? `${timeMatch[1]}${timeMatch[2] ? `–${timeMatch[2]}` : ''}` : null;
    body = body.replace(timePattern, ' ').replace(/\s{2,}/g, ' ').replace(/^[：:、,，\s]+|[：:、,，\s]+$/g, '').trim();
    const title = body.slice(0, 120).trim();
    if (!title) return;
    const dedupe = `${title}|${timeText ?? ''}|${owner}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    drafts.push({ id: crypto.randomUUID(), title, phase: 'preparation',
      ownerName: owner, timeText, sourceQuote: quote, sourceLine: index + 1 });
  });
  return drafts;
}

export interface IntakeAcceptance {
  operations: EventOperations;
  addedTaskIds: string[];
  receipt: { projectId: string; acceptedDraftIds: string[]; acceptedAt: string };
}

/** 接受勾选草案：按标题去重，已有同标题任务时不覆盖、不重复写入。 */
export function acceptIntakeDrafts(
  operations: EventOperations, drafts: readonly IntakeDraft[], selectedIds: readonly string[],
  meta: { projectId: string; acceptedAt: string },
): IntakeAcceptance {
  const current = eventOperationsSchema.parse(operations);
  const selected = new Set(selectedIds);
  const chosen = drafts.filter(draft => selected.has(draft.id));
  if (chosen.length === 0) throw new Error('请先勾选要写入的草案。');
  if (!Number.isFinite(Date.parse(meta.acceptedAt))) throw new Error('请记录有效的接受时间。');
  const known = new Set(current.tasks.map(task => task.title.trim()));
  const added = chosen.filter(draft => !known.has(draft.title.trim()))
    .map(draft => ({ id: crypto.randomUUID(), title: draft.title, phase: draft.phase,
      ownerName: draft.ownerName, objectIds: [] as string[] }));
  if (added.length === 0) throw new Error('勾选的草案都已在流程单中。');
  const operationsNext = eventOperationsSchema.parse({ ...current, tasks: [...current.tasks, ...added] });
  return { operations: operationsNext, addedTaskIds: added.map(task => task.id),
    receipt: { projectId: meta.projectId, acceptedDraftIds: chosen.map(draft => draft.id), acceptedAt: meta.acceptedAt } };
}
