/**
 * 把一句多层的话接成一件待办（M3 接线切片，室外集会口径）。
 *
 * 用户的原话常常是「先摆摊位，最后再调通道」：前半句现在就要做，后半句是收尾活。
 * 之前这条链路把整句塞进 brief、气泡只回一句「下一步：选地点」，两层信息都没交代：
 * 用户看不出系统听懂了多少，也不知道后半句是被记住了还是被吞了。
 *
 * 这里定三件事：
 * 1. **现在的目标** = 去掉后置从句后的那半句，待办卡片上写这句；
 * 2. **留到后面的活** = 后置从句原样留着，跟着待办走，不现在执行、也不为此提问；
 * 3. **接回时按整句发**：`original` 保存用户原话，范围确认后重放宽句，信息不丢。
 *
 * 纯函数，不碰存储和网络，可直接在 node 里测。
 */

import { parseInstructionLayers, type InstructionEnvironment, type InstructionLayers } from './instruction-layers';
import { createPendingTask, reviseTask, type PendingTask } from './outdoor-pending-task';
import { waitFromStage } from './outdoor-task-brief-bridge';

export interface LayeredTask {
  /** 现在的这件活（目标已去掉后置从句）。 */
  task: PendingTask;
  /** 留到后面的活，原话保留。 */
  deferred: string[];
  /** 用户原话：接回时发这句，不发送改写后的目标。 */
  original: string;
  /** 去掉后置从句后的当前指令；整句都是后置时为空串。 */
  immediate: string;
  /** 句子里明说的环境口径；没提就是 undefined（本产品默认室外，不猜）。 */
  environment?: InstructionEnvironment;
}

export interface AbsorbInput {
  text: string;
  /** 工作流当前阶段，用来决定待办在等什么。 */
  stage: string;
  /** 已有的同一件待办：有就改目标、不换 id，用户眼里还是同一件事。 */
  task?: PendingTask | null;
  now?: number;
}

/** 空白句返回 null：调用方自己处理「没说话」的情况。 */
export function absorbLayeredInstruction(input: AbsorbInput): LayeredTask | null {
  const original = (input.text ?? '').trim();
  if (!original) return null;
  return assembleLayeredTask(original, parseInstructionLayers(original), input.stage, input.task ?? null, input.now);
}

function assembleLayeredTask(
  original: string,
  layers: InstructionLayers,
  stage: string,
  existing: PendingTask | null,
  now: number | undefined,
): LayeredTask {
  // 整句都是后置时没有「现在做什么」，目标仍写原话，避免待办上出现空白目标。
  const goal = layers.immediate || original;
  const stamp = now === undefined ? {} : { now };
  const task = existing
    ? reviseTask(existing, { goal, ...stamp })
    : createPendingTask({ goal, waitingOn: waitFromStage(stage), ...stamp });

  return {
    task,
    deferred: layers.deferred,
    original,
    immediate: layers.immediate,
    ...(layers.environment ? { environment: layers.environment } : {}),
  };
}

/**
 * 退回文案的规矩，不替调用方定“下一步是什么”。
 *
 * 轮次 105：拦阻现场（如“还没定地点”）原本只报一句缺什么，用户上一句里说的
 *「最后再调通道」就算被吞了。这里只负责把“后面还有…”补上；没有后置从句、
 * 或句子本身就是空的时候，一个字不多写。
 */
export function deferredNote(userText: string): string {
  const layered = absorbLayeredInstruction({ text: userText ?? '', stage: 'place' });
  if (!layered || layered.deferred.length === 0) return '';
  return ` 后面还有：${layered.deferred.join('、')}；这一步做完再接着做，现在不用决定。`;
}

export function layeredBounceText(layered: LayeredTask, bounce: string): string {
  const parts = [`${bounce} 下一步：${layered.task.next.label}。`];
  if (layered.deferred.length > 0) {
    parts.push(`后面还有：${layered.deferred.join('、')}；这一步做完再接着做，现在不用决定。`);
  }
  return parts.join(' ');
}
