import { describe, expect, it } from 'vitest';
import {
  applyEventProfileProposal, eventProfileContext, formatEventProfileContext, proposeEventProfileChange,
  type EventProfileProposal,
} from './event-profile-context';
import { emptyEventProfile, updateEventProfile, type EventProfile } from './event-profile';

const meta = { updatedBy: '策划甲', updatedAt: '2026-10-01T00:00:00.000Z' };
const confirmation = { confirmedBy: '终树', confirmedAt: '2026-10-02T00:00:00.000Z' };

function profile(): EventProfile {
  return updateEventProfile(emptyEventProfile(), {
    date: { value: '2026-12-20', status: 'confirmed', source: 'user_statement' },
    timeWindow: { value: { startTime: '14:00', endTime: '18:00', timeZone: 'Asia/Shanghai', endsNextDay: false },
      status: 'confirmed', source: 'user_statement' },
    venue: { value: { city: '杭州', venueName: '湖畔厅' }, status: 'confirmed', source: 'user_statement' },
    budget: { value: { estimate: { amountMinor: 1_200_000, currency: 'CNY', basisNote: '客户口述' }, actual: null },
      status: 'pending', source: 'user_statement', note: '仅口头' },
    expectedAttendance: { value: 60, status: 'inferred', source: 'model_inference', note: '按场地容量推' },
    goal: { value: '完成年度分享', status: 'confirmed', source: 'user_statement' },
    division: { value: [{ roleName: '签到', ownerName: '小乙' }], status: 'pending', source: 'user_statement' },
  }, 0, meta);
}

describe('活动档案只读上下文（M6）', () => {
  it('没有档案就是 absent：不合成空档案，也不给默认值', () => {
    const facts = eventProfileContext(undefined);
    expect(facts).toHaveLength(7);
    expect(facts.every(fact => fact.state === 'absent' && fact.valueText === null && fact.source === null)).toBe(true);
    const text = formatEventProfileContext(undefined);
    expect(text).toContain('尚未创建活动档案');
    expect(text).not.toMatch(/¥|\d+ 人/);
  });

  it('显式空档案全部是待确认，不把未填写读成已知', () => {
    const facts = eventProfileContext(emptyEventProfile());
    expect(facts.every(fact => fact.state === 'unknown' && fact.valueText === null)).toBe(true);
    expect(formatEventProfileContext(emptyEventProfile())).toContain('待确认（未填写，不得推测）');
  });

  it('确认、待确认、推断三种状态各自标注，推断永不显示为已确认', () => {
    const text = formatEventProfileContext(profile());
    expect(text).toContain('日期：2026-12-20（已确认）');
    expect(text).toContain('时间窗：14:00–18:00 Asia/Shanghai（已确认）');
    expect(text).toContain('城市与场地：杭州 · 湖畔厅（已确认）');
    expect(text).toContain('目标结果：完成年度分享（已确认）');
    expect(text).toContain('预期到场：60 人（推断，需人工确认）｜依据：按场地容量推');
    expect(text).not.toMatch(/60 人（已确认）/);
  });

  it('预算与分工标成内部可见，值照实给出但仍带状态', () => {
    const facts = eventProfileContext(profile());
    expect(facts.find(fact => fact.key === 'budget')?.internal).toBe(true);
    expect(facts.find(fact => fact.key === 'division')?.internal).toBe(true);
    expect(facts.find(fact => fact.key === 'date')?.internal).toBe(false);
    const text = formatEventProfileContext(profile());
    expect(text).toContain('预算（内部可见）：估算 ¥12000.00｜实际 待确认（待确认）｜依据：仅口头');
    expect(text).toContain('分工（内部可见）：签到（小乙）（待确认）');
  });

  it('上下文只读：改动返回的对象不会改到档案，重复调用结果一致', () => {
    const source = profile();
    const facts = eventProfileContext(source);
    facts[0]!.valueText = '1999-01-01';
    facts[0]!.state = 'confirmed';
    expect(eventProfileContext(source)[0]!.valueText).toBe('2026-12-20');
    expect(source.date.value).toBe('2026-12-20');
    expect(formatEventProfileContext(source)).toBe(formatEventProfileContext(source));
    expect(formatEventProfileContext(source)).toContain('档案版本：v1｜更新人：策划甲｜更新时间：2026-10-01T00:00:00.000Z');
  });
});

describe('活动档案提案门（M6）', () => {
  it('提案只试算不落盘，字段、基版本与预览都对得上', () => {
    const base = profile();
    const proposal = proposeEventProfileChange(base,
      { goal: { value: '改成双城联动', status: 'pending', source: 'model_inference' } }, meta);
    expect(proposal.baseRevision).toBe(1);
    expect(proposal.changedKeys).toEqual(['goal']);
    expect(proposal.requiresHumanConfirmation).toBe(true);
    expect(proposal.preview.revision).toBe(2);
    expect(proposal.preview.goal.value).toBe('改成双城联动');
    expect(base.revision).toBe(1);
    expect(base.goal.value).toBe('完成年度分享');
  });

  it('模型推断不能直接产 confirmed 提案，在本层就被拒', () => {
    expect(() => proposeEventProfileChange(profile(),
      { goal: { value: '模型猜的目标', status: 'confirmed', source: 'model_inference' } }, meta))
      .toThrow(/模型推断/);
  });

  it('空提案被拒绝，避免无意义地升版本', () => {
    expect(() => proposeEventProfileChange(profile(), {}, meta)).toThrow(/没有要提议/);
  });

  it('没有确认人不能落盘，AI 或预设不能代替人工确认', () => {
    const proposal = proposeEventProfileChange(profile(), { goal: { value: '新目标', status: 'pending', source: 'model_inference' } }, meta);
    expect(() => applyEventProfileProposal(profile(), proposal, { confirmedBy: '   ', confirmedAt: confirmation.confirmedAt }))
      .toThrow(/确认人/);
  });

  it('拒绝被改成不需要确认的伪造提案', () => {
    const proposal = proposeEventProfileChange(profile(), { goal: { value: '新目标', status: 'pending', source: 'model_inference' } }, meta);
    const forged = { ...proposal, requiresHumanConfirmation: false } as unknown as EventProfileProposal;
    expect(() => applyEventProfileProposal(profile(), forged, confirmation)).toThrow(/人工确认/);
  });

  it('档案已被别人改过时拒绝覆盖，并提示重新核对', () => {
    const base = profile();
    const proposal = proposeEventProfileChange(base, { goal: { value: '新目标', status: 'pending', source: 'model_inference' } }, meta);
    const newer = updateEventProfile(base, { goal: { value: '别人改的目标', status: 'confirmed', source: 'user_statement' } }, 1, meta);
    expect(() => applyEventProfileProposal(newer, proposal, confirmation)).toThrow(/版本已变化/);
  });

  it('落盘使用确认人与确认时间，其他事实原样保留', () => {
    const base = profile();
    const proposal = proposeEventProfileChange(base, { goal: { value: '新目标', status: 'pending', source: 'model_inference' } }, meta);
    const applied = applyEventProfileProposal(base, proposal, confirmation);
    expect(applied.revision).toBe(2);
    expect(applied.goal.value).toBe('新目标');
    expect(applied.goal.status).toBe('pending');
    expect(applied.goal.updatedBy).toBe('终树');
    expect(applied.goal.updatedAt).toBe(confirmation.confirmedAt);
    expect(applied.updatedBy).toBe('终树');
    expect(applied.date).toEqual(base.date);
    expect(applied.expectedAttendance).toEqual(base.expectedAttendance);
  });

  it('同一份提案不能重复落盘：第二次会因版本已变化被拒', () => {
    const base = profile();
    const proposal = proposeEventProfileChange(base, { goal: { value: '只落一次', status: 'pending', source: 'model_inference' } }, meta);
    const applied = applyEventProfileProposal(base, proposal, confirmation);
    expect(() => applyEventProfileProposal(applied, proposal, confirmation)).toThrow(/版本已变化/);
  });

  it('预览版本不连续时拒绝，防止拼接过期提案', () => {
    const base = profile();
    const proposal = proposeEventProfileChange(base, { goal: { value: '跳版本', status: 'pending', source: 'model_inference' } }, meta);
    const tampered = { ...proposal, preview: { ...proposal.preview, revision: proposal.baseRevision + 2 } };
    expect(() => applyEventProfileProposal(base, tampered, confirmation)).toThrow(/版本不连续/);
  });
});
