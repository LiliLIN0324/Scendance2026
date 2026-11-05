import { describe, expect, it } from 'vitest';
import {
  explainRanking,
  rankCandidates,
  scoreCandidate,
  type ScoreInput,
} from '../supabase/functions/_shared/scorecard.ts';

function candidate(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    candidateId: 'cand-a',
    validated: true,
    clearances: [
      { from: 'table', to: 'wall', gap: 2, required: 2 },
      { from: 'seat', to: 'table', gap: 3, required: 2 },
    ],
    violations: [],
    occupancy: { used: 42, capacity: 100 },
    coverage: { requested: 6, achieved: 6 },
    objectCount: 6,
    ...overrides,
  };
}

describe('候选评分卡', () => {
  it('全达标候选得分不低于 90，且 breakdown 之和等于总分', () => {
    const result = scoreCandidate(candidate());
    expect(result.rejected).toBe(false);
    expect(result.total).toBeGreaterThanOrEqual(90);
    expect(result.breakdown).toHaveLength(5);
    expect(result.breakdown.reduce((sum, item) => sum + item.points, 0)).toBe(result.total);
  });

  it('存在 fatal 违规直接否决，total 归零', () => {
    const result = scoreCandidate(candidate({
      violations: [{ code: 'KID-01', severity: 'fatal' }],
    }));
    expect(result.rejected).toBe(true);
    expect(result.total).toBe(0);
    expect(result.reasons.join(' ')).toContain('KID-01');
  });

  it('未经校验的候选直接否决', () => {
    const result = scoreCandidate(candidate({ validated: false }));
    expect(result.rejected).toBe(true);
    expect(result.total).toBe(0);
    expect(result.reasons.join(' ')).toContain('未经校验');
  });

  it('区域负荷超过 100% 直接否决', () => {
    const result = scoreCandidate(candidate({ occupancy: { used: 120, capacity: 100 } }));
    expect(result.rejected).toBe(true);
    expect(result.total).toBe(0);
  });

  it('负荷刚好 100% 不否决，但该维度只拿 2 分', () => {
    const result = scoreCandidate(candidate({ occupancy: { used: 100, capacity: 100 } }));
    expect(result.rejected).toBe(false);
    expect(result.breakdown.find(item => item.name === 'occupancy')?.points).toBe(2);
  });

  it('无 clearances 时净距计 0 分，即使合法性满分总分也不超过 75', () => {
    const result = scoreCandidate(candidate({ clearances: undefined }));
    expect(result.rejected).toBe(false);
    expect(result.total).toBeLessThanOrEqual(75);
    expect(result.breakdown.find(item => item.name === 'legality')?.points).toBe(40);
    expect(result.reasons.join(' ')).toContain('未实测净距');
  });

  it('warn 每条扣 5 分，最低扣到 0', () => {
    const result = scoreCandidate(candidate({
      violations: [
        { code: 'WARN-1', severity: 'warn' },
        { code: 'WARN-2', severity: 'warn' },
      ],
    }));
    expect(result.rejected).toBe(false);
    expect(result.breakdown.find(item => item.name === 'legality')?.points).toBe(30);
  });

  it('rankCandidates 把否决项排最后、同分按 candidateId 排，且不修改入参', () => {
    const inputs: ScoreInput[] = [
      candidate({ candidateId: 'cand-x', validated: false }),
      candidate({
        candidateId: 'cand-b',
        clearances: [{ from: 'table', to: 'wall', gap: 0, required: 1 }],
      }),
      candidate({ candidateId: 'cand-top' }),
      candidate({
        candidateId: 'cand-a',
        clearances: [{ from: 'table', to: 'wall', gap: 0, required: 1 }],
      }),
      candidate({
        candidateId: 'cand-y',
        violations: [{ code: 'OUT_OF_BOUNDS', severity: 'fatal' }],
      }),
    ];
    const snapshot = structuredClone(inputs);

    const ranked = rankCandidates(inputs);
    expect(ranked.map(result => result.candidateId)).toEqual([
      'cand-top',
      'cand-a',
      'cand-b',
      'cand-x',
      'cand-y',
    ]);
    expect(inputs).toEqual(snapshot);
    expect(ranked).not.toBe(inputs);
  });

  it('同分排序确定：重复运行结果一致', () => {
    const inputs: ScoreInput[] = [
      candidate({ candidateId: 'cand-z' }),
      candidate({ candidateId: 'cand-a' }),
    ];
    const first = rankCandidates(inputs);
    const second = rankCandidates(inputs);
    expect(first.map(result => result.candidateId)).toEqual(['cand-a', 'cand-z']);
    expect(second).toEqual(first);
  });

  it('explainRanking 输出中文序号与「已否决」', () => {
    const text = explainRanking(rankCandidates([
      candidate({ candidateId: 'cand-a' }),
      candidate({ candidateId: 'cand-b', clearances: [{ from: 'table', to: 'wall', gap: 1, required: 2 }] }),
      candidate({ candidateId: 'cand-c', violations: [{ code: 'KID-01', severity: 'fatal' }] }),
    ]));
    expect(text).toContain('候选排序');
    expect(text).toContain('1.');
    expect(text).toContain('2.');
    expect(text).toContain('已否决');
    expect(text).toContain('KID-01');
  });

  it('explainRanking 超过 400 字符时只列前 3 个', () => {
    const inputs = Array.from({ length: 10 }, (_, index) => candidate({
      candidateId: `cand-${String(index).padStart(2, '0')}`,
      violations: [{ code: `WARN-${'X'.repeat(80)}-${index}`, severity: 'warn' }],
    }));
    const text = explainRanking(rankCandidates(inputs));
    expect(text.length).toBeLessThanOrEqual(400);
    expect(text).toContain('其余 7 个略');
  });
});
