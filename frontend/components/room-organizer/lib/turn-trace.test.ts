import { describe, expect, it } from 'vitest';
import {
  beginAttempt,
  enterStage,
  failureHint,
  finishTurn,
  newAttemptId,
  newTurnId,
  safeErrorCode,
  startTurn,
  summarizeTurn,
  totalMs,
} from './turn-trace';

describe('编号', () => {
  it('turn 与 attempt 编号前缀不同，且同一毫秒也不会重复', () => {
    const turns = new Set(Array.from({ length: 200 }, () => newTurnId(1_700_000_000_000)));
    expect(turns.size).toBe(200);
    expect(newTurnId(1_700_000_000_000).startsWith('t-')).toBe(true);
    expect(newAttemptId(1_700_000_000_000).startsWith('a-')).toBe(true);
  });

  it('编号里不含身份、原话或坐标这类字段', () => {
    const id = newTurnId(1_700_000_000_000);
    expect(id).toMatch(/^t-[0-9a-z]+-[0-9a-f]{4}$/);
    expect(id).not.toMatch(/@|\s|用户|house/i);
  });
});

describe('阶段时间线', () => {
  it('起轮就有 dispatch，且没有终态', () => {
    const trace = startTurn({ route: 'map', now: 1000 });
    expect(trace.stages).toEqual([{ stage: 'dispatch', at: 1000, ms: null }]);
    expect(trace.terminal).toBeNull();
    expect(totalMs(trace)).toBeNull();
  });

  it('进入下一阶段会把上一阶段收口成耗时', () => {
    let trace = startTurn({ route: 'conversation', now: 1000 });
    trace = enterStage(trace, 'understand', 1600);
    expect(trace.stages[0]).toEqual({ stage: 'dispatch', at: 1000, ms: 600 });
    expect(trace.stages[1]).toEqual({ stage: 'understand', at: 1600, ms: null });
  });

  it('终态之后再补阶段无效，时间线不被补记污染', () => {
    let trace = startTurn({ route: 'local', now: 1000 });
    trace = finishTurn(trace, 'local_done', { now: 1200 });
    const after = enterStage(trace, 'plan', 5000);
    expect(after).toBe(trace);
    expect(after.stages).toHaveLength(1);
  });
});

describe('每轮恰一个终态', () => {
  it('第二次收口不改结论，只留冲突证据', () => {
    let trace = startTurn({ route: 'map', now: 1000 });
    trace = finishTurn(trace, 'awaiting_place', { now: 1100 });
    trace = finishTurn(trace, 'preview_ready', { now: 1200 });
    expect(trace.terminal).toBe('awaiting_place');
    expect(trace.conflictingTerminal).toBe('preview_ready');
    expect(trace.finishedAt).toBe(1100);
  });

  it('收口时把还在进行的阶段算到结束时刻', () => {
    let trace = startTurn({ route: 'map', now: 1000 });
    trace = enterStage(trace, 'map', 1100);
    trace = finishTurn(trace, 'awaiting_login', { now: 3100 });
    expect(trace.stages.at(-1)).toEqual({ stage: 'map', at: 1100, ms: 2000 });
    expect(totalMs(trace)).toBe(2100);
  });

  it('非失败终态不带错误码', () => {
    let trace = startTurn({ route: 'local', now: 1000 });
    trace = finishTurn(trace, 'cancelled', { errorCode: 'provider_error', now: 1050 });
    expect(trace.errorCode).toBeNull();
  });
});

describe('重试关联', () => {
  it('重试复用 turnId、换 attemptId，摘要里如实记次数', () => {
    let trace = startTurn({ route: 'conversation', now: 1000 });
    const first = beginAttempt(trace, 1010);
    trace = first.trace;
    const second = beginAttempt(trace, 1020);
    trace = second.trace;
    expect(trace.turnId).toBe(first.trace.turnId);
    expect(trace.attemptIds).toHaveLength(2);
    expect(trace.attemptIds[0]).not.toBe(trace.attemptIds[1]);
    trace = finishTurn(trace, 'failed', { errorCode: 'provider_timeout', now: 1500 });
    expect(summarizeTurn(trace)).toContain('attempts=2');
  });
});

describe('错误码脱敏', () => {
  it('剔掉不安全字符并截断', () => {
    expect(safeErrorCode('provider: timeout!')).toBe('provider-timeout');
    expect(safeErrorCode('  ')).toBeNull();
    expect(safeErrorCode(undefined)).toBeNull();
    expect(safeErrorCode({ message: 'boom' })).toBeNull();
    expect(safeErrorCode('x'.repeat(120))).toHaveLength(48);
  });

  it('供应商原话整体丢掉，不切成碎片留在编号里', () => {
    // 只做字符替换的话，剥掉中文后 `token=abc`、`30.2,120.1` 会留下来；
    // 这里要求一句自然语言根本不是一个错误码，结果只能是 null。
    expect(safeErrorCode('模型返回: 玉泉鱼跃 30.2,120.1 token=abc')).toBeNull();
    expect(safeErrorCode('玉泉鱼跃')).toBeNull();
    expect(safeErrorCode('30.2,120.1')).toBeNull();
  });
});

describe('摘要与提示', () => {
  it('单行摘要含编号、分流、阶段耗时与终态', () => {
    let trace = startTurn({ route: 'map', now: 1000 });
    trace = enterStage(trace, 'map', 1300);
    trace = finishTurn(trace, 'awaiting_place', { now: 2300 });
    const line = summarizeTurn(trace);
    expect(line).toContain(`turn ${trace.turnId}`);
    expect(line).toContain('route=map');
    expect(line).toContain('dispatch:300ms');
    expect(line).toContain('map:1.0s');
    expect(line).toContain('term=awaiting_place');
    expect(line).toContain('total=1.3s');
    expect(line.split('\n')).toHaveLength(1);
  });

  it('未收口的轮次标成 unfinished', () => {
    const trace = startTurn({ route: 'scene', now: 1000 });
    expect(summarizeTurn(trace)).toContain('term=unfinished');
  });

  it('失败提示给的是能做的动作，不是“请稍后再试”', () => {
    let timeout = startTurn({ route: 'conversation', now: 1000 });
    timeout = finishTurn(timeout, 'failed', { errorCode: 'timeout', now: 1100 });
    expect(failureHint(timeout)).toContain('重试');

    let provider = startTurn({ route: 'conversation', now: 1000 });
    provider = finishTurn(provider, 'failed', { errorCode: 'provider_error', now: 1100 });
    expect(failureHint(provider)).toContain('同一编号');

    let ok = startTurn({ route: 'local', now: 1000 });
    ok = finishTurn(ok, 'local_done', { now: 1100 });
    expect(failureHint(ok)).toBeNull();
  });
});
