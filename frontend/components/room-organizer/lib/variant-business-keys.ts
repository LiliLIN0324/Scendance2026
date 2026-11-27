import type { RoomLayout } from './types';

/** 业务副本键：属整场活动，不随变体几何快照分裂（plan 顶层 ref + 侧车记录为正源）。 */
const BUSINESS_KEYS = ['eventOperations', 'productionPlan', 'venueScan'] as const;

export type VariantBusinessKey = (typeof BUSINESS_KEYS)[number];

/**
 * 变体快照业务键剥离（T1 纯层；接线进 `designSnapshot`/`variantSnapshot` 归 T2，本轮不接）。
 *
 * 从快照 layout 移除 `eventOperations` / `productionPlan` / `venueScan` 三个业务副本键；
 * 几何与物料状态（floors/items 含 `handoff`、zones、roof、terrain、entrance、结构 marker、物件层等）
 * 原样保留；其余未知附加字段原样保留，不做白名单瘦身。纯函数、不碰存储、不 async。
 */
export function stripVariantBusinessKeys<T extends RoomLayout>(
  layout: T,
): Omit<T, VariantBusinessKey> {
  const { eventOperations: _operations, productionPlan: _production, venueScan: _scan, ...rest } = layout;
  return rest;
}

export { BUSINESS_KEYS };
