/**
 * 图例生成器纯函数层（H3-c）——评审稿 §10「图例生成器」/ §9.1 步骤 11「清单与图例」。
 *
 * 口径（评审稿原文）：
 * - 「按实体类型自动生成『图标+名称+数量』图例，随 PNG/PDF/只读页嵌入，同一快照来源」（P0）；
 * - 图例只看数据不看图层可见性——隐藏图层不改变图例（与全案统计同口径，§4）；
 * - 配色与图标消费 `outdoor-plan-tokens`（图层色/三类动线色/分区语义默认色），
 *   与画布渲染同一来源，保证「图例即所见」。
 *
 * 结构：分组（边界/分区/设施/动线/出入口/人员/测量），组内按出现语义聚合，
 * 每条 = { icon, swatch, label, count, detail }。顺序稳定（契约枚举序 / 首次出现序），
 * 空组不输出（只画了边界的全案只有边界一组）。
 */

import type { PlanningIconName } from '@/lib/outdoor-plan-tokens';
import { PLANNING_ICONS } from '@/lib/outdoor-plan-tokens';
import { PLANNING_LAYER_COLORS, PLANNING_ROUTE_KIND_COLORS, PLANNING_ZONE_COLORS } from '@/lib/outdoor-plan-tokens';
import {
  planRingAreaM2,
  planRouteKinds,
  planRouteKindLabels,
  planRouteLengthM,
  planZoneSemantics,
  planZoneSemanticLabels,
  planMeasurementKinds,
  planMeasurementKindLabels,
  type PlanPoint,
  type PlanRoute,
  type SitePlanData,
} from '../../../../supabase/functions/_shared/site-plan';
import { facilityTypeLabel } from './plan-facility-catalog';
import {
  facilitySticker,
  nodeSticker,
  routeSticker,
  workerSticker,
  zoneSticker,
  type OneplanStickerDescriptor,
} from './oneplan-stickers';
import { formatAreaM2, formatLengthM, measureValue } from './site-plan-measure';

/** 图例单条：「图标 + 名称 + 数量」（+ 可选汇总 detail，如总长/总面积）。 */
export interface PlanLegendEntry {
  /** Lucide 图标名（tokens PLANNING_ICONS 内登记）。 */
  icon: PlanningIconName;
  /** 色块（#rrggbb 小写）：分区/动线用各自语义色，其余用图层色。 */
  swatch: string;
  label: string;
  count: number;
  /** 汇总口径（如 '共 85 m' / '共 2400 m²' / '共 6 人'）；无汇总为 ''。 */
  detail: string;
  /**
   * OnePlan 贴纸（H4-b，可选）：图例渲染优先用它，缺省/加载失败时回落 `icon`（Lucide）。
   * 只影响视觉，不参与数量/汇总口径；PNG/PDF 图例可忽略本字段。
   */
  sticker?: OneplanStickerDescriptor | null;
}

export interface PlanLegendGroup {
  title: string;
  entries: PlanLegendEntry[];
}

/** tokens 图标名守卫：拼接图例时防止越出登记表。 */
function iconOf(name: PlanningIconName): PlanningIconName {
  return (PLANNING_ICONS as readonly string[]).includes(name) ? name : 'shapes';
}

/** 折线半长点：沿路径走到总长一半的位置（清单定位锚点，比中点顶点更贴近视觉中段）。 */
export function polylineHalfLengthPoint(points: readonly PlanPoint[]): PlanPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { x: points[0]!.x, y: points[0]!.y };
  const total = planRouteLengthM(points);
  if (total === 0) return { x: points[0]!.x, y: points[0]!.y };
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (walked + seg >= total / 2) {
      const t = seg === 0 ? 0 : (total / 2 - walked) / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    walked += seg;
  }
  const last = points[points.length - 1]!;
  return { x: last.x, y: last.y };
}

/**
 * 全案图例（同一 SitePlan 快照来源，顺序稳定）：
 * 边界 → 分区（按语义） → 设施（按模板） → 动线（按三类） → 出入口（按类型） → 人员（按岗位） → 测量（按三类）。
 * 空组不输出；设施/人员/测量的聚合键按首次出现序（无契约枚举序可用）。
 */
export function buildPlanLegend(plan: SitePlanData): PlanLegendGroup[] {
  const groups: PlanLegendGroup[] = [];

  // 1) 场地边界（恒有一组：边界是全案基底）。图标与图层图标映射同源（H4-a：hexagon）。
  groups.push({
    title: '场地边界',
    entries: [{
      icon: iconOf('hexagon'),
      swatch: PLANNING_LAYER_COLORS.boundary,
      label: '场地边界',
      count: 1,
      detail: plan.boundary.length >= 3 ? `共 ${formatAreaM2(planRingAreaM2(plan.boundary))}` : '',
    }],
  });

  // 2) 功能分区：按语义聚合（契约枚举序），色取分区显式色否则语义默认色。
  const zoneEntries: PlanLegendEntry[] = [];
  for (const semantic of planZoneSemantics) {
    const zones = plan.zones.filter(z => z.semantic === semantic);
    if (zones.length === 0) continue;
    const areaM2 = zones.reduce((sum, z) => sum + planRingAreaM2(z.polygon), 0);
    zoneEntries.push({
      icon: iconOf('shapes'),
      swatch: zones[0]!.color ?? PLANNING_ZONE_COLORS[semantic],
      label: planZoneSemanticLabels[semantic],
      count: zones.length,
      detail: `共 ${formatAreaM2(areaM2)}`,
      sticker: zoneSticker(semantic),
    });
  }
  if (zoneEntries.length > 0) groups.push({ title: '功能分区', entries: zoneEntries });

  // 3) 设施：按模板聚合（首次出现序）；显式 color 优先，否则设施图层色。
  const facilityKeys: string[] = [];
  const facilityMap = new Map<string, { count: number; color: string | undefined; sizes: Set<string> }>();
  for (const facility of plan.facilities) {
    if (!facilityMap.has(facility.templateId)) {
      facilityKeys.push(facility.templateId);
      facilityMap.set(facility.templateId, { count: 0, color: facility.color, sizes: new Set() });
    }
    const bucket = facilityMap.get(facility.templateId)!;
    bucket.count += 1;
    bucket.sizes.add(`${facility.size.width}×${facility.size.depth}`);
    if (!bucket.color && facility.color) bucket.color = facility.color;
  }
  if (facilityKeys.length > 0) {
    groups.push({
      title: '设施',
      entries: facilityKeys.map(templateId => {
        const bucket = facilityMap.get(templateId)!;
        const templateName = facilityTypeLabel(templateId);
        const sizes = [...bucket.sizes];
        return {
          icon: iconOf('tent'),
          swatch: bucket.color ?? PLANNING_LAYER_COLORS.facility,
          label: templateName,
          count: bucket.count,
          detail: sizes.length === 1 ? `${sizes[0]!} m` : `${sizes.length} 种尺寸`,
          sticker: facilitySticker(templateId),
        };
      }),
    });
  }

  // 4) 动线：按三类聚合（契约枚举序），色用三类专属色，detail 总长。
  const routeEntries: PlanLegendEntry[] = [];
  for (const kind of planRouteKinds) {
    const routes = plan.routes.filter(r => r.kind === kind);
    if (routes.length === 0) continue;
    const lengthM = routes.reduce((sum, r) => sum + planRouteLengthM(r.points), 0);
    routeEntries.push({
      icon: iconOf('route'),
      swatch: PLANNING_ROUTE_KIND_COLORS[kind],
      label: `${planRouteKindLabels[kind]}动线`,
      count: routes.length,
      detail: `共 ${formatLengthM(lengthM)}`,
      sticker: routeSticker(kind),
    });
  }
  if (routeEntries.length > 0) groups.push({ title: '动线', entries: routeEntries });

  // 5) 出入口：按类型聚合（入口/出口/两用）。
  const nodeEntries: PlanLegendEntry[] = [];
  for (const [kind, label] of [['entry', '入口'], ['exit', '出口'], ['both', '出入口']] as const) {
    const nodes = plan.nodes.filter(n => n.kind === kind);
    if (nodes.length === 0) continue;
    nodeEntries.push({
      icon: iconOf('door-open'),
      swatch: PLANNING_LAYER_COLORS.node,
      label,
      count: nodes.length,
      detail: '',
      sticker: nodeSticker(kind),
    });
  }
  if (nodeEntries.length > 0) groups.push({ title: '出入口', entries: nodeEntries });

  // 6) 人员：按岗位聚合（首次出现序），count 是人数合计，detail 点位数。
  const roleKeys: string[] = [];
  const roleMap = new Map<string, { people: number; posts: number }>();
  for (const worker of plan.workers) {
    if (!roleMap.has(worker.role)) {
      roleKeys.push(worker.role);
      roleMap.set(worker.role, { people: 0, posts: 0 });
    }
    const bucket = roleMap.get(worker.role)!;
    bucket.people += worker.count;
    bucket.posts += 1;
  }
  if (roleKeys.length > 0) {
    groups.push({
      title: '人员',
      entries: roleKeys.map(role => {
        const bucket = roleMap.get(role)!;
        return {
          icon: iconOf('users'),
          swatch: PLANNING_LAYER_COLORS.worker,
          label: role,
          count: bucket.people,
          detail: `${bucket.posts} 个点位`,
          sticker: workerSticker(role),
        };
      }),
    });
  }

  // 7) 测量：按三类聚合，distance/path 汇总长度、area 汇总面积。
  const measureEntries: PlanLegendEntry[] = [];
  for (const kind of planMeasurementKinds) {
    const measurements = (plan.measurements ?? []).filter(m => m.kind === kind);
    if (measurements.length === 0) continue;
    const total = measurements.reduce((sum, m) => sum + measureValue(m), 0);
    measureEntries.push({
      icon: iconOf('ruler'),
      swatch: PLANNING_LAYER_COLORS.measure,
      label: planMeasurementKindLabels[kind],
      count: measurements.length,
      detail: `共 ${kind === 'area' ? formatAreaM2(total) : formatLengthM(total)}`,
    });
  }
  if (measureEntries.length > 0) groups.push({ title: '测量', entries: measureEntries });

  return groups;
}

/** 动线清单定位锚点（导出给 inventory/组件共用口径）。 */
export function routeAnchorPoint(route: Pick<PlanRoute, 'points'>): PlanPoint {
  return polylineHalfLengthPoint(route.points);
}
