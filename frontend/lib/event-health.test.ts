import { describe, expect, it } from 'vitest';
import { eventOperationsSchema } from '../../supabase/functions/_shared/event-operations-contract';
import { makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { eventHealth } from './event-health';
import { rosterSchema } from './event-roster';
import { declareSupplier, supplierLedgerSchema } from './supplier-declarations';

const now = '2026-11-18T10:00:00.000Z';
const layoutWith = (tasks: unknown[]) => makeLayout({ id: 'health-project',
  eventOperations: eventOperationsSchema.parse({ dataKind: 'real', tasks }) });

describe('筹备体检（P2-4）', () => {
  it('逾期必出，且排在最前', () => {
    const health = eventHealth({ now, layout: layoutWith([
      { id: crypto.randomUUID(), title: '签到', phase: 'event', ownerName: '小乙',
        plannedStartAt: '2026-11-01T01:00:00+00:00', plannedEndAt: '2026-11-01T02:00:00+00:00', acceptance: '完成签到' },
      { id: crypto.randomUUID(), title: '撤场', phase: 'teardown', ownerName: '阿岚',
        plannedStartAt: '2026-12-01T01:00:00+00:00', plannedEndAt: '2026-12-01T02:00:00+00:00', acceptance: '清空场地' },
    ]) });
    expect(health.issues[0]).toMatchObject({ severity: 'overdue', source: 'task', text: '逾期未完成：签到' });
    expect(health.quiet).toBe(false);
  });

  it('缺负责人、时间或完成条件都要报出来', () => {
    const health = eventHealth({ now, layout: layoutWith([{ id: crypto.randomUUID(), title: '布置', phase: 'setup' }]) });
    const missing = health.issues.find(issue => issue.id.startsWith('task-missing:'));
    expect(missing?.text).toBe('布置 缺少负责人、开始时间、结束时间、完成条件');
  });

  it('活动档案未记录的事实逐项列为缺口', () => {
    const health = eventHealth({ now, layout: makeLayout({ id: 'health-empty' }) });
    const labels = health.issues.filter(issue => issue.source === 'profile').map(issue => issue.text);
    expect(labels).toContain('活动档案未记录：日期');
    expect(labels).toContain('活动档案未记录：预期到场');
    expect(labels).toHaveLength(7);
  });

  it('名册只看未退出者，携伴与出行未定都算待确认', () => {
    const roster = rosterSchema.parse({ dataKind: 'real', guests: [
      { id: crypto.randomUUID(), name: '甲', status: 'attended', plusOnes: null, needsTravel: false },
      { id: crypto.randomUUID(), name: '乙', status: 'invited', needsTravel: null },
      { id: crypto.randomUUID(), name: '丙', status: 'attended', optedOut: true,
        optedOutDeclaredBy: '阿岚', optedOutAt: '2026-11-18T09:00:00.000Z', plusOnes: null },
    ] });
    const health = eventHealth({ now, layout: makeLayout({ id: 'health-roster' }), roster });
    expect(health.issues.find(issue => issue.id === 'roster-plus-ones')?.text).toBe('1 位已到场嘉宾的携伴人数未确认');
    expect(health.issues.find(issue => issue.id === 'roster-travel')?.text).toBe('1 位嘉宾是否需要出行接送未确认');
  });

  it('供应商按声明判断跟进，已确认的不催', () => {
    const suppliers = declareSupplier(declareSupplier(supplierLedgerSchema.parse({ dataKind: 'real' }),
      { supplierName: '甲', status: 'contacted', declaredBy: '阿岚', declaredAt: '2026-11-01T09:00:00.000Z',
        lastFollowUpAt: '2026-11-01T09:00:00.000Z' }),
      { supplierName: '乙', status: 'confirmed', declaredBy: '阿岚', declaredAt: '2026-11-01T09:00:00.000Z' });
    const health = eventHealth({ now, layout: makeLayout({ id: 'health-supplier' }), suppliers });
    const supplierIssues = health.issues.filter(issue => issue.source === 'supplier');
    expect(supplierIssues.map(issue => issue.text)).toEqual(['供应商「甲」已 17 天未跟进，当前已联系']);
  });

  it('同一输入重复调用结果一致', () => {
    const layout = layoutWith([{ id: crypto.randomUUID(), title: '布置', phase: 'setup' }]);
    expect(eventHealth({ now, layout })).toEqual(eventHealth({ now, layout }));
  });
});
