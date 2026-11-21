// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/lib/test-support-memory-storage';
import { REVIEW_SHARE_PIN_STORAGE_KEY, appendReviewSharePin } from '../../review-share-page/share-pins';
import { BINGO_MARK_KEY, BINGO_RETURN_KEY } from '../lib/bingo-status';
import { BINGO_D4, BingoRailButton, bingoBeadCenter, bingoRingPath } from './bingo-rail-button';
import { BINGO_SENDING_EVENT, BINGO_SPIN_PERIOD_MS } from './bingo-status-mark';

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

let mem: MemoryStorage;
beforeEach(() => {
  mem = new MemoryStorage();
  vi.stubGlobal('Storage', MemoryStorage);
  vi.stubGlobal('localStorage', mem);
  window.localStorage = mem;
  localStorage.clear();
});
afterEach(() => { cleanup(); mem?.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Bingo 左轨入口 · D4 开口环', () => {
  it('待发且选中：仍是东北开口环，实心圆盘不盖住缺口', () => {
    const onOpen = vi.fn();
    render(<BingoRailButton open onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: 'Bingo，待发' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.className).toContain('sc-rail-disc');
    expect(button.className).toContain('is-active');

    const badge = button.querySelector('.sc-bingo-badge');
    expect(badge).toBeTruthy();
    expect(badge?.getAttribute('data-status')).toBe('to-send');
    expect(badge?.getAttribute('data-visual')).toBe('to-send');
    expect(badge?.getAttribute('data-count')).toBeNull();
    expect(badge?.getAttribute('data-bead')).toBeNull();
    expect(badge?.querySelector('[data-part="ring"]')?.getAttribute('d')).toBe(bingoRingPath());
    expect(badge?.querySelector('[data-mark="hole"]')).toBeNull();
    expect(badge?.querySelector('circle')).toBeNull();
    expect(badge?.querySelector('text')).toBeNull();
    expect(badge?.querySelector('[data-mark="check"]')).toBeNull();
    expect(badge?.querySelector('.sc-bingo-corner')).toBeNull();
    expect(button.querySelector('.sc-rail-label')?.parentElement).toBe(button);
    expect(button.querySelector('[data-ring] .sc-rail-label')).toBeNull();
    expect(button.querySelector('img')).toBeNull();
    expect(badge?.textContent ?? '').toBe('');
    expect(button.getAttribute('data-tip')).toBe('Bingo');
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
    expect(badge?.querySelector('[data-ring] text')).toBeNull();
  });

  it('待评且选中：数字和警示珠仍在，不被实心圆盘盖住', () => {
    localStorage.setItem(BINGO_MARK_KEY, JSON.stringify([mark()]));
    render(<BingoRailButton open onOpen={vi.fn()} />);
    const button = screen.getByRole('button', { name: /待评，1 份链接/ });
    const badge = button.querySelector('.sc-bingo-badge');
    expect(button.className).toContain('is-active');
    expect(badge?.querySelector('[data-part="ring"]')?.getAttribute('d')).toBe(bingoRingPath());
    expect(badge?.querySelector('[data-part="bead"]')?.getAttribute('fill')).toContain('96651F');
    expect(badge?.querySelector('text')?.textContent).toBe('1');
    expect(badge?.querySelector('[data-mark="hole"]')).toBeNull();
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

  it('已回执：满环加墨色勾，不再留珠，未读钉只留在文案里', () => {
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
    const ring = badge?.querySelector('[data-part="ring"]');
    expect(badge?.getAttribute('data-status')).toBe('returned');
    expect(badge?.getAttribute('data-step')).toBe('check');
    expect(badge?.getAttribute('data-bead')).toBeNull();
    expect(badge?.querySelector('[data-part="bead"]')).toBeNull();
    expect(ring?.tagName.toLowerCase()).toBe('circle');
    expect(ring?.getAttribute('fill')).toBe('none');
    expect(ring?.getAttribute('stroke')).toContain('55585F');
    expect(ring?.getAttribute('stroke')).not.toMatch(/96651F|B4443C|4A7C59/);
    expect(badge?.querySelector('[data-mark="check"]')?.getAttribute('stroke')).toContain('141416');
    expect(badge?.querySelector('[data-mark="check"]')?.getAttribute('stroke-width')).toBe('1.65');
    expect(badge?.querySelector('text')).toBeNull();
    expect(badge?.querySelector('.sc-bingo-corner')).toBeNull();
  });

  it('已回执且选中：勾还在，实心圆盘不盖住', () => {
    localStorage.setItem(BINGO_MARK_KEY, JSON.stringify([mark()]));
    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1,
      planKey: 'local-draft',
      at: '2026-10-31T08:00:00.000Z',
      href: '/review/',
    }));
    render(<BingoRailButton open onOpen={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Bingo，已回执' });
    const badge = button.querySelector('.sc-bingo-badge');
    expect(button.className).toContain('is-active');
    expect(badge?.getAttribute('data-count')).toBeNull();
    expect(badge?.querySelector('[data-mark="check"]')).toBeTruthy();
    expect(badge?.querySelector('[data-mark="hole"]')).toBeNull();
    expect(badge?.querySelector('[data-part="bead"]')).toBeNull();
    expect(badge?.querySelector('[data-part="ring"]')?.getAttribute('fill')).toBe('none');
    expect(badge?.querySelector('.sc-bingo-corner')).toBeNull();
    expect(badge?.textContent ?? '').toBe('');
  });

  it('收起态不挂 is-active', () => {
    render(<BingoRailButton open={false} onOpen={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Bingo，待发' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.className).not.toContain('is-active');
  });

  it('未选中的 D4 环在东北开口，珠坐在缺口里，三态共用同一条墨色环', () => {
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
    const idle = screen.getByRole('button', { name: 'Bingo，待发' }).querySelector('path');
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

  it('送出中只转环：匀速 1.2 秒，数字和 Bingo 标签不在旋转组里', () => {
    localStorage.setItem(BINGO_MARK_KEY, JSON.stringify([mark()]));
    render(<BingoRailButton open={false} onOpen={vi.fn()} />);
    const button = screen.getByRole('button', { name: /待评，1 份链接/ });
    expect(button.querySelector('text')?.textContent).toBe('1');
    act(() => {
      window.dispatchEvent(new CustomEvent(BINGO_SENDING_EVENT, { detail: true }));
    });
    const sending = screen.getByRole('button', { name: /送出中/ });
    const badge = sending.querySelector('.sc-bingo-badge');
    expect(badge?.getAttribute('data-visual')).toBe('sending');
    expect(badge?.getAttribute('data-spin-ms')).toBe(String(BINGO_SPIN_PERIOD_MS));
    expect(badge?.querySelector('[data-part="ring"]')?.getAttribute('d')).toBe(bingoRingPath());
    expect(badge?.querySelector('[data-ring] text')).toBeNull();
    expect(badge?.querySelector('text')).toBeNull();
    expect(sending.querySelector('.sc-rail-label')?.textContent).toBe('Bingo');
    expect(sending.querySelector('[data-ring] .sc-rail-label')).toBeNull();
    act(() => {
      window.dispatchEvent(new CustomEvent(BINGO_SENDING_EVENT, { detail: false }));
    });
  });

  it('从待评进入已回执：先停在当前开口，收口时珠淡出，满环之后才出勾', () => {
    const queue: FrameRequestCallback[] = [];
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      queue.push(cb);
      return queue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    localStorage.setItem(BINGO_MARK_KEY, JSON.stringify([mark()]));
    render(<BingoRailButton open={false} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: /待评/ }).querySelector('[data-part="bead"]')).toBeTruthy();

    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1,
      planKey: 'local-draft',
      at: '2026-10-31T08:00:00.000Z',
      href: '/review/',
    }));
    act(() => { window.dispatchEvent(new Event('storage')); });
    const badge = () => screen.getByRole('button', { name: /已回执/ }).querySelector('.sc-bingo-badge');
    expect(badge()?.getAttribute('data-step')).toBe('pause');
    expect(badge()?.querySelector('[data-part="ring"]')?.getAttribute('d')).toBe(bingoRingPath());
    expect(badge()?.querySelector('[data-part="bead"]')?.getAttribute('fill')).toContain('96651F');
    expect(badge()?.querySelector('[data-mark="check"]')).toBeNull();
    expect(badge()?.querySelector('text')).toBeNull();

    const flush = (at: number) => {
      now.mockReturnValue(at);
      const batch = queue.splice(0, queue.length);
      act(() => { batch.forEach(cb => cb(at)); });
    };
    flush(1_000 + 300);
    expect(badge()?.getAttribute('data-step')).toBe('closing');
    expect(badge()?.querySelector('[data-mark="check"]')).toBeNull();
    expect(Number(badge()?.querySelector('[data-part="bead"]')?.getAttribute('opacity'))).toBeLessThan(1);

    flush(1_000 + 200 + 200);
    expect(badge()?.getAttribute('data-step')).toBe('closed');
    expect(badge()?.querySelector('[data-part="bead"]')).toBeNull();
    expect(badge()?.querySelector('[data-part="ring"]')?.tagName.toLowerCase()).toBe('circle');
    expect(badge()?.querySelector('[data-mark="check"]')).toBeNull();

    flush(1_000 + 200 + 200 + 80);
    expect(badge()?.getAttribute('data-step')).toBe('check');
    expect(badge()?.querySelector('[data-part="bead"]')).toBeNull();
    expect(badge()?.querySelector('[data-mark="check"]')?.getAttribute('stroke')).toContain('141416');
    now.mockRestore();
    vi.unstubAllGlobals();
  });

  it('减少动态：不转不收口，待评留珠和数字，已回执直接是合环加勾', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { unmount } = render(<BingoRailButton open={false} onOpen={vi.fn()} />);
    const idle = screen.getByRole('button', { name: 'Bingo，待发' });
    expect(idle.querySelector('.sc-bingo-badge')?.getAttribute('data-reduced')).toBe('true');
    expect(idle.querySelector('[data-part="ring"]')?.getAttribute('d')).toBe(bingoRingPath());
    expect(idle.querySelector('[data-part="bead"]')).toBeNull();
    expect(idle.querySelector('[data-mark="check"]')).toBeNull();
    expect(idle.querySelector('.sc-bingo-badge')?.getAttribute('data-spin-ms')).toBeNull();
    unmount();

    localStorage.setItem(BINGO_MARK_KEY, JSON.stringify([mark()]));
    render(<BingoRailButton open={false} onOpen={vi.fn()} />);
    const waiting = screen.getByRole('button', { name: /待评，1 份链接/ });
    const waitingBadge = waiting.querySelector('.sc-bingo-badge');
    expect(waitingBadge?.getAttribute('data-step')).toBe('hold');
    expect(waitingBadge?.querySelector('[data-part="ring"]')?.getAttribute('d')).toBe(bingoRingPath());
    expect(waitingBadge?.querySelector('[data-part="bead"]')?.getAttribute('fill')).toContain('96651F');
    expect(waitingBadge?.querySelector('text')?.textContent).toBe('1');
    expect(waitingBadge?.querySelector('[data-mark="check"]')).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent(BINGO_SENDING_EVENT, { detail: true }));
    });
    const sending = screen.getByRole('button', { name: /送出中/ });
    const sendingBadge = sending.querySelector('.sc-bingo-badge');
    expect(sendingBadge?.getAttribute('data-visual')).toBe('sending');
    expect(sendingBadge?.getAttribute('data-step')).toBe('hold');
    expect(sendingBadge?.getAttribute('data-spin-ms')).toBeNull();
    expect(sendingBadge?.querySelector('[data-part="ring"]')?.getAttribute('d')).toBe(bingoRingPath());
    expect(sendingBadge?.querySelector('[data-mark="check"]')).toBeNull();
    act(() => {
      window.dispatchEvent(new CustomEvent(BINGO_SENDING_EVENT, { detail: false }));
    });

    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1,
      planKey: 'local-draft',
      at: '2026-10-31T08:00:00.000Z',
      href: '/review/',
    }));
    act(() => { window.dispatchEvent(new Event('storage')); });
    const done = screen.getByRole('button', { name: /已回执/ });
    const doneBadge = done.querySelector('.sc-bingo-badge');
    const ring = doneBadge?.querySelector('[data-part="ring"]');
    expect(doneBadge?.getAttribute('data-step')).toBe('check');
    expect(doneBadge?.getAttribute('data-spin-ms')).toBeNull();
    expect(ring?.tagName.toLowerCase()).toBe('circle');
    expect(ring?.getAttribute('fill')).toBe('none');
    expect(ring?.getAttribute('stroke')).toContain('55585F');
    expect(doneBadge?.querySelector('[data-part="bead"]')).toBeNull();
    expect(doneBadge?.querySelector('[data-mark="check"]')?.getAttribute('stroke')).toContain('141416');
    expect(doneBadge?.querySelector('[data-part="ring"]')?.getAttribute('d')).toBeNull();
    vi.unstubAllGlobals();
  });
});
