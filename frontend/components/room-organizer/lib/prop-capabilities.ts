/**
 * 物料能力标签的类型与查表入口（2026-11-17，从 #151 接到当前 main）。
 *
 * `library-capabilities.ts` 是生成数据（目录逐条给 kind + actions）。
 * 本文件只负责类型和查表，不按 slug 子串猜能力。
 * 人物交互的关键词回退仍留在 #151，这一刀不把那套启发式带过来。
 */

import { LIBRARY_CAPABILITIES } from './library-capabilities';

/** 能力表里会出现的物件种类。 */
export type CapabilityKind =
  | 'seat'
  | 'seat-set'
  | 'table'
  | 'stage'
  | 'booth'
  | 'display'
  | 'operate'
  | 'none'
  | 'person';

/** 能力表记录的人物动作。没有片段时场景层自己回退，这里只记账。 */
export type CapabilityAction = 'sit' | 'talk' | 'wave' | 'emote';

export interface PropCapabilityEntry {
  kind: CapabilityKind;
  actions: readonly CapabilityAction[];
  source: 'curated' | 'rule';
}

/** 按 slug 查能力标签；表外（新物料）返回 null，调用方自己决定怎么排。 */
export function capabilityForSlug(slug: string | undefined): PropCapabilityEntry | null {
  if (!slug) return null;
  return LIBRARY_CAPABILITIES[slug] ?? null;
}

/** 能力覆盖统计（给审计用）。 */
export function capabilityCoverage(slugs: readonly string[]): {
  total: number;
  labelled: number;
  missing: string[];
} {
  const missing = slugs.filter(slug => !LIBRARY_CAPABILITIES[slug]);
  return { total: slugs.length, labelled: slugs.length - missing.length, missing };
}
