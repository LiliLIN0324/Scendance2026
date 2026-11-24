import { describe, expect, it } from 'vitest';
import {
  PLAN_HISTORY_LIMIT,
  canonicalPlanJson,
  commitPlanHistory,
  emptyPlanHistory,
  planSnapshotsEqual,
  prunePlanHistoryStack,
  redoPlanHistory,
  undoPlanHistory,
} from './plan-history';

const plan = (n: number) => ({ revision: n, zones: [], anchor: { lng: 120, lat: 30 } });
const measured = (n: number, temp: string[] = []) => ({
  revision: n,
  measurements: temp,
  anchor: { lng: 120, lat: 30 },
});

describe('plan-history（M3b 纯函数地基）', () => {
  it('提交：旧快照入 past、redo 清空', () => {
    const base = emptyPlanHistory<ReturnType<typeof plan>>();
    const after = commitPlanHistory(base, plan(1));
    expect(after.past).toEqual([plan(1)]);
    expect(after.future).toEqual([]);
    expect(base.past).toEqual([]);
  });

  it('提交：与栈顶相同的快照不重复入栈（按内容比较），但仍清空 redo', () => {
    const history = { past: [plan(1)], future: [plan(2)] };
    const after = commitPlanHistory(history, plan(1), PLAN_HISTORY_LIMIT, planSnapshotsEqual);
    expect(after.past).toEqual([plan(1)]);
    expect(after.future).toEqual([]);
  });

  it('提交：超过上限丢最旧，默认上限与 canvas 的 30 步一致', () => {
    expect(PLAN_HISTORY_LIMIT).toBe(30);
    let history = emptyPlanHistory<ReturnType<typeof plan>>();
    for (let n = 1; n <= 32; n += 1) history = commitPlanHistory(history, plan(n));
    expect(history.past).toHaveLength(30);
    expect(history.past[0]).toEqual(plan(3));
    expect(history.past.at(-1)).toEqual(plan(32));
  });

  it('撤销：弹出 past 栈顶并把当前快照推入 future', () => {
    const history = { past: [plan(1), plan(2)], future: [] };
    const step = undoPlanHistory(history, plan(3), 5);
    expect(step.snapshot).toEqual(plan(2));
    expect(step.history.past).toEqual([plan(1)]);
    expect(step.history.future).toEqual([plan(3)]);
  });

  it('撤销空栈：原样返回，不出快照', () => {
    const history = emptyPlanHistory<ReturnType<typeof plan>>();
    const step = undoPlanHistory(history, plan(9));
    expect(step.snapshot).toBeUndefined();
    expect(step.history).toBe(history);
  });

  it('重做：与撤销对称；撤销→重做往返回到原状', () => {
    const history = { past: [plan(1), plan(2)], future: [] };
    const undone = undoPlanHistory(history, plan(3), 5);
    const redone = redoPlanHistory(undone.history, plan(2), 5);
    expect(redone.snapshot).toEqual(plan(3));
    expect(redone.history.past).toEqual([plan(1), plan(2)]);
    expect(redone.history.future).toEqual([]);
  });

  it('重做空栈：原样返回', () => {
    const history = emptyPlanHistory<ReturnType<typeof plan>>();
    const step = redoPlanHistory(history, plan(9));
    expect(step.snapshot).toBeUndefined();
    expect(step.history).toBe(history);
  });

  it('规范化 JSON：对象键序无关，数组顺序有关', () => {
    expect(canonicalPlanJson({ b: 1, a: 2 })).toBe(canonicalPlanJson({ a: 2, b: 1 }));
    expect(canonicalPlanJson({ a: [1, 2] })).not.toBe(canonicalPlanJson({ a: [2, 1] }));
    expect(canonicalPlanJson({ a: undefined, b: 1 })).toBe(canonicalPlanJson({ b: 1 }));
  });

  it('快照比较：嵌套键序不同仍相等，数值/文本变化可检出', () => {
    const a = { data: { zones: [{ id: 'z1', name: '观众区' }], notes: '' }, revision: 2 };
    const b = { revision: 2, data: { notes: '', zones: [{ name: '观众区', id: 'z1' }] } };
    expect(planSnapshotsEqual(a, b)).toBe(true);
    expect(planSnapshotsEqual(a, { ...b, revision: 3 })).toBe(false);
  });

  it('裁剪栈：剥离临时项后相邻相同快照合并为一条', () => {
    const strip = (s: ReturnType<typeof measured>, ids: readonly string[]) =>
      ({ ...s, measurements: s.measurements.filter((x) => !ids.includes(x)) });
    const stack = [measured(1, ['t']), measured(2, ['t']), measured(2, ['t'])];
    const pruned = prunePlanHistoryStack(stack, measured(99), (s) => strip(s, ['t']));
    expect(pruned).toEqual([measured(1), measured(2)]);
  });

  it('裁剪栈：末尾与当前方案相同的快照逐条弹出', () => {
    const strip = (s: ReturnType<typeof measured>) => ({ ...s, measurements: [] });
    const next = measured(2);
    const stack = [measured(1, ['t']), measured(2, ['t'])];
    const pruned = prunePlanHistoryStack(stack, next, strip);
    expect(pruned).toEqual([measured(1)]);
  });

  it('裁剪栈：空栈原样返回空数组', () => {
    expect(prunePlanHistoryStack([], measured(1), (s) => s)).toEqual([]);
  });

  it('裁剪栈：equals 传引用比较时不按内容合并', () => {
    const a = measured(2);
    const b = measured(2);
    const pruned = prunePlanHistoryStack([a, b], measured(3), (s) => s, Object.is);
    expect(pruned).toEqual([a, b]);
  });
});
