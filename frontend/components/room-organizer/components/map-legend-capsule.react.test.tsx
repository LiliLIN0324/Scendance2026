// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlanLegendGroup } from '../lib/site-plan-legend';
import { MapLegendCapsule, legendEntriesForMap } from './map-legend-capsule';

afterEach(cleanup);

const groups: PlanLegendGroup[] = [
  {
    title: '用地红线',
    entries: [{ icon: 'hexagon', swatch: '#c23b2e', label: '用地红线', count: 1, detail: '' }],
  },
  {
    title: '动线',
    entries: [{ icon: 'footprints', swatch: '#35624a', label: '人行动线', count: 2, detail: '' }],
  },
];

describe('map legend capsule', () => {
  it('hides the entry when nothing is drawn', () => {
    expect(legendEntriesForMap(groups.slice(0, 1), 0)).toEqual([]);
    const view = render(<MapLegendCapsule entries={[]} />);
    expect(screen.queryByTestId('map-legend')).toBeNull();
    view.unmount();
  });

  it('starts collapsed and lists swatch, name, and count when opened', () => {
    const entries = legendEntriesForMap(groups, 4);
    expect(entries.map(entry => entry.label)).toEqual(['用地红线', '人行动线']);
    render(<MapLegendCapsule entries={entries} />);

    const button = screen.getByRole('button', { name: '图例' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('legend-entry')).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const rows = screen.getAllByTestId('legend-entry').map(row => row.textContent);
    expect(rows).toEqual(['用地红线1', '人行动线2']);
  });
});