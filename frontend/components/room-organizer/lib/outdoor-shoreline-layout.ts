/**
 * 2026-11-17 用户实测卡点：说「就沿着水岸线」，智能体回「工作台里没有可识别的水岸线……请告诉我在哪一侧」。
 *
 * 根因不是话术，是通路：水进不了站点快照（已在 `openfreemap-water` 补上），也没有一个能把
 * 「沿某条岸线」变成可核对预览的确定性排布。本模块补的就是后半段：
 *
 * - 从真实水体几何里取出「落在活动边界内」的那几段岸线；
 * - 沿最长的一段按间距落钓位（贴岸、朝水），钓位后方出观众区，一端出签到/裁判席，再退一条人行通道；
 * - 放不下就如实拒绝并给出「这段岸线最多几个」，不套一个看起来能用的假方案；
 * - 全程只出预览数据，不写画布；岸线来自 OSM 瓦片，不是实测岸线，也不构成救生/安全认证。
 */
import type {
  PlanFacility,
  PlanNode,
  PlanPoint,
  PlanRoute,
  PlanZone,
} from "../../../../supabase/functions/_shared/site-plan";
import { facilityFootprintRing, facilityPlacementIssues } from "./site-plan-facilities";
import { planPointInRing } from "./site-plan-editing";

/** 一条可沿岸的线：面状水用它的外环，线状水用中心线/岸线折线。坐标与 plan 同为局部 ENU 米。 */
export interface Shoreline {
  id: string;
  name: string;
  points: PlanPoint[];
  closed: boolean;
}

export interface ShorelineDemand {
  /** 明确说了几个钓位就按几个排；没说明就按可用长度自动铺满。 */
  stations?: number;
  /** 钓位间距（米），缺省 8 m。 */
  spacingM?: number;
  /** 观众区纵深（米），缺省 3 m。 */
  audienceDepthM?: number;
  /** 单个钓位占地（米），缺省 2×2。 */
  stationWidthM?: number;
  stationDepthM?: number;
}

export interface ShorelineLayoutSummary {
  stations: number;
  spacingM: number;
  runLengthM: number;
  audienceDepthM: number;
  waterName: string;
  warnings: string[];
}

export interface ShorelineLayout {
  zones: PlanZone[];
  facilities: PlanFacility[];
  routes: PlanRoute[];
  nodes: PlanNode[];
  summary: ShorelineLayoutSummary;
}

export type ShorelineRefusal =
  | "no-water"
  | "outside-scope"
  | "too-short"
  | "conflict";

export type ShorelineProposal =
  | { ok: true; layout: ShorelineLayout }
  | { ok: false; reason: ShorelineRefusal; message: string };

interface Sample {
  p: PlanPoint;
  s: number;
}

const SAMPLE_STEP_M = 2;
const MIN_RUN_M = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 「沿岸/沿水岸线/靠河/滨水」这一类排布意图。只做意图识别，不替代模型理解。 */
export function shorelineIntent(text: string): boolean {
  const value = text.replace(/\s+/gu, "");
  return /(沿着|顺?沿|贴着|靠着|临)(?:这条|那条|一段|一侧)?(水岸|岸线|岸边|河岸|河边|湖岸|湖边|江边|水边|水域|河道|河|湖|江)/u.test(
    value,
  );
}

/** 从一句话里读钓位与间距；读不到就交给几何容量决定。 */
export function parseShorelineDemand(text: string): ShorelineDemand {
  const demand: ShorelineDemand = {};
  const value = text.replace(/\s+/gu, "");
  const stations = value.match(/(\d{1,3})\s*(?:个|处|个位置|个点位)?\s*钓位/u)
    ?? value.match(/钓位\s*(\d{1,3})\s*(?:个|处)?/u);
  const parsedStations = stations ? Number(stations[1]) : NaN;
  if (Number.isFinite(parsedStations) && parsedStations > 0) demand.stations = Math.min(200, Math.round(parsedStations));
  const spacing = value.match(/(?:间隔|间距|每隔|相距)\s*(\d{1,2}(?:\.\d)?)\s*(?:米|m|M)/u);
  const parsedSpacing = spacing ? Number(spacing[1]) : NaN;
  if (Number.isFinite(parsedSpacing) && parsedSpacing >= 2) demand.spacingM = parsedSpacing;
  const audience = value.match(/(?:观众区|观众|留出|退让)[^。；;]{0,6}?(\d{1,2}(?:\.\d)?)\s*(?:米|m|M)/u);
  const parsedAudience = audience ? Number(audience[1]) : NaN;
  if (Number.isFinite(parsedAudience) && parsedAudience >= 1) demand.audienceDepthM = parsedAudience;
  return demand;
}

function polylineOf(shore: Shoreline): PlanPoint[] {
  const first = shore.points[0];
  if (!shore.closed || !first) return shore.points;
  return [...shore.points, first];
}

function densify(points: PlanPoint[], step = SAMPLE_STEP_M): Sample[] {
  const samples: Sample[] = [];
  if (!points.length) return samples;
  samples.push({ p: points[0]!, s: 0 });
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-6) continue;
    const steps = Math.max(1, Math.ceil(length / step));
    for (let k = 1; k <= steps; k++) {
      const distance = Math.min(length, (length * k) / steps);
      const t = distance / length;
      samples.push({
        p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        s: travelled + distance,
      });
    }
    travelled += length;
  }
  return samples;
}

/** 只保留真正落在活动边界内、且不在既有分区/建筑里的连续段：地图上的水常常一半在界外。 */
function runsInsideBoundary(
  samples: Sample[],
  boundary: PlanPoint[],
  exclusions: PlanPoint[][],
): Sample[][] {
  const runs: Sample[][] = [];
  let current: Sample[] = [];
  for (const sample of samples) {
    const usable =
      planPointInRing(sample.p, boundary) &&
      !exclusions.some(ring => planPointInRing(sample.p, ring));
    if (usable) current.push(sample);
    else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  return runs.filter(run => run.length >= 2);
}

function runLength(run: Sample[]): number {
  return run[run.length - 1]!.s - run[0]!.s;
}

/**
 * 切掉「拐进陆地又拐回来」的短支段。
 *
 * 闭水面的环经过活动边界时，会在角上多出几米垂直于岸线的支段（实测：180 m 湖岸多出 12 m）。
 * 不切开的话，钓位会被摆到垂直支段上、末端还会压到边界。按走向突变 > 45° 切段，只留最长的一段；
 * 真实缓弯岸线（每步转向远小于 45°）不会被误切。
 */
function longestStraightRun(run: Sample[], maxTurnDeg = 45): Sample[] {
  if (run.length < 3) return run;
  const limit = (maxTurnDeg * Math.PI) / 180;
  const chunks: Sample[][] = [];
  let current: Sample[] = [run[0]!];
  let previousAngle: number | null = null;
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1]!;
    const b = run[i]!;
    const angle = Math.atan2(b.p.y - a.p.y, b.p.x - a.p.x);
    if (previousAngle !== null) {
      let delta = Math.abs(angle - previousAngle);
      if (delta > Math.PI) delta = 2 * Math.PI - delta;
      if (delta > limit) {
        chunks.push(current);
        current = [a];
      }
    }
    current.push(b);
    previousAngle = angle;
  }
  chunks.push(current);
  let best = chunks[0]!;
  for (const chunk of chunks) if (runLength(chunk) > runLength(best)) best = chunk;
  return best;
}

function pointAt(run: Sample[], s: number): PlanPoint {
  const first = run[0]!;
  if (s <= first.s) return first.p;
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1]!;
    const b = run[i]!;
    if (b.s >= s) {
      const span = b.s - a.s || 1;
      const t = clamp((s - a.s) / span, 0, 1);
      return { x: a.p.x + (b.p.x - a.p.x) * t, y: a.p.y + (b.p.y - a.p.y) * t };
    }
  }
  return run[run.length - 1]!.p;
}

/** 岸线法线：指向落水一侧的反面（陆地侧）。用整段中点判定，避免逐点翻面抖动。 */
function inlandNormal(run: Sample[], boundary: PlanPoint[], water?: PlanPoint[]): PlanPoint {
  const mid = run[Math.floor(run.length / 2)]!;
  const prev = run[Math.max(0, Math.floor(run.length / 2) - 1)]!;
  const next = run[Math.min(run.length - 1, Math.floor(run.length / 2) + 1)]!;
  const dx = next.p.x - prev.p.x;
  const dy = next.p.y - prev.p.y;
  const length = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / length, y: dx / length };
  const probe = (sign: number): number => {
    const point = { x: mid.p.x + normal.x * sign * 2.5, y: mid.p.y + normal.y * sign * 2.5 };
    let score = planPointInRing(point, boundary) ? 1 : 0;
    if (water && water.length >= 3) score += planPointInRing(point, water) ? 0 : 1;
    return score;
  };
  return probe(1) >= probe(-1) ? normal : { x: -normal.x, y: -normal.y };
}

function translate(run: Sample[], normal: PlanPoint, distance: number, from: number, to: number, maxPoints = 6): PlanPoint[] {
  const out: PlanPoint[] = [];
  const span = Math.max(1e-6, to - from);
  const count = Math.max(2, Math.min(maxPoints, Math.ceil(span / 12) + 1));
  for (let i = 0; i < count; i++) {
    const s = from + (span * i) / (count - 1);
    const p = pointAt(run, s);
    out.push({
      x: Math.round((p.x + normal.x * distance) * 10) / 10,
      y: Math.round((p.y + normal.y * distance) * 10) / 10,
    });
  }
  return out;
}

function ringInsideBoundary(ring: PlanPoint[], boundary: PlanPoint[]): boolean {
  return ring.length >= 3 && facilityPlacementIssues(ring, boundary).length === 0;
}

function overlapsAny(ring: PlanPoint[], others: PlanPoint[]): boolean {
  const box = (points: PlanPoint[]) => ({
    w: Math.min(...points.map(p => p.x)),
    e: Math.max(...points.map(p => p.x)),
    s: Math.min(...points.map(p => p.y)),
    n: Math.max(...points.map(p => p.y)),
  });
  const a = box(ring);
  const b = box(others);
  return a.w < b.e && a.e > b.w && a.s < b.n && a.n > b.s;
}

export interface ShorelineLayoutInput {
  shorelines: Shoreline[];
  boundary: PlanPoint[];
  demand?: ShorelineDemand;
  /** 既有设施足迹环：不压上去。 */
  obstacles?: PlanPoint[][];
  /** 既有分区/建筑：岸线落进这些范围的那些段不拿来排（否则新分区会与既有分区重叠）。 */
  exclusions?: PlanPoint[][];
  /** 指定用哪条岸线；缺省取边界内最长的一段。 */
  preferredShorelineId?: string;
}

/**
 * 沿岸排布：钓位贴岸、观众区退在钓位后方、签到/裁判席在一端、人行通道再退一条。
 * 只返回预览数据；放不下就拒绝，不产出「看起来能用」的假方案。
 */
export function proposeShorelineLayout(
  input: ShorelineLayoutInput,
  id: () => string,
): ShorelineProposal {
  const { shorelines, boundary } = input;
  if (!shorelines.length) {
    return {
      ok: false,
      reason: "no-water",
      message:
        "这块场地的地图数据里没有水系（湖面/河道/岸线），所以没法沿岸排。可以在「标注」里用线段画一条岸线，我按它排钓位和观众区。",
    };
  }
  if (boundary.length < 3) {
    return {
      ok: false,
      reason: "outside-scope",
      message: "还没有可用的活动边界；先确认活动范围，我再按边界内的岸线排。",
    };
  }

  const ordered = input.preferredShorelineId
    ? [...shorelines].sort((a, b) => Number(b.id === input.preferredShorelineId) - Number(a.id === input.preferredShorelineId))
    : shorelines;

  let chosen: { shore: Shoreline; run: Sample[]; length: number } | null = null;
  let sawWater = false;
  for (const shore of ordered) {
    const samples = densify(polylineOf(shore));
    if (samples.length < 2) continue;
    sawWater = true;
    const runs = runsInsideBoundary(samples, boundary, input.exclusions ?? []);
    for (const raw of runs) {
      const run = longestStraightRun(raw);
      const length = runLength(run);
      if (length < MIN_RUN_M) continue;
      if (!chosen || length > chosen.length) chosen = { shore, run, length };
    }
    if (chosen && input.preferredShorelineId && shore.id === input.preferredShorelineId) break;
  }

  if (!chosen) {
    if (!sawWater) {
      return {
        ok: false,
        reason: "no-water",
        message: "地图上有水，但没解出可用岸线（几何不完整）。请用「标注 → 线段」沿水边画一条，我按它排。",
      };
    }
    return {
      ok: false,
      reason: "outside-scope",
      message:
        "地图上有水，但这条水岸不在当前活动边界内（或边界内那一段不足 10 m）。先把边界扩到岸边，或换一段水岸，我再沿岸排。",
    };
  }

  const { shore, run } = chosen;
  const runStart = run[0]!.s;
  const length = runLength(run);
  const spacing = clamp(input.demand?.spacingM ?? 8, 3, 30);
  const audienceDepth = clamp(input.demand?.audienceDepthM ?? 3, 1, 12);
  const stationWidth = clamp(input.demand?.stationWidthM ?? 2, 1, 6);
  const stationDepth = clamp(input.demand?.stationDepthM ?? 2, 1, 6);
  const maxStations = Math.max(1, Math.floor(length / spacing) + 1);
  const stations = input.demand?.stations
    ? Math.min(input.demand.stations, 200)
    : Math.min(60, maxStations);

  if ((stations - 1) * spacing > length + 0.01) {
    return {
      ok: false,
      reason: "too-short",
      message: `这段可用水岸只有约 ${Math.round(length)} m，按 ${spacing} m 间距最多排 ${maxStations} 个钓位；要 ${stations} 个就得缩小间距或换更长的一段岸线。`,
    };
  }

  const waterRing = shore.closed && shore.points.length >= 3 ? shore.points : undefined;
  const normal = inlandNormal(run, boundary, waterRing);
  const obstacles = input.obstacles ?? [];
  const audienceFrom = 0.9 + stationDepth + 1.2;

  // 钓位必须归入一个分区：规划层校验要求每个设施都在自己分区内（无分区=不合法）。
  const stationsZone = ((): PlanZone | null => {
    for (const to of [audienceFrom - 0.8, audienceFrom - 1.2, audienceFrom - 1.6]) {
      const ring = [
        ...translate(run, normal, 0.3, runStart, runStart + length, 6),
        ...translate(run, normal, Math.max(0.8, to), runStart, runStart + length, 6).reverse(),
      ];
      if (!ringInsideBoundary(ring, boundary)) continue;
      return {
        id: id(),
        semantic: "reserved",
        name: "钓位区",
        polygon: ring,
        event: "沿岸比赛·钓位",
        geometrySource: "map-unverified",
        notes: "贴岸钓位带（示意）：面向水面一字排开；需现场核对岸线稳定、水深与救生条件。",
      };
    }
    return null;
  })();
  const zones: PlanZone[] = stationsZone ? [stationsZone] : [];

  const facilities: PlanFacility[] = [];
  const failed: PlanPoint[] = [];
  const margin = Math.min((length - (stations - 1) * spacing) / 2, spacing / 2);
  for (let index = 0; index < stations; index++) {
    const s = runStart + margin + index * spacing;
    const anchor = pointAt(run, s);
    const center = {
      x: Math.round((anchor.x + normal.x * (stationDepth / 2 + 0.9)) * 10) / 10,
      y: Math.round((anchor.y + normal.y * (stationDepth / 2 + 0.9)) * 10) / 10,
    };
    const facility: PlanFacility = {
      id: id(),
      templateId: "booth-2x2",
      name: `钓位 ${index + 1}`,
      position: center,
      rotationDeg: Math.round((Math.atan2(-normal.x, normal.y) * 180) / Math.PI),
      size: { width: stationWidth, depth: stationDepth },
      ...(stationsZone ? { zoneId: stationsZone.id } : {}),
      notes: "沿岸钓位（示意）：面向水面，需现场核对岸线稳定、水深与救生条件。",
    };
    const ring = facilityFootprintRing(facility);
    const inBoundary = ringInsideBoundary(ring, boundary);
    const inWater = waterRing ? ring.some(point => planPointInRing(point, waterRing)) : false;
    const blocked = obstacles.some(other => overlapsAny(ring, other));
    if (!inBoundary || inWater || blocked) {
      failed.push(center);
      continue;
    }
    facilities.push(facility);
  }

  if (!facilities.length) {
    return {
      ok: false,
      reason: "conflict",
      message:
        "岸线找到了，但贴岸这条带子放不下钓位（越界、压水或与既有设施重叠）。把边界往陆地侧让一点，或先挪开岸边现有物件再排。",
    };
  }
  if (!stationsZone) {
    return {
      ok: false,
      reason: "conflict",
      message:
        "岸线贴得太靠近边界，排不下一个可以归属分区的钓位带。把活动边界往岸边扩一点（至少留出 3 m 陆侧），我再沿岸排。",
    };
  }

  let audienceTo = audienceFrom + audienceDepth;
  // 既有设施占住的那条带子不能压：逐步收窄，收不动就不出观众区（宁缺不造假）。
  for (const depth of [audienceDepth, 2.5, 2, 1.5]) {
    const to = audienceFrom + depth;
    const ring = [
      ...translate(run, normal, audienceFrom, runStart, runStart + length, 6),
      ...translate(run, normal, to, runStart, runStart + length, 6).reverse(),
    ];
    if (!ringInsideBoundary(ring, boundary)) continue;
    if (obstacles.some(other => overlapsAny(ring, other))) continue;
    audienceTo = to;
    zones.push({
      id: id(),
      semantic: "audience",
      name: "观众区",
      polygon: ring,
      event: "沿岸比赛·观众区",
      geometrySource: "map-unverified",
      notes: `沿水岸线退 ${Math.round(audienceFrom * 10) / 10}–${Math.round(to * 10) / 10} m 的观众带（示意）；不含护栏、疏散与容量认证。`,
    });
    break;
  }

  const checkinCenter = translate(run, normal, audienceTo + 3, runStart + Math.min(4, length / 4), runStart + Math.min(4, length / 4), 2)[0];
  if (checkinCenter) {
    const checkinRing = [
      { x: checkinCenter.x - 3, y: checkinCenter.y - 2 },
      { x: checkinCenter.x + 3, y: checkinCenter.y - 2 },
      { x: checkinCenter.x + 3, y: checkinCenter.y + 2 },
      { x: checkinCenter.x - 3, y: checkinCenter.y + 2 },
    ];
    if (ringInsideBoundary(checkinRing, boundary) && !obstacles.some(other => overlapsAny(checkinRing, other))) {
      zones.push({
        id: id(),
        semantic: "checkin",
        name: "签到与裁判席",
        polygon: checkinRing,
        event: "沿岸比赛·签到与裁判",
        geometrySource: "map-unverified",
        notes: "靠岸线一端的签到/裁判位（示意）；报名核验与称重流程需按主办规则补。",
      });
      const desk: PlanFacility = {
        id: id(),
        templateId: "booth-2x2",
        name: "裁判桌",
        position: { x: checkinCenter.x, y: checkinCenter.y },
        rotationDeg: 0,
        size: { width: 2, depth: 2 },
        zoneId: zones[zones.length - 1]!.id,
        notes: "签到/称重台（示意）。",
      };
      const deskRing = facilityFootprintRing(desk);
      if (ringInsideBoundary(deskRing, boundary) && !obstacles.some(other => overlapsAny(deskRing, other))) facilities.push(desk);
    }
  }

  const routes: PlanRoute[] = [];
  const warnings: string[] = [
    "岸线来自 OSM 瓦片几何，不是现场测量；岸线稳定、水深、落差与救生配置需现场核对。",
    "钓位与观众区为几何示意，不含护栏、救生圈、照明与比赛规则核验；不构成安全认证。",
  ];
  // 通道不能从既有设施里穿过去：往外一层层退，退到没冲突再用；退不动就不出这条线。
  let aislePath: PlanPoint[] | null = null;
  // 签到席占了靠近端点的那一段，通道从它后面开始，不从台子上穿过去。
  const aisleFrom = runStart + Math.min(10, length / 3);
  for (const extra of [1.5, 3.5, 5.5, 7.5, 9.5]) {
    const path = translate(run, normal, audienceTo + extra, aisleFrom, runStart + length, 8);
    if (path.length < 2) break;
    if (!path.every(point => planPointInRing(point, boundary))) continue;
    if (obstacles.some(other => path.some(point => overlapsAny([point], other)))) continue;
    aislePath = path;
    break;
  }
  if (aislePath) {
    routes.push({
      id: id(),
      kind: "pedestrian",
      name: "钓位后方人行通道",
      points: aislePath,
      widthM: 3,
      oneWay: false,
      notes: "钓位与观众区之间保留 3 m 通行带（示意）；不是疏散宽度认证。",
    });
  } else {
    warnings.push("钓位后方没有可用的通行带（越界或压到既有设施），本轮不出通道；请先挪开岸边物件。");
  }

  if (failed.length) warnings.push(`${failed.length} 个预定钓位因越界/压水/与既有设施重叠未落位。`);

  return {
    ok: true,
    layout: {
      zones,
      facilities,
      routes,
      nodes: [],
      summary: {
        stations: facilities.filter(f => f.name.startsWith("钓位")).length,
        spacingM: spacing,
        runLengthM: Math.round(length * 10) / 10,
        audienceDepthM: audienceDepth,
        waterName: shore.name || "水域",
        warnings,
      },
    },
  };
}
