import { describe, expect, it } from 'vitest';
import { flowBriefScopeForExport, resolveBriefHeadcount } from './handoff-brief';

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
});
