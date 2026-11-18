// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanOverviewStats } from '../lib/site-plan-measure';
import { PlanStatRows, planSheetIsEmpty } from './plan-inventory-sheet';

afterEach(cleanup);

function stats(patch: Partial<PlanOverviewStats> = {}): PlanOverviewStats {
  return {
    boundaryAreaM2: 0,
    zoneCount: 0,
    facilityCount: 0,
    routeCount: 0,
    routeLengthMByKind: { pedestrian: 0, vehicle: 0, service: 0 },
    routeLengthTotalM: 0,
    nodeCount: 0,
    workerPostCount: 0,
    workerTotalCount: 0,
    vehicleCount: 0,
    vehicleTotalCount: 0,
    measurementCount: 0,
    annotationCount: 0,
    issueCount: 0,
    conflictCount: 0,
    ...patch,
  };
}

describe('plan inventory sheet', () => {
  it('treats a blank plan as empty', () => {
    expect(planSheetIsEmpty(stats(), 0)).toBe(true);
    expect(planSheetIsEmpty(stats({ facilityCount: 2 }), 2)).toBe(false);
  });

  it('lays key numbers out one per row and opens the issue filter from the count', () => {
    const onShowIssues = vi.fn();
    render(
      <PlanStatRows
        area="1 260 m²"
        zones={3}
        facilities={12}
        routes={4}
        routeLength="186 m"
        issues={2}
        issuesOnly={false}
        onShowIssues={onShowIssues}
      />,
    );

    const rows = screen.getAllByRole('term').map(term => term.textContent);
    expect(rows).toEqual(['场地面积', '分区 / 设施', '动线', '待处理问题']);
    expect(screen.getByText('3 / 12')).toBeTruthy();
    expect(screen.getByText('4 条 · 186 m')).toBeTruthy();
    expect(screen.queryByText(/当前可见/)).toBeNull();

    fireEvent.click(screen.getByTestId('info-issue-count'));
    expect(onShowIssues).toHaveBeenCalledOnce();
  });

  it('does not turn a zero issue count into a filter button', () => {
    render(
      <PlanStatRows
        area="20 m²"
        zones={1}
        facilities={0}
        routes={0}
        routeLength="0 m"
        issues={0}
        issuesOnly={false}
        onShowIssues={vi.fn()}
      />,
    );
    expect(screen.getByTestId('info-issue-count').tagName).toBe('SPAN');
  });

  it('keeps a plan that already has area', () => {
    expect(planSheetIsEmpty(stats({ boundaryAreaM2: 50 }), 0)).toBe(false);
  });
});
