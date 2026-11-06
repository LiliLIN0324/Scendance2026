import { describe, expect, it } from 'vitest';
import {
  briefTarget,
  deadlinePressure,
  looksStalled,
  renderTurnBrief,
  summarizeTrace,
  toolKind,
  type TurnTraceEntry,
} from '../supabase/functions/_shared/turn-brief.ts';

const read = (tool: string, target: string, turn = 1): TurnTraceEntry => ({ turn, tool, ok: true, target });

describe('toolKind', () => {
  it('只读、试算、落地三档分开', () => {
    expect(toolKind('inspect_zone')).toBe('read');
    expect(toolKind('find_free_areas')).toBe('probe');
    expect(toolKind('create_parametric_model')).toBe('write');
  });

  it('未知工具按落地算，不把写当只读', () => {
    expect(toolKind('some_future_tool')).toBe('write');
  });
});

describe('briefTarget', () => {
  it('同一块矩形换顺序仍是同一标识', () => {
    expect(briefTarget('inspect_zone', { x1: 30, z1: 80, x2: 40, z2: 90 })).toBe('rect(30,80,40,90)');
    expect(briefTarget('inspect_zone', { x1: 40, z1: 90, x2: 30, z2: 80 })).toBe('rect(30,80,40,90)');
  });

  it('坐标取整，浮点抖动不会让同一块地变成两块', () => {
    expect(briefTarget('inspect_zone', { x1: 30.4, z1: 80.2, x2: 40.6, z2: 90.5 })).toBe('rect(30,80,41,91)');
  });

  it('缺参数时返回 undefined，不硬造标识', () => {
    expect(briefTarget('inspect_zone', { x1: 30 })).toBeUndefined();
    expect(briefTarget('find_free_areas', { width: 4 })).toBeUndefined();
  });
});

describe('looksStalled', () => {
  it('同一块地方连查三次判为打转', () => {
    const trace = [read('inspect_zone', 'rect(30,80,40,90)'), read('inspect_zone', 'rect(30,80,40,90)'), read('inspect_zone', 'rect(30,80,40,90)')];
    expect(looksStalled(trace)).toEqual({ stalled: true, tool: 'inspect_zone', target: 'rect(30,80,40,90)', count: 3 });
  });

  it('两次不算，第三次才算', () => {
    expect(looksStalled([read('inspect_zone', 'rect(30,80,40,90)'), read('inspect_zone', 'rect(30,80,40,90)')]).stalled).toBe(false);
  });

  it('中间夹了落地动作就是正常复核，不算打转', () => {
    const trace = [
      read('inspect_zone', 'rect(30,80,40,90)'),
      read('inspect_zone', 'rect(30,80,40,90)'),
      { turn: 2, tool: 'customize_material', ok: true } as TurnTraceEntry,
      read('inspect_zone', 'rect(30,80,40,90)'),
    ];
    expect(looksStalled(trace).stalled).toBe(false);
  });

  it('换着地方查不算打转', () => {
    const trace = [read('inspect_zone', 'rect(30,80,40,90)'), read('inspect_zone', 'rect(50,80,60,90)'), read('inspect_zone', 'rect(70,80,80,90)')];
    expect(looksStalled(trace).stalled).toBe(false);
  });
});

describe('summarizeTrace', () => {
  it('连续同目标合并成 ×N', () => {
    expect(summarizeTrace([read('inspect_zone', 'rect(30,80,40,90)'), read('inspect_zone', 'rect(30,80,40,90)')])).toContain('×2');
  });

  it('失败带错误码，且不参与合并', () => {
    const text = summarizeTrace([
      { turn: 1, tool: 'create_parametric_model', ok: false, code: 'RESOURCE_NOT_FOUND' } as TurnTraceEntry,
      { turn: 2, tool: 'create_parametric_model', ok: false, code: 'RESOURCE_NOT_FOUND' } as TurnTraceEntry,
    ]);
    expect(text).toContain('✗RESOURCE_NOT_FOUND');
  });

  it('超出窗口的部分标出条数', () => {
    const trace = Array.from({ length: 12 }, (_, i) => read('inspect_zone', `rect(${i},0,${i + 1},1)`, i));
    expect(summarizeTrace(trace, 5)).toContain('另 7 条略');
  });

  it('空轨迹给「无」', () => {
    expect(summarizeTrace([])).toBe('无');
  });
});

describe('deadlinePressure', () => {
  it('轮次用尽', () => {
    expect(deadlinePressure({ turn: 6, maxTurns: 6, remainingSec: 600 })).toEqual({ forceSubmit: true, reason: 'LAST_TURN' });
  });

  it('时间不够再跑一轮时也强制提交', () => {
    expect(deadlinePressure({ turn: 2, maxTurns: 6, remainingSec: 60 })).toEqual({ forceSubmit: true, reason: 'TIME_LOW' });
  });

  it('第一轮不判时间：预算短也要先给一次正常开工的机会', () => {
    expect(deadlinePressure({ turn: 1, maxTurns: 6, remainingSec: 30 })).toEqual({ forceSubmit: false, reason: null });
  });

  it('时间闸用上一轮实际耗时，不用常数', () => {
    // 上一轮只花了 20 秒，剩 30 秒还够再跑一轮。
    expect(deadlinePressure({ turn: 2, maxTurns: 6, remainingSec: 30, roundCostSec: 20 })).toEqual({ forceSubmit: false, reason: null });
  });

  it('时间充足且没打转时放行', () => {
    expect(deadlinePressure({ turn: 2, maxTurns: 6, remainingSec: 600 })).toEqual({ forceSubmit: false, reason: null });
  });

  it('打转时提前收口', () => {
    const trace = [read('inspect_zone', 'rect(30,80,40,90)'), read('inspect_zone', 'rect(30,80,40,90)'), read('inspect_zone', 'rect(30,80,40,90)')];
    expect(deadlinePressure({ turn: 3, maxTurns: 6, remainingSec: 600, trace })).toEqual({ forceSubmit: true, reason: 'STALLED' });
  });
});

describe('renderTurnBrief', () => {
  const base = { turn: 3, maxTurns: 6, phase: 'compose' as const, remainingSec: 240, pressure: { forceSubmit: false, reason: null } };

  it('带轮次、阶段、剩余时间与轨迹', () => {
    const text = renderTurnBrief({ ...base, trace: [read('inspect_zone', 'rect(30,80,40,90)')] });
    expect(text).toContain('第 3/6 轮');
    expect(text).toContain('出方案');
    expect(text).toContain('剩余约 240 秒');
    expect(text).toContain('inspect_zone');
  });

  it('强制提交时给「必须现在提交」并说明原因', () => {
    const text = renderTurnBrief({ ...base, trace: [], pressure: { forceSubmit: true, reason: 'TIME_LOW' } });
    expect(text).toContain('必须现在提交');
    expect(text).toContain('时间不够再跑一轮');
  });

  it('打转时点明查了几次、并给出替代动作', () => {
    const trace = [read('inspect_zone', 'rect(30,80,40,90)'), read('inspect_zone', 'rect(30,80,40,90)'), read('inspect_zone', 'rect(30,80,40,90)')];
    const text = renderTurnBrief({ ...base, trace, pressure: { forceSubmit: true, reason: 'STALLED' } });
    expect(text).toContain('连续查了 3 次');
    expect(text).toContain('换落点');
  });

  it('无候选时提醒先跑校验', () => {
    expect(renderTurnBrief({ ...base, trace: [], readyCandidates: 0 })).toContain('validate_candidate');
    expect(renderTurnBrief({ ...base, trace: [], readyCandidates: 2 })).toContain('2 个通过校验');
  });

  it('重复失败会提醒不要原样重试', () => {
    const text = renderTurnBrief({ ...base, trace: [], lastError: { code: 'RESOURCE_NOT_FOUND', tool: 'create_parametric_model' } });
    expect(text).toContain('RESOURCE_NOT_FOUND');
    expect(text).toContain('不要用同样参数再试一次');
  });

  it('轨迹很长时收口到可控长度', () => {
    const trace = Array.from({ length: 40 }, (_, i) => read('inspect_zone', `rect(${i},${i},${i + 2},${i + 2})`, i));
    const text = renderTurnBrief({ ...base, trace });
    expect(text.length).toBeLessThan(700);
  });
});
