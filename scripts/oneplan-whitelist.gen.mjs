// 从 manifest.json 生成 edge/前端共享的 oneplan 可放置 templateId 白名单常量。
// 清单变更后跑一次：node scripts/oneplan-whitelist.gen.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('frontend/public/oneplan-icons/manifest.json', 'utf8'));
const kindMap = { icon: 'icon', 'scale-fg': 'scale', area: 'area' };
const ids = [];
for (const asset of manifest.assets) {
  const kind = kindMap[asset.kind];
  const slug = (asset.slug ?? '').trim();
  if (kind && slug) ids.push(`oneplan:${kind}:${slug}`);
}

const lines = ids.map(id => `  '${id}',`).join('\n');
const out = `/**
 * 可放置 OnePlan 物件白名单（#46-1b 数据驱动，来自 frontend/public/oneplan-icons/manifest.json）。
 *
 * 口径：只收录画布可放置的三类条目——icon / scale-fg（映射为 scale）/ area；
 * scale-bg 只是占地底形、categories 只是分类图标，不入白名单。
 * 本模块为纯 TS 常量，无 DOM / Storage 依赖，edge 与前端共享。
 * 重新生成：node scripts/oneplan-whitelist.gen.mjs（清单变更后跑一次）。
 */

export const ONEPLAN_TEMPLATE_PREFIX = 'oneplan:';

/** manifest 中可放置条目的稳定 templateId：\`oneplan:<kind>:<slug>\`。 */
export const ONEPLAN_PLACEABLE_TEMPLATE_IDS: readonly string[] = [
${lines}
];

const oneplanPlaceableSet = new Set<string>(ONEPLAN_PLACEABLE_TEMPLATE_IDS);

/** 是否为 oneplan 前缀且命中可放置清单。 */
export function isOneplanPlaceableTemplateId(templateId: string): boolean {
  return oneplanPlaceableSet.has(templateId);
}

/** 解析 oneplan templateId；非 oneplan 前缀返回 null。 */
export function parseOneplanTemplateId(templateId: string): { kind: string; slug: string } | null {
  if (!templateId.startsWith(ONEPLAN_TEMPLATE_PREFIX)) return null;
  const rest = templateId.slice(ONEPLAN_TEMPLATE_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) return null;
  return { kind: rest.slice(0, sep), slug: rest.slice(sep + 1) };
}
`;

writeFileSync('supabase/functions/_shared/oneplan-whitelist.ts', out);
console.log(`wrote ${ids.length} oneplan template ids`);
