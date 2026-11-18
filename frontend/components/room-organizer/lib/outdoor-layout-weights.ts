/**
 * docs/47 A2 证据分级（2026-11-19）：把 A1 进场的地图要素分成「怎么对待」三档。
 *
 * - hard-block：水域/围栏——禁区，摆位与流线不得进入（A3 引擎按硬否决消费）。
 * - soft-avoid：绿地（leisure=park/garden、landcover=grass/wood、landuse=grass 两族）——
 *   可摆但有代价（植被保护/审批），排布评分计代价。
 * - info：广场/停车场等铺装与开放空地——利好，适合签到/聚集/设备落点。
 *
 * 摘要是 fit-for-layout 的一行式（进模型上下文 `layoutEvidence`），明细分档留给引擎；
 * 摘要不声称覆盖完整——上游 warnings/unknowns 照旧如实声明。
 * 建筑/道路/入口不进分级：建筑足迹已走既有障碍路径（validate/clearForObject）。
 */
import { bounds } from "@/lib/site-intelligence/geometry";
import type { Bounds, Geometry } from "@/lib/site-intelligence/types";

export type LayoutWeight = "hard-block" | "soft-avoid" | "info";
export type LayoutSurface = "water" | "barrier" | "green" | "paved" | "open";

export interface LayoutEvidenceFeature {
  id: string;
  name: string;
  weight: LayoutWeight;
  surface: LayoutSurface;
  geometry: Geometry;
  tags: Record<string, string>;
  /** 到活动范围包围盒的间隙（米，重叠/紧贴为 0）。 */
  gapM: number;
  /** 相对活动范围中心的方位（东北/西南/北/…；压在范围内时为空串）。 */
  direction: string;
}

export interface LayoutEvidence {
  hard: LayoutEvidenceFeature[];
  soft: LayoutEvidenceFeature[];
  info: LayoutEvidenceFeature[];
  /** 一行式摘要，进模型上下文；最多 8 行。 */
  summary: string[];
}

type GradedInput = {
  id: string;
  kind: string;
  name: string;
  geometry: Geometry;
  tags: Record<string, string>;
};

const GREEN_LEISURE = new Set(["park", "garden"]);
const GREEN_LANDCOVER = new Set(["grass", "wood"]);
const GREEN_LANDUSE = new Set(["grass", "forest", "meadow", "village_green"]);

/** 与活动范围关联的最大间隙；再远的要素不进布局视野。 */
const RELEVANCE_GAP_M = 80;
/** 摘要行数上限（buildModelContext 侧按 compact 80 字符再截）。 */
const SUMMARY_MAX_LINES = 8;

/**
 * 单要素分档。返回 null 表示不属于布局证据（建筑/道路/入口/规划对象）。
 * 服务端解析（evidence.ts）与客户端 OFM 解码（openfreemap-*.ts）产出的 kind/tags 都按此判。
 */
export function layoutWeightForFeature(feature: {
  kind: string;
  tags: Record<string, string>;
}): { weight: LayoutWeight; surface: LayoutSurface } | null {
  if (feature.kind === "water") return { weight: "hard-block", surface: "water" };
  if (feature.kind === "barrier") return { weight: "hard-block", surface: "barrier" };
  if (feature.kind !== "open-space") return null;
  const tags = feature.tags ?? {};
  if (
    GREEN_LEISURE.has(tags.leisure ?? "") ||
    GREEN_LANDCOVER.has(tags.landcover ?? "") ||
    GREEN_LANDUSE.has(tags.landuse ?? "")
  )
    return { weight: "soft-avoid", surface: "green" };
  if (tags.place === "square" || tags.amenity === "parking" || tags.highway)
    return { weight: "info", surface: "paved" };
  return { weight: "info", surface: "open" };
}

function boundsGapM(a: Bounds, b: Bounds): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.hypot(dx, dy);
}

/** ENU：+x 东、+y 北。组合方位按中文习惯（东北/西北/东南/西南）。 */
function directionLabel(dx: number, dy: number): string {
  const ew = Math.abs(dx) < 0.5 ? "" : dx > 0 ? "东" : "西";
  const ns = Math.abs(dy) < 0.5 ? "" : dy > 0 ? "北" : "南";
  return `${ew}${ns}`;
}

function placeText(gapM: number, direction: string): string {
  if (gapM < 1) return direction ? `场地${direction}侧` : "场地内";
  return `场地${direction}侧约${Math.round(gapM)}m`;
}

function surfaceLabel(surface: LayoutSurface, tags: Record<string, string>): string {
  if (surface === "water") return "水域";
  if (surface === "barrier") return "围栏/障碍";
  if (surface === "green") return "绿地";
  if (surface === "paved")
    return tags.place === "square"
      ? "铺装面（广场）"
      : tags.amenity === "parking"
        ? "铺装面（停车场）"
        : "铺装面";
  return "开放空地";
}

function surfaceTail(surface: LayoutSurface): string {
  if (surface === "water") return "：列为禁区，摆位与流线不得进入";
  if (surface === "barrier") return "：列为禁区，不得占用或跨越";
  if (surface === "green") return "：可摆但有代价（植被保护与场地审批需核对），排布优先避让";
  if (surface === "paved") return "：利好（铺装平整），适合签到/聚集/设备落点";
  return "：利好（可用空地），现场核对后再用";
}

/** 同一 surface 内按方位分桶（最多两桶），桶内合并计数——一行式摘要不能逐要素铺开。 */
function buildSummary(graded: LayoutEvidenceFeature[]): string[] {
  const lines: string[] = [];
  for (const surface of ["water", "barrier", "green", "paved", "open"] as const) {
    const group = graded.filter((item) => item.surface === surface);
    if (!group.length) continue;
    const buckets: LayoutEvidenceFeature[][] = [];
    for (const item of group) {
      const bucket = buckets.find((b) => b[0]!.direction === item.direction);
      if (bucket) bucket.push(item);
      else if (buckets.length < 2) buckets.push([item]);
    }
    for (const bucket of buckets) {
      if (lines.length >= SUMMARY_MAX_LINES) return lines;
      const rep = bucket[0]!;
      const count = bucket.length > 1 ? `等${bucket.length}处` : "";
      const name = rep.name ? `「${rep.name.slice(0, 16)}」` : "";
      lines.push(
        `${placeText(rep.gapM, rep.direction)}${surfaceLabel(surface, rep.tags)}${name}${count}${surfaceTail(surface)}`,
      );
    }
  }
  return lines;
}

/**
 * 分级 + 一行式摘要。features 传快照要素（MapFeature 兼容），boundary 传活动范围（ENU 米）。
 * 没有边界（<3 点）时以锚点原点为参照，不拒绝分级；超出关联半径的要素不进结果。
 */
export function buildLayoutEvidence(
  features: ReadonlyArray<GradedInput>,
  boundary: ReadonlyArray<{ x: number; y: number }>,
): LayoutEvidence {
  const ring = boundary.length >= 3 ? boundary : null;
  const base = ring ? bounds({ type: "polygon", points: [...ring] }) : null;
  const center = base
    ? { x: (base.minX + base.maxX) / 2, y: (base.minY + base.maxY) / 2 }
    : { x: 0, y: 0 };
  const centerBox: Bounds = base ?? {
    minX: center.x,
    minY: center.y,
    maxX: center.x,
    maxY: center.y,
  };
  const graded: LayoutEvidenceFeature[] = [];
  for (const item of features) {
    const gradedKind = layoutWeightForFeature(item);
    if (!gradedKind) continue;
    const first = item.geometry.points[0];
    if (!first || !Number.isFinite(first.x) || !Number.isFinite(first.y)) continue;
    const box = bounds(item.geometry);
    const gapM = boundsGapM(centerBox, box);
    if (ring && gapM > RELEVANCE_GAP_M) continue;
    const nearestX = Math.min(Math.max(center.x, box.minX), box.maxX);
    const nearestY = Math.min(Math.max(center.y, box.minY), box.maxY);
    graded.push({
      id: item.id,
      name: (item.name ?? "").trim(),
      weight: gradedKind.weight,
      surface: gradedKind.surface,
      geometry: item.geometry,
      tags: item.tags ?? {},
      gapM,
      direction: directionLabel(nearestX - center.x, nearestY - center.y),
    });
  }
  graded.sort((a, b) => a.gapM - b.gapM);
  const byWeight = (weight: LayoutWeight) =>
    graded.filter((item) => item.weight === weight);
  return {
    hard: byWeight("hard-block"),
    soft: byWeight("soft-avoid"),
    info: byWeight("info"),
    summary: buildSummary(graded),
  };
}
