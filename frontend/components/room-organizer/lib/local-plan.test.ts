import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { localPlan } from './local-plan';
import type { FurnitureItem, RoomLayout } from './types';

const baseLayout = (width = 12, depth = 9, items: FurnitureItem[] = []): RoomLayout =>
  makeLayout({ width, height: depth, floors: [makeFloor({ items })] });

const itemsOf = (layout: RoomLayout): FurnitureItem[] => layout.floors[0]?.items ?? [];
const last = (result: ReturnType<typeof localPlan>): FurnitureItem[] => itemsOf(result.layouts[result.layouts.length - 1]!);

describe('localPlan — 出方案只有一道门，里面可以是两条路', () => {
  it('keeps unspecified functional needs as warnings without blocking an exploration',()=>{
    const plan=localPlan({base:baseLayout(),floorIndex:0,widthM:12,depthM:9,variant:0,guests:8,stage:false,checkin:false});
    expect(plan.blocked).toBeNull();
    expect(plan.summary?.join(' ')).toContain('尚未确认是否需要签到');
    expect(plan.summary?.join(' ')).toContain('尚未确认是否需要舞台');
  });
  it('adds a stage platform rather than treating a backdrop as a stage', () => {
    const plan = localPlan({ base: baseLayout(), floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 8,
      stage: true, checkin: false, functionalNeeds: { checkin: null, stage: true } });
    expect(last(plan).some(item => item.type === 'backdrop')).toBe(true);
    expect(last(plan).some(item => item.name === '舞台平台（示意）')).toBe(true);
    expect(plan.blocked).toBeNull();
    expect(plan.summary?.join(' ')).toContain('仍需核对');
  });

  it('still reports the seating gap after adding a stage platform', () => {
    const plan = localPlan({ base: baseLayout(), floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 200,
      requireSeats: true, stage: true, checkin: false, functionalNeeds: { checkin: null, stage: true } });
    expect(plan.blocked).toContain('200');
    expect(last(plan).some(item => item.name === '舞台平台（示意）')).toBe(true);
  });

  it('uses semantic reception equipment to satisfy a requested check-in area', () => {
    const plan = localPlan({ base: baseLayout(), floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 8,
      stage: false, checkin: true, functionalNeeds: { checkin: true, stage: null } });
    expect(last(plan).some(item => item.materialId === 'reception')).toBe(true);
    expect(plan.blocked).toBeNull();
  });

  it('warns instead of removing a locked reception desk when no check-in is wanted', () => {
    const desk = makeItem({ id: 'locked-checkin', type: 'counter', materialId: 'reception', name: '签到台', locked: true,
      width: 1.8, depth: 0.6, position: { x: -4, z: 3 } });
    const base = baseLayout(12, 9, [desk]);
    const plan = localPlan({ base, floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 8,
      stage: false, checkin: false, functionalNeeds: { checkin: false, stage: null } });
    expect(last(plan).find(item => item.id === desk.id)).toEqual(desk);
    expect(plan.blocked).toContain('不会自动删除');
    expect(base.floors[0]!.items).toEqual([desk]);
  });
  it('blocks a plan that retains an explicitly named unwanted check-in object',()=>{
    const desk=makeItem({id:'named-checkin',type:'table',name:'签到服务台',locked:true,width:1.8,depth:.6,position:{x:-4,z:3}});
    const plan=localPlan({base:baseLayout(12,9,[desk]),floorIndex:0,widthM:12,depthM:9,variant:0,guests:8,stage:false,checkin:false,functionalNeeds:{checkin:false,stage:null}});
    expect(plan.blocked).toContain('不会自动删除');expect(last(plan).find(item=>item.id===desk.id)).toEqual(desk);
  });
  it('需要休息区时生成可审阅的区域和示意长椅，并说明现场仍需核对', () => {
    const plan = localPlan({ base: baseLayout(), floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 8, requireRest: true });
    const final = plan.layouts.at(-1)!;
    expect(plan.blocked).toBeNull();
    expect(final.floors[0]!.zones?.some(zone => zone.name.includes('休息区'))).toBe(true);
    expect(final.floors[0]!.items.some(item => item.name === '休息长椅（示意）')).toBe(true);
    expect(plan.summary?.join(' ')).toContain('仍需核对');
    expect(plan.summary?.join(' ')).toContain('云端保存尚未确认');
  });
  it('生成休息区时锁定物件原样保留', () => {
    const locked = makeItem({ id: 'locked-rest', name: '锁定桌', type: 'table', locked: true, position: { x: -3, z: -2 } });
    const base = baseLayout(12, 9, [locked]);
    const plan = localPlan({ base, floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 8, requireRest: true, stage: false, checkin: false });
    expect(plan.layouts.at(-1)!.floors[0]!.items.find(item => item.id === locked.id)).toEqual(locked);
    expect(base.floors[0]!.items).toEqual([locked]);
  });
  it('已有手绘休息区时复用，不再追加示意长椅或覆盖用户标注', () => {
    const zone = { id: 'user-zone', name: '用户休息区', color: '#4A7C59', x: -5, z: -4, w: 2, d: 2 };
    const base = makeLayout({ width: 12, height: 9, floors: [makeFloor({ items: [], zones: [zone] })] });
    const plan = localPlan({ base, floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 8, requireRest: true, stage: false, checkin: false });
    const final = plan.layouts.at(-1)!;
    expect(final.floors[0]!.zones).toContainEqual(zone);
    expect(final.floors[0]!.items.some(item => item.name === '休息长椅（示意）')).toBe(false);
  });
  it('明确要求全部入座时，座位不足不能确认，也不声称已证明场地无解', () => {
    const input = { base: baseLayout(), floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: 200, layoutMode: 'desk-chair' as const, stage: false, checkin: false };
    const plan = localPlan({ ...input, requireSeats: true });
    expect(plan.seats ?? 0).toBeLessThan(200);
    expect(plan.blocked).toBeTruthy();
    expect(plan.blocked).not.toContain('最多');
    const optional = localPlan({ ...input, requireSeats: false });
    expect(optional.seats).toBe(plan.seats);
  });
  it.each([null,0,-1,10001])('does not create a candidate when attendance is invalid: %s', guests => {
    const base=baseLayout();const plan=localPlan({base,floorIndex:0,widthM:12,depthM:9,variant:0,guests,stage:false,checkin:false});
    expect(plan.blocked).toContain('预计人数');expect(plan.layouts).toEqual([base]);expect(plan.added).toBe(0);
  });
  it('does not add unrequested plants in the script or fallback plan',()=>{
    const script=localPlan({base:baseLayout(),floorIndex:0,widthM:12,depthM:9,variant:0,guests:8,stage:true,checkin:true});
    const fallback=localPlan({base:baseLayout(1.5,1.5),floorIndex:0,widthM:1.5,depthM:1.5,variant:0,guests:4,stage:false,checkin:false});
    for(const plan of [script,fallback]) expect(last(plan).some(item=>item.type==='plant'||item.type==='flowerpot')).toBe(false);
  });
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
    // 读白按最终候选单人椅数量说，不把目标人数或搜索上限当成实际摆出。
    const seatLine = (plan.summary ?? []).find((line) => line.startsWith('座位')) ?? '';
    expect(seatLine).toMatch(/候选共识别 \d+ 把单人椅/);
    expect(Number(seatLine.match(/候选共识别 (\d+) 把单人椅/)?.[1])).toBe(plan.seats);
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

describe('autoDeskSpec — 课桌规格可调（2026-11-11 用户拍板）', () => {
  const room = (w: number, h: number): RoomLayout => ({ name: '测试', width: w, height: h, floors: [{ id: 'f1', name: '1F', height: 2.8, items: [] }] } as unknown as RoomLayout);

  it('没说每桌人数且一人一套摆不下时，自动升级官方 1.8m×3人规格到够座', () => {
    const plan = localPlan({ base: room(12, 8), floorIndex: 0, widthM: 12, depthM: 8, variant: 1, guests: 40, layoutMode: 'desk-chair' });
    expect(plan.seats ?? 0).toBeGreaterThanOrEqual(40);
    expect((plan.summary ?? []).join(' ')).toContain('官方课桌规格');
  });

  it('人少摆得下时保持一人一套，不越权升级', () => {
    const plan = localPlan({ base: room(12, 9), floorIndex: 0, widthM: 12, depthM: 9, variant: 1, guests: 10, layoutMode: 'desk-chair' });
    const items = plan.layouts.at(-1)!.floors[0]!.items;
    expect(items.filter(item => item.type === 'desk')).toHaveLength(10);
    expect(items.filter(item => item.type === 'chair')).toHaveLength(10);
  });

  it('用户明说每桌人数时不越权（每桌1人摆不下就如实报上限）', () => {
    const plan = localPlan({ base: room(5, 4), floorIndex: 0, widthM: 5, depthM: 4, variant: 1, guests: 45, layoutMode: 'desk-chair', table: { peoplePerTable: 1 } });
    expect(plan.seats ?? 0).toBeLessThan(45);
    expect((plan.summary ?? []).join(' ')).not.toContain('官方课桌规格');
  });
});
