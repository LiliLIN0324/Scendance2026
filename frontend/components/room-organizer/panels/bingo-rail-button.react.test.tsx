// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVIEW_SHARE_PIN_STORAGE_KEY, appendReviewSharePin } from '../../review-share-page/share-pins';
import { BINGO_MARK_KEY, BINGO_RETURN_KEY } from '../lib/bingo-status';
import { BingoRailButton } from './bingo-rail-button';

const here = dirname(fileURLToPath(import.meta.url));
const SHARE = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa';

const pinDraft = {
  itemId: null,
  x: 1,
  y: 0,
  z: -2,
  offset: null,
  camera: {
    position: [3.4, 2.8, 0.4] as const,
    target: [1, 0, -2] as const,
  },
};

function mark(projectKey = 'local-draft', shareId = SHARE) {
  return {
    saved: true,
    status: 'needs-review',
    projectKey,
    title: '发布会',
    shareId,
    reviewPlanKey: shareId,
    markedAt: '2026-10-31T00:00:00.000Z',
  };
}

function seedAwaiting(count: number) {
  const plans = Array.from({ length: count }, (_, i) =>
    mark(`plan-${i}`, `bbbbbbbb-${i}000-1aaa-8aaa-aaaaaaaaaaaa`.replace(/bbbbbbbb/, 'bbbbbbbb')),
  );
  localStorage.setItem(BINGO_MARK_KEY, JSON.stringify(plans));
}

function seedPin(planKey: string, status: 'open' | 'resolved' = 'open') {
  const result = appendReviewSharePin(localStorage, { planKey, text: '通道再宽', draft: pinDraft });
  expect(result.ok).toBe(true);
  if (status === 'resolved') {
    const raw = localStorage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY);
    const file = JSON.parse(raw ?? '{}') as { byPlan: Record<string, { status: string }[]> };
    file.byPlan[planKey]?.forEach(pin => { pin.status = 'resolved'; });
    localStorage.setItem(REVIEW_SHARE_PIN_STORAGE_KEY, JSON.stringify(file));
  }
}

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe('Bingo 左轨入口 · 三态圆徽标 + 双计数角标', () => {
  it('待发：空圆，无数字无勾无角标，状态写进 aria-label', () => {
    const onOpen = vi.fn();
    render(<BingoRailButton open onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: '收反馈，待发' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.className).toContain('sc-rail-disc');
    expect(button.className).toContain('is-active');

    const badge = button.querySelector('.sc-bingo-badge');
    expect(badge).toBeTruthy();
    expect(badge?.getAttribute('data-status')).toBe('to-send');
    expect(badge?.getAttribute('data-count')).toBeNull();
    expect(badge?.querySelector('svg')).toBeNull();
    expect(badge?.querySelector('.sc-bingo-corner')).toBeNull();
    expect(button.querySelector('img')).toBeNull();
    expect(badge?.textContent ?? '').toBe('');
    expect(button.getAttribute('data-tip')).toMatch(/待发/);
    expect(button.querySelector('.sc-rail-label')?.textContent).toBe('Bingo');

    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('待评：主圆出未读钉 P，角标出未回执链接 L', () => {
    localStorage.setItem(BINGO_MARK_KEY, JSON.stringify([mark()]));
    seedPin(SHARE, 'open');
    render(<BingoRailButton open={false} onOpen={vi.fn()} />);
    const button = screen.getByRole('button', { name: /待评，1 份链接，1 条未读钉/ });
    const badge = button.querySelector('.sc-bingo-badge');
    expect(badge?.getAttribute('data-status')).toBe('awaiting');
    expect(badge?.getAttribute('data-count')).toBe('1');
    const corner = badge?.querySelector('.sc-bingo-corner');
    expect(corner?.textContent).toBe('1');
    expect(badge?.querySelector('svg')).toBeNull();
  });

  it('待评无钉：主圆留空，角标仍出链接数', () => {
    seedAwaiting(1);
    render(<BingoRailButton open={false} onOpen={vi.fn()} />);
    const button = screen.getByRole('button', { name: /待评，1 份链接/ });
    const badge = button.querySelector('.sc-bingo-badge');
    expect(badge?.getAttribute('data-count')).toBeNull();
    expect(badge?.querySelector('.sc-bingo-corner')?.textContent).toBe('1');
  });

  it('待评链接 10 时角标收束为 9+，已解决钉不计入 P', () => {
    seedAwaiting(10);
    seedPin('plan-0', 'resolved');
    render(<BingoRailButton open={false} onOpen={vi.fn()} />);
    const button = screen.getByRole('button', { name: /待评，10 份链接/ });
    const badge = button.querySelector('.sc-bingo-badge');
    expect(badge?.getAttribute('data-count')).toBeNull();
    expect(badge?.querySelector('.sc-bingo-corner')?.textContent).toBe('9+');
  });

  it('已回执：圆内画勾，角标出未读钉 P；L 不再出', () => {
    localStorage.setItem(BINGO_MARK_KEY, JSON.stringify([mark()]));
    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1,
      planKey: 'local-draft',
      at: '2026-10-31T08:00:00.000Z',
      href: '/review/',
    }));
    seedPin(SHARE, 'open');
    render(<BingoRailButton open={false} onOpen={vi.fn()} />);
    const button = screen.getByRole('button', { name: /已回执，1 条未读钉/ });
    const badge = button.querySelector('.sc-bingo-badge');
    expect(badge?.getAttribute('data-status')).toBe('returned');
    expect(badge?.querySelector('svg')).toBeTruthy();
    expect(badge?.querySelector('.sc-bingo-corner')?.textContent).toBe('1');
  });

  it('已回执且无未读钉：勾形闭环，不带角标', () => {
    localStorage.setItem(BINGO_MARK_KEY, JSON.stringify([mark()]));
    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1,
      planKey: 'local-draft',
      at: '2026-10-31T08:00:00.000Z',
      href: '/review/',
    }));
    render(<BingoRailButton open={false} onOpen={vi.fn()} />);
    const button = screen.getByRole('button', { name: '收反馈，已回执' });
    const badge = button.querySelector('.sc-bingo-badge');
    expect(badge?.getAttribute('data-status')).toBe('returned');
    expect(badge?.getAttribute('data-count')).toBeNull();
    expect(badge?.querySelector('svg')).toBeTruthy();
    expect(badge?.querySelector('.sc-bingo-corner')).toBeNull();
    expect(badge?.textContent ?? '').toBe('');
  });

  it('收起态不挂 is-active', () => {
    render(<BingoRailButton open={false} onOpen={vi.fn()} />);
    const button = screen.getByRole('button', { name: '收反馈，待发' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.className).not.toContain('is-active');
  });

  it('does not mount the three mode icons on the workbench rail', () => {
    const source = readFileSync(join(here, '../room-organizer.tsx'), 'utf8');
    expect(source).toContain('<WorkbenchBrandToggle');
    expect(source).toContain('<BingoRailButton');
    expect(source).toContain('aria-label="空间"');
    expect(source).toContain('aria-label="物料"');
    expect(source).not.toContain('<VenueRailButton');
    expect(source).not.toContain('aria-label="场地"');
    expect(source).not.toContain('AgentReopenCard');
    expect(source).not.toContain('AssistantSessionDock');
    expect(source).not.toContain('aria-label="工作流程"');
    expect(source).not.toMatch(/\b(SquareStack|ListChecks|Send)\b/);
  });
});
