// @vitest-environment jsdom

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createStarterOutdoorPlan } from '../room-organizer/lib/outdoor-project-store';
import { planPointFromClient, ReviewOutdoorSheet } from './review-outdoor-sheet';

const plan = {
  ...createStarterOutdoorPlan(),
  boundary: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
};

describe('ReviewOutdoorSheet', () => {
  it('把画布点击换算成 ENU 米制坐标', () => {
    const point = planPointFromClient({
      clientX: 50,
      clientY: 50,
      rect: { left: 0, top: 0, width: 100, height: 100 },
      scale: 1,
      tx: 0,
      ty: 0,
      bounds: { minX: -4, maxY: 14, width: 18, height: 18 },
    });
    expect(point.x).toBeCloseTo(5, 1);
    expect(point.y).toBeCloseTo(5, 1);
  });

  it('点已有钉只聚焦，不再落一颗新钉', () => {
    const onPick = vi.fn();
    const onFocusPin = vi.fn();
    const { container } = render(
      <ReviewOutdoorSheet
        plan={plan}
        pins={[{
          id: 'pin-1', text: '入口加宽', itemId: null, x: 5, y: 0, z: 5,
          offset: null, camera: { position: [5, 12, 17], target: [5, 0, 5] }, status: 'open',
          floorId: 'outdoor',
        }]}
        activePinId={null}
        onPick={onPick}
        onFocusPin={onFocusPin}
      />,
    );
    const pinCircle = container.querySelector('circle');
    expect(pinCircle).not.toBeNull();
    fireEvent.click(pinCircle!);
    expect(onFocusPin).toHaveBeenCalledWith('pin-1');
    expect(onPick).not.toHaveBeenCalled();
  });
});
