/**
 * PNG 快照导出（H5-a）——快照布局纯函数 + Canvas 合成。
 *
 * 口径（评审稿 §11 导出对标 OnePlan）：
 * - 72 / 300 DPI 两档：72 屏显汇报、300 印刷；
 * - 快照必带四件：比例尺（按快照缩放级真实换算）、北箭头（北向上约定）、
 *   图例（buildPlanLegend 同一来源）、版本号（r{revision} + 导出时间）；
 * - 快照范围：以场地边界外扩边距（paddingM，默认 40 m）自动框住全部实体，
 *   不依赖当前视图（导出的图与用户当前平移缩放无关，可复现）。
 *
 * 纯函数层负责布局（视图换算/图例排版/比例尺刻度）；DOM 层只做 canvas 拼装。
 */

import { buildPlanLegend } from './site-plan-legend';
import { formatLengthM } from './site-plan-measure';
import type { PlanPoint, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

export const PNG_DPI_CHOICES = [72, 300] as const;
export type PngDpi = (typeof PNG_DPI_CHOICES)[number];

/** 快照布局：世界米 → 快照片素（含边距与图例高度）。 */
export interface SnapshotLayout {
  /** 场地外接框（米）。 */
  boundsM: { minX: number; minY: number; maxX: number; maxY: number };
  /** 外扩边距（米）。 */
  paddingM: number;
  /** 画布尺寸（CSS 像素，DPI 独立）。 */
  canvasW: number;
  canvasH: number;
  /** 米 → 像素系数。 */
  metersToPx: number;
  /** 图例面板高度（像素，含内边距）。 */
  legendHeight: number;
  /** 缩放级（近似，供比例尺换算与署名）。 */
  zoom: number;
}

/** 实体外接框：边界+分区+设施+动线+人员+节点全部参与（快照框住全部实体）。 */
export function planBoundsM(plan: SitePlanData): { minX: number; minY: number; maxX: number; maxY: number } {
  const points: PlanPoint[] = [
    ...plan.boundary,
    ...plan.zones.flatMap(z => z.polygon),
    ...plan.facilities.map(f => f.position),
    ...plan.routes.flatMap(r => r.points),
    ...plan.workers.map(w => w.position),
    ...plan.nodes.map(n => n.position),
  ];
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** 图例条目数（用于面板高度估算——纯函数可测）。 */
export function legendEntryCount(plan: SitePlanData): number {
  return buildPlanLegend(plan).reduce((sum, group) => sum + group.entries.length, 0);
}

/** 计算快照布局：以内容外接框 + 边距撑满目标宽度。 */
export function computeSnapshotLayout(
  plan: SitePlanData,
  options: { targetWidthPx?: number; paddingM?: number } = {},
): SnapshotLayout {
  const targetW = options.targetWidthPx ?? 1600;
  const paddingM = options.paddingM ?? 40;
  const bounds = planBoundsM(plan);
  const contentW = Math.max(bounds.maxX - bounds.minX, 1) + paddingM * 2;
  const contentH = Math.max(bounds.maxY - bounds.minY, 1) + paddingM * 2;
  const metersToPx = targetW / contentW;
  const legendH = Math.max(180, legendEntryCount(plan) * 26 + 120);
  return {
    boundsM: bounds,
    paddingM,
    canvasW: targetW,
    canvasH: Math.round(contentH * metersToPx) + legendH,
    metersToPx,
    legendHeight: legendH,
    zoom: Math.round(Math.log2(40075016.686 * metersToPx / 256)) - 8,
  };
}

/** 比例尺刻度选择：0.8–1.6 倍屏宽 1/6 的整刻度（1/2/5×10^n）。 */
export function scaleBarMeters(metersToPx: number, barWidthPx: number): { meters: number; label: string; px: number } {
  const rawMeters = barWidthPx / metersToPx;
  const pow = 10 ** Math.floor(Math.log10(rawMeters));
  const candidates = [1, 2, 5, 10].map(k => k * pow);
  const chosen = candidates.reduce((best, c) =>
    Math.abs(c - rawMeters) < Math.abs(best - rawMeters) ? c : best, candidates[0]);
  return { meters: chosen, label: formatLengthM(chosen), px: chosen * metersToPx };
}

/** 快照署名行（版本号 + 导出时间 + DPI）。 */
export function snapshotCaption(revision: number, dpi: number, exportedAt: Date): string {
  const stamp = exportedAt.toLocaleString('zh-CN', { hour12: false });
  return `幕景 Scendance · 户外规划快照 r${revision} · ${dpi} DPI · ${stamp} · 底图 © OpenStreetMap contributors`;
}

/** 北箭头路径数据（以给定中心、半径画简北箭头，纯几何）。 */
export function northArrowGeometry(cx: number, cy: number, r: number): { tip: { x: number; y: number }; left: { x: number; y: number }; right: { x: number; y: number } } {
  return {
    tip: { x: cx, y: cy - r },
    left: { x: cx - r * 0.42, y: cy + r * 0.55 },
    right: { x: cx + r * 0.42, y: cy + r * 0.55 },
  };
}

/* ---------------- Canvas 合成（DOM 侧） ---------------- */

export interface PngSnapshotInput {
  plan: SitePlanData;
  /** 已渲染的业务层画布（由画布组件提供）。 */
  planCanvas: HTMLCanvasElement;
  revision: number;
  dpi: PngDpi;
  exportedAt?: Date;
}

/**
 * 合成快照 PNG：业务层画布 + 底图底色 + 比例尺 + 北箭头 + 图例 + 署名。
 * 业务层直接 drawImage 复用画布组件的渲染结果（所见即所得）。
 */
export function composePlanPng(input: PngSnapshotInput): HTMLCanvasElement {
  const { plan, planCanvas, revision, dpi } = input;
  const exportedAt = input.exportedAt ?? new Date();
  const layout = computeSnapshotLayout(plan);

  const scale = dpi / 72;
  const out = document.createElement('canvas');
  out.width = Math.round(layout.canvasW * scale);
  out.height = Math.round(layout.canvasH * scale);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.scale(scale, scale);

  // 底色（快照自底色，不嵌瓦片——瓦片随视图变化不可复现；边界内浅色场地底）。
  ctx.fillStyle = '#f2f5f1';
  ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);

  // 业务层（缩放适配快照布局；源画布是当前视口渲染，重绘到快照坐标系）。
  ctx.drawImage(planCanvas, 0, 0, planCanvas.width, planCanvas.height, 0, 0, layout.canvasW, layout.canvasH - layout.legendHeight);

  // 比例尺：左下。
  const bar = scaleBarMeters(layout.metersToPx, layout.canvasW / 6);
  const barX = 24;
  const barY = layout.canvasH - layout.legendHeight - 24;
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(barX, barY, bar.px, 4);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText(bar.label, barX, barY - 6);

  // 北箭头：右上。
  const arrow = northArrowGeometry(layout.canvasW - 36, 40, 18);
  ctx.fillStyle = '#1f2937';
  ctx.beginPath();
  ctx.moveTo(arrow.tip.x, arrow.tip.y);
  ctx.lineTo(arrow.left.x, arrow.left.y);
  ctx.lineTo(arrow.right.x, arrow.right.y);
  ctx.closePath();
  ctx.fill();
  ctx.fillText('北', arrow.tip.x - 6, arrow.tip.y - 6);

  // 图例：底部面板。
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, layout.canvasH - layout.legendHeight, layout.canvasW, layout.legendHeight);
  ctx.strokeStyle = '#d8dee6';
  ctx.strokeRect(0.5, layout.canvasH - layout.legendHeight + 0.5, layout.canvasW - 1, layout.legendHeight - 1);
  let x = 24;
  let y = layout.canvasH - layout.legendHeight + 28;
  ctx.font = '12px system-ui, sans-serif';
  for (const group of buildPlanLegend(plan)) {
    for (const entry of group.entries) {
      const text = `${entry.label} ×${entry.count}`;
      ctx.fillStyle = entry.swatch;
      ctx.fillRect(x, y - 9, 12, 12);
      ctx.fillStyle = '#1f2937';
      ctx.fillText(text, x + 16, y);
      x += 16 + ctx.measureText(text).width + 28;
      if (x > layout.canvasW - 160) { x = 24; y += 26; }
    }
  }

  // 署名行。
  ctx.fillStyle = '#6b7280';
  ctx.fillText(snapshotCaption(revision, dpi, exportedAt), 24, layout.canvasH - 12);
  return out;
}

/** 触发 PNG 下载。 */
export function downloadPlanPng(input: PngSnapshotInput, filenameBase = 'site-plan'): string {
  const canvas = composePlanPng(input);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${filenameBase}-r${input.revision}-${date}-${input.dpi}dpi.png`;
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = filename;
  link.click();
  return filename;
}