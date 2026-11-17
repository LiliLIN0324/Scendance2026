/**
 * 人物漫游行为引擎（A/B/C 的纯函数底座，2026-11-17）。
 *
 * 丽丽提的三段行为：
 * A. 有流线就沿流线走（RouteFollow）——路线分配已在 `plan-crowd-routes` 里做过；
 * B. 从外面走进一个分区，就在分区里自由活动（ZoneWander）——旧代码只有室内随机游走；
 * C. 看见椅子就坐下（ApproachSeat → Seated）——旧代码只有玩家按 E。
 *
 * 本模块只回答「下一步该干什么」，不碰 three、不碰 React、不自己跑循环：
 * 场景层每 tick 传入当前位置/分区/座位占用，拿回一个决策去执行，因此可以单测。
 *
 * 坐标系：与规划一致，ENU（x 东、y 北，米）。
 */

export interface RoamPoint {
  x: number;
  y: number;
}

export interface RoamZone {
  id: string;
  polygon: readonly RoamPoint[];
}

export interface RoamSeat {
  id: string;
  x: number;
  y: number;
  rotationDeg: number;
  /** 座位所属分区；给了就只在本分区找座。 */
  zoneId?: string | undefined;
}

export type RoamMode = 'route' | 'wander' | 'approach-seat' | 'seated' | 'idle';

export type RoamDecision =
  /** 保持当前行为（继续沿流线走 / 继续坐着）。 */
  | { kind: 'stay' }
  /** 在分区里换一个落点。 */
  | { kind: 'wander'; target: RoamPoint }
  /** 去坐这张椅子。 */
  | { kind: 'approach-seat'; seat: RoamSeat }
  /** 坐够了，起身并释放座位。 */
  | { kind: 'stand-up'; seatId: string }
  /** 分区活动结束，回到流线继续走。 */
  | { kind: 'rejoin-route' }
  /** 既没流线也没分区可用，原地待机。 */
  | { kind: 'idle' };

/** 座位占用表：一把椅子同时只归一个人。 */
export class SeatClaims {
  private readonly holders = new Map<string, string>();

  /** 占座；已被别人占着返回 false（自己已占则幂等成功）。 */
  claim(seatId: string, personId: string): boolean {
    const holder = this.holders.get(seatId);
    if (holder && holder !== personId) return false;
    this.holders.set(seatId, personId);
    return true;
  }

  release(seatId: string, personId?: string): void {
    if (personId && this.holders.get(seatId) !== personId) return;
    this.holders.delete(seatId);
  }

  releasePerson(personId: string): string[] {
    const released: string[] = [];
    for (const [seatId, holder] of this.holders) {
      if (holder !== personId) continue;
      this.holders.delete(seatId);
      released.push(seatId);
    }
    return released;
  }

  holder(seatId: string): string | undefined {
    return this.holders.get(seatId);
  }

  isFree(seatId: string): boolean {
    return !this.holders.has(seatId);
  }
}

/** 射线法点在多边形内（边界算内）。与分区数据同一口径：多边形按顶点顺序给。 */
export function pointInPolygon(point: RoamPoint, polygon: readonly RoamPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const straddles = (a.y > point.y) !== (b.y > point.y);
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  // 落在边上也算在分区里：避免贴边站着被判成「在外圈」。
  return inside || polygon.some((vertex, index) => {
    const next = polygon[(index + 1) % polygon.length]!;
    return pointOnSegment(point, vertex, next);
  });
}

function pointOnSegment(point: RoamPoint, a: RoamPoint, b: RoamPoint): boolean {
  const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
  if (Math.abs(cross) > 1e-9) return false;
  const dot = (point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y);
  if (dot < 0) return false;
  const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot <= lengthSquared;
}

/** 流线是否穿过这个分区：任一路点落在分区内即算（够用于「走到这儿该拐进去」）。 */
export function routeCrossesZone(routePoints: readonly RoamPoint[], zone: RoamZone): boolean {
  return routePoints.some(point => pointInPolygon(point, zone.polygon));
}

/** 最近的一把空座（给了 zoneId 就只在该分区里找）。 */
export function nearestFreeSeat(
  from: RoamPoint,
  seats: readonly RoamSeat[],
  claims: SeatClaims,
  options: { maxDistanceM?: number; zoneId?: string | undefined } = {},
): RoamSeat | null {
  const maxDistance = options.maxDistanceM ?? 8;
  let best: RoamSeat | null = null;
  let bestDistance = Infinity;
  for (const seat of seats) {
    if (options.zoneId && seat.zoneId && seat.zoneId !== options.zoneId) continue;
    if (!claims.isFree(seat.id)) continue;
    const distance = Math.hypot(seat.x - from.x, seat.y - from.y);
    if (distance > maxDistance || distance >= bestDistance) continue;
    best = seat;
    bestDistance = distance;
  }
  return best;
}

/**
 * 分区内随机取一个可站立的点：拒绝采样，跳过障碍（设施 / 禁区）。
 * 采不到返回 null（分区被塞满时调用方应回退到原地待机或回路线）。
 */
export function sampleZonePoint(
  zone: RoamZone,
  rng: () => number,
  options: { isBlocked?: (point: RoamPoint) => boolean; tries?: number } = {},
): RoamPoint | null {
  const polygon = zone.polygon;
  if (polygon.length < 3) return null;
  const xs = polygon.map(point => point.x);
  const ys = polygon.map(point => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const tries = options.tries ?? 24;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const point = { x: minX + rng() * (maxX - minX), y: minY + rng() * (maxY - minY) };
    if (!pointInPolygon(point, polygon)) continue;
    if (options.isBlocked?.(point)) continue;
    return point;
  }
  return null;
}

export interface RoamContext {
  personId: string;
  position: RoamPoint;
  mode: RoamMode;
  /** 当前所在分区；不在任何分区时为 null。 */
  zone: RoamZone | null;
  /** 这个人当前还挂不挂在一条流线上（没有流线时只能在分区里活动）。 */
  onRoute: boolean;
  seats: readonly RoamSeat[];
  claims: SeatClaims;
  rng: () => number;
  /** 寻座半径，默认 8 m（户外分区通常比室内大，按场地再调）。 */
  seatSearchM?: number;
  /** 坐多久起身，默认 90 s。 */
  seatDwellMs?: number;
  /** 已经坐了多久（ms）。 */
  seatedForMs?: number;
  /** 分区里有障碍时传进来，游走点会避开。 */
  isBlocked?: (point: RoamPoint) => boolean;
  /** 走到分区里之后，每次 tick 决定「继续走 / 找座」的概率，默认 0.35。 */
  seekSeatChance?: number;
  /** 沿流线经过分区时，拐进去的概率，默认 0.5。 */
  enterZoneChance?: number;
}

/**
 * 一步决策。
 *
 * 优先级：坐着 > 去坐的途中 > 分区活动（先找空座，再随机走）> 流线 > 待机。
 * 不返回「怎么走」——路径与避障仍由场景层的行走实现负责。
 */
export function planRoamStep(context: RoamContext): RoamDecision {
  const {
    mode,
    zone,
    onRoute,
    seats,
    claims,
    rng,
    personId,
    position,
  } = context;
  const seekSeatChance = context.seekSeatChance ?? 0.35;
  const enterZoneChance = context.enterZoneChance ?? 0.5;
  const seatSearchM = context.seatSearchM ?? 8;
  const seatDwellMs = context.seatDwellMs ?? 90_000;

  // ① 已经坐着：坐够时间才起身，起身必须释放座位，否则这张椅子永远被占。
  if (mode === 'seated') {
    const seatedForMs = context.seatedForMs ?? 0;
    if (seatedForMs < seatDwellMs) return { kind: 'stay' };
    const held = seats.find(seat => claims.holder(seat.id) === personId);
    if (held) return { kind: 'stand-up', seatId: held.id };
    return onRoute ? { kind: 'rejoin-route' } : { kind: 'idle' };
  }

  // ② 正在走向座位：保持，到位后由场景层切成 seated。
  if (mode === 'approach-seat') return { kind: 'stay' };

  // ③ 在分区里：先看有没有空座，再看要不要换个点走走。
  if (zone) {
    if (rng() < seekSeatChance) {
      const seat = nearestFreeSeat(position, seats, claims, { maxDistanceM: seatSearchM, zoneId: zone.id });
      if (seat && claims.claim(seat.id, personId)) return { kind: 'approach-seat', seat };
    }
    const target = sampleZonePoint(zone, rng, context.isBlocked ? { isBlocked: context.isBlocked } : {});
    if (target) return { kind: 'wander', target };
    // 分区里挤不下人了：有流线就回去，没有就原地站着。
    return onRoute ? { kind: 'rejoin-route' } : { kind: 'idle' };
  }

  // ④ 还在流线上：按概率拐进路过的分区（进入后下一 tick 走 ③）。
  if (onRoute) {
    if (rng() < enterZoneChance) {
      // 具体拐进哪个分区由场景层按 routeCrossesZone 结果传入 zone；
      // 这里只表达「该拐了」，避免把路线几何耦合进来。
      return { kind: 'wander', target: position };
    }
    return { kind: 'stay' };
  }

  return { kind: 'idle' };
}
