import { z } from 'zod';
import { canonical, sha256 } from './domain.ts';

/**
 * 户外活动平面规划（SitePlan）——2D 规划的唯一数据契约。
 *
 * 坐标：局部米制 ENU 平面（x=东向米，y=北向米），场地锚点单独标注 GCJ-02，
 * 几何真值与投影解耦；室内物件的 {x,z} 约定在 3D 接线时映射，不在本契约内混用。
 * 派生量（面积/长度/清单/冲突）一律从几何现算，不落盘、不缓存进快照。
 */

/** 平面点：x 东向米、y 北向米。场地尺度 ±5 km，足够市集到环湖赛事。 */
export const planPointSchema = z.strictObject({
  x: z.number().min(-5000).max(5000),
  y: z.number().min(-5000).max(5000),
});
export type PlanPoint = z.infer<typeof planPointSchema>;

/** 场地地理锚点：高德语义下的 GCJ-02，来源必须显式（天地图/OSM 为 CGCS2000/WGS-84，接线前先转换）。 */
export const planAnchorSchema = z.strictObject({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  crs: z.literal('gcj-02'),
  source: z.enum(['picker', 'lookup', 'manual', 'asset-geo']),
});
export type PlanAnchor = z.infer<typeof planAnchorSchema>;

/** 闭合环：3–64 顶点，不重复存储首点（闭合由消费方补），相邻顶点不重合。 */
export const planRingSchema = z.array(planPointSchema).min(3).max(64);
export type PlanRing = z.infer<typeof planRingSchema>;

/** 分区语义：户外活动 9 类，预留区与既有室内 keep-out 语义一致。 */
export const planZoneSemantics = ['stage', 'audience', 'parking', 'loading', 'checkin', 'queue', 'medical', 'vip', 'reserved'] as const;
export const planZoneSemanticLabels: Record<(typeof planZoneSemantics)[number], string> = {
  stage: '舞台区',
  audience: '观众区',
  parking: '停车区',
  loading: '装卸区',
  checkin: '签到区',
  queue: '排队区',
  medical: '医疗点',
  vip: 'VIP 区',
  reserved: '预留区',
};

export const planZoneSchema = z.strictObject({
  id: z.uuid(),
  semantic: z.enum(planZoneSemantics),
  name: z.string().min(1).max(60),
  polygon: planRingSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(s => s.toLowerCase()).optional(),
  /** 填充透明度 0–1（H2-b）：可选，缺省由渲染层取 tokens 默认 0.22；旧数据不带该字段照常解析。 */
  opacity: z.number().min(0).max(1).optional(),
  notes: z.string().max(500).default(''),
});
export type PlanZone = z.infer<typeof planZoneSchema>;

/** 设施实例：模板放置后的独立实体（改名/改尺寸不影响模板默认值）。templateId 先放开为字符串，目录收敛归 H2。 */
export const planFacilitySchema = z.strictObject({
  id: z.uuid(),
  templateId: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  position: planPointSchema,
  rotationDeg: z.number().min(-360).max(360),
  size: z.strictObject({ width: z.number().positive().max(100), depth: z.number().positive().max(100) }),
  zoneId: z.uuid().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(s => s.toLowerCase()).optional(),
  notes: z.string().max(500).default(''),
});
export type PlanFacility = z.infer<typeof planFacilitySchema>;

/** 三类动线：人行 / 车辆 / 后勤。宽度可选——缺宽度就是「待处理问题」，不虚构。 */
export const planRouteKinds = ['pedestrian', 'vehicle', 'service'] as const;
export const planRouteKindLabels: Record<(typeof planRouteKinds)[number], string> = {
  pedestrian: '人行',
  vehicle: '车辆',
  service: '后勤',
};
export const planRouteSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(planRouteKinds),
  name: z.string().min(1).max(60),
  points: z.array(planPointSchema).min(2).max(128),
  oneWay: z.boolean().default(false),
  widthM: z.number().positive().max(30).optional(),
  /** 起点引用的出入口节点（H2-d，可选）：节点是动线的唯一端点来源，旧数据不带该字段照常解析。 */
  startNodeId: z.uuid().optional(),
  /** 终点引用的出入口节点（H2-d，可选）：移动节点后引用路线端点随动（编辑层 movePlanNode）。 */
  endNodeId: z.uuid().optional(),
  notes: z.string().max(500).default(''),
});
export type PlanRoute = z.infer<typeof planRouteSchema>;

/** 出入口节点：动线的唯一端点来源（入口/出口/两用）。 */
export const planNodeSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(['entry', 'exit', 'both']),
  name: z.string().min(1).max(60),
  position: planPointSchema,
  notes: z.string().max(500).default(''),
});
export type PlanNode = z.infer<typeof planNodeSchema>;

/** 人员点位：岗位、人数、颜色点位，按区汇总走 zoneId（可选）。 */
export const planWorkerSchema = z.strictObject({
  id: z.uuid(),
  role: z.string().min(1).max(60),
  count: z.number().int().min(1).max(9999),
  position: planPointSchema,
  zoneId: z.uuid().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(s => s.toLowerCase()).optional(),
  notes: z.string().max(500).default(''),
});
export type PlanWorker = z.infer<typeof planWorkerSchema>;

/** 测量标注三类：距离（2 点段长）/ 面积（≥3 点闭合环）/ 路径（≥2 点折线）。 */
export const planMeasurementKinds = ['distance', 'area', 'path'] as const;
export const planMeasurementKindLabels: Record<(typeof planMeasurementKinds)[number], string> = {
  distance: '距离',
  area: '面积',
  path: '路径',
};
/**
 * 测量标注（H3-a）：固定测量是标注不是实体——不参与冲突判定，读数一律从几何现算。
 * 可选字段（与 opacity / startNodeId 同口径）：旧快照不带 measurements 照常解析，不虚构字段。
 */
export const planMeasurementSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(planMeasurementKinds),
  name: z.string().min(1).max(60),
  /** 距离恰好 2 点、面积 3–64 点、路径 2–64 点；几何约束见 superRefine。 */
  points: z.array(planPointSchema).min(2).max(64),
  notes: z.string().max(500).default(''),
});
export type PlanMeasurement = z.infer<typeof planMeasurementSchema>;

/** 一份规划数据：边界 + 五类实体 + 测量标注，全部带 UUID。 */
export const sitePlanDataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  anchor: planAnchorSchema.optional(),
  boundary: planRingSchema,
  zones: z.array(planZoneSchema).max(200),
  facilities: z.array(planFacilitySchema).max(2000),
  routes: z.array(planRouteSchema).max(200),
  nodes: z.array(planNodeSchema).max(100),
  workers: z.array(planWorkerSchema).max(500),
  /** 固定测量标注（H3-a，可选）：旧数据不带该字段照常解析。 */
  measurements: z.array(planMeasurementSchema).max(200).optional(),
}).superRefine((plan, ctx) => {
  const collections: [keyof typeof plan, string][] = [
    ['zones', '分区'], ['facilities', '设施'], ['routes', '路线'], ['nodes', '出入口'], ['workers', '人员'], ['measurements', '测量'],
  ];
  const seen = new Set<string>();
  for (const [key, label] of collections) {
    const items = (plan[key] as { id: string }[] | undefined) ?? [];
    for (const item of items) {
      const id = item.id.toLowerCase();
      if (seen.has(id)) ctx.addIssue({ code: 'custom', message: `${label}实体 ID 与其他实体重复` });
      seen.add(id);
    }
  }
  const zoneIds = new Set(plan.zones.map(zone => zone.id.toLowerCase()));
  for (const facility of plan.facilities) {
    if (facility.zoneId && !zoneIds.has(facility.zoneId.toLowerCase())) {
      ctx.addIssue({ code: 'custom', message: `设施 ${facility.name} 的主归属分区不存在` });
    }
  }
  for (const worker of plan.workers) {
    if (worker.zoneId && !zoneIds.has(worker.zoneId.toLowerCase())) {
      ctx.addIssue({ code: 'custom', message: `人员 ${worker.role} 的归属分区不存在` });
    }
  }
  const nodeIds = new Set(plan.nodes.map(node => node.id.toLowerCase()));
  for (const route of plan.routes) {
    if (route.startNodeId && !nodeIds.has(route.startNodeId.toLowerCase())) {
      ctx.addIssue({ code: 'custom', message: `路线 ${route.name} 的起点节点引用不存在` });
    }
    if (route.endNodeId && !nodeIds.has(route.endNodeId.toLowerCase())) {
      ctx.addIssue({ code: 'custom', message: `路线 ${route.name} 的终点节点引用不存在` });
    }
    for (let i = 1; i < route.points.length; i++) {
      if (route.points[i].x === route.points[i - 1].x && route.points[i].y === route.points[i - 1].y) {
        ctx.addIssue({ code: 'custom', message: `路线 ${route.name} 存在相邻重复顶点` });
      }
    }
  }
  for (const measurement of plan.measurements ?? []) {
    if (measurement.kind === 'distance' && measurement.points.length !== 2) {
      ctx.addIssue({ code: 'custom', message: `测量 ${measurement.name} 的距离口径是恰好 2 个点` });
    }
    if (measurement.kind === 'area' && measurement.points.length < 3) {
      ctx.addIssue({ code: 'custom', message: `测量 ${measurement.name} 的面积口径是至少 3 个点闭合环` });
    }
    for (let i = 1; i < measurement.points.length; i++) {
      if (measurement.points[i].x === measurement.points[i - 1].x && measurement.points[i].y === measurement.points[i - 1].y) {
        ctx.addIssue({ code: 'custom', message: `测量 ${measurement.name} 存在相邻重复顶点` });
      }
    }
  }
  for (let i = 1; i < plan.boundary.length; i++) {
    if (plan.boundary[i].x === plan.boundary[i - 1].x && plan.boundary[i].y === plan.boundary[i - 1].y) {
      ctx.addIssue({ code: 'custom', message: '场地边界存在相邻重复顶点' });
    }
  }
});
export type SitePlanData = z.infer<typeof sitePlanDataSchema>;

/** 版本化快照信封：planId 稳定、revision 单调递增；存储接线（H1-b）沿用该信封。 */
export const sitePlanSnapshotSchema = z.strictObject({
  planId: z.uuid(),
  projectId: z.uuid().optional(),
  revision: z.number().int().min(1),
  updatedAt: z.iso.datetime(),
  data: sitePlanDataSchema,
});
export type SitePlanSnapshot = z.infer<typeof sitePlanSnapshotSchema>;

/** 派生几何一律现算：环面积（鞋带公式，未闭合按闭合处理）。 */
export function planRingAreaM2(ring: readonly PlanPoint[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** 派生几何一律现算：折线长度（局部米制直线段求和）。 */
export function planRouteLengthM(points: readonly PlanPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/** 快照指纹：canonical JSON + sha256（与 sceneHash 同一套路），交付/版本对账共用。 */
export async function sitePlanHash(snapshot: SitePlanSnapshot): Promise<string> {
  return sha256(canonical({ planId: snapshot.planId, revision: snapshot.revision, data: snapshot.data }));
}
