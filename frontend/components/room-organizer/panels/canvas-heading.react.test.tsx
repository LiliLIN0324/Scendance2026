/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasHeading } from './canvas-heading';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import type { RoomLayout } from '../lib/types';

const state = vi.hoisted(() => ({
  layout: null as unknown as RoomLayout,
  headcount: null as number | null,
}));

vi.mock('../contexts', () => ({
  useRoomEditor: () => ({ layout: state.layout, activeFloorIndex: 0 }),
}));

vi.mock('./brief-headcount-store', () => ({
  getBriefHeadcount: () => state.headcount,
}));

afterEach(() => cleanup());

describe('CanvasHeading', () => {
  it('does not show a heading in 3D', () => {
    state.layout = makeLayout();
    state.headcount = null;
    const { container } = render(<CanvasHeading view2D={false} />);
    expect(container.querySelector('.sc-canvas-heading')).toBeNull();
  });

  it('shows 2D 平面 and ok badges when there is headroom and seats meet demand', () => {
    state.layout = makeLayout({ floors: [makeFloor({ items: [
      makeItem({ id: 'chair-1', type: 'chair', position: { x: -2, z: 0 } }),
    ] })] });
    state.headcount = 1;

    render(<CanvasHeading view2D />);

    expect(screen.getByText('2D 平面').textContent).toBe('2D 平面');
    expect(screen.getByText('估算上限 16 件 · 已摆 1 件')).toBeTruthy();
    expect(screen.getByText('座位已够 1 人（估算）')).toBeTruthy();
    expect(document.querySelectorAll('.sc-canvas-heading-badge.is-ok')).toHaveLength(2);
  });

  it('marks warn when near capacity and seats are short', () => {
    const cabinets = Array.from({ length: 15 }, (_, i) => makeItem({
      id: `cab-${i}`,
      type: 'cabinet',
      position: { x: -3 + (i % 5) * 1.5, z: -2 + Math.floor(i / 5) * 1.5 },
    }));
    state.layout = makeLayout({ floors: [makeFloor({ items: [
      ...cabinets,
      makeItem({ id: 'chair-1', type: 'chair', position: { x: 0, z: 3.2 } }),
    ] })] });
    state.headcount = 5;

    render(<CanvasHeading view2D />);

    expect(screen.getByText('估算上限 16 件 · 已摆 16 件')).toBeTruthy();
    expect(screen.getByText('座位还差 4（估算）')).toBeTruthy();
    expect(document.querySelectorAll('.sc-canvas-heading-badge.is-warn')).toHaveLength(2);
  });

  it('shows 人数待核验 when no trusted headcount is mirrored, without a default number', () => {
    state.layout = makeLayout({ floors: [makeFloor({ items: [
      makeItem({ id: 'chair-1', type: 'chair', position: { x: 0, z: 0 } }),
    ] })] });
    state.headcount = null;

    render(<CanvasHeading view2D />);

    expect(screen.getByText('人数待核验')).toBeTruthy();
    expect(screen.queryByText(/24/)).toBeNull();
  });

  it('shows 待核验 badges when venue geometry is incomplete', () => {
    state.layout = makeLayout({
      width: Number.NaN,
      height: 8,
      floors: [makeFloor({ items: [makeItem({ id: 'chair-1', type: 'chair' })] })],
    });
    state.headcount = 3;

    render(<CanvasHeading view2D />);

    expect(screen.getByText('件数估算待核验')).toBeTruthy();
    expect(screen.getByText('座位待核验')).toBeTruthy();
  });
});
