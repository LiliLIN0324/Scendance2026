// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BingoScore } from '../../../lib/bingo-score';
import { BINGO_MARK_KEY, BINGO_RETURN_KEY } from '../lib/bingo-status';
import { __resetGenerationOutcome, setGenerationOutcome } from '../lib/use-generation-outcome';
import { BingoAuditCard } from './bingo-audit-card';

const SHARE = '11111111-1111-4111-8111-111111111111';

const SCORE: BingoScore = {
  total: 88,
  breakdown: { spacing: 90, aisle: 80, bounds: 100, wall: 85 },
  itemCount: 12,
  passedCount: 10,
  failedCount: 2,
  fixedCount: 3,
  stuckCount: 1,
  summary: '发现 3 处堵点已自动挪开，1 处挪不动已标红（请手动调整）',
};

beforeEach(() => {
  localStorage.clear();
  __resetGenerationOutcome();
});
afterEach(() => {
  cleanup();
  __resetGenerationOutcome();
});

describe('BingoAuditCard', () => {
  it('renders nothing when no review was ever sent', () => {
    const { container } = render(<BingoAuditCard/>);
    expect(container.innerHTML).toBe('');
  });

  it('shows the plan, 待评 phase and pin count from the local review record', () => {
    localStorage.setItem(BINGO_MARK_KEY, JSON.stringify([{
      saved: true,
      status: 'needs-review',
      projectKey: 'local-draft',
      title: '发布会',
      shareId: SHARE,
      reviewPlanKey: SHARE,
      markedAt: '2026-10-31T00:00:00.000Z',
    }]));
    render(<BingoAuditCard/>);
    expect(screen.getByText('甲方评审')).toBeTruthy();
    expect(screen.getAllByText('待评').length).toBeGreaterThan(0);
    expect(screen.getByText('发布会')).toBeTruthy();
    expect(screen.getByLabelText('打开评审页').getAttribute('href')).toBe(`/review/${SHARE}`);
  });

  it('clears the receipt from the audit card', () => {
    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1, planKey: SHARE, at: '2026-10-31T02:00:00.000Z', href: `/review/${SHARE}`,
    }));
    render(<BingoAuditCard/>);
    expect(screen.getByText('已回执')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('清回执'));
    expect(localStorage.getItem(BINGO_RETURN_KEY)).toBeNull();
  });

  it('renders the generation outcome summary next to the receipt when present', () => {
    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1, planKey: SHARE, at: '2026-10-31T02:00:00.000Z', href: `/review/${SHARE}`,
    }));
    setGenerationOutcome({
      placed: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      refused: [{ item: { id: 'd' }, reason: '越界', code: 'OUT_OF_BOUNDS' }],
      skipped: [
        { item: { id: 'e' }, reason: '锁着', code: 'LOCKED' },
        { item: { id: 'f' }, reason: '没落点', code: 'NO_SPOT' },
      ],
    });
    render(<BingoAuditCard/>);
    expect(screen.getByText('本次结果：')).toBeTruthy();
    expect(screen.getByText(/放了 3 件/)).toBeTruthy();
    expect(screen.getByText(/被拒 1 件/)).toBeTruthy();
    expect(screen.getByText(/跳过 2 件/)).toBeTruthy();
  });

  it('hides the outcome line when no outcome was injected (placeholder)', () => {
    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1, planKey: SHARE, at: '2026-10-31T02:00:00.000Z', href: `/review/${SHARE}`,
    }));
    render(<BingoAuditCard/>);
    expect(screen.queryByText('本次结果：')).toBeNull();
  });

  it('renders the体检分 / 完成卡 / 被拒件 from the outcome report (第 7 批收尾)', () => {
    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1, planKey: SHARE, at: '2026-10-31T02:00:00.000Z', href: `/review/${SHARE}`,
    }));
    setGenerationOutcome({
      placed: [{ id: 'a' }, { id: 'b' }],
      refused: [{ item: { id: 'x' }, reason: '出界', code: 'OUT_OF_BOUNDS' }],
      skipped: [],
      report: {
        score: SCORE,
        reasoning: '按 120 m² 的场地摆了 2 件。',
        suggestion: '先处理 1 处标红（压通道或压墙），再交场。',
        durationMs: 1234,
      },
    });
    render(<BingoAuditCard/>);

    // 体检分分区
    expect(screen.getByTestId('bingo-score')).toBeTruthy();
    expect(screen.getByText('体检分')).toBeTruthy();
    expect(screen.getByText('88')).toBeTruthy();
    // 完成卡 Z8
    expect(screen.getByTestId('bingo-z8')).toBeTruthy();
    expect(screen.getByText('为什么这么摆')).toBeTruthy();
    expect(screen.getByText('按 120 m² 的场地摆了 2 件。')).toBeTruthy();
    expect(screen.getByText('后续建议')).toBeTruthy();
    expect(screen.getByText(/先处理 1 处标红/)).toBeTruthy();
    // 耗时行标题写准：report 里的耗时只覆盖落盘段
    expect(screen.getByText('落盘耗时')).toBeTruthy();
    expect(screen.getByText('1.2s')).toBeTruthy();
    // 被拒件有人话，不给 code
    const refused = screen.getByTestId('bingo-refused');
    expect(screen.getByText('被拒件（1）')).toBeTruthy();
    expect(within(refused).getByText('出界')).toBeTruthy();
  });

  it('omits the思考轮数 row when the report carries no rounds', () => {
    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1, planKey: SHARE, at: '2026-10-31T02:00:00.000Z', href: `/review/${SHARE}`,
    }));
    setGenerationOutcome({
      placed: [{ id: 'a' }],
      refused: [],
      skipped: [],
      report: { score: SCORE, durationMs: 300 },
    });
    render(<BingoAuditCard/>);
    expect(screen.queryByText('思考轮数')).toBeNull();
  });

  it('lets props win over the outcome report (调用方注入优先)', () => {
    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1, planKey: SHARE, at: '2026-10-31T02:00:00.000Z', href: `/review/${SHARE}`,
    }));
    setGenerationOutcome({
      placed: [{ id: 'a' }],
      refused: [],
      skipped: [],
      report: { score: SCORE, reasoning: '账本里的理由', suggestion: '账本里的建议', durationMs: 999 },
    });
    render(<BingoAuditCard score={{ ...SCORE, total: 60 }} reasoning="props 的理由" durationMs={40}/>);
    expect(screen.getByText('60')).toBeTruthy();
    expect(screen.getByText('props 的理由')).toBeTruthy();
    expect(screen.queryByText('账本里的理由')).toBeNull();
    expect(screen.getByText('耗时')).toBeTruthy();
    expect(screen.getByText('40ms')).toBeTruthy();
  });

  it('refreshes when an outcome is written after the card mounted (Outcome 写了但卡不刷新)', () => {
    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1, planKey: SHARE, at: '2026-10-31T02:00:00.000Z', href: `/review/${SHARE}`,
    }));
    render(<BingoAuditCard/>);
    expect(screen.queryByTestId('bingo-score')).toBeNull();

    act(() => {
      setGenerationOutcome({
        placed: [{ id: 'a' }],
        refused: [],
        skipped: [],
        report: { score: SCORE, durationMs: 500 },
      });
    });

    expect(screen.getByTestId('bingo-score')).toBeTruthy();
    expect(screen.getByText('体检分')).toBeTruthy();
    expect(screen.getByText('本次结果：')).toBeTruthy();
  });});
