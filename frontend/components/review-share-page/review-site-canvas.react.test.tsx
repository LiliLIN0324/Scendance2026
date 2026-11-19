// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStarterOutdoorPlan } from '../room-organizer/lib/outdoor-project-store';
import { ReviewSiteMap } from './review-site-canvas';

afterEach(cleanup);

describe('ReviewSiteMap', () => {
  it('mounts a connected site map and locks the basemap when the sender turned switching off', () => {
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      disconnect(): void {}
    });
    const plan = createStarterOutdoorPlan({
      lng: 120.138,
      lat: 30.254,
      crs: 'gcj-02',
      source: 'picker',
    });
    const { container, rerender } = render(
      <ReviewSiteMap
        plan={plan}
        levelId={plan.levels?.[0]?.id ?? '00000000-0000-4000-8000-000000000000'}
        canSwitchLevel={false}
        onLevel={() => undefined}
        basemap="map"
        canSwitchBasemap={false}
        onBasemap={() => undefined}
        pins={[]}
        pinNumbers={new Map()}
        activePinId={null}
        canPin
        onPick={() => undefined}
        onFocusPin={() => undefined}
      />,
    );
    expect(container.querySelector('[data-review-map="site"]')).toBeTruthy();
    expect(container.querySelector('#review-outdoor-grid')).toBeNull();
    expect(screen.queryByRole('button', { name: '卫星' })).toBeNull();
    expect(screen.getByText('地图')).toBeTruthy();
    rerender(
      <ReviewSiteMap
        plan={plan}
        levelId={plan.levels?.[0]?.id ?? '00000000-0000-4000-8000-000000000000'}
        canSwitchLevel
        onLevel={() => undefined}
        basemap="satellite"
        canSwitchBasemap
        onBasemap={() => undefined}
        pins={[]}
        pinNumbers={new Map()}
        activePinId={null}
        canPin
        onPick={() => undefined}
        onFocusPin={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: '卫星' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '纸面' })).toBeTruthy();
  });

  it('says so when the plan has no site anchor', () => {
    const plan = createStarterOutdoorPlan();
    delete plan.anchor;
    render(
      <ReviewSiteMap
        plan={plan}
        levelId="00000000-0000-4000-8000-000000000000"
        canSwitchLevel={false}
        onLevel={() => undefined}
        basemap="map"
        canSwitchBasemap={false}
        onBasemap={() => undefined}
        pins={[]}
        pinNumbers={new Map()}
        activePinId={null}
        canPin={false}
        onPick={() => undefined}
        onFocusPin={() => undefined}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('没有场地锚点');
    expect(document.querySelector('[data-review-map="unanchored"]')).toBeTruthy();
  });
});
