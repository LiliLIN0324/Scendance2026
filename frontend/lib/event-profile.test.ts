import { describe, expect, it } from 'vitest';
import {
  EVENT_FACT_KEYS, PUBLISHED_EVENT_VIEW_KEYS, emptyEventProfile, eventInstants,
  eventProfileSchema, isEventProfile, publishEventView, updateEventProfile,
  type EventProfile, type EventProfilePatch,
} from './event-profile';

const at = (hour: number): string => `2026-11-17T${String(hour).padStart(2, '0')}:00:00+08:00`;

function apply(profile: EventProfile, patch: EventProfilePatch, hour = 1): EventProfile {
  return updateEventProfile(profile, patch, profile.revision, { updatedBy: '张伟', updatedAt: at(hour) });
}

const confirmedDate = { value: '2026-12-06', status: 'confirmed', source: 'user_statement' } as const;
const windowValue = { startTime: '14:00', endTime: '18:00', timeZone: 'Asia/Shanghai', endsNextDay: false };
const confirmedWindow = { value: windowValue, status: 'confirmed', source: 'user_statement' } as const;

describe('eventProfile 空档案与版本', () => {
  it('空档案七组事实未知、版本为 0，且能通过契约解析', () => {
    const profile = emptyEventProfile();
    expect(isEventProfile(profile)).toBe(true);
    expect(profile.schemaVersion).toBe(1);
    expect(profile.revision).toBe(0);
    expect(profile.updatedBy).toBe('');
    for (const key of EVENT_FACT_KEYS) {
      expect(profile[key].status).toBe('unknown');
      expect(profile[key].value).toBeNull();
      expect(profile[key].source).toBe('unavailable');
      expect(profile[key].revision).toBe(0);
    }
  });

  it('T2 新建空档案不携带默认事实值', () => {
    const profile = emptyEventProfile();
    expect(profile.date.value).toBeNull();
    expect(profile.expectedAttendance.value).toBeNull();
    expect(profile.budget.value).toBeNull();
  });

  it('T9 CAS：过期版本被拒绝，成功后集合与事实同时升版', () => {
    const base = emptyEventProfile();
    expect(() => updateEventProfile(base, { date: confirmedDate }, 1, { updatedBy: '张伟', updatedAt: at(1) }))
      .toThrow('活动档案版本已变化，请重新核对。');
    const next = apply(base, { date: confirmedDate });
    expect(next.revision).toBe(1);
    expect(next.date.revision).toBe(1);
    expect(next.date.updatedBy).toBe('张伟');
  });

  it('T9 改回旧值仍升版本', () => {
    const first = apply(emptyEventProfile(), { date: confirmedDate }, 1);
    const second = apply(first, { date: { ...confirmedDate, value: '2026-12-07' } }, 2);
    const third = apply(second, { date: confirmedDate }, 3);
    expect(third.revision).toBe(3);
    expect(third.date.value).toBe('2026-12-06');
    expect(third.date.revision).toBe(3);
  });

  it('T14 一次写入两条事实：各自留痕，集合只加一', () => {
    const next = apply(emptyEventProfile(), { date: confirmedDate, goal: { value: '签下三家', status: 'pending', source: 'user_statement' } }, 1);
    expect(next.revision).toBe(1);
    expect(next.date.revision).toBe(1);
    expect(next.goal.revision).toBe(1);
    expect(next.date.updatedAt).toBe(at(1));
  });

  it('T13 清空回未知时保留版本号与更新人', () => {
    const confirmed = apply(emptyEventProfile(), { goal: { value: '办成', status: 'confirmed', source: 'user_statement' } }, 1);
    const cleared = apply(confirmed, { goal: { value: null, status: 'unknown', source: 'unavailable' } }, 2);
    expect(cleared.goal.status).toBe('unknown');
    expect(cleared.goal.value).toBeNull();
    expect(cleared.goal.revision).toBe(2);
    expect(cleared.goal.updatedBy).toBe('张伟');
    expect(cleared.revision).toBe(2);
  });

  it('T9 空补丁被拒绝', () => {
    expect(() => apply(emptyEventProfile(), {}, 1)).toThrow('没有要写入的活动档案字段。');
  });
});

describe('eventProfile 事实标注不变量', () => {
  it('T3 模型推断与预填不能直接标为已确认', () => {
    expect(() => apply(emptyEventProfile(), {
      goal: { value: '签下三家', status: 'confirmed', source: 'model_inference' },
    })).toThrow(/预填或模型推断不能直接标为已确认/);
    expect(() => apply(emptyEventProfile(), {
      goal: { value: '签下三家', status: 'confirmed', source: 'preset' },
    })).toThrow(/预填或模型推断不能直接标为已确认/);
  });

  it('T3 推断的事实必须写明依据', () => {
    expect(() => apply(emptyEventProfile(), {
      venue: { value: { city: '杭州', venueName: '云栖厅' }, status: 'inferred', source: 'model_inference' },
    })).toThrow(/推断的事实须写明依据/);
    const next = apply(emptyEventProfile(), {
      venue: { value: { city: '杭州', venueName: '云栖厅' }, status: 'inferred', source: 'model_inference', note: '按客户给的地址反查' },
    });
    expect(next.venue.status).toBe('inferred');
  });

  it('待确认的事实允许带值', () => {
    const next = apply(emptyEventProfile(), {
      date: { value: '2026-12-06', status: 'pending', source: 'user_statement', note: '客户口头提到周六' },
    });
    expect(next.date.status).toBe('pending');
    expect(next.date.value).toBe('2026-12-06');
  });

  it('未知事实不能携带值', () => {
    expect(() => apply(emptyEventProfile(), {
      goal: { value: '办成', status: 'unknown', source: 'unavailable' },
    })).toThrow(/未知事实不能携带值/);
  });

  it('档案版本大于 0 时必须留修改人与时间', () => {
    const raw = { ...emptyEventProfile(), revision: 1, updatedBy: '', updatedAt: '' };
    expect(eventProfileSchema.safeParse(raw).success).toBe(false);
  });

  it('事实版本不能超过档案版本', () => {
    const raw = {
      ...emptyEventProfile(),
      revision: 1,
      updatedBy: '张伟',
      updatedAt: at(1),
      date: { value: '2026-12-06', status: 'pending', source: 'user_statement', note: '', revision: 2, updatedBy: '张伟', updatedAt: at(1) },
    };
    expect(eventProfileSchema.safeParse(raw).success).toBe(false);
  });
});

describe('eventProfile 时间与时区', () => {
  it('T5 不存在的时区被拒绝且不回落系统时区', () => {
    expect(() => apply(emptyEventProfile(), {
      timeWindow: { value: { ...windowValue, timeZone: 'Mars/Olympus' }, status: 'confirmed', source: 'user_statement' },
    })).toThrow(/IANA/);
  });

  it('T6 结束不晚于开始且未声明跨天时被拒绝', () => {
    expect(() => apply(emptyEventProfile(), {
      timeWindow: { value: { ...windowValue, startTime: '18:00', endTime: '14:00', endsNextDay: false }, status: 'confirmed', source: 'user_statement' },
    })).toThrow(/须明确跨天/);
  });

  it('T6 明确跨天后允许并顺延到次日', () => {
    const profile = apply(emptyEventProfile(), {
      date: confirmedDate,
      timeWindow: { value: { startTime: '22:00', endTime: '01:00', timeZone: 'Asia/Shanghai', endsNextDay: true }, status: 'confirmed', source: 'user_statement' },
    });
    const instants = eventInstants(profile);
    expect(instants.reason).toBe('ok');
    expect(instants.startsAt).toBe('2026-12-06T22:00:00+08:00');
    expect(instants.endsAt).toBe('2026-12-07T01:00:00+08:00');
    expect(instants.confirmed).toBe(true);
  });

  it('T4 日期已确认而时间窗未知：日期保留，瞬间不可派生', () => {
    const profile = apply(emptyEventProfile(), { date: confirmedDate });
    expect(profile.date.status).toBe('confirmed');
    expect(profile.timeWindow.status).toBe('unknown');
    expect(eventInstants(profile).reason).toBe('incomplete');
    expect(eventInstants(profile).startsAt).toBeNull();
  });

  it('T7 夏令时不存在与有歧义的墙上时间都返回原因，不猜偏移', () => {
    const nonexistent = apply(emptyEventProfile(), {
      date: { value: '2026-03-08', status: 'confirmed', source: 'user_statement' },
      timeWindow: { value: { startTime: '02:30', endTime: '04:00', timeZone: 'America/New_York', endsNextDay: false }, status: 'confirmed', source: 'user_statement' },
    });
    expect(eventInstants(nonexistent).reason).toBe('nonexistent');
    const ambiguous = apply(emptyEventProfile(), {
      date: { value: '2026-11-01', status: 'confirmed', source: 'user_statement' },
      timeWindow: { value: { startTime: '01:30', endTime: '03:00', timeZone: 'America/New_York', endsNextDay: false }, status: 'confirmed', source: 'user_statement' },
    });
    expect(eventInstants(ambiguous).reason).toBe('ambiguous');
  });
});

describe('eventProfile 预算与到场', () => {
  it('T8 已知金额必须 CNY 且写明依据', () => {
    expect(() => apply(emptyEventProfile(), {
      budget: { value: { estimate: { amountMinor: 120000, currency: null, basisNote: '客户口头' }, actual: null }, status: 'pending', source: 'user_statement' },
    })).toThrow(/CNY/);
    expect(() => apply(emptyEventProfile(), {
      budget: { value: { estimate: { amountMinor: 120000, currency: 'CNY', basisNote: '  ' }, actual: null }, status: 'pending', source: 'user_statement' },
    })).toThrow(/依据/);
    const next = apply(emptyEventProfile(), {
      budget: { value: { estimate: { amountMinor: 120000, currency: 'CNY', basisNote: '客户口头预算' }, actual: null }, status: 'pending', source: 'user_statement' },
    });
    expect(next.budget.value?.estimate?.amountMinor).toBe(120000);
  });

  it('T15 预期到场只接受 0–100000 的整数', () => {
    for (const value of [-1, 1.5, 100001]) {
      expect(() => apply(emptyEventProfile(), {
        expectedAttendance: { value, status: 'pending', source: 'user_statement' },
      })).toThrow();
    }
    const next = apply(emptyEventProfile(), {
      expectedAttendance: { value: 96, status: 'confirmed', source: 'user_statement' },
    });
    expect(next.expectedAttendance.value).toBe(96);
  });
});

describe('publishEventView 白名单', () => {
  it('T10 只导出白名单键，预算与分工永不出现', () => {
    const profile = apply(emptyEventProfile(), {
      date: confirmedDate,
      timeWindow: { value: windowValue, status: 'confirmed', source: 'user_statement' },
      venue: { value: { city: '杭州', venueName: '云栖厅' }, status: 'confirmed', source: 'user_statement' },
      budget: { value: { estimate: { amountMinor: 120000, currency: 'CNY', basisNote: '客户口头' }, actual: null }, status: 'confirmed', source: 'user_statement' },
      expectedAttendance: { value: 96, status: 'confirmed', source: 'user_statement' },
      goal: { value: '签下三家', status: 'confirmed', source: 'user_statement' },
      division: { value: [{ roleName: '签到', ownerName: '李娜' }], status: 'confirmed', source: 'user_statement' },
    });
    const view = publishEventView(profile, { eventName: '品牌快闪', guests: 100, guestsConfirmed: true });
    expect(Object.keys(view).sort()).toEqual([...PUBLISHED_EVENT_VIEW_KEYS].sort());
    expect(view.date).toBe('2026-12-06');
    expect(view.city).toBe('杭州');
    expect(view.goal).toBe('签下三家');
    expect(JSON.stringify(view)).not.toContain('120000');
    expect(JSON.stringify(view)).not.toContain('签到');
    expect(JSON.stringify(view)).not.toContain('96');
  });

  it('未确认的事实与人数不冒充确定值', () => {
    const profile = apply(emptyEventProfile(), {
      date: { value: '2026-12-06', status: 'pending', source: 'user_statement' },
      timeWindow: { value: windowValue, status: 'pending', source: 'user_statement' },
    });
    const view = publishEventView(profile, { eventName: '品牌快闪', guests: 100, guestsConfirmed: false });
    expect(view.date).toBeNull();
    expect(view.startTime).toBeNull();
    expect(view.guests).toBeNull();
    expect(view.guestsPending).toBe(true);
  });
});

describe('eventInstants 基本换算', () => {
  it('上海时区输出带 +08:00 的瞬间', () => {
    const profile = apply(emptyEventProfile(), { date: confirmedDate, timeWindow: confirmedWindow });
    const instants = eventInstants(profile);
    expect(instants.startsAt).toBe('2026-12-06T14:00:00+08:00');
    expect(instants.endsAt).toBe('2026-12-06T18:00:00+08:00');
    expect(instants.timeZone).toBe('Asia/Shanghai');
  });
});
