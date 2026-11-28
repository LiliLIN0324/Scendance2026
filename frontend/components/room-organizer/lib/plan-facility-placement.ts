/**
 * B-3a：plan 设施（PlanFacility）→ 试算层入参（ZoneFurniturePlacement）纯函数适配器。
 *
 * 设计红线：
 * - 纯函数、不可变；不接 React、不读 store/context、不调网络；
 * - 只做字段投影与两个世界之间的坐标/朝向换算，不补 icon/类目/高程，不编槽位；
 * - 契约外字段（groupId/locked/finish/notes/vendor 字段/unitPrice/modelOverride 等）不进 placement；
 * - 本片不接 React/store/网络，不改面板，不碰 legacy 三链与独占文件。
 *
 * 坐标约定（与 `plan-item-bridge.ts` 同一套，互为逆变换）：
 * - 壳体 / placement 世界：`x` 东、`z` 南，朝向弧度；
 * - 平面 plan 世界：`x` 东、`y` 北，朝向度（逆时针正）；
 * - 位置：`z = -y`（镜像 `planPointOfScene`：`y = -z`）；
 * - 朝向：`placement.rotation = -rotationDeg · π/180`
 *   （印证 bridge L152：`plan rotationDeg = -(item.rotation) · 180/π`）。
 *
 * follow-up（本片不做）：plan zone 是 polygon，而 `PlanAnnotation.geometry` 只支持
 * rect/polyline/measure/door；矩形外接近似会冒充精确边界，zone → PlanAnnotation 映射
 * 待几何口径定了再补，本片不拍脑袋近似。
 */

import type { PlanFacility } from '../../../../supabase/functions/_shared/site-plan';
import type { ZoneSemanticType } from '../../../lib/plan-annotation';
import type { ZoneFurniturePlacement } from '../../../lib/plan-approve';

/** 适配器选项：按件解析试算区类型；缺省回落 `reserved`（与 agent-annotation-review 既有口径一致）。 */
export interface FacilityPlacementOptions {
  zoneTypeFor?: (facility: PlanFacility) => ZoneSemanticType;
}

/** 被跳过的件：保留 id/name 与原因，便于调用方追溯，不静默丢。 */
export interface FacilityPlacementSkipped {
  id: string;
  name: string;
  reason: string;
}

/** 批量转换结果：placements 顺序与入参一致；skipped 逐条可追溯。 */
export interface FacilityPlacementOutcome {
  placements: ZoneFurniturePlacement[];
  skipped: FacilityPlacementSkipped[];
}

/** 抹掉 -0：负零会污染下游 `toBe(0)` / 序列化比较（与 bridge `zeroSafe` 同口径）。 */
function zeroSafe(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * 校验一件设施能否投影成试算入参；返回跳过原因，`null` = 可转换。
 * 位置必须是有限数；宽深必须为有限正数；朝向角必须有限（几何只消费 width/depth、x/z、rotation）。
 */
export function facilityPlacementSkipReason(facility: PlanFacility): string | null {
  const { position, size } = facility;
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return '位置缺失或坐标不是有限数，无法换算试算入参';
  }
  if (!Number.isFinite(facility.rotationDeg)) {
    return '朝向角不是有限数，无法换算试算入参';
  }
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.depth)
    || size.width <= 0 || size.depth <= 0) {
    return '宽深缺失或不是正数，几何无法参与碰撞判定';
  }
  return null;
}

/**
 * 单件投影：假设已通过 `facilityPlacementSkipReason` 校验（批量入口先过校验再调用）。
 *
 * 字段口径：
 * - `spec.type` 取 `templateId`；`category` / `icon` 试算层不消费，留空串不编造；
 * - `height` 取 `heightM`，缺省 0（纯平面件兜底，不冒充高程真值）；
 * - `tableShape` 仅 `shape === 'round'` 标 round，其余按矩形板画；
 * - `zoneId` 缺省空串；`zoneType` 由 `zoneTypeFor` 给值，缺省 `reserved`；
 * - 不设 `ownerTableId`（那是环椅挂主桌的链路字段，单件投影用不上）。
 */
export function facilityToPlacement(
  facility: PlanFacility,
  opts?: FacilityPlacementOptions,
): ZoneFurniturePlacement {
  const zoneType = opts?.zoneTypeFor?.(facility) ?? 'reserved';
  return {
    spec: {
      type: facility.templateId,
      name: facility.name,
      category: '',
      width: facility.size.width,
      depth: facility.size.depth,
      height: facility.heightM ?? 0,
      color: facility.color ?? '',
      icon: '',
      ...(facility.shape === 'round' ? { tableShape: 'round' as const } : {}),
    },
    x: zeroSafe(facility.position.x),
    z: zeroSafe(-facility.position.y),
    rotation: zeroSafe(-facility.rotationDeg * Math.PI / 180),
    zoneId: facility.zoneId ?? '',
    zoneType,
  };
}

/**
 * 批量投影：顺序保留；不合格件进 `skipped` 并写明原因，不静默丢弃。
 * 入分数组不被修改（不可变）。
 */
export function planFacilitiesToPlacements(
  facilities: readonly PlanFacility[],
  opts?: FacilityPlacementOptions,
): FacilityPlacementOutcome {
  const placements: ZoneFurniturePlacement[] = [];
  const skipped: FacilityPlacementSkipped[] = [];
  for (const facility of facilities) {
    const reason = facilityPlacementSkipReason(facility);
    if (reason) {
      skipped.push({ id: facility.id, name: facility.name, reason });
      continue;
    }
    placements.push(facilityToPlacement(facility, opts));
  }
  return { placements, skipped };
}
