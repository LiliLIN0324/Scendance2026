import {
  PLAN_MIN_VERTEX_GAP_M,
  PLAN_RING_MAX_VERTICES,
  planPointDistanceM,
} from './site-plan-editing';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

/**
 * 红线 / 分区圈画草稿的纯逻辑层（收点、闭合热区、种子替换）。
 *
 * 为什么独立成文件：画布组件只负责把地图点击坐标翻成 ENU 点，判定（命中首点、重复点、
 * 顶点上限、种子大框要不要丢掉）收进纯函数，才能在没有真实地图的环境里逐条验收，
 * 也避免把「搜索预览大框」和「用户自描的小硬地环」混进同一份草稿。
 */

/** 闭合环最少顶点数（与 checkBoundaryRing 口径一致）。 */
export const RING_DRAFT_MIN_VERTICES = 3;

/** 首顶点闭合热区半径（CSS px）：比旧值 10px 略宽，双击 / 单击起点更容易命中。 */
export const RING_CLOSE_HIT_PX = 14;

/** 画布像素坐标（CSS px），只用于闭合热区判定。 */
export interface PixelPoint {
  x: number;
  y: number;
}

/** 点击位置是否落在首顶点闭合热区内。 */
export function isRingCloseHit(
  click: PixelPoint,
  first: PixelPoint,
  hitPx: number = RING_CLOSE_HIT_PX,
): boolean {
  return Math.hypot(first.x - click.x, first.y - click.y) <= hitPx;
}

export type RingDraftAppendStatus =
  | 'added' // 普通追加一个顶点。
  | 'seed-replaced' // 丢掉搜索选区种子大框，把这个点作为自描环的起点。
  | 'too-close' // 离已有顶点太近，当作重复点击忽略。
  | 'too-many'; // 顶点已达上限，不再收点。

export interface RingDraftAppendResult {
  points: PlanPoint[];
  status: RingDraftAppendStatus;
  /** 这次是否丢掉了搜索选区种子草稿（首点换成用户自描起点）。 */
  replacedSeed: boolean;
}

/**
 * 向红线 / 分区草稿追加一个顶点。
 *
 * `seeded` 为 true 表示草稿是从搜索选区（蓝虚线大框）自动塞进来的种子。用户落第一个
 * 手工顶点时，直接用这个点替换整段种子，而不是把小硬地的点拼进大框顶点序列——否则
 * 闭合判定永远拿大框角当首点，自描小环也会和大框自相交，闭合被拒。
 */
export function appendRingDraftVertex(
  draft: readonly PlanPoint[],
  point: PlanPoint,
  options: { seeded?: boolean } = {},
): RingDraftAppendResult {
  if (options.seeded && draft.length > 0) {
    return { points: [{ x: point.x, y: point.y }], status: 'seed-replaced', replacedSeed: true };
  }
  if (draft.length >= PLAN_RING_MAX_VERTICES) {
    return { points: [...draft], status: 'too-many', replacedSeed: false };
  }
  for (const existing of draft) {
    if (planPointDistanceM(existing, point) < PLAN_MIN_VERTEX_GAP_M) {
      return { points: [...draft], status: 'too-close', replacedSeed: false };
    }
  }
  return { points: [...draft, { x: point.x, y: point.y }], status: 'added', replacedSeed: false };
}
