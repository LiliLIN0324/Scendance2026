import { z } from 'zod';

export const handoffLimits = {
  ownerName: 80,
  acceptance: 1000,
  evidenceUrls: 5,
  evidenceUrl: 2048,
  evidenceNote: 1000,
  reviewedBasis: 16384,
} as const;

const dueDateSchema = z.string().trim().pipe(z.union([
  z.literal(''),
  z.iso.date().refine(value => !value.startsWith('0000-'), '期限年份须大于零'),
]));

const evidenceUrlSchema = z.string().trim().max(handoffLimits.evidenceUrl).refine(value => {
  if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}, '证据链接须为不含账号密码的完整 HTTP 或 HTTPS 地址');

export const handoffEvidenceUrlsSchema = z.array(evidenceUrlSchema).max(handoffLimits.evidenceUrls)
  .refine(urls => new Set(urls).size === urls.length, '证据链接不能重复');

// Local execution records only; reviewedBasis is not a cloud revision or an audit stamp.
export const handoffSchema = z.strictObject({
  ownerName: z.string().trim().max(handoffLimits.ownerName).default(''),
  dueDate: dueDateSchema.default(''),
  acceptance: z.string().trim().max(handoffLimits.acceptance).default(''),
  status: z.enum(['todo', 'doing', 'review', 'accepted']).default('todo'),
  evidenceUrls: handoffEvidenceUrlsSchema.default([]),
  evidenceNote: z.string().trim().max(handoffLimits.evidenceNote).default(''),
  reviewedBasis: z.string().max(handoffLimits.reviewedBasis).optional(),
}).superRefine((record, ctx) => {
  if (record.status === 'review' || record.status === 'accepted') {
    for (const [field, message] of [
      ['ownerName', '请填写负责人'],
      ['dueDate', '请填写期限'],
      ['acceptance', '请填写验收条件'],
    ] as const) {
      if (!record[field]) ctx.addIssue({ code: 'custom', path: [field], message });
    }
  }
  if (record.status === 'accepted') {
    if (!record.evidenceUrls.length && !record.evidenceNote) {
      ctx.addIssue({ code: 'custom', path: ['evidenceNote'], message: '已验收须填写证据链接或证据说明' });
    }
    if (!record.reviewedBasis?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['reviewedBasis'], message: '已验收须记录非空核对依据' });
    }
  }
});

export type Handoff = z.infer<typeof handoffSchema>;
