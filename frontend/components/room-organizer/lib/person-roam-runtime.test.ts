import { describe, expect, it } from 'vitest';
import { RoamRuntime } from './person-roam-runtime';
import type { RoamSeat, RoamZone } from './person-roam';

const SQUARE: RoamZone = {
  id: 'site',
  polygon: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ],
};

const SEATS: RoamSeat[] = [
  { id: 's1', x: 3, y: 3, rotationDeg: 0, zoneId: 'site' },
  { id: 's2', x: 8, y: 8, rotationDeg: 0, zoneId: 'site' },
];

function runtime(overrides: Partial<ConstructorParameters<typeof RoamRuntime>[0]> = {}) {
  return new RoamRuntime({
    seats: SEATS,
    zones: [SQUARE],
    seatDwellMs: 1000,
    wanderBudgetMs: 60_000,
    seed: 7,
    ...overrides,
  });
}

describe('人物漫游执行器（A/B/C 接线）', () => {
  it('注册后在分区里会给出走位指令，按步速推进而不是瞬移', () => {
    const roam = runtime();
    roam.register('p1', { x: 10, y: 10 }, false);
    let walked = 0;
    for (let frame = 0; frame < 600; frame += 1) {
      for (const command of roam.tick(16)) {
        if (command.kind === 'walk') walked += 1;
      }
    }
    expect(walked).toBeGreaterThan(10);
  });

  it('同一把椅子不会被两个人同时占住', () => {
    const roam = runtime();
    roam.register('p1', { x: 3, y: 3 }, false);
    roam.register('p2', { x: 3, y: 3 }, false);
    const current = new Map<string, string>(); // seatId -> personId
    let conflicts = 0;
    for (let frame = 0; frame < 2000; frame += 1) {
      for (const command of roam.tick(16)) {
        if (command.kind === 'sit') {
          const occupant = current.get(command.seatId);
          if (occupant && occupant !== command.id) conflicts += 1;
          current.set(command.seatId, command.id);
          roam.confirmSeated(command.id, command.seatId);
        }
        if (command.kind === 'stand') {
          if (current.get(command.seatId) === command.id) current.delete(command.seatId);
        }
      }
    }
    expect(conflicts).toBe(0);
    expect(current.size).toBeLessThanOrEqual(SEATS.length);
  });

  it('坐够时间会起身并释放座位', () => {
    const roam = runtime({ seatDwellMs: 500 });
    roam.register('p1', { x: 3, y: 3 }, false);
    let sat: string | null = null;
    let stood: string | null = null;
    for (let frame = 0; frame < 4000 && !stood; frame += 1) {
      for (const command of roam.tick(16)) {
        if (command.kind === 'sit' && !sat) {
          sat = command.seatId;
          roam.confirmSeated('p1', command.seatId);
        }
        if (command.kind === 'stand') stood = command.seatId;
      }
    }
    expect(sat).toBeTruthy();
    expect(stood).toBe(sat);
    expect(roam.seatHolder(sat!)).toBeUndefined();
  });

  it('注销时释放自己占的座位', () => {
    const roam = runtime();
    roam.register('p1', { x: 3, y: 3 }, false);
    let seatId: string | null = null;
    for (let frame = 0; frame < 4000 && !seatId; frame += 1) {
      for (const command of roam.tick(16)) {
        if (command.kind === 'sit') {
          seatId = command.seatId;
          roam.confirmSeated('p1', command.seatId);
        }
      }
    }
    expect(seatId).toBeTruthy();
    expect(roam.seatHolder(seatId!)).toBe('p1');
    roam.unregister('p1');
    expect(roam.seatHolder(seatId!)).toBeUndefined();
  });

  it('没有分区、也没有流线的人保持待机，不乱走', () => {
    const roam = runtime({ zones: [] });
    roam.register('p1', { x: 5, y: 5 }, false);
    const commands = [];
    for (let frame = 0; frame < 200; frame += 1) commands.push(...roam.tick(16));
    expect(commands.some(command => command.kind === 'walk')).toBe(false);
  });
});

