import { describe, expect, it } from 'vitest';
import {
  SeatClaims,
  nearestFreeSeat,
  planRoamStep,
  pointInPolygon,
  routeCrossesZone,
  sampleZonePoint,
  type RoamContext,
  type RoamSeat,
  type RoamZone,
} from './person-roam';

const square: RoamZone = {
  id: 'zone-a',
  polygon: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
};

const seat = (id: string, x: number, y: number, zoneId?: string): RoamSeat => ({
  id,
  x,
  y,
  rotationDeg: 0,
  ...(zoneId ? { zoneId } : {}),
});

function context(overrides: Partial<RoamContext> = {}): RoamContext {
  return {
    personId: 'p1',
    position: { x: 1, y: 1 },
    mode: 'wander',
    zone: null,
    onRoute: false,
    seats: [],
    claims: new SeatClaims(),
    rng: () => 0.99,
    ...overrides,
  };
}

describe('SeatClaims（座位占用）', () => {
  it('同一把椅子只能被一个人占，第二个人占不到', () => {
    const claims = new SeatClaims();
    expect(claims.claim('s1', 'p1')).toBe(true);
    expect(claims.claim('s1', 'p2')).toBe(false);
    expect(claims.holder('s1')).toBe('p1');
    expect(claims.isFree('s1')).toBe(false);
  });

  it('自己重复占同一把椅子是幂等的；释放后别人可占', () => {
    const claims = new SeatClaims();
    expect(claims.claim('s1', 'p1')).toBe(true);
    expect(claims.claim('s1', 'p1')).toBe(true);
    claims.release('s1', 'p1');
    expect(claims.isFree('s1')).toBe(true);
    expect(claims.claim('s1', 'p2')).toBe(true);
  });

  it('按人批量释放只放自己那把', () => {
    const claims = new SeatClaims();
    claims.claim('s1', 'p1');
    claims.claim('s2', 'p1');
    claims.claim('s3', 'p2');
    expect(claims.releasePerson('p1')).toEqual(['s1', 's2']);
    expect(claims.holder('s3')).toBe('p2');
  });
});

describe('nearestFreeSeat（找最近空座）', () => {
  it('跳过被占的座位，取最近的一把', () => {
    const claims = new SeatClaims();
    claims.claim('near', 'p2');
    const seatHit = nearestFreeSeat({ x: 0, y: 0 }, [seat('near', 1, 0), seat('far', 4, 0), seat('mid', 2, 0)], claims);
    expect(seatHit?.id).toBe('mid');
  });

  it('超出寻座半径就不去', () => {
    const claims = new SeatClaims();
    expect(nearestFreeSeat({ x: 0, y: 0 }, [seat('far', 30, 0)], claims, { maxDistanceM: 8 })).toBeNull();
  });

  it('指定分区后不跨区找座', () => {
    const claims = new SeatClaims();
    const hit = nearestFreeSeat({ x: 0, y: 0 }, [seat('a', 1, 0, 'zone-a'), seat('b', 2, 0, 'zone-b')], claims, { zoneId: 'zone-b' });
    expect(hit?.id).toBe('b');
  });
});

describe('pointInPolygon / routeCrossesZone', () => {
  it('内部、边上算内，外部算外', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square.polygon)).toBe(true);
    expect(pointInPolygon({ x: 0, y: 5 }, square.polygon)).toBe(true);
    expect(pointInPolygon({ x: -1, y: 5 }, square.polygon)).toBe(false);
  });

  it('流线任一点落在分区内就算穿过', () => {
    expect(routeCrossesZone([{ x: -5, y: 5 }, { x: 3, y: 4 }], square)).toBe(true);
    expect(routeCrossesZone([{ x: -5, y: 5 }, { x: -2, y: 4 }], square)).toBe(false);
  });
});

describe('sampleZonePoint（分区内取点）', () => {
  it('取到的点一定在分区内', () => {
    let seed = 1;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 50; i += 1) {
      const point = sampleZonePoint(square, rng);
      expect(point).not.toBeNull();
      expect(pointInPolygon(point!, square.polygon)).toBe(true);
    }
  });

  it('障碍把落点全挡掉时返回 null，不硬塞一个非法点', () => {
    const point = sampleZonePoint(square, () => 0.5, { isBlocked: () => true, tries: 8 });
    expect(point).toBeNull();
  });
});

describe('planRoamStep（A/B/C 三段）', () => {
  it('A｜在流线上就继续走', () => {
    const decision = planRoamStep(context({ mode: 'route', onRoute: true, rng: () => 0.99 }));
    expect(decision.kind).toBe('stay');
  });

  it('A→B｜沿流线经过分区时按概率拐进去', () => {
    const decision = planRoamStep(context({ mode: 'route', onRoute: true, rng: () => 0.1, enterZoneChance: 0.5 }));
    expect(decision.kind).toBe('wander');
  });

  it('B｜在分区里没椅子时换一个分区落点', () => {
    const decision = planRoamStep(context({ mode: 'wander', zone: square, rng: () => 0.99 }));
    expect(decision.kind).toBe('wander');
    if (decision.kind === 'wander') expect(pointInPolygon(decision.target, square.polygon)).toBe(true);
  });

  it('B→C｜分区里有空座就去坐，并立刻占住座位', () => {
    const claims = new SeatClaims();
    const decision = planRoamStep(context({
      mode: 'wander',
      zone: square,
      seats: [seat('s1', 2, 2, 'zone-a')],
      claims,
      rng: () => 0.1,
      seekSeatChance: 0.5,
    }));
    expect(decision.kind).toBe('approach-seat');
    if (decision.kind === 'approach-seat') expect(decision.seat.id).toBe('s1');
    expect(claims.holder('s1')).toBe('p1');
  });

  it('C｜座位被占时不去抢，改为在分区里走', () => {
    const claims = new SeatClaims();
    claims.claim('s1', 'p2');
    const decision = planRoamStep(context({
      mode: 'wander',
      zone: square,
      seats: [seat('s1', 2, 2, 'zone-a')],
      claims,
      rng: () => 0.1,
      seekSeatChance: 0.5,
    }));
    expect(decision.kind).toBe('wander');
  });

  it('C｜坐够时间就起身并释放座位', () => {
    const claims = new SeatClaims();
    claims.claim('s1', 'p1');
    const decision = planRoamStep(context({
      mode: 'seated',
      seats: [seat('s1', 2, 2, 'zone-a')],
      claims,
      onRoute: true,
      seatDwellMs: 1000,
      seatedForMs: 5000,
    }));
    expect(decision.kind).toBe('stand-up');
  });

  it('C｜没坐够就继续坐着', () => {
    const claims = new SeatClaims();
    claims.claim('s1', 'p1');
    const decision = planRoamStep(context({
      mode: 'seated',
      seats: [seat('s1', 2, 2, 'zone-a')],
      claims,
      seatDwellMs: 10_000,
      seatedForMs: 500,
    }));
    expect(decision.kind).toBe('stay');
  });

  it('分区挤满且没有流线时原地待机，不乱找目标', () => {
    const decision = planRoamStep(context({
      mode: 'wander',
      zone: square,
      onRoute: false,
      rng: () => 0.99,
      isBlocked: () => true,
    }));
    expect(decision.kind).toBe('idle');
  });
});
