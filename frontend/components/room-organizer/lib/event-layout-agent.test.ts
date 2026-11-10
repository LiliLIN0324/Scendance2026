import { describe, expect, it, vi } from 'vitest';
import { resolveBriefTurn } from '@/lib/agent-resolver';
import { collectViolations } from '../../../lib/placement-rules';
import { makeFloor, makeLayout } from './__testfixtures__/fixtures';
import { readBriefMemory, writeBriefMemory } from './assistant-brief-memory';
import { initialBriefMemory, parseBriefTurn } from './brief-agent';
import { eventPreviewInput, eventPreviewScale, planHeldEvent, spokenHeadcount } from './event-layout-agent';
import { materializeFurnishing, selectFurnishing } from './furnishing-select';
import { localPlan } from './local-plan';
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
