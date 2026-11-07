import { describe, expect, it } from 'vitest';
import {
  MAX_WAYPOINTS,
  PERSON_PAUSE_MS,
  PERSON_WALK_SPEED_MPS,
  type RouteFollowerState,
  type RouteStepContext,
  createRouteFollower,
  normalizeRoutePause,
  normalizeRouteSpeed,
  routeIsLoop,
  routeLength,
  personWalkBounds,
  routePointError,
  routePointErrorInRect,
  routeSignature,
  stepRouteFollower,
} from './person-route';
import type { WalkRoute } from './types';

const square: WalkRoute = {
  points: [
    { x: 2, z: 2 },
    { x: 6, z: 2 },
    { x: 6, z: 6 },
    { x: 2, z: 6 },
  ],
};

function walkSeconds(state: RouteFollowerState, route: WalkRoute, seconds: number, ctx?: RouteStepContext): void {
  const step = 1 / 60;
  for (let t = 0; t < seconds; t += step) {
    stepRouteFollower(state, route, step, ctx);
  }
}

describe('route helpers', () => {
  it('closed loops include the closing leg in the length', () => {
    expect(routeLength(square.points, true)).toBeCloseTo(16, 5);
    expect(routeLength(square.points, false)).toBeCloseTo(12, 5);
  });

  it('normalises speed, pause and loop away from caller mistakes', () => {
    expect(normalizeRouteSpeed({ points: square.points })).toBe(PERSON_WALK_SPEED_MPS);
    expect(normalizeRouteSpeed({ points: square.points, speed: 0.01 })).toBe(PERSON_WALK_SPEED_MPS);
    expect(normalizeRouteSpeed({ points: square.points, speed: 99 })).toBe(3);
    expect(normalizeRoutePause({ points: square.points, pauseMs: -5 })).toBe(PERSON_PAUSE_MS);
    expect(normalizeRoutePause({ points: square.points, pauseMs: 0 })).toBe(0);
    expect(routeIsLoop({ points: square.points })).toBe(true);
    expect(routeIsLoop({ points: square.points, loop: false })).toBe(false);
  });

  it('signatures change only when the geometry changes', () => {
    expect(routeSignature(undefined)).toBeNull();
    expect(routeSignature({ points: [{ x: 0, z: 0 }] })).toBeNull();
    expect(routeSignature(square)).toBe(routeSignature(square));
    expect(routeSignature(square)).not.toBe(routeSignature({ ...square, loop: false }));
    expect(routeSignature(square)).not.toBe(routeSignature({ ...square, points: square.points.slice(0, 3) }));
  });

  it('rejects out-of-bounds and stacked points', () => {
    expect(routePointError(square.points, { x: 3, z: 3 }, { width: 12, depth: 12 })).toBeNull();
    // 房间中心为原点：12 m 房间的界内半径是 6 − 0.3 = 5.7 m。
    expect(routePointError(square.points, { x: 5.9, z: 3 }, { width: 12, depth: 12 })).toContain('场地内');
    expect(routePointError(square.points, { x: 3, z: -5.9 }, { width: 12, depth: 12 })).toContain('场地内');
    expect(routePointError(square.points, { x: 2, z: 6.05 }, { width: 16, depth: 16 })).toContain('太近');
    const full = Array.from({ length: MAX_WAYPOINTS }, (_, i) => ({ x: i, z: 0 }));
    expect(routePointError(full, { x: 3, z: 3 }, { width: 12, depth: 12 })).toContain('最多');
  });

  it('rect form validates against an offset venue box (real scan range)', () => {
    // 实景点云范围不居中（有落位偏移）：四至直接给，界内判据是同一条 0.3 m 余量。
    const venue = { minX: -2, maxX: 10, minZ: -2, maxZ: 10 };
    expect(routePointErrorInRect(square.points, { x: 3, z: 3 }, venue)).toBeNull();
    expect(routePointErrorInRect(square.points, { x: -1.8, z: 3 }, venue)).toContain('场地内');
    expect(routePointErrorInRect(square.points, { x: 3, z: 9.8 }, venue)).toContain('场地内');
    // 与中心原点版共享「太近 / 最多」两条非几何检查。
    expect(routePointErrorInRect(square.points, { x: 2, z: 6.05 }, venue)).toContain('太近');
    const full = Array.from({ length: MAX_WAYPOINTS }, (_, i) => ({ x: i, z: 0 }));
    expect(routePointErrorInRect(full, { x: 3, z: 3 }, venue)).toContain('最多');
    // 等价性：中心原点的布局矩形两种形式结论一致。
    expect(routePointErrorInRect(square.points, { x: 5.9, z: 3 }, { minX: -6, maxX: 6, minZ: -6, maxZ: 6 }))
      .toBe(routePointError(square.points, { x: 5.9, z: 3 }, { width: 12, depth: 12 }));
  });

  it('walk bounds prefer the real scan range and fall back to the layout rect', () => {
    // 实景：点云四至内缩 0.3 m 余量。
    expect(personWalkBounds({ minX: 2, maxX: 14, minZ: -1, maxZ: 9 }, { width: 12, depth: 12 }))
      .toEqual({ minX: 2.3, minZ: -0.7, maxX: 13.7, maxZ: 8.7 });
    // 无实景（null / undefined）退回布局名义矩形。
    expect(personWalkBounds(null, { width: 12, depth: 9 }))
      .toEqual({ minX: -5.7, minZ: -4.2, maxX: 5.7, maxZ: 4.2 });
    expect(personWalkBounds(undefined, { width: 12, depth: 9 }))
      .toEqual({ minX: -5.7, minZ: -4.2, maxX: 5.7, maxZ: 4.2 });
    // 范围退化（任一边 ≤ 2×0.3 m）同样退回布局矩形，避免夹取框翻转把人钉死。
    expect(personWalkBounds({ minX: 0, maxX: 0.5, minZ: 0, maxZ: 8 }, { width: 12, depth: 9 }))
      .toEqual({ minX: -5.7, minZ: -4.2, maxX: 5.7, maxZ: 4.2 });
  });
});

describe('closed-loop walking', () => {
  it('travels a distance matching the route and completes laps', () => {
    // 停留会计入时间预算，这里用不停留的路线对账纯行走距离。
    const route: WalkRoute = { points: square.points, pauseMs: 0 };
    const state = createRouteFollower(route);
    walkSeconds(state, route, 33);
    // 33 s at 1.05 m/s ≈ 34.6 m — about two laps of the 16 m circuit (laps
    // 计「抵达首点」：16 m 与 32 m 处各一次)。
    expect(state.travelled).toBeGreaterThan(33);
    expect(state.travelled).toBeLessThan(36);
    expect(state.laps).toBeGreaterThanOrEqual(2);
  });

  it('returns to the start waypoint after each lap (positions repeat)', () => {
    const route: WalkRoute = { points: square.points, pauseMs: 0 };
    const state = createRouteFollower(route);
    const period = routeLength(square.points, true) / PERSON_WALK_SPEED_MPS;
    walkSeconds(state, route, period + 0.35);
    expect(Math.hypot(state.x - square.points[0]!.x, state.z - square.points[0]!.z)).toBeLessThan(0.6);
    expect(state.laps).toBe(1);
  });

  it('faces the leg being walked', () => {
    const route: WalkRoute = { points: square.points, pauseMs: 0 };
    const state = createRouteFollower(route);
    // Segment 1 heads +x: atan2(dx=+1, dz=0) = +π/2.
    walkSeconds(state, route, 1.2);
    expect(state.facing).toBeCloseTo(Math.PI / 2, 1);
  });

  it('dwells at each waypoint for the configured pause', () => {
    const route: WalkRoute = { points: [{ x: 0, z: 0 }, { x: 1, z: 0 }], pauseMs: 1000, loop: false, speed: 1 };
    const state = createRouteFollower(route);
    // First leg takes ~1 s; the next 0.6 s must be standing still at the waypoint.
    walkSeconds(state, route, 1.7);
    expect(state.x).toBeCloseTo(1, 3);
    expect(state.travelled).toBeCloseTo(1, 2);
  });
});

describe('pingpong walking (loop: false)', () => {
  it('walks to the end, reverses, and never leaves the route', () => {
    const route: WalkRoute = { points: [{ x: 1, z: 1 }, { x: 5, z: 1 }, { x: 5, z: 5 }], loop: false, pauseMs: 0 };
    const state = createRouteFollower(route);
    walkSeconds(state, route, 40);
    expect(state.laps).toBeGreaterThanOrEqual(3);
    // Pingpong stays inside the convex hull of the waypoints.
    expect(state.x).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(state.x).toBeLessThanOrEqual(5 + 1e-6);
    expect(state.z).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(state.z).toBeLessThanOrEqual(5 + 1e-6);
  });
});

describe('collision and bounds', () => {
  const boxCollider = (cx: number, cz: number, hw: number, hd: number) => ({
    cx, cz, hw, hd,
    ax: 1, az: 0, bx: 0, bz: 1,
    aabbHalfW: hw, aabbHalfD: hd,
    outdoor: false,
  });

  it('does not tunnel through a collider: slides or stands, never inside', () => {
    // Wall blocking the second leg (x=2..8 at z=4); route must not cross it.
    const colliders = [boxCollider(5, 4, 3, 0.08)];
    const route: WalkRoute = { points: [{ x: 2, z: 2 }, { x: 8, z: 2 }, { x: 8, z: 6 }, { x: 2, z: 6 }] };
    const state = createRouteFollower(route);
    const inWall = (x: number, z: number) => Math.abs(x - 5) < 3 + 0.28 && Math.abs(z - 4) < 0.08 + 0.28;
    for (let i = 0; i < 60 * 40; i++) {
      const r = stepRouteFollower(state, route, 1 / 60, { colliders });
      expect(inWall(r.x, r.z)).toBe(false);
    }
  });

  it('stands at the wall face then turns around instead of pushing through', () => {
    const colliders = [boxCollider(1.5, 0, 0.4, 0.4)];
    const route: WalkRoute = { points: [{ x: 0, z: 0 }, { x: 3, z: 0 }], pauseMs: 0 };
    const state = createRouteFollower(route);
    let sawBlocked = false;
    for (let i = 0; i < 240; i++) {
      const r = stepRouteFollower(state, route, 1 / 60, { colliders });
      if (r.blocked) sawBlocked = true;
    }
    expect(sawBlocked).toBe(true);
    // 先被推到墙面（≈0.82 m），1.2 s 掉头往回走——永不穿墙，里程也只往回长。
    expect(state.travelled).toBeLessThan(3.5);
    expect(state.x).toBeLessThan(1.1);
  });

  it('clamps inside the walk bounds, bounces back and never escapes', () => {
    const bounds = { minX: 0.3, minZ: 0.3, maxX: 9.7, maxZ: 9.7 };
    const route: WalkRoute = { points: [{ x: 1, z: 1 }, { x: 20, z: 1 }, { x: 20, z: 20 }, { x: 1, z: 20 }] };
    const state = createRouteFollower(route);
    for (let i = 0; i < 60 * 20; i++) {
      const r = stepRouteFollower(state, route, 1 / 60, { bounds });
      expect(r.x).toBeLessThanOrEqual(bounds.maxX);
      expect(r.z).toBeLessThanOrEqual(bounds.maxZ);
    }
    // 到界即被夹住并掉头（不是钉死在界上）。
    expect(state.x).toBeGreaterThanOrEqual(bounds.minX);
    expect(state.x).toBeLessThanOrEqual(bounds.maxX);
    expect(state.travelled).toBeGreaterThan(10);
  });

  it('turns around when pinned by an obstacle instead of deadlocking (E2E regression)', () => {
    // E2E 实踩场景：路线边距桌沿 0.2 m，人物半径 0.28 过不去，被推挤钉在
    // 障碍面上（每帧位移≈0）。修复前：永久僵住；修复后：1.2 s 掉头反走。
    const colliders = [boxCollider(1.4, 0, 0.6, 0.3)];
    const route: WalkRoute = {
      points: [{ x: -3, z: -2 }, { x: 1, z: -2 }, { x: 1, z: 1 }, { x: -3, z: 1 }],
      loop: true,
      pauseMs: 0,
    };
    const state = createRouteFollower(route);
    let sawBlocked = false;
    for (let i = 0; i < 60 * 60; i++) {
      const r = stepRouteFollower(state, route, 1 / 60, { colliders });
      if (r.blocked) sawBlocked = true;
    }
    expect(sawBlocked).toBe(true);
    // 僵住的话里程只会停在 ~5.4 m（首段 + 贴边滑行）；掉头后 60 s 能走出更多。
    expect(state.travelled).toBeGreaterThan(10);
    // 最后 10 s 窗口仍在走（没有再次死锁）。
    const before = state.travelled;
    walkSeconds(state, route, 10, { colliders });
    expect(state.travelled - before).toBeGreaterThan(1);
  });
});
