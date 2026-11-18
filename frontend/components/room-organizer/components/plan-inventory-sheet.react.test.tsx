// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanOverviewStats } from '../lib/site-plan-measure';
import { PlanStatRows, planListIsBlank, planSheetIsEmpty, planStatAreaLabel, planStatRouteLabel } from './plan-inventory-sheet';

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
  it('treats a blank list as empty even when the boundary already has area', () => {
    expect(planListIsBlank(0)).toBe(true);
    expect(planListIsBlank(2)).toBe(false);
    expect(planSheetIsEmpty(stats(), 0)).toBe(true);
    expect(planSheetIsEmpty(stats({ boundaryAreaM2: 50 }), 0)).toBe(false);
  });

  it('keeps four stat rows on an empty plan and lets a zero issue count enter the filter', () => {
    const onShowIssues = vi.fn();
    render(
      <PlanStatRows
        areaM2={0}
        hasClosedBoundary={false}
        zones={0}
        facilities={0}
        routes={0}
        routeLengthM={0}
        issues={0}
        issuesOnly={false}
        onShowIssues={onShowIssues}
      />,
    );

    expect(screen.getAllByRole('term').map(term => term.textContent)).toEqual([
      '场地面积',
      '分区 / 设施',
      '动线',
      '待处理问题',
    ]);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('0 / 0')).toBeTruthy();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.queryByText('0 条 · 0 m')).toBeNull();
    expect(screen.queryByText('还没有布置')).toBeNull();

    const issue = screen.getByTestId('info-issue-count');
    expect(issue.tagName).toBe('BUTTON');
    fireEvent.click(issue);
    expect(onShowIssues).toHaveBeenCalledOnce();
  });

  it('shows the measured area once a boundary exists, and the route length once routes exist', () => {
    expect(planStatAreaLabel(1260, true)).toBe('1260 m²');
    expect(planStatAreaLabel(0, false)).toBe('—');
    expect(planStatRouteLabel(0, 0)).toBe('0');
    expect(planStatRouteLabel(4, 186)).toBe('4 条 · 186 m');

    render(
      <PlanStatRows
        areaM2={1260}
        hasClosedBoundary
        zones={3}
        facilities={12}
        routes={4}
        routeLengthM={186}
        issues={2}
        issuesOnly={false}
        onShowIssues={vi.fn()}
      />,
    );
    expect(screen.getByText('1260 m²')).toBeTruthy();
    expect(screen.getByText('3 / 12')).toBeTruthy();
    expect(screen.getByText('4 条 · 186 m')).toBeTruthy();
    expect(screen.queryByText(/当前可见/)).toBeNull();
  });
});
