/**
 * 户外 2D 规划候选信封与内存工作副本装配（#46-1，additive-only v1）。
 *
 * 口径：
 * - 模型回传只给输入几何/语义，实体 id 一律由服务端 uuid 生成；
 * - 几何为局部米制 ENU（x 东、y 北），范围复用 site-plan 契约；
 * - 本模块只做内存试算，不写本机 store、不调后端写 RPC；候选仅预览，经用户确认后才应用；
 * - templateId 必须命中内置目录白名单，未知 slug 回 INVALID_TOOL_INPUT，不静默造件；
 * - 不产出消防/容量/通行核定结论； uncovered 固定清单只声明未核验项。
 */
import { z } from 'zod';
import { uuid } from './domain.ts';
import {
  planAnchorSchema,
  planFacilitySchema,
  planNodeSchema,
  planRouteSchema,
  planWorkerSchema,
  planZoneSchema,
  sitePlanDataSchema,
  planZoneSemantics,
  planRouteKinds,
  AGENT_PLAN_OBSERVATION_NOTICE,
  type PlanAnchor,
  type SitePlanData,
} from './site-plan.ts';
export type { SitePlanData };
import { planPointInRing, planRingSelfIntersects, planRingsOverlap } from './plan-geometry.ts';
import { isOneplanPlaceableTemplateId, parseOneplanTemplateId } from './oneplan-whitelist.ts';

/* ---------------- 内置设施模板白名单（与前端 site-plan-facilities.ts 同值同尺寸） ---------------- */

export interface PlanFacilityTemplate {
  templateId: string;
  name: string;
  width: number;
  depth: number;
  note: string;
  color?: string;
}

export const PLAN_FACILITY_TEMPLATES: readonly PlanFacilityTemplate[] = [
  { templateId: 'booth-2x2', name: '市集摊位', width: 2, depth: 2, note: '标准市集摊位' },
  { templateId: 'tent-3x3', name: '后勤帐篷', width: 3, depth: 3, note: '物料 / 休息' },
  { templateId: 'food-truck-6x2.5', name: '餐车', width: 6, depth: 2.5, note: '餐饮售卖' },
  { templateId: 'stage-platform-8x6', name: '舞台台面', width: 8, depth: 6, note: '演出舞台' },
  { templateId: 'toilet-2.4x1.2', name: '移动洗手间', width: 2.4, depth: 1.2, note: '单体厕位' },
  { templateId: 'medical-tent-4x3', name: '医疗帐篷', width: 4, depth: 3, note: '急救点' },
  { templateId: 'security-post-1.5x1.5', name: '安保岗亭', width: 1.5, depth: 1.5, note: '固定岗' },
  { templateId: 'trash-point-1.2x1.2', name: '垃圾收集点', width: 1.2, depth: 1.2, note: '分类回收' },
];

export function findFacilityTemplate(templateId: string): PlanFacilityTemplate | null {
  return PLAN_FACILITY_TEMPLATES.find(t => t.templateId === templateId) ?? null;
}

/** oneplan 物件在 edge 侧的通用占位占地；真实尺寸由前端按 manifest 条目落位后校准。 */
const ONEPLAN_FALLBACK_SIZE = { width: 1.5, depth: 1.5 };

/** 设施目录白名单命中：内置 8 模板，或 manifest 可放置 oneplan 条目。 */
export function isAllowedFacilityTemplate(templateId: string): boolean {
  return findFacilityTemplate(templateId) !== null || isOneplanPlaceableTemplateId(templateId);
}

/** 取模板占地；oneplan 条目回落到通用占位尺寸。 */
export function facilityTemplateSize(templateId: string): { width: number; depth: number } {
  const template = findFacilityTemplate(templateId);
  return template ? { width: template.width, depth: template.depth } : { ...ONEPLAN_FALLBACK_SIZE };
}

/** oneplan 条目的可读名回落：slug 转空格；无 oneplan 前缀返回 null。 */
export function oneplanFallbackName(templateId: string): string | null {
  const parsed = parseOneplanTemplateId(templateId);
  if (!parsed) return null;
  return parsed.slug.replace(/-/g, ' ').trim() || parsed.slug;
}

/* ---------------- 模型输入 schema（无 id 字段；服务端生成） ---------------- */

const colorOptional = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(s => s.toLowerCase()).optional();

const planPointInput = z.strictObject({ x: z.number().min(-5000).max(5000), y: z.number().min(-5000).max(5000) });

export const planZoneInputSchema = z.strictObject({
  semantic: z.enum(planZoneSemantics),
  name: z.string().min(1).max(60),
  polygon: z.array(planPointInput).min(3).max(64),
  color: colorOptional,
  opacity: z.number().min(0).max(1).optional(),
  notes: z.string().max(500).default(''),
});

export const planFacilityInputSchema = z.strictObject({
  templateId: z.string().min(1).max(64),
  name: z.string().min(1).max(60).optional(),
  position: planPointInput,
  rotationDeg: z.number().min(-360).max(360).optional(),
  zoneId: uuid.optional(),
  color: colorOptional,
  notes: z.string().max(500).default(''),
});

export const planWorkerInputSchema = z.strictObject({
  role: z.string().min(1).max(60),
  count: z.number().int().min(1).max(9999),
  position: planPointInput,
  zoneId: uuid.optional(),
  color: colorOptional,
  notes: z.string().max(500).default(''),
});

export const planNodeInputSchema = z.strictObject({
  kind: z.enum(['entry', 'exit', 'both']),
  name: z.string().min(1).max(60),
  position: planPointInput,
  notes: z.string().max(500).default(''),
});

export const planRouteInputSchema = z.strictObject({
  kind: z.enum(planRouteKinds),
  name: z.string().min(1).max(60),
  points: z.array(planPointInput).min(2).max(128),
  oneWay: z.boolean().default(false),
  widthM: z.number().positive().max(30).optional(),
  startNodeId: uuid.optional(),
  endNodeId: uuid.optional(),
  notes: z.string().max(500).default(''),
});

export type PlanZoneInput = z.infer<typeof planZoneInputSchema>;
export type PlanFacilityInput = z.infer<typeof planFacilityInputSchema>;
export type PlanWorkerInput = z.infer<typeof planWorkerInputSchema>;
export type PlanNodeInput = z.infer<typeof planNodeInputSchema>;
export type PlanRouteInput = z.infer<typeof planRouteInputSchema>;

/* ---------------- 工作副本 ---------------- */

/** 一份空起步户外草稿（未画边界、无实体）。 */
export function createStarterOutdoorPlan(): SitePlanData {
  return sitePlanDataSchema.parse({
    schemaVersion: 1,
    boundary: [],
    zones: [],
    facilities: [],
    routes: [],
    nodes: [],
    workers: [],
  });
}

export interface PlanDraftAdded {
  zoneIds: string[];
  facilityIds: string[];
  routeIds: string[];
  nodeIds: string[];
  workerIds: string[];
}

export const emptyAdded = (): PlanDraftAdded => ({ zoneIds: [], facilityIds: [], routeIds: [], nodeIds: [], workerIds: [] });

export interface PlanDraftResult {
  draft: SitePlanData;
  added: PlanDraftAdded;
  warnings: { code: string; ids: string[] }[];
}

type UuidGen = () => string;

function ringDegenerate(ring: readonly { x: number; y: number }[]): boolean {
  if (ring.length < 3) return true;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!;
    const b = ring[i]!;
    if (a.x === b.x && a.y === b.y) return true;
  }
  return planRingSelfIntersects(ring);
}

/** 分区是否落在场地边界内（边界未画时不判越界）。 */
function zoneInsideBoundary(polygon: readonly { x: number; y: number }[], boundary: readonly { x: number; y: number }[]): boolean {
  if (boundary.length < 3) return true;
  return polygon.every(pt => planPointInRing(pt, boundary));
}

/** 设施占地四角（米制 ENU 旋转矩形），与前端设施渲染同旋转口径。 */
function facilityFootprint(position: { x: number; y: number }, rotationDeg: number, size: { width: number; depth: number }) {
  const theta = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const hw = size.width / 2;
  const hd = size.depth / 2;
  const local: readonly [number, number][] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  return local.map(([lx, ly]) => ({ x: position.x + lx * cos - ly * sin, y: position.y + lx * sin + ly * cos }));
}

/** 追加分区批次；校验语义/环退化/悬空之外的分区重叠与越界，越界放行并出 warning。 */
export function addPlanZones(draft: SitePlanData, inputs: PlanZoneInput[], gen: UuidGen): PlanDraftResult {
  const added = emptyAdded();
  const warnings: { code: string; ids: string[] }[] = [];
  const zones = draft.zones.map(z => ({ ...z }));
  const boundary = draft.boundary;
  for (const input of inputs) {
    if (ringDegenerate(input.polygon)) {
      warnings.push({ code: 'ZONE_DEGENERATE', ids: [input.name] });
      continue;
    }
    const id = gen();
    const overlaps = zones.some(existing => planRingsOverlap(input.polygon, existing.polygon));
    if (overlaps) warnings.push({ code: 'ZONES_OVERLAP', ids: [id] });
    if (!zoneInsideBoundary(input.polygon, boundary)) warnings.push({ code: 'ZONE_OUT_OF_BOUNDARY', ids: [id] });
    zones.push(planZoneSchema.parse({
      id, semantic: input.semantic, name: input.name, polygon: input.polygon,
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.opacity !== undefined ? { opacity: input.opacity } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    }));
    added.zoneIds.push(id);
  }
  return { draft: { ...draft, zones }, added, warnings };
}

/** 追加设施批次；模板白名单、悬空 zoneId、越界提示。尺寸取自模板。 */
export function addPlanFacilities(draft: SitePlanData, inputs: PlanFacilityInput[], gen: UuidGen): PlanDraftResult {
  const added = emptyAdded();
  const warnings: { code: string; ids: string[] }[] = [];
  const facilities = draft.facilities.map(f => ({ ...f }));
  const zoneIds = new Set(draft.zones.map(z => z.id.toLowerCase()));
  const boundary = draft.boundary;
  for (const input of inputs) {
    if (!isAllowedFacilityTemplate(input.templateId)) {
      warnings.push({ code: 'UNKNOWN_TEMPLATE', ids: [input.templateId] });
      continue;
    }
    if (input.zoneId && !zoneIds.has(input.zoneId.toLowerCase())) {
      warnings.push({ code: 'UNKNOWN_ZONE', ids: [input.zoneId] });
      continue;
    }
    const builtin = findFacilityTemplate(input.templateId);
    const id = gen();
    const rotationDeg = input.rotationDeg ?? 0;
    const size = facilityTemplateSize(input.templateId);
    const footprint = facilityFootprint(input.position, rotationDeg, size);
    if (boundary.length >= 3 && !footprint.every(pt => planPointInRing(pt, boundary))) {
      warnings.push({ code: 'FACILITY_OUT_OF_BOUNDARY', ids: [id] });
    }
    const sameTemplate = facilities.filter(f => f.templateId === input.templateId).length;
    const baseName = builtin?.name ?? oneplanFallbackName(input.templateId) ?? '物件';
    facilities.push(planFacilitySchemaParse({
      id, templateId: input.templateId,
      name: input.name ?? `${baseName} ${sameTemplate + 1}`,
      position: input.position, rotationDeg, size,
      ...(input.zoneId !== undefined ? { zoneId: input.zoneId } : {}),
      ...(input.color !== undefined ? { color: input.color } : { ...(builtin?.color !== undefined ? { color: builtin.color } : {}) }),
      notes: input.notes,
    }));
    added.facilityIds.push(id);
  }
  return { draft: { ...draft, facilities }, added, warnings };
}

/** 追加人员点位批次；悬空 zoneId 提示。 */
export function addPlanWorkers(draft: SitePlanData, inputs: PlanWorkerInput[], gen: UuidGen): PlanDraftResult {
  const added = emptyAdded();
  const warnings: { code: string; ids: string[] }[] = [];
  const workers = draft.workers.map(w => ({ ...w }));
  const zoneIds = new Set(draft.zones.map(z => z.id.toLowerCase()));
  for (const input of inputs) {
    if (input.zoneId && !zoneIds.has(input.zoneId.toLowerCase())) {
      warnings.push({ code: 'UNKNOWN_ZONE', ids: [input.zoneId] });
      continue;
    }
    const id = gen();
    workers.push(planWorkerSchema.parse({
      id, role: input.role, count: input.count, position: input.position,
      ...(input.zoneId !== undefined ? { zoneId: input.zoneId } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      notes: input.notes,
    }));
    added.workerIds.push(id);
  }
  return { draft: { ...draft, workers }, added, warnings };
}

/** 追加节点 + 动线批次；节点引用在「既有节点 + 本批新节点」范围内解析。 */
export function addPlanRoutes(draft: SitePlanData, nodeInputs: PlanNodeInput[], routeInputs: PlanRouteInput[], gen: UuidGen): PlanDraftResult {
  const added = emptyAdded();
  const warnings: { code: string; ids: string[] }[] = [];
  const nodes = draft.nodes.map(n => ({ ...n }));
  const routes = draft.routes.map(r => ({ ...r }));
  for (const input of nodeInputs) {
    const id = gen();
    nodes.push(planNodeSchema.parse({ id, kind: input.kind, name: input.name, position: input.position, notes: input.notes }));
    added.nodeIds.push(id);
  }
  const nodeIds = new Set(nodes.map(n => n.id.toLowerCase()));
  for (const input of routeInputs) {
    const dangling = [input.startNodeId, input.endNodeId].filter((ref): ref is string => !!ref && !nodeIds.has(ref.toLowerCase()));
    if (dangling.length) {
      warnings.push({ code: 'UNKNOWN_NODE', ids: dangling });
      continue;
    }
    if (input.points.length >= 2) {
      for (let i = 1; i < input.points.length; i++) {
        if (input.points[i]!.x === input.points[i - 1]!.x && input.points[i]!.y === input.points[i - 1]!.y) {
          warnings.push({ code: 'ROUTE_DUPLICATE_VERTEX', ids: [input.name] });
        }
      }
    }
    const id = gen();
    routes.push(planRouteSchema.parse({
      id, kind: input.kind, name: input.name, points: input.points, oneWay: input.oneWay,
      ...(input.widthM !== undefined ? { widthM: input.widthM } : {}),
      ...(input.startNodeId !== undefined ? { startNodeId: input.startNodeId } : {}),
      ...(input.endNodeId !== undefined ? { endNodeId: input.endNodeId } : {}),
      notes: input.notes,
    }));
    added.routeIds.push(id);
  }
  return { draft: { ...draft, nodes, routes }, added, warnings };
}

/* 设施实例装配：planFacilitySchema 直解析（size 已由模板给定）。 */
function planFacilitySchemaParse(facility: Parameters<typeof planFacilitySchema.parse>[0]) {
  return planFacilitySchema.parse(facility);
}

/** 校验覆盖范围固定清单：只声明未核验项，不冒充通过。 */
export const planCandidateUncovered = [
  { id: 'exit', status: 'unknown' as const, note: '出入口位置和状态需依据现场资料核对。' },
  { id: 'egress', status: 'unknown' as const, note: '未证明从各处到出口的连续路径、净宽或疏散能力。' },
  { id: 'accessibility', status: 'unknown' as const, note: '未验证无障碍路线、转弯及会车空间。' },
  { id: 'fire', status: 'unknown' as const, note: '未进行消防检查或规范适用性核验。' },
  { id: 'capacity', status: 'unknown' as const, note: '未核对场地核定人数或实际人员容量。' },
  { id: 'anchor', status: 'unknown' as const, note: '无地理锚点时坐标仅为局部米制，不产出经纬度。' },
];

/** 候选信封：与 SceneV2 proposal 平级的并列结构。 */
export const agentPlanCandidateSchema = z.strictObject({
  kind: z.literal('plan'),
  plan: sitePlanDataSchema,
  anchor: planAnchorSchema.nullable().optional(),
  added: z.strictObject({
    zoneIds: z.array(uuid).max(200),
    facilityIds: z.array(uuid).max(2000),
    routeIds: z.array(uuid).max(200),
    nodeIds: z.array(uuid).max(100),
    workerIds: z.array(uuid).max(500),
  }),
  warnings: z.array(z.strictObject({ code: z.string(), ids: z.array(z.string()) })),
  explanation: z.string().min(1).max(1200),
  notice: z.literal(AGENT_PLAN_OBSERVATION_NOTICE),
});
export type AgentPlanCandidate = z.infer<typeof agentPlanCandidateSchema>;

export function buildPlanCandidate(
  draft: SitePlanData,
  added: PlanDraftAdded,
  explanation: string,
  warnings: { code: string; ids: string[] }[],
  anchor: PlanAnchor | null | undefined,
): AgentPlanCandidate {
  return agentPlanCandidateSchema.parse({
    kind: 'plan',
    plan: draft,
    ...(anchor !== undefined ? { anchor } : {}),
    added,
    warnings,
    explanation,
    notice: AGENT_PLAN_OBSERVATION_NOTICE,
  });
}
