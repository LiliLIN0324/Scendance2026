/**
 * B1 人物自主落座（纯函数，零 three / React）。
 *
 * 口径（用户 2026-11-17）：「有流线就沿流线走；看到椅子就坐下。」
 * 本模块只做**决策**：什么时候去坐、坐在哪、坐多久、什么时候起身。
 * 位移仍由 `lib/person-route.ts` 的 follower 负责——行为层只换「当前路线」，
 * 不新增第二个 mover（详见 `docs/plans/2026-11-17-roam-behavior-layer.md` §三）。
 *
 * 三条硬约束：
 * - 确定性：不掷骰子。先到先得 + 距离最近 + id 字典序兜底；坐多久由调用方按
 *   `seatId` 哈希给出，同一份方案跑两遍结果一致。
 * - 一人一座：占座表由调用方持有（`createSeatRegistry`），起身才释放。
 * - 走不过去就不坐：直线可达性由调用方用 `resolveWalkerStep` 判（`canReach`），
 *   本模块不猜几何。
 */

/** 一个可落座的座位（坐标系统一由调用方决定，本模块只做平面比较）。 */
export interface SeatAnchor {
  id: string;
  /** 坐姿锚点：人站在这里坐下，髋部落在座面上（已含「后退到椅面偏后」的偏移）。 */
  x: number;
  z: number;
  /** 起身后的站定点（比坐姿锚点再后退一段），也是走过去的目标。 */
  approach: { x: number; z: number };
  /** 坐下后的朝向（弧度，与 three 的 rotation.y 同一套）。 */
  facing: number;
  /** 坐面高度（米，从地面起算）。 */
  seatHeight: number;
}

export interface SeatBehaviorConfig {
  /** 从这里往外就不值得为坐一把椅子改道（米）。 */
  maxDetourM: number;
  /** 走到离接近点这么近就算到了（米）。 */
  arriveM: number;
}

export const DEFAULT_SEAT_BEHAVIOR: SeatBehaviorConfig = {
  maxDetourM: 8,
  arriveM: 0.35,
};

export interface SeatBehaviorContext {
  position: { x: number; z: number };
  seats: readonly SeatAnchor[];
  /** 是否已被别人占着（含自己当前坐的那把）。 */
  isTaken: (seatId: string) => boolean;
  /**
   * 从当前位置直线走过去是否通（调用方用碰撞盒判，含绕不过去的桌椅）。
   * 只判直线：B1 不做绕行寻路。
   */
  canReach: (from: { x: number; z: number }, to: { x: number; z: number }) => boolean;
  /** 本次落座停留时长（秒），由调用方按 seatId 哈希给，保证可复现。 */
  dwellSeconds: number;
  /** 本帧步长（秒）：seated 阶段用它递减停留时间。 */
  secondsPerTick: number;
}

export type SeatPhase = 'roaming' | 'approaching' | 'seated';

export interface SeatBehaviorState {
  phase: SeatPhase;
  seatId: string | null;
  /** 剩余落座时长（秒），仅 seated 阶段有意义。 */
  dwell: number;
  /** 本次会话已坐过的座位：同一把椅子不重复坐，避免一个人反复占同一处。 */
  used: string[];
}

export type SeatEvent =
  | { type: 'approach'; seat: SeatAnchor }
  | { type: 'sit'; seat: SeatAnchor }
  | { type: 'stand' };

export function createSeatBehavior(): SeatBehaviorState {
  return { phase: 'roaming', seatId: null, dwell: 0, used: [] };
}

/**
 * 最近的可坐座位：未坐过、没人占、直线能走到、且在 `maxDetourM` 内。
 * 距离相同按 id 字典序取，保证同一帧多人不会因为遍历顺序不同而换座。
 */
export function nearestSeat(
  position: { x: number; z: number },
  seats: readonly SeatAnchor[],
  isTaken: (seatId: string) => boolean,
  canReach: (from: { x: number; z: number }, to: { x: number; z: number }) => boolean,
  used: readonly string[],
  maxDetourM: number
): SeatAnchor | null {
  let best: SeatAnchor | null = null;
  let bestGap = maxDetourM;
  for (const seat of seats) {
    if (used.includes(seat.id) || isTaken(seat.id)) continue;
    const gap = Math.hypot(seat.approach.x - position.x, seat.approach.z - position.z);
    if (gap > bestGap) continue;
    if (!canReach(position, seat.approach)) continue;
    if (best && gap === bestGap && seat.id > best.id) continue;
    best = seat;
    bestGap = gap;
  }
  return best;
}

/**
 * 推进一帧决策。`arrived` 由调用方的 follower 判定（走到接近点附近），
 * 本模块不读坐标差——那样会和碰撞推挤后的真实落点打架。
 */
export function stepSeatBehavior(
  state: SeatBehaviorState,
  ctx: SeatBehaviorContext,
  arrived: boolean,
  config: SeatBehaviorConfig = DEFAULT_SEAT_BEHAVIOR
): SeatEvent[] {
  if (state.phase === 'roaming') {
    const seat = nearestSeat(
      ctx.position, ctx.seats, ctx.isTaken, ctx.canReach, state.used, config.maxDetourM
    );
    if (!seat) return [];
    state.phase = 'approaching';
    state.seatId = seat.id;
    return [{ type: 'approach', seat }];
  }

  if (state.phase === 'approaching') {
    if (!arrived) return [];
    const seat = ctx.seats.find((item) => item.id === state.seatId);
    // 座位在走过去的过程中被删了：回到游走态，别把人卡在 approaching。
    if (!seat) {
      state.phase = 'roaming';
      state.seatId = null;
      return [];
    }
    state.phase = 'seated';
    state.dwell = Math.max(0, ctx.dwellSeconds);
    return [{ type: 'sit', seat }];
  }

  // seated
  state.dwell = Math.max(0, state.dwell - ctx.secondsPerTick);
  if (state.dwell > 0) return [];
  const seatId = state.seatId;
  if (seatId && !state.used.includes(seatId)) state.used.push(seatId);
  state.phase = 'roaming';
  state.seatId = null;
  return [{ type: 'stand' }];
}

/**
 * 占座表：一人一座。键是座位 id，值是占用者 id。
 * 释放只按占用者 id 释放，调用方不需要记住座位——避免「起身时座位已被别人抢走」
 * 误释放别人的座。
 */
export function createSeatRegistry() {
  const owners = new Map<string, string>();
  return {
    claim(seatId: string, personId: string): boolean {
      const owner = owners.get(seatId);
      if (owner !== undefined && owner !== personId) return false;
      owners.set(seatId, personId);
      return true;
    },
    release(personId: string): void {
      for (const [seatId, owner] of owners) {
        if (owner === personId) owners.delete(seatId);
      }
    },
    isTaken(seatId: string): boolean {
      return owners.has(seatId);
    },
    holderOf(seatId: string): string | null {
      return owners.get(seatId) ?? null;
    },
    clear(): void {
      owners.clear();
    },
    size(): number {
      return owners.size;
    },
  };
}

/** 落座停留时长（秒）：按 seed + seatId 取 [min, max]，同一人同一椅永远同一个值。 */
export function seatDwellSeconds(
  seed: string,
  seatId: string,
  range: readonly [number, number] = [25, 70]
): number {
  let hash = 0;
  const text = `${seed}:${seatId}`;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  const [lo, hi] = range;
  return lo + ((hash % 1000) / 1000) * (hi - lo);
}
