/**
 * 户外 2D 规划「图层」（Level）纯函数层（2026-11-11 用户拍板）。
 *
 * Level = 同一场地下的自定义独立「画布/设计方案」，不是楼层高度：
 * 一套方案一张画布，实体各归各层；场地边界与锚点跨图层共享。
 *
 * 数据口径（与契约 site-plan.ts 对齐）：
 * - `plan.levels` 可选：旧数据没有该字段——读取侧合成单个默认层「图层 1」，不落盘；
 * - 实体的 `levelId` 可选：缺省归第一层（于是旧实体天然全在默认层）；
 * - 新增实体只在前一层之外才显式盖 levelId（缺省即第一层，保持旧数据形态）。
 *
 * 组件只接线：本层不碰画布/DOM。
 */

import type { PlanLevel, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/** 合成默认层的稳定 id（旧数据无 levels 时用；不写入 plan，只作读取键）。 */
export const DEFAULT_PLAN_LEVEL_ID = '00000000-0000-4000-8000-000000000000';
/** 图层上限（与契约 levels max 一致）。 */
export const PLAN_LEVEL_MAX = 20;

export type PlanLevelResult<T> = { ok: true; value: T } | { ok: false; issue: { code: string; message: string } };

/** 图层清单：plan.levels 缺省时合成单个默认层（不落盘）。 */
export function planLevels(plan: SitePlanData): PlanLevel[] {
  if (plan.levels && plan.levels.length > 0) return plan.levels;
  return [{ id: DEFAULT_PLAN_LEVEL_ID, name: '图层 1' }];
}

/** 实体归属层：缺 levelId 的旧实体归第一层。 */
export function entityLevelId(plan: SitePlanData, entity: { levelId?: string | undefined }): string {
  return entity.levelId ?? planLevels(plan)[0]!.id;
}

/**
 * 某图层的过滤视图：只含该层实体；边界/锚点/图层清单原样保留（跨层共享）。
 * levelId 缺省/空 → 第一层。返回的是视图不是新真源——提交改动请基于完整 plan。
 */
export function filterPlanByLevel(plan: SitePlanData, levelId?: string | null): SitePlanData {
  const target = levelId ?? planLevels(plan)[0]!.id;
  const belongs = (entity: { levelId?: string | undefined }) => entityLevelId(plan, entity) === target;
  return {
    ...plan,
    zones: plan.zones.filter(belongs),
    facilities: plan.facilities.filter(belongs),
    routes: plan.routes.filter(belongs),
    nodes: plan.nodes.filter(belongs),
    workers: plan.workers.filter(belongs),
    measurements: (plan.measurements ?? []).filter(belongs),
    // 2026-11-11 用户指令：自由标注同样按图层过滤。
    annotations: (plan.annotations ?? []).filter(belongs),
  };
}

/** 「图层 N」自动命名：取当前未占用的最小编号（删过层也不撞名）。 */
export function nextPlanLevelName(plan: SitePlanData): string {
  const used = new Set(planLevels(plan).map(level => level.name));
  let n = 1;
  while (used.has(`图层 ${n}`)) n += 1;
  return `图层 ${n}`;
}

/**
 * 新建图层（返回完整新 plan，由调用方 commitPlan 进 undo 栈）。
 * 旧数据没有 levels 字段时，先把合成默认层一并落盘——否则第一层的实体（无 levelId）归不到它名下。
 */
export function addPlanLevel(
  plan: SitePlanData,
  name?: string,
  id: string = crypto.randomUUID(),
): PlanLevelResult<{ plan: SitePlanData; level: PlanLevel }> {
  const levels = planLevels(plan);
  if (levels.length >= PLAN_LEVEL_MAX) {
    return { ok: false, issue: { code: 'level-max', message: `图层最多 ${PLAN_LEVEL_MAX} 个，先删掉不用的。` } };
  }
  const trimmed = name?.trim();
  const level: PlanLevel = { id, name: trimmed && trimmed.length > 0 ? trimmed.slice(0, 60) : nextPlanLevelName(plan) };
  const persisted = plan.levels && plan.levels.length > 0 ? plan.levels : levels;
  return { ok: true, value: { plan: { ...plan, levels: [...persisted, level] }, level } };
}

/** 重命名图层；改的是合成默认层时先把它落盘（理由同 addPlanLevel）。 */
export function renamePlanLevel(plan: SitePlanData, levelId: string, name: string): PlanLevelResult<SitePlanData> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, issue: { code: 'level-name-empty', message: '图层名不能为空。' } };
  if (trimmed.length > 60) return { ok: false, issue: { code: 'level-name-long', message: '图层名最长 60 字。' } };
  const levels = planLevels(plan);
  if (!levels.some(level => level.id === levelId)) {
    return { ok: false, issue: { code: 'level-missing', message: '图层不存在，可能已被撤销。' } };
  }
  const persisted = plan.levels && plan.levels.length > 0 ? plan.levels : levels;
  return { ok: true, value: { ...plan, levels: persisted.map(level => (level.id === levelId ? { ...level, name: trimmed } : level)) } };
}

/**
 * 删除图层：连同该层全部实体一起删（图层是独立设计，删层即删这套方案）。
 * 至少保留一层；缺 levelId 的实体归第一层，删第一层会把它们一并清掉。
 */
export function deletePlanLevel(plan: SitePlanData, levelId: string): PlanLevelResult<SitePlanData> {
  const levels = planLevels(plan);
  if (levels.length <= 1) return { ok: false, issue: { code: 'level-last', message: '至少保留一个图层。' } };
  const target = levels.find(level => level.id === levelId);
  if (!target) return { ok: false, issue: { code: 'level-missing', message: '图层不存在，可能已被撤销。' } };
  const persisted = plan.levels && plan.levels.length > 0 ? plan.levels : levels;
  const keep = (entity: { levelId?: string | undefined }) => entityLevelId(plan, entity) !== levelId;
  return {
    ok: true,
    value: {
      ...plan,
      levels: persisted.filter(level => level.id !== levelId),
      zones: plan.zones.filter(keep),
      facilities: plan.facilities.filter(keep),
      routes: plan.routes.filter(keep),
      nodes: plan.nodes.filter(keep),
      workers: plan.workers.filter(keep),
      measurements: (plan.measurements ?? []).filter(keep),
      // 2026-11-11 用户指令：删图层连同该层自由标注一起删。
      annotations: (plan.annotations ?? []).filter(keep),
    },
  };
}
