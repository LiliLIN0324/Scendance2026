/**
 * 待恢复槽（pending-brief）与待办（pending-task）的对接层。
 *
 * 两边的职责本来就该分开：槽只负责「按活动把原话存住」，待办负责「现在该做哪一步」。
 * 但面板接线时需要来回换算，这一步如果各写一份，迟早会一份改了一份没改。
 * 所以换算只有这一处，并且明确：
 * - 原话一个字不改（`text` ↔ `goal`），不做“摘要”也不做“补全”；
 * - 阶段名对不上就退回「先选地点」——未知状态卡在第一步，比猜错下一步更糟；
 * - 槽里没有约束字段，接回来时约束为空数组，不凭空编造。
 */

import type { PendingBrief } from './pending-brief';
import { createPendingTask, type PendingTask, type PendingWait } from './outdoor-pending-task';

/** 工作流阶段名 → 待办等待条件。未知阶段一律按「还没定地点」处理。 */
export function waitFromStage(stage: string): PendingWait {
  switch (stage) {
    case 'range':
      return 'range';
    case 'ready':
    case 'design':
      return 'ready';
    case 'login':
      return 'login';
    default:
      return 'place';
  }
}

/** 待办等待条件 → 回写槽时用的阶段名（与上面的映射互逆，未知值写 place）。 */
export function stageFromWait(waitingOn: PendingWait): string {
  switch (waitingOn) {
    case 'range':
      return 'range';
    case 'ready':
      return 'ready';
    case 'login':
      return 'login';
    default:
      return 'place';
  }
}

/** 从槽里取出的一句话，变成一个待办；地点是否已定由阶段推出。 */
export function taskFromBrief(brief: PendingBrief, now: number = Date.now()): PendingTask {
  const waitingOn = waitFromStage(brief.stage);
  const task = createPendingTask({ goal: brief.text, waitingOn, now });
  // createPendingTask 的 hasPlace 默认 false；从 range/ready 接回来的说明地点早定了。
  return waitingOn === 'range' || waitingOn === 'ready' ? { ...task, hasPlace: true } : task;
}

/** 把待办写回槽：仍然是同一句原话，只是阶段跟着当前进度走。 */
export function briefFromTask(task: PendingTask, now: number = Date.now()): PendingBrief {
  return { text: task.goal, at: now, stage: stageFromWait(task.waitingOn) };
}

/** 接回来之后还有没有必要发这一句：条件齐了才发，其余等条件。 */
export function readyToResume(task: PendingTask): boolean {
  return task.waitingOn === 'ready';
}
