/**
 * S4 C-1：plan facilities（PlanFacility）→ 只读展示口径纯函数层。
 *
 * 设计红线：
 * - 纯函数、不可变；不接 React、不读 store/context、不调网络、不碰 legacy 三链；
 * - 类型只复用 `site-plan.ts` 既有 `PlanFacility`，不自造 wire schema；
 * - plan facilities 已不含 legacy 结构标记件，本层不再过滤结构标记；
 * - 只做展示投影（计数 / 评审主体 / 清单行），不补规格、不编尺寸、不参与试算。
 */

import { planRingAreaM2, type PlanFacility, type SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import { UNNAMED_MATERIAL } from './proposal-change-groups';
import { materialCount } from './structural-layout';
import type { FurnitureItem } from './types';

/** 评审卡主体：钉挂回的物件 id 与展示名。 */
export interface PlanFacilitySubject {
  id: string;
  name: string;
}

/** 执行清单一行：按名折叠后的件数与锁定件数。 */
export interface PlanFacilityInventoryRow {
  name: string;
  quantity: number;
  lockedCount: number;
}

/** 展示名：裁剪空白；空名兜底与 legacy 清单口径同一句 `UNNAMED_MATERIAL`，不另造文案。 */
function displayName(facility: PlanFacility): string {
  const trimmed = facility.name.trim();
  return trimmed || UNNAMED_MATERIAL;
}

/** plan facility 件数；plan 侧不混结构标记件，返回数组长度即可。 */
export function planFacilityCount(facilities: readonly PlanFacility[]): number {
  return facilities.length;
}

/** 当前计数双读回落入参：bound plan 或 legacy 草稿候选件。 */
export interface CurrentMaterialCountInput {
  plan: SitePlanData | null;
  legacyItems: readonly FurnitureItem[];
}

/**
 * 当前物料计数（上限守卫 / 件数显示共用读点）：
 * bound 态读 `plan.facilities` 长度；legacy 草稿态回落 `materialCount(legacyItems)`
 * （过滤结构标记件）。纯同步、不接 React/store/网络；入参不被修改。
 * 进入件数（extra / built / 风格套候选等）仍由调用方按原口径另计，不在本函数内。
 */
export function currentMaterialCount(input: CurrentMaterialCountInput): number {
  return input.plan ? planFacilityCount(input.plan.facilities) : materialCount(input.legacyItems);
}

/** 按数组顺序映射评审主体；名字裁剪空白，空名兜底同上。 */
export function facilitySubjects(facilities: readonly PlanFacility[]): readonly PlanFacilitySubject[] {
  return facilities.map(facility => ({ id: facility.id, name: displayName(facility) }));
}

/**
 * 清单行：按裁剪后 name 折叠，首见顺序保留；quantity = 件数；
 * lockedCount = `locked === true` 的件数；locked 缺省 / 非 true 按 false 计。
 * 入参不被修改。
 */
export function facilityInventoryRows(
  facilities: readonly PlanFacility[],
): readonly PlanFacilityInventoryRow[] {
  const rows = new Map<string, PlanFacilityInventoryRow>();
  for (const facility of facilities) {
    const name = displayName(facility);
    const prior = rows.get(name);
    if (prior) {
      prior.quantity += 1;
      if (facility.locked === true) prior.lockedCount += 1;
      continue;
    }
    rows.set(name, {
      name,
      quantity: 1,
      lockedCount: facility.locked === true ? 1 : 0,
    });
  }
  return [...rows.values()];
}

/**
 * 场地边界面积（m²）：plan 未绑定，或边界空环 / 不足 3 点时返回 null，
 * 由调用方回落 legacy `venueArea(layout)`；合法环复用契约 `planRingAreaM2` 现算。
 * 入参不被修改；只做展示投影，不补默认外框。
 */
export function planBoundaryAreaM2(plan: SitePlanData | null): number | null {
  if (!plan || plan.boundary.length < 3) return null;
  return planRingAreaM2(plan.boundary);
}
