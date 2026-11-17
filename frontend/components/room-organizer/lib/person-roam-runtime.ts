/**
 * 人物漫游执行器（2026-11-17，A/B/C 接线层）。
 *
 * 分工：`person-roam.planRoamStep` 只回答「下一步干什么」，本模块负责把决策
 * 变成可执行的时间线（谁在走、走到哪、坐多久、什么时候回路线），并且只碰
 * 规划坐标系（ENU 米），不碰 three / React —— 这样能单测，场景层只做位姿写入。
 *
 * 场景层（outdoor-plan-3d）每帧：
 *   1. `tick(dtMs)` 拿 `RoamCommand[]`；
 *   2. `walk`：group.position 写到 `enuToWorld(x, y)`；
 *   3. `sit`：takePersonControl(...).setSeated(true, seatHeight)；
 *   4. `stand` / `rejoin`：setSeated(false)，release() 让路线接管。
 */

import {
  SeatClaims,
  nearestFreeSeat,
  planRoamStep,
  type RoamDecision,
  type RoamPoint,
  type RoamSeat,
  type RoamZone,
} from './person-roam';

/** 人走路速度（米/秒），与 `PERSON_WALK_SPEED_MPS` 同量级，取略慢的漫游步速。 */
const WALK_SPEED_MPS = 1.0;

/** 到点判定半径（米）。 */
const ARRIVE_M = 0.25;

export type RoamCommand =
  | { kind: 'walk'; id: string; x: number; y: number }
  | { kind: 'sit'; id: string; seatId: string; x: number; y: number; seatHeight: number }
  | { kind: 'stand'; id: string; seatId: string }
  | { kind: 'rejoin'; id: string }
  | { kind: 'idle'; id: string };

interface RuntimePerson {
  id: string;
  position: RoamPoint;
  mode: 'route' | 'wander' | 'approach-seat' | 'seated' | 'idle';
  target: RoamPoint | null;
  seatId: string | null;
  seatedForMs: number;
  /** 已经在分区里逛了多久，用来收敛「逛一会儿就回路线」。 */
  wanderedForMs: number;
  /** 下一次重新决策的倒计时（ms）：决策不能每帧抽签。 */
  decisionInMs: number;
  zone: RoamZone | null;
  onRoute: boolean;
}

export interface RoamRuntimeOptions {
  seats: readonly RoamSeat[];
  /** 分区多边形（ENU）。空数组 = 只在路线上走。 */
  zones?: readonly RoamZone[];
  /** 每人进入分区后逛多久回路线（ms），默认 45 s。 */
  wanderBudgetMs?: number;
  /** 坐多久（ms），默认 40 s。 */
  seatDwellMs?: number;
  /** 判定「走出分区」的采样间隔，默认 1 s。 */
  seed?: number;
  /** 座位面高（米）；默认 0.45。 */
  seatHeight?: (seatId: string) => number;
}

/** 座位高（米）由调用方给；执行器只透传。 */
export type SeatHeightLookup = (seatId: string) => number;

/**
 * 多人物共用的执行器：一张座位占用表 + 每人一条状态。
 * 不是 React state：由场景层持有实例，rAF 里 tick。
 */
export class RoamRuntime {
  private readonly people = new Map<string, RuntimePerson>();
  private readonly claims = new SeatClaims();
  private readonly seats: readonly RoamSeat[];
  private readonly zones: readonly RoamZone[];
  private readonly wanderBudgetMs: number;
  private readonly seatDwellMs: number;
  private readonly seatHeight: (seatId: string) => number;
  private rngState: number;

  constructor(options: RoamRuntimeOptions) {
    this.seats = options.seats;
    this.zones = options.zones ?? [];
    this.wanderBudgetMs = options.wanderBudgetMs ?? 45_000;
    this.seatDwellMs = options.seatDwellMs ?? 40_000;
    this.seatHeight = options.seatHeight ?? (() => 0.45);
    this.rngState = (options.seed ?? 0x9e3779b9) >>> 0;
  }

  /** 线性同余：固定种子下决策可复现，便于回放与单测。 */
  private rng = (): number => {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 0xffffffff;
  };

  register(id: string, start: RoamPoint, onRoute: boolean): void {
    this.people.set(id, {
      id,
      position: { ...start },
      mode: onRoute ? 'route' : 'idle',
      target: null,
      seatId: null,
      seatedForMs: 0,
      wanderedForMs: 0,
      decisionInMs: 500 + this.rng() * 1500,
      zone: null,
      onRoute,
    });
  }

  unregister(id: string): void {
    this.claims.releasePerson(id);
    this.people.delete(id);
  }

  /** 外部（拖动 / 重建）同步真实位置，避免执行器与场景漂移。 */
  syncPosition(id: string, position: RoamPoint): void {
    const person = this.people.get(id);
    if (person) person.position = { ...position };
  }

  /** 坐下确认：场景层真的播上坐姿后再调，避免「座位被占但人没坐」。 */
  confirmSeated(id: string, seatId: string): void {
    const person = this.people.get(id);
    if (!person) return;
    person.mode = 'seated';
    person.seatId = seatId;
    person.seatedForMs = 0;
  }

  seatHolder(seatId: string): string | undefined {
    return this.claims.holder(seatId);
  }

  /** 推进一帧，返回需要场景层执行的动作。 */
  tick(deltaMs: number): RoamCommand[] {
    if (!(deltaMs > 0)) return [];
    const commands: RoamCommand[] = [];
    for (const person of this.people.values()) {
      if (person.mode === 'seated') {
        person.seatedForMs += deltaMs;
        if (person.seatId) this.claims.claim(person.seatId, person.id);
        const decision = planRoamStep({
          personId: person.id,
          position: person.position,
          mode: 'seated',
          zone: person.zone,
          onRoute: person.onRoute,
          seats: this.seats,
          claims: this.claims,
          rng: this.rng,
          seatDwellMs: this.seatDwellMs,
          seatedForMs: person.seatedForMs,
        });
        if (decision.kind === 'stand-up') {
          this.claims.release(decision.seatId, person.id);
          person.seatId = null;
          person.mode = person.onRoute ? 'route' : 'idle';
          person.seatedForMs = 0;
          commands.push({ kind: 'stand', id: person.id, seatId: decision.seatId });
        }
        continue;
      }

      if (person.mode === 'approach-seat') {
        if (person.target) {
          const arrived = this.step(person, person.target, deltaMs);
          commands.push({ kind: 'walk', id: person.id, x: person.position.x, y: person.position.y });
          if (arrived && person.seatId) {
            commands.push({
              kind: 'sit',
              id: person.id,
              seatId: person.seatId,
              x: person.position.x,
              y: person.position.y,
              seatHeight: this.seatHeight(person.seatId),
            });
            person.mode = 'seated';
            person.seatedForMs = 0;
            this.claims.claim(person.seatId, person.id);
          }
        }
        continue;
      }

      // 走完一段：到点就重新决策；决策计时器不受「正在走」影响。
      person.decisionInMs -= deltaMs;
      if (person.target) {
        const arrived = this.step(person, person.target, deltaMs);
        if (!arrived) {
          commands.push({ kind: 'walk', id: person.id, x: person.position.x, y: person.position.y });
          continue;
        }
        person.target = null;
        person.decisionInMs = 0;
      }

      if (person.mode === 'wander') {
        person.wanderedForMs += deltaMs;
        if (person.wanderedForMs > this.wanderBudgetMs) {
          person.mode = person.onRoute ? 'route' : 'idle';
          person.wanderedForMs = 0;
          if (person.onRoute) commands.push({ kind: 'rejoin', id: person.id });
          continue;
        }
      }

      // 每 2 s 才重新决策一次，避免每帧抽签导致抖动。
      if (person.decisionInMs > 0) continue;
      person.decisionInMs = person.mode === 'route' ? 3000 : 2000;

      const zone = person.zone ?? (this.zones.length === 1 ? this.zones[0]! : null);
      person.zone = zone;
      // C：看见椅子就坐 —— 2 m 内的空座直接占，不靠 35% 抽签（否则人从椅边走过去都不坐）。
      if (zone) {
        const nearby = nearestFreeSeat(person.position, this.seats, this.claims, {
          maxDistanceM: 2,
          zoneId: zone.id,
        });
        if (nearby && this.claims.claim(nearby.id, person.id)) {
          person.mode = 'approach-seat';
          person.seatId = nearby.id;
          person.target = { x: nearby.x, y: nearby.y };
          continue;
        }
      }
      const decision: RoamDecision = planRoamStep({
        personId: person.id,
        position: person.position,
        mode: person.mode === 'idle' ? 'wander' : person.mode,
        zone,
        onRoute: person.onRoute,
        seats: this.seats,
        claims: this.claims,
        rng: this.rng,
        seatDwellMs: this.seatDwellMs,
      });
      this.apply(person, decision, commands);
    }
    return commands;
  }

  private apply(person: RuntimePerson, decision: RoamDecision, commands: RoamCommand[]): void {
    if (decision.kind === 'approach-seat') {
      person.mode = 'approach-seat';
      person.seatId = decision.seat.id;
      person.target = { x: decision.seat.x, y: decision.seat.y };
      return;
    }
    if (decision.kind === 'wander') {
      person.mode = 'wander';
      person.target = decision.target;
      return;
    }
    if (decision.kind === 'rejoin-route') {
      person.mode = 'route';
      commands.push({ kind: 'rejoin', id: person.id });
      return;
    }
    if (decision.kind === 'idle') {
      person.mode = 'idle';
      commands.push({ kind: 'idle', id: person.id });
    }
    // stay：什么都不发，保持当前位姿。
  }

  /** 朝目标走一步；返回是否到点。 */
  private step(person: RuntimePerson, target: RoamPoint, deltaMs: number): boolean {
    const dx = target.x - person.position.x;
    const dy = target.y - person.position.y;
    const distance = Math.hypot(dx, dy);
    const stepLength = (WALK_SPEED_MPS * deltaMs) / 1000;
    if (distance <= Math.max(ARRIVE_M, stepLength)) {
      person.position = { x: target.x, y: target.y };
      return true;
    }
    person.position = {
      x: person.position.x + (dx / distance) * stepLength,
      y: person.position.y + (dy / distance) * stepLength,
    };
    return false;
  }
}
