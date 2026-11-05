'use client';

/**
 * 把一次生成跑完的 Outcome 账本接到 Bingo「本次报告」卡上。
 *
 * 第 7 批收尾修正：此前这里用 `useMemo(..., [])` 读模块级变量，
 * 生成完成后写入的 Outcome **不会**让已挂载的卡片重渲染 —— 症状是
 * 「数据明明写了，卡上就是没有」。现在改成订阅式：写入即通知，卡片即时刷新。
 *
 * 形状不变：Outcome 由调用方在生成完成时构造（见 {@link GenerationOutcome}），
 * 通过 {@link setGenerationOutcome} 注入；本模块不接 store、不读 localStorage。
 */

import { useEffect, useState } from 'react';
import { outcomeSummary, type GenerationOutcome } from '../../../lib/generation-outcome';

/** 模块级当前账本；由 {@link setGenerationOutcome} 写入。 */
let pendingOutcome: GenerationOutcome | null = null;

/** 订阅者集合：写入时通知全部已挂载的 hook 重渲染。 */
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of Array.from(listeners)) listener();
}

/** 由调用方在生成完成时调用，把本次 Outcome 交给 Bingo 卡展示。 */
export function setGenerationOutcome(outcome: GenerationOutcome | null): void {
  pendingOutcome = outcome;
  notify();
}

/** 仅供测试与重置：清空当前挂起的 Outcome。 */
export function __resetGenerationOutcome(): void {
  pendingOutcome = null;
  notify();
}

/** Bingo 卡读取本次 Outcome 与一句话中文摘要。 */
export function useGenerationOutcome(): {
  outcome: GenerationOutcome | null;
  summary: string;
} {
  const [outcome, setOutcome] = useState<GenerationOutcome | null>(pendingOutcome);

  useEffect(() => {
    // 挂载瞬间同步一次：可能写入发生在本组件挂载之前。
    setOutcome(pendingOutcome);
    const listener = () => setOutcome(pendingOutcome);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return { outcome, summary: outcome ? outcomeSummary(outcome) : '' };
}
