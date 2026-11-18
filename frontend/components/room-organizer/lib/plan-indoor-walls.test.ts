import { describe, expect, it } from 'vitest';
import {
  DOOR_ON_WALL_TOLERANCE_M,
  INDOOR_DOOR_HEIGHT_M,
  INDOOR_WALL_HEIGHT_M,
  isDoorTemplateId,
  planIndoorWalls,
  type IndoorWallDoor,
  type IndoorWallZone,
} from './plan-indoor-walls';

/**
 * 2026-11-18 用户口径：
 * 「3D 视角里室内分区边缘向上挤出 3.5m 的墙，画了门就在对应位置开 2m 的门。」
 * 四条当天拍板：实心墙挡室内可接受 / 门比边宽就拒绝开洞 / 没吸到边的门不开洞 / 门高先 2m。
 */

/** 10 × 8 m 的室内分区，壳体米制（与 3D 地面色块同一份点）。 */
const RECT: IndoorWallZone = {
  id: 'zone-indoor',
  environment: 'indoor',
  points: [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 8 },
    { x: 0, z: 8 },
  ],
};

const door = (overrides: Partial<IndoorWallDoor> = {}): IndoorWallDoor => ({
  id: 'door-1',
  center: { x: 5, z: 0 },
  widthM: 1.2,
  ...overrides,
});

describe('planIndoorWalls（室内分区立墙）', () => {
  it('室内分区四条边各立一段墙，长度按边算', () => {
    const { walls } = planIndoorWalls([RECT], []);
    expect(walls).toHaveLength(4);
    expect(walls.map(wall => wall.length)).toEqual([10, 8, 10, 8]);
    for (const wall of walls) expect(wall.openings).toHaveLength(0);
  });

  it('室外 / 未知 / 未标环境的分区不立墙（墙体只在室内语义下成立）', () => {
    const outdoor: IndoorWallZone = { ...RECT, id: 'zone-out', environment: 'outdoor' };
    const unknown: IndoorWallZone = { ...RECT, id: 'zone-unk', environment: 'unknown' };
    const unset: IndoorWallZone = { id: 'zone-none', points: RECT.points };
    expect(planIndoorWalls([outdoor, unknown, unset], []).walls).toHaveLength(0);
    expect(planIndoorWalls([outdoor, RECT], []).walls).toHaveLength(4);
  });

  it('吸附在边线中点的门，在墙上开 2 m 高的洞口，洞口居中', () => {
    const { walls, refusals } = planIndoorWalls([RECT], [door()]);
    expect(refusals).toHaveLength(0);
    const wall = walls.find(item => item.openings.length === 1)!;
    expect(wall.length).toBe(10);
    expect(wall.openings[0]).toEqual({
      doorId: 'door-1',
      centerAlongWall: 0,
      width: 1.2,
      height: 2,
    });
    expect(wall.openings[0]!.height).toBe(INDOOR_DOOR_HEIGHT_M);
  });

  it('门心离边线超过 3 cm 就当自由摆放：不开洞', () => {
    const free = planIndoorWalls([RECT], [door({ center: { x: 5, z: 0.5 } })]);
    expect(free.walls.every(wall => wall.openings.length === 0)).toBe(true);
    expect(free.refusals).toHaveLength(0);

    const onLine = planIndoorWalls([RECT], [
      door({ center: { x: 5, z: DOOR_ON_WALL_TOLERANCE_M * 0.5 } }),
    ]);
    expect(onLine.walls.some(wall => wall.openings.length === 1)).toBe(true);
  });

  it('门连两侧墙垛都放不下时拒绝开洞，墙保持完整（不缩门凑合）', () => {
    // 卷帘门 3 m 放得下 8 m 的边；12 m 放不下任何一边。
    const { walls, refusals } = planIndoorWalls([RECT], [door({ widthM: 12 })]);
    expect(walls.every(wall => wall.openings.length === 0)).toBe(true);
    expect(refusals).toEqual([
      {
        doorId: 'door-1',
        zoneId: 'zone-indoor',
        wallLength: 10,
        doorWidth: 12,
        reason: 'door-wider-than-wall',
      },
    ]);
  });

  it('短边刚好放下时不拒绝（留墙垛的临界值按 0.08 m 算）', () => {
    // 8 m 的东边：门宽 7.84 + 两侧 0.16 墙垛正好占满；再多 1 cm 就拒绝。
    const fits = planIndoorWalls([RECT], [door({ center: { x: 10, z: 4 }, widthM: 8 - 0.16 })]);
    expect(fits.refusals).toHaveLength(0);
    const tooWide = planIndoorWalls([RECT], [door({ center: { x: 10, z: 4 }, widthM: 8 - 0.15 })]);
    expect(tooWide.refusals).toHaveLength(1);
  });

  it('同一面墙两扇门各开一洞，并按从 a 到 b 排序', () => {
    const { walls } = planIndoorWalls([RECT], [
      door({ id: 'right', center: { x: 8, z: 0 } }),
      door({ id: 'left', center: { x: 2, z: 0 } }),
    ]);
    const wall = walls.find(item => item.openings.length === 2)!;
    expect(wall.openings.map(opening => opening.doorId)).toEqual(['left', 'right']);
    expect(wall.openings[0]!.centerAlongWall).toBeLessThan(wall.openings[1]!.centerAlongWall);
  });

  it('门吸在角上时洞口被夹进墙内，两端仍留墙垛', () => {
    const { walls } = planIndoorWalls([RECT], [door({ center: { x: 0, z: 0 } })]);
    const wall = walls.find(item => item.openings.length === 1)!;
    const opening = wall.openings[0]!;
    const half = wall.length / 2;
    expect(opening.centerAlongWall - opening.width / 2).toBeGreaterThan(-half);
    expect(opening.centerAlongWall + opening.width / 2).toBeLessThan(half);
    // 角点被夹到「墙垛 + 半个门宽」的位置，而不是把洞口切掉一半。
    expect(opening.centerAlongWall).toBeCloseTo(-(half - 0.08 - opening.width / 2), 6);
  });

  it('退化环（少于 3 点 / 零长边）不立墙', () => {
    const line: IndoorWallZone = { ...RECT, points: [{ x: 0, z: 0 }, { x: 10, z: 0 }] };
    const duplicated: IndoorWallZone = {
      ...RECT,
      points: [
        { x: 0, z: 0 },
        { x: 0, z: 0 },
        { x: 2, z: 0 },
        { x: 2, z: 0 },
        { x: 2, z: 2 },
      ],
    };
    expect(planIndoorWalls([line], []).walls).toHaveLength(0);
    expect(planIndoorWalls([duplicated], []).walls.map(wall => wall.length)).toEqual([
      2,
      2,
      Math.hypot(2, 2),
    ]);
  });

  it('墙高与厚度是用户口径的常量', () => {
    expect(INDOOR_WALL_HEIGHT_M).toBe(3.5);
  });
});

describe('isDoorTemplateId（和 2D 吸附同一份门图标口径）', () => {
  it.each([
    'door',
    'icon:door',
    'library:icon:door',
    'icon:double-door',
    'icon:sliding-door',
    'icon:revolving-door',
    'icon:roller-shutter',
    'icon:folding-door',
  ])('%s 是门', templateId => {
    expect(isDoorTemplateId(templateId)).toBe(true);
  });

  it.each(['tent-3x3', 'booth-2x2', 'icon:gate-open', 'door-frame-x', 'turnstile-gate'])(
    '%s 不是门',
    templateId => {
      expect(isDoorTemplateId(templateId)).toBe(false);
    },
  );
});
