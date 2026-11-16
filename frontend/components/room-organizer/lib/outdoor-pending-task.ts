/**
 * 一件「等条件满足就接着做」的户外待办（M2 切片：每步有下一步）。
 *
 * 用户的诉求是「一句话说完就想看到东西」，而地点/范围/登录是中间条件。
 * 这些条件不该把需求吞掉，也不该让界面只剩一句“请先…”。这里把那种状态
 * 收成一条明确的待办：
 * - 永远有且只有一个 `next`（要做的那一件事），取消则整条待办消失；
 * - 目标（goal）和显式约束（constraints）原样保存，换条件不换需求；
 * - 条件齐了就转成「可以接着做」，由调用方决定发不发请求；
 * - 项目切换或需求改写会让旧待办作废，迟到的结果按 `isCurrent` 丢弃，
 *   不会把上一件事的结果贴到这一件上。
 *
 * 纯数据 + 纯函数，不读 DOM、不碰存储、不发请求，能在 node 里直接测。
 */

export type PendingWait = 'place' | 'range' | 'login' | 'ready';

export type NextStepKind =
  | 'pick_place'
  | 'confirm_range'
  | 'login'
  | 'run_design'
  | 'none';

export interface NextStep {
  kind: NextStepKind;
  /** 给按钮用的短动作名，界面直接照这句显示，不再自己编。 */
  label: string;
}

export interface PendingTask {
  /** 一件待办的身份；换项目或改写需求都会换新 id。 */
  id: string;
  /** 用户原话里的目标，不改写、不压缩。 */
  goal: string;
  /** 用户明说的约束（尺寸、数量、留通道…），条件满足后仍然成立。 */
  constraints: string[];
  waitingOn: PendingWait;
  next: NextStep;
  /** 地点是否已定：登录回来要回到「圈范围」，而不是从头再选一次地点。 */
  hasPlace: boolean;
  /** 需求或条件每变一次 +1；迟到的回包靠它判新旧。 */
  revision: number;
  updatedAt: number;
}

const NEXT_BY_WAIT: Record<PendingWait, NextStep> = {
  place: { kind: 'pick_place', label: '在地图上选地点' },
  range: { kind: 'confirm_range', label: '确认活动范围' },
  login: { kind: 'login', label: '登录后继续' },
  ready: { kind: 'run_design', label: '接着做设计' },
};

let sequence = 0;

function nextTaskId(now: number): string {
  sequence += 1;
  return `pt-${now.toString(36)}-${sequence.toString(36)}`;
}

export function createPendingTask(input: {
  goal: string;
  constraints?: string[];
  waitingOn?: PendingWait;
  now?: number;
}): PendingTask {
  const now = input.now ?? Date.now();
  const waitingOn = input.waitingOn ?? 'place';
  return {
    id: nextTaskId(now),
    goal: input.goal,
    constraints: [...(input.constraints ?? [])],
    waitingOn,
    next: NEXT_BY_WAIT[waitingOn],
    hasPlace: false,
    revision: 1,
    updatedAt: now,
  };
}

function advance(task: PendingTask, waitingOn: PendingWait, now: number): PendingTask {
  return {
    ...task,
    waitingOn,
    next: NEXT_BY_WAIT[waitingOn],
    revision: task.revision + 1,
    updatedAt: now,
  };
}

/** 地点定了：下一步就是圈范围，目标与约束原样留着。 */
export function placeSettled(task: PendingTask, now: number = Date.now()): PendingTask {
  if (task.waitingOn === 'ready') return task;
  return { ...advance(task, 'range', now), hasPlace: true };
}

/** 范围确认了：条件齐了，可以接着做设计。 */
export function rangeSettled(task: PendingTask, now: number = Date.now()): PendingTask {
  return advance(task, 'ready', now);
}

/** 只有涉及模型的那一段才等登录；本地能算的步骤不受影响。 */
export function requireLogin(task: PendingTask, now: number = Date.now()): PendingTask {
  if (task.waitingOn === 'ready') return task;
  return advance(task, 'login', now);
}

/** 登录完成：回到原先进度该在的那一步，而不是从头再选一次地点。 */
export function loginSettled(task: PendingTask, now: number = Date.now()): PendingTask {
  if (task.waitingOn !== 'login') return task;
  return advance(task, task.hasPlace ? 'range' : 'place', now);
}

/**
 * 改写需求：还是同一件事往下做，但条件可能要重走一遍。
 * 目标替换成新的原话，约束并入，id 保持不变（用户眼里还是“这一件”）。
 */
export function reviseTask(
  task: PendingTask,
  input: { goal?: string; constraints?: string[]; now?: number },
): PendingTask {
  const now = input.now ?? Date.now();
  const constraints = [...task.constraints];
  for (const item of input.constraints ?? []) {
    if (!constraints.includes(item)) constraints.push(item);
  }
  const goal = input.goal ?? task.goal;
  const waitingOn: PendingWait = task.waitingOn === 'ready' ? 'ready' : 'place';
  return {
    ...task,
    goal,
    constraints,
    waitingOn,
    next: NEXT_BY_WAIT[waitingOn],
    hasPlace: waitingOn === 'ready' ? task.hasPlace : false,
    revision: task.revision + 1,
    updatedAt: now,
  };
}

/**
 * 迟到的回包能不能用在当前待办上。
 * 编号对不上、或者需求已经改过（revision 变了），一律不用。
 */
export function isCurrent(task: PendingTask | null, result: { taskId: string; revision: number }): boolean {
  if (!task) return false;
  return task.id === result.taskId && task.revision === result.revision;
}

/** 界面上那句“还差什么”：目标 + 唯一动作，不啰嗦。 */
export function describeTask(task: PendingTask): string {
  return `${task.goal} · 下一步：${task.next.label}`;
}
