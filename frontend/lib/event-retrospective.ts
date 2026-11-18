import type { RoomLayout } from '../components/room-organizer/lib/types';
import { eventProfileContext } from './event-profile-context';
import { rosterSummary, type Roster } from './event-roster';

/**
 * 复盘 V1（P2-3）：每个数字都标来源；未回填就是空，不用推断补。
 * 挂执行基线指纹，只读：发布包编号 + 核对依据 + 档案版本。
 */
export interface RetroNumber {
  label: string;
  value: string;
  source: 'profile' | 'roster' | 'absent';
}

export interface RetrospectiveBaseline {
  publishedPackageId: string;
  reviewedBasis: string;
  eventProfileRevision: number | null;
}

export interface Retrospective {
  dataKind: 'real';
  baseline: RetrospectiveBaseline | null;
  numbers: RetroNumber[];
  /** 出席 ÷ 报名；报名为 0 或无名册时为 null，不写 0%。 */
  attendanceRate: number | null;
  /** 演练数据不进入真实复盘，直接拒绝。 */
  notes: string[];
}

export function buildRetrospective(input: {
  layout: RoomLayout;
  roster?: Roster | undefined;
  publishedPackageId?: string | null;
  reviewedBasis?: string | null;
}): Retrospective {
  const operations = input.layout.eventOperations;
  if (operations?.dataKind === 'rehearsal') throw new Error('演练数据不进入真实复盘。');
  const facts = eventProfileContext(input.layout.eventProfile);
  const expected = facts.find(fact => fact.key === 'expectedAttendance');
  const numbers: RetroNumber[] = [];
  numbers.push({ label: '预期到场（活动档案）', value: expected?.valueText ?? '未记录', source: 'profile' });
  if (input.roster) {
    const summary = rosterSummary(input.roster);
    numbers.push({ label: '报名', value: `${summary.byStatus.registered} 人`, source: 'roster' });
    numbers.push({ label: '实际出席（含携伴）', value: `${summary.attendedWithPlusOnes} 人`, source: 'roster' });
    if (summary.plusOnesUnknown) numbers.push({ label: '携伴未确认', value: `${summary.plusOnesUnknown} 位`, source: 'roster' });
  } else {
    numbers.push({ label: '报名 / 实际出席', value: '未记录', source: 'absent' });
  }
  const budget = input.layout.eventProfile?.budget.value;
  if (budget) {
    const money = (value: { amountMinor: number | null } | null) => value?.amountMinor === null || value === null
      ? '未记录' : `¥${(value.amountMinor / 100).toFixed(2)}`;
    numbers.push({ label: '预算估算（活动档案）', value: money(budget.estimate), source: 'profile' });
    numbers.push({ label: '预算实际（活动档案）', value: money(budget.actual), source: 'profile' });
  }
  const registered = input.roster ? rosterSummary(input.roster).byStatus.registered : 0;
  const attended = input.roster ? rosterSummary(input.roster).attended : 0;
  const baseline = input.publishedPackageId && input.reviewedBasis
    ? { publishedPackageId: input.publishedPackageId, reviewedBasis: input.reviewedBasis,
      eventProfileRevision: input.layout.eventProfile?.revision ?? null }
    : null;
  return { dataKind: 'real', baseline, numbers, attendanceRate: registered ? attended / registered : null,
    notes: baseline ? [] : ['尚未发布执行包，基线待补；未发布时基线为空，不指向最新版本。'] };
}
