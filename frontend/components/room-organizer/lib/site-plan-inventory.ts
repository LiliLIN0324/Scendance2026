/**
 * 规划清单纯函数层（H3-c）——评审稿 §4 右栏「规划信息」/ §9.1 步骤 11。
 *
 * 口径（评审稿原文）：
 * - 「下方分为总览、清单、问题……点清单行定位地图，点地图对象同步聚焦清单」；
 * - 「支持按区、类型、未归属和问题筛选」；
 * - 「清单含类型、名称、所属区、尺寸及面积」（§10 CSV 口径，清单行同源）。
 *
 * 全部派生现算不落盘：每行带定位锚点 anchor（点行定位地图用）与 hasIssue
 * （命中分区/设施/节点/人员问题或冲突规则任一清单）。筛选纯函数与构建分离，
 * 便于面板在「类型 × 所属区 × 只看问题」上组合过滤。
 */

import {
  planMeasurementKindLabels,
  planRingAreaM2,
  planRouteKindLabels,
  planRouteLengthM,
  planZoneSemanticLabels,
  type PlanPoint,
  type SitePlanData,
} from '../../../../supabase/functions/_shared/site-plan';
import { findFacilityTemplate } from './site-plan-facilities';
import { formatAreaM2, formatLengthM, measureValue } from './site-plan-measure';
import { routeAnchorPoint } from './site-plan-legend';
import { planConflictIssues } from './site-plan-conflicts';
import { planFacilityIssues } from './site-plan-facilities';
import { planNodeIssues, planWorkerIssues } from './site-plan-routes';
import { planZoneIssues } from './site-plan-editing';

export type PlanInventoryKind = 'zone' | 'facility' | 'route' | 'node' | 'worker' | 'measurement';

/** 出入口节点类型文案（契约无 labels，组件与清单同源此处）。 */
export const PLAN_NODE_KIND_LABELS: Record<'entry' | 'exit' | 'both', string> = {
  entry: '入口',
  exit: '出口',
  both: '出入口',
};

/** 清单行：双向定位的最小单元（点行 → 选中/居中；地图选中 → 行高亮）。 */
export interface PlanInventoryRow {
  id: string;
  kind: PlanInventoryKind;
  name: string;
  /** 类型口径：分区语义 / 设施模板名 / 动线三类 / 出入口类型 / 人员岗位 / 测量三类。 */
  typeLabel: string;
  /** 所属分区名；无归属（分区/动线/出入口/测量/未归属设施与人员）为 null。 */
  zoneName: string | null;
  /** 所属分区 ID（按区筛选用，名字可能重复所以不能靠名字）；无归属为 null。 */
  zoneId: string | null;
  /** 数量口径：面积 / 尺寸 / 长度 / 引用动线数 / 人数 / 测量读数。 */
  metric: string;
  /** 定位锚点（米制 ENU）：分区质心 / 设施位置 / 动线半长点 / 节点与人员位置 / 测量首点。 */
  anchor: PlanPoint;
  /** 命中任一问题清单（分区/设施/节点/人员问题或 H3-b 冲突规则）。 */
  hasIssue: boolean;
}

/** 清单筛选：类型 × 所属区 × 只看问题（评审稿「按区、类型、未归属和问题筛选」）。 */
export interface PlanInventoryFilter {
  /** 'all' 或单一类型；缺省 'all'。 */
  kind?: PlanInventoryKind | 'all' | undefined;
  /** 具体分区 ID；'unassigned' 只看未归属（可归属实体=设施/人员）；缺省不限。 */
  zone?: string | 'unassigned' | undefined;
  /** true 只看带问题的行。 */
  issuesOnly?: boolean;
}

const KIND_LABELS: Record<PlanInventoryKind, string> = {
  zone: '分区',
  facility: '设施',
  route: '动线',
  node: '出入口',
  worker: '人员',
  measurement: '测量',
};

/** 类型文案（筛选下拉与清单分组标题共用）。 */
export function planInventoryKindLabel(kind: PlanInventoryKind): string {
  return KIND_LABELS[kind];
}

/**
 * 全案清单（顺序：分区 → 设施 → 动线 → 出入口 → 人员 → 测量；组内保持数据序）。
 * 问题判定一次现算：四类实体问题清单 + 冲突规则（动线的 hasIssue 含冲突命中）。
 */
export function buildPlanInventory(plan: SitePlanData): PlanInventoryRow[] {
  const zoneNameById = new Map(plan.zones.map(z => [z.id, z.name] as const));
  const zoneIssueIds = new Set(planZoneIssues(plan).map(i => i.zoneId));
  const facilityIssueIds = new Set(planFacilityIssues(plan).map(i => i.facilityId));
  const nodeIssueIds = new Set(planNodeIssues(plan).map(i => i.nodeId));
  const workerIssueIds = new Set(planWorkerIssues(plan).map(i => i.workerId));
  const routeIssueIds = new Set(planConflictIssues(plan).flatMap(i => i.routeIds));

  const rows: PlanInventoryRow[] = [];

  for (const zone of plan.zones) {
    rows.push({
      id: zone.id,
      kind: 'zone',
      name: zone.name,
      typeLabel: planZoneSemanticLabels[zone.semantic],
      zoneName: null,
      zoneId: null,
      metric: formatAreaM2(planRingAreaM2(zone.polygon)),
      anchor: ringAnchor(zone.polygon),
      hasIssue: zoneIssueIds.has(zone.id),
    });
  }

  for (const facility of plan.facilities) {
    rows.push({
      id: facility.id,
      kind: 'facility',
      name: facility.name,
      typeLabel: findFacilityTemplate(facility.templateId)?.name ?? facility.templateId,
      zoneName: facility.zoneId ? zoneNameById.get(facility.zoneId) ?? null : null,
      zoneId: facility.zoneId ?? null,
      metric: `${facility.size.width}×${facility.size.depth} m`,
      anchor: { x: facility.position.x, y: facility.position.y },
      hasIssue: facilityIssueIds.has(facility.id),
    });
  }

  for (const route of plan.routes) {
    rows.push({
      id: route.id,
      kind: 'route',
      name: route.name,
      typeLabel: `${planRouteKindLabels[route.kind]}动线`,
      zoneName: null,
      zoneId: null,
      metric: route.widthM !== undefined
        ? `${formatLengthM(planRouteLengthM(route.points))} · 宽 ${route.widthM} m`
        : formatLengthM(planRouteLengthM(route.points)),
      anchor: routeAnchorPoint(route),
      hasIssue: routeIssueIds.has(route.id),
    });
  }

  for (const node of plan.nodes) {
    const refs = plan.routes.filter(r => r.startNodeId === node.id || r.endNodeId === node.id).length;
    rows.push({
      id: node.id,
      kind: 'node',
      name: node.name,
      typeLabel: PLAN_NODE_KIND_LABELS[node.kind],
      zoneName: null,
      zoneId: null,
      metric: `${refs} 条动线引用`,
      anchor: { x: node.position.x, y: node.position.y },
      hasIssue: nodeIssueIds.has(node.id),
    });
  }

  for (const worker of plan.workers) {
    rows.push({
      id: worker.id,
      kind: 'worker',
      name: worker.role,
      typeLabel: '人员',
      zoneName: worker.zoneId ? zoneNameById.get(worker.zoneId) ?? null : null,
      zoneId: worker.zoneId ?? null,
      metric: `${worker.count} 人`,
      anchor: { x: worker.position.x, y: worker.position.y },
      hasIssue: workerIssueIds.has(worker.id),
    });
  }

  for (const measurement of plan.measurements ?? []) {
    const value = measureValue(measurement);
    rows.push({
      id: measurement.id,
      kind: 'measurement',
      name: measurement.name,
      typeLabel: planMeasurementKindLabels[measurement.kind],
      zoneName: null,
      zoneId: null,
      metric: measurement.kind === 'area' ? formatAreaM2(value) : formatLengthM(value),
      anchor: { x: measurement.points[0]!.x, y: measurement.points[0]!.y },
      hasIssue: false,
    });
  }

  return rows;
}

/** 顶点平均质心（分区定位锚点）。 */
function ringAnchor(ring: readonly PlanPoint[]): PlanPoint {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  const n = Math.max(1, ring.length);
  return { x: x / n, y: y / n };
}

/**
 * 筛选清单行（评审稿「按区、类型、未归属和问题」）：
 * - kind：单一类型或全部；
 * - zone：具体分区 → 只留归属该分区的设施/人员；'unassigned' → 只留无归属的设施/人员；
 *   其余类型行在按区筛选时整体排除（分区/动线/出入口/测量不参与归属概念）；
 * - issuesOnly：只留 hasIssue 行。
 */
export function filterPlanInventory(rows: readonly PlanInventoryRow[], filter: PlanInventoryFilter): PlanInventoryRow[] {
  const kind = filter.kind ?? 'all';
  const zone = filter.zone;
  return rows.filter(row => {
    if (kind !== 'all' && row.kind !== kind) return false;
    if (zone !== undefined) {
      if (row.kind !== 'facility' && row.kind !== 'worker') return false;
      if (zone === 'unassigned') {
        if (row.zoneId !== null) return false;
      } else if (row.zoneId !== zone) {
        return false;
      }
    }
    if (filter.issuesOnly && !row.hasIssue) return false;
    return true;
  });
}
