import { describe, expect, it } from 'vitest';
import { buildGenerationReport, buildReasoning, buildSuggestion } from './generation-report';
import type { BingoScore } from './bingo-score';

function score(total: number): BingoScore {
  return {
    total,
    breakdown: { spacing: total, aisle: total, bounds: total, wall: total },
    itemCount: 10,
    passedCount: 10,
    failedCount: 0,
    fixedCount: 0,
    stuckCount: 0,
    summary: `体检 ${total} 分`,
  };
}

const base = {
  score: score(100),
  placedCount: 24,
  refusedCount: 0,
  skippedCount: 0,
  fixedCount: 0,
  stuckCount: 0,
  areaM2: 120,
  durationMs: 800,
};

describe('buildReasoning', () => {
  it('只陈述实测数字：面积 + 件数', () => {
    expect(buildReasoning(base)).toBe('按 120 m² 的场地摆了 24 件。');
  });

  it('挪开 / 挪不动 / 被拒 / 保留 都按实际计数出现', () => {
    const text = buildReasoning({
      ...base,
      fixedCount: 3,
      stuckCount: 2,
      refusedCount: 1,
      skippedCount: 4,
    });
    expect(text).toContain('压住通道和边界的 3 件已自动挪开。');
    expect(text).toContain('还有 2 件挪不动，已在画布标红。');
    expect(text).toContain('1 件没过判据被拒，没有硬塞进场地。');
    expect(text).toContain('4 件按原样保留，这次没动。');
  });

  it('面积为小数时保留一位，不出现长串浮点尾数', () => {
    expect(buildReasoning({ ...base, areaM2: 83.3333333 })).toContain('83.3 m²');
  });

  it('没有这些情况时不写多余的话', () => {
    const text = buildReasoning(base);
    expect(text).not.toContain('挪开');
    expect(text).not.toContain('标红');
    expect(text).not.toContain('被拒');
  });
});

describe('buildSuggestion', () => {
  it('有挪不动的件时，先让处理标红', () => {
    expect(buildSuggestion({ ...base, stuckCount: 2, refusedCount: 5 })).toBe('先处理 2 处标红（压通道或压墙），再交场。');
  });

  it('没有标红但有被拒件时，先说被拒', () => {
    expect(buildSuggestion({ ...base, refusedCount: 5 })).toBe('有 5 件因判据被拒，换个位置或换个素材再试一次。');
  });

  it('体检分低时给复核建议', () => {
    expect(buildSuggestion({ ...base, score: score(82) })).toContain('体检 82 分');
  });

  it('全通过时给巡场建议', () => {
    expect(buildSuggestion(base)).toContain('体检 100 分');
  });
});

describe('buildGenerationReport', () => {
  it('组装体检分、为什么、建议与耗时', () => {
    const report = buildGenerationReport(base);
    expect(report.score?.total).toBe(100);
    expect(report.reasoning).toContain('摆了 24 件');
    expect(report.suggestion).toContain('体检 100 分');
    expect(report.durationMs).toBe(800);
  });

  it('拿不到思考轮数时，整段 rounds 不出现（不拿别的数字冒充）', () => {
    expect(buildGenerationReport(base).rounds).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(buildGenerationReport(base), 'rounds')).toBe(false);
  });

  it('拿到真实轮数时如实带上', () => {
    expect(buildGenerationReport({ ...base, rounds: 12 }).rounds).toBe(12);
  });
});
