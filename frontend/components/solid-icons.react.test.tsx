// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RailCrate,
  RailHall,
  RailMap,
  RailPlus,
  RailSpace,
  RAIL_CRATE_LID,
  RAIL_CRATE_SEAM,
  RAIL_HALL,
  RAIL_HALL_FACE,
  RAIL_OUTDOOR,
  RAIL_PAPER,
  RAIL_PLUS_MARK,
  RAIL_SELECTED,
  RAIL_STROKE,
} from './solid-icons';

afterEach(cleanup);

function circles(svg: SVGSVGElement): SVGCircleElement[] {
  return [...svg.querySelectorAll('circle')];
}

describe('左轨自绘标记', () => {
  it('门厅脸始终实心镂空，眼洞可平移，不画瞳孔，门洞留在底边', () => {
    const { container } = render(<RailHall size={28} />);
    const face = container.querySelector('svg.sc-rail-hall > path');
    expect(face?.getAttribute('fill')).toContain('35624A');
    expect(face?.getAttribute('stroke')).toBeNull();
    expect(face?.getAttribute('fill-rule')).toBeNull();
    const door = face?.getAttribute('d') ?? '';
    expect(door).toContain('V 19.58');
    expect(door).toContain('V 26.03');
    expect(door.match(/Z/g)).toHaveLength(1);
    const eyes = container.querySelector('.sc-rail-hall-eyes');
    expect(eyes?.parentElement?.tagName.toLowerCase()).toBe('mask');
    const holes = [...(eyes?.querySelectorAll('path') ?? [])].map(path => path.getAttribute('d') ?? '');
    expect(holes.some(d => d.includes('M 13.16 10.30'))).toBe(true);
    expect(holes.some(d => d.includes('M 18.50 9.75'))).toBe(true);
    expect(RAIL_HALL_FACE).toContain('M 13.16 10.30');
    expect(RAIL_HALL_FACE).toContain('M 18.50 9.75');
    expect(RAIL_HALL.eyes.right.cy).toBeLessThan(RAIL_HALL.eyes.left.cy);
    expect(RAIL_HALL.eyes.right.ry).toBeGreaterThan(RAIL_HALL.eyes.left.ry);
    expect(container.querySelector('.sc-rail-avatar-tilt')).toBeTruthy();
    expect(container.querySelector('.sc-rail-eye')).toBeNull();
    expect(container.querySelector('circle')).toBeNull();
  });

  it('空间是四间完整圆角房，选中填墨且不描边', () => {
    const view = render(<RailSpace size={28} />);
    const rects = () => [...view.container.querySelectorAll('rect')];
    expect(rects()).toHaveLength(4);
    const spots = rects().map(rect => `${rect.getAttribute('x')},${rect.getAttribute('y')}`);
    expect(spots).toEqual(['4,4', '13,4', '4,13', '13,13']);
    for (const rect of rects()) {
      expect(rect.getAttribute('fill')).toBe('none');
      expect(rect.getAttribute('stroke')).toBe('currentColor');
      expect(rect.getAttribute('stroke-width')).toBe(String(RAIL_STROKE));
      expect(rect.getAttribute('width')).toBe('7');
      expect(rect.getAttribute('height')).toBe('7');
      expect(rect.getAttribute('rx')).toBe('2');
    }
    view.rerender(<RailSpace size={28} active />);
    for (const rect of rects()) {
      expect(rect.getAttribute('fill')).toBe(RAIL_SELECTED);
      expect(rect.getAttribute('stroke')).toBe('none');
    }
    expect(view.container.querySelector('span')?.getAttribute('data-rail-active')).toBe('true');
    expect(view.container.querySelector('span')?.style.color).toBe('rgb(20, 20, 22)');
  });

  it('物料是盖贴盒身的收纳箱，选中填墨并留纸色接缝', () => {
    const view = render(<RailCrate size={28} />);
    const lid = () => view.container.querySelector('path');
    const body = () => view.container.querySelector('rect');
    expect(lid()?.getAttribute('d')).toBe(RAIL_CRATE_LID);
    expect(body()?.getAttribute('x')).toBe('5.1');
    expect(body()?.getAttribute('y')).toBe('9.35');
    expect(body()?.getAttribute('width')).toBe('13.8');
    expect(body()?.getAttribute('height')).toBe('10.15');
    expect(body()?.getAttribute('rx')).toBe('2');
    expect(lid()?.getAttribute('fill')).toBe('none');
    expect(body()?.getAttribute('fill')).toBe('none');
    expect(lid()?.getAttribute('stroke-width')).toBe(String(RAIL_STROKE));
    expect(view.container.querySelectorAll('rect')).toHaveLength(1);
    view.rerender(<RailCrate size={28} active />);
    expect(lid()?.getAttribute('fill')).toBe(RAIL_SELECTED);
    expect(body()?.getAttribute('fill')).toBe(RAIL_SELECTED);
    expect(body()?.getAttribute('stroke')).toBe('none');
    const seam = [...view.container.querySelectorAll('path')].find(path => path.getAttribute('d') === RAIL_CRATE_SEAM);
    expect(seam?.getAttribute('stroke')).toBe(RAIL_PAPER);
    expect(seam?.getAttribute('stroke-width')).toBe('1.55');
  });

  it('场地是圆角方块加完整加号，选中方块填墨、加号留白', () => {
    const view = render(<RailPlus size={28} />);
    const rect = () => view.container.querySelector('rect');
    const plus = () => view.container.querySelector('path');
    expect(rect()?.getAttribute('x')).toBe('3.9');
    expect(rect()?.getAttribute('y')).toBe('3.9');
    expect(rect()?.getAttribute('width')).toBe('16.2');
    expect(rect()?.getAttribute('height')).toBe('16.2');
    expect(rect()?.getAttribute('rx')).toBe('3.6');
    expect(rect()?.getAttribute('fill')).toBe('none');
    expect(plus()?.getAttribute('d')).toBe(RAIL_PLUS_MARK);
    expect(plus()?.getAttribute('stroke-linecap')).toBe('round');
    expect(plus()?.getAttribute('stroke-width')).toBe(String(RAIL_STROKE));
    expect(view.container.querySelector('circle')).toBeNull();
    view.rerender(<RailPlus size={28} active />);
    expect(rect()?.getAttribute('fill')).toBe(RAIL_SELECTED);
    expect(rect()?.getAttribute('stroke')).toBe('none');
    expect(plus()?.getAttribute('stroke')).toBe(RAIL_PAPER);
    expect(plus()?.getAttribute('stroke-width')).toBe('1.7');
  });

  it('户外外环完整，左上小、右下大，适中缝 2.0，大圆更靠近环心', () => {
    const view = render(<RailMap size={28} />);
    const svg = () => view.container.querySelector('svg') as SVGSVGElement;
    expect(svg()?.querySelector('path')).toBeNull();
    const read = () => {
      const [ring, small, large] = circles(svg());
      return { ring, small, large };
    };
    const idle = read();
    expect(idle.ring?.getAttribute('fill')).toBe('none');
    expect(idle.small?.getAttribute('fill')).toBe('none');
    expect(idle.large?.getAttribute('fill')).toBe('none');
    expect(idle.ring?.getAttribute('stroke-width')).toBe(String(RAIL_STROKE));
    expect(idle.ring?.getAttribute('stroke-dasharray')).toBeNull();
    expect(Number(idle.ring?.getAttribute('r'))).toBeCloseTo(9.2, 5);
    const rs = 2.05;
    const rl = 3.45;
    const gap = RAIL_OUTDOOR.gap;
    const distance = rs + rl + gap;
    const smallTravel = distance * (rl * rl) / (rs * rs + rl * rl);
    const largeTravel = distance - smallTravel;
    const unit = Math.SQRT1_2;
    expect(Number(idle.small?.getAttribute('r'))).toBeCloseTo(rs, 5);
    expect(Number(idle.large?.getAttribute('r'))).toBeCloseTo(rl, 5);
    expect(Number(idle.small?.getAttribute('cx'))).toBeCloseTo(12 - smallTravel * unit, 6);
    expect(Number(idle.small?.getAttribute('cy'))).toBeCloseTo(12 - smallTravel * unit, 6);
    expect(Number(idle.large?.getAttribute('cx'))).toBeCloseTo(12 + largeTravel * unit, 6);
    expect(Number(idle.large?.getAttribute('cy'))).toBeCloseTo(12 + largeTravel * unit, 6);
    const smallReach = Math.hypot(Number(idle.small?.getAttribute('cx')) - 12, Number(idle.small?.getAttribute('cy')) - 12);
    const largeReach = Math.hypot(Number(idle.large?.getAttribute('cx')) - 12, Number(idle.large?.getAttribute('cy')) - 12);
    expect(largeReach).toBeLessThan(smallReach);
    expect(Math.hypot(
      Number(idle.large?.getAttribute('cx')) - Number(idle.small?.getAttribute('cx')),
      Number(idle.large?.getAttribute('cy')) - Number(idle.small?.getAttribute('cy')),
    )).toBeCloseTo(distance, 5);
    expect(smallReach + rs).toBeLessThan(RAIL_OUTDOOR.ring.r);
    expect(largeReach + rl).toBeLessThan(RAIL_OUTDOOR.ring.r);
    view.rerender(<RailMap size={28} active />);
    const selected = read();
    expect(selected.ring?.getAttribute('fill')).toBe(RAIL_SELECTED);
    expect(selected.ring?.getAttribute('stroke')).toBe('none');
    expect(selected.small?.getAttribute('fill')).toBe(RAIL_PAPER);
    expect(selected.large?.getAttribute('fill')).toBe(RAIL_PAPER);
    expect(selected.small?.getAttribute('stroke')).toBe('none');
    expect(selected.large?.getAttribute('stroke')).toBe('none');
  });
});
