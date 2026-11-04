import { describe, expect, it } from 'vitest';
import { makeFloor, makeLayout } from './__testfixtures__/fixtures';
import { localPlan } from './local-plan';
import type { FurnitureItem, RoomLayout } from './types';

const baseLayout = (width = 12, depth = 9, items: FurnitureItem[] = []): RoomLayout =>
  makeLayout({ width, height: depth, floors: [makeFloor({ items })] });

const itemsOf = (layout: RoomLayout): FurnitureItem[] => layout.floors[0]?.items ?? [];
const last = (result: ReturnType<typeof localPlan>): FurnitureItem[] => itemsOf(result.layouts[result.layouts.length - 1]!);

describe('localPlan — 出方案只有一道门，里面可以是两条路', () => {
  it('常规发布会走脚本这条：先计划再编译，结果仍然是一份 PlanProposal', () => {
    const result = localPlan({ base: baseLayout(), floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 24, stage: true, checkin: true });
    expect(result.via).toBe('script');
    expect(result.blocked).toBeNull();
    expect(result.added).toBeGreaterThan(0);
    expect(result.summary?.length).toBeGreaterThan(0);
    expect(result.layouts.length).toBeGreaterThan(1);
  });

  it('脚本这条路被拒时退回原来的槽位启发式，不把出方案整个弄挂', () => {
    // 1.5 m 见方的场地：舞台区、通道都收不成区，脚本直接 blocked。
    const result = localPlan({ base: baseLayout(1.5, 1.5), floorIndex: 0, widthM: 1.5, depthM: 1.5, variant: 0, guests: 4, stage: true, checkin: false });
    expect(result.via).toBe('fallback');
    expect(typeof result.fallbackReason).toBe('string');
  });

  it('场地太浅、脚本一排座位都排不出来时，退回原启发式并说明原因', () => {
    const result = localPlan({ base: baseLayout(8, 6), floorIndex: 0, widthM: 8, depthM: 6, variant: 0, guests: 20, stage: true, checkin: true });
    expect(result.via).toBe('fallback');
    expect(result.seats ?? 0).toBeGreaterThan(0);
    expect(result.fallbackReason).toContain('座位');
  });

  it('没点舞台就不摆背板（脚本里没有 stage 区）', () => {
    const result = localPlan({ base: baseLayout(), floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 16, stage: false, checkin: false });
    expect(last(result).some((item) => item.type === 'backdrop')).toBe(false);
  });

  it('换一版：variant 换 seed，版式可以变，可行域不变', () => {
    const one = localPlan({ base: baseLayout(), floorIndex: 0, widthM: 12, depthM: 9, variant: 1, guests: 24, stage: true, checkin: true });
    const two = localPlan({ base: baseLayout(), floorIndex: 0, widthM: 12, depthM: 9, variant: 2, guests: 24, stage: true, checkin: true });
    expect(one.via).toBe('script');
    expect(two.via).toBe('script');
    expect(one.seats).toBe(two.seats);
  });

  it('座位优先：加座必须有牙——换更密的排法，真多坐到人才算', () => {
    const plain = localPlan({ base: baseLayout(), floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 200, stage: false, checkin: false });
    const priority = localPlan({ base: baseLayout(), floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 200, stage: false, checkin: false, seatPriority: true });
    expect(plain.via).toBe('script');
    // 脚本把整块座位区填满就是一排的顶；原来那套摆得更密。两条都跑，留下坐得多的一侧，
    // 所以「加座，再排一版」点下去一定改变结果——按钮不许多余。
    expect(priority.seats ?? 0).toBeGreaterThan(plain.seats ?? 0);
    expect(priority.guests).toBe(200);
    if (priority.via === 'fallback') expect(priority.fallbackReason).toContain('更密的排法');
  });

  it('门口把计划读白与共享诊断原样带出来：气泡念读白，卡片念账', () => {
    const plan = localPlan({ base: baseLayout(), floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 200, stage: false, checkin: false });
    expect(plan.via).toBe('script');
    expect((plan.summary?.length ?? 0) > 0).toBe(true);
    // 读白不许把要价念成结果：座位那句里的数必须就是探测出来的几何上限。
    const seatLine = (plan.summary ?? []).find((line) => line.startsWith('座位')) ?? '';
    expect(seatLine).toMatch(/最多 (\d+) 座（要 200）/);
    expect(Number(seatLine.match(/最多 (\d+) 座/)?.[1])).toBe(plan.capacity);
    // 要 200 座而这块地给不起：缺口按「座」记一条，物料一件都没被拒。
    expect(plan.dropped).toBe(0);
    expect((plan.diagnostics ?? []).reduce((sum, entry) => sum + entry.count, 0)).toBe(plan.dropped);
    expect((plan.diagnostics ?? []).some((entry) => (entry.seats ?? 0) > 0)).toBe(true);
  });

  it('同一份输入跑两次，位置逐个相同（预览与落盘必须对得上）', () => {
    const run = () => localPlan({ base: baseLayout(), floorIndex: 0, widthM: 12, depthM: 9, variant: 3, guests: 30, stage: true, checkin: true });
    const first = last(run()).map((item) => [item.type, item.position?.x, item.position?.z, item.rotation]);
    const second = last(run()).map((item) => [item.type, item.position?.x, item.position?.z, item.rotation]);
    expect(first).toEqual(second);
  });
});
