/**
 * 户外 planCandidate 确认装配（#46-1b 前端确认回路纯函数层）。
 *
 * 口径：
 * - 只在用户确认后调用；候选仍是待核验快照，不产出消防/容量/通行核定结论。
 * - 实体经画布既有 buildZone / buildFacility / buildWorker / buildRoute 入口重建，
 *   不绕过 schema 直接拼 JSON；节点没有独立工厂，按候选快照原样并入。
 * - 快照过期（planHash 不一致）或锚点漂移时阻断装配，提示重开对话；不把旧方案盖到新平面上。
 * - 本模块不读写 localStorage，落盘由调用方经 outdoor-project-store 完成。
 */
import type { AgentPlanCandidate } from '../../../../supabase/functions/_shared/plan-candidate';
import type { PlanAnchor, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import { buildZone } from './site-plan-editing';
import { buildFacility } from './site-plan-facilities';
import { buildRoute, buildWorker } from './site-plan-routes';

export interface PlanCandidateConsistency {
  /** 发起 run 时刻冻结快照的锚点（planObservation.anchor）。 */
  snapshotAnchor?: PlanAnchor | null;
  /** 当前户外平面的锚点。 */
  currentAnchor?: PlanAnchor | null;
  /** 发起 run 时刻快照指纹（planObservation.planHash）；不可用时省略。 */
  snapshotPlanHash?: string;
  /** 当前平面指纹；不可用时省略。 */
  currentPlanHash?: string;
}

export interface PlanCandidateApplyIssue {
  code: 'stale-plan-hash' | 'anchor-mismatch' | 'missing-entity' | 'assembly-failed';
  message: string;
  ids?: string[];
}

export type ApplyPlanCandidateResult =
  | { ok: true; plan: SitePlanData; applied: string[] }
  | { ok: false; issue: PlanCandidateApplyIssue };

function anchorsEqual(a: PlanAnchor | null | undefined, b: PlanAnchor | null | undefined): boolean {
  if (a == null || b == null) return true; // 任一侧无锚点：不按锚点阻断（edge 无 anchor 不产经纬度）。
  return a.lng === b.lng && a.lat === b.lat && a.crs === b.crs;
}

function pickById<T extends { id: string }>(items: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(items.map(item => [item.id, item]));
  return ids.map(id => byId.get(id)).filter((item): item is T => item !== undefined);
}

/** 一致性对账：锚点与（两侧都有的）planHash 必须一致，否则快照已过期。 */
export function checkCandidateConsistency(consistency: PlanCandidateConsistency): PlanCandidateApplyIssue | null {
  if (!anchorsEqual(consistency.snapshotAnchor, consistency.currentAnchor)) {
    return { code: 'anchor-mismatch', message: '场地锚点已变化，该方案基于旧选址快照，请重新发起对话。' };
  }
  if (consistency.snapshotPlanHash && consistency.currentPlanHash
    && consistency.snapshotPlanHash !== consistency.currentPlanHash) {
    return { code: 'stale-plan-hash', message: '平面在方案生成后已被修改，请重新发起对话以获取最新方案。' };
  }
  return null;
}

/**
 * 把候选 added 实体装配进当前平面。返回合并后的新 plan 与实际落入的实体 id；
 * 已在当前平面存在的 id 跳过（不重复摆放）。任一实体工厂拒绝时整体阻断，不留半成品。
 */
export function applyPlanCandidate(
  current: SitePlanData,
  candidate: AgentPlanCandidate,
  consistency: PlanCandidateConsistency,
): ApplyPlanCandidateResult {
  const consistencyIssue = checkCandidateConsistency(consistency);
  if (consistencyIssue) return { ok: false, issue: consistencyIssue };

  const plan = candidate.plan;
  const existingIds = new Set([
    ...current.zones.map(z => z.id),
    ...current.facilities.map(f => f.id),
    ...current.workers.map(w => w.id),
    ...current.routes.map(r => r.id),
    ...current.nodes.map(n => n.id),
  ]);

  const zones = [...current.zones];
  const facilities = [...current.facilities];
  const workers = [...current.workers];
  const routes = [...current.routes];
  const nodes = [...current.nodes];
  const applied: string[] = [];
  const missing: string[] = [];

  for (const zone of pickById(plan.zones, candidate.added.zoneIds)) {
    if (existingIds.has(zone.id)) continue;
    const built = buildZone({
      id: zone.id, semantic: zone.semantic, name: zone.name, polygon: zone.polygon,
      ...(zone.color !== undefined ? { color: zone.color } : {}),
      ...(zone.opacity !== undefined ? { opacity: zone.opacity } : {}),
      notes: zone.notes,
    }, current.boundary, current.zones);
    if (!built.ok) return { ok: false, issue: { code: 'assembly-failed', message: built.issue.message, ids: [zone.id] } };
    zones.push(built.value);
    applied.push(zone.id);
  }

  for (const facility of pickById(plan.facilities, candidate.added.facilityIds)) {
    if (existingIds.has(facility.id)) continue;
    const template = {
      templateId: facility.templateId, name: facility.name,
      width: facility.size.width, depth: facility.size.depth, note: facility.notes,
      ...(facility.color !== undefined ? { color: facility.color } : {}),
    };
    const built = buildFacility({
      id: facility.id, templateId: facility.templateId, position: facility.position,
      rotationDeg: facility.rotationDeg, name: facility.name,
      ...(facility.zoneId !== undefined ? { zoneId: facility.zoneId } : {}),
      ...(facility.color !== undefined ? { color: facility.color } : {}),
      notes: facility.notes, template,
    }, current.boundary, current.facilities);
    if (!built.ok) return { ok: false, issue: { code: 'assembly-failed', message: built.issue.message, ids: [facility.id] } };
    facilities.push(built.value);
    applied.push(facility.id);
  }

  for (const worker of pickById(plan.workers, candidate.added.workerIds)) {
    if (existingIds.has(worker.id)) continue;
    const built = buildWorker({
      id: worker.id, role: worker.role, count: worker.count, position: worker.position,
      ...(worker.zoneId !== undefined ? { zoneId: worker.zoneId } : {}),
      ...(worker.color !== undefined ? { color: worker.color } : {}),
      notes: worker.notes,
    }, current.boundary, current.zones);
    if (!built.ok) return { ok: false, issue: { code: 'assembly-failed', message: built.issue.message, ids: [worker.id] } };
    workers.push(built.value);
    applied.push(worker.id);
  }

  for (const route of pickById(plan.routes, candidate.added.routeIds)) {
    if (existingIds.has(route.id)) continue;
    const built = buildRoute({
      id: route.id, kind: route.kind, name: route.name, points: route.points, oneWay: route.oneWay,
      ...(route.widthM !== undefined ? { widthM: route.widthM } : {}),
      ...(route.startNodeId !== undefined ? { startNodeId: route.startNodeId } : {}),
      ...(route.endNodeId !== undefined ? { endNodeId: route.endNodeId } : {}),
      notes: route.notes,
    }, nodes);
    if (!built.ok) return { ok: false, issue: { code: 'assembly-failed', message: built.issue.message, ids: [route.id] } };
    routes.push(built.value);
    applied.push(route.id);
  }

  for (const node of pickById(plan.nodes, candidate.added.nodeIds)) {
    if (existingIds.has(node.id)) continue;
    nodes.push(node);
    applied.push(node.id);
  }

  // 校验：added 清单里有实体在候选 plan 中找不到 → 数据不一致，阻断。
  const expected = [...candidate.added.zoneIds, ...candidate.added.facilityIds, ...candidate.added.workerIds, ...candidate.added.routeIds, ...candidate.added.nodeIds];
  for (const id of expected) {
    if (!existingIds.has(id) && !applied.includes(id)) missing.push(id);
  }
  if (missing.length > 0) return { ok: false, issue: { code: 'missing-entity', message: '候选清单引用了平面中不存在的实体，未应用。', ids: missing } };

  return {
    ok: true,
    plan: { ...current, zones, facilities, workers, routes, nodes },
    applied,
  };
}
