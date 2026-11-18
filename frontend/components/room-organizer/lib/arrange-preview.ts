/**
 * 一句话布置 → 落位预览（2026-11-17，从 #151 接到当前 main）。
 *
 * 只做确定性计算：识别观礼区 / 摊位带 / 宴会套装，按物料目录的真实宽深排出
 * 可写入 plan 的设施。不落库、不进 undo；调用方确认后才 commitPlan。
 *
 * 单价、价格书、能力基线大表不在这一刀里：选型用目录名称与 bucket，
 * 设施只带契约已有字段（templateId / modelOverride / 米制尺寸）。
 */

import { planFacilitySchema, type PlanFacility } from '../../../../supabase/functions/_shared/site-plan';
import { layoutAudience, layoutAudienceFacing, parseSceneDemand, layoutStalls, type SceneDemand } from './arrange-scene';
import { layoutBanquetSuites, parseSuiteDemand, pickSuiteFurniture } from './arrange-suite';

export interface ArrangeCatalogueItem {
  slug: string;
  name: string;
  width: number;
  depth: number;
  /** 物料目录家族：seating / tables / exhibition … */
  bucket: string;
}

export interface ArrangePreviewSource {
  boundary: readonly { x: number; y: number }[];
  facilities: readonly {
    name: string;
    templateId: string;
    position: { x: number; y: number };
    size: { width: number; depth: number };
  }[];
  buildings?: readonly { points: readonly { x: number; y: number }[] }[];
}

export type ArrangePreviewKind = 'scene' | 'suite';

export type ArrangePreviewResult =
  | { ok: true; facilities: PlanFacility[]; label: string; message: string }
  | { ok: false; message: string };

const UNHEARD = '没听出要排什么：可以说「8 个摊位，留 2.4 米通道」，或「30 人观礼，留 2 米通道」。';

/** 这句话会不会走出落位预览。材质改写和三选一不在这一刀。 */
export function arrangePreviewKind(text: string): ArrangePreviewKind | null {
  if (parseSceneDemand(text)) return 'scene';
  if (parseSuiteDemand(text)) return 'suite';
  return null;
}

function clipName(name: string, fallback: string): string {
  const trimmed = name.trim().slice(0, 60);
  return trimmed.length > 0 ? trimmed : fallback;
}

function facilityFrom(input: {
  id: string;
  templateId: string;
  name: string;
  slug: string;
  x: number;
  y: number;
  rotationDeg: number;
  width: number;
  depth: number;
}): PlanFacility | null {
  const parsed = planFacilitySchema.safeParse({
    id: input.id,
    templateId: input.templateId,
    name: clipName(input.name, input.templateId),
    position: { x: input.x, y: input.y },
    rotationDeg: input.rotationDeg,
    size: { width: input.width, depth: input.depth },
    notes: '',
    ...(input.slug ? { modelOverride: input.slug.slice(0, 160) } : {}),
  });
  return parsed.success ? parsed.data : null;
}

function suiteKind(item: ArrangeCatalogueItem): string {
  if (item.bucket === 'seating' || /椅|凳|chair|stool|bench|seat/i.test(item.name)) return 'seat';
  if (item.bucket === 'tables' || /桌|台面|吧台|柜台|table|desk|counter/i.test(item.name)) return 'table';
  return 'none';
}

function pickStall(items: readonly ArrangeCatalogueItem[]): ArrangeCatalogueItem | null {
  const named = items.filter(item => /摊|棚|booth|stall|tent|市集/i.test(`${item.name} ${item.slug}`));
  const pool = named.length > 0 ? named : items.filter(item => item.bucket === 'exhibition');
  return [...pool].sort((a, b) => {
    const gap = Math.abs(Math.max(a.width, a.depth) - 2) - Math.abs(Math.max(b.width, b.depth) - 2);
    return gap === 0 ? a.slug.localeCompare(b.slug) : gap;
  })[0] ?? null;
}

function blockedRects(source: ArrangePreviewSource) {
  const rects: { x: number; y: number; width: number; depth: number }[] = [];
  for (const building of source.buildings ?? []) {
    if (building.points.length < 3) continue;
    const xs = building.points.map(point => point.x);
    const ys = building.points.map(point => point.y);
    rects.push({
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
      width: Math.max(...xs) - Math.min(...xs),
      depth: Math.max(...ys) - Math.min(...ys),
    });
  }
  return rects;
}

function stageOf(source: ArrangePreviewSource) {
  return source.facilities.find(facility => /舞台|主台|stage/i.test(`${facility.name} ${facility.templateId}`)) ?? null;
}

function stallLayoutLabel(layout: SceneDemand['stallLayout']): string {
  if (layout === 'single') return '单侧';
  if (layout === 'back-to-back') return '背靠背';
  return '两侧';
}

/**
 * 把一句话变成待确认的设施列表。
 * 失败只返回说明，不猜一套布局。
 */
export function buildArrangePreview(
  text: string,
  source: ArrangePreviewSource,
  catalogue: readonly ArrangeCatalogueItem[],
  ids: () => string = () => crypto.randomUUID(),
): ArrangePreviewResult {
  const scene = parseSceneDemand(text);
  const suite = scene ? null : parseSuiteDemand(text);
  if (!scene && !suite) return { ok: false, message: UNHEARD };
  if (source.boundary.length < 3) {
    return { ok: false, message: scene ? '先画场地边界，再排场景。' : '先画场地边界，再成套排桌。' };
  }
  if (scene?.kind === 'audience') {
    const furniture = catalogue.map(item => ({ ...item, kind: suiteKind(item) }));
    const seat = pickSuiteFurniture(furniture).seat;
    if (!seat) return { ok: false, message: '物料库里没有可坐的座椅。' };
    const stage = stageOf(source);
    const placements = stage
      ? layoutAudienceFacing({
        boundary: source.boundary,
        count: scene.count,
        seatWidth: seat.width,
        seatDepth: seat.depth,
        stage: { x: stage.position.x, y: stage.position.y, width: stage.size.width, depth: stage.size.depth },
        ...(scene.aisleM !== null ? { aisleM: scene.aisleM } : {}),
      })
      : layoutAudience({
        boundary: source.boundary,
        count: scene.count,
        seatWidth: seat.width,
        seatDepth: seat.depth,
        ...(scene.aisleM !== null ? { aisleM: scene.aisleM } : {}),
      });
    if (placements.length === 0) return { ok: false, message: `边界放不下 ${scene.count} 个座位。` };
    const facilities: PlanFacility[] = [];
    for (const point of placements) {
      const facility = facilityFrom({
        id: ids(),
        templateId: 'chair',
        name: seat.name,
        slug: seat.slug,
        x: point.x,
        y: point.y,
        rotationDeg: point.rotationDeg,
        width: seat.width,
        depth: seat.depth,
      });
      if (!facility) return { ok: false, message: '座椅尺寸写不进方案。' };
      facilities.push(facility);
    }
    return {
      ok: true,
      facilities,
      label: `观礼区 ${facilities.length} 座`,
      message: `预览：观礼区 ${facilities.length} 座（${stage ? '面向舞台' : '未找到舞台，按默认前场'}），确认后落库。`,
    };
  }
  if (scene?.kind === 'stalls') {
    const stall = pickStall(catalogue);
    if (!stall) return { ok: false, message: '物料库里没有摊位/棚房模型。' };
    const blocked = blockedRects(source);
    const placements = layoutStalls({
      boundary: source.boundary,
      count: scene.count,
      stallWidth: stall.width,
      stallDepth: stall.depth,
      ...(scene.aisleM !== null ? { aisleM: scene.aisleM } : {}),
      ...(scene.stallLayout ? { layout: scene.stallLayout } : {}),
      ...(blocked.length > 0 ? { blocked } : {}),
    });
    if (placements.length === 0) return { ok: false, message: `边界放不下 ${scene.count} 个摊位。` };
    const facilities: PlanFacility[] = [];
    for (const point of placements) {
      const facility = facilityFrom({
        id: ids(),
        templateId: 'booth-2x2',
        name: stall.name,
        slug: stall.slug,
        x: point.x,
        y: point.y,
        rotationDeg: point.rotationDeg,
        width: stall.width,
        depth: stall.depth,
      });
      if (!facility) return { ok: false, message: '摊位尺寸写不进方案。' };
      facilities.push(facility);
    }
    const layout = stallLayoutLabel(scene.stallLayout);
    return {
      ok: true,
      facilities,
      label: `摊位 ${facilities.length} 个`,
      message: `预览：摊位 ${facilities.length} 个（${layout}，摊口朝通道），确认后落库。`,
    };
  }
  if (!suite) return { ok: false, message: UNHEARD };
  const furniture = catalogue.map(item => ({ ...item, kind: suiteKind(item) }));
  const picked = pickSuiteFurniture(furniture);
  if (!picked.table || !picked.seat) return { ok: false, message: '物料库里缺桌子或椅子，套装排不了。' };
  const layout = layoutBanquetSuites({
    boundary: source.boundary,
    groups: suite.groups,
    perTable: suite.perTable,
    tableSize: Math.max(picked.table.width, picked.table.depth),
    seatSize: Math.max(picked.seat.width, picked.seat.depth),
    ...(suite.aisleM !== null ? { aisleM: suite.aisleM } : {}),
  });
  if (layout.tables.length === 0) return { ok: false, message: `边界放不下 ${suite.groups} 组桌，先扩边界或减少组数。` };
  const facilities: PlanFacility[] = [];
  for (const point of layout.tables) {
    const facility = facilityFrom({
      id: ids(),
      templateId: 'table',
      name: picked.table.name,
      slug: picked.table.slug,
      x: point.x,
      y: point.y,
      rotationDeg: point.rotationDeg,
      width: picked.table.width,
      depth: picked.table.depth,
    });
    if (!facility) return { ok: false, message: '桌子尺寸写不进方案。' };
    facilities.push(facility);
  }
  for (const point of layout.seats) {
    const facility = facilityFrom({
      id: ids(),
      templateId: 'chair',
      name: picked.seat.name,
      slug: picked.seat.slug,
      x: point.x,
      y: point.y,
      rotationDeg: point.rotationDeg,
      width: picked.seat.width,
      depth: picked.seat.depth,
    });
    if (!facility) return { ok: false, message: '座椅尺寸写不进方案。' };
    facilities.push(facility);
  }
  return {
    ok: true,
    facilities,
    label: `${layout.tables.length} 桌 · ${layout.seats.length} 椅`,
    message: `预览：${layout.tables.length} 桌 · ${layout.seats.length} 椅，确认后落库。`,
  };
}
