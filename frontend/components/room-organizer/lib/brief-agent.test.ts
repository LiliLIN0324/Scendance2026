import { describe, expect, it } from 'vitest';
import { initialBriefMemory, memoryExtraction, parseBriefTurn, summarizeMemory } from './brief-agent';

/** 画布上还没立场地、也没拖图纸的默认语境。 */
const bare = { venueUp: false, scaleTyped: false, hasBase: false, command: null as null | 'again' | 'first' };
/** 场地已经立起来的语境（壳体/模板都算）。 */
const venueUp = { ...bare, venueUp: true };

describe('parseBriefTurn — 记忆槽位跨句累积，失配不再退回开场白', () => {
  it('开场一句话齐全：直接出方案，记忆记全', () => {
    const turn = parseBriefTurn('80 人，室内 12×9', initialBriefMemory(), bare);
    expect(turn.kind).toBe('generate');
    expect(turn.memory.headcount).toBe(80);
    expect(turn.memory.venueIO).toBe('indoor');
    expect(turn.memory.lengthM).toBe(12);
  });

  it('刚问完多少人，答「80」裸数字也落进人数槽，不再重复问一遍', () => {
    const first = parseBriefTurn('我需要给小学老师上课', initialBriefMemory(), bare);
    expect(first.kind).toBe('ask');
    expect(first.text).toContain('教学');
    const second = parseBriefTurn('80', first.memory, bare);
    expect(second.kind).toBe('ask');
    expect(second.memory.headcount).toBe(80);
    expect(second.text).toContain('80 人');
    expect(second.text).not.toContain('这场大概多少人');
  });

  it('追问答完尺寸：记下了并直接出方案，不走「只改尺寸」分支', () => {
    const asked = parseBriefTurn('80 人', initialBriefMemory(), bare);
    expect(asked.kind).toBe('ask');
    const answer = parseBriefTurn('39×20', asked.memory, bare);
    expect(answer.kind).toBe('generate');
    expect(answer.filledScaleAsk).toBe(true);
  });

  it('「小朋友是要一张课桌配一个椅子的啊」：接住课桌椅形态，场地已立就直接出方案', () => {
    const memory = { ...initialBriefMemory(), headcount: 80, lengthM: 39, widthM: 20 };
    const turn = parseBriefTurn('小朋友是要一张课桌配一个椅子的啊', memory, venueUp);
    expect(turn.kind).toBe('generate');
    expect(turn.memory.layoutMode).toBe('desk-chair');
    expect(turn.memory.event).toBe('教学');
  });

  it('「是一张桌子配一个椅子 要80套」：套数即人数，按一人一套出方案', () => {
    const turn = parseBriefTurn('是一张桌子配一个椅子 要80套', initialBriefMemory(), venueUp);
    expect(turn.kind).toBe('generate');
    expect(turn.memory.layoutMode).toBe('desk-chair');
    expect(turn.memory.headcount).toBe(80);
  });

  it('没接住的话不装失忆：复述已记下的要素，而不是把开场白再说一遍', () => {
    const memory = { ...initialBriefMemory(), headcount: 80, lengthM: 39, widthM: 20, venueIO: 'indoor' as const };
    const turn = parseBriefTurn('就这样吧嗯嗯', memory, venueUp);
    expect(turn.kind).toBe('ack');
    expect(turn.text).toContain('已记下');
    expect(turn.text).toContain('80 人');
    // 尺度也是人给过的事实：复述里吞掉它，下一句就得重新报一遍尺寸。
    expect(turn.text).toContain('39 × 20 m');
    expect(turn.text).not.toContain('这场大概多少人');
  });

  it('什么都不知道时没接住：如实说，给一个能照抄的例子', () => {
    const turn = parseBriefTurn('嗯嗯', initialBriefMemory(), bare);
    expect(turn.kind).toBe('none');
    expect(turn.text).toContain('80 人，室内 12×9');
  });

  it('追问过尺寸还没听到：换一种说法，不重复同一句', () => {
    const first = parseBriefTurn('80 人', initialBriefMemory(), bare);
    expect(first.kind).toBe('ask');
    const again = parseBriefTurn('你猜', first.memory, bare);
    expect(again.kind).toBe('ask');
    expect(again.text).not.toBe(first.text);
    expect(again.text).toContain('长宽');
  });

  it('课桌椅形态记住后，「换一版」仍按一人一套重排', () => {
    const memory = { ...initialBriefMemory(), headcount: 80, lengthM: 39, widthM: 20, layoutMode: 'desk-chair' as const };
    const turn = parseBriefTurn('换一版', memory, { ...venueUp, command: 'again' });
    expect(turn.kind).toBe('generate');
    expect(turn.memory.layoutMode).toBe('desk-chair');
  });

  it('「改成 15×10」仍然只动场地壳：不出方案标记（由面板按 filledScaleAsk=false 判定）', () => {
    const turn = parseBriefTurn('改成 15×10', { ...initialBriefMemory(), headcount: 80 }, venueUp);
    expect(turn.kind).toBe('generate');
    expect(turn.filledScaleAsk).toBe(false);
    expect(turn.memory.lengthM).toBe(15);
  });
});

describe('summarizeMemory / memoryExtraction', () => {
  it('记忆复述按 人数 · 室内外 · 尺度 · 形态 · 类型 拼', () => {
    const memory = { ...initialBriefMemory(), headcount: 80, venueIO: 'indoor' as const, layoutMode: 'desk-chair' as const, event: '教学' };
    expect(summarizeMemory(memory)).toBe('80 人 · 室内 · 一人一套课桌椅 · 教学');
    expect(summarizeMemory({ ...memory, lengthM: 12, widthM: 9 })).toBe('80 人 · 室内 · 12 × 9 m · 一人一套课桌椅 · 教学');
    // 只报过面积：复述就报面积，不替人编一个长宽。
    expect(summarizeMemory({ ...memory, areaM2: 300 })).toBe('80 人 · 室内 · 300 ㎡ · 一人一套课桌椅 · 教学');
  });

  it('记忆折回 extraction：scaleFrom 与左栏同步还吃老形状', () => {
    const memory = { ...initialBriefMemory(), headcount: 80, lengthM: 39, widthM: 20 };
    const extraction = memoryExtraction(memory);
    expect(extraction.headcount).toBe(80);
    expect(extraction.lengthM).toBe(39);
    expect(extraction.timeOfDay).toBeNull();
  });
});
