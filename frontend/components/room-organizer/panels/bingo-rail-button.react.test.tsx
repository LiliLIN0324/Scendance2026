// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVIEW_SHARE_PIN_STORAGE_KEY, appendReviewSharePin } from '../../review-share-page/share-pins';
import { BINGO_MARK_KEY, BINGO_RETURN_KEY } from '../lib/bingo-status';
import { BINGO_D4, BingoRailButton, bingoBeadCenter, bingoRingPath } from './bingo-rail-button';

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

describe('Bingo 左轨入口 · D4 开口环', () => {
  it('待发：开口墨环，无数字无勾无珠无角标，状态写进 aria-label', () => {
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
    expect(badge?.getAttribute('data-bead')).toBeNull();
    expect(badge?.querySelector('svg')).toBeTruthy();
    expect(badge?.querySelector('circle')).toBeNull();
    expect(badge?.querySelector('text')).toBeNull();
    expect(badge?.querySelector('[data-mark="check"]')).toBeNull();
    expect(badge?.querySelector('.sc-bingo-corner')).toBeNull();
    expect(button.querySelector('img')).toBeNull();
    expect(badge?.textContent ?? '').toBe('');
    expect(button.getAttribute('data-tip')).toMatch(/待发/);
    expect(button.querySelector('.sc-rail-label')?.textContent).toBe('Bingo');

    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('待评：环内一个链接数，缺口 warn 珠，不再叠角标', () => {
    localStorage.setItem(BINGO_MARK_KEY, JSON.stringify([mark()]));
    seedPin(SHARE, 'open');
    render(<BingoRailButton open={false} onOpen={vi.fn()} />);
    const button = screen.getByRole('button', { name: /待评，1 份链接，1 条未读钉/ });
    const badge = button.querySelector('.sc-bingo-badge');
    expect(badge?.getAttribute('data-status')).toBe('awaiting');
    expect(badge?.getAttribute('data-count')).toBe('1');
    expect(badge?.getAttribute('data-bead')).toBe('warn');
    expect(badge?.querySelector('text')?.textContent).toBe('1');
    expect(badge?.querySelector('circle')?.getAttribute('fill')).toContain('96651F');
    expect(badge?.querySelector('[data-mark="check"]')).toBeNull();
    expect(badge?.querySelector('.sc-bingo-corner')).toBeNull();
  });

  it('待评无钉：环内仍出链接数，不另画角标', () => {
    seedAwaiting(1);
    render(<BingoRailButton open={false} onOpen={vi.fn()} />);
    const button = screen.getByRole('button', { name: /待评，1 份链接/ });
    const badge = button.querySelector('.sc-bingo-badge');
    expect(badge?.getAttribute('data-count')).toBe('1');
    expect(badge?.querySelector('text')?.textContent).toBe('1');
    expect(badge?.getAttribute('data-bead')).toBe('warn');
    expect(badge?.querySelector('.sc-bingo-corner')).toBeNull();
  });

  it('待评链接 10 时环内收束为 9+，已解决钉不计入未读钉文案', () => {
    seedAwaiting(10);
    seedPin('plan-0', 'resolved');
    render(<BingoRailButton open={false} onOpen={vi.fn()} />);
    const button = screen.getByRole('button', { name: /待评，10 份链接/ });
    const badge = button.querySelector('.sc-bingo-badge');
    expect(badge?.getAttribute('data-count')).toBe('9+');
    expect(badge?.querySelector('text')?.textContent).toBe('9+');
    expect(badge?.querySelector('.sc-bingo-corner')).toBeNull();
    expect(button.getAttribute('aria-label')).not.toMatch(/未读钉/);
  });

  it('已回执：环内墨色勾加 err 珠，未读钉只留在文案里', () => {
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
    expect(badge?.getAttribute('data-bead')).toBe('err');
    expect(badge?.querySelector('[data-mark="check"]')?.getAttribute('stroke')).toContain('141416');
    expect(badge?.querySelector('circle')?.getAttribute('fill')).toContain('B4443C');
    expect(badge?.querySelector('text')).toBeNull();
    expect(badge?.querySelector('.sc-bingo-corner')).toBeNull();
  });

  it('已回执且无未读钉：勾与 err 珠，无数字无角标', () => {
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
    expect(badge?.querySelector('[data-mark="check"]')).toBeTruthy();
    expect(badge?.querySelector('circle')).toBeTruthy();
    expect(badge?.querySelector('.sc-bingo-corner')).toBeNull();
    expect(badge?.textContent ?? '').toBe('');
  });

  it('收起态不挂 is-active', () => {
    render(<BingoRailButton open={false} onOpen={vi.fn()} />);
    const button = screen.getByRole('button', { name: '收反馈，待发' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.className).not.toContain('is-active');
  });

  it('D4 环在东北开口，珠坐在缺口里，三态共用同一条墨色环', () => {
    const path = bingoRingPath();
    const nums = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map(match => Number(match[0]));
    const start = { x: nums[0] ?? 0, y: nums[1] ?? 0 };
    const end = { x: nums[nums.length - 2] ?? 0, y: nums[nums.length - 1] ?? 0 };
    const center = { x: BINGO_D4.cx, y: BINGO_D4.cy };
    const angle = (point: { x: number; y: number }) => Math.atan2(point.y - center.y, point.x - center.x);
    const gap = ((angle(start) - angle(end)) * 180) / Math.PI;
    expect(gap).toBeGreaterThan(56);
    expect(gap).toBeLessThan(60);
    const beadCenter = bingoBeadCenter();
    const bead = { x: beadCenter.cx, y: beadCenter.cy };
    const beadAngle = (angle(bead) * 180) / Math.PI;
    const northeast = ((beadAngle % 360) + 360) % 360;
    expect(northeast).toBeGreaterThan(310);
    expect(northeast).toBeLessThan(320);
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    expect(Math.abs(distance(bead, center) - BINGO_D4.r)).toBeLessThan(0.03);
    const clearance = Math.min(distance(bead, start), distance(bead, end)) - BINGO_D4.beadR - BINGO_D4.stroke / 2;
    expect(clearance).toBeGreaterThan(0.5);

    render(<BingoRailButton open={false} onOpen={vi.fn()} />);
    const idle = screen.getByRole('button', { name: '收反馈，待发' }).querySelector('path');
    expect(idle?.getAttribute('d')).toBe(path);
    expect(idle?.getAttribute('stroke')).toContain('55585F');
    expect(idle?.getAttribute('stroke')).not.toMatch(/96651F|B4443C/);
    expect(idle?.getAttribute('stroke-width')).toBe('1.65');
    expect(idle?.getAttribute('stroke-linecap')).toBe('round');

    const css = readFileSync(join(here, '../../../app/globals.css'), 'utf8');
    expect(css).not.toContain('sc-bingo-corner');
    expect(css).not.toMatch(/sc-bingo-badge\[data-status="awaiting"\]/);
    expect(css).not.toMatch(/sc-bingo-badge\[data-status="returned"\]/);
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
