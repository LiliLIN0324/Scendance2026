/**
 * 户外 2D 规划满铺画布核心（H2-a）——图层栈与坐标映射的纯函数层。
 *
 * 职责：把 `SitePlanData`（局部米制 ENU：x 东、y 北，锚点 GCJ-02）渲染到
 * 满铺地图画布上，六类业务图层（边界/分区/设施/路线/人员/节点）叠在
 * 瓦片底图之上。视觉完全消费 `outdoor-plan-tokens`（幕景绿/图层色/间距）。
 *
 * 坐标口径（评审稿 §6）：
 * - 2D 平面北向上：ENU(x 东, y 北) → 屏幕 (x, -y)（屏幕 y 向下）。
 * - 底图是 EPSG:3857 墨卡托：锚点经纬度先转墨卡托像素，ENU 米按该纬度
 *   每像素米数换算成像素偏移，两者相加即实体屏幕位置。
 * - 派生量（面积/长度）仍从 site-plan 的米制几何现算，画布只做投影不产生真值。
 */

import { PLANNING_LAYER_COLORS, PLANNING_ROUTE_KIND_COLORS, type PlanningLayerKind, type PlanningRouteKind } from '@/lib/outdoor-plan-tokens';
import { planZoneFillAlpha } from './site-plan-editing';
import { metersPerDegreeLng } from './tdt-probe-scale';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

/** 图层栈从底到顶的绘制顺序（底图由画布组件先铺，业务层依此序叠加）。 */
export const PLAN_LAYER_STACK: readonly PlanningLayerKind[] = [
  'boundary', 'zone', 'facility', 'route', 'worker', 'access',
];

/** 视口：中心经纬度 + 缩放级 + 画布 CSS 尺寸。 */
export interface PlanViewport {
  lng: number;
  lat: number;
  zoom: number;
  canvasW: number;
  canvasH: number;
}

/** ENU 米制点 → 画布 CSS 像素点（含 y 轴翻转：北向上）。 */
export function planPointToPixel(p: PlanPoint, viewport: PlanViewport): { x: number; y: number } {
  const metersPerPx = planMetersPerPixel(viewport);
  const originPx = planAnchorPixel(viewport);
  return {
    x: originPx.x + p.x / metersPerPx,
    y: originPx.y - p.y / metersPerPx,
  };
}

/** 画布 CSS 像素点 → ENU 米制点（planPointToPixel 的逆映射，H2-b 绘制/顶点编辑取点用）。 */
export function planPixelToPoint(px: { x: number; y: number }, viewport: PlanViewport): PlanPoint {
  const metersPerPx = planMetersPerPixel(viewport);
  const originPx = planAnchorPixel(viewport);
  return {
    x: (px.x - originPx.x) * metersPerPx,
    y: (originPx.y - px.y) * metersPerPx,
  };
}

/** 锚点（ENU 原点）的画布像素位置：中心像素 + (0,0) 相对中心的偏移。 */
function planAnchorPixel(viewport: PlanViewport): { x: number; y: number } {
  const world = 2 ** viewport.zoom * 256;
  const centerPx = (viewport.lng + 180) / 360 * world;
  const latRad = viewport.lat * Math.PI / 180;
  const centerPy = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * world;
  const anchor = enuToLngLat(0, 0, viewport.lng, viewport.lat);
  const anchorPx = (anchor.lng + 180) / 360 * world;
  const anchorLatRad = anchor.lat * Math.PI / 180;
  const anchorPy = (1 - Math.log(Math.tan(anchorLatRad) + 1 / Math.cos(anchorLatRad)) / Math.PI) / 2 * world;
  return {
    x: anchorPx - centerPx + viewport.canvasW / 2,
    y: anchorPy - centerPy + viewport.canvasH / 2,
  };
}

/** 当前缩放下每像素代表的地面米数（取锚点纬度近似）。 */
export function planMetersPerPixel(viewport: PlanViewport): number {
  const metersPerWorld = 40075016.686 * Math.cos(viewport.lat * Math.PI / 180);
  return metersPerWorld / (2 ** viewport.zoom * 256);
}

/** ENU 米 → 经纬度（以锚点为原点的局部近似投影，与 site-plan 契约同一套）。 */
export function enuToLngLat(x: number, y: number, anchorLng: number, anchorLat: number): { lng: number; lat: number } {
  return {
    lng: anchorLng + x / metersPerDegreeLng(anchorLat),
    lat: anchorLat + y / 111132.92,
  };
}

/** 图层可见性：隐藏的层整层跳过，不影响全案统计（评审稿 §4 口径）。 */
export type LayerVisibility = Record<PlanningLayerKind, boolean>;

export function defaultLayerVisibility(): LayerVisibility {
  return {
    boundary: true,
    zone: true,
    facility: true,
    route: true,
    access: true,
    worker: true,
    node: true,
  };
}

export function isLayerVisible(visibility: LayerVisibility, kind: PlanningLayerKind): boolean {
  return visibility[kind] !== false;
}

/** 按图层栈顺序过滤出当前要绘制的图层种类。 */
export function visiblePlanLayers(visibility: LayerVisibility): PlanningLayerKind[] {
  return PLAN_LAYER_STACK.filter(kind => isLayerVisible(visibility, kind));
}

/* ---------------- 各图层绘制（Canvas 2D，消费 tokens 配色） ---------------- */

export interface PlanCanvasContext {
  ctx: CanvasRenderingContext2D;
  viewport: PlanViewport;
}

/** 场地边界：品牌绿描边 + 低透明填充，顶点小方点；编辑模式下顶点画成可拖手柄。 */
export function drawBoundaryLayer(
  c: PlanCanvasContext,
  boundary: readonly PlanPoint[],
  opts: { vertexHandles?: boolean } = {},
): void {
  if (boundary.length < 3) return;
  const { ctx, viewport } = c;
  const color = PLANNING_LAYER_COLORS.boundary;
  traceRing(c, boundary);
  ctx.fillStyle = hexWithAlpha(color, 0.10);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  for (const p of boundary) {
    const pt = planPointToPixel(p, viewport);
    if (opts.vertexHandles) {
      // 可拖顶点手柄：白底绿边圆点，命中热区由组件按同半径判定。
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(pt.x - 2.5, pt.y - 2.5, 5, 5);
    }
  }
}

/**
 * 分区：填充色 + 名称标注；分区自带色/透明度优先（H2-b）。
 * warning 为 true 时改红虚线描边（越界/重叠警示，分区数据本身保留原色）。
 */
export function drawZoneLayer(
  c: PlanCanvasContext,
  zones: readonly {
    polygon: readonly PlanPoint[];
    name: string;
    color?: string | undefined;
    opacity?: number | undefined;
    warning?: boolean | undefined;
  }[],
): void {
  const { ctx } = c;
  for (const zone of zones) {
    if (zone.polygon.length < 3) continue;
    const fill = zone.color ?? PLANNING_LAYER_COLORS.zone;
    traceRing(c, zone.polygon);
    ctx.fillStyle = hexWithAlpha(fill, planZoneFillAlpha({ opacity: zone.opacity }));
    ctx.fill();
    if (zone.warning) {
      ctx.save();
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.strokeStyle = fill;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    const label = zoneLabelPixel(c, zone.polygon);
    if (label) {
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(15,22,32,0.85)';
      ctx.fillText(zone.name, label.x, label.y);
    }
  }
}

/**
 * 设施：中心 + 朝向的占地矩形（米制宽深 → 像素），设施色描边。
 * warning 为 true 时改红虚线描边（越界警示，数据本身保留）；
 * opts.selectedId 命中的设施画白色外圈 + 名称标注（H2-c「放置即选中」可视反馈）。
 */
export function drawFacilityLayer(
  c: PlanCanvasContext,
  facilities: readonly {
    id?: string;
    position: PlanPoint;
    rotationDeg: number;
    size: { width: number; depth: number };
    name?: string;
    warning?: boolean;
  }[],
  opts: { selectedId?: string | null } = {},
): void {
  const { ctx, viewport } = c;
  const color = PLANNING_LAYER_COLORS.facility;
  const metersPerPx = planMetersPerPixel(viewport);
  for (const f of facilities) {
    const center = planPointToPixel(f.position, viewport);
    const w = Math.max(4, f.size.width / metersPerPx);
    const h = Math.max(4, f.size.depth / metersPerPx);
    ctx.save();
    ctx.translate(center.x, center.y);
    // 屏幕系 y 向下故取负角；地面语义与 facilityFootprintRing 同一套矩阵：
    // rotationDeg 以东为零、逆时针为正（+90° 时宽边从东转向北）。
    ctx.rotate(-f.rotationDeg * Math.PI / 180);
    ctx.fillStyle = hexWithAlpha(color, 0.16);
    ctx.fillRect(-w / 2, -h / 2, w, h);
    if (f.warning) {
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
    }
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.restore();
    if (opts.selectedId && f.id === opts.selectedId) {
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.rotate(-f.rotationDeg * Math.PI / 180);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6);
      ctx.restore();
      if (f.name) {
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fillText(f.name, center.x, center.y + Math.max(h / 2, 6) + 3);
      }
    }
  }
}

/**
 * 设施放置幽灵预览（H2-c）：跟随指针的占地虚线框 + 中心十字 + 模板/尺寸标签。
 * invalid 为 true 时改红色（当前落点越界，由 facilityPlacementIssues 判定），
 * 旋转矩阵与 drawFacilityLayer / facilityFootprintRing 一致。
 */
export function drawFacilityGhost(
  c: PlanCanvasContext,
  template: { name: string; width: number; depth: number },
  position: PlanPoint,
  opts: { rotationDeg?: number; invalid?: boolean } = {},
): void {
  const { ctx, viewport } = c;
  const metersPerPx = planMetersPerPixel(viewport);
  const center = planPointToPixel(position, viewport);
  const w = Math.max(4, template.width / metersPerPx);
  const h = Math.max(4, template.depth / metersPerPx);
  const color = opts.invalid ? '#c0392b' : PLANNING_LAYER_COLORS.facility;
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(-(opts.rotationDeg ?? 0) * Math.PI / 180);
  ctx.fillStyle = hexWithAlpha(color, 0.12);
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.lineTo(5, 0);
  ctx.moveTo(0, -5);
  ctx.lineTo(0, 5);
  ctx.stroke();
  ctx.restore();
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(15,22,32,0.9)';
  ctx.fillText(`${template.name} ${template.width}×${template.depth}m`, center.x, center.y + Math.max(h / 2, 6) + 3);
}

/**
 * 路线：折线 + 方向箭头；三类动线各有专属色（人行蓝/车辆紫/后勤金）与线型
 * （实线/长划/点划）。oneWay 沿线逐段画箭头表达方向；选中路线画白描边高亮
 * + 名称标注（H2-d）。
 */
export function drawRouteLayer(
  c: PlanCanvasContext,
  routes: readonly {
    kind: 'pedestrian' | 'vehicle' | 'service';
    points: readonly PlanPoint[];
    oneWay: boolean;
    name?: string;
    selected?: boolean;
  }[],
): void {
  const { ctx } = c;
  for (const r of routes) {
    if (r.points.length < 2) continue;
    const color = PLANNING_ROUTE_KIND_COLORS[r.kind as PlanningRouteKind];
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = r.kind === 'vehicle' ? 3 : 2;
    if (r.selected) ctx.lineWidth += 1.5;
    ctx.setLineDash(r.kind === 'service' ? [10, 6] : r.kind === 'vehicle' ? [14, 5] : []);
    tracePolyline(c, r.points);
    ctx.stroke();
    ctx.restore();
    if (r.selected) {
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      tracePolyline(c, r.points);
      ctx.stroke();
      ctx.restore();
    }
    // 方向：oneWay 沿每段终点画箭头（首段起终都画），双向往返语义不画箭头。
    if (r.oneWay) {
      for (let i = 1; i < r.points.length; i++) {
        drawArrowAt(c, r.points[i - 1]!, r.points[i]!, color);
      }
    }
    if (r.selected && r.name) {
      const label = polylineLabelPixel(c, r.points);
      if (label) {
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fillText(r.name, label.x, label.y - 4);
      }
    }
  }
}

/**
 * 人员：圆形点位 + 角色名与数量标注，人员色；选中画白圈（H2-d）。
 * warning 为 true 时改红描边（点位越界警示，数据本身保留）。
 */
export function drawWorkerLayer(
  c: PlanCanvasContext,
  workers: readonly { id?: string; position: PlanPoint; count: number; role: string; selected?: boolean; warning?: boolean }[],
): void {
  const { ctx, viewport } = c;
  const color = PLANNING_LAYER_COLORS.worker;
  for (const w of workers) {
    const pt = planPointToPixel(w.position, viewport);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = hexWithAlpha(color, 0.85);
    ctx.fill();
    ctx.strokeStyle = w.warning ? '#c0392b' : '#fff';
    ctx.lineWidth = w.warning ? 1.6 : 1;
    ctx.stroke();
    if (w.selected) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 8.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(15,22,32,0.85)';
    ctx.fillText(w.count > 1 ? `${w.role} ×${w.count}` : w.role, pt.x + 6, pt.y - 2);
  }
}

/**
 * 出入口节点：菱形标记 + 入/出口语义色；选中画白圈；unconnected 为 true 时
 * 画红色警示点（未连接任何动线，H2-d）。
 */
export function drawAccessLayer(
  c: PlanCanvasContext,
  nodes: readonly { id?: string; kind: 'entry' | 'exit' | 'both'; position: PlanPoint; name: string; selected?: boolean; unconnected?: boolean }[],
): void {
  const { ctx, viewport } = c;
  for (const n of nodes) {
    const pt = planPointToPixel(n.position, viewport);
    const color = n.kind === 'exit' ? PLANNING_LAYER_COLORS.node : PLANNING_LAYER_COLORS.access;
    ctx.save();
    ctx.translate(pt.x, pt.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = hexWithAlpha(color, 0.9);
    ctx.fillRect(-4.5, -4.5, 9, 9);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(-4.5, -4.5, 9, 9);
    ctx.restore();
    if (n.selected) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 9.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
    if (n.unconnected) {
      ctx.beginPath();
      ctx.arc(pt.x + 6, pt.y - 6, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#c0392b';
      ctx.fill();
    }
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(15,22,32,0.85)';
    ctx.fillText(n.name, pt.x + 7, pt.y - 2);
  }
}

/* ---------------- 绘制草稿（H2-b 画边界/画分区） ---------------- */

/**
 * 顶点收集草稿：虚线折线 + 顶点方块；≥3 点时首点画闭合热区圆圈提示。
 * draftInvalid 为 true 时整条草稿画红色（当前形状自交/重合，用户能立刻看到）。
 */
export function drawDraftLayer(
  c: PlanCanvasContext,
  draft: readonly PlanPoint[],
  color: string,
  opts: { draftInvalid?: boolean } = {},
): void {
  if (draft.length === 0) return;
  const { ctx, viewport } = c;
  const stroke = opts.draftInvalid ? '#c0392b' : color;
  if (draft.length >= 2) {
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    tracePolyline(c, draft);
    if (draft.length >= 3) ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  draft.forEach((p, i) => {
    const pt = planPointToPixel(p, viewport);
    if (i === 0 && draft.length >= 3) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.fillStyle = stroke;
    ctx.fillRect(pt.x - 3, pt.y - 3, 6, 6);
  });
}

/* ---------------- 动线/节点/人员放置草稿（H2-d） ---------------- */

/**
 * 动线草稿（画动线模式）：已收点虚线折线 + 顶点方块 + 指针橡皮筋线；
 * cursorPoint 缺省时不画橡皮筋。draftPoints 为空时只画指针小十字。
 */
export function drawRouteDraft(
  c: PlanCanvasContext,
  draftPoints: readonly PlanPoint[],
  kind: 'pedestrian' | 'vehicle' | 'service',
  cursorPoint?: PlanPoint,
): void {
  const { ctx, viewport } = c;
  const color = PLANNING_ROUTE_KIND_COLORS[kind as PlanningRouteKind];
  if (draftPoints.length >= 2) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    tracePolyline(c, draftPoints);
    ctx.stroke();
    ctx.restore();
  }
  if (cursorPoint && draftPoints.length >= 1) {
    const last = planPointToPixel(draftPoints[draftPoints.length - 1]!, viewport);
    const cursor = planPointToPixel(cursorPoint, viewport);
    ctx.save();
    ctx.strokeStyle = hexWithAlpha(color, 0.55);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(cursor.x, cursor.y);
    ctx.stroke();
    ctx.restore();
    drawArrowAt(c, draftPoints[draftPoints.length - 1]!, cursorPoint, color);
  }
  for (const p of draftPoints) {
    const pt = planPointToPixel(p, viewport);
    ctx.fillStyle = color;
    ctx.fillRect(pt.x - 3, pt.y - 3, 6, 6);
  }
  if (cursorPoint) {
    const cursor = planPointToPixel(cursorPoint, viewport);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cursor.x - 6, cursor.y);
    ctx.lineTo(cursor.x + 6, cursor.y);
    ctx.moveTo(cursor.x, cursor.y - 6);
    ctx.lineTo(cursor.x, cursor.y + 6);
    ctx.stroke();
  }
}

/**
 * 出入口节点放置幽灵：跟随指针的菱形预览 + 语义色 + 名称标签。
 */
export function drawNodeGhost(
  c: PlanCanvasContext,
  kind: 'entry' | 'exit' | 'both',
  name: string,
  position: PlanPoint,
): void {
  const { ctx, viewport } = c;
  const color = kind === 'exit' ? PLANNING_LAYER_COLORS.node : PLANNING_LAYER_COLORS.access;
  const pt = planPointToPixel(position, viewport);
  ctx.save();
  ctx.globalAlpha = 0.65;
  ctx.translate(pt.x, pt.y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = hexWithAlpha(color, 0.9);
  ctx.fillRect(-4.5, -4.5, 9, 9);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.strokeRect(-4.5, -4.5, 9, 9);
  ctx.restore();
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(15,22,32,0.85)';
  ctx.fillText(name, pt.x + 7, pt.y - 2);
}

/* ---------------- 内部工具 ---------------- */

function traceRing(c: PlanCanvasContext, ring: readonly PlanPoint[]): void {
  const { ctx, viewport } = c;
  ctx.beginPath();
  ring.forEach((p, i) => {
    const pt = planPointToPixel(p, viewport);
    if (i === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  });
  ctx.closePath();
}

function tracePolyline(c: PlanCanvasContext, points: readonly PlanPoint[]): void {
  const { ctx, viewport } = c;
  ctx.beginPath();
  points.forEach((p, i) => {
    const pt = planPointToPixel(p, viewport);
    if (i === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  });
}

/** 分区标注锚点：首两个顶点中点（稳定且贴近人眼关注处）。 */
function zoneLabelPixel(
  c: PlanCanvasContext,
  polygon: readonly PlanPoint[],
): { x: number; y: number } | null {
  if (polygon.length < 2) return null;
  const a = planPointToPixel(polygon[0], c.viewport);
  const b = planPointToPixel(polygon[1], c.viewport);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** 折线标注锚点：中点顶点的像素位置（选中路线的名称标注用）。 */
function polylineLabelPixel(
  c: PlanCanvasContext,
  points: readonly PlanPoint[],
): { x: number; y: number } | null {
  if (points.length < 2) return null;
  const mid = points[Math.floor(points.length / 2)]!;
  return planPointToPixel(mid, c.viewport);
}

function drawArrowAt(c: PlanCanvasContext, from: PlanPoint, to: PlanPoint, color: string): void {
  const { ctx, viewport } = c;
  const a = planPointToPixel(from, viewport);
  const b = planPointToPixel(to, viewport);
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-9, 5);
  ctx.lineTo(-9, -5);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** #rrggbb + 透明度 → rgba 字符串。 */
export function hexWithAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}