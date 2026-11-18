import { describe, expect, it } from 'vitest';
import { emptyEventProfile, updateEventProfile, type EventProfile, type EventProfilePatch } from './event-profile';
import {
  eventBrief, type BriefDossier, type BriefGuest, type BriefRoster, type BriefTask, type EventBriefInput,
} from './event-brief';

const updatedAt = '2026-11-17T09:00:00+08:00';

function profileWith(patch: EventProfilePatch): EventProfile {
  return updateEventProfile(emptyEventProfile(), patch, 0, { updatedBy: '张伟', updatedAt });
}

const windowValue = { startTime: '14:00', endTime: '18:00', timeZone: 'Asia/Shanghai', endsNextDay: false };

const scheduled = profileWith({
  date: { value: '2026-11-20', status: 'confirmed', source: 'user_statement' },
  timeWindow: { value: windowValue, status: 'confirmed', source: 'user_statement' },
  expectedAttendance: { value: 96, status: 'confirmed', source: 'user_statement' },
});

const task = (over: Partial<BriefTask> & { id: string }): BriefTask => ({
  title: '进场', phase: 'event', plannedStartAt: null, plannedEndAt: null,
  ownerName: '张伟', status: 'todo', ...over,
});

const guest = (over: Partial<BriefGuest> & { id: string; name: string }): BriefGuest => ({
  status: 'registered', optedOut: false, plusOnes: 0, needsTravel: null,
  dietary: '', accessibility: '', ...over,
});

const base = {
  profile: null as EventProfile | null,
  brief: { event: '品牌快闪', guests: 100, guestsConfirmed: true },
  tasks: [] as BriefTask[],
  roster: null as BriefRoster | null,
  dossier: null as BriefDossier | null,
  now: '2026-11-17T10:00:00+08:00',
};

const input = (over: Partial<EventBriefInput> = {}): EventBriefInput => {
  const merged: EventBriefInput = { ...base };
  return { ...merged, ...over };
};

describe('eventBrief 空态与倒计时', () => {
  it('T17 没有进行中的活动只给一句话并停止', () => {
    const brief = eventBrief(input(), 'countdown');
    expect(brief.sections).toHaveLength(1);
    expect(brief.sections[0]?.id).toBe('noEvent');
    expect(brief.sections[0]?.items).toEqual(['当前没有进行中的活动']);
    expect(brief.quiet).toBe(false);
    expect(brief.asOf).toBe(base.now);
    expect(brief.daysToEvent).toBeNull();
  });

  it('T18 距活动天数按活动时区的本地日期计算', () => {
    const profile = profileWith({
      date: { value: '2026-11-18', status: 'confirmed', source: 'user_statement' },
      timeWindow: { value: { ...windowValue, timeZone: 'Asia/Shanghai' }, status: 'confirmed', source: 'user_statement' },
    });
    // 该时刻在 UTC 仍是 11-18 之前，但在上海已是 11-18 15:30。
    const brief = eventBrief(input({ profile, now: '2026-11-17T23:30:00-08:00' }), 'countdown');
    expect(brief.daysToEvent).toBe(0);
    expect(brief.sections.find(section => section.id === 'countdown')?.items).toEqual(['活动就是今天']);
  });

  it('今天到期与逾期分别成行并带负责人', () => {
    const brief = eventBrief(input({
      profile: scheduled,
      tasks: [
        task({ id: 'a', title: '签到台布置', plannedEndAt: '2026-11-17T18:00:00+08:00' }),
        task({ id: 'b', title: '物料到场', plannedEndAt: '2026-11-10T18:00:00+08:00' }),
      ],
    }), 'countdown');
    expect(brief.sections.find(section => section.id === 'due')?.items)
      .toEqual(['今天到期：签到台布置 · 负责人 张伟']);
    expect(brief.sections.find(section => section.id === 'overdue')?.items[0])
      .toMatch(/已逾期 \d+ 天：物料到场 · 负责人 张伟/);
    expect(brief.quiet).toBe(false);
  });

  it('T16 安静只在无到期、无逾期、无变化时出现', () => {
    const first = eventBrief(input({ profile: scheduled }), 'countdown');
    const second = eventBrief(input({ profile: scheduled, previousSignature: first.signature }), 'countdown');
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.quiet).toBe(true);
  });

  it('T16 有逾期时即使签名未变也必须说话', () => {
    const tasks = [task({ id: 'b', title: '物料到场', plannedEndAt: '2026-11-10T18:00:00+08:00' })];
    const first = eventBrief(input({ profile: scheduled, tasks }), 'countdown');
    const second = eventBrief(input({ profile: scheduled, tasks, previousSignature: first.signature }), 'countdown');
    expect(second.changed).toBe(false);
    expect(second.quiet).toBe(false);
    expect(second.sections.some(section => section.id === 'overdue' && section.items.length > 0)).toBe(true);
  });

  it('T17 没有名册就不出人数段', () => {
    const brief = eventBrief(input({ profile: scheduled }), 'countdown');
    expect(brief.sections.some(section => section.id === 'attendance')).toBe(false);
  });

  it('有名册时报名、预期到场、目标三者同屏', () => {
    const brief = eventBrief(input({
      profile: scheduled,
      roster: { guests: [guest({ id: 'g1', name: '张三' }), guest({ id: 'g2', name: '李四', status: 'declined' })] },
    }), 'countdown');
    const items = brief.sections.find(section => section.id === 'attendance')?.items ?? [];
    expect(items).toContain('已报名 1 人');
    expect(items).toContain('预期到场 96 人');
    expect(items).toContain('目标 100 人');
  });

  it('临期缺口只统计未答复项，不计已退出的人', () => {
    const brief = eventBrief(input({
      profile: scheduled,
      roster: {
        guests: [
          guest({ id: 'g1', name: '张三', dietary: '', plusOnes: null }),
          guest({ id: 'g2', name: '李四', dietary: '', plusOnes: null, optedOut: true }),
        ],
      },
    }), 'countdown');
    expect(brief.sections.find(section => section.id === 'gaps')?.items)
      .toEqual(['饮食未答复 1 人', '携伴未问 1 人']);
  });

  it('asOf 取记录里最新的更新时间而不是当前时间', () => {
    const brief = eventBrief(input({ profile: scheduled, now: '2026-11-17T10:00:00+08:00' }), 'countdown');
    expect(brief.asOf).toBe(updatedAt);
  });
});

describe('eventBrief 当天简报', () => {
  it('流程按时间排序，时长由起止算出，缺项标出', () => {
    const brief = eventBrief(input({
      profile: scheduled,
      tasks: [
        task({ id: 'a', title: '开场', plannedStartAt: '2026-11-20T14:00:00+08:00', plannedEndAt: '2026-11-20T15:30:00+08:00' }),
        task({ id: 'b', title: '签到', plannedStartAt: '2026-11-20T13:00:00+08:00', ownerName: '' }),
        task({ id: 'c', title: '撤场', phase: 'teardown', plannedStartAt: '2026-11-20T19:00:00+08:00' }),
      ],
    }), 'dayOf');
    const schedule = brief.sections.find(section => section.id === 'schedule')?.items ?? [];
    expect(schedule[0]).toBe('活动时间 14:00–18:00（Asia/Shanghai）');
    expect(schedule[1]).toContain('13:00–待定');
    expect(schedule[1]).toContain('缺结束时间');
    expect(schedule[1]).toContain('缺具名负责人');
    expect(schedule[2]).toContain('14:00–15:30');
    expect(schedule[2]).toContain('1 小时 30 分');
    expect(schedule[2]).toContain('开场');
    expect(schedule[2]).toContain('张伟');
    expect(schedule.some(line => line.includes('撤场'))).toBe(false);
  });

  it('T17 无供应商声明时不出到达段，有声明时缺电话要标出', () => {
    const withoutVendors = eventBrief(input({ profile: scheduled }), 'dayOf');
    expect(withoutVendors.sections.some(section => section.id === 'vendors')).toBe(false);
    const withVendors = eventBrief(input({
      profile: scheduled,
      supplierStates: [{
        agreementId: 'a1', supplierName: '云栖厅', state: '已签约', contactName: '李娜',
        contactPhone: '', arrivalAt: '2026-12-06T08:00:00+08:00', lastFollowUpAt: null,
      }],
    }), 'dayOf');
    const vendors = withVendors.sections.find(section => section.id === 'vendors')?.items ?? [];
    expect(vendors[0]).toContain('08:00 到达');
    expect(vendors[0]).toContain('电话待确认');
  });

  it('T17 只在确有外地嘉宾时出接送段', () => {
    const noTravel = eventBrief(input({
      profile: scheduled,
      roster: { guests: [guest({ id: 'g1', name: '张三', needsTravel: null })] },
    }), 'dayOf');
    expect(noTravel.sections.some(section => section.id === 'transfer')).toBe(false);
    const travel = eventBrief(input({
      profile: scheduled,
      roster: { guests: [guest({ id: 'g1', name: '张三', needsTravel: true })] },
    }), 'dayOf');
    expect(travel.sections.find(section => section.id === 'transfer')?.items).toEqual(['需接送 1 人：张三']);
  });

  it('没有名册时完全不出现人数与饮食段', () => {
    const brief = eventBrief(input({ profile: scheduled }), 'dayOf');
    expect(brief.sections.some(section => section.id === 'attendance')).toBe(false);
  });

  it('预案只输出用户登记的条目，不自行编造', () => {
    const without = eventBrief(input({ profile: scheduled }), 'dayOf');
    expect(without.sections.some(section => section.id === 'contingency')).toBe(false);
    const withNotes = eventBrief(input({ profile: scheduled, contingency: ['下雨启用室内备用区'] }), 'dayOf');
    expect(withNotes.sections.find(section => section.id === 'contingency')?.items).toEqual(['下雨启用室内备用区']);
  });
});

describe('eventBrief 复盘', () => {
  const roster: BriefRoster = {
    guests: [
      guest({ id: 'g1', name: '张三', status: 'attended', plusOnes: 2, dietary: '素食' }),
      guest({ id: 'g2', name: '李四', dietary: '' }),
      guest({ id: 'g3', name: '王五', status: 'attended', optedOut: true, dietary: '素食' }),
    ],
  };

  it('出席数与到场率分开算，退出者不计入', () => {
    const brief = eventBrief(input({ profile: scheduled, roster }), 'recap');
    const metrics = brief.sections.find(section => section.id === 'metrics')?.items ?? [];
    expect(metrics).toContain('实际出席 3 人（清点）');
    expect(metrics).toContain('到场率 50%（出席 ÷ 报名，不含携伴）');
    expect(metrics).toContain('目标 100 人');
  });

  it('跟进清单跳过已退出的人，回填项固定三条', () => {
    const brief = eventBrief(input({
      profile: scheduled,
      roster,
      recapNotes: {
        effective: ['签到台分流有效'],
        followUps: [{ guestId: 'g1', text: '发活动照片' }, { guestId: 'g3', text: '致谢' }],
      },
    }), 'recap');
    expect(brief.sections.find(section => section.id === 'followups')?.items).toEqual(['跟进：发活动照片']);
    expect(brief.sections.find(section => section.id === 'backfill')?.items)
      .toEqual(['待回填：实际出席人数', '待回填：表外花费', '待回填：现场感受']);
  });

  it('实际花费未登记时标注待回填，不写零', () => {
    const profile = profileWith({
      date: { value: '2026-11-20', status: 'confirmed', source: 'user_statement' },
      budget: {
        value: { estimate: { amountMinor: 120000, currency: 'CNY', basisNote: '客户口头' }, actual: null },
        status: 'confirmed', source: 'user_statement',
      },
    });
    const brief = eventBrief(input({ profile }), 'recap');
    const spend = brief.sections.find(section => section.id === 'spend')?.items ?? [];
    expect(spend).toContain('预算估算 ¥1200.00');
    expect(spend).toContain('实际花费待回填');
    expect(spend.join('')).not.toContain('¥0');
  });

  it('复盘不因安静规则而不说话', () => {
    const first = eventBrief(input({ profile: scheduled, roster }), 'recap');
    const second = eventBrief(input({ profile: scheduled, roster, previousSignature: first.signature }), 'recap');
    expect(second.quiet).toBe(false);
  });
});
