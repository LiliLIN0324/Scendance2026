import { describe, expect, it } from 'vitest';
import { declareSupplier, latestDeclaration, supplierLedgerSchema, supplierStatusView } from './supplier-declarations';

const now = '2026-11-18T10:00:00.000Z';
const empty = () => supplierLedgerSchema.parse({ dataKind: 'real' });
const declare = (ledger: ReturnType<typeof empty>, name: string, overrides: Record<string, unknown> = {}) =>
  declareSupplier(ledger, { supplierName: name, status: 'contacted', declaredBy: '阿岚', declaredAt: '2026-11-01T10:00:00.000Z', ...overrides } as never);

describe('供应商声明（P2-2）', () => {
  it('没有声明就显示未声明，不给推测状态', () => {
    const view = supplierStatusView(empty(), '某搭建公司', now);
    expect(view).toMatchObject({ declared: false, status: null, statusText: '未声明', needsFollowUp: false });
  });

  it('声明记录带声明人与时间，并原样带出联系方式', () => {
    const ledger = declare(empty(), '某搭建公司', { contactName: '小乙', contactPhone: '13800000000',
      arrivalAt: '2026-12-20T00:30:00.000Z' });
    expect(latestDeclaration(ledger, '某搭建公司')).toMatchObject({ status: 'contacted', declaredBy: '阿岚',
      contactName: '小乙', contactPhone: '13800000000', arrivalAt: '2026-12-20T00:30:00.000Z' });
    expect(supplierStatusView(ledger, '某搭建公司', now)).toMatchObject({ declared: true, statusText: '已联系' });
  });

  it('同一供应商以最后一次声明为准', () => {
    const first = declare(empty(), '某搭建公司');
    const second = declare(first, '某搭建公司', { status: 'confirmed', declaredAt: '2026-11-10T10:00:00.000Z' });
    expect(latestDeclaration(second, '某搭建公司')?.status).toBe('confirmed');
    expect(supplierStatusView(second, '某搭建公司', now).statusText).toBe('已确认');
  });

  it('两周未跟进才算待跟进，已确认或已拒绝不再催', () => {
    const stale = declare(empty(), '甲', { lastFollowUpAt: '2026-11-01T10:00:00.000Z' });
    expect(supplierStatusView(stale, '甲', now)).toMatchObject({ daysSinceFollowUp: 17, needsFollowUp: true });
    const fresh = declare(empty(), '乙', { lastFollowUpAt: '2026-11-15T10:00:00.000Z' });
    expect(supplierStatusView(fresh, '乙', now).needsFollowUp).toBe(false);
    const noFollowUp = declare(empty(), '丙');
    expect(supplierStatusView(noFollowUp, '丙', now)).toMatchObject({ daysSinceFollowUp: null, needsFollowUp: true });
    const confirmed = declare(empty(), '丁', { status: 'confirmed' });
    expect(supplierStatusView(confirmed, '丁', now).needsFollowUp).toBe(false);
  });

  it('缺声明人或供应商名时拒绝写入', () => {
    const ledger = empty();
    expect(() => declareSupplier(ledger, { supplierName: '  ', status: 'contacted', declaredBy: '阿岚',
      declaredAt: '2026-11-01T10:00:00.000Z' })).toThrow();
    expect(() => declareSupplier(ledger, { supplierName: '甲', status: 'contacted', declaredBy: '  ',
      declaredAt: '2026-11-01T10:00:00.000Z' })).toThrow();
  });
});
