/**
 * 动线 / 出入口节点 / 人员编辑纯函数层（H2-d）。
 *
 * 口径（评审稿 §8 功能矩阵「入口、出口、流线」「人员布点」/ §9.1 步骤 6–7）：
 * - 三类动线（人行/车辆/后勤）有方向与用途；**出入口节点是动线的唯一端点来源**：
 *   移动节点后引用路线的端点坐标随动（movePlanNode）；反转方向（reverseRoute）
 *   交换起终点引用、保留 oneWay 语义；删除节点时剥离引用但保留路线几何
 *   （deletePlanNode），绝不留下悬空 nodeId（契约 superRefine 也会拒绝悬空引用）。
 * - 人员布点是设施清单旁的轻量图层：岗位、人数、点位、所属区（zoneId）；
 *   不传 zoneId 时按落点所在分区自动归属（inferWorkerZoneId）；落点越界放行 + 提示
 *   （与分区/设施同一「放行 + 提示」策略）；按区 / 按岗汇总均为纯函数现算，
 *   隐藏人员层只影响绘制，不影响汇总与设施统计。
 * - 几何全部在局部米制 ENU（x 东、y 北）上运算，契约坐标范围 ±5000 m；
 *   本层不产生新公式，距离/包含判定复用 site-plan-editing 的基础几何。
 */

import {
  type PlanNode,
  type PlanPoint,
  type PlanRoute,
  type PlanWorker,
  type SitePlanData,
} from '../../../../supabase/functions/_shared/site-plan';
import { laborRoleHasGender } from './labor-gender';
import {
  planPointDistanceM,
  planPointInRing,
  type PlanEditIssue,
  type PlanEditResult,
} from './site-plan-editing';

/** 契约平面点范围（±5000 m），与 site-plan planPointSchema 同源。 */
const PLAN_COORD_LIMIT_M = 5000;

/** 路线顶点上限：与契约 planRouteSchema.points.max 一致。 */
export const PLAN_ROUTE_MAX_VERTICES = 128;

/** 动线/节点/人员实体共用的编辑问题（code 语义见 PlanEditIssue）。 */
export type PlanRouteEditResult<T> = PlanEditResult<T>;

/* ---------------- 动线 ---------------- */

export interface BuildRouteInput {
  kind: PlanRoute['kind'];
  name: string;
  points: readonly PlanPoint[];
  oneWay?: boolean;
  widthM?: number;
  startNodeId?: string;
  endNodeId?: string;
  notes?: string;
  id?: string;
}

function pointInRange(pt: PlanPoint): boolean {
  return Number.isFinite(pt.x) && Number.isFinite(pt.y)
    && Math.abs(pt.x) <= PLAN_COORD_LIMIT_M && Math.abs(pt.y) <= PLAN_COORD_LIMIT_M;
}

function routeGeometryIssues(points: readonly PlanPoint[]): PlanEditIssue[] {
  const issues: PlanEditIssue[] = [];
  if (points.length < 2) {
    issues.push({ code: 'too-few-vertices', message: '动线至少要 2 个点（起点和终点）。' });
    return issues;
  }
  if (points.length > PLAN_ROUTE_MAX_VERTICES) {
    issues.push({ code: 'too-many-vertices', message: `动线顶点超过上限 ${PLAN_ROUTE_MAX_VERTICES} 个。` });
  }
  for (let i = 1; i < points.length; i++) {
    if (planPointDistanceM(points[i - 1]!, points[i]!) === 0) {
      issues.push({ code: 'duplicate-vertex', message: `动线第 ${i}、${i + 1} 点重合，先移动开再提交。`, at: points[i] });
      break;
    }
  }
  for (const pt of points) {
    if (!pointInRange(pt)) {
      issues.push({ code: 'out-of-range', message: '动线顶点超出场地坐标系 ±5000 m 范围。', at: pt });
      break;
    }
  }
  return issues;
}

function nodeReferenceIssues(input: Pick<BuildRouteInput, 'startNodeId' | 'endNodeId'>, nodes: readonly PlanNode[]): PlanEditIssue[] {
  const issues: PlanEditIssue[] = [];
  const nodeIds = new Set(nodes.map(n => n.id.toLowerCase()));
  if (input.startNodeId && !nodeIds.has(input.startNodeId.toLowerCase())) {
    issues.push({ code: 'unknown-node', message: '起点引用的出入口节点不存在。' });
  }
  if (input.endNodeId && !nodeIds.has(input.endNodeId.toLowerCase())) {
    issues.push({ code: 'unknown-node', message: '终点引用的出入口节点不存在。' });
  }
  return issues;
}

/**
 * 建立一条动线：几何（≥2 点、无相邻重合、范围内）与端点引用（节点存在）都合法才提交。
 * 调用方负责先把端点吸附到节点（吸附逻辑在画布交互层）。
 */
export function buildRoute(input: BuildRouteInput, nodes: readonly PlanNode[] = []): PlanRouteEditResult<PlanRoute> {
  const issues = [...routeGeometryIssues(input.points), ...nodeReferenceIssues(input, nodes)];
  if (issues.length > 0) return { ok: false, issue: issues[0]! };
  const route: PlanRoute = {
    id: input.id ?? crypto.randomUUID(),
    kind: input.kind,
    name: input.name,
    points: input.points.map(p => ({ x: p.x, y: p.y })),
    oneWay: input.oneWay ?? false,
    ...(input.widthM !== undefined ? { widthM: input.widthM } : {}),
    ...(input.startNodeId !== undefined ? { startNodeId: input.startNodeId } : {}),
    ...(input.endNodeId !== undefined ? { endNodeId: input.endNodeId } : {}),
    notes: input.notes ?? '',
  };
  return { ok: true, value: route };
}

/** 反转动线方向：点列倒序 + 起终点引用互换；oneWay 语义保留（方向由点列表达）。 */
export function reverseRoute(route: PlanRoute): PlanRoute {
  return {
    ...route,
    points: [...route.points].reverse(),
    startNodeId: route.endNodeId,
    endNodeId: route.startNodeId,
  };
}

/* ---------------- 出入口节点 ---------------- */

/** 按落点自动推断节点归属分区（第一个包含落点的分区；都不含返回 undefined）。口径与 inferWorkerZoneId 一致。 */
export function inferNodeZoneId(pt: PlanPoint, zones: readonly { id: string; polygon: readonly PlanPoint[] }[]): string | undefined {
  return zones.find(zone => zone.polygon.length >= 3 && planPointInRing(pt, zone.polygon))?.id;
}

export interface BuildNodeInput {
  kind: PlanNode['kind'];
  name?: string;
  position: PlanPoint;
  /** 不传时按落点自动归属分区（inferNodeZoneId）。 */
  zoneId?: string | undefined;
  levelId?: string | undefined;
  notes?: string;
  id?: string;
}

/**
 * 落一个出入口节点：类型/落点合法才提交；落点在边界外放行但随结果返回提示；
 * 自动归属按落点所在分区（显式 zoneId 优先且必须存在）。与 buildWorker 同一「放行 + 提示」策略。
 */
export function buildNode(
  input: BuildNodeInput,
  boundary: readonly PlanPoint[],
  zones: readonly { id: string; name: string; polygon: readonly PlanPoint[] }[] = [],
): PlanRouteEditResult<PlanNode> {
  if (!pointInRange(input.position)) {
    return { ok: false, issue: { code: 'out-of-range', message: '出入口节点超出场地坐标系 ±5000 m 范围。', at: input.position } };
  }
  const zoneId = input.zoneId ?? inferNodeZoneId(input.position, zones);
  if (zoneId && !zones.some(zone => zone.id === zoneId)) {
    return { ok: false, issue: { code: 'unknown-zone', message: '归属分区不存在。' } };
  }
  const issues: PlanEditIssue[] = [];
  if (boundary.length >= 3 && !planPointInRing(input.position, boundary)) {
    issues.push({ code: 'out-of-boundary', message: '出入口节点落在场地边界之外。', at: input.position });
  }
  const fallbackName = input.kind === 'exit' ? '出口' : input.kind === 'both' ? '出入口' : '入口';
  const name = (input.name ?? fallbackName).trim();
  if (name.length === 0) return { ok: false, issue: { code: 'unknown-zone', message: '节点名不能为空。' } };
  if (name.length > 60) return { ok: false, issue: { code: 'unknown-zone', message: '节点名过长（≤60 字）。' } };
  const node: PlanNode = {
    id: input.id ?? crypto.randomUUID(),
    kind: input.kind,
    name,
    position: { x: input.position.x, y: input.position.y },
    ...(zoneId !== undefined ? { zoneId } : {}),
    ...(input.levelId !== undefined ? { levelId: input.levelId } : {}),
    notes: input.notes ?? '',
  };
  return issues.length > 0 ? { ok: true, value: node, issues } : { ok: true, value: node };
}

export interface MoveNodeResult {
  node: PlanNode;
  /** 引用该节点的路线（端点坐标已随动到节点新位置）。 */
  routes: PlanRoute[];
}

/**
 * 移动出入口节点：引用它的路线端点坐标随动（评审稿「移动入口后引用路线随动」）。
 * 随动后若某条路线出现相邻重合（例如 2 点路线两端都引用同一节点）则拒绝并提示。
 */
export function movePlanNode(node: PlanNode, next: PlanPoint, routes: readonly PlanRoute[]): PlanRouteEditResult<MoveNodeResult> {
  if (!pointInRange(next)) {
    return { ok: false, issue: { code: 'out-of-range', message: '出入口节点超出场地坐标系 ±5000 m 范围。', at: next } };
  }
  const movedNode: PlanNode = { ...node, position: { x: next.x, y: next.y } };
  const movedRoutes = routes.map(route => {
    if (route.startNodeId !== node.id && route.endNodeId !== node.id) return route;
    const points = route.points.map((p, i) => {
      if (i === 0 && route.startNodeId === node.id) return { x: next.x, y: next.y };
      if (i === route.points.length - 1 && route.endNodeId === node.id) return { x: next.x, y: next.y };
      return p;
    });
    return { ...route, points };
  });
  for (const route of movedRoutes) {
    for (let i = 1; i < route.points.length; i++) {
      if (planPointDistanceM(route.points[i - 1]!, route.points[i]!) === 0) {
        return {
          ok: false,
          issue: { code: 'duplicate-vertex', message: `节点移动会让动线「${route.name}」两端重合，换个位置。`, at: next },
        };
      }
    }
  }
  return { ok: true, value: { node: movedNode, routes: movedRoutes } };
}

/**
 * 删除出入口节点对路线的影响：引用它的路线剥离 nodeId 引用（几何保留）。
 * 返回更新后的路线列表；节点本身由调用方从 plan.nodes 过滤。
 */
export function detachNodeFromRoutes(nodeId: string, routes: readonly PlanRoute[]): PlanRoute[] {
  return routes.map(route => {
    if (route.startNodeId !== nodeId && route.endNodeId !== nodeId) return route;
    const next: PlanRoute = { ...route };
    if (next.startNodeId === nodeId) delete next.startNodeId;
    if (next.endNodeId === nodeId) delete next.endNodeId;
    return next;
  });
}

/** 节点关联的路线（评审稿「出入口显示关联路线」）：起点引用 / 终点引用分列。 */
export function nodeRouteRefs(nodeId: string, routes: readonly PlanRoute[]): { startRoutes: PlanRoute[]; endRoutes: PlanRoute[] } {
  return {
    startRoutes: routes.filter(r => r.startNodeId === nodeId),
    endRoutes: routes.filter(r => r.endNodeId === nodeId),
  };
}

/* ---------------- 人员 ---------------- */

/** 按落点自动推断人员归属分区（第一个包含落点的分区；都不含返回 undefined）。 */
export function inferWorkerZoneId(pt: PlanPoint, zones: readonly { id: string; polygon: readonly PlanPoint[] }[]): string | undefined {
  return zones.find(zone => zone.polygon.length >= 3 && planPointInRing(pt, zone.polygon))?.id;
}

export interface BuildWorkerInput {
  role: string;
  count: number;
  position: PlanPoint;
  /** 不传时按落点自动归属分区（inferWorkerZoneId）。 */
  zoneId?: string | undefined;
  color?: string;
  /** 劳动力小人性别；自定义点不要传。 */
  gender?: 'male' | 'female';
  notes?: string;
  id?: string;
}

/**
 * 布一个人员点位：岗位/人数/落点合法才提交；落点在边界外放行但随结果返回提示；
 * 自动归属按落点所在分区（显式 zoneId 优先且必须存在）。
 */
export function buildWorker(
  input: BuildWorkerInput,
  boundary: readonly PlanPoint[],
  zones: readonly { id: string; name: string; polygon: readonly PlanPoint[] }[] = [],
): PlanRouteEditResult<PlanWorker> {
  const role = input.role.trim();
  if (role.length === 0) return { ok: false, issue: { code: 'unknown-zone', message: '岗位名不能为空。' } };
  if (role.length > 60) return { ok: false, issue: { code: 'unknown-zone', message: '岗位名过长（≤60 字）。' } };
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 9999) {
    return { ok: false, issue: { code: 'out-of-range', message: '人数要 1–9999 的整数。' } };
  }
  if (!pointInRange(input.position)) {
    return { ok: false, issue: { code: 'out-of-range', message: '人员点位超出场地坐标系 ±5000 m 范围。', at: input.position } };
  }
  const zoneId = input.zoneId ?? inferWorkerZoneId(input.position, zones);
  if (zoneId && !zones.some(zone => zone.id === zoneId)) {
    return { ok: false, issue: { code: 'unknown-zone', message: '归属分区不存在。' } };
  }
  const issues: PlanEditIssue[] = [];
  if (boundary.length >= 3 && !planPointInRing(input.position, boundary)) {
    issues.push({ code: 'out-of-boundary', message: '人员点位落在场地边界之外。', at: input.position });
  }
  const worker: PlanWorker = {
    id: input.id ?? crypto.randomUUID(),
    role,
    count: input.count,
    position: { x: input.position.x, y: input.position.y },
    ...(zoneId !== undefined ? { zoneId } : {}),
    ...(input.color !== undefined ? { color: input.color } : {}),
    ...(laborRoleHasGender(role) && input.gender !== undefined ? { gender: input.gender } : {}),
    notes: input.notes ?? '',
  };
  return issues.length > 0 ? { ok: true, value: worker, issues } : { ok: true, value: worker };
}

/* ---------------- 派生统计（现算，不落盘） ---------------- */

export interface WorkerZoneSummaryRow {
  /** null = 未归属任何分区。 */
  zoneId: string | null;
  zoneName: string;
  /** 区内人数总和。 */
  total: number;
  /** 区内点位数。 */
  posts: number;
}

/** 按区汇总人员：分区原序在前、未归属在末行。zones 只需 id/name（演示页与测试的简化分区即可用）。 */
export function workerZoneSummary(
  plan: { zones: readonly { id: string; name: string }[]; workers: readonly PlanWorker[] },
): WorkerZoneSummaryRow[] {
  const rows: WorkerZoneSummaryRow[] = plan.zones.map(zone => ({ zoneId: zone.id, zoneName: zone.name, total: 0, posts: 0 }));
  const byId = new Map(rows.map(row => [row.zoneId!, row]));
  const orphan: WorkerZoneSummaryRow = { zoneId: null, zoneName: '未归属分区', total: 0, posts: 0 };
  for (const worker of plan.workers) {
    const row = worker.zoneId ? byId.get(worker.zoneId) : undefined;
    const target = row ?? orphan;
    target.total += worker.count;
    target.posts += 1;
  }
  return orphan.posts > 0 ? [...rows, orphan] : rows;
}

export interface WorkerRoleSummaryRow {
  role: string;
  total: number;
  posts: number;
}

/** 按岗位汇总人员（评审稿验收：「东门 2 安保、装卸口 1 引导岗可汇总」）：按岗位首次出现顺序稳定。 */
export function workerRoleSummary(plan: Pick<SitePlanData, 'workers'>): WorkerRoleSummaryRow[] {
  const rows = new Map<string, WorkerRoleSummaryRow>();
  for (const worker of plan.workers) {
    const row = rows.get(worker.role) ?? { role: worker.role, total: 0, posts: 0 };
    row.total += worker.count;
    row.posts += 1;
    rows.set(worker.role, row);
  }
  return [...rows.values()];
}

/* ---------------- 全案问题清单（画布红点 / 面板提示） ---------------- */

export interface PlanNodeIssue {
  nodeId: string;
  nodeName: string;
  issue: PlanEditIssue;
}

/** 出入口节点问题：未被任何动线引用（未连接节点）。 */
export function planNodeIssues(plan: Pick<SitePlanData, 'nodes' | 'routes'>): PlanNodeIssue[] {
  const issues: PlanNodeIssue[] = [];
  for (const node of plan.nodes) {
    const refs = nodeRouteRefs(node.id, plan.routes);
    if (refs.startRoutes.length === 0 && refs.endRoutes.length === 0) {
      issues.push({ nodeId: node.id, nodeName: node.name, issue: { code: 'unconnected-node', message: '未连接任何动线。', at: node.position } });
    }
  }
  return issues;
}

export interface PlanWorkerIssue {
  workerId: string;
  workerRole: string;
  issue: PlanEditIssue;
}

/** 人员点位问题：落在场地边界外（放行 + 提示口径）。 */
export function planWorkerIssues(plan: Pick<SitePlanData, 'boundary' | 'workers'>): PlanWorkerIssue[] {
  if (plan.boundary.length < 3) return [];
  const issues: PlanWorkerIssue[] = [];
  for (const worker of plan.workers) {
    if (!planPointInRing(worker.position, plan.boundary)) {
      issues.push({ workerId: worker.id, workerRole: worker.role, issue: { code: 'out-of-boundary', message: '点位在场地边界之外。', at: worker.position } });
    }
  }
  return issues;
}
