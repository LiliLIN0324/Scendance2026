import { describe, expect, it } from 'vitest';
import { markGuestOptedOut, rosterSchema, rosterSummary } from './event-roster';

const guest = (overrides: Record<string, unknown>) => ({ id: crypto.randomUUID(), name: '嘉宾', ...overrides });
const roster = (guests: unknown[]) => rosterSchema.parse({ dataKind: 'real', guests });

describe('嘉宾名册（P2-1）', () => {
  it('六态计数，退出者不计入任何数量', () => {
    const value = roster([
      guest({ name: '甲', status: 'attended', plusOnes: 1 }),
      guest({ name: '乙', status: 'attended', plusOnes: 0 }),
      guest({ name: '丙', status: 'registered' }),
      guest({ name: '丁', status: 'declined' }),
      guest({ name: '戊', status: 'attended', plusOnes: 2, optedOut: true,
        optedOutDeclaredBy: '阿岚', optedOutAt: '2026-11-18T09:00:00.000Z' }),
    ]);
    const summary = rosterSummary(value);
    expect(summary.total).toBe(4);
    expect(summary.byStatus).toMatchObject({ attended: 2, registered: 1, declined: 1, invited: 0 });
    expect(summary.attended).toBe(2);
    expect(summary.attendedWithPlusOnes).toBe(3);
    expect(summary.plusOnesUnknown).toBe(0);
    expect(summary.optedOut).toBe(1);
  });

  it('plusOnes 未问与明确零分开统计', () => {
    const summary = rosterSummary(roster([
      guest({ name: '甲', status: 'attended' }),
      guest({ name: '乙', status: 'registered', plusOnes: null, needsTravel: null }),
    ]));
    expect(summary.plusOnesUnknown).toBe(1);
    expect(summary.attendedWithPlusOnes).toBe(1);
    expect(summary.followUpGuestIds).toHaveLength(2);
  });

  it('退出保留前序状态，且不再进跟进与出行清单', () => {
    const value = roster([
      guest({ name: '甲', status: 'registered', needsTravel: true, plusOnes: null }),
      guest({ name: '乙', status: 'attended', needsTravel: true, plusOnes: 0 }),
    ]);
    const opted = markGuestOptedOut(value, value.guests[0]!.id, { by: ' 阿岚 ', at: '2026-11-18T10:00:00.000Z' });
    expect(opted.guests[0]).toMatchObject({ status: 'registered', optedOut: true,
      optedOutDeclaredBy: '阿岚', optedOutAt: '2026-11-18T10:00:00.000Z' });
    const summary = rosterSummary(opted);
    expect(summary.followUpGuestIds).toEqual([]);
    expect(summary.travelGuestIds).toEqual([value.guests[1]!.id]);
    expect(summary.byStatus.registered).toBe(0);
  });

  it('退出必须带声明人与时间，同名不能重复', () => {
    const value = roster([guest({ name: '甲' })]);
    expect(() => markGuestOptedOut(value, value.guests[0]!.id, { by: '   ', at: '2026-11-18T10:00:00.000Z' }))
      .toThrow('请记录退出声明人。');
    expect(() => markGuestOptedOut(value, value.guests[0]!.id, { by: '阿岚', at: 'unknown' }))
      .toThrow('请记录有效的退出时间。');
    expect(() => roster([guest({ name: '甲' }), guest({ name: '甲' })])).toThrow();
  });

  it('参与与退出同时存在时，索引仍指向原对象', () => {
    const value = roster([guest({ name: '甲', status: 'invited' })]);
    const opted = markGuestOptedOut(value, value.guests[0]!.id, { by: '小乙', at: '2026-11-18T10:00:00.000Z' });
    expect(opted.guests[0]!.id).toBe(value.guests[0]!.id);
    expect(opted.guests[0]!.status).toBe('invited');
  });
});
