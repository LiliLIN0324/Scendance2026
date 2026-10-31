import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { proposeAddition, proposePlan, raiseVenue, replaceVenueWithShell, type VenueInput } from './agent-proposal';
import { backendSceneToLayout } from './backend-adapter';
import { presetModelUrl } from './scene-presets';
import { isStructuralMarker } from './structural-layout';
import { buildVenueShell } from './venue-shell';
import type { FurnitureItem, RoomLayout } from './types';

/** 走一遍真实流程：先立 T-01 的场地，再在立好的壳体上出布置候选。 */
const build = (items: FurnitureItem[] = [], input: Partial<VenueInput> = {}, variant = 0) => {
  const base = makeLayout({ width: 12, height: 9, floors: [makeFloor({ items })] });
  const venue = raiseVenue({ base, floorIndex: 0, widthM: 12, depthM: 9, indoorOutdoor: 'indoor', scaleOrigin: 'stated', ...input });
  const staged: RoomLayout = venue ? venue.layout : base;
  const proposal = proposePlan({ base: staged, floorIndex: 0, widthM: 12, depthM: 9, variant });
  return { base, venue, staged, proposal };
};

const itemsOf = (layout: RoomLayout) => layout.floors[0]?.items ?? [];
const tablesOf = (layout: RoomLayout) => itemsOf(layout).filter(item => item.type === 'dining-table').map(item => [item.position?.x ?? 0, item.position?.z ?? 0]);
const last = (proposal: ReturnType<typeof proposePlan>) => proposal.layouts[proposal.layouts.length - 1]!;

describe('raiseVenue — 场地真相先落地（T-01 的产物，本卡不改它）', () => {
  it('砌出四面外墙，并把主入口留在原地当场地真相', () => {
    const { venue } = build();
    expect(venue?.scene.structure.walls).toHaveLength(4);
    const markers = itemsOf(venue!.layout).filter(isStructuralMarker);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.structuralOpeningId).toBe(venue?.scene.venue.site?.mainEntrance?.openingId);
  });

  it('旧物料还塞得进新壳体就留着：撤不撤是布置那一步的决定', () => {
    const loose = makeItem({ id: 'loose', type: 'chair', position: { x: 3, z: 3 } });
    const { venue } = build([loose]);
    expect(venue?.cleared).toBe(0);
    expect(itemsOf(venue!.layout).some(item => item.id === 'loose')).toBe(true);
  });

  it('旧物料塞不进新壳体才随清场撤掉，并且报出件数', () => {
    const wide = makeLayout({ width: 20, height: 14, floors: [makeFloor({ items: [makeItem({ id: 'far', type: 'chair', position: { x: 9, z: 6 } })] })] });
    const venue = raiseVenue({ base: wide, floorIndex: 0, widthM: 12, depthM: 9, indoorOutdoor: 'indoor', scaleOrigin: 'stated' });
    expect(venue?.cleared).toBe(1);
    expect(itemsOf(venue!.layout).some(item => item.id === 'far')).toBe(false);
  });

  it('锁着的物料压在新墙体或边界上时直说，不悄悄把壳体丢了', () => {
    const wide = makeLayout({ width: 20, height: 14, floors: [makeFloor({ items: [makeItem({ id: 'in-wall', locked: true, width: 2, depth: 0.4, position: { x: 0, z: -7 } })] })] });
    expect(() => raiseVenue({ base: wide, floorIndex: 0, widthM: 12, depthM: 9, indoorOutdoor: 'indoor', scaleOrigin: 'stated' })).toThrow(/压在新墙体或边界上/);
  });

  it('已有结构的场地不再砌墙', () => {
    const preset = makeLayout({ scenePreset: 'gym' });
    expect(raiseVenue({ base: preset, floorIndex: 0, widthM: 12, depthM: 9, indoorOutdoor: 'indoor', scaleOrigin: 'stated' })).toBeNull();
  });

  it('户外场地不砌墙也不开门', () => {
    const { venue } = build([], { indoorOutdoor: 'outdoor' });
    expect(venue?.scene.structure.walls).toHaveLength(0);
    expect(itemsOf(venue!.layout).some(isStructuralMarker)).toBe(false);
  });
});

describe('replaceVenueWithShell — 有模板改尺寸就卸模板立壳（T-VENUE B）', () => {
  const fixture = (key: 'gym' = 'gym', id = 'gym-seat'): FurnitureItem =>
    makeItem({ id, type: 'glb-asset', name: '模板座椅', glbUrl: presetModelUrl(key), glbNode: 'Seat' });
  const presetBase = (items: FurnitureItem[]): RoomLayout => makeLayout({
    width: 70, height: 76, scenePreset: 'gym', roof: { style: 'none' },
    floors: [makeFloor({ items })],
  });
  const input = (base: RoomLayout): VenueInput => ({ base, floorIndex: 0, widthM: 20, depthM: 12, indoorOutdoor: 'indoor', scaleOrigin: 'stated' });

  it('卸掉预设与模板 GLB 物件，按新尺寸立矩形空壳，留下塞得进的物料', () => {
    const chair = makeItem({ id: 'user-chair', type: 'chair', name: '自己的椅子', position: { x: 0, z: 0 } });
    const base = presetBase([fixture(), chair]);
    const venue = replaceVenueWithShell(input(base));

    expect(venue?.scene.venue.width).toBe(20);
    expect(venue?.scene.venue.depth).toBe(12);
    expect(venue?.scene.structure.walls).toHaveLength(4);
    expect(venue?.layout.scenePreset).toBeUndefined();
    expect(venue?.layout.backendSceneV2).toBeDefined();
    expect(venue?.layout.width).toBe(20);
    expect(venue?.layout.height).toBe(12);
    expect(itemsOf(venue!.layout).some(item => item.id === 'user-chair')).toBe(true);
    expect(itemsOf(venue!.layout).some(item => item.id === 'gym-seat')).toBe(false);
    expect(venue?.layout.floors[0]?.floorColor).toBe(base.floors[0]?.floorColor);
    expect(venue?.cleared).toBe(0);
  });

  it('放不下的散件随清场撤掉并报数，锁着的压墙则直说', () => {
    const far = makeItem({ id: 'far', type: 'chair', position: { x: 9, z: 6 } });
    const loose = replaceVenueWithShell(input(presetBase([fixture(), far])));
    expect(loose?.cleared).toBe(1);
    expect(itemsOf(loose!.layout).some(item => item.id === 'far')).toBe(false);

    const stuck = makeItem({ id: 'stuck', type: 'sofa', width: 2, depth: 1, locked: true, position: { x: 9.8, z: 0 } });
    expect(() => replaceVenueWithShell(input(presetBase([stuck])))).toThrow(/压在新墙体或边界上/);
  });

  it('空白场地这类编辑器自己立的壳也能按新尺寸重立', () => {
    const shell = backendSceneToLayout(buildVenueShell({ widthM: 12, depthM: 8, indoorOutdoor: 'indoor', scaleOrigin: 'typed' }), { name: '空白场地' });
    const chair = makeItem({ id: 'chair', type: 'chair', position: { x: 0, z: 0 } });
    const base: RoomLayout = { ...shell, floors: [{ ...shell.floors[0]!, items: [...shell.floors[0]!.items, chair] }] };
    const venue = replaceVenueWithShell(input(base));

    expect(venue?.layout.width).toBe(20);
    expect(venue?.layout.height).toBe(12);
    expect(venue?.layout.scenePreset).toBeUndefined();
    expect(itemsOf(venue!.layout).some(item => item.id === 'chair')).toBe(true);
    expect(itemsOf(venue!.layout).filter(isStructuralMarker)).toHaveLength(1);
  });

  it('普通空地没有模板也没有壳就不硬改尺寸', () => {
    expect(replaceVenueWithShell(input(makeLayout()))).toBeNull();
  });
});

describe('proposePlan — 布置候选只预览，确认前不写画布（T-02 对话四步②）', () => {
  it('不动传进来的场景，另外长出 5 帧候选', () => {
    const { staged, proposal } = build();
    expect(itemsOf(staged)).toHaveLength(1); // 只有门洞标记
    expect(proposal.layouts).toHaveLength(5);
    const counts = proposal.layouts.map(layout => itemsOf(layout).length);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(counts[4]!).toBeGreaterThan(counts[0]!);
    expect(proposal.added).toBeGreaterThan(0);
    expect(proposal.blocked).toBeNull();
  });

  it('第一帧撤掉上一版物料，锁定件与门洞标记留着并报数', () => {
    const locked = makeItem({ id: 'locked-1', type: 'sofa', name: '客户的沙发', locked: true, position: { x: 0, z: 2.5 } });
    const { proposal } = build([locked, makeItem({ id: 'loose', type: 'chair', position: { x: 3, z: 3 } })]);
    expect(proposal.removing).toBe(1);
    expect(proposal.keptLocked).toBe(1);
    const items = itemsOf(last(proposal));
    expect(items).toContain(locked);
    expect(items.some(item => item.id === 'loose')).toBe(false);
    expect(items.filter(isStructuralMarker)).toHaveLength(1);
  });

  it('换一版只换桌椅槽位，组数不跟着面积跑', () => {
    const a = build([], {}, 0).proposal;
    const b = build([], {}, 1).proposal;
    const [tablesA, tablesB] = [tablesOf(last(a)), tablesOf(last(b))];
    expect(tablesA.length).toBeGreaterThan(0);
    expect(tablesB).toHaveLength(tablesA.length);
    expect(tablesB).not.toEqual(tablesA);
    expect(b.blocked).toBeNull();
  });

  it('12×9 这一版既不重叠也不丢件', () => {
    const { proposal } = build();
    expect(proposal.overlapCount).toBe(0);
    expect(proposal.overlapNames).toEqual([]);
    expect(proposal.dropped).toBe(0);
    expect(proposal.added + proposal.keptLocked).toBe(itemsOf(last(proposal)).filter(item => !isStructuralMarker(item)).length);
  });

  it('户外场地照样能摆，且不会因为没墙就被几何闸拒绝', () => {
    const { proposal } = build([], { indoorOutdoor: 'outdoor' });
    expect(proposal.added).toBeGreaterThan(0);
    expect(proposal.blocked).toBeNull();
  });

  it('发布会可以带签到台，仍只是预览，放不下就丢掉这一件', () => {
    const staged = build().staged;
    const proposal = proposePlan({ base: staged, floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 8, checkin: true });
    const items = itemsOf(last(proposal));
    expect(items.some(item => item.name === '签到台')).toBe(true);
    expect(proposal.overlapCount).toBe(0);
    expect(proposal.blocked).toBeNull();
    expect(itemsOf(staged).some(item => item.name === '签到台')).toBe(false);
  });

  it('说了人数就按人数定桌椅组数，摆不下就把座位数如实报出来', () => {
    const staged = build().staged;
    const eight = proposePlan({ base: staged, floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 8 });
    const twenty = proposePlan({ base: staged, floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 20 });
    expect(eight.guests).toBe(8);
    expect(eight.seats).toBe(8);
    expect(twenty.seats!).toBeGreaterThan(eight.seats!);
    expect(twenty.seats!).toBeLessThan(20);
  });
});

describe('proposePlan — 一人一套课桌椅（desk-chair，2026-10-27 课室场景）', () => {
  it('按人数铺课室行列：一套 = 一张课桌 + 一把椅子，座位数如实报', () => {
    const base = makeLayout({ width: 12, height: 9, floors: [makeFloor({ items: [] })] });
    const staged = raiseVenue({ base, floorIndex: 0, widthM: 12, depthM: 9, indoorOutdoor: 'indoor', scaleOrigin: 'stated' })!.layout;
    const proposal = proposePlan({ base: staged, floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 12, layoutMode: 'desk-chair' });
    const items = itemsOf(last(proposal));
    expect(items.filter(item => item.type === 'desk')).toHaveLength(12);
    expect(items.filter(item => item.type === 'chair')).toHaveLength(12);
    expect(proposal.seats).toBe(12);
    expect(proposal.guests).toBe(12);
    expect(proposal.blocked).toBeNull();
    expect(proposal.overlapCount).toBe(0);
  });

  it('课室不摆舞台背景板；人数超过容量就按场地封顶，不硬塞', () => {
    const base = makeLayout({ width: 12, height: 9, floors: [makeFloor({ items: [] })] });
    const staged = raiseVenue({ base, floorIndex: 0, widthM: 12, depthM: 9, indoorOutdoor: 'indoor', scaleOrigin: 'stated' })!.layout;
    const proposal = proposePlan({ base: staged, floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 80, layoutMode: 'desk-chair' });
    const items = itemsOf(last(proposal));
    expect(items.some(item => item.type === 'backdrop')).toBe(false);
    expect(items.filter(item => item.type === 'desk').length).toBeLessThan(80);
    expect(items.filter(item => item.type === 'desk').length).toBe(items.filter(item => item.type === 'chair').length);
  });
});

describe('proposePlan — 座位优先（T-05：人还站着就补座，但只出候选）', () => {
  it('30 人 12×9：普通版如实报缺口，座位优先版补到够坐', () => {
    const staged = build().staged;
    const plain = proposePlan({ base: staged, floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 30 });
    const seated = proposePlan({ base: staged, floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 30, seatPriority: true });
    expect(plain.seatPriority).toBe(false);
    expect(plain.seats!).toBeLessThan(30);
    expect(seated.seatPriority).toBe(true);
    expect(seated.seats).toBeGreaterThan(plain.seats!);
    expect(seated.seats).toBeGreaterThanOrEqual(30);
    expect(seated.blocked).toBeNull();
    expect(seated.overlapCount).toBe(0);
    expect(seated.overlapNames).toEqual([]);
    expect(seated.dropped).toBe(0);
  });

  it('座位优先也受同一个几何闸约束：不会为了凑人数穿墙或叠在一起', () => {
    const staged = build().staged;
    const plan = proposePlan({ base: staged, floorIndex: 0, widthM: 12, depthM: 9, variant: 1, guests: 30, seatPriority: true });
    expect(plan.overlapCount).toBe(0);
    expect(plan.blocked).toBeNull();
    expect(plan.layouts.at(-1)!.floors[0]!.items
      .filter(item => !isStructuralMarker(item) && (item.type === 'chair' || item.type === 'dining-chair'))
      .every(item => Math.abs(item.position!.x) < 12 / 2 && Math.abs(item.position!.z) < 9 / 2)).toBe(true);
  });

  it('补不齐的小场地如实返回 seats < guests，不虚报', () => {
    const small = raiseVenue({
      base: makeLayout({ width: 5, height: 4, floors: [makeFloor()] }),
      floorIndex: 0, widthM: 5, depthM: 4, indoorOutdoor: 'indoor', scaleOrigin: 'stated',
    })!.layout;
    const plain = proposePlan({ base: small, floorIndex: 0, widthM: 5, depthM: 4, variant: 0, guests: 30 });
    const plan = proposePlan({ base: small, floorIndex: 0, widthM: 5, depthM: 4, variant: 0, guests: 30, seatPriority: true });
    expect(plan.seatPriority).toBe(true);
    expect(plan.seats!).toBeLessThan(30);
    expect(plan.seats).toBeGreaterThan(0);
    expect(plan.blocked).toBeNull();
    // 小场地原有的挤碰（绿植/背景板/桌组）不该被补座放大；新加的椅子不许再添挤碰。
    const chairHits = (proposal: typeof plan) => proposal.overlapNames.filter(name => name === 'Dining Chair' || name === '椅子').length;
    expect(plan.overlapCount).toBeLessThanOrEqual(plain.overlapCount);
    expect(chairHits(plan)).toBeLessThanOrEqual(chairHits(plain));
  });

  it('没有说人数时不补座，也不多长一帧', () => {
    const staged = build().staged;
    const plan = proposePlan({ base: staged, floorIndex: 0, widthM: 12, depthM: 9, variant: 0, seatPriority: true });
    expect(plan.seatPriority).toBe(true);
    expect(plan.guests).toBeNull();
    expect(plan.layouts).toHaveLength(5);
  });
});

describe('proposeAddition — 对话加物料也只出候选', () => {
  const staged = (): RoomLayout => {
    const base = makeLayout({ width: 12, height: 9, floors: [makeFloor()] });
    return raiseVenue({ base, floorIndex: 0, widthM: 12, depthM: 9, indoorOutdoor: 'indoor', scaleOrigin: 'stated' })!.layout;
  };

  it('只加点名的那几件，基线一个字节都不动', () => {
    const base = staged();
    const before = itemsOf(base).length;
    const proposal = proposeAddition({ base, floorIndex: 0, requests: [{ materialId: 'chair', count: 2 }] });
    expect(itemsOf(base)).toHaveLength(before);
    expect(itemsOf(last(proposal))).toHaveLength(before + 2);
    expect(proposal.added).toBe(2);
    expect(proposal.layouts).toHaveLength(2); // 基线 + 加完那一帧，不按件数播动画
    expect(proposal.accepted).toEqual([{ materialId: 'chair', name: '椅子', requested: 2, placed: 2 }]);
    expect(proposal.blocked).toBeNull();
    expect(proposal.overlapCount).toBe(0);
  });

  it('锁着的物料留在原位，也不算进新摆的件数', () => {
    const base = staged();
    const locked = makeItem({ id: 'boss', type: 'sofa', name: '客户的沙发', locked: true, position: { x: 0, z: 3 } });
    const withLocked: RoomLayout = { ...base, floors: [{ ...base.floors[0]!, items: [...base.floors[0]!.items, locked] }] };
    const proposal = proposeAddition({ base: withLocked, floorIndex: 0, requests: [{ materialId: 'table', count: 1 }] });
    expect(itemsOf(last(proposal))).toContain(locked);
    expect(proposal.keptLocked).toBe(1);
    expect(proposal.added).toBe(1);
  });

  it('放不下就报没放下多少，不硬塞', () => {
    const small = makeLayout({ width: 3, height: 3, floors: [makeFloor()] });
    const proposal = proposeAddition({ base: small, floorIndex: 0, requests: [{ materialId: 'chair', count: 50 }] });
    expect(proposal.added).toBeLessThan(50);
    expect(proposal.dropped).toBe(50 - proposal.added);
    expect(proposal.accepted[0]).toMatchObject({ placed: proposal.added, requested: 50 });
  });
});
