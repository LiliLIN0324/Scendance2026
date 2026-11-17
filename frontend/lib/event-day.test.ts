import { describe, expect, it } from 'vitest';
import { eventOperationsSchema } from '../../supabase/functions/_shared/event-operations-contract';
import { makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { canEnterReview, dayChecklist, taskTiming } from './event-day';

const task = (overrides: Record<string, unknown>) => eventOperationsSchema.parse({
  dataKind: 'rehearsal', tasks: [{ id: crypto.randomUUID(), phase: 'event', ...overrides }],
}).tasks[0]!;

describe('流程单时长与完整性（P1-1）', () => {
  it('按起止算时长，不另存字段', () => {
    const timing = taskTiming(task({ title: '签到', plannedStartAt: '2026-12-20T01:00:00+00:00',
      plannedEndAt: '2026-12-20T02:30:00+00:00', ownerName: '小乙' }));
    expect(timing).toEqual({ durationMinutes: 90, omissions: [], complete: true });
  });

  it('缺一端即不完整，时长留空而不是猜', () => {
    expect(taskTiming(task({ title: '签到', plannedEndAt: '2026-12-20T02:30:00+00:00', ownerName: '小乙' })))
      .toEqual({ durationMinutes: null, omissions: ['start'], complete: false });
    expect(taskTiming(task({ title: '签到', plannedStartAt: '2026-12-20T01:00:00+00:00', ownerName: '小乙' })))
      .toEqual({ durationMinutes: null, omissions: ['end'], complete: false });
  });

  it('承接团队不能顶替具名负责人', () => {
    const noOwner = task({ title: '签到', plannedStartAt: '2026-12-20T01:00:00+00:00',
      plannedEndAt: '2026-12-20T02:30:00+00:00', contractorName: '某搭建公司' });
    expect(taskTiming(noOwner).omissions).toEqual(['owner']);
    expect(canEnterReview(noOwner)).toBe(false);
  });

  it('三要素齐全且起止自洽才能进 review', () => {
    expect(canEnterReview(task({ title: '签到', plannedStartAt: '2026-12-20T01:00:00+00:00',
      plannedEndAt: '2026-12-20T02:30:00+00:00', ownerName: '小乙' }))).toBe(true);
  });
});

describe('当天检查清单（P1-2）', () => {
  it('无安排时给空态，不出空分组', () => {
    expect(dayChecklist(makeLayout({ id: 'checklist-empty' }))).toEqual({ dataKind: 'unspecified', sections: [] });
  });

  it('按进出场顺序分组，准备阶段不进当天清单，并按时间排序', () => {
    const layout = makeLayout({ id: 'checklist-order', eventOperations: eventOperationsSchema.parse({
      dataKind: 'real', tasks: [
        { id: crypto.randomUUID(), title: '撤场', phase: 'teardown' },
        { id: crypto.randomUUID(), title: '晚到签到', phase: 'event', ownerName: '小乙', plannedStartAt: '2026-12-20T03:00:00+00:00' },
        { id: crypto.randomUUID(), title: '早到签到', phase: 'event', ownerName: '阿岚', plannedStartAt: '2026-12-20T01:00:00+00:00' },
        { id: crypto.randomUUID(), title: '采购背景', phase: 'preparation' },
      ] }) });
    const checklist = dayChecklist(layout);
    expect(checklist.dataKind).toBe('real');
    expect(checklist.sections.map(section => section.label)).toEqual(['签到与运行', '撤场']);
    expect(checklist.sections[0]!.items.map(item => item.title)).toEqual(['早到签到', '晚到签到']);
    expect(checklist.sections.flatMap(section => section.items).some(item => item.title === '采购背景')).toBe(false);
  });

  it('以 accepted 判定完成，其余都算未完成', () => {
    const layout = makeLayout({ id: 'checklist-done', eventOperations: eventOperationsSchema.parse({
      dataKind: 'rehearsal', tasks: [
        { id: crypto.randomUUID(), title: '布置', phase: 'setup', ownerName: '小乙', acceptance: '走位完成',
          status: 'accepted', evidenceNote: '现场核对', reviewedBasis: `sha256:${'a'.repeat(64)}` },
        { id: crypto.randomUUID(), title: '进场', phase: 'setup', ownerName: '阿岚' },
      ] }) });
    const items = dayChecklist(layout).sections[0]!.items;
    expect(items.find(item => item.title === '布置')?.done).toBe(true);
    expect(items.find(item => item.title === '进场')?.done).toBe(false);
  });
});
