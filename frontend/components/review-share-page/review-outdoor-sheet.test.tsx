// @vitest-environment jsdom

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createStarterOutdoorPlan } from '../room-organizer/lib/outdoor-project-store';
import { ReviewOutdoorSheet } from './review-outdoor-sheet';

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
    const onPick = vi.fn();
    const { container } = render(
      <ReviewOutdoorSheet plan={plan} pins={[]} activePinId={null} onPick={onPick} onFocusPin={() => {}} />,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    svg!.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.click(svg!, { clientX: 50, clientY: 50 });
    expect(onPick).toHaveBeenCalledTimes(1);
    const point = onPick.mock.calls[0][0] as { x: number; y: number };
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
    const svg = container.querySelector('svg');
    svg!.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}),
    });
    const pinCircle = container.querySelector('circle');
    expect(pinCircle).not.toBeNull();
    fireEvent.click(pinCircle!);
    expect(onFocusPin).toHaveBeenCalledWith('pin-1');
    expect(onPick).not.toHaveBeenCalled();
  });
});
