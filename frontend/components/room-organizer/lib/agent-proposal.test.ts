import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { proposeAddition, proposePlan, raiseVenue, type VenueInput } from './agent-proposal';
import { isStructuralMarker } from './structural-layout';
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
