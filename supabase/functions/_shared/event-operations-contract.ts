import { z } from 'zod';
import { handoffEvidenceUrlsSchema, handoffLimits } from './delivery-contract.ts';

export const eventOperationPhases = ['preparation', 'setup', 'event', 'teardown'] as const;
export const eventOperationsLimits = {
  tasks: 500, title: 120, objectIds: 500, objectId: 128,
  ownerName: handoffLimits.ownerName, contractorName: handoffLimits.ownerName,
  acceptance: handoffLimits.acceptance, evidenceNote: handoffLimits.evidenceNote,
} as const;

// Validate calendar/time syntax before Date.parse; timestamps retain the supplied offset.
const timeSchema = z.iso.datetime({ offset: true }).max(32).refine(value =>
  !value.startsWith('0000-') && !value.endsWith('-00:00') && !/\.\d{4,}/.test(value) && Number.isFinite(Date.parse(value)),
  '请使用年份大于零、明确时区且精度不超过毫秒的完整时间',
);
const objectIdSchema = z.string().min(1).max(eventOperationsLimits.objectId)
  .refine(value => value.trim().length > 0, '物料实例编号不能为空');

// Local activity metadata, separate from Scene, AI context and cloud audit records.
export const eventOperationTaskSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().trim().min(1).max(eventOperationsLimits.title),
  phase: z.enum(eventOperationPhases),
  plannedStartAt: timeSchema.nullable().default(null),
  plannedEndAt: timeSchema.nullable().default(null),
  ownerName: z.string().trim().max(eventOperationsLimits.ownerName).default(''),
  contractorName: z.string().trim().max(eventOperationsLimits.contractorName).default(''),
  acceptance: z.string().trim().max(eventOperationsLimits.acceptance).default(''),
  status: z.enum(['todo', 'doing', 'review', 'accepted']).default('todo'),
  objectIds: z.array(objectIdSchema).max(eventOperationsLimits.objectIds)
    .refine(ids => new Set(ids).size === ids.length, '物料实例编号不能重复').default([]),
  actualStartedAt: timeSchema.nullable().default(null),
  actualFinishedAt: timeSchema.nullable().default(null),
  evidenceNote: z.string().trim().max(eventOperationsLimits.evidenceNote).default(''),
  evidenceUrls: handoffEvidenceUrlsSchema.default([]),
  reviewedBasis: z.string().regex(/^sha256:[a-f0-9]{64}$/, '请使用固定 SHA-256 核对依据').optional(),
}).superRefine((task, ctx) => {
  for (const [start, end] of [
    ['plannedStartAt', 'plannedEndAt'], ['actualStartedAt', 'actualFinishedAt'],
  ] as const) {
    if (task[start] !== null && task[end] !== null && Date.parse(task[end]) < Date.parse(task[start])) {
      ctx.addIssue({ code: 'custom', path: [end], message: '结束时间不能早于开始时间' });
    }
  }
  if (task.status === 'review' || task.status === 'accepted') {
    for (const [field, message] of [['ownerName', '请填写负责人'], ['acceptance', '请填写完成条件']] as const) {
      if (!task[field]) ctx.addIssue({ code: 'custom', path: [field], message });
    }
  }
  if (task.status === 'accepted') {
    if (!task.evidenceNote) ctx.addIssue({ code: 'custom', path: ['evidenceNote'], message: '已完成须填写现场核对说明' });
    if (!task.reviewedBasis) ctx.addIssue({ code: 'custom', path: ['reviewedBasis'], message: '已完成须记录核对依据' });
  }
});

export const eventOperationsSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  dataKind: z.enum(['unspecified', 'rehearsal', 'real']).default('unspecified'),
  tasks: z.array(eventOperationTaskSchema).max(eventOperationsLimits.tasks)
    .refine(tasks => new Set(tasks.map(task => task.id.toLowerCase())).size === tasks.length, '活动任务编号不能重复').default([]),
});

export type EventOperationTask = z.infer<typeof eventOperationTaskSchema>;
export type EventOperations = z.infer<typeof eventOperationsSchema>;
