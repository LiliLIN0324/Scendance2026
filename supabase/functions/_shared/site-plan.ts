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

/**
 * 场地地理锚点：高德语义下的 GCJ-02，来源必须显式（天地图/OSM 为 CGCS2000/WGS-84，接线前先转换）。
 * 'preset' = 产品预置定位（2026-11-11 用户拍板：户外规划默认带锚点，缺省落「西湖 · 平湖秋月」，
 * 与 SceneAnchor 的 'preset' 词汇对齐；用户重新选址后会被 picker/lookup 覆盖）。
 */
export const planAnchorSchema = z.strictObject({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  crs: z.literal('gcj-02'),
  source: z.enum(['picker', 'lookup', 'manual', 'asset-geo', 'preset']),
});
export type PlanAnchor = z.infer<typeof planAnchorSchema>;

/** 闭合环：3–64 顶点，不重复存储首点（闭合由消费方补），相邻顶点不重合。 */
export const planRingSchema = z.array(planPointSchema).min(3).max(64);
export type PlanRing = z.infer<typeof planRingSchema>;

/**
 * 图层（2026-11-11 用户拍板：Level = 自定义独立「画布/设计方案」，不是楼层高度）：
 * 同一场地下可建多套方案各自编辑/比对；场地边界与锚点跨图层共享，实体各归各层。
 * 可选字段：旧数据不带 levels 照常解析——读取层合成单个默认层，不落盘（见 plan-levels 纯函数）。
 */
export const planLevelSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(60),
});
export type PlanLevel = z.infer<typeof planLevelSchema>;

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
  /**
   * V-3a（2026-11-13 用户拍板「事件挂 zone 加字段」）：这个分区承载的事件（如「潮乐之夜·舞台」）。
   * 可选——AI 区域提案（zone-event-proposal）写入、属性面板可改；旧数据缺字段照常解析（无需迁移）。
   */
  event: z.string().min(1).max(120).optional(),
  /** 所属图层（可选）：缺省归第一层；levels 缺省时不得携带（superRefine 把关）。 */
  levelId: z.uuid().optional(),
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
  /** 填充透明度 0–1（2026-11-11 OnePlan Bench Styling 同款）：可选，缺省 1；旧数据不带该字段照常解析。 */
  opacity: z.number().min(0).max(1).optional(),
  /** 所属图层（可选）：缺省归第一层。 */
  levelId: z.uuid().optional(),
  notes: z.string().max(500).default(''),
  /**
   * 2026-11-12 OnePlan「+ Object setup」镜像（用户拍板同名字段）：供应商/进撤场/用电。
   * date/time 存原生输入格式（YYYY-MM-DD / HH:MM），undefined=未填；旧数据缺字段照常解析（optional 直通）。
   */
  vendorName: z.string().max(120).optional(),
  vendorZone: z.string().max(120).optional(),
  inDate: z.string().max(10).optional(),
  inTime: z.string().max(5).optional(),
  outDate: z.string().max(10).optional(),
  outTime: z.string().max(5).optional(),
  electricKw: z.number().min(0).max(10000).optional(),
  /** 2026-11-12 描边样式（OnePlan 同款三态+无描边）：实线/虚线/点线/无，缺省实线；旧数据缺字段照常解析。 */
  strokeStyle: z.enum(['solid', 'dashed', 'dotted', 'none']).optional(),
  /**
   * V-5a（2026-11-13）3D 模型手动 override：物料库 slug（assets/library/merged.json 主键）。
   * 可选——缺省走 plan-facility-models 的自动挑选（selectFacilityModel），点属性卡候选缩略图写入、
   * 「自动」清回 undefined；与 opacity/color 同口径不写 default，旧数据缺字段照常解析（无需迁移）。
   */
  modelOverride: z.string().min(1).max(160).optional(),
});
export type PlanFacility = z.infer<typeof planFacilitySchema>;

/**
 * 场地边界：0 或 3–64 顶点。2026-11-11 用户拍板「新建项目先不要一上来就开一个场地边界」——
 * 新草稿 boundary = []（未画起步），画完闭合才写入 ≥3 点；0 点时全案不做越界判定、不渲染边界。
 * 旧数据 3–64 点照常解析（zone 的 polygon 仍用 planRingSchema 的 3–64 口径不变）。
 * 1–2 点是画到一半的退化中间态，不落盘（2026-11-12 补下界 refine，零边界语义与旧退化拒绝并存）。
 */
export const planBoundarySchema = z
  .array(planPointSchema)
  .max(64)
  .refine(points => points.length === 0 || points.length >= 3, {
    message: '场地边界要么为空（未画），要么至少 3 个顶点（闭合）。',
  });

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
  /** 线色（可选，2026-11-12 活动包赛道预设）：缺省按 kind 取 tokens 色；旧数据不带该字段照常解析。 */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(s => s.toLowerCase()).optional(),
  /** 起点引用的出入口节点（H2-d，可选）：节点是动线的唯一端点来源，旧数据不带该字段照常解析。 */
  startNodeId: z.uuid().optional(),
  /** 终点引用的出入口节点（H2-d，可选）：移动节点后引用路线端点随动（编辑层 movePlanNode）。 */
  endNodeId: z.uuid().optional(),
  /** 所属图层（可选）：缺省归第一层。 */
  levelId: z.uuid().optional(),
  notes: z.string().max(500).default(''),
});
export type PlanRoute = z.infer<typeof planRouteSchema>;

/** 出入口节点：动线的唯一端点来源（入口/出口/两用）。 */
export const planNodeSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(['entry', 'exit', 'both']),
  name: z.string().min(1).max(60),
  position: planPointSchema,
  /** 所属图层（可选）：缺省归第一层。 */
  levelId: z.uuid().optional(),
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
  /** 所属图层（可选）：缺省归第一层。 */
  levelId: z.uuid().optional(),
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
  /** 所属图层（可选）：缺省归第一层。 */
  levelId: z.uuid().optional(),
  notes: z.string().max(500).default(''),
});
export type PlanMeasurement = z.infer<typeof planMeasurementSchema>;

/** 2026-11-11 用户指令：自由标注五类——文本（note）+ 四种形状（矩形/圆形/三角形/线段）。 */
export const planAnnotationKinds = ['note', 'rect', 'circle', 'triangle', 'line'] as const;
export const planAnnotationKindLabels: Record<(typeof planAnnotationKinds)[number], string> = {
  note: '文本',
  rect: '矩形',
  circle: '圆形',
  triangle: '三角形',
  line: '线段',
};
/**
 * 自由标注（2026-11-11 用户指令，OnePlan 工具栏 T + 形状同款）：
 * 标注是标注不是实体——不参与冲突判定，图形一律从米制几何现算。
 * 点位口径：note/circle 恰好 1 点（文本锚点/圆心）；rect/line 恰好 2 点（对角/两端）；
 * triangle 恰好 3 点。可选字段（与 measurements 同口径）：旧快照不带 annotations 照常解析。
 */
export const planAnnotationSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(planAnnotationKinds),
  name: z.string().min(1).max(60),
  /** 各类型点位数口径见 superRefine。 */
  points: z.array(planPointSchema).min(1).max(3),
  /** circle 专用：半径（米），> 0。 */
  radiusM: z.number().positive().max(5000).optional(),
  /** note 专用：文本内容（就地输入提交）。 */
  text: z.string().max(200).default(''),
  /** 标注色（可选）：缺省取图层标注色。 */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(s => s.toLowerCase()).optional(),
  /** 形状描边档位（可选，2026-11-13）：thin 细线 / thick 粗线；仅形状生效，文本不显示线宽。旧数据不带字段按细线渲染。 */
  strokeWidth: z.enum(['thin', 'thick']).optional(),
  /** 所属图层（可选）：缺省归第一层。 */
  levelId: z.uuid().optional(),
  notes: z.string().max(500).default(''),
});
export type PlanAnnotation = z.infer<typeof planAnnotationSchema>;

/** 一份规划数据：边界 + 图层 + 五类实体 + 测量标注 + 自由标注，全部带 UUID。 */
export const sitePlanDataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  anchor: planAnchorSchema.optional(),
  boundary: planBoundarySchema,
  /** 图层清单（可选）：旧数据缺省——读取层合成单个默认层，不落盘；至多 20 层。 */
  levels: z.array(planLevelSchema).max(20).optional(),
  zones: z.array(planZoneSchema).max(200),
  facilities: z.array(planFacilitySchema).max(2000),
  routes: z.array(planRouteSchema).max(200),
  nodes: z.array(planNodeSchema).max(100),
  workers: z.array(planWorkerSchema).max(500),
  /** 固定测量标注（H3-a，可选）：旧数据不带该字段照常解析。 */
  measurements: z.array(planMeasurementSchema).max(200).optional(),
  /** 2026-11-11 用户指令：自由标注（文本 + 形状，可选）：旧数据不带该字段照常解析。 */
  annotations: z.array(planAnnotationSchema).max(500).optional(),
}).superRefine((plan, ctx) => {
  const collections: [keyof typeof plan, string][] = [
    ['levels', '图层'], ['zones', '分区'], ['facilities', '设施'], ['routes', '路线'], ['nodes', '出入口'], ['workers', '人员'], ['measurements', '测量'], ['annotations', '标注'],
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
  // 图层引用：levelId 必须指向 levels 里的层（levels 缺省时任何实体都不得携带 levelId）。
  const levelIds = new Set((plan.levels ?? []).map(level => level.id.toLowerCase()));
  const levelRefs: [string, string | undefined][] = [
    ...plan.zones.map(item => [`分区 ${item.name}`, item.levelId] as [string, string | undefined]),
    ...plan.facilities.map(item => [`设施 ${item.name}`, item.levelId] as [string, string | undefined]),
    ...plan.routes.map(item => [`路线 ${item.name}`, item.levelId] as [string, string | undefined]),
    ...plan.nodes.map(item => [`出入口 ${item.name}`, item.levelId] as [string, string | undefined]),
    ...plan.workers.map(item => [`人员 ${item.role}`, item.levelId] as [string, string | undefined]),
    ...(plan.measurements ?? []).map(item => [`测量 ${item.name}`, item.levelId] as [string, string | undefined]),
    ...(plan.annotations ?? []).map(item => [`标注 ${item.name}`, item.levelId] as [string, string | undefined]),
  ];
  for (const [label, levelId] of levelRefs) {
    if (levelId && !levelIds.has(levelId.toLowerCase())) {
      ctx.addIssue({ code: 'custom', message: `${label}引用的图层不存在` });
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
  // 2026-11-11 用户指令：自由标注几何口径（点位数随类型、圆形必带半径、无相邻重复顶点）。
  for (const annotation of plan.annotations ?? []) {
    const need: Record<PlanAnnotation['kind'], number> = { note: 1, circle: 1, rect: 2, line: 2, triangle: 3 };
    if (annotation.points.length !== need[annotation.kind]) {
      ctx.addIssue({ code: 'custom', message: `标注 ${annotation.name} 的点位数与类型「${annotation.kind}」口径不符` });
    }
    if (annotation.kind === 'circle' && !(annotation.radiusM !== undefined && annotation.radiusM > 0)) {
      ctx.addIssue({ code: 'custom', message: `标注 ${annotation.name} 是圆形，必须带半径 radiusM` });
    }
    for (let i = 1; i < annotation.points.length; i++) {
      if (annotation.points[i].x === annotation.points[i - 1].x && annotation.points[i].y === annotation.points[i - 1].y) {
        ctx.addIssue({ code: 'custom', message: `标注 ${annotation.name} 存在相邻重复顶点` });
      }
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

/** 户外草稿固定未核验 notice：读取不代表已用于排布、容量核定或通过安全检查。 */
export const AGENT_PLAN_OBSERVATION_NOTICE='户外平面草稿为待核验快照；读取不代表已用于排布、容量核定或通过安全检查。';

/** 快照指纹：canonical JSON + sha256（与 sceneHash 同一套路），交付/版本对账共用。 */
export async function sitePlanHash(snapshot: SitePlanSnapshot): Promise<string> {
  return sha256(canonical({ planId: snapshot.planId, revision: snapshot.revision, data: snapshot.data }));
}
