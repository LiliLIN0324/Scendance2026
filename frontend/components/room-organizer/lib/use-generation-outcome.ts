'use client';

/**
 * M5-B 占位 hook：把一次生成跑完的 Outcome 账本接到 Bingo「本次报告」卡上。
 *
 * 当前形状：Outcome 由调用方在生成完成时构造（见 {@link GenerationOutcome}），
 * 通过 {@link setGenerationOutcome} 注入；hook 本身不接 store、不读 localStorage、
 * 也不订阅任何生成事件——后续接线时把这里换成真实数据源即可，组件层不动。
 *
 * 占位期内 {@link pendingOutcome} 永远为 null，Bingo 卡上「本次结果」行不渲染。
 */

import { useMemo } from 'react';
import { outcomeSummary, type GenerationOutcome } from '../../../lib/generation-outcome';

/** 模块级占位：生成完成路径未来会写这里。 */
let pendingOutcome: GenerationOutcome | null = null;

/** 由调用方在生成完成时调用，把本次 Outcome 交给 Bingo 卡展示。 */
export function setGenerationOutcome(outcome: GenerationOutcome | null): void {
  pendingOutcome = outcome;
}

/** 仅供测试与重置：清空当前挂起的 Outcome。 */
export function __resetGenerationOutcome(): void {
  pendingOutcome = null;
}

/** Bingo 卡读取本次 Outcome 与一句话中文摘要；占位期返回 null / 空串。 */
export function useGenerationOutcome(): {
  outcome: GenerationOutcome | null;
  summary: string;
} {
  return useMemo(() => ({
    outcome: pendingOutcome,
    summary: pendingOutcome ? outcomeSummary(pendingOutcome) : '',
  }), []);
}
