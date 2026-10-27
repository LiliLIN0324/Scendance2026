import { describe, expect, it } from 'vitest';
import { initialBriefMemory, parseBriefTurn, summarizeMemory } from './brief-agent';
import type { BriefExtraction } from './workbench-agent';

/** 复现面板 resolveBriefTurn 的模型预提取入参：线上 Qwen3-8B 只填听到的槽，其余 null。 */
const slot = (partial: Partial<BriefExtraction>): BriefExtraction & { layoutMode: null } => ({
  event: null, headcount: null, areaM2: null, lengthM: null, widthM: null, venueIO: null, timeOfDay: null, layoutMode: null, ...partial,
});
const ctx = { venueUp: false, scaleTyped: false, hasBase: false, command: null as null | 'again' | 'first' };

describe('用户手测 5 句对话序列（模型槽位按线上实测风格注入）', () => {
  it('全链路不复读、不出空话', () => {
    let mem = initialBriefMemory();
    const log: string[] = [];

    // 句1：只说类型
    let turn = parseBriefTurn('我需要给小学老师上课', mem, ctx, slot({ event: '小学老师上课' }));
    mem = turn.memory;
    log.push(`句1 → [${turn.kind}] ${turn.text}`);
    expect(mem.event).toBe('小学老师上课');
    expect(turn.text).not.toBe('');

    // 句2：裸数字 80 —— 死循环回归点
    turn = parseBriefTurn('80', mem, ctx, slot({ headcount: 80 }));
    mem = turn.memory;
    log.push(`句2 → [${turn.kind}] ${turn.text}`);
    expect(mem.headcount).toBe(80);
    expect(turn.text).not.toContain('拖张图纸进来');
    expect(turn.text).not.toBe('');

    // 句3：尺寸
    turn = parseBriefTurn('39×20', mem, ctx, slot({ lengthM: 39, widthM: 20 }));
    mem = turn.memory;
    log.push(`句3 → [${turn.kind}] ${turn.text}`);
    expect(mem.lengthM).toBe(39);
    expect(mem.widthM).toBe(20);

    // 句4：课桌椅形态（尺寸已齐 → 直接 generate，text 由面板组句）
    turn = parseBriefTurn('小朋友要一张课桌配一个椅子', mem, ctx, slot({}));
    mem = turn.memory;
    log.push(`句4 → [${turn.kind}] ${turn.text}`);
    expect(mem.layoutMode).toBe('desk-chair');
    expect(turn.kind).toBe('generate');

    // 句5：换一版
    turn = parseBriefTurn('换一版', mem, { ...ctx, command: 'again' });
    mem = turn.memory;
    log.push(`句5 → [${turn.kind}] ${turn.text}`);
    expect(turn.kind).toBe('generate');

    console.log('==== 对话轨迹 ====\n' + log.join('\n') + `\n==== 记忆 ====\n${summarizeMemory(mem)}`);
  });
});
