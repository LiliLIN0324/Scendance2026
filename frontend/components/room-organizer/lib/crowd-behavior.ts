/**
 * 户外人群行为判定与碰撞 / 边界派生（#104，纯函数层，零 three 依赖）。
 *
 * - `crowdBehaviorForType`：按人群类型归类 `guard`（定点值守）/ `wander`（松散闲逛），
 *   闲逛个体交给 `lib/crowd-wander.ts` 状态机驱动。
 * - `facilityWalkColliders`：把户外设施占地派生为步行碰撞盒，复用 walk-collision 的
 *   OBB 几何口径，供闲逛选点做避障余量判定。
 * - `insetActivityBounds`：场地矩形边界向内收一条边距，作为闲逛可活动范围。
 */
import { boxCollider } from './walk-collision';
import type { WanderBounds } from './crowd-wander';
import type { WalkCollider } from './walk-collision';

/** 现场行为：guard 守岗不动，wander 在岗位附近短程漫步。 */
export type CrowdBehavior = 'guard' | 'wander';

/** 实例最终行为：route 沿固定人流动线（优先级最高），guard/wander 见上。 */
export type AssignedBehavior = 'route' | CrowdBehavior;

/** 行为分配所需的人群实例最小结构。 */
export interface BehaviorPlacement {
  id: string;
  crowdType: string;
}

/**
 * 行为分配：挂了固定动线的实例优先走 route follower；未挂路线的按人群类型
 * 归类 guard 值守 / wander 闲逛。返回 `placement.id → 行为` 映射。
 */
export function assignCrowdBehavior(
  placements: readonly BehaviorPlacement[],
  routeIds: ReadonlySet<string>,
): Map<string, AssignedBehavior> {
  const out = new Map<string, AssignedBehavior>();
  for (const placement of placements) {
    if (routeIds.has(placement.id)) {
      out.set(placement.id, 'route');
      continue;
    }
    out.set(placement.id, crowdBehaviorForType(placement.crowdType));
  }
  return out;
}

/**
 * 定点值守类型：安保 / 警务 / 医护 / 消防 / 展商 / 管理 / 主管 / 统筹。
 * 其余（工作人员、志愿者、演员、观众等）归 wander 松散闲逛。
 */
const GUARD_BEHAVIOR_TYPES = new Set<string>([
  'security',
  'police',
  'medical',
  'fire',
  'exhibitor',
  'admin',
  'manager',
  'executive',
]);

/** 按人群类型返回现场行为；未识别类型默认 wander（不把陌生人钉死在岗）。 */
export function crowdBehaviorForType(typeId: string): CrowdBehavior {
  return GUARD_BEHAVIOR_TYPES.has(typeId) ? 'guard' : 'wander';
}

/** 步行碰撞盒所需的户外设施最小结构（与 PlanFacility 对齐的子集）。 */
export interface FacilityColliderInput {
  position: { x: number; y: number };
  /** 平面朝向角（度，东为零、逆时针为正）；缺省 0。 */
  rotationDeg?: number;
  size: { width: number; depth: number };
}

/**
 * 把户外设施占地派生为步行碰撞盒。平面 ENU 的 y 北折成世界 z 南；
 * 退化为零占地的设施不进碰撞集。盒体标记 `outdoor`，与 walk-collision 口径一致。
 */
export function facilityWalkColliders(
  facilities: readonly FacilityColliderInput[],
): WalkCollider[] {
  return facilities
    .filter((facility) => facility.size.width > 0 && facility.size.depth > 0)
    .map((facility) =>
      boxCollider(
        facility.position.x,
        -facility.position.y,
        facility.size.width,
        facility.size.depth,
        ((facility.rotationDeg ?? 0) * Math.PI) / 180,
        true,
      ),
    );
}

/** 场地矩形尺寸（米），与 PlanSiteMetrics 同口径。 */
export interface ActivityMetrics {
  width: number;
  depth: number;
}

/**
 * 场地矩形边界向内收 `margin` 米，得到闲逛可活动范围（组内局部坐标 x/z）。
 * 边距不超过半宽 / 半深，避免退化成一条线或空矩形。
 */
export function insetActivityBounds(metrics: ActivityMetrics, margin: number): WanderBounds {
  const width = Math.max(0, metrics.width);
  const depth = Math.max(0, metrics.depth);
  const safeMargin = Math.min(margin, width / 2, depth / 2);
  return {
    minX: safeMargin,
    maxX: width - safeMargin,
    minZ: safeMargin,
    maxZ: depth - safeMargin,
  };
}
