import { z } from 'zod';

/**
 * 供应商人工声明（P2-2）：状态只来自人的声明，绝不由档案存在性推导。
 * 六态之外没有"未声明"状态值——没有声明就是没有记录，界面照实显示"未声明"。
 */
export const supplierStatuses = ['uncontacted', 'contacted', 'quoted', 'negotiating', 'confirmed', 'declined'] as const;
export const supplierStatusLabels: Record<(typeof supplierStatuses)[number], string> = {
  uncontacted: '未联系', contacted: '已联系', quoted: '已报价',
  negotiating: '洽谈中', confirmed: '已确认', declined: '已拒绝',
};

const timeSchema = z.iso.datetime({ offset: true }).max(32).nullable().default(null);
export const supplierDeclarationSchema = z.strictObject({
  id: z.uuid(),
  supplierName: z.string().trim().min(1).max(120),
  status: z.enum(supplierStatuses),
  declaredBy: z.string().trim().min(1).max(80),
  declaredAt: z.iso.datetime({ offset: true }).max(32),
  contactName: z.string().trim().max(80).default(''),
  contactPhone: z.string().trim().max(32).default(''),
  arrivalAt: timeSchema,
  lastFollowUpAt: timeSchema,
  note: z.string().trim().max(500).default(''),
});
export type SupplierDeclaration = z.infer<typeof supplierDeclarationSchema>;

export const supplierLedgerSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  dataKind: z.enum(['unspecified', 'rehearsal', 'real']).default('unspecified'),
  declarations: z.array(supplierDeclarationSchema).max(500)
    .refine(rows => new Set(rows.map(row => row.id)).size === rows.length, '声明编号不能重复').default([]),
});
export type SupplierLedger = z.infer<typeof supplierLedgerSchema>;

/** 同一供应商以最后一次声明为准；不合并、不推断历史。 */
export function latestDeclaration(ledger: SupplierLedger, supplierName: string): SupplierDeclaration | null {
  const parsed = supplierLedgerSchema.parse(ledger);
  const name = supplierName.trim();
  const rows = parsed.declarations.filter(row => row.supplierName === name)
    .sort((a, b) => Date.parse(b.declaredAt) - Date.parse(a.declaredAt));
  return rows[0] ?? null;
}

export function declareSupplier(ledger: SupplierLedger, declaration: Omit<z.input<typeof supplierDeclarationSchema>, 'id'>): SupplierLedger {
  const parsed = supplierLedgerSchema.parse(ledger);
  const row = supplierDeclarationSchema.parse({ ...declaration, id: crypto.randomUUID() });
  return supplierLedgerSchema.parse({ ...parsed, declarations: [...parsed.declarations, row] });
}

export interface SupplierStatusView {
  supplierName: string;
  declared: boolean;
  status: SupplierDeclaration['status'] | null;
  statusText: string;
  contactName: string;
  contactPhone: string;
  arrivalAt: string | null;
  lastFollowUpAt: string | null;
  /** 距上次跟进的天数；没有跟进记录时为 null，不按声明时间替代。 */
  daysSinceFollowUp: number | null;
  needsFollowUp: boolean;
}

/** 只读视图：未声明就显示"未声明"，不给任何推测状态。 */
export function supplierStatusView(ledger: SupplierLedger, supplierName: string, now: string): SupplierStatusView {
  if (!Number.isFinite(Date.parse(now))) throw new Error('请提供有效的当前时间。');
  const row = latestDeclaration(ledger, supplierName);
  if (!row) {
    return { supplierName: supplierName.trim(), declared: false, status: null, statusText: '未声明',
      contactName: '', contactPhone: '', arrivalAt: null, lastFollowUpAt: null, daysSinceFollowUp: null, needsFollowUp: false };
  }
  const daysSinceFollowUp = row.lastFollowUpAt === null ? null
    : Math.floor((Date.parse(now) - Date.parse(row.lastFollowUpAt)) / 86_400_000);
  return {
    supplierName: row.supplierName, declared: true, status: row.status, statusText: supplierStatusLabels[row.status],
    contactName: row.contactName, contactPhone: row.contactPhone, arrivalAt: row.arrivalAt,
    lastFollowUpAt: row.lastFollowUpAt, daysSinceFollowUp,
    needsFollowUp: row.status !== 'confirmed' && row.status !== 'declined'
      && (row.lastFollowUpAt === null || (daysSinceFollowUp !== null && daysSinceFollowUp >= 14)),
  };
}
