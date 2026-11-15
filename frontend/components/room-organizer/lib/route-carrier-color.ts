/**
 * 动线显示色（2026-11-16）：线色跟着「载体」走，不再跟着 `kind` 走。
 *
 * 病根：图例已按 carrier 聚合，画布却还按 kind 取色，于是后勤线出现「金线蓝标」——
 * 画的是金的，图例里写的是「人行动线」蓝。这一份映射把两边收成一处。
 *
 * 色不新造：人行 = 人行蓝、推车/人车一起 = 后勤金、车行 = 车辆紫，与 tokens 三类动线色同源。
 * 动线自带 `color`（活动包赛道预设）时仍然优先。
 */

import { PLANNING_ROUTE_KIND_COLORS } from '@/lib/outdoor-plan-tokens';
import { routeCarrier, type PlanRoute, type PlanRouteCarrier } from '../../../../supabase/functions/_shared/site-plan';

/** 载体 → 借用哪一类动线色。 */
export const CARRIER_COLOR_KIND: Record<PlanRouteCarrier, keyof typeof PLANNING_ROUTE_KIND_COLORS> = {
  walk: 'pedestrian',
  trolley: 'service',
  vehicle: 'vehicle',
  mixed: 'service',
};

/** 一条动线实际画出来的颜色：自带主题色优先，否则按载体取。 */
export function routeDisplayColor(route: Pick<PlanRoute, 'kind' | 'color'> & { carrier?: PlanRoute['carrier'] }): string {
  return route.color ?? PLANNING_ROUTE_KIND_COLORS[CARRIER_COLOR_KIND[routeCarrier(route)]];
}
