// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BINGO_MARK_KEY, BINGO_RETURN_KEY } from '../lib/bingo-status';
import { __resetGenerationOutcome, setGenerationOutcome } from '../lib/use-generation-outcome';
import { BingoAuditCard } from './bingo-audit-card';

const SHARE = '11111111-1111-4111-8111-111111111111';

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
});
