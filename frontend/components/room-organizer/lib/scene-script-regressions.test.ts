import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { DIAGNOSTIC_REASON, describeDiagnostics } from './diagnostics';
import { compileSceneScript } from './scene-script-compiler';
import { localPlan } from './local-plan';
import { describeSceneScript, normalizeSceneScript, parseSceneScript, sceneScriptFromBrief } from './scene-script';
import { outcomeLines, outcomeOfPlan } from './run-outcome';
import { isStructuralMarker } from './structural-layout';
import type { SceneScript } from '../../../../supabase/functions/_shared/scene-script-contract';
import type { FurnitureItem, RoomLayout } from './types';

/**
 * Regressions from the adversarial review (`scene-script-code-review-2026-11-01.md`).
 * Each case is one P0/P1/P2 finding; if one of these goes red, the bug is back.
 */

const mk = (width = 12, depth = 9, items: FurnitureItem[] = []): RoomLayout =>
  makeLayout({ width, height: depth, floors: [makeFloor({ items })] });

const ids = (): (() => string) => {
  let n = 0;
  return () => `id-${(n += 1)}`;
};

const script = (overrides: Partial<SceneScript> = {}): SceneScript => ({
  version: 1,
  seed: 3,
  layoutMode: 'dining',
  zones: [{ role: 'seating', rect: { x: -5.3, z: -3.8, w: 10.6, d: 7.6 } }],
  constraints: { aisleMinM: 1.2, wallGapM: 0.35 },
  ...overrides,
});

const brief = (overrides: Partial<Parameters<typeof sceneScriptFromBrief>[0]> = {}): SceneScript =>
  sceneScriptFromBrief({ widthM: 12, depthM: 9, guests: 24, stage: true, checkin: true, seed: 3, ...overrides });

const last = (layout: RoomLayout): FurnitureItem[] => layout.floors[0]?.items ?? [];
const lastOf = (result: { layouts: RoomLayout[] }): FurnitureItem[] => last(result.layouts[result.layouts.length - 1]!);

describe('P0-1 旋转版式：椅子必须朝向自己那张桌子', () => {
  it('12 × 9 / 24 人（走旋转版式）每把椅子都面向最近的桌子', () => {
    const result = compileSceneScript(brief(), { base: mk(), floorIndex: 0, makeId: ids() });
    const items = lastOf(result);
    const tables = items.filter((item) => item.type === 'dining-table');
    const chairs = items.filter((item) => item.type === 'dining-chair');
    expect(tables.length).toBeGreaterThan(0);
    expect(chairs.length).toBeGreaterThan(0);
    for (const chair of chairs) {
      const nearest = tables.reduce((best, table) => {
        const distance = Math.hypot((table.position?.x ?? 0) - (chair.position?.x ?? 0), (table.position?.z ?? 0) - (chair.position?.z ?? 0));
        return distance < best.distance ? { table, distance } : best;
      }, { table: tables[0]!, distance: Infinity });
      const dx = (nearest.table.position?.x ?? 0) - (chair.position?.x ?? 0);
      const dz = (nearest.table.position?.z ?? 0) - (chair.position?.z ?? 0);
      const length = Math.hypot(dx, dz);
      // 这个仓库的朝向约定：facing = (sin θ, cos θ)
      const facing = [Math.sin(chair.rotation ?? 0), Math.cos(chair.rotation ?? 0)];
      expect((dx * facing[0]! + dz * facing[1]!) / length).toBeGreaterThan(0);
    }
  });
});

describe('P1-1 一组都装不下的场地：不许报假容量', () => {
  it.each([[2, 9], [2.5, 9], [3, 9]])('%s × %s m：容量 0、座位 0、原因说得出来', (widthM, depthM) => {
    const derived = sceneScriptFromBrief({ widthM, depthM, guests: 20, stage: false, checkin: false, seed: 1 });
    const result = compileSceneScript(derived, { base: mk(widthM, depthM), floorIndex: 0, makeId: ids() });
    expect(result.seats).toBe(0);
    expect(result.capacity).toBe(0);
    expect(result.refusals.length).toBeGreaterThan(0);
    const capacityLine = result.issues.find((entry) => entry.code === 'W_CAPACITY');
    expect(capacityLine?.message).not.toMatch(/最多 \d+ 座/);
    expect(result.dropped).toBeLessThanOrEqual(20);
  });
});

describe('P1-2 账本单位：ops 的件数与 added 对得上，重试不重复计数', () => {
  it('正常 12 × 9 / 24 人：placed 合计 = added', () => {
    const result = compileSceneScript(brief(), { base: mk(), floorIndex: 0, makeId: ids() });
    const placed = result.ops.reduce((sum, op) => sum + op.placed, 0);
    expect(placed).toBe(result.added);
  });

  it('锁定衣柜顶掉一格但座位仍然够：不许报"放不下"', () => {
    const probe = compileSceneScript(script({ guests: 8 }), { base: mk(), floorIndex: 0, makeId: ids() });
    const table = lastOf(probe).find((item) => item.type === 'dining-table')!;
    const blocker: FurnitureItem = { ...table, id: 'blocker', type: 'wardrobe', name: 'Blocker', width: 1.4, depth: 0.6, height: 2, locked: true };
    const result = compileSceneScript(script({ guests: 16 }), { base: mk(12, 9, [blocker]), floorIndex: 0, makeId: ids() });
    expect(result.seats).toBe(16);
    expect(result.settled.converged).toBe(true);
    expect(result.dropped).toBe(0);
  });
});

describe('P1-3 加座：真的要重排，不是同一个方案再发一遍', () => {
  it('座位区还剩空位时，加座版把空位补满', () => {
    const plain = localPlan({ base: mk(), floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 24, stage: false, checkin: false });
    const priority = localPlan({ base: mk(), floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 24, stage: false, checkin: false, seatPriority: true });
    expect(plain.seats).toBe(24);
    expect(priority.seats ?? 0).toBeGreaterThan(plain.seats ?? 0);
    expect(priority.guests).toBe(24);
  });
});

describe('P1-4 容量不把永久占死的格子算进去', () => {
  it('锁定衣柜占掉一格后，容量等于真实可达座位数', () => {
    const probe = compileSceneScript(script({ guests: 8 }), { base: mk(), floorIndex: 0, makeId: ids() });
    const table = lastOf(probe).find((item) => item.type === 'dining-table')!;
    const blocker: FurnitureItem = { ...table, id: 'blocker', type: 'wardrobe', name: 'Blocker', width: 1.4, depth: 0.6, height: 2, locked: true };
    const result = compileSceneScript(script({ guests: 24 }), { base: mk(12, 9, [blocker]), floorIndex: 0, makeId: ids() });
    expect(result.capacity).toBeLessThan(24);
    expect(result.capacity).toBe(result.seats);
  });
});

describe('P2 语义一致性', () => {
  it('全被挡住时 refusals 不是空的', () => {
    const slab = makeItem({ id: 'slab', type: 'wardrobe', name: 'Slab', width: 10.4, depth: 7.4, height: 2, position: { x: 0, z: 0 }, locked: true });
    const result = compileSceneScript(script({ guests: 16 }), { base: mk(12, 9, [slab]), floorIndex: 0, makeId: ids() });
    expect(result.seats).toBe(0);
    expect(result.refusals.length).toBeGreaterThan(0);
  });

  it('标准 brief 不再自带假的 E_ZONE_OUTSIDE', () => {
    const result = compileSceneScript(brief(), { base: mk(), floorIndex: 0, makeId: ids() });
    expect(result.issues.filter((entry) => entry.code === 'E_ZONE_OUTSIDE')).toHaveLength(0);
  });

  it('两块舞台就建两块，警告文案也说"每块都会建"', () => {
    const twoStages = script({
      zones: [
        { role: 'stage', rect: { x: -5.6, z: -4.4, w: 4.8, d: 1.4 } },
        { role: 'stage', rect: { x: -0.4, z: -4.4, w: 4.8, d: 1.4 } },
      ],
    });
    const result = compileSceneScript(twoStages, { base: mk(), floorIndex: 0, makeId: ids() });
    expect(lastOf(result).filter((item) => item.type === 'backdrop')).toHaveLength(2);
    expect(result.issues.find((entry) => entry.code === 'W_DUPLICATE_ROLE')?.message).toContain('每块都会建');
  });

  it('501 人的 brief 也过得了自己的契约', () => {
    const derived = sceneScriptFromBrief({ widthM: 30, depthM: 20, guests: 501, stage: false, checkin: false, seed: 1 });
    expect(parseSceneScript(derived).ok).toBe(true);
  });

  it('签到区装不下 1.8 m 的台子时拒绝，而不是让它压到区外', () => {
    const narrow = script({ zones: [{ role: 'checkin', rect: { x: -1, z: 2, w: 1.0, d: 1.4 } }] });
    const result = compileSceneScript(narrow, { base: mk(), floorIndex: 0, makeId: ids() });
    expect(lastOf(result).some((item) => item.type === 'counter')).toBe(false);
    expect(result.refusals.some((entry) => entry.role === 'checkin' && entry.code === 'E_ROLE_UNFIT')).toBe(true);
  });

  it('锁定的椅子也算座位（与旧口径一致）', () => {
    const lockedChair = makeItem({ id: 'lc', type: 'dining-chair', name: 'Locked chair', position: { x: 5.0, z: 3.9 }, locked: true });
    const result = compileSceneScript(script({ guests: 16 }), { base: mk(12, 9, [lockedChair]), floorIndex: 0, makeId: ids() });
    expect(result.seats).toBe(lastOf(result).filter((item) => item.type === 'dining-chair').length);
    expect(result.seats).toBeGreaterThan(16);
  });

  it('多座位区里有一块失败，settled 不说"已收敛"', () => {
    const slab = makeItem({ id: 'slab', type: 'wardrobe', name: 'Slab', width: 4.6, depth: 3.4, height: 2, position: { x: -2.85, z: -3.8 }, locked: true });
    const multi = script({
      zones: [
        { role: 'seating', rect: { x: -5.3, z: -3.8, w: 4.8, d: 3.5 }, count: 8 },
        { role: 'seating', rect: { x: 0.4, z: -3.8, w: 4.8, d: 3.5 }, count: 8 },
      ],
    });
    const result = compileSceneScript(multi, { base: mk(12, 9, [slab]), floorIndex: 0, makeId: ids() });
    expect(result.settled.converged).toBe(false);
    expect(result.refusals.length).toBeGreaterThan(0);
  });
});

describe('P3 读白与结构', () => {
  it('summary 读的是归一化之后的区；座位那一行只说这一版排得到的数', () => {
    const raw = brief();
    const normalized = normalizeSceneScript(raw, { width: 12, depth: 9 }).script;
    const result = compileSceneScript(raw, { base: mk(), floorIndex: 0, makeId: ids() });
    const plain = describeSceneScript(normalized);
    // 非座位区仍与归一化后的脚本逐字相同；座位那句改由逐格空跑探出来的上限说话。
    expect(result.summary.filter((line) => !line.startsWith('座位'))).toEqual(plain.filter((line) => !line.startsWith('座位')));
    expect(result.summary.find((line) => line.startsWith('座位'))).toMatch(/^座位 [\d.]+ × [\d.]+ m，按这版排法最多 16 座（要 24）$/);
    // 读白不许把要价念成结果。
    expect(result.summary.join(' ')).not.toMatch(/，24 座/);
  });

  it('课室模式一座一桌一组，座位数按椅子数算', () => {
    const classroom = sceneScriptFromBrief({ widthM: 12, depthM: 9, guests: 12, layoutMode: 'desk-chair', stage: false, checkin: false, seed: 1 });
    const result = compileSceneScript(classroom, { base: mk(), floorIndex: 0, makeId: ids() });
    const desks = lastOf(result).filter((item) => item.type === 'desk').length;
    expect(desks).toBeGreaterThan(0);
    expect(result.seats).toBe(Math.min(12, desks));
  });

  it('不锁定的旧物料全撤、结构标记一个不动', () => {
    const loose = makeItem({ id: 'loose', type: 'chair', name: 'Loose', position: { x: -4, z: 2 } });
    const result = compileSceneScript(brief(), { base: mk(12, 9, [loose]), floorIndex: 0, makeId: ids() });
    expect(lastOf(result).some((item) => item.id === 'loose')).toBe(false);
    expect(result.removing).toBe(1);
    expect(lastOf(result).filter(isStructuralMarker)).toHaveLength(0);
  });
});

describe('P1 共享诊断词表：脚本的拒绝进同一本账', () => {
  it('超出给得起的座位数：按「座」记一条，不再换算成没人能数的件数', () => {
    const full = compileSceneScript(brief(), { base: mk(), floorIndex: 0, makeId: ids() });
    expect(full.seats).toBe(16);
    expect(full.capacity).toBe(16);
    // 要 24 而这一版只排得进 16：一件物料都没被拒，缺的是 8 个人头。
    expect(full.dropped).toBe(0);
    expect(full.diagnostics).toEqual([
      { severity: 'warning', code: 'CAPACITY_EXCEEDED', count: 0, seats: 8, capacity: 16, names: ['座位'], message: '按这套排法这块座位区排到 16 座就是头' },
    ]);
    expect(outcomeLines(outcomeOfPlan(full)).join('')).not.toContain('没放进去');
    const fitted = compileSceneScript(script({ guests: 16 }), { base: mk(), floorIndex: 0, makeId: ids() });
    expect(fitted.dropped).toBe(0);
    expect(fitted.diagnostics ?? []).toEqual([]);
    expect(describeDiagnostics(fitted.diagnostics ?? [])).toBeNull();
  });

  it('排到顶是这套排法的顶，不是这块地的极限：话术里不许出现「这块地最多」', () => {
    const result = compileSceneScript(brief(), { base: mk(), floorIndex: 0, makeId: ids() });
    const line = result.issues.find((issue) => issue.code === 'W_CAPACITY')?.message ?? '';
    expect(line).toContain(`排到 ${result.capacity} 座就是头`);
    expect(`${result.summary.join(' ')} ${line}`).not.toMatch(/这块(地|座位区)最多/);
  });

  it('窄到连一组桌椅都摆不下：记 ROLE_UNFIT，点名「座位」', () => {
    const derived = sceneScriptFromBrief({ widthM: 2, depthM: 9, guests: 20, stage: false, checkin: false, seed: 1 });
    const result = compileSceneScript(derived, { base: mk(2, 9), floorIndex: 0, makeId: ids() });
    const codes = (result.diagnostics ?? []).map((entry) => entry.code);
    expect(codes).toContain('ROLE_UNFIT');
    expect(result.diagnostics?.find((entry) => entry.code === 'ROLE_UNFIT')?.names).toEqual(['座位']);
  });

  it('要得比这块地给得起的多：还是只有 CAPACITY_EXCEEDED 一条，且不说件数', () => {
    const result = compileSceneScript(script({ guests: 200 }), { base: mk(), floorIndex: 0, makeId: ids() });
    expect(result.dropped).toBe(0);
    expect((result.diagnostics ?? []).map((entry) => entry.code)).toEqual(['CAPACITY_EXCEEDED']);
    expect((result.diagnostics?.[0]?.seats ?? 0) + (result.diagnostics?.[0]?.capacity ?? 0)).toBe(200);
    expect(outcomeLines(outcomeOfPlan(result)).join('')).not.toContain('没放进去');
  });

  it('锁定物料吃掉一格：上限跟着降，缺口仍按座说', () => {
    const probe = compileSceneScript(script({ guests: 8 }), { base: mk(), floorIndex: 0, makeId: ids() });
    const table = lastOf(probe).find((item) => item.type === 'dining-table')!;
    const blocker: FurnitureItem = { ...table, id: 'blocker', type: 'wardrobe', name: 'Blocker', width: 1.4, depth: 0.6, height: 2, locked: true };
    const plain = compileSceneScript(script({ guests: 24 }), { base: mk(), floorIndex: 0, makeId: ids() });
    const result = compileSceneScript(script({ guests: 24 }), { base: mk(12, 9, [blocker]), floorIndex: 0, makeId: ids() });
    expect(result.capacity).toBeLessThan(plain.capacity);
    expect(result.dropped).toBe(0);
    expect(result.diagnostics?.[0]?.message).toContain(`排到 ${result.capacity} 座就是头`);
  });

  it('真有物料被拒时才按件说：Σ 件数 = dropped，且同一句里数字不念两遍', () => {
    const derived = sceneScriptFromBrief({ widthM: 2, depthM: 9, guests: 20, stage: false, checkin: false, seed: 1 });
    const result = compileSceneScript(derived, { base: mk(2, 9), floorIndex: 0, makeId: ids() });
    const pieces = (result.diagnostics ?? []).reduce((sum, entry) => sum + entry.count, 0);
    expect(pieces).toBe(result.dropped);
    expect(result.dropped).toBeGreaterThan(0);
    expect(outcomeLines(outcomeOfPlan(result))).toContain(`没放进去 ${result.dropped} 件：${DIAGNOSTIC_REASON.ROLE_UNFIT}`);
  });
});
