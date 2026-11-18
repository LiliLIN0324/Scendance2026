import { describe, expect, it } from 'vitest';
import { planFacilitySchema } from '../../../../supabase/functions/_shared/site-plan';
import { planIndoorWalls, type IndoorWallZone } from './plan-indoor-walls';

/**
 * 2026-11-18 用户：窗台高/窗高不再固定 0.9/1.2，属性面板可改。
 * 这里守住两件事：契约能存这两个字段（旧数据不写也照常过），2D 数值原样变成 3D 洞口。
 */
const windowFacility = (extra: Record<string, unknown> = {}) => ({
  id: '2b9a1c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  templateId: 'oneplan:icon:window',
  name: '窗',
  position: { x: 5, y: 0 },
  rotationDeg: 0,
  size: { width: 1.2, depth: 0.12 },
  notes: '',
  ...extra,
});

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

describe('窗台/窗高字段（契约 + 开洞）', () => {
  it('不写这两个字段也照常通过（旧数据/默认 0.9 / 1.2）', () => {
    expect(planFacilitySchema.safeParse(windowFacility()).success).toBe(true);
  });

  it('写了就存下来，并原样进洞口', () => {
    const parsed = planFacilitySchema.parse(windowFacility({ windowSillM: 1.05, windowHeightM: 1.5 }));
    expect(parsed.windowSillM).toBeCloseTo(1.05, 10);
    expect(parsed.windowHeightM).toBeCloseTo(1.5, 10);

    const { walls } = planIndoorWalls([RECT], [], {
      windows: [{ id: parsed.id, center: { x: 5, z: 0 }, widthM: parsed.size.width, sillM: parsed.windowSillM, heightM: parsed.windowHeightM }],
    });
    const opening = walls.find(wall => wall.openings.length === 1)!.openings[0]!;
    expect(opening.bottomFromFloor).toBeCloseTo(1.05, 10);
    expect(opening.height).toBeCloseTo(1.5, 10);
  });

  it('超范围的值过不了契约（窗台 ≤3 m、窗高 0.2–3 m）', () => {
    expect(planFacilitySchema.safeParse(windowFacility({ windowSillM: 3.4 })).success).toBe(false);
    expect(planFacilitySchema.safeParse(windowFacility({ windowSillM: -0.1 })).success).toBe(false);
    expect(planFacilitySchema.safeParse(windowFacility({ windowHeightM: 0.1 })).success).toBe(false);
    expect(planFacilitySchema.safeParse(windowFacility({ windowHeightM: 3.2 })).success).toBe(false);
  });
});
