/**
 * plan 历史快照纯函数（M3b 地基）——不含 React、不读时钟、不碰存储。
 *
 * 口径：
 * - 栈里存「上一个快照」而不是当前值：编辑提交前把旧 plan 推入 past，撤销时把
 *   当前 plan 推进 future；与 `components/outdoor-plan-canvas.tsx` 内联的
 *   `historyRef` / `redoRef` 同构，供后续把该逻辑抽出时直接复用；
 * - 两栈都按 `limit` 截断（默认 30，与 canvas `UNDO_LIMIT` 同值）：超限丢最旧；
 * - 快照比较走规范化序列化（对象键排序、数组保序）：同内容不同键序视为同一快照，
 *   只用于去重 / 对账；持久化格式仍以 `sitePlanSnapshotSchema` 为准。
 */

/** 与 canvas `UNDO_LIMIT` 同值；改这里等于改交互上限，两处需一起动。 */
export const PLAN_HISTORY_LIMIT = 30;

export interface PlanHistoryStacks<T> {
  readonly past: readonly T[];
  readonly future: readonly T[];
}

/** 撤销/重做结果：`snapshot` 为 undefined 表示该方向已空，栈原样返回。 */
export interface PlanHistoryStep<T> {
  readonly history: PlanHistoryStacks<T>;
  readonly snapshot: T | undefined;
}

/** 空格历史：新 plan 首次加载时用。 */
export function emptyPlanHistory<T>(): PlanHistoryStacks<T> {
  return { past: [], future: [] };
}

/** 只保留最近 `limit` 条；非正 / 非有限上限按 0 处理，避免负 slice 反向保留。 */
function trimToLimit<T>(stack: readonly T[], limit: number): T[] {
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  if (cap === 0) return [];
  return stack.length <= cap ? [...stack] : stack.slice(stack.length - cap);
}

/**
 * 提交一次编辑：旧快照入 past、redo 清空。
 * 与栈顶完全相同的快照不重复入栈（例如无改动的保存），但仍清空 redo。
 */
export function commitPlanHistory<T>(
  history: PlanHistoryStacks<T>,
  previous: T,
  limit: number = PLAN_HISTORY_LIMIT,
  equals: (a: T, b: T) => boolean = Object.is,
): PlanHistoryStacks<T> {
  const top = history.past[history.past.length - 1];
  if (history.past.length > 0 && equals(top!, previous)) {
    return { past: history.past, future: [] };
  }
  return {
    past: trimToLimit([...history.past, previous], limit),
    future: [],
  };
}

/** 撤销：弹出 past 栈顶作为要应用的回退快照，把当前快照推入 future。 */
export function undoPlanHistory<T>(
  history: PlanHistoryStacks<T>,
  current: T,
  limit: number = PLAN_HISTORY_LIMIT,
): PlanHistoryStep<T> {
  if (history.past.length === 0) return { history, snapshot: undefined };
  const snapshot = history.past[history.past.length - 1]!;
  return {
    history: {
      past: history.past.slice(0, -1),
      future: trimToLimit([...history.future, current], limit),
    },
    snapshot,
  };
}

/** 重做：弹出 future 栈顶，把当前快照推回 past（同样受上限约束）。 */
export function redoPlanHistory<T>(
  history: PlanHistoryStacks<T>,
  current: T,
  limit: number = PLAN_HISTORY_LIMIT,
): PlanHistoryStep<T> {
  if (history.future.length === 0) return { history, snapshot: undefined };
  const snapshot = history.future[history.future.length - 1]!;
  return {
    history: {
      past: trimToLimit([...history.past, current], limit),
      future: history.future.slice(0, -1),
    },
    snapshot,
  };
}

/**
 * 只把当前快照记进 future（past 原样不动）：用于「回填一份调用方自己保存的快照」，
 * 例如画布一键收进分区后，撤销收进要能重做回收进后的坐标。
 * 与 `undoPlanHistory` 的区别是 past 不弹栈——回填的那份快照不在 past 里。
 */
export function pushPlanHistoryFuture<T>(
  history: PlanHistoryStacks<T>,
  current: T,
  limit: number = PLAN_HISTORY_LIMIT,
): PlanHistoryStacks<T> {
  return { past: history.past, future: trimToLimit([...history.future, current], limit) };
}

/** 规范化：对象键排序、数组保序、undefined 键省略（与 JSON 序列化口径一致）。 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const child = source[key];
      if (child !== undefined) sorted[key] = canonicalize(child);
    }
    return sorted;
  }
  return value;
}

/** 规范化 JSON：同一份 plan 无论键序如何都得到同一串，供去重与对账。 */
export function canonicalPlanJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** 内容相等（键序无关、数组顺序有关）；不做 schema 校验，调用方保证入参是 plan。 */
export function planSnapshotsEqual(a: unknown, b: unknown): boolean {
  return canonicalPlanJson(a) === canonicalPlanJson(b);
}

/**
 * 按谓词变换清理一条历史栈（对应 `outdoor-plan-canvas.tsx` 退出测量时从撤销/
 * 重做栈剥离临时线的内联逻辑）：
 * 1. 每条快照经 `transform` 剥离指定临时项；
 * 2. 变换后相邻且内容相同的快照合并为一条，避免一次空撤销；
 * 3. 末尾与当前方案 `next` 相同的快照逐条弹出。
 *
 * `transform` 负责把临时项从快照中去掉（具体剥什么由调用方定义）；本函数不
 * 读取 plan 结构，只做栈级去重与尾部裁剪。两栈（past/future）分别调用一次。
 */
export function prunePlanHistoryStack<T>(
  stack: readonly T[],
  next: T,
  transform: (snapshot: T) => T,
  equals: (a: T, b: T) => boolean = planSnapshotsEqual,
): T[] {
  const result: T[] = [];
  for (const snapshot of stack) {
    const clean = transform(snapshot);
    if (result.length === 0 || !equals(result.at(-1)!, clean)) result.push(clean);
  }
  while (result.length > 0 && equals(result.at(-1)!, next)) result.pop();
  return result;
}
