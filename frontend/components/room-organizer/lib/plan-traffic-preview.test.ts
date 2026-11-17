import { describe, expect, it } from 'vitest';
import { planTrafficPreviews } from './plan-traffic-preview';
import { createRouteFollower, stepRouteFollower } from './person-route';
import type { PlanFacility, PlanRoute } from '../../../../supabase/functions/_shared/site-plan';

describe('outdoor traffic previews', () => {
  it('puts the closest compatible car on the closest roadway and renders service traffic', () => {
    const road: PlanRoute = {
      id: 'road', kind: 'vehicle', name: '车流', oneWay: true, notes: '',
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    };
    const service: PlanRoute = {
      ...road, id: 'service', kind: 'service', carrier: 'mixed',
      points: [{ x: 0, y: 10 }, { x: 10, y: 10 }],
    };
    const car: PlanFacility = {
      id: 'car', templateId: 'oneplan:scale:car', name: '轿车',
      position: { x: 4, y: 2 }, rotationDeg: 0, size: { width: 2, depth: 4 }, notes: '',
    };
    const previews = planTrafficPreviews({ routes: [road, service], facilities: [car] });
    const roadCar = previews.find(preview => preview.routeId === road.id)!;
    expect(roadCar.sourceFacilityId).toBe(car.id);
    expect(roadCar.route).toMatchObject({ oneWay: true, startDistance: 4 });
    expect(previews.filter(preview => preview.routeId === service.id).map(preview => preview.kind)).toEqual(['vehicle', 'trolley']);

    const follower = createRouteFollower(roadCar.route);
    expect(follower.x).toBe(4);
    expect(stepRouteFollower(follower, roadCar.route, 0.2).x).toBeGreaterThan(4);
    for (let frame = 0; frame < 30; frame += 1) {
      stepRouteFollower(follower, roadCar.route, 0.2);
      expect(follower.dir).toBe(1);
    }
    expect(follower.laps).toBeGreaterThan(0);
  });
});
