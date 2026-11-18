import { describe, expect, it } from 'vitest';
import {
  describeRouteGuidance,
  guidanceAlongRoute,
  polylineLength,
  projectOnPolyline,
  routeCoverage,
} from './walk-route-guidance';

const route = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 10 },
];

describe('polylineLength', () => {
  it('adds segment lengths', () => {
    expect(polylineLength(route)).toBeCloseTo(20, 6);
  });
});

describe('projectOnPolyline', () => {
  it('projects onto the nearest segment with lateral offset', () => {
    const projection = projectOnPolyline(route, { x: 5, z: 1 })!;
    expect(projection.alongM).toBeCloseTo(5, 6);
    expect(projection.offRouteM).toBeCloseTo(1, 6);
    expect(projection.segmentIndex).toBe(0);
  });

  it('clamps beyond the last vertex to the end', () => {
    const projection = projectOnPolyline(route, { x: 10, z: 20 })!;
    expect(projection.alongM).toBeCloseTo(20, 6);
    expect(projection.segmentIndex).toBe(1);
  });

  it('returns null for a single point', () => {
    expect(projectOnPolyline([{ x: 0, z: 0 }], { x: 1, z: 1 })).toBeNull();
  });
});

describe('guidanceAlongRoute', () => {
  it('reports remaining distance, next corner and ETA', () => {
    const guidance = guidanceAlongRoute(route, { x: 5, z: 1 }, 1.8)!;
    expect(guidance.remainingM).toBeCloseTo(15, 6);
    expect(guidance.progress).toBeCloseTo(0.25, 6);
    expect(guidance.nextX).toBe(10);
    expect(guidance.nextZ).toBe(0);
    expect(guidance.toNextM).toBeCloseTo(Math.hypot(5, 1), 6);
    expect(guidance.etaSeconds).toBeCloseTo(15 / 1.8, 6);
    expect(describeRouteGuidance(guidance)).toContain('流线 25%');
  });

  it('drops ETA when the walk speed is unknown', () => {
    const guidance = guidanceAlongRoute(route, { x: 0, z: 0 }, 0)!;
    expect(guidance.etaSeconds).toBeNull();
  });
});

describe('routeCoverage', () => {
  it('takes the furthest point reached, ignoring order', () => {
    const coverage = routeCoverage(route, [
      { x: 2, z: 0 },
      { x: 10, z: 5 },
      { x: 0, z: 0 },
    ]);
    expect(coverage).toBeCloseTo(0.75, 6);
  });

  it('is zero without samples', () => {
    expect(routeCoverage(route, [])).toBe(0);
  });
});
