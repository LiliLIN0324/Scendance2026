/**
 * CSV 清单导出（H5-a）——纯函数层。
 *
 * 口径（评审稿 §9.1 步骤 10 / §11 导出对标 OnePlan）：
 * - 14 字段对齐（含地理锚点与坐标，供执行交接直接用）；
 * - UTF-8 带 BOM（`\uFEFF`）——Excel 双击直开不乱码（用户既定偏好：CSV 必带 BOM）；
 * - 转义规则：含逗号/引号/换行的值用双引号包裹，内部双引号翻倍；
 * - 行序与图例/清单一致：类型契约枚举序，同类型内按名称稳定排序（不按 UUID，
 *   保证同一份 plan 两次导出字节一致，可对账）。
 */

import {
  planRingAreaM2,
  planRouteLengthM,
  type SitePlanData,
} from '../../../../supabase/functions/_shared/site-plan';
import { buildPlanInventory, type PlanInventoryRow } from './site-plan-inventory';
import { formatAreaM2, formatLengthM } from './site-plan-measure';

/** 14 字段表头（中文名对齐执行交接口径）。 */
export const CSV_EXPORT_HEADERS = [
  '类型', '名称', '分类', '所属分区', '数量读数',
  '东向 x (m)', '北向 y (m)', '面积 (m²)', '长度 (m)',
  '问题标记', '编号 ID', '锚点经度', '锚点纬度', '备注',
] as const;

/** 行数据先按类型次序再按名称排序，导出字节稳定。 */
const KIND_ORDER: Record<PlanInventoryRow['kind'], number> = {
  zone: 0, facility: 1, route: 2, node: 3, worker: 4, measurement: 5,
};

/** 单元格转义：RFC 4180。 */
export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** 每行导出为 14 列。坐标列保留 2 位小数；问题标记 ✓/空。 */
function rowToCells(row: PlanInventoryRow, plan: SitePlanData): string[] {
  const anchorLngLat = plan.anchor
    ? enuAnchorToLngLat(row.anchor, plan.anchor.lng, plan.anchor.lat)
    : { lng: '', lat: '' };
  const detail = entityDetail(row, plan);
  return [
    csvEscape(kindLabel(row.kind)),
    csvEscape(row.name),
    csvEscape(row.typeLabel),
    csvEscape(row.zoneName ?? ''),
    csvEscape(row.metric),
    row.anchor.x.toFixed(2),
    row.anchor.y.toFixed(2),
    detail.areaM2 ?? '',
    detail.lengthM ?? '',
    row.hasIssue ? '✓' : '',
    row.id,
    anchorLngLat.lng,
    anchorLngLat.lat,
    csvEscape(detail.notes ?? ''),
  ];
}

function kindLabel(kind: PlanInventoryRow['kind']): string {
  const labels: Record<PlanInventoryRow['kind'], string> = {
    zone: '分区', facility: '设施', route: '动线', node: '出入口', worker: '人员', measurement: '测量',
  };
  return labels[kind];
}

/** 各类型补充读数与备注（面积/长度按实体真实几何现算，不重复 metric 概括）。 */
function entityDetail(row: PlanInventoryRow, plan: SitePlanData): { areaM2?: string; lengthM?: string; notes?: string } {
  switch (row.kind) {
    case 'zone': {
      const zone = plan.zones.find(z => z.id === row.id);
      if (!zone) return {};
      return { areaM2: formatAreaM2(planRingAreaM2(zone.polygon)), notes: zone.notes };
    }
    case 'facility': {
      const facility = plan.facilities.find(f => f.id === row.id);
      if (!facility) return {};
      return { notes: facility.notes };
    }
    case 'route': {
      const route = plan.routes.find(r => r.id === row.id);
      if (!route) return {};
      return { lengthM: formatLengthM(planRouteLengthM(route.points)), notes: route.notes };
    }
    case 'node': {
      const node = plan.nodes.find(n => n.id === row.id);
      if (!node) return {};
      return { notes: node.notes };
    }
    case 'worker': {
      const worker = plan.workers.find(w => w.id === row.id);
      if (!worker) return {};
      return { notes: worker.notes };
    }
    default:
      return {};
  }
}

/** ENU 锚点 → 锚点经纬度（GCJ-02 口径与 plan.anchor 一致；无锚点输出空）。 */
function enuAnchorToLngLat(p: { x: number; y: number }, anchorLng: number, anchorLat: number): { lng: string; lat: string } {
  const metersPerDegLng = Math.cos(anchorLat * Math.PI / 180) * 111319.49;
  return {
    lng: (anchorLng + p.x / metersPerDegLng).toFixed(6),
    lat: (anchorLat + p.y / 111132.92).toFixed(6),
  };
}

/** 导出完整 CSV 文本（BOM + 表头 + 数据行，`\r\n` 行尾对齐 Excel）。 */
export function buildPlanCsv(plan: SitePlanData): string {
  const rows = buildPlanInventory(plan)
    .slice()
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, 'zh-CN'));
  const lines = [
    CSV_EXPORT_HEADERS.map(h => csvEscape(h)).join(','),
    ...rows.map(row => rowToCells(row, plan).join(',')),
  ];
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

/** 触发浏览器下载（Blob + a[download]）。文件名带日期与实体数，对账友好。 */
export function downloadPlanCsv(plan: SitePlanData, filenameBase = 'site-plan'): string {
  const csv = buildPlanCsv(plan);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${filenameBase}-${date}.csv`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}