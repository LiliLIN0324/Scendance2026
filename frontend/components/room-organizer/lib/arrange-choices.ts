/**
 * 语义三选一（2026-11-17，从 #151 接到当前 main）。
 *
 * 观礼区 / 摊位带 / 宴会套装仍走 `arrange-preview`。
 * 这句话只点了能力（要能坐、接待、自助）时，按能力表挑最多 3 个真实型号，
 * 每个型号都在边界里排好，确认前不落库。
 *
 * 换一批沿用同一套排序，跳过已经给出的条目。
 * 设施只写契约已有字段。材质词可以听出来，但不写入方案：契约还没有材质字段。
 * 坐标与尺寸都是米。
 */

import { planFacilitySchema, type PlanFacility } from '../../../../supabase/functions/_shared/site-plan';
import {
  layoutGrid,
  parseArrangeDemand,
  rankArrangeCandidates,
  type ArrangeDemand,
  type ArrangeItem,
} from './arrange-request';

export const ARRANGE_CHOICE_PAGE_SIZE = 3;

const UNHEARD = '没听出要排什么：可以说「8 个摊位，留 2.4 米通道」，或「30 人观礼，留 2 米通道」。';

export interface ArrangeChoiceModel {
  slug: string;
  name: string;
  width: number;
  depth: number;
  /** 能力表口径；表外传 `none`，不靠名字猜。 */
  kind: string;
}

export interface ArrangeChoice {
  slug: string;
  name: string;
  reason: string;
  count: number;
  facilities: PlanFacility[];
}

export type ArrangeChoiceFailure =
  | 'unheard'
  | 'count'
  | 'boundary'
  | 'empty'
  | 'unplaced';

export type ArrangeChoicePageResult =
  | { ok: true; choices: ArrangeChoice[]; message: string }
  | { ok: false; message: string; keepCurrent: boolean; reason: ArrangeChoiceFailure };

export interface ArrangeChoicePageInput {
  text: string;
  boundary: readonly { x: number; y: number }[];
  models: readonly ArrangeChoiceModel[];
  /** 0 是第一页。换一批传下一页。 */
  page?: number;
  ids?: () => string;
}

function clipName(name: string, fallback: string): string {
  const trimmed = name.trim().slice(0, 60);
  return trimmed.length > 0 ? trimmed : fallback.slice(0, 60);
}

function templateIdFor(capability: NonNullable<ArrangeDemand['capability']>): string {
  if (capability === 'seat') return 'chair';
  if (capability === 'talk') return 'booth';
  return 'kiosk';
}

/**
 * 把一句话变成当前页的候选。失败只说明原因，不编一套坐标。
 * `keepCurrent` 为真时，调用方保留上一页（换一批已经到底）。
 */
export function buildArrangeChoicePage(input: ArrangeChoicePageInput): ArrangeChoicePageResult {
  const page = input.page ?? 0;
  const keepCurrent = page > 0;
  const demand = parseArrangeDemand(input.text);
  if (!demand.capability) {
    return { ok: false, message: UNHEARD, keepCurrent: false, reason: 'unheard' };
  }
  if (demand.count === null) {
    return { ok: false, message: '还差数量：请说「30 人」或「30 把」。', keepCurrent: false, reason: 'count' };
  }
  if (input.boundary.length < 3) {
    return { ok: false, message: '先画场地边界，再按需求排道具。', keepCurrent: false, reason: 'boundary' };
  }
  const items: ArrangeItem[] = input.models.map(model => ({
    slug: model.slug,
    name: model.name,
    width: model.width,
    depth: model.depth,
    kind: model.kind,
  }));
  const ranked = rankArrangeCandidates(
    items,
    demand,
    ARRANGE_CHOICE_PAGE_SIZE,
    input.text,
    page * ARRANGE_CHOICE_PAGE_SIZE,
  );
  if (ranked.length === 0) {
    return {
      ok: false,
      message: page > 0 ? '没有更多可换的款。' : '物料库里没有满足这个能力的模型。',
      keepCurrent,
      reason: 'empty',
    };
  }
  const ids = input.ids ?? (() => crypto.randomUUID());
  const templateId = templateIdFor(demand.capability);
  const choices: ArrangeChoice[] = [];
  for (const entry of ranked) {
    const positions = layoutGrid({
      boundary: input.boundary,
      count: demand.count,
      width: entry.item.width,
      depth: entry.item.depth,
      ...(demand.aisleM !== null ? { aisleM: demand.aisleM } : {}),
    });
    if (positions.length < demand.count) continue;
    const facilities: PlanFacility[] = [];
    let dropped = false;
    for (const point of positions) {
      const parsed = planFacilitySchema.safeParse({
        id: ids(),
        templateId,
        name: clipName(entry.item.name, templateId),
        position: { x: point.x, y: point.y },
        rotationDeg: point.rotationDeg,
        size: { width: entry.item.width, depth: entry.item.depth },
        notes: '',
        modelOverride: entry.item.slug.slice(0, 160),
      });
      if (!parsed.success) {
        dropped = true;
        break;
      }
      facilities.push(parsed.data);
    }
    if (dropped || facilities.length !== demand.count) continue;
    choices.push({
      slug: entry.item.slug,
      name: clipName(entry.item.name, templateId),
      reason: entry.reason,
      count: demand.count,
      facilities,
    });
  }
  if (choices.length === 0) {
    return {
      ok: false,
      message: page > 0
        ? '后面的款在这块边界里放不下。'
        : `边界放不下 ${demand.count} 件，先扩边界或减少数量。`,
      keepCurrent,
      reason: 'unplaced',
    };
  }
  const materialNote = demand.material ? '材质保持原样。' : '';
  return {
    ok: true,
    choices,
    message: `给了 ${choices.length} 个方案，选一个再落库（都能一步撤销）。${materialNote}`,
  };
}
