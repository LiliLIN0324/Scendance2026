import { describe, expect, it } from 'vitest';
import { eventOperationsSchema } from '../../supabase/functions/_shared/event-operations-contract';
import { makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { emptyEventProfile, updateEventProfile } from './event-profile';
import { planEventPackage } from './event-package';
import { rosterSchema } from './event-roster';
import { declareSupplier, supplierLedgerSchema } from './supplier-declarations';
import { buildRetrospective } from './event-retrospective';

const generatedAt = '2026-11-18T10:00:00.000Z';
const meta = { updatedBy: '阿岚', updatedAt: generatedAt };
const dated = updateEventProfile(emptyEventProfile(),
  { date: { value: '2026-12-20', status: 'inferred', source: 'model_inference', note: '需求原文' } }, 0, meta);

describe('活动档案包（P2-5）', () => {
  it('缺项跳过、不占位：空活动只出索引与说明', () => {
    const plan = planEventPackage({ layout: makeLayout({ id: 'pkg-empty', name: '   ' }), generatedAt });
    expect(plan.folderName).toBe('未命名活动-日期待确认');
    expect(plan.entries).toEqual([]);
    expect(plan.skipped).toEqual(['profile', 'operations', 'roster', 'suppliers', 'retrospective']);
    expect(plan.index.join('\n')).toContain('未生成：');
    expect(plan.index.join('\n')).toContain('缺项不占位');
  });

  it('按活动名与日期命名，并带各对象版本', () => {
    const layout = makeLayout({ id: 'pkg-full', name: '冬季/试营业', eventProfile: dated,
      eventOperations: eventOperationsSchema.parse({ dataKind: 'real', tasks: [
        { id: crypto.randomUUID(), title: '签到', phase: 'event', ownerName: '小乙' },
      ] }) });
    const roster = rosterSchema.parse({ dataKind: 'real', guests: [{ id: crypto.randomUUID(), name: '甲' }] });
    const suppliers = declareSupplier(supplierLedgerSchema.parse({ dataKind: 'real' }),
      { supplierName: '搭建公司', status: 'contacted', declaredBy: '阿岚', declaredAt: generatedAt });
    const plan = planEventPackage({ layout, roster, suppliers, generatedAt,
      retrospective: buildRetrospective({ layout }) });
    expect(plan.folderName).toBe('冬季-试营业-2026-12-20');
    expect(plan.entries.map(entry => entry.kind)).toEqual(['profile', 'operations', 'roster', 'suppliers', 'retrospective']);
    expect(plan.entries[0]!.version).toBe(`v${dated.revision}`);
    expect(plan.index.join('\n')).toContain('流程单 · 1 项 · 真实');
    expect(plan.index.join('\n')).toContain('嘉宾名册 · 1 位');
    expect(plan.skipped).toEqual([]);
  });

  it('日期未确认时不拿今天顶替', () => {
    const plan = planEventPackage({ layout: makeLayout({ id: 'pkg-undated', name: '试营业' }), generatedAt });
    expect(plan.folderName).toBe('试营业-日期待确认');
  });

  it('生成时间非法时拒绝出包', () => {
    expect(() => planEventPackage({ layout: makeLayout({ id: 'pkg-bad' }), generatedAt: 'not-a-time' }))
      .toThrow('请记录有效的生成时间。');
  });
});
