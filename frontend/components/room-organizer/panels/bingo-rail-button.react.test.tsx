// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BINGO_MARK_KEY, BINGO_RETURN_KEY } from '../lib/bingo-status';
import { BingoRailButton } from './bingo-rail-button';

const here = dirname(fileURLToPath(import.meta.url));
const SHARE = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa';

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

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe('Bingo 左轨入口 · 三态圆徽标', () => {
  it('待发：空圆，无数字无勾，状态写进 aria-label', () => {
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
    expect(button.querySelector('img')).toBeNull();
    expect(badge?.textContent ?? '').toBe('');
    expect(button.getAttribute('data-tip')).toMatch(/待发/);
    expect(button.querySelector('.sc-rail-label')?.textContent).toBe('Bingo');

    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('待评：圆内显示未回执链接数，超过 9 收束为 9+', () => {
    seedAwaiting(1);
    render(<BingoRailButton open={false} onOpen={vi.fn()} />);
    const one = screen.getByRole('button', { name: /待评，1 份链接/ });
    const badge = one.querySelector('.sc-bingo-badge');
    expect(badge?.getAttribute('data-status')).toBe('awaiting');
    expect(badge?.getAttribute('data-count')).toBe('1');
    expect(badge?.textContent).toBe('1');
    expect(badge?.querySelector('svg')).toBeNull();
  });

  it('待评计数 10 时显示 9+', () => {
    seedAwaiting(10);
    render(<BingoRailButton open={false} onOpen={vi.fn()} />);
    const button = screen.getByRole('button', { name: /待评，10 份链接/ });
    const badge = button.querySelector('.sc-bingo-badge');
    expect(badge?.getAttribute('data-count')).toBe('9+');
    expect(badge?.textContent).toBe('9+');
  });

  it('已回执：圆内画勾，不再出数字', () => {
    localStorage.setItem(BINGO_MARK_KEY, JSON.stringify([mark('local-draft')]));
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
