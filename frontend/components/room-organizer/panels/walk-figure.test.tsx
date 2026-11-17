// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WalkFigureIcon } from './walk-figure';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function readFrontendFile(relative: string): string {
  const candidates = [resolve(process.cwd(), relative), resolve(process.cwd(), 'frontend', relative)];
  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) throw new Error(`missing ${relative}`);
  return readFileSync(found, 'utf8');
}

function svgOf(ui: ReactElement): SVGSVGElement {
  const { container } = render(ui);
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('missing walk figure');
  return svg;
}

function num(el: Element | null, name: string): number {
  return Number(el?.getAttribute(name));
}

describe('walk-v7 漫游小人', () => {
  it('站立几何是锁定的瘦高剪影，头、躯干、手臂、腿连成一块', () => {
    const svg = svgOf(<WalkFigureIcon />);
    const fill = svg.querySelector('.walk-figure-fill');
    expect(svg.getAttribute('data-stand')).toBe('v7');
    expect(svg.getAttribute('viewBox')).toBe('-1.2 -1.4 26.4 27');

    const head = fill?.querySelector('[data-part="head"]');
    expect(head?.tagName.toLowerCase()).toBe('circle');
    expect(num(head ?? null, 'cx')).toBe(12);
    expect(num(head ?? null, 'cy')).toBe(4.05);
    expect(num(head ?? null, 'r')).toBe(4.05);

    const torso = fill?.querySelector('[data-part="torso"]');
    expect(num(torso ?? null, 'x')).toBe(8.725);
    expect(num(torso ?? null, 'y')).toBe(7.45);
    expect(num(torso ?? null, 'width')).toBe(6.55);
    expect(num(torso ?? null, 'height')).toBe(8.35);
    expect(num(torso ?? null, 'rx')).toBe(1.15);
    expect(num(head ?? null, 'cy') + num(head ?? null, 'r')).toBeGreaterThan(num(torso ?? null, 'y'));

    const leftArm = fill?.querySelector('[data-part="arm"][data-side="left"]');
    const rightArm = fill?.querySelector('[data-part="arm"][data-side="right"]');
    expect(leftArm?.getAttribute('transform')).toBe('rotate(-8.5 8.095 8.85)');
    expect(rightArm?.getAttribute('transform')).toBe('rotate(8.5 15.905 8.85)');
    expect(num(leftArm ?? null, 'width')).toBe(1.82);
    expect(num(leftArm ?? null, 'height')).toBe(7.15);
    expect(num(leftArm ?? null, 'y')).toBe(8.85);
    const torsoLeft = num(torso ?? null, 'x');
    const torsoRight = torsoLeft + num(torso ?? null, 'width');
    expect(num(leftArm ?? null, 'x') + num(leftArm ?? null, 'width') - torsoLeft).toBeCloseTo(0.28, 2);
    expect(torsoRight - num(rightArm ?? null, 'x')).toBeCloseTo(0.28, 2);

    const leftLeg = fill?.querySelector('[data-part="leg"][data-side="left"] rect');
    const rightLeg = fill?.querySelector('[data-part="leg"][data-side="right"] rect');
    expect(num(leftLeg ?? null, 'x')).toBe(8.79);
    expect(num(rightLeg ?? null, 'x')).toBe(12.36);
    expect(num(leftLeg ?? null, 'width')).toBe(2.85);
    expect(num(rightLeg ?? null, 'width')).toBe(2.85);
    expect(num(rightLeg ?? null, 'x') - (num(leftLeg ?? null, 'x') + num(leftLeg ?? null, 'width'))).toBeCloseTo(0.72, 2);
    expect(num(leftLeg ?? null, 'y')).toBe(15.35);
    expect(num(leftLeg ?? null, 'height')).toBe(8.55);
    expect(num(leftLeg ?? null, 'rx')).toBe(0.55);
    expect(num(leftLeg ?? null, 'y')).toBeLessThan(num(torso ?? null, 'y') + num(torso ?? null, 'height'));
    expect(leftLeg?.getAttribute('transform')).toBeNull();
    expect(rightLeg?.getAttribute('transform')).toBeNull();

    const collar = svg.querySelector('[data-part="collar"]');
    expect(collar?.getAttribute('d')).toBe('M 9.45 7.65 L 14.55 7.65 L 12 10.7 Z');
    expect(collar?.getAttribute('fill')).toBe('rgb(52, 86, 66)');
    expect(collar?.getAttribute('d')?.toLowerCase() ?? '').not.toMatch(/[cqas]/);

    const stops = [...svg.querySelectorAll('stop')].map(stop => stop.getAttribute('stop-color'));
    expect(stops).toEqual(['#5C8E70', '#4A7C59', '#426F54']);
    expect(fill?.querySelector('[data-part="head"]')?.getAttribute('fill')).toMatch(/^url\(#walk-figure-shade-/);

    const inkHead = svg.querySelector('.walk-figure-ink circle');
    expect(inkHead?.getAttribute('stroke')).toBe('#333333');
    expect(inkHead?.getAttribute('stroke-width')).toBe('1');
    expect(inkHead?.getAttribute('vector-effect')).toBe('non-scaling-stroke');

    const notch = svg.querySelector('mask rect[fill="#000000"]');
    expect(num(notch ?? null, 'x')).toBe(11.58);
    expect(num(notch ?? null, 'width')).toBe(0.84);
  });

  it('没有五官，光是剪影外侧的两层薄荷，不是另一张脸', () => {
    const svg = svgOf(<WalkFigureIcon hovered />);
    expect(svg.querySelector('[data-part="eye"], [data-part="pupil"], [data-part="smile"], [data-part="mouth"]')).toBeNull();
    expect(svg.querySelectorAll('ellipse')).toHaveLength(0);
    const circles = [...svg.querySelectorAll('circle')];
    expect(circles.length).toBeGreaterThan(0);
    for (const circle of circles) {
      expect(circle.getAttribute('r')).toBe('4.05');
      expect(circle.getAttribute('cx')).toBe('12');
      expect(circle.getAttribute('cy')).toBe('4.05');
    }
    expect(svg.innerHTML.toLowerCase()).not.toMatch(/fbbf0a|fbbc04|#fb/);

    const glow = svg.querySelector('.walk-figure-glow');
    const layers = [...(glow?.children ?? [])];
    expect(layers).toHaveLength(2);
    expect(layers.map(layer => layer.getAttribute('opacity'))).toEqual(['0.5', '0.92']);
    expect(layers.every(layer => layer.innerHTML.includes('#A8C9B2'))).toBe(true);
    const blurs = [...svg.querySelectorAll('feGaussianBlur')].map(node => node.getAttribute('stdDeviation'));
    expect(blurs).toEqual(['1.85', '0.7']);
    expect(svg.classList.contains('is-hover')).toBe(true);
    expect(svg.getAttribute('data-state')).toBe('hover');
  });

  it('漫游只加原地迈步类，站距不变；减少动态时保持直立选中态', () => {
    const standing = svgOf(<WalkFigureIcon />);
    expect(standing.classList.contains('is-idle')).toBe(true);
    expect(standing.classList.contains('is-stepping')).toBe(false);
    expect(standing.getAttribute('data-state')).toBe('idle');

    const active = svgOf(<WalkFigureIcon active />);
    expect(active.classList.contains('is-active')).toBe(true);
    expect(active.classList.contains('is-stepping')).toBe(true);
    expect(active.classList.contains('is-reduced')).toBe(false);
    expect(active.getAttribute('data-state')).toBe('active');
    const left = active.querySelector('.walk-figure-fill [data-part="leg"][data-side="left"] rect');
    const right = active.querySelector('.walk-figure-fill [data-part="leg"][data-side="right"] rect');
    expect(left?.getAttribute('x')).toBe('8.79');
    expect(right?.getAttribute('x')).toBe('12.36');
    expect(left?.getAttribute('width')).toBe('2.85');
    expect(right?.getAttribute('width')).toBe('2.85');

    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const reduced = svgOf(<WalkFigureIcon active />);
    expect(reduced.classList.contains('is-active')).toBe(true);
    expect(reduced.classList.contains('is-reduced')).toBe(true);
    expect(reduced.classList.contains('is-stepping')).toBe(false);
    expect(reduced.querySelector('.walk-figure-fill [data-part="head"]')?.getAttribute('r')).toBe('4.05');
  });

  it('样式只做小步和静止的悬停光，按钮不再用橙色，也不再把小人拎斜', () => {
    const figureCss = readFrontendFile('components/room-organizer/panels/walk-figure.css');
    const globals = readFrontendFile('app/globals.css');
    expect(figureCss).toContain('440ms ease-in-out infinite');
    expect(figureCss).toContain('scaleY(1.08)');
    expect(figureCss).toContain('scaleY(0.92)');
    expect(figureCss).not.toMatch(/translateX|rotate\(/);
    expect(figureCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(figureCss).toContain('animation: none !important');
    expect(figureCss.match(/@keyframes\s+[\w-]+/g)).toEqual([
      '@keyframes walk-figure-step-left',
      '@keyframes walk-figure-step-right',
    ]);

    expect(globals).not.toMatch(/fbbc04|FBBF0A|rotate\(-9deg\)/);
    expect(globals).toContain('button.is-walk:hover');
    expect(globals).toContain('translateY(-2px)');
    expect(globals).toContain('0 0 0 1px #E4E4E7');
    expect(globals).toContain('button.oc-gm-walk > svg.walk-figure');
  });
});
