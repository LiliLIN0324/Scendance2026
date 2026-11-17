// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { GmCompass, gmRoseArtRenders } from './gm-compass';

let root: Root | undefined;
let host: HTMLDivElement;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

function renderCompass(bearing: number, onOrbit = vi.fn(), onReset = vi.fn()): { onOrbit: ReturnType<typeof vi.fn>; onReset: ReturnType<typeof vi.fn> } {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(<GmCompass bearing={bearing} onOrbit={onOrbit} onReset={onReset} />);
  });
  return { onOrbit, onReset };
}

function node(selector: string): HTMLElement {
  const found = host.querySelector(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found as HTMLElement;
}

it('rotates the needle and both arrows together', () => {
  renderCompass(Math.PI / 2);
  const spin = node('[data-testid="gm-rose-spin"]');
  expect(spin.style.transform).toBe('rotate(-90deg)');
  expect(spin.querySelectorAll('[data-testid="gm-rose-arrow"]')).toHaveLength(2);
  expect(spin.querySelectorAll('[data-testid="gm-rose-arrow-head"]')).toHaveLength(2);
});


it('draws Google-style filled side arrows with heads aimed down', () => {
  renderCompass(0);
  const arrows = [...host.querySelectorAll('[data-testid="gm-rose-arrow"]')];
  expect(arrows).toHaveLength(2);
  for (const arrow of arrows) {
    const d = arrow.getAttribute('d') ?? '';
    expect(d).toMatch(/\bA\b/);
    const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const [x0, y0] = nums;
    expect(x0).toBeGreaterThan(5);
    expect(x0).toBeLessThan(12);
    expect(y0).toBeGreaterThan(8);
    expect(y0).toBeLessThan(16);
  }
  const heads = [...host.querySelectorAll('[data-testid="gm-rose-arrow-head"]')];
  expect(heads).toHaveLength(2);
  for (const head of heads) {
    const pts = head.getAttribute('points')!.trim().split(/\s+/).map(pair => pair.split(',').map(Number));
    const tip = pts.reduce((best, point) => (point[1] > best[1] ? point : best));
    const baseY = Math.min(...pts.map(point => point[1]));
    expect(tip[1]).toBeGreaterThan(baseY + 2);
    expect(tip[0]).toBeGreaterThan(6);
    expect(tip[0]).toBeLessThan(14);
    expect(Math.hypot(tip[0] - 22, tip[1] - 22)).toBeGreaterThan(14);
    expect(Math.hypot(tip[0] - 22, tip[1] - 22)).toBeLessThan(19);
  }
  expect(host.querySelector('g[transform*="scale(-1"] [data-testid="gm-rose-arrow"]')).toBeTruthy();
});

it('orbits clockwise when the needle is dragged clockwise', () => {
  const { onOrbit } = renderCompass(0);
  const face = node('[aria-label="回正北"]');
  face.setPointerCapture = () => {};
  face.releasePointerCapture = () => {};
  face.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: 44, bottom: 44, width: 44, height: 44, toJSON() { return {}; },
  });
  const at = (type: string, x: number, y: number) => new PointerEvent(type, {
    bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0,
  });
  act(() => { face.dispatchEvent(at('pointerdown', 22, 4)); });
  act(() => { face.dispatchEvent(at('pointermove', 40, 22)); });
  expect(onOrbit).toHaveBeenCalledTimes(1);
  expect(onOrbit.mock.calls[0]?.[0]).toBeCloseTo(Math.PI / 2);
});

it('updates the spin transform without repainting the rose art', () => {
  const onOrbit = vi.fn();
  const onReset = vi.fn();
  renderCompass(0, onOrbit, onReset);
  const paints = gmRoseArtRenders.count;
  act(() => {
    root!.render(<GmCompass bearing={Math.PI / 2} onOrbit={onOrbit} onReset={onReset} />);
  });
  expect(gmRoseArtRenders.count).toBe(paints);
  expect(node('[data-testid="gm-rose-spin"]').style.transform).toBe('rotate(-90deg)');
  expect(node('[data-testid="gm-rose-spin"]').querySelectorAll('[data-testid="gm-rose-arrow"]')).toHaveLength(2);
});

function enter(selector: string): void {
  act(() => {
    node(selector).dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  });
}

it('shows Chinese tips on the compass without a native title', () => {
  renderCompass(0);
  const rose = node('[data-testid="gm-rose"]');
  expect(rose.getAttribute('data-tip')).toBeNull();
  expect(host.querySelector('[title]')).toBeNull();
  const paints = gmRoseArtRenders.count;
  enter('[aria-label="向左旋转 90 度"]');
  expect(rose.getAttribute('data-tip')).toBe('向左旋转 90°');
  enter('[aria-label="向右旋转 90 度"]');
  expect(rose.getAttribute('data-tip')).toBe('向右旋转 90°');
  enter('[aria-label="回正北"]');
  expect(rose.getAttribute('data-tip')).toBe('拖动旋转 · 点击回正北');
  expect(gmRoseArtRenders.count).toBe(paints);
});

it('turns ninety degrees from the side arrows and resets from the needle', () => {
  const { onOrbit, onReset } = renderCompass(0);
  act(() => { node('[aria-label="向左旋转 90 度"]').click(); });
  expect(onOrbit).toHaveBeenCalledWith(Math.PI / 2);
  act(() => { node('[aria-label="向右旋转 90 度"]').click(); });
  expect(onOrbit).toHaveBeenLastCalledWith(-Math.PI / 2);
  act(() => { node('[aria-label="回正北"]').click(); });
  expect(onReset).toHaveBeenCalledTimes(1);
});
