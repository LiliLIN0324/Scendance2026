/**
 * 2026-11-17 用户拍板「沿线/巡游和沿岸一起进第一批」：参照排布的第二种参照物——线 路。
 *
 * 与 OnePlan 路跑案（Buffalo Marathon 复刻规格）同构：一条路线参照（地图道路或画布上
 * 已有的巡游线）+ 沿线等距摆补给站 + 起终点区 + 起终拱门节点；参照来自地图时补一条
 * 赛事中心线（示意）。与沿岸引擎共用几何核心（densify/runsInsideBoundary/longestStraightRun
 * 等，见 outdoor-shoreline-layout.ts），只是语义不同：钓位贴水岸，补给站贴路线。
 *
 * 口径：
 * - 站位必须在路线廊道之外（路线自身 widthM/2 + 1 m 净距），否则规划层校验会拦；
 * - 参照来自地图（无 widthM）时补一条 widthM 1 的赛事中心线示意；来自画布已有线路时不重复加；
 * - 全程只出预览数据，不写画布；线路来自 OSM 瓦片/画布，不是实测赛道，封路、计时、
 *   医疗与安保需与主办方和交管核对，不构成安全认证。
 */
import type {
  PlanFacility,
  PlanNode,
  PlanPoint,
  PlanRoute,
  PlanZone,
} from "../../../../supabase/functions/_shared/site-plan";
import { facilityFootprintRing, facilityPlacementIssues } from "./site-plan-facilities";
import {
  densify,
  inlandNormal,
  longestStraightRun,
  pointAt,
  runLength,
  runsInsideBoundary,
  shorelineIntent,
  translate,
} from "./outdoor-shoreline-layout";
import { isShorelineEvent } from "./outdoor-event-logic";

/** 一条可作参照的线路：地图道路（无 widthM）或画布已有线路（带自身 widthM）。 */
export interface RouteLine {
  id: string;
  name: string;
  points: PlanPoint[];
  /** 画布线路自带宽度（廊道核对用）；地图道路缺省——引擎按 widthM 1 补赛事中心线。 */
  widthM?: number;
}

export interface RouteLineDemand {
  /** 明确说了几个补给站就按几个排；没说明就按可用线路长度自动铺满。 */
  stations?: number;
  /** 补给站间距（米），缺省 20 m（路跑补给站的常见间隔量级）。 */
  spacingM?: number;
  /** 单个补给站占地（米），缺省 3×3（后勤帐篷模板）。 */
  stationWidthM?: number;
  stationDepthM?: number;
}

export interface RouteLineLayoutSummary {
  stations: number;
  spacingM: number;
  runLengthM: number;
  lineName: string;
  warnings: string[];
}

export interface RouteLineLayout {
  zones: PlanZone[];
  facilities: PlanFacility[];
  routes: PlanRoute[];
  nodes: PlanNode[];
  summary: RouteLineLayoutSummary;
}

export type RouteLineRefusal = "no-line" | "outside-scope" | "too-short" | "conflict";

export type RouteLineProposal =
  | { ok: true; layout: RouteLineLayout }
  | { ok: false; reason: RouteLineRefusal; message: string };

/** 「沿线摆补给站/沿着这条公路/巡游线」这类线路参照措辞。水岸措辞（沿水岸线）不在这里认。 */
export function routeLineIntent(text: string): boolean {
  const value = text.replace(/\s+/gu, "");
  return (
    /(沿着?|顺着|沿|贴着|靠着)(?:这条|那条|一段)?(路线|线路|道路|马路|公路|街道|巡游线|赛道|跑道|绿道)/u.test(
      value,
    ) ||
    (/(沿线|沿途)/u.test(value) && /(摆|放|设|布|排)/u.test(value))
  );
}

/** 线路类活动词：马拉松/巡游/骑行等——出现即指线路参照（即使句子里带「河边路」）。 */
export function isRouteLineEvent(text: string | null | undefined): boolean {
  if (!text) return false;
  return /马拉松|路跑|巡游|健步|骑行|定向越野|越野跑|彩虹跑/u.test(text);
}

/**
 * 参照排布类型判定（沿岸 vs 沿线共用调度）：
 * 赛事活动词（马拉松/巡游）优先指线路——「沿着河边的路跑马拉松」是路跑不是垂钓；
 * 纯水岸措辞（沿水岸线/岸边）与沿岸类事件仍是岸线；其余线路措辞指线路。
 */
export function referenceKindFor(
  text: string,
  event?: string | null | undefined,
): "shoreline" | "route-line" | null {
  if (isRouteLineEvent(text) || isRouteLineEvent(event ?? null)) return "route-line";
  if (shorelineIntent(text) || isShorelineEvent(text) || isShorelineEvent(event ?? null))
    return "shoreline";
  if (routeLineIntent(text)) return "route-line";
  return null;
}

/** 从一句话里读补给站数量与间距；读不到就交给线路容量决定。 */
export function parseRouteLineDemand(text: string): RouteLineDemand {
  const demand: RouteLineDemand = {};
  const value = text.replace(/\s+/gu, "");
  const stations =
    value.match(/(\d{1,3})(?:个|处|座)(?:补给站|水站|饮水点|服务点)/u) ??
    value.match(/(?:补给站|水站|饮水点|服务点)(\d{1,3})(?:个|处|座)?/u);
  const parsedStations = stations ? Number(stations[1]) : NaN;
  if (Number.isFinite(parsedStations) && parsedStations > 0)
    demand.stations = Math.min(200, Math.round(parsedStations));
  const spacing = value.match(/(?:间隔|间距|每隔|相距|每)\s*(\d{1,2}(?:\.\d)?)\s*(?:米|m|M)/u);
  const parsedSpacing = spacing ? Number(spacing[1]) : NaN;
  if (Number.isFinite(parsedSpacing) && parsedSpacing >= 2) demand.spacingM = parsedSpacing;
  return demand;
}

const START_CLEARANCE_M = 12;
const MIN_RUN_M = 14;
const DEFAULT_SPACING_M = 20;
const MAX_STATIONS = 40;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

function stationOffsetOf(stationDepth: number, refClearance: number): number {
  return stationDepth / 2 + refClearance;
}

export interface RouteLineLayoutInput {
  lines: RouteLine[];
  boundary: PlanPoint[];
  demand?: RouteLineDemand;
  /** 既有设施足迹环：不压上去。 */
  obstacles?: PlanPoint[][];
  /** 既有分区/建筑：线路落在这些范围的那些段不拿来排。 */
  exclusions?: PlanPoint[][];
}

/**
 * 沿线排布：起点/终点区在线路一端，补给站带沿线路一侧等距展开，拱门节点标起终；
 * 参照来自地图时补一条赛事中心线（示意）。放不下就如实拒绝并给出上限。
 */
export function proposeRouteLineLayout(
  input: RouteLineLayoutInput,
  id: () => string,
): RouteLineProposal {
  const { lines, boundary } = input;
  if (!lines.length) {
    return {
      ok: false,
      reason: "no-line",
      message:
        "地图和画布里都没有可用线路；用「标注 → 线段」画一条巡游/赛道线，或先让我预览主通道，我沿线摆补给站。",
    };
  }
  if (boundary.length < 3) {
    return {
      ok: false,
      reason: "outside-scope",
      message: "还没有可用的活动边界；先确认活动范围，我再按边界内的线路排。",
    };
  }

  let chosen: { line: RouteLine; run: ReturnType<typeof densify>; length: number } | null = null;
  let sawLine = false;
  for (const line of lines) {
    if (line.points.length < 2) continue;
    const samples = densify(line.points);
    if (samples.length < 2) continue;
    sawLine = true;
    for (const raw of runsInsideBoundary(samples, boundary, input.exclusions ?? [])) {
      const run = longestStraightRun(raw);
      const length = runLength(run);
      if (length < MIN_RUN_M) continue;
      if (!chosen || length > chosen.length) chosen = { line, run, length };
    }
  }

  if (!chosen) {
    if (!sawLine) {
      return {
        ok: false,
        reason: "no-line",
        message:
          "线路几何解不出来（顶点不足或都在界外）。请用「标注 → 线段」沿路线画一条，我按它摆补给站。",
      };
    }
    return {
      ok: false,
      reason: "outside-scope",
      message:
        "有线路，但都不在当前活动边界内（或边界内那一段不足 14 m）。把边界扩到路边，或换一段线路，我再沿线排。",
    };
  }

  const { line, run } = chosen;
  const runStart = run[0]!.s;
  const length = runLength(run);
  if (length < START_CLEARANCE_M + 2) {
    return {
      ok: false,
      reason: "too-short",
      message: `这段线路在边界内只有约 ${Math.round(length)} m，放不下起点区加沿线补给站；需要至少约 ${START_CLEARANCE_M + 2} m。`,
    };
  }

  const spacing = clamp(input.demand?.spacingM ?? DEFAULT_SPACING_M, 5, 50);
  const stationWidth = clamp(input.demand?.stationWidthM ?? 3, 1, 6);
  const stationDepth = clamp(input.demand?.stationDepthM ?? 3, 1, 6);
  const usable = length - START_CLEARANCE_M;
  const maxStations = Math.max(1, Math.floor(usable / spacing) + 1);
  const stations = input.demand?.stations
    ? Math.min(input.demand.stations, 200)
    : Math.min(MAX_STATIONS, maxStations);

  if ((stations - 1) * spacing > usable + 0.01) {
    return {
      ok: false,
      reason: "too-short",
      message: `这段可用的线路只有约 ${Math.round(length)} m（起点区占 ${START_CLEARANCE_M} m），按 ${spacing} m 间距最多排 ${maxStations} 个补给站；要 ${stations} 个就得缩小间距或换更长的线路。`,
    };
  }

  // 站位必须在路线廊道之外（路线自身宽度的一半 + 1 m 净距），否则规划层的廊道核对会拦。
  const refClearance = line.widthM === undefined ? 1.5 : line.widthM / 2 + 1;
  const stationOffset = stationOffsetOf(stationDepth, refClearance);
  const normal = inlandNormal(run, boundary);
  const obstacles = input.obstacles ?? [];
  const warnings: string[] = [
    "线路参照来自地图道路/画布线路，不是实测赛道；封路、计时、医疗与安保需与主办方和交管核对。",
    "补给站和起终点按可用面积摆位；水电接驳和容量按现场条件调。",
  ];
  const zones: PlanZone[] = [];
  const facilities: PlanFacility[] = [];
  const routes: PlanRoute[] = [];
  const failed: PlanPoint[] = [];

  // 补给站带（loading）：把补给站归入一个分区——规划层要求每个设施都在自己分区内。
  const bandFrom = Math.max(0.3, refClearance - 0.3);
  const bandTo = stationOffset + stationDepth / 2 + 0.3;
  const bandRing = [
    ...translate(run, normal, bandFrom, runStart + START_CLEARANCE_M, runStart + length, 6),
    ...translate(run, normal, bandTo, runStart + START_CLEARANCE_M, runStart + length, 6).reverse(),
  ];
  const bandZone: PlanZone | null =
    bandRing.length >= 3 && facilityPlacementIssues(bandRing, boundary).length === 0
      ? {
          id: id(),
          semantic: "loading",
          name: "补给站带",
          polygon: bandRing,
          event: "沿线活动·补给站带",
          geometrySource: "map-unverified",
          notes: "沿线路一侧的补给站带（示意）；水电接驳与垃圾清运需现场核对。",
        }
      : null;
  if (bandZone) zones.push(bandZone);

  const margin = Math.min((usable - (stations - 1) * spacing) / 2, spacing / 2);
  for (let index = 0; index < stations; index++) {
    const s = runStart + START_CLEARANCE_M + margin + index * spacing;
    const anchor = pointAt(run, s);
    const center = {
      x: Math.round((anchor.x + normal.x * stationOffset) * 10) / 10,
      y: Math.round((anchor.y + normal.y * stationOffset) * 10) / 10,
    };
    const facility: PlanFacility = {
      id: id(),
      templateId: "tent-3x3",
      name: `补给站 ${index + 1}`,
      position: center,
      rotationDeg: Math.round((Math.atan2(-normal.x, normal.y) * 180) / Math.PI),
      size: { width: stationWidth, depth: stationDepth },
      ...(bandZone ? { zoneId: bandZone.id } : {}),
      notes: "沿线补给站（示意）：面向线路；需现场核对水电接驳与帐篷锚固。",
    };
    const ring = facilityFootprintRing(facility);
    const inBoundary = ring.length >= 3 && facilityPlacementIssues(ring, boundary).length === 0;
    const blocked = obstacles.some(other => overlapsAny(ring, other));
    if (!inBoundary || blocked) {
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
        "线路找到了，但贴线这条带子放不下补给站（越界或与既有设施/分区重叠）。把边界往线路外侧让一点，或先挪开路边现有物件再排。",
    };
  }
  if (!bandZone) {
    return {
      ok: false,
      reason: "conflict",
      message:
        "线路贴得太靠近边界，排不下一个可归属分区的补给站带。把活动边界往线路外侧扩一点（至少留出约 3 m），我再沿线排。",
    };
  }

  // 起点/终点区（stage）：线路起点端的集结与拱门区，往线路外侧退到补给站带之外。
  const startCenterAnchor = pointAt(run, runStart + 6);
  const startCenterDistance = bandTo + 4.5;
  const startCenter = {
    x: startCenterAnchor.x + normal.x * startCenterDistance,
    y: startCenterAnchor.y + normal.y * startCenterDistance,
  };
  const endSample = run[run.length - 1]!;
  const along = { x: endSample.p.x - run[0]!.p.x, y: endSample.p.y - run[0]!.p.y };
  const alongLen = Math.hypot(along.x, along.y) || 1;
  const alongUnit = { x: along.x / alongLen, y: along.y / alongLen };
  const corner = (alongSign: number, normalSign: number): PlanPoint => ({
    x: Math.round((startCenter.x + alongUnit.x * 6 * alongSign + normal.x * 4 * normalSign) * 10) / 10,
    y: Math.round((startCenter.y + alongUnit.y * 6 * alongSign + normal.y * 4 * normalSign) * 10) / 10,
  });
  const startRing = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  if (
    facilityPlacementIssues(startRing, boundary).length === 0 &&
    !obstacles.some(other => overlapsAny(startRing, other))
  ) {
    zones.push({
      id: id(),
      semantic: "stage",
      name: "起点·终点区",
      polygon: startRing,
      event: "沿线活动·起终点",
      geometrySource: "map-unverified",
      notes: "线路起点端的集结、拱门与计时区（示意）；封路与安保需与主办方和交管核对。",
    });
  } else {
    warnings.push(
      "起点·终点区在线路起点端放不下（越界或压到既有设施），本轮只出补给站带；可在画布上手动补一个。",
    );
  }

  // 参照来自地图（无自身宽度）时补一条赛事中心线示意；画布已有线路不重复加。
  if (line.widthM === undefined) {
    const course = translate(run, { x: 0, y: 0 }, 0, runStart, runStart + length, 24);
    if (course.length >= 2) {
      routes.push({
        id: id(),
        kind: "pedestrian",
        name: `${line.name || "巡游"}·赛事线（示意）`,
        points: course,
        widthM: 1,
        oneWay: true,
        notes: "沿地图道路的赛事中心线（示意）；封路、计时点、医疗与安保需与主办方和交管核对。",
      });
    }
  }

  if (failed.length) warnings.push(`${failed.length} 个预定补给站因越界/与既有设施重叠未落位。`);

  return {
    ok: true,
    layout: {
      zones,
      facilities,
      routes,
      nodes: [
        {
          id: id(),
          kind: "entry",
          name: "起点拱门",
          position: pointAt(run, runStart),
          verification: "unverified" as const,
          notes: "位置为示意，需现场核对；不是疏散出口认证。",
        },
        {
          id: id(),
          kind: "exit",
          name: "终点拱门",
          position: pointAt(run, runStart + length),
          verification: "unverified" as const,
          notes: "位置为示意，需现场核对；不是疏散出口认证。",
        },
      ],
      summary: {
        stations: facilities.filter(f => f.name.startsWith("补给站")).length,
        spacingM: spacing,
        runLengthM: Math.round(length * 10) / 10,
        lineName: line.name || "线路",
        warnings,
      },
    },
  };
}
