/**
 * 户外方案「定位」的共用判定（2026-11-20 审计 B7 / F6）。
 *
 * 背景：清单行与问题条目都能「点一下飞过去」。原来两条路径都直接拿 id 去选中、拿锚点去
 * `centerViewOn`，谁也不校验对象是否还在方案里：
 *  - 问题条目在实体已删除/撤销掉时仍会飞走并显示「已定位」，画布上没有任何东西被选中；
 *  - 缺锚点时四处回落 `{ x: 0, y: 0 }`，于是飞到场地原点，看起来像「定位错了」；
 *  - Agent 侧通过 `getSelectedIds()` 拿到的可能是悬空 id。
 *
 * 这一层只回答三件事，不做视图操作、不读 DOM：
 *  1. 这个实体还在不在方案里（按类型分集合查）；
 *  2. 一组 id 里哪些还能用（给 Agent/外部调用方过滤悬空选中）；
 *  3. 这次定位能不能飞：对象在不在 → 锚点有没有。
 */

import type { PlanPoint, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/** 可定位的实体类型（与清单 `PlanInventoryKind` 同名，少一个「车辆」以外的差异项）。 */
export type PlanLocateKind = 'zone' | 'facility' | 'route' | 'node' | 'worker' | 'vehicle' | 'measurement' | 'annotation';

export interface PlanLocateRequest {
  /** 关联实体类型；缺省表示这条记录不指向具体实体（例如冲突规则只给锚点）。 */
  kind?: PlanLocateKind | null;
  /** 关联实体 id。 */
  id?: string | null;
  /** 已知锚点（米制 ENU）。null/undefined = 没算出来，不能拿它飞视图。 */
  anchor?: PlanPoint | null;
}

export type PlanLocateResult =
  | { status: 'ok'; anchor: PlanPoint }
  | { status: 'missing'; message: string }
  | { status: 'unknown-anchor'; message: string };

function idsOf(plan: SitePlanData, kind: PlanLocateKind): readonly { id: string }[] {
  switch (kind) {
    case 'zone': return plan.zones;
    case 'facility': return plan.facilities;
    case 'route': return plan.routes;
    case 'node': return plan.nodes;
    case 'worker': return plan.workers;
    case 'vehicle': return plan.vehicles ?? [];
    case 'measurement': return plan.measurements ?? [];
    case 'annotation': return plan.annotations ?? [];
    default: return [];
  }
}

/** 实体是否仍在这份方案里（按类型查对应集合）。 */
export function planEntityExists(plan: SitePlanData, kind: PlanLocateKind, id: string): boolean {
  if (!id) return false;
  return idsOf(plan, kind).some(entity => entity.id === id);
}

/**
 * 不知道类型时按全部集合查一遍。
 * 用于选中药（`getSelectedIds`）这种只有 id 的入口：宁可少给 Agent 一个悬空 id，
 * 也不要把「已删除」当成「还选着」。
 */
export function planContainsEntityId(plan: SitePlanData, id: string): boolean {
  if (!id) return false;
  const kinds: PlanLocateKind[] = ['zone', 'facility', 'route', 'node', 'worker', 'vehicle', 'measurement', 'annotation'];
  return kinds.some(kind => idsOf(plan, kind).some(entity => entity.id === id));
}

/** 过滤掉方案里已不存在的 id，并去重（保持入参顺序）。 */
export function keepPlanEntityIds(plan: SitePlanData, ids: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (planContainsEntityId(plan, id)) kept.push(id);
  }
  return kept;
}

/** 文案与画布提示同源：删掉的对象、算不出锚点的记录各一句。 */
export const PLAN_LOCATE_MISSING_TEXT = '该对象已被删除，已跳过定位。';
export const PLAN_LOCATE_NO_ANCHOR_TEXT = '这条记录没有可定位的位置（对象可能在其他楼层）。';

/**
 * 定位请求 → 能不能飞、飞哪里。
 * 顺序固定：先确认对象还在（缺失就别飞，也别谎报「已定位」），再看锚点是否存在。
 */
export function resolvePlanLocate(plan: SitePlanData, request: PlanLocateRequest): PlanLocateResult {
  if (request.kind && request.id && !planEntityExists(plan, request.kind, request.id)) {
    return { status: 'missing', message: PLAN_LOCATE_MISSING_TEXT };
  }
  const anchor = request.anchor;
  if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
    return { status: 'unknown-anchor', message: PLAN_LOCATE_NO_ANCHOR_TEXT };
  }
  return { status: 'ok', anchor };
}
