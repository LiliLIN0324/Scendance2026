/**
 * 物料能力标签的类型与查表入口（2026-11-17）。
 *
 * 分工：
 * - `library-capabilities.ts` 是生成数据（976 行目录逐条给 kind + actions）；
 * - 本文件只负责类型、查表与兜底，不做关键词猜测；
 * - `prop-interactions` 优先读这里的能力，读不到才回退旧关键词（只对表外新物料生效）。
 *
 * 借的成熟做法：把「物体能提供什么交互」当成物体自己的属性（smart object / affordance），
 * 而不是让每个使用方现猜；这样策划能改、能审、能 diff。
 */

import type { PropKind } from './prop-interactions';
import type { PropInteraction } from './prop-interactions';
import { LIBRARY_CAPABILITIES } from './library-capabilities';

/** 能力来源：人工定稿 / 离线规则 / 运行时兜底。 */
export type CapabilitySource = 'curated' | 'rule' | 'heuristic';

export interface PropCapabilityEntry {
  kind: PropKind;
  actions: readonly PropInteraction[];
  source: Exclude<CapabilitySource, 'heuristic'>;
}

/** 按 slug 查能力标签；表外（新物料）返回 null，由调用方回退关键词。 */
export function capabilityForSlug(slug: string | undefined): PropCapabilityEntry | null {
  if (!slug) return null;
  return LIBRARY_CAPABILITIES[slug] ?? null;
}

/** 能力覆盖统计（给审计与设置页用）。 */
export function capabilityCoverage(slugs: readonly string[]): {
  total: number;
  labelled: number;
  missing: string[];
} {
  const missing = slugs.filter(slug => !LIBRARY_CAPABILITIES[slug]);
  return { total: slugs.length, labelled: slugs.length - missing.length, missing };
}
