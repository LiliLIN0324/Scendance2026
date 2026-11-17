// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RailCrate, RailHall, RailMap, RailPlus, RailSpace, RAIL_HALL, RAIL_OUTDOOR, RAIL_STROKE } from './solid-icons';

afterEach(cleanup);

function circles(svg: SVGSVGElement): SVGCircleElement[] {
  return [...svg.querySelectorAll('circle')];
}

describe('左轨自绘标记', () => {
  it('门厅脸始终实心镂空，右眼更高更长，门洞留在底边', () => {
    const { container } = render(<RailHall size={28} />);
    const path = container.querySelector('path');
    expect(path?.getAttribute('fill-rule')).toBe('evenodd');
    expect(path?.getAttribute('fill')).toContain('35624A');
    expect(path?.getAttribute('stroke')).toBeNull();
    expect(container.querySelector('circle')).toBeNull();
    const d = path?.getAttribute('d') ?? '';
    expect(d.match(/Z/g)).toHaveLength(3);
    expect(d).toContain('V 19.58');
    expect(d).toContain('V 26.03');
    expect(RAIL_HALL.eyes.right.cy).toBeLessThan(RAIL_HALL.eyes.left.cy);
    expect(RAIL_HALL.eyes.right.ry).toBeGreaterThan(RAIL_HALL.eyes.left.ry);
    expect(d).toContain('M 18.50 9.75');
    expect(d).toContain('M 13.16 10.30');
  });

  it('空间是四间完整圆角房，选中也不改成实心', () => {
    const view = render(<RailSpace size={28} />);
    const rects = () => [...view.container.querySelectorAll('rect')];
    expect(rects()).toHaveLength(4);
    for (const rect of rects()) {
      expect(rect.getAttribute('fill')).toBe('none');
      expect(rect.getAttribute('stroke-width')).toBe(String(RAIL_STROKE));
      expect(Number(rect.getAttribute('rx'))).toBeGreaterThan(0);
    }
    expect(view.container.querySelector('path')).toBeNull();
    view.rerender(<RailSpace size={28} active />);
    for (const rect of rects()) expect(rect.getAttribute('fill')).toBe('none');
    expect(view.container.querySelector('span')?.getAttribute('data-rail-active')).toBe('true');
  });

  it('物料是完整的盖和盒身', () => {
    const { container } = render(<RailCrate size={28} active />);
    const rects = [...container.querySelectorAll('rect')];
    expect(rects).toHaveLength(2);
    expect(container.querySelector('path')).toBeNull();
    const [lid, body] = rects;
    expect(lid && body).toBeTruthy();
    const lidBottom = Number(lid?.getAttribute('y')) + Number(lid?.getAttribute('height'));
    const bodyTop = Number(body?.getAttribute('y'));
    expect(bodyTop - lidBottom).toBeGreaterThan(RAIL_STROKE);
    expect(Number(lid?.getAttribute('width'))).toBeGreaterThan(Number(body?.getAttribute('width')));
    for (const rect of rects) {
      expect(rect.getAttribute('fill')).toBe('none');
      expect(rect.getAttribute('stroke-linejoin')).toBe('round');
    }
  });

  it('场地是完整圆角方块加完整加号', () => {
    const { container } = render(<RailPlus size={28} />);
    const rect = container.querySelector('rect');
    const plus = container.querySelector('path');
    expect(rect?.getAttribute('fill')).toBe('none');
    expect(Number(rect?.getAttribute('rx'))).toBeGreaterThan(2);
    expect(container.querySelector('circle')).toBeNull();
    expect(plus?.getAttribute('d')).toMatch(/v/i);
    expect(plus?.getAttribute('d')).toMatch(/h/i);
    expect(plus?.getAttribute('stroke-linecap')).toBe('round');
    expect(plus?.getAttribute('stroke-width')).toBe('1.65');
  });

  it('户外外环完整，左上小、右下大，适中缝 2.0，大圆更靠近环心', () => {
    const { container } = render(<RailMap size={28} active />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.querySelector('path')).toBeNull();
    const [ring, small, large] = circles(svg as SVGSVGElement);
    expect(ring && small && large).toBeTruthy();
    expect(ring?.getAttribute('fill')).toBe('none');
    expect(small?.getAttribute('fill')).toBe('none');
    expect(large?.getAttribute('fill')).toBe('none');
    expect(ring?.getAttribute('stroke-dasharray')).toBeNull();
    expect(Number(ring?.getAttribute('r'))).toBeCloseTo(9.2, 5);
    const rs = Number(small?.getAttribute('r'));
    const rl = Number(large?.getAttribute('r'));
    const cs = Number(small?.getAttribute('cx'));
    const sy = Number(small?.getAttribute('cy'));
    const cl = Number(large?.getAttribute('cx'));
    const ly = Number(large?.getAttribute('cy'));
    expect(rs).toBeCloseTo(2.05, 5);
    expect(rl).toBeCloseTo(3.45, 5);
    expect(cs).toBeLessThan(RAIL_OUTDOOR.ring.cx);
    expect(sy).toBeLessThan(RAIL_OUTDOOR.ring.cy);
    expect(cl).toBeGreaterThan(RAIL_OUTDOOR.ring.cx);
    expect(ly).toBeGreaterThan(RAIL_OUTDOOR.ring.cy);
    expect(Math.abs(Math.abs(cs - 12) - Math.abs(sy - 12))).toBeLessThan(1e-9);
    expect(Math.abs(Math.abs(cl - 12) - Math.abs(ly - 12))).toBeLessThan(1e-9);
    const smallReach = Math.hypot(cs - 12, sy - 12);
    const largeReach = Math.hypot(cl - 12, ly - 12);
    expect(smallReach).toBeCloseTo(largeReach, 5);
    expect(largeReach - rl).toBeLessThan(smallReach - rs);
    const centerDistance = Math.hypot(cl - cs, ly - sy);
    expect(centerDistance).toBeCloseTo(rs + rl + RAIL_OUTDOOR.gap, 5);
    expect(smallReach + rs).toBeLessThan(RAIL_OUTDOOR.ring.r);
    expect(largeReach + rl).toBeLessThan(RAIL_OUTDOOR.ring.r);
  });
});
