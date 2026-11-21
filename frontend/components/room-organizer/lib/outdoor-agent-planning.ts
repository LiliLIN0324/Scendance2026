import { personnelAccess } from "./outdoor-personnel-access";
import type {
  PlanPoint,
  PlanZone,
  SitePlanData,
  PlanFacility,
  PlanWorker,
  PlanNode,
} from "../../../../supabase/functions/_shared/site-plan";
import { sitePlanDataSchema } from "../../../../supabase/functions/_shared/site-plan";
import {
  checkBoundaryRing,
  planPointInRing,
  planRingsOverlap,
} from "./site-plan-editing";
import {
  facilityFootprintRing,
  facilityPlacementIssues,
} from "./site-plan-facilities";
import {
  outdoorCorridorStrips,
  outdoorRingsOverlap,
} from "./outdoor-event-logic";
// 2026-11-17 死结 4：岗位缺通道时按需补一条专用驳线（复用 V-4a 的几何护栏）。
import { buildZoneSpur, spurAudiencesFor } from "./sub-entrance";
import type {
  OutdoorBrief,
  OutdoorLibraryItem,
} from "./outdoor-agent-contract";
import { generatedObjectName, generatedObjectNotes } from "./generated-object-name";

const box = (p: readonly PlanPoint[]) => ({
  w: Math.min(...p.map((p) => p.x)),
  e: Math.max(...p.map((p) => p.x)),
  s: Math.min(...p.map((p) => p.y)),
  n: Math.max(...p.map((p) => p.y)),
});
/** Convex half-plane clipping only; disconnected/invalid results are subsequently rejected. */
function clipX(ring: PlanPoint[], x: number, keepRight: boolean): PlanPoint[] {
  const result: PlanPoint[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!,
      b = ring[(i + 1) % ring.length]!,
      inside = (p: PlanPoint) => (keepRight ? p.x >= x : p.x <= x);
    if (inside(a)) result.push(a);
    if (inside(a) !== inside(b)) {
      const t = (x - a.x) / (b.x - a.x);
      result.push({ x, y: a.y + t * (b.y - a.y) });
    }
  }
  return result.filter(
    (p, i) =>
      !i || Math.hypot(p.x - result[i - 1]!.x, p.y - result[i - 1]!.y) > 0.001,
  );
}
/* 2026-11-18 用户指令「agent 能不能智能根据分区摆放物件」：分区先要落在用户说的方位上。
 * 之前这里是「沿 X 均分 N 条 + 上下各收 3m」，所以六条竖条贯穿南北、每块都是整场高度；
 * 用户说的方位（西北角办婚礼、南侧烧烤）在协议里一路传到 brief，却没有任何消费者。
 * 现在按九方位取格位、按用途/人数/清单算面积，落成互不重叠、留出通道余量的小块，没提的区域留空。 */
const ZONE_SLOTS = {
  "north-west": { col: 0, row: 0 },
  north: { col: 1, row: 0 },
  "north-east": { col: 2, row: 0 },
  west: { col: 0, row: 1 },
  center: { col: 1, row: 1 },
  east: { col: 2, row: 1 },
  "south-west": { col: 0, row: 2 },
  south: { col: 1, row: 2 },
  "south-east": { col: 2, row: 2 },
} as const;
type ZoneSlotName = keyof typeof ZONE_SLOTS;
/** 用户没说方位时按用途给的默认方位：舞台在北、观众在中，舞台自然对着观众区。 */
const ZONE_DEFAULT_SLOT: Record<NonNullable<PlanZone["purpose"]>, ZoneSlotName> = {
  performance: "north",
  audience: "center",
  exhibition: "west",
  market: "east",
  service: "south-east",
};
/** 分区面积下限（㎡）：小于这个连一件主物件加净空都排不开。 */
const ZONE_AREA_FLOOR: Record<NonNullable<PlanZone["purpose"]>, number> = {
  performance: 120,
  audience: 80,
  exhibition: 90,
  market: 90,
  service: 45,
};
/** 每件物件连同摊间/通道的包络（㎡）：只用于算分区要多大，真实尺寸仍取物料库。 */
const ZONE_M2_PER_OBJECT: Record<NonNullable<PlanZone["purpose"]>, number> = {
  performance: 0,
  audience: 2,
  exhibition: 14,
  market: 12,
  service: 0,
};
type ZoneRect = { w: number; e: number; s: number; n: number };

/** 用户只报了活动类型（“搞个集市”“办婚礼”）时，先按常见分区出一版，不把问题甩回给用户。 */
const EVENT_ZONE_PRESETS: ReadonlyArray<{
  match: RegExp;
  zones: ReadonlyArray<{ name: string; purpose: NonNullable<PlanZone["purpose"]> }>;
}> = [
  {
    match: /集市|市集|摆摊|摊位|庙会/,
    zones: [
      { name: "摊位区", purpose: "market" },
      { name: "表演区", purpose: "performance" },
      { name: "入口服务区", purpose: "service" },
    ],
  },
  {
    match: /婚礼|婚宴/,
    zones: [
      { name: "仪式区", purpose: "performance" },
      { name: "宴会区", purpose: "audience" },
      { name: "签到区", purpose: "service" },
    ],
  },
  {
    match: /发布会|新品发布|媒体发布/,
    zones: [
      { name: "主会场", purpose: "audience" },
      { name: "展示区", purpose: "exhibition" },
      { name: "签到区", purpose: "service" },
    ],
  },
  {
    match: /展览|展会|展销|艺术展/,
    zones: [
      { name: "展区", purpose: "exhibition" },
      { name: "签到区", purpose: "service" },
    ],
  },
  {
    match: /音乐节|演出|演唱会|音乐现场/,
    zones: [
      { name: "舞台区", purpose: "performance" },
      { name: "观众区", purpose: "audience" },
      { name: "服务区", purpose: "service" },
    ],
  },
];

/**
 * 从用户这句话里推断一版默认分区。只覆盖常见活动类型；
 * 没有明确室内线索时按室外处理（当前主流程也是地图上的室外场地）。
 */
export function defaultZonesForEvent(message: string): OutdoorBrief["zones"] {
  const preset = EVENT_ZONE_PRESETS.find((entry) => entry.match.test(message));
  if (!preset) return [];
  const environment: "indoor" | "outdoor" = /室内|馆内|厅内|商场内|楼内/.test(message)
    ? "indoor"
    : "outdoor";
  const evidence = `用户提到「${message.trim().slice(0, 40)}」，按该类活动的常见分区先出一版`;
  return preset.zones.map((zone) => ({ ...zone, environment, evidence }));
}

function zoneRectArea(rect: ZoneRect): number {
  return Math.max(0, rect.e - rect.w) * Math.max(0, rect.n - rect.s);
}

/** 按用途/人数/已给清单算这个分区需要多大；观众类按 2㎡/人再留 25% 通行余量。 */
function zoneAreaNeed(
  need: OutdoorBrief["zones"][number],
  brief: OutdoorBrief,
): number {
  const floor = ZONE_AREA_FLOOR[need.purpose];
  const byGuest = brief.guests ? brief.guests * 2 : 0;
  if (need.purpose === "audience") return Math.max(floor, byGuest * 1.25);
  if (need.purpose === "performance") return floor;
  const count = brief.items
    .filter((item) => item.zone === need.name)
    .reduce((n, item) => n + item.count, 0);
  return Math.max(floor, byGuest * 1.25, count * ZONE_M2_PER_OBJECT[need.purpose] * 1.25);
}

/** 矩形与用地轮廓求交：四个半平面依次裁，凹口跨接的结果由后续校验拒掉。 */
function clipRectToRing(ring: PlanPoint[], rect: ZoneRect): PlanPoint[] {
  const x = clipX(clipX(ring, rect.w, true), rect.e, false);
  const flip = (points: PlanPoint[]) => points.map((p) => ({ x: p.y, y: p.x }));
  return flip(clipX(clipX(flip(x), rect.s, true), rect.n, false));
}

function ringAreaM2(ring: readonly PlanPoint[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** 按需要的面积在格位里取一块矩形：先按格位长宽比定形，再夹回格位与可用范围。 */
function fitZoneRect(
  area: number,
  usable: ZoneRect,
  slotW: number,
  slotH: number,
  slot: ZoneSlotName,
  gutter: number,
  purpose: NonNullable<PlanZone["purpose"]>,
): ZoneRect {
  const { col, row } = ZONE_SLOTS[slot];
  const maxW = Math.max(1, slotW - gutter);
  const maxH = Math.max(1, slotH - gutter);
  const aspect = maxW / maxH;
  let width = Math.min(maxW, Math.sqrt(Math.max(area, 1) * aspect));
  let height = Math.min(maxH, Math.max(area, 1) / Math.max(width, 0.5));
  // 舞台要放宽到 8m 台面；其它用途至少留 5m 短边，避免切成细条。
  const minSide = purpose === "performance" ? 10 : 5;
  if (width < minSide) width = Math.min(maxW, minSide);
  if (height < minSide) height = Math.min(maxH, minSide);
  width = Math.min(width, maxW);
  height = Math.min(height, maxH);
  const cx = usable.w + (col + 0.5) * slotW;
  const cy = usable.n - (row + 0.5) * slotH;
  let w = cx - width / 2;
  let s = cy - height / 2;
  // 夹回可用范围（靠边格位不越出用地内缩线）。
  w = Math.min(Math.max(w, usable.w), usable.e - width);
  s = Math.min(Math.max(s, usable.s), usable.n - height);
  return { w, e: w + width, s, n: s + height };
}

/** 目标格位优先，其余按距离由近到远——方位被占了就贴着它落，不跨到场地另一头。 */
function zoneSlotOrder(wanted: ZoneSlotName): ZoneSlotName[] {
  const target = ZONE_SLOTS[wanted];
  return (Object.keys(ZONE_SLOTS) as ZoneSlotName[])
    .map((name) => ({ name, d: Math.hypot(ZONE_SLOTS[name].col - target.col, ZONE_SLOTS[name].row - target.row) }))
    .sort((a, b) => a.d - b.d)
    .map((slot) => slot.name);
}

/** 分区现在按用户方位与用途面积落位；已有同名分区仍沿用它的轮廓（不擅自挪用户画过的区）。 */
export function proposeUseZones(
  plan: SitePlanData,
  brief: OutdoorBrief,
  id: () => string = () => crypto.randomUUID(),
  deferNote: string = "",
): SitePlanData {
  if (!brief.zones.length)
    throw new Error(
      // 轮次 110：这是“追问”而不是报错，上一句里的后置活直接接在问句后面。
      "这块活动场地要分哪些用途？例如展览区、表演区、签到区；尚不放物件。" + deferNote,
    );
  if (brief.zones.some((z) => z.environment === "unknown"))
    throw new Error(
      "请先明确待布置分区是室内还是室外；未知室内信息不会从地图猜。",
    );
  const existing = brief.zones.map((z) => {
    const matches = plan.zones.filter((p) =>
      z.referenceId ? p.id === z.referenceId : p.name === z.name,
    );
    if (matches.length > 1)
      throw new Error("分区名称有歧义，请用当前具体对象引用确认。");
    return matches[0];
  });
  // 2026-11-16 用户口径（原话：室外活动、弄集会）：原来这里直接 throw「室内分区尚无可核对边界」，
  // 生产上一条「室内 12×9」的输入就能把整条户外主链卡死在分区步。现在室内不再单独占一条流程：
  // 分区先按用地轮廓划出占位几何，真正的室内边界等造墙阶段确认——不在这里拦人。
  // `unknown` 的拦截保留：那是「别猜」的保护，和室内口径无关。
  if (plan.zones.length && existing.some((z) => !z))
    throw new Error(
      "已有分区与新用途不完全对应。请先选中要修改的分区并明确名称，不会新增重叠区域或清旧分区。",
    );
  const b = box(plan.boundary);
  const spanW = Math.max(1, b.e - b.w);
  const spanH = Math.max(1, b.n - b.s);
  // 内缩留边：常规场地留 3m 退界，窄条场地按比例缩，不能因为 3m 直接判死。
  const margin = Math.min(3, Math.min(spanW, spanH) * 0.08);
  const gutter = Math.min(2, Math.min(spanW, spanH) * 0.03);
  const usable: ZoneRect = {
    w: b.w + margin,
    e: Math.max(b.w + margin + 1, b.e - margin),
    s: b.s + margin,
    n: Math.max(b.s + margin + 1, b.n - margin),
  };
  const slotW = (usable.e - usable.w) / 3;
  const slotH = (usable.n - usable.s) / 3;
  // 已有分区（不是这一轮要替换的）算障碍：新块不能压到别的区上。
  const keeps = plan.zones.filter((z) => !existing.some((old) => old?.id === z.id));
  const drafted: { need: OutdoorBrief["zones"][number]; index: number; area: number }[] =
    brief.zones.map((need, index) => ({ need, index, area: zoneAreaNeed(need, brief) }));
  // 面积大的先落：小块去填大块剩下的空档，比反过来成功率高。
  const order = [...drafted].sort((a, b2) => b2.area - a.area);
  const polygons = new Map<number, PlanPoint[]>();
  for (const item of order) {
    const old = existing[item.index];
    if (old) {
      polygons.set(item.index, old.polygon);
      continue;
    }
    const wanted = item.need.position ?? ZONE_DEFAULT_SLOT[item.need.purpose];
    let found: PlanPoint[] | null = null;
    // 面积一次不够就缩一档再试（0.85/0.7），仍放不下才判这块场地划不出来。
    for (const scale of [1, 0.85, 0.7]) {
      if (found) break;
      for (const slot of zoneSlotOrder(wanted)) {
        const rect = fitZoneRect(
          Math.min(item.area * scale, zoneRectArea(usable) * 0.45),
          usable,
          slotW,
          slotH,
          slot,
          gutter,
          item.need.purpose,
        );
        const polygon = clipRectToRing(plan.boundary, rect);
        if (polygon.length < 3) continue;
        if (!checkBoundaryRing(polygon).ok) continue;
        if (facilityPlacementIssues(polygon, plan.boundary).length) continue;
        if (ringAreaM2(polygon) < 4) continue;
        const obstacles = [...keeps.map((z) => z.polygon), ...polygons.values()];
        if (obstacles.some((ring) => planRingsOverlap(polygon, ring))) continue;
        found = polygon;
        break;
      }
    }
    if (!found)
      throw new Error(
        "当前不规则边界无法可靠自动划分这版区域，请先画出分区或调整用途/范围；没有用bbox跨越凹口。",
      );
    polygons.set(item.index, found);
  }
  const zones: PlanZone[] = brief.zones.map((need, index) => {
    const old = existing[index];
    const polygon = polygons.get(index)!;
    return {
      ...(old ?? {}),
      id: old?.id ?? id(),
      semantic:
        need.purpose === "performance"
          ? "stage"
          : need.purpose === "audience"
            ? "audience"
            : "reserved",
      name: need.name,
      event:
        need.purpose === "exhibition"
          ? "展览"
          : need.purpose === "performance"
            ? "表演"
            : need.purpose === "market"
              ? "市集"
              : need.purpose === "service"
                ? "服务"
                : "观众",
      environment: need.environment,
      purpose: need.purpose,
      geometrySource: "user-confirmed",
      polygon,
      notes:
        old?.notes ??
        (need.environment === "indoor"
          ? "室内分区占位几何：先按用地轮廓划出，墙体与洞口在造墙阶段确认；非物件布局或容量/疏散认证。"
          : `用途分区几何草案：按${need.position ? "你给的方位" : "用途默认方位"}与用途/人数估算面积，保留区间通道余量；非物件布局或容量/疏散认证。`),
    };
  });
  for (let i = 0; i < zones.length; i++)
    for (let j = i + 1; j < zones.length; j++)
      if (planRingsOverlap(zones[i]!.polygon, zones[j]!.polygon))
        throw new Error("分区占地重叠，请核对真实分区。");
  return {
    ...plan,
    zones: [
      ...plan.zones.filter((z) => !zones.some((n) => n.id === z.id)),
      ...zones,
    ],
  };
}
export function clearForObject(
  facility: PlanFacility,
  plan: SitePlanData,
  zone: PlanZone,
  /** 2026-11-17 硬挤模式：物件间不重叠是硬约束；通道/门口净空收到最小，塞到物理极限。 */
  packed = false,
): boolean {
  const ring = facilityFootprintRing(facility);
  if (
    facilityPlacementIssues(ring, plan.boundary).length ||
    facilityPlacementIssues(ring, zone.polygon).length
  )
    return false;
  if (
    plan.facilities.some((f) =>
      outdoorRingsOverlap(ring, facilityFootprintRing(f)),
    )
  )
    return false;
  if (
    plan.routes.some((r) =>
      outdoorCorridorStrips(r.points, (r.widthM ?? 3) + (packed ? 0.2 : 1)).some((strip) =>
        outdoorRingsOverlap(ring, strip),
      ),
    )
  )
    return false;
  if (
    plan.nodes.some(
      (n) =>
        Math.hypot(
          n.position.x - facility.position.x,
          n.position.y - facility.position.y,
        ) <
        Math.hypot(facility.size.width, facility.size.depth) / 2 + (packed ? 0.5 : 2),
    )
  )
    return false;
  if (plan.workers.some((w) => planPointInRing(w.position, ring))) return false;
  return true;
}
/** Explicit real inventory entries only; no guessed GLB, dimensions, booth or stage defaults. */
/** Conservative draft-only floor-space lower bound, not a legal capacity/egress certificate. */
export function validateWorkflowDemand(
  plan: SitePlanData,
  brief: OutdoorBrief,
): void {
  if (!brief.guests) return;
  if (
    plan.zones.some((z) => z.purpose === "performance") &&
    !plan.zones.some((z) => z.purpose === "audience")
  )
    throw new Error(
      "有表演区但未明确观众区域/朝向。请先增加或指定观众区，再核对舞台与观众关系，不把观众塞进表演/展位占地。",
    );
  const audience = plan.zones.filter((z) =>
    ["audience", "market", "exhibition"].includes(z.purpose ?? ""),
  );
  if (!audience.length)
    throw new Error(
      "缺少来宾活动区域，请先明确观众/市集/展览区域，不用服务/舞台区域冒充容量。",
    );
  const area = (ring: PlanPoint[]) =>
    Math.abs(
      ring.reduce((n, p, i) => {
        const q = ring[(i + 1) % ring.length]!;
        return n + p.x * q.y - q.x * p.y;
      }, 0),
    ) / 2;
  let free = 0;
  for (const zone of audience) {
    let usable = area(zone.polygon);
    for (const f of plan.facilities.filter((f) => f.zoneId === zone.id))
      usable -= f.size.width * f.size.depth;
    for (const route of plan.routes.filter((r) => r.levelId === zone.levelId))
      for (const strip of outdoorCorridorStrips(
        route.points,
        route.widthM ?? 3,
      ))
        if (outdoorRingsOverlap(strip, zone.polygon)) usable -= area(strip);
    free += Math.max(0, usable);
  }
  if (free < brief.guests * 2)
    throw new Error(
      `当前观众/市集/展览区域扣除已知物件和通道后，保守可用面积下界约${Math.floor(free)}㎡；本草案按预留2㎡/人粗筛，${brief.guests}人至少需${brief.guests * 2}㎡。请调整人数/分区/物件；这不是法规容量或疏散认证。`,
    );
}
/** 2026-11-14 用户指令「给我几个方案」：分区物件排布策略——行列铺排 / 居中紧凑 / 沿边环形。 */
export type ObjectsLayoutStrategy = "rows" | "center" | "perimeter";
export const OBJECTS_LAYOUT_STRATEGIES: ObjectsLayoutStrategy[] = ["rows", "center", "perimeter"];
export const OBJECTS_LAYOUT_LABELS: Record<ObjectsLayoutStrategy, string> = {
  rows: "行列铺排",
  center: "居中紧凑",
  perimeter: "沿边环形",
};

/** 分区内的候选落位（按策略排序）：grid=行列扫、center=离分区中心螺旋、perimeter=贴边一圈+网格兜底。 */
/** 简易包围盒（min/max），禁区预筛用。 */
function bboxLoose(ring: readonly PlanPoint[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;let minY = Infinity;let maxX = -Infinity;let maxY = -Infinity;
  for (const p of ring) {if (p.x < minX) minX = p.x;if (p.y < minY) minY = p.y;if (p.x > maxX) maxX = p.x;if (p.y > maxY) maxY = p.y;}
  return { minX, minY, maxX, maxY };
}
function bBoxesIntersect(a: { minX: number; minY: number; maxX: number; maxY: number }, b: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
function pointInBBox(p: PlanPoint, b: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}
type PlacementCandidate = { position: PlanPoint; rotationDeg: number };
type MaterialRole = "stage" | "speaker" | "board" | "stall" | "seat" | "other";

/** 物件名 → 用途大类：只按名字判定，判不出来的仍走网格兜底；不猜尺寸、不猜用途。 */
function materialRole(name: string): MaterialRole {
  if (/舞台|主台|演出台|stage/i.test(name)) return "stage";
  if (/音响|音箱|扬声|喇叭|speaker|line\s*array/i.test(name)) return "speaker";
  if (/展板|背板|指示|导视|导览|招牌|牌|board|sign/i.test(name)) return "board";
  if (/摊位|帐篷|展位|商铺|棚|booth|stall|tent/i.test(name)) return "stall";
  if (/椅|坐席|观众席|座|seat|chair|bench/i.test(name)) return "seat";
  return "other";
}

const ringCenter = (ring: readonly PlanPoint[]): PlanPoint => {
  const b = box(ring);
  return { x: (b.w + b.e) / 2, y: (b.s + b.n) / 2 };
};

function unitVector(from: PlanPoint, to: PlanPoint): PlanPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  return len < 0.001 ? { x: 0, y: -1 } : { x: dx / len, y: dy / len };
}

/** 朝向哪个「看客」区：观众区优先，其次市集/展览；都没有就返回 null（不编观众方向）。 */
function viewpointZoneFor(zone: PlanZone, plan: SitePlanData): PlanZone | null {
  const others = plan.zones.filter(
    (z) =>
      z.id !== zone.id &&
      (z.purpose === "audience" || z.purpose === "market" || z.purpose === "exhibition"),
  );
  if (!others.length) return null;
  const center = ringCenter(zone.polygon);
  return [...others].sort((a, b) => {
    const rank = (z: PlanZone) => (z.purpose === "audience" ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const ca = ringCenter(a.polygon);
    const cb = ringCenter(b.polygon);
    return (
      Math.hypot(ca.x - center.x, ca.y - center.y) -
      Math.hypot(cb.x - center.x, cb.y - center.y)
    );
  })[0]!;
}

/** 面向 dir 的那条边（区心→目标方向最对齐的边中点）。 */
function facingEdge(ring: readonly PlanPoint[], dir: PlanPoint): { mid: PlanPoint } {
  const center = ringCenter(ring);
  let best = { mid: center, score: -Infinity };
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const offset = { x: mid.x - center.x, y: mid.y - center.y };
    const len = Math.hypot(offset.x, offset.y) || 1;
    const score = (offset.x * dir.x + offset.y * dir.y) / len;
    if (score > best.score) best = { mid, score };
  }
  return { mid: best.mid };
}

/** 主通道方向：最靠近本区的人行动线；区里没动线就用入口指向区心。 */
function aisleDirection(plan: SitePlanData, zone: PlanZone): PlanPoint | null {
  const center = ringCenter(zone.polygon);
  let best: { dir: PlanPoint; score: number } | null = null;
  for (const route of plan.routes) {
    if (route.kind !== "pedestrian") continue;
    for (let i = 0; i < route.points.length - 1; i += 1) {
      const a = route.points[i]!;
      const b = route.points[i + 1]!;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const score = -Math.hypot(mid.x - center.x, mid.y - center.y);
      if (!best || score > best.score) best = { dir: unitVector(a, b), score };
    }
  }
  if (best) return best.dir;
  const entry = plan.nodes.find((n) => n.kind === "entry" || n.kind === "both");
  return entry ? unitVector(entry.position, center) : null;
}

/** 舞台：贴着面向观众区的那条边，台宽垂直于观众方向；没观众区就居中。 */
function stageCandidates(
  zone: PlanZone,
  plan: SitePlanData,
  material: OutdoorLibraryItem,
): PlacementCandidate[] {
  const out: PlacementCandidate[] = [];
  const target = viewpointZoneFor(zone, plan);
  if (target) {
    const center = ringCenter(zone.polygon);
    const dir = unitVector(center, ringCenter(target.polygon));
    const edge = facingEdge(zone.polygon, dir);
    const rotationDeg = Math.abs(dir.x) >= Math.abs(dir.y) ? 90 : 0;
    const inset = material.depth / 2 + 0.8;
    const tangent = { x: -dir.y, y: dir.x };
    const base = { x: edge.mid.x - dir.x * inset, y: edge.mid.y - dir.y * inset };
    for (const along of [0, 0.3, -0.3, 0.6, -0.6])
      for (const back of [0, 1, 2])
        out.push({
          position: {
            x: base.x + tangent.x * along * material.width - dir.x * back,
            y: base.y + tangent.y * along * material.width - dir.y * back,
          },
          rotationDeg,
        });
  }
  out.push({ position: ringCenter(zone.polygon), rotationDeg: 0 });
  return out;
}

/** 音响：夹在舞台前场两侧、左右对称；没有舞台就按分区朝向摆一对。 */
function speakerCandidates(
  zone: PlanZone,
  plan: SitePlanData,
  material: OutdoorLibraryItem,
): PlacementCandidate[] {
  const target = viewpointZoneFor(zone, plan);
  const stage = plan.facilities.find(
    (f) => f.zoneId === zone.id && materialRole(f.name) === "stage",
  );
  const half = Math.max(material.width, material.depth) / 2;
  if (!stage) {
    if (!target) return [];
    const center = ringCenter(zone.polygon);
    const dir = unitVector(center, ringCenter(target.polygon));
    const edge = facingEdge(zone.polygon, dir);
    const tangent = { x: -dir.y, y: dir.x };
    const inset = half + 0.6;
    const zoneBoxSize = box(zone.polygon);
    const extentAlong = Math.abs(tangent.x) > 0.5 ? zoneBoxSize.e - zoneBoxSize.w : zoneBoxSize.n - zoneBoxSize.s;
    const spread = Math.max(0, Math.min(3, extentAlong / 2 - half - 0.7));
    const base = { x: edge.mid.x - dir.x * inset, y: edge.mid.y - dir.y * inset };
    return [1, -1].map((sign) => ({
      position: { x: base.x + tangent.x * sign * spread, y: base.y + tangent.y * sign * spread },
      rotationDeg: Math.abs(dir.x) >= Math.abs(dir.y) ? 90 : 0,
    }));
  }
  const dir = target
    ? unitVector(stage.position, ringCenter(target.polygon))
    : { x: 0, y: -1 };
  const tangent = { x: -dir.y, y: dir.x };
  const zoneBoxSize = box(zone.polygon);
  const extentAlong = Math.abs(tangent.x) > 0.5 ? zoneBoxSize.e - zoneBoxSize.w : zoneBoxSize.n - zoneBoxSize.s;
  // 左右对称是硬口径：理想位超出分区就两边同时收到区边内，不让一侧靠网格兜底乱落。
  const offset = Math.max(
    0,
    Math.min(
      stage.size.width / 2 + half + 0.6,
      extentAlong / 2 - half - 0.7,
    ),
  );
  const front = { x: stage.position.x, y: stage.position.y };
  return [1, -1].map((sign) => ({
    position: { x: front.x + tangent.x * sign * offset, y: front.y + tangent.y * sign * offset },
    rotationDeg: Math.abs(dir.x) >= Math.abs(dir.y) ? 90 : 0,
  }));
}

/** 展板：沿分区周界等距排，先南边（正对入口）再东西两侧、最后北边；板面顺着边。 */
function boardCandidates(
  zone: PlanZone,
  material: OutdoorLibraryItem,
): PlacementCandidate[] {
  const b = box(zone.polygon);
  const inset = Math.max(0.9, material.depth / 2 + 0.6);
  const west = b.w + inset;
  const east = Math.max(west + 1, b.e - inset);
  const south = b.s + inset;
  const north = Math.max(south + 1, b.n - inset);
  const step = Math.max(material.width + 2.4, 4);
  const out: PlacementCandidate[] = [];
  const pushEdge = (from: PlanPoint, to: PlanPoint, rotationDeg: number) => {
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    if (len < 0.5) return;
    const count = Math.max(1, Math.floor(len / step) + 1);
    for (let i = 0; i < count; i += 1) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      out.push({
        position: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
        rotationDeg,
      });
    }
  };
  pushEdge({ x: west, y: south }, { x: east, y: south }, 0);
  pushEdge({ x: west, y: south }, { x: west, y: north }, 90);
  pushEdge({ x: east, y: south }, { x: east, y: north }, 90);
  pushEdge({ x: west, y: north }, { x: east, y: north }, 0);
  return out;
}

/** 摊位：沿主通道排，摊宽顺通道、正面朝通道，摊间留 2.4m、排间留 3.2m。 */
function stallCandidates(
  zone: PlanZone,
  plan: SitePlanData,
  material: OutdoorLibraryItem,
): PlacementCandidate[] {
  const b = box(zone.polygon);
  const aisle = aisleDirection(plan, zone);
  const along = aisle && Math.abs(aisle.x) > Math.abs(aisle.y) ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const across = { x: along.y, y: along.x };
  const rotationDeg = along.x !== 0 ? 0 : 90;
  const center = ringCenter(zone.polygon);
  const halfAlong = Math.max(
    0,
    (along.x !== 0 ? (b.e - b.w) / 2 : (b.n - b.s) / 2) - material.width / 2 - 0.6,
  );
  const halfAcross = Math.max(
    0,
    (along.x !== 0 ? (b.n - b.s) / 2 : (b.e - b.w) / 2) - material.depth / 2 - 0.6,
  );
  const stepAlong = material.width + 2.4;
  const stepAcross = material.depth + 3.2;
  const cols = Math.max(1, Math.floor((halfAlong * 2) / stepAlong) + 1);
  const rows = Math.max(1, Math.floor((halfAcross * 2) / stepAcross) + 1);
  const out: PlacementCandidate[] = [];
  for (let r = 0; r < rows; r += 1)
    for (let c = 0; c < cols; c += 1) {
      const u = cols === 1 ? 0 : (c / (cols - 1) - 0.5) * 2 * halfAlong;
      const v = rows === 1 ? 0 : (r / (rows - 1) - 0.5) * 2 * halfAcross;
      out.push({
        position: {
          x: center.x + along.x * u + across.x * v,
          y: center.y + along.y * u + across.y * v,
        },
        rotationDeg,
      });
    }
  return out;
}

/** 座椅：按朝向舞台/观众区成排铺，排距 0.8m；没有舞台就朝最近入口。 */
function seatCandidates(
  zone: PlanZone,
  plan: SitePlanData,
  material: OutdoorLibraryItem,
): PlacementCandidate[] {
  const b = box(zone.polygon);
  const stage = plan.facilities.find(
    (f) => f.zoneId === zone.id && materialRole(f.name) === "stage",
  );
  const target = viewpointZoneFor(zone, plan);
  const focus = stage?.position ?? (target ? ringCenter(target.polygon) : null);
  const center = ringCenter(zone.polygon);
  const dir = focus ? unitVector(center, focus) : { x: 0, y: 1 };
  const perpendicular = Math.abs(dir.x) >= Math.abs(dir.y);
  const rowWidth = perpendicular ? b.n - b.s : b.e - b.w;
  const rowDepth = perpendicular ? b.e - b.w : b.n - b.s;
  const cols = Math.max(1, Math.floor(rowWidth / Math.max(0.6, material.width + 0.45)));
  const rows = Math.max(1, Math.floor(rowDepth / Math.max(0.7, material.depth + 0.8)));
  const out: PlacementCandidate[] = [];
  for (let r = 0; r < rows; r += 1)
    for (let c = 0; c < cols; c += 1) {
      const u = (c - (cols - 1) / 2) * Math.max(0.6, material.width + 0.45);
      const v = (r - (rows - 1) / 2) * Math.max(0.7, material.depth + 0.8);
      out.push({
        position: {
          x: center.x + (perpendicular ? v : u),
          y: center.y + (perpendicular ? u : v),
        },
        rotationDeg: perpendicular ? 90 : 0,
      });
    }
  return out;
}

/**
 * docs/47 A3：footprint 与 soft-avoid 绿地重叠面积的估测值（㎡）。
 * footprint 是凸四/五边形、绿地环任意，不做多边形裁剪——对 footprint 包围盒 4×4 采样，
 * 只计 footprint 多边形内部的采样点，按命中比例折算 footprint 面积。
 * 没传绿地或包围盒不相交时恒为 0：零证据时落位行为与旧首-fit完全一致。
 */
const SOFT_COST_SAMPLES = 4;
function softOverlapCostM2(
  footprint: PlanPoint[],
  softs: { ring: PlanPoint[]; bbox: ReturnType<typeof bboxLoose> }[],
): number {
  if (!softs.length) return 0;
  const fb = bboxLoose(footprint);
  if (!softs.some((s) => bBoxesIntersect(fb, s.bbox))) return 0;
  const w = fb.maxX - fb.minX;
  const h = fb.maxY - fb.minY;
  if (w <= 0 || h <= 0) return 0;
  let inside = 0;
  let hits = 0;
  for (let i = 0; i < SOFT_COST_SAMPLES; i++)
    for (let j = 0; j < SOFT_COST_SAMPLES; j++) {
      const p = {
        x: fb.minX + ((i + 0.5) * w) / SOFT_COST_SAMPLES,
        y: fb.minY + ((j + 0.5) * h) / SOFT_COST_SAMPLES,
      };
      if (!planPointInRing(p, footprint)) continue;
      inside += 1;
      if (
        softs.some((s) => pointInBBox(p, s.bbox) && planPointInRing(p, s.ring))
      )
        hits += 1;
    }
  if (!inside) return 0;
  return (hits / inside) * ringAreaM2(footprint);
}

function gridCandidates(zone: PlanZone): PlanPoint[] {
  const b = box(zone.polygon);
  const grid: PlanPoint[] = [];
  for (let iy = 0; iy < 30; iy++)
    for (let ix = 0; ix < 30; ix++)
      grid.push({
        x: b.w + ((ix + 0.5) * (b.e - b.w)) / 30,
        y: b.s + ((iy + 0.5) * (b.n - b.s)) / 30,
      });
  return grid;
}

function perimeterCandidates(zone: PlanZone): PlanPoint[] {
  const b = box(zone.polygon);
  const cx = (b.w + b.e) / 2;
  const cy = (b.s + b.n) / 2;
  const ring: PlanPoint[] = [];
  for (let i = 0; i < zone.polygon.length; i++) {
    const a = zone.polygon[i]!;
    const b2 = zone.polygon[(i + 1) % zone.polygon.length]!;
    const len = Math.hypot(b2.x - a.x, b2.y - a.y);
    const steps = Math.max(1, Math.round(len / 2.5));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const px = a.x + (b2.x - a.x) * t;
      const py = a.y + (b2.y - a.y) * t;
      const d = Math.max(1, Math.hypot(cx - px, cy - py));
      ring.push({
        x: px + ((cx - px) / d) * 1.5,
        y: py + ((cy - py) / d) * 1.5,
      });
    }
  }
  return ring;
}

/**
 * 候选落位：先按用途给语义锚点（舞台贴观众区、音响夹台、展板沿边、摊位顺通道），
 * 再拼上原来的网格兜底——用途认不出的物件与「实在塞不下」的情形行为不变。
 */
function zonePlacementCandidates(
  zone: PlanZone,
  strategy: ObjectsLayoutStrategy,
  context: { plan: SitePlanData; material: OutdoorLibraryItem },
): PlacementCandidate[] {
  const role = materialRole(context.material.name);
  const semantic =
    role === "stage"
      ? stageCandidates(zone, context.plan, context.material)
      : role === "speaker"
        ? speakerCandidates(zone, context.plan, context.material)
        : role === "board"
          ? boardCandidates(zone, context.material)
          : role === "stall"
            ? stallCandidates(zone, context.plan, context.material)
            : role === "seat"
              ? seatCandidates(zone, context.plan, context.material)
              : [];
  const grid = gridCandidates(zone);
  const cx = ringCenter(zone.polygon).x;
  const cy = ringCenter(zone.polygon).y;
  const fallback: PlacementCandidate[] =
    strategy === "center"
      ? [...grid]
          .sort((p, q) => Math.hypot(p.x - cx, p.y - cy) - Math.hypot(q.x - cx, q.y - cy))
          .map((position) => ({ position, rotationDeg: 0 }))
      : strategy === "perimeter"
        ? [
            ...perimeterCandidates(zone).map((position) => ({ position, rotationDeg: 0 })),
            ...grid.map((position) => ({ position, rotationDeg: 0 })),
          ]
        : grid.map((position) => ({ position, rotationDeg: 0 }));
  return [...semantic, ...fallback];
}

/**
 * 2026-11-17 正式站走查实测（死结 3）：需求里的分区名对不上画布上的分区时，整轮否掉会把用户永久卡死——
 * 需求清单只能「按分区替换」、不能删区（协议里 count 最小是 1），所以画布上没有的分区
 * （多半是上一轮留下的旧需求，或用户口误）永远清不掉，每一轮都报同一个错，物件阶段再也走不下去。
 * 画布上的分区才是权威：对不上的需求跳过并如实报出，其余分区照常排布，不在这些分区猜位置。
 */
export type OutdoorZoneMismatchReason = "missing" | "duplicate";
export interface OutdoorZoneMismatch<TNeed extends { zone: string }> {
  need: TNeed;
  /** missing=画布上没有这个分区；duplicate=画布上同名分区不止一个。 */
  reason: OutdoorZoneMismatchReason;
}

/** 未指定分区的物件在活动边界内落位；这里只提供几何搜索域，不创建画布分区。 */
export function objectPlacementArea(plan: SitePlanData): PlanZone {
  return { id: "activity-boundary", name: "活动场地", semantic: "reserved", polygon: plan.boundary, notes: "" };
}

function usesActivityBoundary(zone: string): boolean {
  return ["", "场地", "活动场地", "活动范围", "全场"].includes(zone.trim());
}

/** 按画布分区给需求里的分区名定身：唯一命中才算对得上，其余都如实记为对不上。 */
export function splitNeedsByZone<TNeed extends { zone: string }>(
  plan: SitePlanData,
  needs: readonly TNeed[],
): {
  matched: TNeed[];
  mismatched: OutdoorZoneMismatch<TNeed>[];
} {
  const matched: TNeed[] = [];
  const mismatched: OutdoorZoneMismatch<TNeed>[] = [];
  for (const need of needs) {
    if (usesActivityBoundary(need.zone)) { matched.push(need); continue; }
    const hits = plan.zones.filter((z) => z.id === need.zone || z.name === need.zone);
    if (hits.length === 1) matched.push(need);
    else
      mismatched.push({
        need,
        reason: hits.length > 1 ? "duplicate" : "missing",
      });
  }
  return { matched, mismatched };
}

/** 对不上分区的如实说明：写清是哪些分区、画布上真实有哪些分区，怎么补救；不替用户猜。 */
export function describeZoneMismatch<TNeed extends { zone: string }>(
  mismatched: readonly OutdoorZoneMismatch<TNeed>[],
  plan: SitePlanData,
  options?: { removed?: boolean; subject?: string },
): string {
  const names = [...new Set(mismatched.map((m) => m.need.zone))];
  const duplicates = new Set(
    mismatched.filter((m) => m.reason === "duplicate").map((m) => m.need.zone),
  );
  const why = names
    .map((n) =>
      duplicates.has(n)
        ? `「${n}」在画布上有同名分区，分不清是哪一个`
        : `「${n}」不在画布上`,
    )
    .join("、");
  const zones = plan.zones.map((z) => z.name);
  return [
    `${why}，这 ${names.length} 条${options?.subject ?? "需求未摆放"}（没有在这些分区猜位置）`,
    options?.removed ? "已从需求清单移除" : "",
    zones.length ? `当前画布分区：${zones.join("、")}` : "当前画布还没有分区",
    "要保留请先在画布上补出该分区，再重新说明清单",
  ]
    .filter(Boolean)
    .join("；") + "。";
}

export async function proposeInventoryObjects(
  plan: SitePlanData,
  brief: OutdoorBrief,
  library: OutdoorLibraryItem[],
  id: () => string = () => crypto.randomUUID(),
  options?: {
    strategy?: ObjectsLayoutStrategy;
    buildings?: PlanPoint[][] | undefined;
    /** 2026-11-14 用户指令「进度条要显示在干嘛」：逐区落位的真实进度回调（async 化让出主线程刷新 UI）。 */
    onPhase?: ((phase: string) => void) | undefined;
    signal?: AbortSignal | undefined;
    /** 2026-11-17 用户拍板「就硬挤在一起，甲方就会明白放不下了」：硬挤模式——物件互不重叠、
     *  通道/门口只留最小净空，塞到物理极限为止；塞不下的差额如实返回 capacityShortfall，
     *  让预览自己说明「放不下」，不替用户把数量改小。 */
    packed?: boolean;
    /** 2026-11-18 用户口径「先设计，用户会告诉你他的想法」：人数/面积粗筛不拦整版，
     *  改由 demandNote 带回卡上，预览照出。 */
    softDemand?: boolean;
    /** docs/47 A3：hard-block 禁区（水域/围栏，plan 同基准 ENU 环）。物件 footprint
     *  不得压禁区，与建筑/室内禁区同一套「中心进环或环相交即跳过」判据。 */
    hardBlocks?: PlanPoint[][] | undefined;
    /** docs/47 A3：soft-avoid 绿地（plan 同基准 ENU 环）。可摆但有代价——落位评分按
     *  footprint 与绿地的估测重叠面积计代价，零绿地时行为与旧首-fit完全一致。 */
    softAreas?: PlanPoint[][] | undefined;
  },
): Promise<{
  plan: SitePlanData;
  used: OutdoorLibraryItem[];
  /** 2026-11-17：需求分区对不上画布的那些条（跳过了，没有摆放）。 */
  mismatched: OutdoorZoneMismatch<OutdoorBrief["items"][number]>[];
  /** 2026-11-17 硬挤模式：物理上限放不满时的差额，预览据此说清「放不下」。 */
  capacityShortfall: { zone: string; query: string; requested: number; placed: number }[];
  /** 2026-11-18 softDemand：人数/面积粗筛没过的原话，带到卡上而不是拦下预览。 */
  demandNote?: string | null;
}> {
  if (!brief.items.length)
    throw new Error(
      "各区需要哪些物件、各多少？例如“展览区6个展板、表演区1个舞台2只音响”。将先检索你的真实物料库，不自动生成。",
    );
  const strategy = options?.strategy ?? "rows";
  // 2026-11-14 用户指令「建筑给室内分区，设计别做进室内」：落位候选在建筑足迹内、或占地与建筑相交的一律跳过。
  const buildings = options?.buildings ?? [];
  // 室内区域（用户手画的 indoor 语义分区）同样是禁区。
  const indoorZones = plan.zones.filter(z => z.environment === "indoor");
  // docs/47 A3：证据分级进引擎——水域/围栏 hard 块扩进禁区集合；绿地 soft 块只计代价不禁。
  const hardBlocks = options?.hardBlocks ?? [];
  const softAreas = options?.softAreas ?? [];
  // 2026-11-14 性能：禁区包围盒预筛——逐候选只对 bbox 相交的少数禁区做环运算（323 栋×900 候选×39 物件的逐顶点环运算实测冻结主线程）。
  const buildingBBoxes = buildings.map(ring => ({ ring, bbox: bboxLoose(ring) }));
  const indoorZoneBBoxes = indoorZones.map(zone => ({ zone, bbox: bboxLoose(zone.polygon) }));
  const hardBlockBBoxes = hardBlocks.map(ring => ({ ring, bbox: bboxLoose(ring) }));
  const softAreaBBoxes = softAreas.map(ring => ({ ring, bbox: bboxLoose(ring) }));
  let next = { ...plan, facilities: [...plan.facilities] };
  const used: OutdoorLibraryItem[] = [];
  const capacityShortfall: { zone: string; query: string; requested: number; placed: number }[] = [];
  // 2026-11-17 死结 3：需求分区对不上画布的先分出来——对不上的跳过（并如实报出），
  // 其余分区照常排布；一条都对不上时仍然报错（没有可排的东西，不能出空提案）。
  const { matched: matchedNeeds, mismatched } = splitNeedsByZone(plan, brief.items);
  if (mismatched.length && !matchedNeeds.length)
    throw new Error(describeZoneMismatch(mismatched, plan));
  for (const need of matchedNeeds) {
    // 2026-11-14 用户指令「进度条要显示在干嘛」：每区让出主线程一帧，让状态文字与进度条真实刷新。
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (options?.signal?.aborted)
      throw new Error("已取消本次物件排布。");
    const unzoned = usesActivityBoundary(need.zone);
    const zone = unzoned ? objectPlacementArea(plan) : plan.zones.find(
      (z) => z.id === need.zone || z.name === need.zone,
    )!;
    let matches = library.filter(
      (item) =>
        // 2026-11-14 用户指令「按主题排物件」：内置 OnePlan 物件库（source='built-in'）与个人库同权参与。
        (item.source === "personal" || item.source === "built-in") &&
        item.available &&
        (item.name.toLowerCase().includes(need.query.toLowerCase()) ||
          item.id === need.query),
    );
    // 2026-11-14 消歧：子串撞上一组相近物件（指示牌/指示牌架·双面/…）时，精确同名优先收窄。
    const exact = matches.filter((m) => m.name === need.query);
    if (exact.length) matches = exact;
    if (!matches.length) {
      // 2026-11-17 断点修复：口径差一个字（「摊位」vs「市集摊位」）就红卡，卡上却不说库里有什么。
      // 把库里现有名称带上，用户照着说就能过，不用猜。
      const known = [...new Set(library.filter((m) => m.available).map((m) => m.name))]
        .slice(0, 6)
        .join("、");
      throw new Error(
        `你的真实物料库中尚未找到尺寸与模型可用的“${need.query}”。${
          known ? `库里现有：${known}。` : ""
        }可改名称检索/选真实候选或上传；未自动创建收费生成。`,
      );
    }
    if (matches.length > 1) {
      // 同名多候选（如 manifest 里 icon/scale 两条「市集摊位」）按名称归组：组内同一物件不追问；
      // 只有出现「不同名」真歧义时才要求用户给具体名称。
      const nameGroups = new Map<string, typeof matches>();
      for (const item of matches) {
        const list = nameGroups.get(item.name) ?? [];
        list.push(item);
        nameGroups.set(item.name, list);
      }
      if (nameGroups.size > 1)
        throw new Error(
          `你的库里有${matches.length}个“${need.query}”候选：${[...nameGroups.keys()].join("、")}。请给具体名称或ID，不替你随便选第一个。`,
        );
      // 2026-11-17 设计师模式：同名候选里 icon: 与 scale: 并存时（如「市集摊位」「舞台」），
      // 优先真实占地物件——图标尺寸不是摊位的真实占地，拿它排会得到一个“看着能看、实际放不下”的方案。
      if (nameGroups.size === 1) {
        const scaled = [...nameGroups.values()][0]!.filter((m) => m.id.startsWith("scale:"));
        if (scaled.length) matches = scaled;
      }
    }
    const material = matches[0]!;
    used.push(material);
    // 物料名可能是整段生成提示词；画布与候选只用短名，原文进备注。
    const displayName = generatedObjectName(material.name, "物料");
    options?.onPhase?.(`正在落位：${zone.name} · ${displayName} × ${need.count}`);
    const allocationKey = `${zone.id}:${need.query}`;
    const allocated = next.facilities.filter(
      (f) => f.allocationKey === allocationKey,
    );
    if (allocated.some((f) => f.sourceAssetId !== material.id))
      throw new Error(
        "此项已有其他真实物料，请先明确替换哪个设施；不会重复添加或擅自删除。",
      );
    if (allocated.length > need.count) {
      const removed = allocated.slice(need.count);
      // 2026-11-14：Agent 摆的库物件（notes 有签名、非 generated 模型）随清单缩减自动回收；
      // 用户深化过的（generated 模型）仍要求逐个确认，不批量丢件。
      if (
        removed.some(
          (f) =>
            !f.modelOverride?.startsWith("generated:library-") &&
            !f.notes?.startsWith("复用我的物料库真实模型"),
        )
      )
        throw new Error(
          "部分设施已有后续模型深化，请明确逐个删除；保留其任务归属，不批量丢件。",
        );
      next = {
        ...next,
        facilities: next.facilities.filter(
          (f) => !removed.some((r) => r.id === f.id),
        ),
      };
    }
    for (let n = Math.min(allocated.length, need.count); n < need.count; n++) {
      // docs/47 A3：绿地代价评分——首个零代价落位即收（与旧首-fit一致，零绿地时行为不变）；
      // 首选压绿地时继续扫完全表，全都有代价时取代价最小的一格（并列取先出现者）。
      let best: PlanFacility | null = null;
      let bestCost = Number.POSITIVE_INFINITY;
      // 2026-11-18 用户指令「agent 能不能智能根据分区摆放物件」：先按用途给语义锚点与朝向，
      // 网格仍作兜底（用途认不出、或语义位置放不下时行为不变）。
      const candidates = zonePlacementCandidates(zone, strategy, { plan: next, material });
      // 排不下时仍允许转 90 度再试一次（沿用旧口径，不改容量上限）。
      const attempts = [
        ...candidates,
        ...candidates.map((c) => ({ ...c, rotationDeg: (c.rotationDeg + 90) % 180 })),
      ];
      for (const attempt of attempts) {
        if (best && bestCost === 0) break;
        const position = attempt.position;
        const rotationDeg = attempt.rotationDeg;
        const facility: PlanFacility = {
          id: id(),
          // 2026-11-14 修复：用规范的 oneplan: 前缀（原 library: 前缀贴纸/取色查找都认不出，
          // Agent 摆的物件在画布上全是裸矩形）。
          templateId: `oneplan:${material.id}`.slice(0, 64),
          name: `${displayName} ${n + 1}`.slice(0, 60),
          ...(unzoned ? {} : { zoneId: zone.id }),
          position,
          rotationDeg,
          size: { width: material.width, depth: material.depth },
          modelOverride: material.modelSlug,
          sourceAssetId: material.id,
          allocationKey,
          notes: generatedObjectNotes(
            material.name,
            "复用我的物料库真实模型与米制尺寸；保留已确认通道/门口。",
          ),
        };
        if (clearForObject(facility, next, zone, options?.packed === true)) {
          // 建筑禁区 + 室内区域：包围盒预筛后仅对相交者做环运算（性能，见 bboxLoose）。
          const footprint = facilityFootprintRing(facility);
          const footprintBBox = bboxLoose(footprint);
          if (buildingBBoxes.some(b => pointInBBox(position, b.bbox) && planPointInRing(position, b.ring))) continue;
          if (indoorZoneBBoxes.some(z => pointInBBox(position, z.bbox) && planPointInRing(position, z.zone.polygon))) continue;
          if (buildingBBoxes.some(b => bBoxesIntersect(footprintBBox, b.bbox) && outdoorRingsOverlap(footprint, b.ring))) continue;
          if (indoorZoneBBoxes.some(z => bBoxesIntersect(footprintBBox, z.bbox) && outdoorRingsOverlap(footprint, z.zone.polygon))) continue;
          // docs/47 A3：禁区扩集——水域/围栏 hard 块与建筑/室内同判据，摆位不得进入。
          if (hardBlockBBoxes.some(b => pointInBBox(position, b.bbox) && planPointInRing(position, b.ring))) continue;
          if (hardBlockBBoxes.some(b => bBoxesIntersect(footprintBBox, b.bbox) && outdoorRingsOverlap(footprint, b.ring))) continue;
          const cost = softOverlapCostM2(footprint, softAreaBBoxes);
          if (!best || cost < bestCost) {
            best = facility;
            bestCost = cost;
          }
          if (cost === 0) break;
        }
      }
      // docs/47 A3：避不开绿地时如实注明——不冒充「避让成功」。
      const found =
        best && bestCost > 0
          ? {
              ...best,
              notes: `${best.notes}；本区没有完全避开绿地的空位：按代价最小落位，仍与绿地面重叠约${Math.max(1, Math.round(bestCost))}㎡（植被保护/审批需现场核对）。`,
            }
          : best;
      if (!found) {
        // 2026-11-17 用户拍板「就硬挤在一起，甲方就会明白放不下了」：硬挤模式下塞到物理极限就停，
        // 差额如实返回；非硬挤（正常间距）仍然整版报错，不静默出半版。
        if (options?.packed) {
          capacityShortfall.push({
            zone: zone.name,
            query: need.query,
            requested: need.count,
            placed: n,
          });
          break;
        }
        // docs/47 A3：分区与水域/围栏禁区重叠时如实说明——禁区吃掉了可用面积，不是纯放不下。
        const zoneHitsHardBlock = hardBlockBBoxes.some(
          (b) =>
            bBoxesIntersect(bboxLoose(zone.polygon), b.bbox) &&
            outdoorRingsOverlap(zone.polygon, b.ring),
        );
        throw new Error(
          `“${zone.name}”放不下第${n + 1}件“${displayName}”并保留通道与门口${zoneHitsHardBlock ? "；本分区与水域/围栏禁区重叠，物件排不进禁区，实际可用范围比分区小" : ""}；可减数量、选择较小真实物料或调整分区。整版未写入。`,
        );
      }
      next = { ...next, facilities: [...next.facilities, found] };
    }
  }
  let demandNote: string | null = null;
  if (options?.softDemand === true) {
    try {
      validateWorkflowDemand(next, brief);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      demandNote = error.message;
    }
  } else validateWorkflowDemand(next, brief);
  return { plan: next, used, mismatched, capacityShortfall, demandNote };
}
export function reachablePedestrianRoutes(
  plan: SitePlanData,
  audience: NonNullable<PlanWorker["audience"]>,
): SitePlanData["routes"] {
  return personnelAccess(plan, audience).routes;
}
/** Clip centre lines into the confirmed activity polygon; geometry is not a right-of-way grant. */
export function clipWorkflowRoutes(
  routes: SitePlanData["routes"],
  boundary: PlanPoint[],
): SitePlanData["routes"] {
  const result: SitePlanData["routes"] = [];
  for (const route of routes) {
    let active: PlanPoint[] = [];
    const flush = () => {
      if (
        active.length >= 2 &&
        outdoorCorridorStrips(active, route.widthM ?? 3).every(
          (s) => !facilityPlacementIssues(s, boundary).length,
        )
      )
        result.push({
          ...route,
          id: crypto.randomUUID(),
          points: active,
          notes: `${route.notes}；仅保留活动范围内的候选段，线宽为设计提案非实测路宽`,
        });
      active = [];
    };
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1]!,
        b = route.points[i]!,
        dx = b.x - a.x,
        dy = b.y - a.y;
      const ts = [0, 1];
      for (let j = 0; j < boundary.length; j++) {
        const c = boundary[j]!,
          d = boundary[(j + 1) % boundary.length]!,
          ex = d.x - c.x,
          ey = d.y - c.y,
          den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / den,
          u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / den;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
      }
      ts.sort((x, y) => x - y);
      const at = (t: number) => ({ x: a.x + dx * t, y: a.y + dy * t });
      for (let j = 1; j < ts.length; j++) {
        const lo = ts[j - 1]!,
          hi = ts[j]!;
        if (hi - lo < 1e-9) continue;
        if (!planPointInRing(at((lo + hi) / 2), boundary)) {
          flush();
          continue;
        }
        const from = at(lo),
          to = at(hi);
        if (
          active.length &&
          Math.hypot(
            active[active.length - 1]!.x - from.x,
            active[active.length - 1]!.y - from.y,
          ) > 0.001
        )
          flush();
        if (!active.length) active.push(from);
        active.push(to);
      }
    }
    flush();
  }
  return result;
}
/** 这类岗位能走的动线：动线上要有落在这个分区里、且入场与出场都走得通的点。 */
function eligibleWorkerRoutes(
  access: ReturnType<typeof personnelAccess>,
  zone: PlanZone,
): SitePlanData["routes"] {
  return access.routes.filter((r) =>
    r.points.some(
      (p) => planPointInRing(p, zone.polygon) && access.paths(p, r.levelId) !== null,
    ),
  );
}

/**
 * 2026-11-17 死结 4：没有可用通道时把「为什么不行、你能做什么」写清楚。
 * 旧文案让用户「先安排子流线/子入口」，但那条补救路径实际不成立（重跑子动线还是同样的跳过）——
 * 新文案要说清缺的是哪一类通道、补不出来是什么原因，以及可以改做什么。
 */
function describeMissingWorkerAccess(
  zone: PlanZone,
  need: OutdoorBrief["people"][number],
): string {
  const kind =
    need.audience === "service"
      ? "后勤"
      : need.audience === "performers"
        ? "表演"
        : need.audience === "security"
          ? "安保"
          : "人行";
  return (
    `“${zone.name}”没有可用于${kind}岗位的进出通道：现有动线里没有一条能让人既从入口进场、又从出口离场` +
    `（可能是单向流线只出不能入、流线服务人群不含这类岗位、或这一区离人行流线太远），本区也没有已确认的子口可以接驳。` +
    `请在画布上给“${zone.name}”补一条接驳线/子口（确认后即可排岗），或把这个岗位改到已有通道的分区；不会把岗位放到不连通的区域。`
  );
}

export function proposeRoleWorkers(
  plan: SitePlanData,
  brief: OutdoorBrief,
  id: () => string = () => crypto.randomUUID(),
): SitePlanData {
  if (!brief.people.length)
    throw new Error(
      "服务、保安、工作人员、表演人员分别多少、负责哪个区？我会按岗位和已确认进出路径安排，不随机撒人。",
    );
  const workers: PlanWorker[] = [...plan.workers];
  // 2026-11-17 死结 3：岗位分区对不上画布的同样跳过并如实报出（物件侧的同一处死结）。
  const { matched: matchedPeople, mismatched } = splitNeedsByZone(plan, brief.people);
  if (mismatched.length && !matchedPeople.length)
    throw new Error(describeZoneMismatch(mismatched, plan, { subject: "岗位未安排" }));
  // 2026-11-17 死结 4：该分区没有这类岗位能走的通道时，先补一条专用驳线写进方案，
  // 岗位落在真正连通的支线上（提案卡里能看到新补的线）；补不出来才报错。
  let working = plan;
  for (const need of matchedPeople) {
    const zone = working.zones.find(
      (z) => z.id === need.zone || z.name === need.zone,
    )!;
    let access = personnelAccess(working, need.audience);
    let eligible = eligibleWorkerRoutes(access, zone);
    if (!eligible.length) {
      const spur = buildZoneSpur(working, zone, id, {
        audiences: spurAudiencesFor(zone, need.audience),
        // 只复用已经确认过的出入口：不自己发明新门（否则单向流线那种只出不能入的区
        // 会因为多一个新节点而看起来也连通，既有守卫就被绕开了）。
        requireExistingPortal: true,
      });
      if (!spur) throw new Error(describeMissingWorkerAccess(zone, need));
      working = {
        ...working,
        routes: [...working.routes, spur.route],
        nodes: spur.node ? [...working.nodes, spur.node] : working.nodes,
      };
      access = personnelAccess(working, need.audience);
      eligible = eligibleWorkerRoutes(access, zone);
      if (!eligible.length) throw new Error(describeMissingWorkerAccess(zone, need));
    }
    const point = eligible
      .flatMap((r) => r.points)
      .find(
        (p) =>
          planPointInRing(p, zone.polygon) &&
          access.paths(
            p,
            eligible.find((r) => r.points.includes(p))?.levelId,
          ) !== null &&
          !working.facilities.some((f) =>
            planPointInRing(p, facilityFootprintRing(f)),
          ),
      );
    if (!point)
      throw new Error(
        `“${zone.name}”的岗位通道被物件占用，请先调整物件/子路线。`,
      );
    const allocationKey = JSON.stringify([
      zone.id,
      need.role.normalize("NFKC").trim(),
      need.audience,
    ]);
    const matches = (w: PlanWorker) =>
      w.allocationKey === allocationKey ||
      (!w.allocationKey &&
        w.zoneId === zone.id &&
        w.role === need.role &&
        w.audience === need.audience &&
        w.notes.startsWith("岗位分配提案"));
    const old = workers.find(matches);
    for (let i = workers.length - 1; i >= 0; i--)
      if (matches(workers[i]!)) workers.splice(i, 1);
    workers.push({
      id: old?.id ?? id(),
      allocationKey,
      role: need.role,
      count: need.count,
      zoneId: zone.id,
      audience: need.audience,
      routeIds: [
        ...new Set([
          ...(access.paths(
            point,
            eligible.find((r) => r.points.includes(point))?.levelId,
          ) ?? []),
          ...eligible.filter((r) => r.points.includes(point)).map((r) => r.id),
        ]),
      ],
      activityZoneIds: [zone.id],
      position: point,
      notes:
        "岗位分配提案；数量来自用户，活动范围为关联分区，进出限关联路线；非排班或安全认证。",
    });
  }
  return { ...working, workers };
}
export function validateWorkflowPlan(
  base: SitePlanData,
  next: SitePlanData,
): void {
  sitePlanDataSchema.parse(next);
  if (!checkBoundaryRing(next.boundary).ok) throw new Error("活动边界无效。");
  // 点名越界分区：只报「分区越出」用户没法知道是谁、该挪谁。
  const offendingZones = [...new Set(next.zones
    .filter((zone) => facilityPlacementIssues(zone.polygon, next.boundary).length)
    .map((zone) => zone.name))];
  if (offendingZones.length) throw new Error(`分区越出已确认活动边界：${offendingZones.join("、")}。`);
  const changedZones = new Set(
    next.zones
      .filter(
        (z) =>
          JSON.stringify(base.zones.find((o) => o.id === z.id)) !==
          JSON.stringify(z),
      )
      .map((z) => z.id),
  );
  for (let i = 0; i < next.zones.length; i++)
    for (let j = i + 1; j < next.zones.length; j++) {
      const a = next.zones[i]!,
        b = next.zones[j]!;
      if (
        (changedZones.has(a.id) || changedZones.has(b.id)) &&
        a.levelId === b.levelId &&
        planRingsOverlap(a.polygon, b.polygon)
      )
        throw new Error("当前同层分区重叠，请核对边界/层级；未应用。");
    }
  // 2026-11-14 用户拍板「流线可以从场地外延伸到场内」：路线不再强制全宽落在活动边界内
  //（到场段天然在界外，入口=道路与边界交点）；仅保留「不压现有设施」。
  for (const route of next.routes.filter(
    (r) =>
      JSON.stringify(base.boundary) !== JSON.stringify(next.boundary) ||
      JSON.stringify(base.routes.find((old) => old.id === r.id)) !==
        JSON.stringify(r),
  )) {
    const strips = outdoorCorridorStrips(route.points, route.widthM ?? 3);
    if (
      next.facilities.some((f) =>
        strips.some((strip) =>
          outdoorRingsOverlap(strip, facilityFootprintRing(f)),
        ),
      )
    )
      throw new Error(
        "新路线全宽占地穿越现有设施，请调整路线/物件；未应用。",
      );
  }
  for (const f of next.facilities.filter(
    (f) =>
      JSON.stringify(base.boundary) !== JSON.stringify(next.boundary) ||
      changedZones.has(f.zoneId ?? "") ||
      JSON.stringify(base.facilities.find((b) => b.id === f.id)) !==
        JSON.stringify(f),
  )) {
    const zone = f.zoneId ? next.zones.find((z) => z.id === f.zoneId) : objectPlacementArea(next);
    if (
      !zone ||
      !clearForObject(
        f,
        {
          ...next,
          facilities: next.facilities.filter((other) => other.id !== f.id),
        },
        zone,
      )
    )
      throw new Error(
        "物件占地/方向与区域、通道、门口或其他物件冲突，未应用。",
      );
  }
  for (const worker of next.workers) {
    if (
      worker.zoneId &&
      (changedZones.has(worker.zoneId) ||
        !base.workers.some((w) => w.id === worker.id))
    ) {
      const zone = next.zones.find((z) => z.id === worker.zoneId);
      if (!zone || !planPointInRing(worker.position, zone.polygon))
        throw new Error(
          "岗位所属分区已经变化，请重新核对岗位范围；未把人员留在区外。",
        );
    }
    if (worker.routeIds?.some((id) => !next.routes.some((r) => r.id === id)))
      throw new Error("岗位进出路线已失效，请重新安排；未应用。");
  }
}
/** 2026-11-14 用户拍板「以第一个选区为准」：换活动边界（候选轮廓/手画闭合）时，
 * 旧边界下的内容按新边界重新安置——装不下的分区/物件/流线随场淘汰（提案整批可撤销），
 * 人员/出入口的悬空 zoneId、岗位的悬空路线引用就地清空；不再用「分区越出」硬报错阻断换场。
 * 若地理锚点本身位移（≥1cm，与 canReanchorOutdoorPlan 同口径），旧坐标系内容整体随场清空——
 * 跨坐标系的逐件几何比较没有意义，换场=新场地。
 * 产出保证能通过 validateWorkflowPlan（分区必须整体在新边界内、物件必须可归入保留分区、流线全宽不得越界或压物件）。 */
export function prunePlanForBoundary(
  base: SitePlanData,
  boundary: SitePlanData["boundary"],
  anchor?: NonNullable<SitePlanData["anchor"]>,
): { next: SitePlanData; droppedZones: string[]; droppedFacilities: string[]; droppedRoutes: string[]; swept: boolean } {
  const movedMeters = base.anchor && anchor
    ? Math.hypot(
        (anchor.lng - base.anchor.lng) * 111320 * Math.cos(anchor.lat * Math.PI / 180),
        (anchor.lat - base.anchor.lat) * 110540,
      )
    : 0;
  if (movedMeters >= 0.01) {
    const name = (items: { name: string }[]) => items.map((item) => item.name);
    return {
      next: { ...base, zones: [], facilities: [], routes: [], workers: [], nodes: [], annotations: [], measurements: [] },
      droppedZones: name(base.zones),
      droppedFacilities: name(base.facilities),
      droppedRoutes: name(base.routes),
      swept: true,
    };
  }
  const zones = base.zones.filter(
    (zone) => !facilityPlacementIssues(zone.polygon, boundary).length,
  );
  const droppedZoneIds = new Set(
    base.zones
      .filter((zone) => facilityPlacementIssues(zone.polygon, boundary).length)
      .map((zone) => zone.id),
  );
  const droppedZones = base.zones
    .filter((zone) => droppedZoneIds.has(zone.id))
    .map((zone) => zone.name);
  const skeleton: SitePlanData = { ...base, boundary, zones };
  // 物件：validateWorkflowPlan 在边界变化时会逐件重查（必须归进一个保留分区且落位干净），
  // 归不进去的随场淘汰；能归入的换挂到保留分区。
  const droppedFacilities: string[] = [];
  const facilities: PlanFacility[] = [];
  for (const facility of base.facilities) {
    const ring = facilityFootprintRing(facility);
    const host = !facility.zoneId ? objectPlacementArea(skeleton) : zones.find(
      (zone) => !facilityPlacementIssues(ring, zone.polygon).length,
    );
    if (!host || !clearForObject(facility, { ...skeleton, facilities }, host)) {
      droppedFacilities.push(facility.name);
      continue;
    }
    facilities.push({ ...facility, zoneId: facility.zoneId ? host.id : undefined });
  }
  // 流线：全宽走廊越出新边界或压到保留物件的一律淘汰（与 validateWorkflowPlan 同口径）。
  const droppedRoutes: string[] = [];
  const routes = base.routes.filter((route) => {
    const strips = outdoorCorridorStrips(route.points, route.widthM ?? 3);
    const inside =
      !strips.some((strip) => facilityPlacementIssues(strip, boundary).length) &&
      !facilities.some((f) =>
        strips.some((strip) =>
          outdoorRingsOverlap(strip, facilityFootprintRing(f)),
        ),
      );
    if (!inside) droppedRoutes.push(route.name);
    return inside;
  });
  // 人员/出入口：归属分区没了就清引用（点保留）；岗位路线被淘汰就清引用。
  const droppedRouteIds = new Set(
    base.routes
      .filter((route) => !routes.some((kept) => kept.id === route.id))
      .map((route) => route.id),
  );
  const clearZoneRef = <T extends { zoneId?: string | undefined }>(items: T[]): T[] =>
    items.map((item) =>
      item.zoneId && droppedZoneIds.has(item.zoneId)
        ? { ...item, zoneId: undefined }
        : item,
    );
  return {
    next: {
      ...skeleton,
      facilities,
      routes,
      workers: clearZoneRef<PlanWorker>(base.workers).map((worker) => ({
        ...worker,
        routeIds: worker.routeIds?.filter((id) => !droppedRouteIds.has(id)) ?? [],
      })),
      nodes: clearZoneRef<PlanNode>(base.nodes),
    },
    droppedZones,
    droppedFacilities,
    droppedRoutes,
    swept: false,
  };
}
