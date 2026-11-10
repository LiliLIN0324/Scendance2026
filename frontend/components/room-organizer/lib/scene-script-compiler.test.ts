import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { compileSceneScript } from './scene-script-compiler';
import { sceneScriptFromBrief, zonesWithRole, zoneRectOf, type SceneScriptVenue } from './scene-script';
import { itemInBounds } from './geometry';
import { isStructuralMarker } from './structural-layout';
import type { SceneScript } from '../../../../supabase/functions/_shared/scene-script-contract';
import type { FurnitureItem, RoomLayout } from './types';

const venue: SceneScriptVenue = { width: 12, depth: 9 };

const baseLayout = (items: FurnitureItem[] = []): RoomLayout =>
  makeLayout({ width: venue.width, height: venue.depth, floors: [makeFloor({ items })] });

/** Deterministic ids so two compiles can be compared field by field. */
const ids = (): (() => string) => {
  let n = 0;
  return () => `id-${(n += 1)}`;
};

const brief = (overrides: Partial<Parameters<typeof sceneScriptFromBrief>[0]> = {}): SceneScript =>
  sceneScriptFromBrief({ widthM: venue.width, depthM: venue.depth, guests: 24, stage: true, checkin: true, seed: 3, ...overrides });

const finalItems = (layout: RoomLayout, floorIndex = 0): FurnitureItem[] => layout.floors[floorIndex]?.items ?? [];

const script = (overrides: Partial<SceneScript> = {}): SceneScript => ({
  version: 1,
  seed: 3,
  layoutMode: 'dining',
  zones: [{ role: 'seating', rect: { x: -5.3, z: -3.8, w: 10.6, d: 7.6 } }],
  constraints: { aisleMinM: 1.2, wallGapM: 0.35 },
  ...overrides,
});

describe('compileSceneScript — 简报落地成可拖的一版', () => {
  it('发布会 12 × 9 / 24 人：舞台与签到都在，先只出候选，不碰画布', () => {
    const base = baseLayout();
    const result = compileSceneScript(brief(), { base, floorIndex: 0, makeId: ids() });
    const final = result.layouts[result.layouts.length - 1]!;
    const types = finalItems(final).map((item) => item.type);
    expect(result.blocked).toBeNull();
    expect(result.added).toBeGreaterThan(0);
    expect(types).toContain('backdrop');
    expect(types).toContain('counter');
    expect(result.seats).toBeGreaterThanOrEqual(4);
    // 纯函数：底座一个字节都没被改。
    expect(base.floors[0]?.items).toHaveLength(0);
    expect(result.layouts.length).toBeGreaterThan(3);
  });

  it('落下来的东西都在场地里，且彼此不压着', () => {
    const result = compileSceneScript(brief({ guests: 40 }), { base: baseLayout(), floorIndex: 0, makeId: ids() });
    const items = finalItems(result.layouts[result.layouts.length - 1]!);
    for (const item of items) {
      if (isStructuralMarker(item)) continue;
      expect(itemInBounds(item, venue.width, venue.depth)).toBe(true);
    }
    expect(result.overlapCount).toBe(0);
  });

  it('通道区里一件物料都不许站：它只负责挖出那条路', () => {
    const scripted = brief();
    const result = compileSceneScript(scripted, { base: baseLayout(), floorIndex: 0, makeId: ids() });
    const aisles = zonesWithRole(scripted, 'aisle').map(zoneRectOf);
    for (const item of finalItems(result.layouts[result.layouts.length - 1]!)) {
      if (isStructuralMarker(item) || !item.position) continue;
      for (const aisle of aisles) {
        const inside = item.position.x > aisle.x && item.position.x < aisle.x + aisle.w && item.position.z > aisle.z && item.position.z < aisle.z + aisle.d;
        expect(inside).toBe(false);
      }
    }
  });

  it('桌椅横不下就转 90°：12 × 9 的座位区排 4 组，而不是 3 组', () => {
    const result = compileSceneScript(brief({ guests: 24 }), { base: baseLayout(), floorIndex: 0, makeId: ids() });
    const tables = finalItems(result.layouts[result.layouts.length - 1]!).filter((item) => item.type === 'dining-table');
    expect(tables.length).toBeGreaterThanOrEqual(4);
    expect(result.seats).toBeGreaterThanOrEqual(16);
    expect(result.overlapCount).toBe(0);
  });

  it('同一份脚本 + 同一个 seed 编译两次，位置逐个相同（预览与落盘才对得上）', () => {    const first = compileSceneScript(brief(), { base: baseLayout(), floorIndex: 0, makeId: ids() });
    const second = compileSceneScript(brief(), { base: baseLayout(), floorIndex: 0, makeId: ids() });
    const positions = (result: typeof first) =>
      finalItems(result.layouts[result.layouts.length - 1]!).map((item) => [item.type, item.position?.x, item.position?.z, item.rotation]);
    expect(positions(first)).toEqual(positions(second));
  });

  it('锁着的物料一件不撤，提案里报出件数', () => {
    const locked = makeItem({ id: 'locked-1', type: 'chair', name: 'Locked chair', position: { x: 4.5, z: 3.6 }, locked: true });
    const result = compileSceneScript(brief(), { base: baseLayout([locked]), floorIndex: 0, makeId: ids() });
    expect(result.keptLocked).toBe(1);
    expect(finalItems(result.layouts[result.layouts.length - 1]!).some((item) => item.id === 'locked-1')).toBe(true);
  });

  it('旧的未锁物料被清掉，清掉的件数要报，不能偷偷撤', () => {
    const loose = makeItem({ id: 'loose-1', type: 'chair', name: 'Loose chair', position: { x: -4, z: 2 } });
    const result = compileSceneScript(brief(), { base: baseLayout([loose]), floorIndex: 0, makeId: ids() });
    expect(result.removing).toBe(1);
    expect(finalItems(result.layouts[result.layouts.length - 1]!).some((item) => item.id === 'loose-1')).toBe(false);
  });

  it('围坐用环形圆桌，椅子不排成正方四角', () => {
    const result = compileSceneScript(script({ guests: 12 }), { base: baseLayout(), floorIndex: 0, makeId: ids(), seatingShape: 'ring' });
    const items = finalItems(result.layouts[result.layouts.length - 1]!);
    const chairs = items.filter(item => item.type === 'dining-chair' && item.name === '餐椅');
    expect(chairs.length).toBeGreaterThanOrEqual(6);
    const table = items.find(item => item.type === 'dining-table' && item.name === '圆桌');
    expect(table?.position).toBeTruthy();
    const distances = chairs.map(item => Math.hypot((item.position?.x ?? 0) - (table!.position?.x ?? 0), (item.position?.z ?? 0) - (table!.position?.z ?? 0)));
    const closest = Math.min(...distances);
    const radii = distances.filter(distance => Math.abs(distance - closest) < 0.08);
    expect(radii.length).toBeGreaterThanOrEqual(6);
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.08);
  });
});

describe('compileSceneScript — 脚本不成立时先说清，不硬建', () => {
  it('两块可建区压在一起：blocked 报原因，layouts 原地退回，added 为 0', () => {
    const overlapping = script({
      zones: [
        { role: 'stage', rect: { x: -5, z: -4, w: 10, d: 2 } },
        { role: 'seating', rect: { x: -5, z: -3, w: 10, d: 6 } },
      ],
    });
    const base = baseLayout();
    const result = compileSceneScript(overlapping, { base, floorIndex: 0, makeId: ids() });
    expect(result.blocked).not.toBeNull();
    expect(result.added).toBe(0);
    expect(result.layouts).toHaveLength(1);
    expect(result.refusals[0]?.code).toBe('E_FINAL_GEOMETRY');
  });

  it('座位区窄到放不下一组：给出 E_ROLE_UNFIT，而不是摆一半', () => {
    const tooSmall = script({ zones: [{ role: 'seating', rect: { x: -0.4, z: -0.4, w: 0.8, d: 0.8 }, count: 8 }] });
    const result = compileSceneScript(tooSmall, { base: baseLayout(), floorIndex: 0, makeId: ids() });
    expect(result.seats).toBe(0);
    expect(result.refusals.some((entry) => entry.code === 'E_ROLE_UNFIT')).toBe(true);
  });

  it('人比座位多时要报 W_CAPACITY，不假装摆满了', () => {
    const tiny = script({ guests: 80, zones: [{ role: 'seating', rect: { x: -5.3, z: -3.8, w: 3.2, d: 3.2 } }] });
    const result = compileSceneScript(tiny, { base: baseLayout(), floorIndex: 0, makeId: ids() });
    expect(result.seats).toBeLessThan(80);
    expect(result.issues.some((entry) => entry.code === 'W_CAPACITY')).toBe(true);
  });
});

describe('compileSceneScript — 定点收束：摆不进就少摆，不原地打转', () => {
  it('一组被锁着的物料顶住时，减一组重来，最终收敛', () => {
    // 先摆一份 12 × 9 的座位区，量出一组桌椅的中心，再把锁着的柜子放上去顶死它。
    const probe = compileSceneScript(script({ guests: 8 }), { base: baseLayout(), floorIndex: 0, makeId: ids() });
    const tables = finalItems(probe.layouts[probe.layouts.length - 1]!).filter((item) => item.type === 'dining-table');
    expect(tables.length).toBeGreaterThan(0);
    const blocked = { ...tables[0]!, id: 'blocker', type: 'wardrobe', name: 'Blocker', width: 1.4, depth: 0.6, height: 2, locked: true };
    const result = compileSceneScript(script({ guests: 16 }), { base: baseLayout([blocked]), floorIndex: 0, makeId: ids() });
    expect(result.settled.passes).toBeGreaterThanOrEqual(1);
    expect(result.settled.converged).toBe(true);
    expect(result.blocked).toBeNull();
  });
});
