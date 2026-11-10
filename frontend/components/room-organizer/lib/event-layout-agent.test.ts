import { describe, expect, it, vi } from 'vitest';
import { resolveBriefTurn } from '@/lib/agent-resolver';
import { collectViolations } from '../../../lib/placement-rules';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { readBriefMemory, writeBriefMemory } from './assistant-brief-memory';
import { initialBriefMemory, parseBriefTurn } from './brief-agent';
import { eventPreviewInput, eventPreviewScale, isBanquetUtterance, planHeldEvent, spokenHeadcount } from './event-layout-agent';
import { materializeFurnishing, selectFurnishing } from './furnishing-select';
import { backendSceneToLayout } from './backend-adapter';
import { localPlan, omitUnlandedBanquetItems } from './local-plan';
import { countSingleSeats } from './seat-requirement';
import { structuralItemCollides, usableSeatingRect } from './structural-layout';
import { ringDiningSet } from './ring-seating';
import { resolveTableArrangement } from './table-seat-plan';

const bare = { venueUp: false, scaleTyped: false, hasBase: false, command: null };

function placed(plan: ReturnType<typeof localPlan>) {
  return plan.layouts.at(-1)!.floors[0]!.items;
}

describe('agentic event layout', () => {
  it('A. 我想办个生日宴 is intent and asks only for headcount', () => {
    const turn = parseBriefTurn('我想办个生日宴', initialBriefMemory(), bare);
    expect(turn.kind).toBe('ask');
    expect(turn.text).toBe('这场生日宴大概多少人？');
    expect(turn.text).not.toContain('记下了');
    expect(turn.text).not.toContain('围着坐');
    expect(turn.text).not.toContain('场地');
    expect(turn.text).not.toContain('12×9');
    expect(turn.memory.event).toBe('生日宴');
    expect(turn.memory.eventIntent).toEqual({ occasion: '生日宴', awaiting: 'headcount' });
    expect(turn.memory.headcount).toBeNull();
    expect(turn.memory.furnishing).toBeUndefined();
    expect(turn.layoutTools).toBeUndefined();

    const next = parseBriefTurn('80', turn.memory, bare);
    expect(next.kind).toBe('generate');
    expect(next.memory.headcount).toBe(80);
    expect(next.memory.lengthM).toBeNull();
    expect(next.memory.agentVenue).toEqual({ lengthM: 20, widthM: 15 });
    expect(next.memory.furnishing?.shape).toBe('round');
    expect(next.memory.furnishing?.material).toEqual({ rim: 'wood', top: 'linen' });
    expect(next.memory.furnishing?.source).toBe('select_furnishing');
    expect(next.layoutTools?.map(tool => tool.tool)).toEqual(['select_furnishing', 'layout_preview']);
    expect(next.previewLead).toContain('场地没说');
    expect(next.previewLead).toContain('20×15');
    expect(next.previewLead).toContain('确认后才写入');
    expect(next.previewLead).not.toContain('围着坐');
  });

  it('B. 想办个八十人圆桌宴 selects, counts seats, and previews without 想围着坐', () => {
    const raw = '想办个八十人圆桌宴';
    const turn = parseBriefTurn(raw, initialBriefMemory(), bare);
    expect(turn.kind).toBe('generate');
    expect(turn.memory.event).toBe('圆桌宴');
    expect(turn.memory.headcount).toBe(80);
    expect(turn.memory.agentVenue).toEqual({ lengthM: 20, widthM: 15 });
    expect(turn.memory.lengthM).toBeNull();
    expect(turn.memory.furnishing).toEqual(selectFurnishing({ occasion: '圆桌宴', notes: raw, statedShape: 'round' }));
    expect(turn.layoutTools?.map(tool => tool.tool)).toEqual(['select_furnishing', 'layout_preview']);
    expect(turn.layoutTools?.[1]?.summary).toContain('每桌 10 人');
    expect(turn.layoutTools?.[1]?.summary).toContain('8 桌');
    expect(turn.previewLead).toContain('确认后才写入');
    expect(turn.text).not.toContain('围着坐');
    expect(raw).not.toContain('围着坐');

    const request = eventPreviewInput(turn.memory);
    expect(request?.furnishing.source).toBe('select_furnishing');
    const base = makeLayout({ width: 20, height: 15, floors: [makeFloor()] });
    const plan = localPlan({ base, floorIndex: 0, variant: 0, ...request! });
    const items = placed(plan);
    const tables = items.filter(item => item.name === '圆桌');
    const chairs = items.filter(item => item.name === '餐椅');
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.every(item => item.tableShape === 'round' && item.width === 1.4)).toBe(true);
    expect(chairs.length).toBe(tables.length * 10);
    expect(plan.seats ?? 0).toBeGreaterThanOrEqual(80);
    expect(collectViolations(plan.layouts.at(-1)!).filter(violation => violation.code === 'BBOX_OVERLAP' && /圆桌|餐椅/.test(violation.detail))).toEqual([]);
    expect(base.floors[0]!.items).toEqual([]);
    expect(turn.layoutTools?.some(tool => tool.tool === 'layout_preview')).toBe(true);
    expect(turn.layoutTools?.some(tool => /apply|confirm/.test(tool.tool))).toBe(false);
    const storage = memoryBox();
    expect(writeBriefMemory('banquet', turn.memory, storage)).toBe(true);
    const stored = readBriefMemory('banquet', storage);
    expect(stored?.furnishing?.assetName).toBe('圆桌');
    expect(stored?.agentVenue).toEqual({ lengthM: 20, widthM: 15 });
    expect(stored?.headcount).toBe(80);
    expect(stored?.eventIntent).toEqual({ occasion: '圆桌宴' });
  });

function memoryBox(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear() { data.clear(); },
    getItem(key: string) { return data.get(key) ?? null; },
    key(index: number) { return [...data.keys()][index] ?? null; },
    removeItem(key: string) { data.delete(key); },
    setItem(key: string, value: string) { data.set(key, value); },
  };
}

  it('C. diameter, headcount, and hall preview without 想围着坐', async () => {
    const raw = '圆桌直径2.2米，80人，20米乘 15米';
    const turn = parseBriefTurn(raw, initialBriefMemory(), bare);
    expect(turn.kind).toBe('generate');
    expect(turn.memory.headcount).toBe(80);
    expect(turn.memory.lengthM).toBe(20);
    expect(turn.memory.widthM).toBe(15);
    expect(turn.memory.agentVenue).toBeUndefined();
    expect(turn.memory.furnishing?.shape).toBe('round');
    expect(turn.memory.furnishing?.width).toBe(2.2);
    expect(turn.memory.furnishing?.source).toBe('select_furnishing');
    expect(turn.layoutTools?.[0]?.tool).toBe('select_furnishing');
    expect(turn.layoutTools?.[1]?.summary).toContain('每桌 15 人');
    expect(turn.layoutTools?.[1]?.summary).toContain('6 桌');
    expect(turn.previewLead).toContain('按你说的');
    expect(turn.previewLead).not.toContain('围着坐');
    expect(turn.previewLead).not.toContain('每桌 15');
    expect(resolveTableArrangement({ shape: 'round', guests: 80, width: 2.2, depth: 2.2 }).seatsPerTable).toBe(15);

    const base = makeLayout({ width: 20, height: 15, floors: [makeFloor()] });
    const plan = localPlan({ base, floorIndex: 0, variant: 0, ...eventPreviewInput(turn.memory)! });
    const items = placed(plan);
    const tables = items.filter(item => item.name === '圆桌');
    const chairs = items.filter(item => item.name === '餐椅');
    expect(tables[0]?.width).toBe(2.2);
    expect(tables[0]?.tableShape).toBe('round');
    expect(chairs.length / tables.length).toBe(15);
    expect(plan.seats ?? 0).toBeGreaterThanOrEqual(80);
    expect(collectViolations(plan.layouts.at(-1)!).filter(violation => violation.code === 'BBOX_OVERLAP' && /圆桌|餐椅/.test(violation.detail))).toEqual([]);
    expect(base.floors[0]!.items).toEqual([]);

    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    const failed = await resolveBriefTurn(raw, initialBriefMemory(), bare, {
      briefExtract: async () => ({ enabled: false, extraction: null, reason: 'SERVICE_NOT_CONFIGURED' }),
    });
    expect(failed.kind).toBe('generate');
    expect(failed.text).not.toContain('已按本地规则记录');
    expect(failed.memory.furnishing?.width).toBe(2.2);
    vi.unstubAllEnvs();
  });

  it('D. 想围着坐 still previews only after the facts, and confirm is separate', () => {
    let turn = parseBriefTurn('想围着坐', initialBriefMemory(), bare);
    expect(turn.kind).toBe('ask');
    expect(turn.memory.seatingShape).toBe('ring');
    expect(turn.memory.furnishing).toBeUndefined();
    expect(turn.text).not.toContain('没接住');
    turn = parseBriefTurn('80人', turn.memory, bare);
    expect(turn.kind).toBe('ask');
    expect(turn.memory.headcount).toBe(80);
    expect(turn.kind).not.toBe('generate');
    turn = parseBriefTurn('20米乘15米', turn.memory, bare);
    expect(turn.kind).toBe('generate');
    expect(turn.memory.furnishing).toBeUndefined();
    expect(turn.memory.lengthM).toBe(20);
    expect(turn.memory.widthM).toBe(15);
    const base = makeLayout({ width: 20, height: 15, floors: [makeFloor()] });
    const plan = localPlan({
      base,
      floorIndex: 0,
      widthM: 20,
      depthM: 15,
      variant: 0,
      guests: turn.memory.headcount,
      layoutMode: 'dining',
      seatingShape: 'ring',
      stage: false,
      checkin: false,
    });
    const items = placed(plan);
    const tables = items.filter(item => item.name === '圆桌');
    const chairs = items.filter(item => item.name === '餐椅');
    expect(tables.length).toBeGreaterThan(0);
    expect(chairs.length).toBe(tables.length * 10);
    expect(plan.seats ?? 0).toBeGreaterThanOrEqual(80);
    expect(collectViolations(plan.layouts.at(-1)!).filter(violation => violation.code === 'BBOX_OVERLAP' && /圆桌|餐椅/.test(violation.detail))).toEqual([]);
    expect(base.floors[0]!.items).toEqual([]);
  });

  it('E. shape and material come from the selection tool, and layout places that asset', () => {
    const birthday = selectFurnishing({ occasion: '生日宴', notes: '我想办个生日宴' });
    expect(birthday.shape).toBe('round');
    expect(birthday.material).toEqual({ rim: 'wood', top: 'linen' });
    expect(birthday.assetName).toBe('圆桌');
    expect(birthday.source).toBe('select_furnishing');

    const meeting = selectFurnishing({ occasion: '会议', notes: '长桌开会', statedShape: 'long' });
    expect(meeting.shape).toBe('long');
    expect(meeting.assetName).toBe('Dining Table');
    const base = makeLayout({ width: 20, height: 15, floors: [makeFloor()] });
    const plan = localPlan({
      base,
      floorIndex: 0,
      widthM: 20,
      depthM: 15,
      variant: 0,
      guests: 40,
      layoutMode: 'dining',
      table: { shape: 'rect', width: meeting.width, depth: meeting.depth },
      furnishing: meeting,
      stage: false,
      checkin: false,
    });
    const items = placed(plan);
    expect(items.some(item => item.name === '长桌' && item.tableShape === 'rect')).toBe(true);
    expect(items.some(item => item.name === '圆桌' || item.tableShape === 'round')).toBe(false);

    const chosen = materializeFurnishing({ ...birthday, color: '#336699', width: 1.6, depth: 1.6 });
    expect(chosen).not.toBeNull();
    const set = ringDiningSet({ sideM: 1.6, table: chosen!.table, chair: chosen!.chair });
    expect(set.items[0]?.snapshot?.color).toBe('#336699');
    expect(set.items[0]?.snapshot?.width).toBe(1.6);
    expect(planHeldEvent('你好', initialBriefMemory(), { event: null, headcount: null, areaM2: null, lengthM: null, widthM: null, venueIO: null, timeOfDay: null })).toBeNull();
  });

  it('does not treat 办 inside another word as a banquet, and a 吗 question does not preview', () => {
    const blank = { event: null, headcount: null, areaM2: null, lengthM: null, widthM: null, venueIO: null, timeOfDay: null };
    for (const text of ['办公室年会80人', '跟主办方说年会80人', '这个办法不适合生日宴']) {
      const turn = parseBriefTurn(text, initialBriefMemory(), bare);
      expect(turn.kind, text).not.toBe('generate');
      expect(turn.text, text).not.toBe('这场生日宴大概多少人？');
      expect(turn.memory.furnishing, text).toBeUndefined();
    }
    const asked = parseBriefTurn('能办个八十人的生日宴吗', initialBriefMemory(), bare);
    expect(asked.kind).toBe('ask');
    expect(asked.text).toContain('预览');
    expect(asked.memory.furnishing).toBeUndefined();
    expect(asked.memory.headcount).toBe(80);
    expect(asked.memory.eventIntent).toEqual({ occasion: '生日宴' });
    const again = parseBriefTurn('出一版', asked.memory, bare);
    expect(again.kind).toBe('generate');
    expect(again.memory.furnishing?.source).toBe('select_furnishing');
    const bareAsk = parseBriefTurn('能办个生日宴吗', initialBriefMemory(), bare);
    expect(bareAsk.kind).toBe('ask');
    expect(bareAsk.memory.eventIntent).toEqual({ occasion: '生日宴', awaiting: 'headcount' });
    const answered = parseBriefTurn('80个人', bareAsk.memory, bare);
    expect(answered.kind).toBe('generate');
    expect(answered.memory.headcount).toBe(80);
    expect(planHeldEvent('你好', initialBriefMemory(), blank)).toBeNull();
  });

  it('keeps a birthday preview when the cloud model restates 80个人, and 确认 does not stop at notes', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    const context = { venueUp: true, scaleTyped: false, hasBase: true, command: null };
    const prior = { ...initialBriefMemory(), event: '发布会', venueIO: 'indoor' as const };
    const transport = {
      briefExtract: vi.fn(),
      briefConversation: vi.fn()
        .mockResolvedValueOnce({ enabled: true, extraction: { event: '生日宴' }, reply: '好的，为您策划生日宴。', unhandled: [], factEvidence: [] })
        .mockResolvedValueOnce({ enabled: true, extraction: { event: '生日宴', headcount: 80 }, reply: '已记下预计80人参加生日宴。', unhandled: [], factEvidence: [] }),
    };
    const first = await resolveBriefTurn('我想办个生日宴', prior, context, transport, undefined, { history: [] });
    expect(first.kind).toBe('ask');
    expect(first.text).toBe('这场生日宴大概多少人？');
    expect(first.memory.event).toBe('生日宴');
    const second = await resolveBriefTurn('80个人', first.memory, context, transport, undefined, { history: [] });
    expect(second.kind).toBe('generate');
    expect(second.memory.event).toBe('生日宴');
    expect(second.memory.headcount).toBe(80);
    expect(second.memory.furnishing?.source).toBe('select_furnishing');
    expect(second.text).not.toContain('已记下你确认的信息');
    const sticky = await resolveBriefTurn('我想办个生日宴', prior, context, {
      briefExtract: vi.fn(),
      briefConversation: vi.fn().mockResolvedValue({ enabled: true, extraction: { event: '发布会', venueIO: 'indoor' }, reply: '继续这场发布会。', unhandled: [], factEvidence: [] }),
    }, undefined, { history: [] });
    expect(sticky.kind).toBe('ask');
    expect(sticky.text).toBe('这场生日宴大概多少人？');
    expect(sticky.text).not.toContain('已记下你确认的信息');
    expect(sticky.memory.event).toBe('生日宴');
    expect(sticky.memory.eventIntent?.occasion).toBe('生日宴');
    const confirmedSticky = await resolveBriefTurn('确认', {
      ...sticky.memory,
      pendingBasicFacts: [
        { key: 'event', value: '发布会', requiresRestatement: false },
        { key: 'venueIO', value: 'indoor', requiresRestatement: false },
      ],
    }, context);
    expect(confirmedSticky.text).not.toContain('已记下你确认的信息');
    expect(confirmedSticky.kind).toBe('ask');
    expect(confirmedSticky.text).toContain('这场生日宴大概多少人');
    expect(confirmedSticky.memory.event).toBe('生日宴');
    const counted = await resolveBriefTurn('80个人', confirmedSticky.memory, context, {
      briefExtract: vi.fn(),
      briefConversation: vi.fn().mockResolvedValue({ enabled: true, extraction: { event: '发布会', venueIO: 'indoor', headcount: 80 }, reply: '请核对。', unhandled: [], factEvidence: [] }),
    }, undefined, { history: [] });
    expect(counted.kind).toBe('generate');
    expect(counted.memory.event).toBe('生日宴');
    expect(counted.memory.headcount).toBe(80);
    expect(counted.layoutTools?.some(call => call.tool === 'select_furnishing')).toBe(true);
    const sized = await resolveBriefTurn('确认', {
      ...counted.memory,
      lengthM: null,
      widthM: null,
      areaM2: null,
      pendingBasicFacts: [
        { key: 'lengthM', value: 20, requiresRestatement: false },
        { key: 'widthM', value: 15, requiresRestatement: false },
        { key: 'timeOfDay', value: 18, requiresRestatement: false },
      ],
    }, context);
    expect(sized.kind).toBe('generate');
    expect(sized.text).not.toContain('已记下你确认的信息');
    expect(sized.memory.event).toBe('生日宴');
    expect(sized.memory.headcount).toBe(80);
    expect(sized.memory.lengthM).toBeNull();
    expect(sized.memory.widthM).toBeNull();
    expect(sized.extraction.lengthM).toBeNull();
    expect(sized.extraction.widthM).toBeNull();
  });

  it('seats 80 at Ø2.2 on a 23.8×16.1 map shell and does not confirm a partial plan', () => {
    const choice = selectFurnishing({ occasion: '圆桌宴', notes: '圆桌直径2.2米', statedShape: 'round', statedWidth: 2.2 });
    const hall = makeLayout({ id: 'pinghu', name: '西湖·平湖秋月', width: 23.8, height: 16.1, roof: { style: 'hipped', color: '#8a8a8a' } });
    hall.backendSceneV2 = { venue: { site: { indoorOutdoor: 'outdoor' } } } as NonNullable<typeof hall.backendSceneV2>;
    const plan = (width: number, height: number, base = makeLayout({ width, height })) => localPlan({
      base, floorIndex: 0, widthM: width, depthM: height, variant: 0, guests: 80,
      layoutMode: 'dining', seatingShape: 'ring',
      table: { shape: 'round', width: 2.2, depth: 2.2 }, furnishing: choice, stage: false, checkin: false,
    });
    const full = plan(23.8, 16.1, hall);
    const chairs = full.layouts.at(-1)!.floors[0]!.items.filter(item => item.type === 'dining-chair');
    expect(chairs.length).toBeGreaterThanOrEqual(80);
    expect(full.blocked ?? null).toBeNull();
    expect(full.summary?.some(line => /约 \d+ 桌/.test(line))).toBe(true);
    const partial = plan(14, 12);
    expect(partial.seats ?? 0).toBeGreaterThanOrEqual(40);
    expect(partial.seats ?? 0).toBeLessThan(80);
    expect(partial.blocked).toContain('没有按满员桌数确认');
    expect(partial.summary?.some(line => /约 \d+ 桌/.test(line))).toBe(false);
    const added = localPlan({
      base: makeLayout({ width: 14, height: 12 }),
      floorIndex: 0, widthM: 14, depthM: 12, variant: 0, guests: 80, seatPriority: true,
      layoutMode: 'dining', seatingShape: 'ring',
      table: { shape: 'round', width: 2.2, depth: 2.2 }, furnishing: choice, stage: false, checkin: false,
    });
    if ((added.seats ?? 0) < 80) {
      expect(added.blocked).toContain('没有按满员桌数确认');
      expect(added.seats ?? 0).toBeGreaterThanOrEqual(40);
    } else {
      expect(added.blocked ?? null).toBeNull();
    }
  });

  it('does not confirm Ø2.2 for 80 people when a map-shell wall rejects chairs and leftover chairs would otherwise fill the count', () => {
    const choice = selectFurnishing({ occasion: '圆桌宴', notes: '圆桌直径2.2米', statedShape: 'round', statedWidth: 2.2 });
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const hall = backendSceneToLayout({
      schemaVersion: 2,
      venue: { shape: 'rectangle', width: 23.8, depth: 16.1, height: 3, entrances: [], site: { indoorOutdoor: 'outdoor' } },
      objects: [],
      camera: 'overview',
      lighting: 'neutral',
      structure: {
        walls: [
          { id: id(1), start: { x: 0, z: 0 }, end: { x: 23.8, z: 0 }, thickness: 0.4, height: 3, kind: 'exterior', status: 'confirmed' },
          { id: id(2), start: { x: 23.8, z: 0 }, end: { x: 23.8, z: 16.1 }, thickness: 0.4, height: 3, kind: 'exterior', status: 'confirmed' },
          { id: id(3), start: { x: 23.8, z: 16.1 }, end: { x: 0, z: 16.1 }, thickness: 0.4, height: 3, kind: 'exterior', status: 'confirmed' },
          { id: id(4), start: { x: 0, z: 16.1 }, end: { x: 0, z: 0 }, thickness: 0.4, height: 3, kind: 'exterior', status: 'confirmed' },
          { id: id(5), start: { x: 0.4, z: 6.2 }, end: { x: 23.4, z: 6.2 }, thickness: 2, height: 3, kind: 'interior', status: 'confirmed' },
        ],
        openings: [],
        columns: [],
      },
      sources: [],
      dimensions: [],
    }, { name: '西湖·平湖秋月', projectId: 'pinghu-columns' });
    const kept = Array.from({ length: 12 }, (_, index) => makeItem({
      id: `kept-chair-${index}`,
      type: 'dining-chair',
      name: '餐椅',
      width: 0.45,
      depth: 0.45,
      height: 0.9,
      locked: true,
      position: { x: -10 + (index % 6) * 0.7, z: 6.5 + Math.floor(index / 6) * 0.7 },
    }));
    hall.floors[0]!.items.push(...kept);
    const input = {
      base: hall, floorIndex: 0, widthM: 23.8, depthM: 16.1, variant: 0, guests: 80,
      layoutMode: 'dining' as const, seatingShape: 'ring' as const,
      table: { shape: 'round' as const, width: 2.2, depth: 2.2 }, furnishing: choice, stage: false, checkin: false,
    };
    const plan = localPlan(input);
    const floor = plan.layouts.at(-1)!.floors[0]!;
    const keptIds = new Set(kept.map(item => item.id));
    const landed = floor.items.filter(item => item.type === 'dining-chair' && !keptIds.has(item.id));
    expect(landed.length).toBeGreaterThan(0);
    expect(landed.length).toBeLessThan(80);
    expect(plan.seats).toBe(landed.length);
    expect(plan.seats ?? 0).toBeLessThan(80);
    // Locked chairs still sit in the room, but they must not pad this pass's receipt.
    expect(countSingleSeats(plan.layouts.at(-1), 0)).toBeGreaterThan(plan.seats ?? 0);
    expect(plan.blocked).toContain('没有按满员桌数确认');
    expect(plan.blocked).toContain(`${landed.length} 座`);
    expect(plan.summary?.some(line => /约 \d+ 桌/.test(line))).toBe(false);
    expect(landed.length % 15).toBe(0);
    expect(plan.layouts.at(-1)!.width).toBeCloseTo(23.8);
    expect(plan.layouts.at(-1)!.height).toBeCloseTo(16.1);
    const denser = localPlan({ ...input, seatPriority: true });
    expect(denser.seats ?? 0).toBeLessThan(80);
    expect(denser.blocked).toContain('没有按满员桌数确认');
    expect(denser.layouts.at(-1)!.width).toBeCloseTo(23.8);
  });

  it('does not count Ø2.2 chairs outside a shell that sits inside the 23.8×16.1 frame', () => {
    const choice = selectFurnishing({ occasion: '圆桌宴', notes: '圆桌直径2.2米', statedShape: 'round', statedWidth: 2.2 });
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const hall = backendSceneToLayout({
      schemaVersion: 2,
      venue: {
        shape: 'polygon', width: 23.8, depth: 16.1, height: 3, entrances: [], site: { indoorOutdoor: 'outdoor' },
        polygon: [{ x: 0, z: 0 }, { x: 23.8, z: 0 }, { x: 23.8, z: 16.1 }, { x: 0, z: 16.1 }],
      },
      objects: [],
      camera: 'overview',
      lighting: 'neutral',
      structure: {
        walls: [
          { id: id(1), start: { x: 4, z: 3.2 }, end: { x: 19.8, z: 3.2 }, thickness: 0.4, height: 3, kind: 'exterior', status: 'confirmed' },
          { id: id(2), start: { x: 19.8, z: 3.2 }, end: { x: 19.8, z: 12.9 }, thickness: 0.4, height: 3, kind: 'exterior', status: 'confirmed' },
          { id: id(3), start: { x: 19.8, z: 12.9 }, end: { x: 4, z: 12.9 }, thickness: 0.4, height: 3, kind: 'exterior', status: 'confirmed' },
          { id: id(4), start: { x: 4, z: 12.9 }, end: { x: 4, z: 3.2 }, thickness: 0.4, height: 3, kind: 'exterior', status: 'confirmed' },
        ],
        openings: [],
        columns: [],
      },
      sources: [],
      dimensions: [],
    }, { name: '西湖·平湖秋月', projectId: 'pinghu-shell' });
    expect(hall.backendVenue?.polygon).toHaveLength(4);
    expect(hall.floors[0]?.interiorWalls).toHaveLength(4);
    const input = {
      base: hall, floorIndex: 0, widthM: 23.8, depthM: 16.1, variant: 0, guests: 80,
      layoutMode: 'dining' as const, seatingShape: 'ring' as const,
      table: { shape: 'round' as const, width: 2.2, depth: 2.2 }, furnishing: choice, stage: false, checkin: false,
    };
    const plan = localPlan(input);
    const candidate = plan.layouts.at(-1)!;
    const chairs = candidate.floors[0]!.items.filter(item => item.type === 'dining-chair');
    const tables = candidate.floors[0]!.items.filter(item => item.type === 'dining-table');
    const room = usableSeatingRect(hall, 0);
    expect(room).not.toBeNull();
    expect(room!.w * room!.d).toBeLessThan(23.8 * 16.1);
    expect(tables.length).toBeGreaterThanOrEqual(2);
    expect(chairs.length).toBe(tables.length * 15);
    expect(plan.seats).toBe(chairs.length);
    for (const chair of chairs) {
      expect(chair.position!.x).toBeGreaterThan(room!.x);
      expect(chair.position!.x).toBeLessThan(room!.x + room!.w);
      expect(chair.position!.z).toBeGreaterThan(room!.z);
      expect(chair.position!.z).toBeLessThan(room!.z + room!.d);
    }
    const lawn = makeItem({
      id: 'lawn-chair', type: 'dining-chair', name: '餐椅', width: 0.45, depth: 0.45, height: 0.9,
      position: { x: 1 - 11.9, z: 1 - 8.05 },
    });
    // Center sits just inside the north wall centerline; the body crosses the inner face.
    const grazer = makeItem({
      id: 'graze-chair', type: 'dining-chair', name: '餐椅', width: 0.45, depth: 0.45, height: 0.9,
      position: { x: 0, z: 12.9 - 0.05 - 8.05 },
    });
    const dirty = { ...candidate, floors: candidate.floors.map((floor, index) => index ? floor : { ...floor, items: [...floor.items, lawn, grazer] }) };
    expect(structuralItemCollides(lawn, dirty, 0)).toBe(true);
    expect(structuralItemCollides(grazer, dirty, 0)).toBe(true);
    const cleaned = omitUnlandedBanquetItems(dirty, 0, new Set());
    expect(cleaned.floors[0]!.items.some(item => item.id === 'lawn-chair' || item.id === 'graze-chair')).toBe(false);
    expect(countSingleSeats(cleaned, 0)).toBe(plan.seats);
    expect(plan.seats).toBe(countSingleSeats(candidate, 0));
    expect(plan.seats ?? 0).toBeLessThan(dirty.floors[0]!.items.filter(item => item.type === 'dining-chair').length);
    expect(chairs.every(item => !structuralItemCollides(item, candidate, 0))).toBe(true);
    expect(plan.seats ?? 0).toBeGreaterThan(0);
    expect(plan.seats ?? 0).toBeLessThan(80);
    const near = makeItem({
      id: 'near-chair', type: 'dining-chair', name: '餐椅', width: 0.45, depth: 0.45, height: 0.9,
      position: { x: 0, z: 12.425 - 8.05 },
    });
    const withNear = { ...candidate, floors: candidate.floors.map((floor, index) => index ? floor : { ...floor, items: [...floor.items, near] }) };
    expect(structuralItemCollides(near, withNear, 0)).toBe(false);
    const withoutNear = omitUnlandedBanquetItems(withNear, 0, new Set());
    expect(withoutNear.floors[0]!.items.some(item => item.id === 'near-chair')).toBe(false);
    expect(plan.seats).toBe(withoutNear.floors[0]!.items.filter(item => item.type === 'dining-chair' && item.id !== 'near-chair').length);
    expect(plan.blocked).not.toContain('每桌 15');
    expect(plan.blocked).toContain('这间厅按');
    expect(plan.blocked).toMatch(/换成 Ø\d+\.\d+ 米，同一间室内可以落下 \d+ 座/);
    expect(plan.blocked).toContain('没有按满员桌数确认');
    expect(plan.blocked).toContain(`${plan.seats} 座`);
    expect(candidate.width).toBeCloseTo(23.8);
    expect(candidate.height).toBeCloseTo(16.1);
    const denser = localPlan({ ...input, seatPriority: true });
    const denserChairs = denser.layouts.at(-1)!.floors[0]!.items.filter(item => item.type === 'dining-chair');
    expect(denser.seats).toBe(countSingleSeats(denser.layouts.at(-1), 0));
    expect(denserChairs.every(item => !structuralItemCollides(item, denser.layouts.at(-1)!, 0))).toBe(true);
    expect(denser.seats ?? 0).toBeGreaterThanOrEqual(plan.seats ?? 0);
    if ((denser.seats ?? 0) < 80) expect(denser.blocked).toContain('没有按满员桌数确认');
    expect(isBanquetUtterance('圆桌直径2.2米，80人，20米乘15米')).toBe(true);
    expect(isBanquetUtterance('80 人发布会，室内 12×9，安排签到和主舞台')).toBe(false);
  });

  it('keeps a short add-seats pass blocked when the tighter shell cannot hold 80', () => {
    const choice = selectFurnishing({ occasion: '圆桌宴', notes: '圆桌直径2.2米', statedShape: 'round', statedWidth: 2.2 });
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const hall = backendSceneToLayout({
      schemaVersion: 2,
      venue: {
        shape: 'polygon', width: 23.8, depth: 16.1, height: 3, entrances: [], site: { indoorOutdoor: 'outdoor' },
        polygon: [{ x: 0, z: 0 }, { x: 23.8, z: 0 }, { x: 23.8, z: 16.1 }, { x: 0, z: 16.1 }],
      },
      objects: [], camera: 'overview', lighting: 'neutral',
      structure: {
        walls: [
          { id: id(1), start: { x: 9, z: 6 }, end: { x: 15, z: 6 }, thickness: 0.4, height: 3, kind: 'exterior', status: 'confirmed' },
          { id: id(2), start: { x: 15, z: 6 }, end: { x: 15, z: 11 }, thickness: 0.4, height: 3, kind: 'exterior', status: 'confirmed' },
          { id: id(3), start: { x: 15, z: 11 }, end: { x: 9, z: 11 }, thickness: 0.4, height: 3, kind: 'exterior', status: 'confirmed' },
          { id: id(4), start: { x: 9, z: 11 }, end: { x: 9, z: 6 }, thickness: 0.4, height: 3, kind: 'exterior', status: 'confirmed' },
        ],
        openings: [], columns: [],
      },
      sources: [], dimensions: [],
    }, { name: '西湖·平湖秋月', projectId: 'pinghu-tight' });
    const input = {
      base: hall, floorIndex: 0, widthM: 23.8, depthM: 16.1, variant: 0, guests: 80,
      layoutMode: 'dining' as const, seatingShape: 'ring' as const,
      table: { shape: 'round' as const, width: 2.2, depth: 2.2 }, furnishing: choice, stage: false, checkin: false,
    };
    const plan = localPlan(input);
    const denser = localPlan({ ...input, seatPriority: true });
    expect(plan.seats ?? 0).toBeGreaterThan(0);
    expect(plan.seats).toBe(countSingleSeats(plan.layouts.at(-1), 0));
    const tightChairs = plan.layouts.at(-1)!.floors[0]!.items.filter(item => item.type === 'dining-chair');
    const tightTables = plan.layouts.at(-1)!.floors[0]!.items.filter(item => item.type === 'dining-table');
    expect(tightChairs.length).toBe(tightTables.length * 15);
    expect(plan.seats).toBe(tightChairs.length);
    expect(denser.seats ?? 0).toBeGreaterThanOrEqual(plan.seats ?? 0);
    expect(denser.seats ?? 0).toBeLessThan(80);
    expect(denser.blocked).toContain('没有按满员桌数确认');
    if ((denser.seats ?? 0) === (plan.seats ?? 0)) expect(denser.blocked).toContain('加不进更多整桌');
    expect(denser.layouts.at(-1)!.width).toBeCloseTo(23.8);
  });

  it('accepts 个人 and a per-table count, and still plans from an area or a 发布会', () => {
    expect(spokenHeadcount('大概80个人')).toBe(80);
    expect(spokenHeadcount('八十个人')).toBe(80);
    expect(spokenHeadcount('80人，每桌10人')).toBe(80);
    const counted = parseBriefTurn('我想办个生日宴', initialBriefMemory(), bare);
    const people = parseBriefTurn('80个人', counted.memory, bare);
    expect(people.kind).toBe('generate');
    expect(people.memory.headcount).toBe(80);
    const perTable = parseBriefTurn('想办个八十人圆桌宴，每桌12人', initialBriefMemory(), bare);
    expect(perTable.kind).toBe('generate');
    expect(perTable.memory.banquetTable?.peoplePerTable).toBe(12);
    expect(perTable.memory.furnishing?.width ?? 0).toBeGreaterThan(1.4);
    expect(perTable.layoutTools?.[1]?.summary).toMatch(/每桌 1[2-6] 人/);
    const area = parseBriefTurn('300平', initialBriefMemory(), bare);
    const banquet = parseBriefTurn('想办个八十人圆桌宴', area.memory, bare);
    expect(banquet.kind).toBe('generate');
    expect(banquet.memory.furnishing?.source).toBe('select_furnishing');
    expect(banquet.memory.agentVenue).toBeUndefined();
    expect(banquet.memory.areaM2).toBe(300);
    expect(banquet.previewLead).toContain('折成');
    const launch = parseBriefTurn('我想办个发布会', initialBriefMemory(), bare);
    expect(launch.kind).toBe('ask');
    expect(launch.text).toBe('这场发布会大概多少人？');
    expect(launch.text).not.toContain('场地');
  });

  it('replaces a saved table when the user states a new diameter, and does not preview an unrelated turn after a model failure', async () => {
    const first = parseBriefTurn('想办个八十人圆桌宴', initialBriefMemory(), bare);
    expect(first.memory.furnishing?.width).toBe(1.4);
    const next = parseBriefTurn('圆桌直径2.2米', first.memory, bare);
    expect(next.kind).toBe('generate');
    expect(next.memory.furnishing?.width).toBe(2.2);
    expect(next.memory.banquetTable?.width).toBe(2.2);
    expect(next.layoutTools?.[0]?.tool).toBe('select_furnishing');
    expect(next.previewLead).toContain('2.20');
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    const kept = { ...first.memory, lengthM: 20 as number, widthM: 15 as number };
    delete kept.agentVenue;
    const unrelated = await resolveBriefTurn('改到室内', kept, { ...bare, venueUp: true }, {
      briefExtract: async () => ({ enabled: false, extraction: null, reason: 'SERVICE_NOT_CONFIGURED' }),
    });
    expect(unrelated.layoutTools).toBeUndefined();
    expect(unrelated.kind).not.toBe('generate');
    vi.unstubAllEnvs();
    expect(eventPreviewScale(
      { length: 18, width: 10, origin: 'typed', fromVenue: true },
      { agentVenue: { lengthM: 20, widthM: 15 }, lengthM: null, widthM: null, areaM2: null },
    )).toEqual({ length: 18, width: 10, origin: 'typed', assumed: false, keptHall: false });
    expect(eventPreviewScale(
      { length: 12, width: 8, origin: 'canvas', fromVenue: false },
      { agentVenue: { lengthM: 20, widthM: 15 }, lengthM: null, widthM: null, areaM2: null },
    )).toEqual({ length: 20, width: 15, origin: 'canvas', assumed: true, keptHall: false });
    expect(eventPreviewScale(
      { length: 20, width: 15, origin: 'stated', fromVenue: false },
      { agentVenue: undefined, lengthM: 20, widthM: 15, areaM2: null },
      { length: 23.8, width: 16.1 },
    )).toEqual({ length: 23.8, width: 16.1, origin: 'canvas', assumed: false, keptHall: true });
  });
});
