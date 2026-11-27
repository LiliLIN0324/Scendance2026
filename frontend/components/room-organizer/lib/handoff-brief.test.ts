import { describe, expect, it } from 'vitest';
import { flowBriefScopeForExport, readConversationGuests, resolveActivityHeadcount, resolveBriefHeadcount } from './handoff-brief';

const storage = (record: Record<string, string>) => ({ getItem: (key: string) => record[key] ?? null });

describe('handoff-brief（B3 人数读源地基）', () => {
  it('本机 brief 已确认 → 以人的确认为准，压过对话里更早/更晚的数', () => {
    expect(resolveBriefHeadcount({ legacy: { guests: 30, confirmed: true }, conversation: { guests: 40 } }))
      .toEqual({ value: 30, source: 'legacy-confirmed' });
  });

  it('本机未确认、对话有数 → 取对话（这单当场说的）', () => {
    expect(resolveBriefHeadcount({ legacy: { guests: 30 }, conversation: { guests: 40 } }))
      .toEqual({ value: 40, source: 'conversation' });
  });

  it('只有本机未确认的数 → 退回它，并如实标未确认来源', () => {
    expect(resolveBriefHeadcount({ legacy: { guests: 30, confirmed: false } }))
      .toEqual({ value: 30, source: 'legacy-unconfirmed' });
  });

  it('两边都没有 → unknown，不拿 0 或占位数顶上', () => {
    expect(resolveBriefHeadcount({})).toEqual({ value: null, source: 'unknown' });
    expect(resolveBriefHeadcount({ legacy: null, conversation: null })).toEqual({ value: null, source: 'unknown' });
    expect(resolveBriefHeadcount({ conversation: {} })).toEqual({ value: null, source: 'unknown' });
  });

  it('非正数 / 非有限数一律当没说，避免 0 人或 NaN 被当成真实人数导出', () => {
    expect(resolveBriefHeadcount({ legacy: { guests: 0, confirmed: true } })).toEqual({ value: null, source: 'unknown' });
    expect(resolveBriefHeadcount({ legacy: { guests: -5 } })).toEqual({ value: null, source: 'unknown' });
    expect(resolveBriefHeadcount({ conversation: { guests: Number.NaN } })).toEqual({ value: null, source: 'unknown' });
    expect(resolveBriefHeadcount({ conversation: { guests: Number.POSITIVE_INFINITY } })).toEqual({ value: null, source: 'unknown' });
  });

  it('小数四舍五入成人头整数', () => {
    expect(resolveBriefHeadcount({ conversation: { guests: 39.6 } })).toEqual({ value: 40, source: 'conversation' });
  });

  it('导出 scope：有项目 id 才给键，本机草稿返回 null（不读所有草稿共用的那个桶）', () => {
    expect(flowBriefScopeForExport('9a889d2b-0e71-45bd-90b7-d9f36f7b665d')).toBe('project:9a889d2b-0e71-45bd-90b7-d9f36f7b665d');
    expect(flowBriefScopeForExport('  proj-1  ')).toBe('project:proj-1');
    expect(flowBriefScopeForExport(null)).toBeNull();
    expect(flowBriefScopeForExport(undefined)).toBeNull();
    expect(flowBriefScopeForExport('')).toBeNull();
    expect(flowBriefScopeForExport('   ')).toBeNull();
  });

  it('读对话桶：按 project:<id> 取 brief.guests，坏 JSON / 缺键 / 无 id 一律 undefined', () => {
    const read = (record: Record<string, string>, projectId: string | null = 'p1') => readConversationGuests(projectId, storage(record));
    expect(read({ 'scendance:outdoor-flow:project:p1': JSON.stringify({ brief: { guests: 40 } }) })).toBe(40);
    expect(read({ 'scendance:outdoor-flow:project:p1': JSON.stringify({ brief: {} }) })).toBeUndefined();
    expect(read({ 'scendance:outdoor-flow:project:p1': '{broken' })).toBeUndefined();
    expect(read({ 'scendance:outdoor-flow:project:p1': JSON.stringify({ brief: { guests: 40 } }), 'scendance:outdoor-flow:project:local': JSON.stringify({ brief: { guests: 60 } }) }, null)).toBeUndefined();
    expect(read({}, null)).toBeUndefined();
    expect(readConversationGuests('p1', null)).toBeUndefined();
  });

  it('本机草稿拿不到项目 id 时，绝不把共用对话桶的人数当成这单的', () => {
    const shared = storage({ 'scendance:outdoor-flow:project:local': JSON.stringify({ brief: { guests: 60 } }) });
    const resolved = resolveActivityHeadcount({
      brief: { status: 'present', value: { guests: 0, guestsConfirmed: false } },
      projectId: undefined,
      storage: shared,
    });
    expect(resolved).toEqual({ value: null, source: 'unknown' });
  });

  it('合成：本机已确认压过对话；未确认时对话数胜出但仍标 conversation（导出侧据此写「尚未确认」）', () => {
    const conversations = storage({ 'scendance:outdoor-flow:project:p1': JSON.stringify({ brief: { guests: 40 } }) });
    expect(resolveActivityHeadcount({ brief: { status: 'present', value: { guests: 30, guestsConfirmed: true } }, projectId: 'p1', storage: conversations }))
      .toEqual({ value: 30, source: 'legacy-confirmed' });
    expect(resolveActivityHeadcount({ brief: { status: 'present', value: { guests: 30, guestsConfirmed: false } }, projectId: 'p1', storage: conversations }))
      .toEqual({ value: 40, source: 'conversation' });
    expect(resolveActivityHeadcount({ brief: { status: 'absent' }, projectId: 'p1', storage: conversations }))
      .toEqual({ value: 40, source: 'conversation' });
  });
});
