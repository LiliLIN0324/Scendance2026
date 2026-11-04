import { layoutFingerprint } from './layout-fingerprint';
import type { RoomLayout } from '../components/room-organizer/lib/types';

/** 一次预览的上下文快照（在 pendingPreview 生成那一刻打包）。 */
export interface PreviewContext {
  /** 生成预览时脚下的基线画布指纹。 */
  baselineFingerprint: string;
  /** 候选本身的指纹（要落盘的那份）。 */
  candidateFingerprint: string;
  /** 可选：生成这次预览用的 recipe id（8 位 hex），用于追溯。 */
  recipeId?: string;
  /** 生成时间戳（Date.now()）。 */
  createdAt: number;
}

/** 应用前决策结果。 */
export type ApplyDecision =
  | { action: 'apply' }
  | { action: 'prompt'; message: string };

/**
 * 在 pendingPreview 生成那一刻打包上下文（纯函数，不碰 state）。
 *
 * @param baseLayout     候选生成时脚下的基线画布（用户当前画布）。
 * @param candidateLayout AI 生成的候选布局本身。
 * @param options.recipeId 可选 recipe id，仅用于追溯，不参与指纹。
 * @param options.now      可选注入当前时间（测试用），缺省 Date.now()。
 */
export function snapshotPreviewContext(
  baseLayout: RoomLayout,
  candidateLayout: RoomLayout,
  options?: { recipeId?: string; now?: number },
): PreviewContext {
  // exactOptionalPropertyTypes 下：recipeId 缺省时不能显式写成 `recipeId: undefined`，
  // 只能在有值时才挂上去。
  const ctx: PreviewContext = {
    baselineFingerprint: layoutFingerprint(baseLayout),
    candidateFingerprint: layoutFingerprint(candidateLayout),
    createdAt: options?.now ?? Date.now(),
  };
  if (options?.recipeId !== undefined) {
    ctx.recipeId = options.recipeId;
  }
  return ctx;
}

/**
 * 用户点「应用」前的决策：当前画布指纹 vs 预览基线指纹。
 *
 * 一致说明预览期间没人动过画布，直接应用；不一致就弹轻提示，由用户决定是否强制覆盖。
 */
export function decideOnApply(
  currentLayout: RoomLayout,
  ctx: PreviewContext,
): ApplyDecision {
  const currentFingerprint = layoutFingerprint(currentLayout);
  if (currentFingerprint === ctx.baselineFingerprint) {
    return { action: 'apply' };
  }
  return { action: 'prompt', message: '画布在预览期间被改动过，是否仍应用这份候选？' };
}

/**
 * 候选本身是否仍然有效（candidateFingerprint 变了，说明候选在挂预览期间被改过）。
 * 用于在「应用」前再做一次兜底校验，避免把过期候选写回画布。
 */
export function candidateStillMatches(
  ctx: PreviewContext,
  candidateLayout: RoomLayout,
): boolean {
  return layoutFingerprint(candidateLayout) === ctx.candidateFingerprint;
}
