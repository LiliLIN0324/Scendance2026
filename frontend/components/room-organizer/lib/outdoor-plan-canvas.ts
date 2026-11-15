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
 * - 视口中心是「相机」，ENU 原点（plan.anchor）是「图纸钉」：PlanViewport.anchorLng/
 *   anchorLat 传真实锚点后，平移/定位真实移动规划层（H3-c 修复：旧版把视口中心
 *   当锚点，原点恒钉在画布中心，平移只滑底图；视口=锚点时两种口径渲染逐像素一致）。
 * - 派生量（面积/长度）仍从 site-plan 的米制几何现算，画布只做投影不产生真值。
 */

import { PLANNING_CONFLICT_COLORS, PLANNING_LAYER_COLORS, PLANNING_ROUTE_KIND_COLORS, type PlanningLayerKind, type PlanningRouteKind } from '@/lib/outdoor-plan-tokens';
import { planZoneFillAlpha, defaultZoneColor } from './site-plan-editing';
import type { PlanningZoneSemantic } from '@/lib/outdoor-plan-tokens';
import { annotationRectRing, type PlanShapeKind } from './site-plan-annotate';
import { formatAreaM2, formatLengthM, measureDraftReadout, measureValue, type PlanMeasureKind } from './site-plan-measure';
import { metersPerDegreeLng } from './tdt-probe-scale';
import type { PlanSceneObject } from './plan-item-bridge';
import type { PlanAnnotation, PlanFacility, PlanNode, PlanPoint, PlanRoute, PlanZone } from '../../../../supabase/functions/_shared/site-plan';

/** 图层栈从底到顶的绘制顺序（底图由画布组件先铺，业务层依此序叠加；测量/自由标注在最上层）。 */
export const PLAN_LAYER_STACK: readonly PlanningLayerKind[] = [
  'boundary', 'zone', 'facility', 'route', 'worker', 'access', 'measure', 'annotate',
];

/** 视口：中心经纬度 + 缩放级 + 画布 CSS 尺寸。 */
export interface PlanViewport {
  lng: number;
  lat: number;
  zoom: number;
  canvasW: number;
  canvasH: number;
  /**
   * ENU 原点（plan.anchor）的地理位置（H3-c）：缺省按视口中心处理（旧调用方兼容，
   * 行为不变）。传入后平移/定位才会真实移动规划层——修复 H2-a 以来「原点恒钉在
   * 画布中心、平移只滑底图」的投影缺陷（视口中心=锚点时渲染逐像素不变）。
   */
  anchorLng?: number;
  anchorLat?: number;
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

/** 锚点（ENU 原点）的画布像素位置：锚点墨卡托像素 - 视口中心墨卡托像素 + 中心偏移。 */
function planAnchorPixel(viewport: PlanViewport): { x: number; y: number } {
  const world = 2 ** viewport.zoom * 256;
  const centerPx = (viewport.lng + 180) / 360 * world;
  const latRad = viewport.lat * Math.PI / 180;
  const centerPy = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * world;
  // H3-c：优先用真实锚点（plan.anchor）；缺省回落视口中心（旧调用方行为不变）。
  const anchorLng = viewport.anchorLng ?? viewport.lng;
  const anchorLat = viewport.anchorLat ?? viewport.lat;
  const anchorPx = (anchorLng + 180) / 360 * world;
  const anchorLatRad = anchorLat * Math.PI / 180;
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

/** 经纬度 → ENU 米（enuToLngLat 的逆映射；搜地点后定位用）。 */
export function lngLatToEnu(lng: number, lat: number, anchorLng: number, anchorLat: number): PlanPoint {
  return {
    x: (lng - anchorLng) * metersPerDegreeLng(anchorLat),
    y: (lat - anchorLat) * 111132.92,
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
    measure: true,
    annotate: true,
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

/** Draw a review outline or point ring above the editable map geometry. */
export function drawMapEditHighlight(
  c: PlanCanvasContext,
  points: readonly PlanPoint[],
  kind: 'area' | 'route' | 'entrance',
): void {
  if (!points.length) return;
  const { ctx, viewport } = c;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const stroke = () => {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = '#4A6AF0';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  };
  if (kind !== 'entrance') {
    if (kind === 'area') traceRing(c, points);
    else tracePolyline(c, points);
    stroke();
  }
  if (kind !== 'area') {
    ctx.beginPath();
    const radius = kind === 'entrance' ? 12 : 6;
    for (const point of points) {
      const { x, y } = planPointToPixel(point, viewport);
      ctx.moveTo(x + radius, y);
      ctx.arc(x, y, radius, 0, Math.PI * 2);
    }
    stroke();
  }
  ctx.restore();
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
 * 2026-11-14 用户指令「建筑给室内分区」：建筑足迹 = 室内禁区，深灰块 + 名称标注。
 * 排物件/排支线自动避开；画在分区层之下（分区半透明色块压上去仍可辨）。
 */
export function drawBuildingLayer(
  c: PlanCanvasContext,
  buildings: readonly { id: string; name?: string | undefined; points: readonly PlanPoint[] }[],
): void {
  const { ctx } = c;
  for (const building of buildings) {
    if (building.points.length < 3) continue;
    traceRing(c, building.points);
    ctx.fillStyle = "rgba(46,52,64,0.62)";
    ctx.fill();
    ctx.strokeStyle = "rgba(232,238,244,0.75)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const label = zoneLabelPixel(c, building.points);
    if (label) {
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(236,241,246,0.92)";
      ctx.fillText(building.name || "室内 · 禁区", label.x, label.y);
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
    // 2026-11-14 用户报「2D 分区全绿、3D 正常」：2D 图层此前回落到单一图层绿，
    // 面板/图例/3D 用的是语义色板——补齐同一套回落（zone.color ?? 语义色 ?? 图层色）。
    semantic?: PlanningZoneSemantic | undefined;
    opacity?: number | undefined;
    warning?: boolean | undefined;
  }[],
): void {
  const { ctx } = c;
  for (const zone of zones) {
    if (zone.polygon.length < 3) continue;
    const fill = zone.color ?? defaultZoneColor(zone.semantic ?? "reserved") ?? PLANNING_LAYER_COLORS.zone;
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
    /** 2026-11-11 OnePlan Bench Styling：物件可带自己的颜色/透明度（缺省回落图层色/1）。 */
    color?: string | undefined;
    opacity?: number | undefined;
    /** 2026-11-12 描边样式（OnePlan 同款三态+无描边）：缺省实线；警示态仍优先红虚线。 */
    strokeStyle?: 'solid' | 'dashed' | 'dotted' | 'none' | undefined;
  }[],
  opts: { selectedId?: string | null; /** 2026-11-12 B3 组选：多选件同样画白圈（名称标签仍只给单选）。 */ selectedIds?: readonly string[] | null } = {},
): void {
  const { ctx, viewport } = c;
  const color = PLANNING_LAYER_COLORS.facility;
  const metersPerPx = planMetersPerPixel(viewport);
  for (const f of facilities) {
    const center = planPointToPixel(f.position, viewport);
    const w = Math.max(4, f.size.width / metersPerPx);
    const h = Math.max(4, f.size.depth / metersPerPx);
    // 2026-11-11 OnePlan Bench Styling：设施可带自己的颜色/透明度（缺省回落图层色）。
    const own = f.color ?? color;
    const fillAlpha = 0.16 * (f.opacity ?? 1);
    ctx.save();
    ctx.translate(center.x, center.y);
    // 屏幕系 y 向下故取负角；地面语义与 facilityFootprintRing 同一套矩阵：
    // rotationDeg 以东为零、逆时针为正（+90° 时宽边从东转向北）。
    ctx.rotate(-f.rotationDeg * Math.PI / 180);
    ctx.fillStyle = hexWithAlpha(own, fillAlpha);
    ctx.fillRect(-w / 2, -h / 2, w, h);
    if (f.warning) {
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(-w / 2, -h / 2, w, h);
    } else if (f.strokeStyle !== 'none') {
      ctx.strokeStyle = own;
      ctx.lineWidth = 1.2;
      // 2026-11-12 描边三态+无描边：实线/虚线/点线；restore 会复位 dash。
      ctx.setLineDash(f.strokeStyle === 'dashed' ? [6, 4] : f.strokeStyle === 'dotted' ? [1.6, 3.2] : []);
      ctx.strokeRect(-w / 2, -h / 2, w, h);
    }
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
    } else if (opts.selectedIds && f.id && opts.selectedIds.includes(f.id)) {
      // 2026-11-12 B3 组选：白圈同款（无名称标签，多选时不糊一地字）。
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.rotate(-f.rotationDeg * Math.PI / 180);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6);
      ctx.restore();
    }
  }
}

/**
 * 室内 3D 场景的落位投影（2026-11-11 统一视图）：把「物料 + 场地实景扫描」
 * 的平面落位（plan-item-bridge 算出的 ENU 米制框）画到户外 2D 画布上。
 *
 * 口径与 drawFacilityLayer 一致：中心点走 planPointToPixel、尺寸按米/像素换算、
 * 旋转矩阵同源（屏幕 y 向下故取负角）。
 * - 物料（item）：半透明填充 + 实线描边 + 下方名称（名字过长就不画，避免糊成一片）。
 * - 实景扫描（scene）：只画虚线轮廓（它是底，不遮盖上面的物料），中心一个标签。
 *
 * 这些对象是**只读展示**：不参与命中测试/交互，不写进 plan，也不导出任何句柄。
 */
export function drawSceneObjectsLayer(c: PlanCanvasContext, objects: readonly PlanSceneObject[]): void {
  if (objects.length === 0) return;
  const { ctx, viewport } = c;
  const metersPerPx = planMetersPerPixel(viewport);
  for (const obj of objects) {
    const center = planPointToPixel(obj.center, viewport);
    const w = Math.max(4, obj.width / metersPerPx);
    const h = Math.max(4, obj.depth / metersPerPx);
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(-obj.rotationDeg * Math.PI / 180);
    if (obj.kind === 'scene') {
      // 实景扫描：虚线轮廓 + 不填充（它垫在物料底下）。
      ctx.setLineDash([8, 5]);
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = hexWithAlpha(obj.color, 0.14);
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
    }
    ctx.restore();
    if (obj.kind === 'scene') {
      // 场景标签：中心对齐（实景扫描本身通常没有名称，过长的兜底截断）。
      const label = obj.name.length > 16 ? `${obj.name.slice(0, 15)}…` : obj.name;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(15,22,32,0.85)';
      ctx.fillText(label, center.x, center.y);
    } else if (obj.name.trim().length <= 12) {
      // 物料名称：画在占地框下方（名字太长就不画，免得相互压字）。
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(15,22,32,0.85)';
      ctx.fillText(obj.name, center.x, center.y + Math.max(h / 2, 6) + 3);
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
    /** 2026-11-12 活动包预设：动线主题色（缺省按 kind 取 tokens 色）。 */
    color?: string | undefined;
  }[],
): void {
  const { ctx } = c;
  for (const r of routes) {
    if (r.points.length < 2) continue;
    // 2026-11-12 活动包赛道预设：动线自带主题色时优先（契约 planRouteSchema.color）。
    const color = r.color ?? PLANNING_ROUTE_KIND_COLORS[r.kind as PlanningRouteKind];
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
  workers: readonly { id?: string; position: PlanPoint; count: number; role: string; selected?: boolean; warning?: boolean; /** 2026-11-12 活动包点位：契约 planWorkerSchema.color，缺省取 tokens 人员色。 */ color?: string | undefined }[],
): void {
  const { ctx, viewport } = c;
  const color = PLANNING_LAYER_COLORS.worker;
  for (const w of workers) {
    const pt = planPointToPixel(w.position, viewport);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = hexWithAlpha(w.color ?? color, 0.85);
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

/* ---------------- 测量标注（H3-a） ---------------- */

/**
 * 固定测量标注：距离 = 虚线段 + 段长标注；路径 = 虚线折线 + 总长标注；
 * 面积 = 半透明填充环 + 面积标注。读数一律从米制几何现算（measureValue），
 * 缩放不影响数值——「缩放后结果一致」的验收口径。
 */
export function drawMeasureLayer(
  c: PlanCanvasContext,
  measurements: readonly {
    id?: string;
    kind: 'distance' | 'area' | 'path';
    points: readonly PlanPoint[];
    selected?: boolean;
  }[],
): void {
  const { ctx } = c;
  const color = PLANNING_LAYER_COLORS.measure;
  for (const m of measurements) {
    if (m.points.length < 2) continue;
    if (m.kind === 'area' && m.points.length < 3) continue;
    if (m.kind === 'area') {
      traceRing(c, m.points);
      ctx.fillStyle = hexWithAlpha(color, 0.12);
      ctx.fill();
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.restore();
      const label = zoneLabelPixel(c, m.points);
      if (label) drawMeasureLabel(c, formatAreaM2(measureValue(m)), label.x, label.y);
    } else {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 5]);
      tracePolyline(c, m.points);
      ctx.stroke();
      ctx.restore();
      // 端点小方块（起点/终点）。
      for (const p of [m.points[0]!, m.points[m.points.length - 1]!]) {
        const pt = planPointToPixel(p, c.viewport);
        ctx.fillStyle = color;
        ctx.fillRect(pt.x - 2.5, pt.y - 2.5, 5, 5);
      }
      const label = measureLabelPixel(c, m.points);
      if (label) drawMeasureLabel(c, formatLengthM(measureValue(m)), label.x, label.y);
    }
  }
}

/**
 * 测量草稿（临时测量）：已收点虚线 + 顶点方块 + 指针橡皮筋，随指针画实时读数
 * （距离=当前段长、路径=累计总长、面积=按当前点闭合的预览面积）；面积 ≥3 点时
 * 首点画闭合热区圆圈提示。
 */
export function drawMeasureDraft(
  c: PlanCanvasContext,
  draft: readonly PlanPoint[],
  kind: PlanMeasureKind,
  cursorPoint?: PlanPoint,
): void {
  const { ctx } = c;
  const color = PLANNING_LAYER_COLORS.measure;
  if (draft.length >= 2) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    if (kind === 'area' && draft.length >= 3) {
      traceRing(c, draft);
    } else {
      tracePolyline(c, draft);
    }
    ctx.stroke();
    ctx.restore();
  }
  if (cursorPoint && draft.length >= 1) {
    const last = planPointToPixel(draft[draft.length - 1]!, c.viewport);
    const cursor = planPointToPixel(cursorPoint, c.viewport);
    ctx.save();
    ctx.strokeStyle = hexWithAlpha(color, 0.55);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(cursor.x, cursor.y);
    ctx.stroke();
    ctx.restore();
  }
  for (const p of draft) {
    const pt = planPointToPixel(p, c.viewport);
    ctx.fillStyle = color;
    ctx.fillRect(pt.x - 3, pt.y - 3, 6, 6);
  }
  if (kind === 'area' && draft.length >= 2 && (cursorPoint || draft.length >= 3)) {
    // 面积闭合提示：首点画圆圈（与边界/分区草稿同口径）。
    const first = planPointToPixel(draft[0]!, c.viewport);
    ctx.beginPath();
    ctx.arc(first.x, first.y, 9, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  const readout = measureDraftReadout(kind, draft, cursorPoint);
  if (readout) {
    // 读数跟指针（有指针时）或最后一个已收点，深色底衬保证在瓦片上可读。
    const anchor = cursorPoint ?? draft[draft.length - 1]!;
    const pt = planPointToPixel(anchor, c.viewport);
    drawMeasureLabel(c, readout, pt.x + 12, pt.y - 14);
  }
}

/* ---------------- 2026-11-11 用户指令：自由标注（文本 + 形状） ---------------- */

/** 文本标注：深底圆角 pill + 白字（多行），深浅底图都读得清；选中加白描边。 */
function drawAnnotationNote(
  c: PlanCanvasContext,
  at: PlanPoint,
  text: string,
  color: string,
  selected: boolean,
): void {
  const { ctx, viewport } = c;
  const pt = planPointToPixel(at, viewport);
  const lines = text.split('\n').slice(0, 6);
  ctx.font = '12px system-ui, sans-serif';
  const width = Math.max(...lines.map(l => ctx.measureText(l).width), 8) + 16;
  const height = lines.length * 16 + 10;
  const x = pt.x - width / 2;
  const y = pt.y - height / 2;
  const radius = 6;
  ctx.save();
  if (selected) {
    ctx.beginPath();
    ctx.roundRect(x - 2.5, y - 2.5, width + 5, height + 5, radius + 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    ctx.fillText(line, pt.x, y + 5 + 8 + i * 16);
  });
  ctx.restore();
}

/**
 * 固定自由标注（2026-11-11 用户指令）：形状 = 半透明填充 + 实线描边（线段无填充），
 * 文本 = 深底 pill。图形一律从米制几何现算，缩放不变形；选中加白描边（与动线同口径）。
 */
/** 标注形状描边像素档位：thin 细线（旧数据缺省同此口径）/ thick 粗线；文本备注不取线宽。 */
export function annotationStrokeWidthPx(width?: PlanAnnotation['strokeWidth']): number {
  return width === 'thick' ? 3.5 : 2;
}

export function drawAnnotationLayer(
  c: PlanCanvasContext,
  annotations: readonly (Pick<PlanAnnotation, 'kind' | 'points' | 'radiusM' | 'text' | 'name' | 'color' | 'strokeWidth'> & { selected?: boolean })[],
): void {
  const { ctx, viewport } = c;
  for (const a of annotations) {
    const color = a.color ?? PLANNING_LAYER_COLORS.annotate;
    const selected = a.selected === true;
    if (a.kind === 'note') {
      drawAnnotationNote(c, a.points[0]!, a.text || a.name, color, selected);
      continue;
    }
    ctx.save();
    if (a.kind === 'circle') {
      const center = planPointToPixel(a.points[0]!, viewport);
      const rPx = (a.radiusM ?? 0) / planMetersPerPixel(viewport);
      if (rPx < 1) { ctx.restore(); continue; }
      ctx.beginPath();
      ctx.arc(center.x, center.y, rPx, 0, Math.PI * 2);
    } else if (a.kind === 'line') {
      ctx.beginPath();
      const from = planPointToPixel(a.points[0]!, viewport);
      const to = planPointToPixel(a.points[1]!, viewport);
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
    } else {
      const ring = a.kind === 'rect' ? annotationRectRing(a.points[0]!, a.points[1]!) : a.points;
      traceRing(c, ring);
    }
    if (selected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4.5;
      ctx.stroke();
    }
    if (a.kind !== 'line') {
      ctx.fillStyle = hexWithAlpha(color, 0.14);
      ctx.fill();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = annotationStrokeWidthPx(a.strokeWidth);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * 形状草稿（2026-11-11 用户指令）：rect/circle/line 拖拽中画实时预览（起点 + 指针），
 * 三角形按已收点画虚线 + 指针橡皮筋；顶点小方块与测量草稿同口径。
 */
export function drawAnnotationDraft(
  c: PlanCanvasContext,
  draft: readonly PlanPoint[],
  kind: PlanShapeKind,
  cursorPoint?: PlanPoint,
  /** 草稿预览沿用当前选中色/描边档位；缺省标注紫 + 细线（旧口径）。 */
  previewColor?: string,
  previewStrokeWidth?: PlanAnnotation['strokeWidth'],
): void {
  const { ctx } = c;
  const color = previewColor ?? PLANNING_LAYER_COLORS.annotate;
  const lineWidth = annotationStrokeWidthPx(previewStrokeWidth);
  if (kind === 'triangle') {
    // 三角形：已收点虚线相连 + 顶点方块 + 指针橡皮筋（与测量面积草稿同手感）。
    if (draft.length >= 2) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash([8, 5]);
      tracePolyline(c, draft);
      ctx.stroke();
      ctx.restore();
    }
    if (cursorPoint && draft.length >= 1) {
      const last = planPointToPixel(draft[draft.length - 1]!, c.viewport);
      const cursor = planPointToPixel(cursorPoint, c.viewport);
      ctx.save();
      ctx.strokeStyle = hexWithAlpha(color, 0.55);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(cursor.x, cursor.y);
      ctx.stroke();
      ctx.restore();
    }
    for (const p of draft) {
      const pt = planPointToPixel(p, c.viewport);
      ctx.fillStyle = color;
      ctx.fillRect(pt.x - 3, pt.y - 3, 6, 6);
    }
    return;
  }
  // rect/circle/line：起点 + 指针（拖拽中起点已在 draft[0]，预览用指针补第二角）。
  const a = draft[0];
  const b = draft.length >= 2 ? draft[1] : cursorPoint;
  if (!a || !b) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([6, 4]);
  if (kind === 'rect') {
    traceRing(c, annotationRectRing(a, b));
    ctx.stroke();
  } else if (kind === 'circle') {
    const center = planPointToPixel(a, c.viewport);
    const rPx = Math.hypot(b.x - a.x, b.y - a.y) / planMetersPerPixel(c.viewport);
    if (rPx >= 1) {
      ctx.beginPath();
      ctx.arc(center.x, center.y, rPx, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    const from = planPointToPixel(a, c.viewport);
    const to = planPointToPixel(b, c.viewport);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  ctx.restore();
  for (const p of [a]) {
    const pt = planPointToPixel(p, c.viewport);
    ctx.fillStyle = color;
    ctx.fillRect(pt.x - 3, pt.y - 3, 6, 6);
  }
}

/* ---------------- 冲突/缺失可定位标记（H3-b） ---------------- */

/**
 * 冲突与缺失标记（H3-b）：在每个可定位问题点上画「白圈 + 状态色圆点 + 感叹号」徽章。
 * 颜色按状态取 tokens（冲突红/缺失橙/待核实灰）；标记是规则检查输出，
 * 恒在业务层之上（不随业务图层隐藏），点击命中判定由组件按同半径做。
 */
export function drawConflictMarkers(
  c: PlanCanvasContext,
  conflicts: readonly { key: string; status: 'conflict' | 'missing' | 'unverified'; at: PlanPoint }[],
  opts: { highlightKey?: string | null } = {},
): void {
  const { ctx, viewport } = c;
  for (const conflict of conflicts) {
    const pt = planPointToPixel(conflict.at, viewport);
    const color = PLANNING_CONFLICT_COLORS[conflict.status];
    const highlighted = opts.highlightKey === conflict.key;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, highlighted ? 10 : 8, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = highlighted ? 2 : 1.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('!', pt.x, pt.y + 0.5);
  }
}

/* ---------------- 搜地点定位钉（B：地图搜索落点） ---------------- */

/**
 * 地图上的名称徽标：白底 + 细描边 + 轻投影 + 深字（2026-11-12 用户反馈定位钉视觉太丑——
 * 原来是纯黑胶囊压在白底地图上像贴纸）。深浅底图上都有清晰轮廓，也不抢底图色块。
 * `bottom` 是胶囊底边 y；超宽用省略号截断（measureText 精确到像素）。
 */
function drawMapLabelPill(ctx: CanvasRenderingContext2D, cx: number, bottom: number, text: string, canvasW?: number): void {
  ctx.save();
  ctx.font = '11px system-ui, sans-serif';
  const maxWidth = 240;
  let shown = text;
  if (ctx.measureText(shown).width + 20 > maxWidth) {
    let cut = text.length;
    while (cut > 1 && ctx.measureText(`${text.slice(0, cut)}…`).width + 20 > maxWidth) cut -= 1;
    shown = `${text.slice(0, cut)}…`;
  }
  const width = Math.min(maxWidth, Math.ceil(ctx.measureText(shown).width) + 20);
  const height = 20;
  // 靠近画布左右缘时把胶囊往里挪一点，别被裁成半个圆角。
  const clampedX = canvasW && canvasW > width + 8
    ? Math.min(Math.max(cx, width / 2 + 4), canvasW - width / 2 - 4)
    : cx;
  const x = clampedX - width / 2;
  const y = bottom - height;
  ctx.shadowColor = 'rgba(20,20,22,0.16)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 10);
  ctx.fillStyle = 'rgba(255,255,255,0.98)';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.roundRect(x + 0.5, y + 0.5, width - 1, height - 1, 9.5);
  ctx.strokeStyle = 'rgba(20,20,22,0.14)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#141416';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(shown, clampedX, y + height / 2 + 0.5);
  ctx.restore();
}

/**
 * V-2d：流线提案预览层（虚线 + 出入口圆点）——应用前不进 plan、不参与统计，
 * 纯视图辅助（与搜地点钉同语义）。三类各用一色虚线，出入口黑圆白环「口」标。
 */
export function drawRouteProposalLayer(
  c: PlanCanvasContext,
  proposal: { routes: Pick<PlanRoute, 'kind' | 'points'>[]; nodes: Pick<PlanNode, 'kind' | 'position'>[] },
): void {
  const { ctx, viewport } = c;
  ctx.save();
  ctx.lineWidth = 2.5;
  ctx.setLineDash([9, 7]);
  for (const route of proposal.routes) {
    ctx.strokeStyle = ROUTE_PROPOSAL_COLORS[route.kind] ?? ROUTE_PROPOSAL_COLORS.pedestrian!;
    ctx.beginPath();
    route.points.forEach((point, index) => {
      const px = planPointToPixel(point, viewport);
      if (index === 0) ctx.moveTo(px.x, px.y);
      else ctx.lineTo(px.x, px.y);
    });
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.font = '600 10px Inter, system-ui, sans-serif';
  for (const node of proposal.nodes) {
    const px = planPointToPixel(node.position, viewport);
    ctx.beginPath();
    ctx.arc(px.x, px.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20, 20, 22, 0.82)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('口', px.x, px.y + 0.5);
  }
  ctx.restore();
}

/** 提案预览用色：蓝=车行 绿=人行 琥珀=后勤。 */
export const ROUTE_PROPOSAL_COLORS: Record<PlanRoute['kind'], string> = {
  vehicle: '#0668e5',
  pedestrian: '#1a9e5c',
  service: '#b7791f',
};

/**
 * V-3c：区域提案预览层（虚线矩形 + 语义名 + 物料幽灵块）——应用前不进 plan、不参与统计，
 * 纯视图辅助。zone 虚线用提案自带色，物料画半透明幽灵矩形（与放置幽灵同语义）。
 */
export function drawZoneProposalLayer(
  c: PlanCanvasContext,
  proposal: {
    zones: Pick<PlanZone, 'semantic' | 'name' | 'polygon' | 'color' | 'event'>[];
    facilities: Pick<PlanFacility, 'name' | 'position' | 'size'>[];
  },
): void {
  const { ctx, viewport } = c;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  for (const zone of proposal.zones) {
    ctx.strokeStyle = zone.color ?? '#5a6472';
    ctx.beginPath();
    zone.polygon.forEach((point, index) => {
      const px = planPointToPixel(point, viewport);
      if (index === 0) ctx.moveTo(px.x, px.y);
      else ctx.lineTo(px.x, px.y);
    });
    ctx.closePath();
    ctx.stroke();
    const first = planPointToPixel(zone.polygon[0]!, viewport);
    ctx.setLineDash([]);
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.fillStyle = zone.color ?? '#5a6472';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(zone.event ?? zone.name, first.x + 4, first.y - 4);
    ctx.setLineDash([8, 6]);
  }
  ctx.setLineDash([]);
  for (const facility of proposal.facilities) {
    const px = planPointToPixel(facility.position, viewport);
    const w = facility.size.width / planMetersPerPixel(viewport);
    const h = facility.size.depth / planMetersPerPixel(viewport);
    ctx.fillStyle = 'rgba(20, 20, 22, 0.28)';
    ctx.fillRect(px.x - w / 2, px.y - h / 2, w, h);
    ctx.strokeStyle = 'rgba(20, 20, 22, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px.x - w / 2, px.y - h / 2, w, h);
  }
  ctx.restore();
}

/**
 * V-4b：流动模拟层（行人点沿流线移动 + 密度着色）——纯视图动画，不写 plan。
 * 密度=每 10m 点数：浅(<0.8)→深(>1.6) 两档间用 alpha 插值，色随流线类别。
 */
export function drawFlowSimulationLayer(
  c: PlanCanvasContext,
  sim: {
    routes: Pick<PlanRoute, 'kind' | 'points'>[];
    walkerPoints: PlanPoint[];
    density: number[];
  },
): void {
  const { ctx, viewport } = c;
  ctx.save();
  sim.routes.forEach((route, index) => {
    const density = sim.density[index] ?? 0;
    // 密度 alpha：0.25（稀）→ 0.85（密），在 0.8–1.6 人/10m 区间线性插值
    const ratio = Math.max(0, Math.min(1, (density - 0.8) / 0.8));
    ctx.globalAlpha = 0.25 + ratio * 0.6;
    ctx.lineWidth = 2.5 + ratio * 2;
    ctx.strokeStyle = ROUTE_PROPOSAL_COLORS[route.kind] ?? ROUTE_PROPOSAL_COLORS.pedestrian!;
    ctx.beginPath();
    route.points.forEach((point, i) => {
      const px = planPointToPixel(point, viewport);
      if (i === 0) ctx.moveTo(px.x, px.y);
      else ctx.lineTo(px.x, px.y);
    });
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(20, 20, 22, 0.85)';
  for (const point of sim.walkerPoints) {
    const px = planPointToPixel(point, viewport);
    ctx.beginPath();
    ctx.arc(px.x, px.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 搜地点定位钉：白色水滴针（细描边 + 轻投影 + 针心黑点）+ 白底名称标签。
 * 只是视图辅助——不写进 plan，不参与统计/交付/冲突判定，换搜索或关掉即消失。
 */
export function drawSearchPin(c: PlanCanvasContext, pin: { point: PlanPoint; label: string }): void {
  const { ctx, viewport } = c;
  const pt = planPointToPixel(pin.point, viewport);
  const headY = pt.y - 7;
  const r = 7.5;
  ctx.save();
  // 水滴形：从圆头左下起笔，绕顶到右下，再用两段贝塞尔收成针尖（尖端落在真实坐标上）。
  // 2026-11-13 用户嫌「大头黑点」笨重：头 8→7.5、针心 3.2→2.4、尾巴收细。
  ctx.beginPath();
  ctx.moveTo(pt.x - 6.35, headY + 4.1);
  ctx.arc(pt.x, headY, r, Math.PI * 0.82, Math.PI * 0.18);
  ctx.quadraticCurveTo(pt.x + 4.8, headY + 8.2, pt.x, pt.y + 8.5);
  ctx.quadraticCurveTo(pt.x - 4.8, headY + 8.2, pt.x - 6.35, headY + 4.1);
  ctx.closePath();
  ctx.shadowColor = 'rgba(20,20,22,0.22)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 1.8;
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  // 描边加深（0.14→0.3）：白底/纸面模式下白针身不能只剩一枚黑点浮着。
  ctx.strokeStyle = 'rgba(20, 20, 22, 0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 针心：小实心点，标出「就是这里」。
  ctx.beginPath();
  ctx.arc(pt.x, headY + 0.5, 2.4, 0, Math.PI * 2);
  ctx.fillStyle = '#141416';
  ctx.fill();
  ctx.restore();
  // 名称标签：白底细边，挂在针头上方留 6px 呼吸，不压住针身与底图信息。
  drawMapLabelPill(ctx, pt.x, headY - r - 6, pin.label, viewport.canvasW);
}

/* ---------------- 搜地点选区（行政区边界，视图辅助） ---------------- */

/**
 * 搜地点选区：高德同款视觉——半透明蓝填充 + 粗蓝虚线描边 + 顶部名称标签。
 * 2026-11-12 用户反馈「很多地图上看不清」（旧样式=6% 暗色填充+1.5px 深灰虚线，
 * 在暗色图/影像图上几乎不可见）→ 改成高德范式：填充是主识别层，矢量/暗色/影像
 * 底图上都成立；行政区选区与 POI 范围共用本函数，观感一致。
 * 和定位钉同性质——只帮人看清「这块地到哪儿为止」，不写进 plan，
 * 不参与统计/交付/冲突判定，换搜索或关掉即消失。
 */
export function drawSearchArea(c: PlanCanvasContext, area: { points: readonly PlanPoint[]; label: string; showLabel?: boolean; kind?: 'area' | 'line' }): void {
  if (area.points.length < (area.kind === 'line' ? 2 : 3)) return;
  const { ctx, viewport } = c;
  const px = area.points.map(p => planPointToPixel(p, viewport));
  ctx.save();
  ctx.beginPath();
  px.forEach((pt, index) => {
    if (index === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  });
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (area.kind === 'line') {
    // 2026-11-13「点道路=道路选区」：开放折线画高德式粗线高亮，不闭合成面。
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.stroke();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#4A6AF0';
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.closePath();
    ctx.fillStyle = 'rgba(84, 106, 240, 0.15)';
    ctx.fill();
    // 2026-11-13 用户反馈「视觉不和谐」→ 高德同款三细节：①虚线下先走一道白衬实线，
    // 把选区从粉彩/影像/暗色底图上托起来；②线降细降饱和（3px 电蓝 → 2.5px 柔蓝）；
    // ③轮廓服务端已做轻抽稀（simplifyRingMeters），不再放大楼宇级锯齿。
    ctx.lineWidth = 4.25;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.stroke();
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#4A6AF0';
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  // 2026-11-13 用户拍板：POI 出框后中心同时挂着定位钉（钉上胶囊已带名称），
  // 选区自己的顶部标签让位，避免同名两枚胶囊；行政区选区无钉，标签照常。
  if (area.showLabel === false) return;
  // 名称标签挂在选区最高点上方（顶边中点），不挡图形本身；与定位钉同一套白底徽标。
  let top = px[0]!;
  let sumX = 0;
  for (const pt of px) {
    if (pt.y < top.y) top = pt;
    sumX += pt.x;
  }
  const labelX = Math.min(Math.max(sumX / px.length, 40), viewport.canvasW - 40);
  drawMapLabelPill(ctx, labelX, top.y - 4, area.label, viewport.canvasW);
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

/** 测量标注锚点：两点取段中点，多点取中点顶点（与折线标注同口径）。 */
function measureLabelPixel(
  c: PlanCanvasContext,
  points: readonly PlanPoint[],
): { x: number; y: number } | null {
  if (points.length === 2) {
    const a = planPointToPixel(points[0]!, c.viewport);
    const b = planPointToPixel(points[1]!, c.viewport);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  return polylineLabelPixel(c, points);
}

/** 测量读数标签：深色半透明底衬 + 青色文字（宽按文本长度估算，不依赖 measureText）。 */
function drawMeasureLabel(c: PlanCanvasContext, text: string, x: number, y: number): void {
  const { ctx } = c;
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = text.length * 7 + 10;
  ctx.fillStyle = 'rgba(15,22,32,0.78)';
  ctx.fillRect(x - w / 2, y - 9, w, 18);
  ctx.fillStyle = PLANNING_LAYER_COLORS.measure;
  ctx.fillText(text, x, y);
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
