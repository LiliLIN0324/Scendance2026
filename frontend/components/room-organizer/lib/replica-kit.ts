/**
 * OnePlan 案例复刻基建（学习库 → 产品）。
 *
 * 参考图在 learning-library/oneplan-siteplans/（版权归 OnePlan，仅内部学习）。
 * 每个 ReplicaCaseSpec 用紧凑规格描述一张参考图：真实地点锚点 + 色块区 + 设施阵列 + 流线 + 出入口；
 * expandSpec 把规格展开成合法 SitePlanData：
 * - boundary 自动按 zone/facility/node 极值生成矩形 + REPLICA_MARGIN 米边距（保证零越界误报）；
 * - designScope 按 boundary 四边外扩 DEFAULT_SCOPE_MARGIN_M 生成（案例也有那只白框）；
 * - UUID 由 slug 哈希 + 序号确定性生成（同 slug 永远同 id，测试 diff 干净）；
 * - 出口 sitePlanDataSchema.parse 自检，坏规格构建期炸。
 *
 * 锚点 source 一律 'preset'：复刻演示件按真实案例地点落位，但不是实测。
 */

import {
  sitePlanDataSchema,
  type PlanAnchor,
  type PlanFacility,
  type PlanNode,
  type PlanPoint,
  type PlanRoute,
  type PlanZone,
  type SitePlanData,
} from '../../../../supabase/functions/_shared/site-plan';
import { DEFAULT_SCOPE_MARGIN_M, expandRect } from './outdoor-design-scope';

/** 自动边界外扩边距（米）。 */
export const REPLICA_MARGIN = 15;

/**
 * 复刻案一律带设计范围（红线外接矩形四边各外扩 DEFAULT_SCOPE_MARGIN_M）。
 *
 * 2026-11-17 用户：「案例库画完了用地红线，外面没有对应的白色框」。
 * 病根在数据，不在画布：复刻案只生成了 boundary，没写 designScope，而画布按
 * `designScope.length >= 3` 才画白框与角标；手画红线的路径会自动补这一圈，
 * 案例是「预先摆好的成品」，没人替它补，于是白框缺席、框外也谈不上压暗。
 * 这里按同一口径补齐：白框永远兜得住红线（与「画好红线默认=设计范围」一致）。
 */
const replicaScopeOf = (boundary: readonly PlanPoint[]): PlanPoint[] => expandRect(boundary, DEFAULT_SCOPE_MARGIN_M);

export type ReplicaCaseSpec = {
  slug: string;
  /** 英文原案名（项目名用「复刻示例 · title」）。 */
  title: string;
  category: string;
  region: string;
  /** 参考图文件名（learning-library/oneplan-siteplans/ 下）。 */
  refImage: string;
  refLink: string;
  /** 真实案例地点（GCJ-02 口径；海外= WGS-84 原值）。 */
  anchor: { lng: number; lat: number };
  /** 地点口径备注（镇级/概念案等，如实标注）。 */
  locationNote?: string;
  /**
   * 平面图相对正北的旋转角（度，顺时针为正）。参考图是斜视角截的，图面上方不等于正北，
   * 用这个角度把局部米制坐标整体旋到真实方位上。0 / 省略 = 图面正上方就是正北。
   */
  rotationDeg?: number;
  zones: ReplicaZoneSpec[];
  facilities: ReplicaFacilitySpec[];
  routes: ReplicaRouteSpec[];
  nodes: ReplicaNodeSpec[];
};

export type ReplicaZoneSpec = {
  name: string;
  semantic: PlanZone['semantic'];
  color: string;
  opacity?: number;
  /** 中心 + 宽高 + 旋转（度）矩形。 */
  rect?: { cx: number; cy: number; w: number; h: number; rot?: number };
  /** 自由多边形（与 rect 二选一，polygon 优先）。 */
  polygon?: [number, number][];
  /** 圆形区块（马戏大棚等），10 顶点近似。与 rect/polygon 三选一，polygon > circle > rect。 */
  circle?: { cx: number; cy: number; r: number };
};

export type FacilityPlacement =
  | { kind: 'single'; x: number; y: number; rot?: number }
  | { kind: 'row'; x: number; y: number; count: number; dx?: number; dy?: number; rot?: number }
  | { kind: 'grid'; x: number; y: number; cols: number; rows: number; dx: number; dy?: number; rot?: number }
  | { kind: 'scatter'; at: [number, number][]; rot?: number };

export type ReplicaFacilitySpec = {
  templateId: string;
  /** 基础名；多实例自动补序号（「Bar 帐篷 1/2/3…」），单实例原样。 */
  name: string;
  placement: FacilityPlacement;
  /** 所属 zones 数组下标。 */
  zoneIndex?: number;
  /** 覆盖默认占地（见 REPLICA_FACILITY_SIZES）。 */
  size?: { width: number; depth: number };
  /** 实例色（参考图配色）。 */
  color?: string;
};

export type ReplicaRouteSpec = {
  name: string;
  kind: PlanRoute['kind'];
  carrier?: PlanRoute['carrier'];
  color?: string;
  widthM?: number;
  oneWay?: boolean;
  points: [number, number][];
  /** nodes 数组下标。 */
  startNode?: number;
};

export type ReplicaNodeSpec = {
  name: string;
  kind: PlanNode['kind'];
  x: number;
  y: number;
};

/** 常用模板默认占地（与 plan-facility-catalog 的解析口径一致；spec.size 可覆盖）。 */
export const REPLICA_FACILITY_SIZES: Readonly<Record<string, { width: number; depth: number }>> = {
  'oneplan:scale:tent': { width: 3, depth: 3 },
  'oneplan:scale:pop-up-tent': { width: 3, depth: 3 },
  'oneplan:scale:bell-tent': { width: 3, depth: 3 },
  'oneplan:scale:yurt': { width: 5, depth: 5 },
  'oneplan:scale:stretch-tent': { width: 6, depth: 4 },
  'oneplan:scale:portable-toilet': { width: 2.4, depth: 1.2 },
  'oneplan:scale:accessible-portable-toilet': { width: 2.4, depth: 2.4 },
  'oneplan:scale:generator': { width: 2.4, depth: 1.2 },
  'oneplan:scale:market-stall': { width: 2, depth: 2 },
  'oneplan:scale:picnic-table': { width: 1.8, depth: 0.8 },
  'oneplan:scale:chair': { width: 0.6, depth: 0.5 },
  'oneplan:scale:bench': { width: 1.8, depth: 0.6 },
  'oneplan:scale:large-waste-container': { width: 2.5, depth: 1.5 },
  'oneplan:scale:shipping-container': { width: 6.1, depth: 2.4 },
  'oneplan:scale:water-refill-station': { width: 2, depth: 1.5 },
  'oneplan:scale:food-trailer': { width: 4, depth: 2.2 },
  'oneplan:scale:caravan': { width: 5.5, depth: 2.3 },
  'oneplan:scale:bus': { width: 2.5, depth: 12 },
  'oneplan:scale:car': { width: 4.5, depth: 1.8 },
  'oneplan:scale:police-car': { width: 4.5, depth: 1.8 },
  'oneplan:scale:ambulance': { width: 4.8, depth: 2 },
  'oneplan:scale:round-table-and-chairs': { width: 1.5, depth: 1.5 },
  'oneplan:scale:stage': { width: 8, depth: 6 },
  'oneplan:scale:large-screen': { width: 6, depth: 1.5 },
  'oneplan:scale:gantry': { width: 6, depth: 2 },
  'oneplan:scale:bike-rack': { width: 2, depth: 0.6 },
  'oneplan:icon:stanchion': { width: 0.5, depth: 0.5 },
  'oneplan:icon:bar': { width: 2, depth: 1.2 },
  'oneplan:icon:camping': { width: 1.5, depth: 1.5 },
  'oneplan:icon:boat': { width: 2.5, depth: 1.2 },
  'oneplan:icon:wifi': { width: 1, depth: 1 },
  'oneplan:icon:carnival': { width: 6, depth: 6 },
  'oneplan:icon:themepark': { width: 8, depth: 8 },
  'oneplan:icon:bouncy-castle': { width: 6, depth: 4 },
  'oneplan:icon:street-lamp': { width: 0.6, depth: 0.6 },
  'oneplan:icon:photo-point': { width: 1.5, depth: 1.5 },
  'oneplan:icon:merchandise': { width: 2, depth: 1.5 },
  'oneplan:icon:vip': { width: 1.5, depth: 1.5 },
  'oneplan:icon:event-control': { width: 2, depth: 1.5 },
  'oneplan:icon:lost-property': { width: 1.5, depth: 1 },
  'oneplan:icon:welfare-point': { width: 2, depth: 1.5 },
  'oneplan:icon:water-refill-point': { width: 1.2, depth: 1.2 },
  'oneplan:icon:drinks-station': { width: 2, depth: 1.5 },
  'oneplan:icon:medal': { width: 1, depth: 1 },
  'oneplan:icon:podium': { width: 2, depth: 1 },
  'oneplan:icon:fireworks': { width: 3, depth: 3 },
  'oneplan:icon:relax-zone': { width: 3, depth: 3 },
  'oneplan:icon:wheel-station': { width: 1.5, depth: 1.5 },
  'oneplan:icon:km-marker': { width: 0.6, depth: 0.6 },
  'oneplan:icon:timing-point': { width: 1.5, depth: 1 },
  'oneplan:icon:traffic-lights': { width: 1, depth: 1 },
  'oneplan:icon:bus-stop': { width: 4, depth: 1.5 },
  'oneplan:icon:camera-fixed': { width: 0.8, depth: 0.8 },
  'oneplan:scale:scaffold-tower': { width: 2, depth: 2 },
  'oneplan:scale:inflatable-arch': { width: 6, depth: 2 },
  'oneplan:scale:truss-arch': { width: 8, depth: 2 },
  'oneplan:scale:wooden-chalet': { width: 4, depth: 3 },
  'oneplan:scale:dugout': { width: 6, depth: 2 },
  'oneplan:scale:folding-chair': { width: 0.6, depth: 0.5 },
  'oneplan:scale:deck-chair': { width: 0.7, depth: 0.6 },
  'oneplan:icon:entry-gate': { width: 2, depth: 1 },
  'oneplan:icon:exit-gate': { width: 2, depth: 1 },
  'oneplan:icon:ticket-check': { width: 1.5, depth: 1 },
  'oneplan:icon:information-point': { width: 1.5, depth: 1.5 },
  'oneplan:icon:first-aid-point': { width: 2, depth: 1.5 },
  'oneplan:icon:atm': { width: 1, depth: 1 },
  'oneplan:icon:feather-flag': { width: 0.8, depth: 0.8 },
  'oneplan:icon:cone': { width: 0.5, depth: 0.5 },
  'oneplan:icon:bollard': { width: 0.5, depth: 0.5 },
  'stage-platform-8x6': { width: 8, depth: 6 },
  'food-truck-6x2.5': { width: 6, depth: 2.5 },
  'booth-2x2': { width: 2, depth: 2 },
  'tent-3x3': { width: 3, depth: 3 },
  'medical-tent-4x3': { width: 4, depth: 3 },
  'toilet-2.4x1.2': { width: 2.4, depth: 1.2 },
  'security-post-1.5x1.5': { width: 1.5, depth: 1.5 },
  'trash-point-1.2x1.2': { width: 1.2, depth: 1.2 },
};

/** 复刻案例通用黄色人流线（OnePlan 参考图的标志性呈现）。 */
export const REPLICA_FLOW_COLOR = '#f2c744';

function point(x: number, y: number): PlanPoint {
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

function rectPoints(cx: number, cy: number, w: number, h: number, rotDeg = 0): PlanPoint[] {
  const r = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
    .map(([px, py]) => point(cx + px * cos - py * sin, cy + px * sin + py * cos));
}

function zonePolygonOf(spec: ReplicaZoneSpec): PlanPoint[] {
  if (spec.polygon) return spec.polygon.map(([x, y]) => point(x, y));
  if (spec.circle) {
    const { cx, cy, r } = spec.circle;
    return Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2;
      return point(cx + r * Math.cos(a), cy + r * Math.sin(a));
    });
  }
  if (!spec.rect) throw new Error(`zone ${spec.name} 缺 rect/polygon/circle`);
  return rectPoints(spec.rect.cx, spec.rect.cy, spec.rect.w, spec.rect.h, spec.rect.rot ?? 0);
}

/** 设施阵列展开成实例坐标（可再带单件朝向）。 */
function facilityInstancesOf(spec: ReplicaFacilitySpec): { x: number; y: number; rot: number; label: string }[] {
  const p = spec.placement;
  const label = (i: number) => {
    const count = p.kind === 'scatter' ? p.at.length : p.kind === 'row' ? p.count : p.kind === 'grid' ? p.cols * p.rows : 1;
    return count > 1 ? `${spec.name} ${i + 1}` : spec.name;
  };
  if (p.kind === 'single') {
    return [{ x: p.x, y: p.y, rot: p.rot ?? 0, label: spec.name }];
  }
  if (p.kind === 'row') {
    const dx = p.dx ?? 0;
    const dy = p.dy ?? 0;
    return Array.from({ length: p.count }, (_, i) => ({ x: p.x + i * dx, y: p.y + i * dy, rot: p.rot ?? 0, label: label(i) }));
  }
  if (p.kind === 'grid') {
    const out: { x: number; y: number; rot: number; label: string }[] = [];
    for (let r = 0; r < p.rows; r++) {
      for (let c = 0; c < p.cols; c++) {
        out.push({ x: p.x + c * (p.dx ?? 0), y: p.y + r * (p.dy ?? 0), rot: p.rot ?? 0, label: label(out.length) });
      }
    }
    return out;
  }
  return p.at.map(([x, y], i) => ({ x, y, rot: p.rot ?? 0, label: label(i) }));
}

/** slug → 8 位十六进制（UUID 首段），确定性。 */
function slugHex(slug: string): string {
  let h = 0x3e60;
  for (const ch of slug) h = ((h * 31) ^ ch.codePointAt(0)!) >>> 0;
  return h.toString(16).padStart(8, '0').slice(0, 8);
}

function uid(slug: string, seq: number): string {
  return `${slugHex(slug)}-a000-4000-8000-${String(seq).padStart(12, '0')}`;
}

/** 规格展开成合法 SitePlanData（出口 schema 自检）。 */
export function expandReplicaSpec(spec: ReplicaCaseSpec): SitePlanData {
  const planRot = spec.rotationDeg ?? 0;
  const rad = (-planRot * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);
  const rotXY = (x: number, y: number): [number, number] =>
    planRot % 360 === 0
      ? [x, y]
      : [Math.round((x * cosR - y * sinR) * 1000) / 1000, Math.round((x * sinR + y * cosR) * 1000) / 1000];
  const rotPt = (p: PlanPoint): PlanPoint => {
    const [x, y] = rotXY(p.x, p.y);
    return x === p.x && y === p.y ? p : { ...p, x, y };
  };
  const zones: PlanZone[] = spec.zones.map((zone, i) => ({
    id: uid(spec.slug, i + 1),
    semantic: zone.semantic,
    name: zone.name,
    polygon: zonePolygonOf(zone).map(rotPt),
    color: zone.color,
    notes: '',
    ...(zone.opacity != null ? { opacity: zone.opacity } : {}),
  }));
  const facilities: PlanFacility[] = [];
  let seq = 100;
  for (const f of spec.facilities) {
    const size = f.size ?? REPLICA_FACILITY_SIZES[f.templateId];
    if (!size) throw new Error(`facility ${f.name}（${f.templateId}）没有默认占地，须显式给 size`);
    for (const inst of facilityInstancesOf(f)) {
      const [fx, fy] = rotXY(inst.x, inst.y);
      facilities.push({
        id: uid(spec.slug, seq++),
        templateId: f.templateId,
        name: inst.label,
        position: point(fx, fy),
        rotationDeg: (inst.rot - planRot + 360) % 360,
        size,
        notes: '',
        ...(f.zoneIndex != null ? { zoneId: zones[f.zoneIndex].id } : {}),
        ...(f.color ? { color: f.color } : {}),
      });
    }
  }
  const nodes: PlanNode[] = spec.nodes.map((node, i) => {
    const [nx, ny] = rotXY(node.x, node.y);
    return {
      id: uid(spec.slug, 500 + i),
      kind: node.kind,
      name: node.name,
      position: point(nx, ny),
      notes: '',
    };
  });
  const routes: PlanRoute[] = spec.routes.map((route, i) => ({
    id: uid(spec.slug, 600 + i),
    kind: route.kind,
    name: route.name,
    points: route.points.map(([x, y]) => point(...rotXY(x, y))),
    oneWay: route.oneWay ?? false,
    notes: '',
    ...(route.carrier ? { carrier: route.carrier } : {}),
    ...(route.widthM != null ? { widthM: route.widthM } : {}),
    ...(route.color ? { color: route.color } : {}),
    ...(route.startNode != null ? { startNodeId: nodes[route.startNode].id } : {}),
  }));
  // 自动边界：全部 zone 顶点 / 设施落点 / 节点的极值 + REPLICA_MARGIN，保证零越界误报。
  const all: PlanPoint[] = [
    ...zones.flatMap(z => z.polygon),
    ...facilities.map(f => f.position),
    ...nodes.map(n => n.position),
  ];
  if (!all.length) throw new Error(`复刻案 ${spec.slug} 没有任何实体`);
  const minX = Math.min(...all.map(p => p.x)) - REPLICA_MARGIN;
  const maxX = Math.max(...all.map(p => p.x)) + REPLICA_MARGIN;
  const minY = Math.min(...all.map(p => p.y)) - REPLICA_MARGIN;
  const maxY = Math.max(...all.map(p => p.y)) + REPLICA_MARGIN;
  const anchor: PlanAnchor = { lng: spec.anchor.lng, lat: spec.anchor.lat, crs: 'gcj-02', source: 'preset' };
  const boundary: PlanPoint[] = [point(minX, minY), point(maxX, minY), point(maxX, maxY), point(minX, maxY)];
  const plan: SitePlanData = {
    schemaVersion: 1,
    anchor,
    boundary,
    designScope: replicaScopeOf(boundary).map(p => point(p.x, p.y)),
    zones,
    facilities,
    routes,
    nodes,
    workers: [],
  };
  return sitePlanDataSchema.parse(plan);
}
