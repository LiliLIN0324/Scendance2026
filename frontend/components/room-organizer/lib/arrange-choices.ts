/**
 * 语义三选一（2026-11-17，从 #151 接到当前 main）。
 *
 * 观礼区 / 摊位带 / 宴会套装仍走 `arrange-preview`。
 * 这句话只点了能力（要能坐、接待、自助）时，按能力表挑最多 3 个真实型号，
 * 每个型号都在边界里排好，确认前不落库。
 *
 * 换一批沿用同一套排序，跳过已经给出的条目。
 * 每款带上目录缩略图（没有就是空字符串，界面改用模板贴纸）。
 * 「用 Aholo 生成一款」只算出要打开的生成面板参数，不在这里提交。
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
  /** 目录缩略图。空字符串表示没有，界面改用模板贴纸。 */
  thumb?: string;
}

export interface ArrangeChoice {
  slug: string;
  name: string;
  reason: string;
  count: number;
  facilities: PlanFacility[];
  /** 目录缩略图；没有时是空字符串。 */
  thumb: string;
  /** 落库用的模板，界面用它找贴纸。 */
  templateId: string;
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

/** 当前选中的设施。大块红线上，格子会靠到它旁边，而不是贴在整条红线的南缘。 */
export interface ArrangeClusterFocus {
  x: number;
  y: number;
  width: number;
  depth: number;
}

export interface ArrangeChoicePageInput {
  text: string;
  boundary: readonly { x: number; y: number }[];
  models: readonly ArrangeChoiceModel[];
  /** 0 是第一页。换一批传下一页。 */
  page?: number;
  ids?: () => string;
  focus?: ArrangeClusterFocus | null;
  /**
   * 刚用 Aholo 生成、要放进同一张候选列表的模型。
   * 放得下就排在最前，理由固定为「Aholo 生成」；不另起一套排布。
   */
  pinned?: ArrangeChoiceModel | null;
}

/** 三选一里「用 Aholo 生成一款」预填的模型描述。没听出能力时保留原话。 */
export function arrangeGeneratePrompt(text: string): string {
  const demand = parseArrangeDemand(text);
  if (demand.capability === 'seat') return '一把能坐的椅子';
  if (demand.capability === 'talk') return '一件可以接待交谈的桌台';
  if (demand.capability === 'operate') return '一台自助设备';
  const trimmed = text.trim().slice(0, 80);
  return trimmed.length > 0 ? trimmed : '一件活动物料';
}

/**
 * 三选一点「用 Aholo 生成一款」时，打开现成生成面板要用的参数。
 * 只描述要打开什么：不提交、不勾额度。面板仍是 generation-sheet。
 */
export function arrangeAholoSheet(text: string, facility: { id: string; name: string }): {
  task: 'model';
  scope: 'facility';
  source: 'text';
  facility: { id: string; name: string };
  prompt: string;
} {
  const name = facility.name.trim().slice(0, 60);
  return {
    task: 'model',
    scope: 'facility',
    source: 'text',
    facility: { id: facility.id, name: name.length > 0 ? name : '当前设施' },
    prompt: arrangeGeneratePrompt(text),
  };
}

/** 生成完成的那一款插到当前页最前；同一 slug 不重复。 */
export function offerGeneratedArrangeChoice(
  current: readonly ArrangeChoice[] | null,
  choice: ArrangeChoice,
): ArrangeChoice[] {
  return [choice, ...(current ?? []).filter(item => item.slug !== choice.slug)];
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

const CLUSTER_GAP_M = 1;

function pointInRing(x: number, y: number, ring: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    const crosses = (a.y > y) !== (b.y > y);
    if (!crosses) continue;
    const xAtY = ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (x < xAtY) inside = !inside;
  }
  return inside;
}

function clusterBox(
  placements: readonly { x: number; y: number }[],
  width: number,
  depth: number,
) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of placements) {
    minX = Math.min(minX, point.x - width / 2);
    maxX = Math.max(maxX, point.x + width / 2);
    minY = Math.min(minY, point.y - depth / 2);
    maxY = Math.max(maxY, point.y + depth / 2);
  }
  return { minX, minY, maxX, maxY };
}

function footprintsInside(
  placements: readonly { x: number; y: number }[],
  width: number,
  depth: number,
  boundary: readonly { x: number; y: number }[],
): boolean {
  for (const point of placements) {
    const corners = [
      [point.x - width / 2, point.y - depth / 2],
      [point.x + width / 2, point.y - depth / 2],
      [point.x + width / 2, point.y + depth / 2],
      [point.x - width / 2, point.y + depth / 2],
    ];
    for (const [x, y] of corners) {
      if (!pointInRing(x!, y!, boundary)) return false;
    }
  }
  return true;
}

/**
 * 大块红线上，`layoutGrid` 会把少数几件贴在南缘（整行槽位的开头）。
 * 选中了设施就挪到它旁边；没有选中、格子又远小于红线时改放到红线中部。
 * 小场地里格子已经铺满可用宽度，位置保持原样。挪完必须整组仍在红线内。
 */
export function relocateArrangeCluster(
  placements: readonly { x: number; y: number; rotationDeg: number }[],
  size: { width: number; depth: number },
  boundary: readonly { x: number; y: number }[],
  focus: ArrangeClusterFocus | null,
): { x: number; y: number; rotationDeg: number }[] {
  if (placements.length === 0 || boundary.length < 3) return [...placements];
  const box = clusterBox(placements, size.width, size.depth);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const halfW = (box.maxX - box.minX) / 2;
  const halfD = (box.maxY - box.minY) / 2;
  const shiftTo = (x: number, y: number) => {
    const dx = x - cx;
    const dy = y - cy;
    const next = placements.map(point => ({
      x: point.x + dx,
      y: point.y + dy,
      rotationDeg: point.rotationDeg,
    }));
    return footprintsInside(next, size.width, size.depth, boundary) ? next : null;
  };
  if (focus) {
    const targets = [
      { x: focus.x, y: focus.y + focus.depth / 2 + CLUSTER_GAP_M + halfD },
      { x: focus.x, y: focus.y - focus.depth / 2 - CLUSTER_GAP_M - halfD },
      { x: focus.x + focus.width / 2 + CLUSTER_GAP_M + halfW, y: focus.y },
      { x: focus.x - focus.width / 2 - CLUSTER_GAP_M - halfW, y: focus.y },
    ];
    for (const target of targets) {
      const moved = shiftTo(target.x, target.y);
      if (moved) return moved;
    }
  }
  const site = clusterBox(boundary.map(point => ({ x: point.x, y: point.y })), 0, 0);
  const siteW = site.maxX - site.minX;
  const siteD = site.maxY - site.minY;
  const clusterW = box.maxX - box.minX;
  const clusterD = box.maxY - box.minY;
  if (clusterW < siteW * 0.45 && clusterD < siteD * 0.45) {
    const moved = shiftTo((site.minX + site.maxX) / 2, (site.minY + site.maxY) / 2);
    if (moved) return moved;
  }
  return [...placements];
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
  const count = demand.count;
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
  const pinned = input.pinned;
  const pinnedReady = Boolean(pinned && pinned.slug.trim() && pinned.width > 0 && pinned.depth > 0);
  if (ranked.length === 0 && !pinnedReady) {
    return {
      ok: false,
      message: page > 0 ? '没有更多可换的款。' : '物料库里没有满足这个能力的模型。',
      keepCurrent,
      reason: 'empty',
    };
  }
  const ids = input.ids ?? (() => crypto.randomUUID());
  const templateId = templateIdFor(demand.capability);
  const thumbOf = (slug: string, fallback = ''): string => {
    const fromCatalog = input.models.find(model => model.slug === slug)?.thumb;
    return (fromCatalog ?? fallback).trim();
  };
  const layoutOne = (item: ArrangeItem, reason: string, thumb: string): ArrangeChoice | null => {
    const positions = relocateArrangeCluster(
      layoutGrid({
        boundary: input.boundary,
        count,
        width: item.width,
        depth: item.depth,
        ...(demand.aisleM !== null ? { aisleM: demand.aisleM } : {}),
      }),
      { width: item.width, depth: item.depth },
      input.boundary,
      input.focus ?? null,
    );
    if (positions.length < count) return null;
    const facilities: PlanFacility[] = [];
    for (const point of positions) {
      const parsed = planFacilitySchema.safeParse({
        id: ids(),
        templateId,
        name: clipName(item.name, templateId),
        position: { x: point.x, y: point.y },
        rotationDeg: point.rotationDeg,
        size: { width: item.width, depth: item.depth },
        notes: '',
        modelOverride: item.slug.slice(0, 160),
      });
      if (!parsed.success) return null;
      facilities.push(parsed.data);
    }
    if (facilities.length !== count) return null;
    return {
      slug: item.slug,
      name: clipName(item.name, templateId),
      reason,
      count,
      facilities,
      thumb,
      templateId,
    };
  };
  const choices: ArrangeChoice[] = [];
  if (pinned && pinnedReady) {
    const placed = layoutOne(
      {
        slug: pinned.slug,
        name: pinned.name,
        width: pinned.width,
        depth: pinned.depth,
        kind: pinned.kind || 'none',
      },
      'Aholo 生成',
      (pinned.thumb ?? '').trim() || thumbOf(pinned.slug),
    );
    if (placed) choices.push(placed);
  }
  for (const entry of ranked) {
    if (choices.some(choice => choice.slug === entry.item.slug)) continue;
    const placed = layoutOne(entry.item, entry.reason, thumbOf(entry.item.slug));
    if (placed) choices.push(placed);
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

/**
 * 把刚生成的一款排进同一句需求。放不下就返回 null，调用方仍走设施候选回填。
 */
export function buildGeneratedArrangeChoice(input: {
  text: string;
  boundary: ArrangeChoicePageInput['boundary'];
  model: ArrangeChoiceModel;
  focus?: ArrangeChoicePageInput['focus'];
  ids?: ArrangeChoicePageInput['ids'];
}): ArrangeChoice | null {
  const result = buildArrangeChoicePage({
    text: input.text,
    boundary: input.boundary,
    models: [],
    page: 0,
    pinned: input.model,
    ...(input.focus !== undefined ? { focus: input.focus } : {}),
    ...(input.ids ? { ids: input.ids } : {}),
  });
  if (!result.ok) return null;
  return result.choices.find(item => item.slug === input.model.slug) ?? null;
}
