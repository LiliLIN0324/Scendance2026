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

import { PLANNING_BOUNDARY_LINE_COLOR, PLANNING_CONFLICT_COLORS, PLANNING_LAYER_COLORS, PLANNING_MEASURE_COLORS, PLANNING_NODE_KIND_COLORS, PLANNING_ROUTE_KIND_COLORS, type PlanningLayerKind, type PlanningRouteKind } from '@/lib/outdoor-plan-tokens';
import { axisToScreen, screenToAxis } from './outdoor-canvas-rotation';
import { annotationRectRing, type PlanShapeKind } from './site-plan-annotate';
import { planZoneFillAlpha, defaultZoneColor } from './site-plan-editing';
import { facilityFootprintRing, facilityPlacementIssues } from './site-plan-facilities';
import { formatAreaM2, formatLengthM, measureDraftReadout, measureValue, type PlanMeasureKind } from './site-plan-measure';
import { metersPerDegreeLng } from './tdt-probe-scale';
import type { PlanSceneObject } from './plan-item-bridge';
import type { PlanAnnotation, PlanFacility, PlanNode, PlanPoint, PlanRoute, PlanZone } from '../../../../supabase/functions/_shared/site-plan';
import type { PlanningZoneSemantic } from '@/lib/outdoor-plan-tokens';

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
  /**
   * 2026-11-16 用户指令「2D 的时候罗盘也要能转」：地图方位角（弧度，顺时针为正，
   * 0 = 正北朝上）——与 3D 相机 bearing 同一口径，罗盘针屏幕转角 = -bearing。
   * 缺省 0（正北朝上），全部旧调用方与测试行为逐像素不变。
   * 投影把 bearing 烘进 planPointToPixel/planPixelToPoint 绕画布中心旋转，
   * 全部业务图层绘制与命中测试自动跟随（全项目单一变换点）。
   */
  bearing?: number;
}

/** 屏幕点绕画布中心旋转 angle（弧度）。正变换（轴→屏）用 -bearing，逆变换（屏→轴）用 +bearing。 */
function rotateScreenAroundCenter(px: { x: number; y: number }, viewport: PlanViewport, angle: number): { x: number; y: number } {
  if (!angle) return px;
  const cx = viewport.canvasW / 2;
  const cy = viewport.canvasH / 2;
  const dx = px.x - cx;
  const dy = px.y - cy;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** ENU 米制点 → 画布 CSS 像素点（含 y 轴翻转：北向上；bearing≠0 时绕画布中心旋转）。 */
export function planPointToPixel(p: PlanPoint, viewport: PlanViewport): { x: number; y: number } {
  const metersPerPx = planMetersPerPixel(viewport);
  const originPx = planAnchorPixel(viewport);
  return rotateScreenAroundCenter(
    { x: originPx.x + p.x / metersPerPx, y: originPx.y - p.y / metersPerPx },
    viewport,
    -(viewport.bearing ?? 0),
  );
}

/** 画布 CSS 像素点 → ENU 米制点（planPointToPixel 的逆映射，H2-b 绘制/顶点编辑取点用）。 */
export function planPixelToPoint(px: { x: number; y: number }, viewport: PlanViewport): PlanPoint {
  const metersPerPx = planMetersPerPixel(viewport);
  const originPx = planAnchorPixel(viewport);
  const axis = rotateScreenAroundCenter(px, viewport, viewport.bearing ?? 0);
  return {
    x: (axis.x - originPx.x) * metersPerPx,
    y: (originPx.y - axis.y) * metersPerPx,
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

/**
 * 已放置物件面板的红线计数。
 * `plan.boundary` 仍是红线正源；它为空时，地图上已经看得见的闭合范围
 *（核对预览，或搜索选区）也算「有范围」，面板不要再写「还没画红线」。
 * 道路折线（kind = line）不是闭合用地，不计入。
 */
export function placedRedlineCount(input: {
  boundaryCount: number;
  searchArea?: { polygon: readonly unknown[]; kind?: 'area' | 'line' } | null | undefined;
  previewBoundaryCount?: number | undefined;
}): number {
  if (input.boundaryCount > 0) return input.boundaryCount;
  if ((input.previewBoundaryCount ?? 0) >= 3) return input.previewBoundaryCount ?? 0;
  const area = input.searchArea;
  if (area && area.kind !== 'line' && area.polygon.length >= 3) return area.polygon.length;
  return 0;
}

/** 没有任何红线、也没有可核对的可见闭合范围时，才提示去画红线。 */
export function placedItemsNeedsRedlineHint(input: {
  boundaryCount: number;
  searchArea?: { polygon: readonly unknown[]; kind?: 'area' | 'line' } | null | undefined;
  previewBoundaryCount?: number | undefined;
}): boolean {
  return placedRedlineCount(input) === 0;
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
  /** 底图是否为深色（卫星/深色地图）：测量中性线在深底上转白。缺省按浅底。 */
  dark?: boolean;
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

/**
 * 边界描边的底图档位（2026-11-16 用户「就线非得是绿色的吗」）：
 *
 * 线本身**不再用品牌绿**——绿线在地图上和植被、分区同色系，永远在争层级。
 * 绿色只留在低透明填色上（“这块地是我们的”），线改中性色，保证任何底图都能读：
 *
 * - `light`：浅色矢量底图 → 深墨线（和地图文字同族，最稳，不需要晕）；
 * - `imagery`：影像/卫星 → 白线；
 * - `dark`：深色底图 → 白线（略窄）。
 */
export type BoundaryHaloTone = 'light' | 'imagery' | 'dark';

export function boundaryHaloStyle(
  tone: BoundaryHaloTone,
  opts: { locked?: boolean } = {},
): {
  halo: { color: string; width: number } | null;
  line: { color: string; width: number };
  fillAlpha: number;
} {
  const locked = opts.locked === true;
  // 2026-11-16 用户「做建筑设计会画一条用地红线」：三种底都统一成规划红实线，
  // 只按底图调深浅/粗细（影像上稍亮一档），不再浅底灰线 / 影像白线两套语汇。
  const red = (alpha: number) => hexWithAlpha(PLANNING_BOUNDARY_LINE_COLOR, alpha);
  if (tone === 'imagery') {
    return {
      halo: null,
      line: locked ? { color: red(0.68), width: 1.5 } : { color: red(0.96), width: 2.6 },
      fillAlpha: 0.16,
    };
  }
  if (tone === 'dark') {
    return {
      halo: null,
      line: locked ? { color: red(0.66), width: 1.4 } : { color: red(0.94), width: 2.4 },
      fillAlpha: 0.12,
    };
  }
  return {
    halo: null,
    // 浅色路网：红线稍微压一级（ 0.88 ），锁上再细一档、淡一档，保留地界但不抢业务层。
    line: locked ? { color: red(0.55), width: 1.3 } : { color: red(0.88), width: 2.2 },
    // 2026-11-16 用户「灰色的场地不够突出」：填充从 0.1 提到 0.14，让场地成为一块“底片”，
    // 而不是一层看不出存在的薄纱。
    fillAlpha: 0.14,
  };
}

/** 底图图源 → 双描边档位（影像/卫星走白晕，深色底图走白晕，其余走墨晕）。 */
export function boundaryHaloToneFor(source: string): BoundaryHaloTone {
  if (source === 'img' || source === 'amap-satellite') return 'imagery';
  if (source === 'carto-dark') return 'dark';
  return 'light';
}

/** 场地边界：按底图选画法（墨晕 + 品牌绿，或纯白线）+ 分档低透明填充，顶点实心方块。 */
export function drawBoundaryLayer(
  c: PlanCanvasContext,
  boundary: readonly PlanPoint[],
  opts: { vertexHandles?: boolean; vertexDots?: boolean; halo?: BoundaryHaloTone; locked?: boolean } = {},
): void {
  if (boundary.length < 3) return;
  const { ctx, viewport } = c;
  const color = PLANNING_LAYER_COLORS.boundary;
  const style = boundaryHaloStyle(opts.halo ?? 'light', { locked: opts.locked === true });
  // 2026-11-16：先铺面（场地“底片”）；三种底图都用地红线（规划红实线）。
  traceRing(c, boundary);
  ctx.fillStyle = hexWithAlpha(color, style.fillAlpha);
  ctx.fill();
  if (style.halo) {
    traceRing(c, boundary);
    ctx.strokeStyle = style.halo.color;
    ctx.lineWidth = style.halo.width;
    ctx.stroke();
  }
  // 2026-11-16 用户「灰色场地不够突出，建筑会画一条用地红线」：
  // 红线下面垫一圈白描边（宽度 +2.2）——压在浅色路网和深色影像上都能把线“柜”出来，
  // 碰到分区色块/划线也不会融进去；红线本身仍是实线，警示越界的红虚线不因此混淆。
  traceRing(c, boundary);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = style.line.width + 2.2;
  ctx.stroke();
  traceRing(c, boundary);
  ctx.strokeStyle = style.line.color;
  ctx.lineWidth = style.line.width;
  ctx.stroke();
  // 2026-11-16 用户「边角还是实心正方形，不过实心的在编辑模式可以大一些」：
  // 顶点统一实心方块——平时 5 px 当标记，可编辑（未锁）时 9 px 当手柄，形状不变只变大；
  // 编辑态再匀一圈白边，压在深绿描边上也能看清手点在哪。
  // 顶点方块跟随线的颜色（线换中性色后，方块也不能还绿着）。
  // 锁定时一律不画（锁上还挂可拖的小方块，看着就像没锁）。
  const dotColor = style.line.color;
  const drawDots = opts.vertexDots !== false && opts.locked !== true;
  const size = opts.vertexHandles ? 9 : 5;
  for (const p of boundary) {
    if (!opts.vertexHandles && !drawDots) continue;
    const pt = planPointToPixel(p, viewport);
    ctx.fillStyle = dotColor;
    ctx.fillRect(pt.x - size / 2, pt.y - size / 2, size, size);
    if (opts.vertexHandles) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(pt.x - size / 2, pt.y - size / 2, size, size);
    }
  }
}

/**
 * 设计范围「大陆」：框外白纱毛玻璃 + 四角 L 形角标（2026-11-15 用户指令）。
 *
 * 为什么不能只描一条线：用户要的是「一眼看出哪块地归这次设计」。只描边时，框外的
 * 市政道路和框内一样亮，视线不往框里收；框外做处理才建立起主次。
 *
 * 2026-11-15 第二次改口：整圈虚线太吵、盖住底图路网，改成只留四个角的 L 形短角标；
 * 蒙版本身已经说明边界在哪，角标只负责「这里有个可拖的框」。
 *
 * 2026-11-15 第三次改口（视觉定稿，用户原话「背景不要黑色，白色带一点模糊，L 边框改白」）：
 * 框外不再压黑，改成白色毛玻璃——底图先虚化、再压一层白纱，框内保持清晰，主次改由
 * 清晰度承担；角标同时改白色（底下垫一层很淡的墨色投影，压在浅色路面和水面上也看得见）。
 *
 * 蒙版只改显示、不改任何实体——`plan.designScope` 是唯一真值，点位坐标与流线一致，
 * 所以同一圈环既能当毛玻璃挖洞，也能当「这段流线算不算在设计区里」的判定环。
 * 画在业务图层最下面（边界/分区/设施之上不再叠加任何蒙版），保证框内可读性。
 */
export function drawDesignScopeMask(
  c: PlanCanvasContext,
  scope: readonly PlanPoint[],
  opts: {
    label?: string;
    /** 标签牌最多能伸到哪个 px（右边有锁定钮时用它避让，不要把字盖掉）。 */
    labelMaxRightPx?: number;
    /** 框外毛玻璃的取样源：底图 canvas（只糊底图，不糊业务层，否则流线会拖影）。 */
    frostSource?: { canvas: CanvasImageSource; cssWidth: number; cssHeight: number };
  } = {},
): void {
  if (scope.length < 3) return;
  const { ctx, viewport } = c;
  ctx.save();

  // 框外区域 = 整块视口 − 范围环，用 evenodd 挖洞（一次填，不留接缝）。
  const traceOutside = () => {
    ctx.beginPath();
    ctx.rect(0, 0, viewport.canvasW, viewport.canvasH);
    scope.forEach((p, i) => {
      const pt = planPointToPixel(p, viewport);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.closePath();
  };

  const frost = opts.frostSource;
  if (frost) {
    // 白色毛玻璃：先把框外那块底图「虚化」重画一遍，再压一层白纱。
    // 9 px 是「一点模糊」——再大就只剩色块，看不出框外是同一张地图。
    ctx.save();
    traceOutside();
    ctx.clip('evenodd');
    if ('filter' in ctx) {
      ctx.filter = 'blur(7px)';
      ctx.drawImage(frost.canvas, 0, 0, frost.cssWidth, frost.cssHeight);
      ctx.filter = 'none';
    }
    // 白纱只负责提亮：0.52 是「看得出这是同一张地图，但一眼就知道不重要」的那档，
    // 再高（0.7+）框外就真的白了，路网和树冠全丢，用户回头对不上位置。
    ctx.fillStyle = 'rgba(255, 255, 255, 0.52)';
    ctx.fillRect(0, 0, frost.cssWidth, frost.cssHeight);
    ctx.restore();
  } else {
    // 没有底图取样源（纸面模式 / 测试）：退化成纯白纱，仍然只改框外。
    traceOutside();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.fill('evenodd');
  }

  // 四角 L 形角标：只画角、不连线，范围的存在感降到最低。臂长随框大小伸缩。
  // 2026-11-17 罗盘拖转：角标几何在「轴对齐屏幕系」按旧数学算（AABB + 横竖臂），
  // 再把每个点绕画布中心转回真实屏幕——臂沿旋转后的框边走，不再飘在屏幕四角。
  const axisOf = (p: PlanPoint) => planPointToPixel(p, { ...viewport, bearing: 0 });
  const axisRing = scope.map(axisOf);
  const xs = axisRing.map(p => p.x);
  const ys = axisRing.map(p => p.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const arm = Math.max(14, Math.min(34, Math.min(right - left, bottom - top) * 0.18));
  ctx.setLineDash([]);
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  // 白色角标靠「淡墨投影」立起来，不靠加粗/加黑（用户要的是轻）。
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.98)';
  ctx.lineWidth = 3;
  ctx.shadowColor = 'rgba(10, 14, 20, 0.5)';
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 1;
  const brackets: [number, number, number, number][] = [
    [left, top, 1, 1],
    [right, top, -1, 1],
    [right, bottom, -1, -1],
    [left, bottom, 1, -1],
  ];
  for (const [x, y, sx, sy] of brackets) {
    ctx.beginPath();
    const elbow = axisToScreen({ x, y }, viewport);
    const armH = axisToScreen({ x: x + sx * arm, y }, viewport);
    const armV = axisToScreen({ x, y: y + sy * arm }, viewport);
    ctx.moveTo(armH.x, armH.y);
    ctx.lineTo(elbow.x, elbow.y);
    ctx.lineTo(armV.x, armV.y);
    ctx.stroke();
  }
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 2026-11-15 第三次定稿：角点不再画任何手柄圆点（用户「这个圆形的点完全没必要存在」）。
  // L 角标本身已经把「这里是角、能拖」说清楚了，圆点只是重复信息还叠加了一层灰。
  // 命中区不变：组件按四角外接矩形算 12 px 热区，画不画点都能拖。

  // 标签贴在上边中点上方：跟角标错开，不压线也不压角。
  // 底图上常有 POI 大字；12px 字用描边会被吃掉一半，改用白底小块 + 墨色字。
  // 白纱底色上纯白块会「没边」，垫一层极淡投影把牌子从毛玻璃里拎出来。
  if (opts.label) {
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    // 锚点在轴对齐系的「上边中点上方」，再转到真实屏幕（文字本身保持水平，好读）。
    const anchor = axisToScreen({ x: (left + right) / 2, y: Math.max(14, top - 8) }, viewport);
    const width = ctx.measureText(opts.label).width;
    // 右边有锁定钮时整体左移，保证牌不压到钮上。
    let chipLeft = anchor.x - width / 2 - 5;
    if (opts.labelMaxRightPx !== undefined) {
      chipLeft = Math.min(chipLeft, opts.labelMaxRightPx - (width + 10));
    }
    const textX = chipLeft + (width + 10) / 2;
    ctx.shadowColor = 'rgba(10, 14, 20, 0.2)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.fillRect(chipLeft, anchor.y - 14, width + 10, 17);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = DESIGN_SCOPE_INK;
    ctx.fillText(opts.label, textX, anchor.y);
  }
  ctx.restore();
}

/** 定稿角标用的是墨色：压暗层上黑线最干净，也不跟品牌绿/分区多色抢。 */
const DESIGN_SCOPE_INK = 'rgba(17, 19, 23, 0.9)';

/** 设计范围锁定钮的边长（px）与贴框间距。 */
export const SCOPE_LOCK_SIZE = 24;
const SCOPE_LOCK_GAP = 10;

/**
 * 锁定钮的位置：贴在框的右上角**外侧**（与标签、四角 L 都不叠）。
 *
 * 2026-11-15 用户指令「边框外加一个锁，默认不锁；锁了就不会误触边框」：
 * 钮不放在框里，是因为框内是作业区，多一个可点物就会抢拖拽；放框外就只剩「点它」一个含义。
 * 靠近画布边缘时向内夹住，避免钮跑出可视区。
 */
/**
 * 锁定钮的位置。默认贴在框的右上角**外侧**；`placement: 'inside'` 时放在**框内**
 * 右上角（即角的左下方向），给需要“一外一内”的两枚锁用。
 *
 * 2026-11-15 用户指令「边框外加一个锁，默认不锁；锁了就不会误触边框」：
 * 钮不放在框里，是因为框内是作业区，多一个可点物就会抢拖拽；放框外就只剩「点它」一个含义。
 * 2026-11-16 用户：「边界的锁放设计白框右上角的内侧」——于是第二枚锁走 inside。
 * 靠近画布边缘时向内夹住，避免钮跑出可视区。
 */
export function scopeLockButtonRect(
  ringPx: readonly { x: number; y: number }[],
  viewport: { canvasW: number; canvasH: number; bearing?: number },
  opts: { placement?: 'outside' | 'inside'; gap?: number } = {},
): { x: number; y: number; w: number; h: number; angle?: number } | null {
  if (ringPx.length < 3) return null;
  // 2026-11-17 罗盘拖转：入口 ringPx 允许是「已带旋转的屏幕投影」——先转回轴对齐系
  // 按旧数学定位，再把中心绕画布中心转回真实屏幕；bearing=0 时两步都是恒等，逐字节旧行为。
  const bearing = viewport.bearing ?? 0;
  const axisRing = bearing ? ringPx.map(point => screenToAxis(point, viewport)) : ringPx;
  const right = Math.max(...axisRing.map(point => point.x));
  const top = Math.min(...axisRing.map(point => point.y));
  const size = SCOPE_LOCK_SIZE;
  const gap = opts.gap ?? SCOPE_LOCK_GAP;
  let axisRect: { x: number; y: number; w: number; h: number };
  if (opts.placement === 'inside') {
    // 框内、贴右上角：角的左下方向，离两条边都是 gap。
    const x = Math.min(Math.max(4, right - size - gap), Math.max(4, viewport.canvasW - size - 4));
    const y = Math.min(Math.max(4, top + gap), Math.max(4, viewport.canvasH - size - 4));
    axisRect = { x, y, w: size, h: size };
  } else {
    const x = Math.min(Math.max(4, right + gap), Math.max(4, viewport.canvasW - size - 4));
    const y = Math.min(Math.max(4, top - size - gap), Math.max(4, viewport.canvasH - size - 4));
    axisRect = { x, y, w: size, h: size };
  }
  if (!bearing) return axisRect;
  // 旋转态：钮中心转到真实屏幕；命中区取「旋转方块的外接正方形」（24·√2 ≈ 34，取 36 留余量）。
  const center = axisToScreen({ x: axisRect.x + size / 2, y: axisRect.y + size / 2 }, viewport);
  const hitSide = Math.ceil(size * 1.5);
  return {
    x: Math.round(center.x - hitSide / 2),
    y: Math.round(center.y - hitSide / 2),
    w: hitSide,
    h: hitSide,
    angle: -bearing,
  };
}

/** 锁定钮矩形（px）。 */
type LockRect = { x: number; y: number; w: number; h: number };

/**
 * 两枚锁定钮靠得太近时别叠在一起：把后画的那枚整块下移到另一枚下方。
 *
 * 2026-11-16 用户「场地右上角也加一个小锁」：设计范围框和场地边界经常只差几米，
 * 两枚锁会落在同一处；叠着时只看得见上面那枚，点下去还容易锁错对象。
 */
export function avoidLockOverlap(rect: LockRect, avoid: LockRect | null, gap = 6): LockRect {
  if (!avoid) return rect;
  const overlap = rect.x < avoid.x + avoid.w
    && rect.x + rect.w > avoid.x
    && rect.y < avoid.y + avoid.h
    && rect.y + rect.h > avoid.y;
  return overlap ? { ...rect, y: avoid.y + avoid.h + gap } : rect;
}

/**
 * 场地边界的编辑提示（不改任何数据，只给手上反馈）：
 *
 * - 悬停到某个顶点：白底大号方框套在它外面 + `grab` 光标，告诉你「这个点能拖」；
 * - 悬停在边线上：投影点上来一颗白底 `+` 圆标，点它就加点（与分区同一套手感）；
 * - 两样都不在时什么都不画，不抢底图。
 *
 * 2026-11-16 用户：「你要补上一些交互提示」——之前只有静态的大方点，鼠标上去毫无变化，
 * 看不出哪里能拖、哪里能加点。
 */
export function drawBoundaryEditHints(
  c: PlanCanvasContext,
  boundary: readonly PlanPoint[],
  opts: {
    vertexHoverIndex?: number | null;
    /** 「已点一下、再点就删」的顶点：白框描边转琥珀色，作为删除预警。 */
    armedVertexIndex?: number | null;
    edgeHintPx?: { x: number; y: number } | null;
    color?: string;
    /** 预警色（默认琥珀 #d98324）：比正红柔和，不像报错。 */
    dangerColor?: string;
  } = {},
): void {
  if (boundary.length < 3) return;
  const { ctx } = c;
  const color = opts.color ?? PLANNING_LAYER_COLORS.boundary;
  const danger = opts.dangerColor ?? '#d98324';

  /** 顶点外圈白底方框：color 绿 = 能拖，琥珀 = 已点一下、再点就删。 */
  const drawVertexBox = (index: number, stroke: string) => {
    const target = boundary[index];
    if (!target) return;
    const pt = planPointToPixel(target, c.viewport);
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.fillRect(pt.x - 8, pt.y - 8, 16, 16);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.strokeRect(pt.x - 8, pt.y - 8, 16, 16);
    ctx.restore();
  };

  const hoverIndex = opts.vertexHoverIndex ?? null;
  const armedIndex = opts.armedVertexIndex ?? null;
  // 上脸优先：通一个顶点只画一个框，红盖绿，不叠加两层。
  if (armedIndex !== null) drawVertexBox(armedIndex, danger);
  if (hoverIndex !== null && hoverIndex !== armedIndex) drawVertexBox(hoverIndex, color);

  const edge = opts.edgeHintPx ?? null;
  if (edge) {
    ctx.save();
    // 白底圆 + 品牌绿描边，中间一个 `+`：与分区的加点把手同一套语言。
    ctx.beginPath();
    ctx.arc(edge.x, edge.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(edge.x - 3.2, edge.y);
    ctx.lineTo(edge.x + 3.2, edge.y);
    ctx.moveTo(edge.x, edge.y - 3.2);
    ctx.lineTo(edge.x, edge.y + 3.2);
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.restore();
  }
}

/** 动线分叉的锚点：按住 Alt 悬停在已有点上时，从它长出新动线。 */
export interface RouteBranchAnchor {
  kind: 'node' | 'route-vertex';
  /** 节点/动线名字，用于提示文案。 */
  label: string;
  /** 锚点坐标（节点用节点位置，折点用折点位置）。 */
  point: PlanPoint;
  /** 锚到节点时带 nodeId，便于提交时写 startNodeId。 */
  nodeId?: string;
  /**
   * 2026-11-16 用户「我明明是在改车行道，点了 Alt 又改回了人行道」：
   * 锚在动线折点上时把来源动线一并带出来——新画的部分必须跟原线同类型/同色，
   * 而且点在端点上时应该**续接同一条线**，不是另起一条人行道。
   */
  routeId?: string;
  /** 折点在动线里的下标（0 / length-1 即端点，端点可以直接续接）。 */
  vertexIndex?: number;
  /** 是否端点（起点或终点）：端点上按 Alt = 续着这条线画。 */
  isEndpoint?: boolean;
  routeKind?: string;
  routeColor?: string;
  routeOneWay?: boolean;
}

/**
 * 找“能从它分叉出一条新动线”的已有点：**节点优先**，其次动线折点。
 *
 * 2026-11-16 用户：「按住 Alt 可以在原来的点上添加线」——锚点必须先确定，
 * 否则画出来的线起点会偏、也不会自动挂上 startNodeId。
 */
export function findRouteBranchAnchor(
  plan: {
    nodes: readonly { id: string; name: string; position: PlanPoint }[];
    routes: readonly {
      id: string;
      name: string;
      points: readonly PlanPoint[];
      kind?: string | undefined;
      color?: string | undefined;
      oneWay?: boolean | undefined;
    }[];
  },
  px: { x: number; y: number },
  viewport: PlanViewport,
  opts: { nodeRadiusPx?: number; vertexRadiusPx?: number } = {},
): RouteBranchAnchor | null {
  const nodeRadius = opts.nodeRadiusPx ?? 14;
  const vertexRadius = opts.vertexRadiusPx ?? 12;
  let bestNode: { anchor: RouteBranchAnchor; d: number } | null = null;
  for (const node of plan.nodes) {
    const p = planPointToPixel(node.position, viewport);
    const d = Math.hypot(p.x - px.x, p.y - px.y);
    if (d <= nodeRadius && (bestNode === null || d < bestNode.d)) {
      bestNode = {
        anchor: { kind: 'node', label: node.name, point: { ...node.position }, nodeId: node.id },
        d,
      };
    }
  }
  if (bestNode) return bestNode.anchor;
  let bestVertex: { anchor: RouteBranchAnchor; d: number } | null = null;
  for (const route of plan.routes) {
    for (let i = 0; i < route.points.length; i += 1) {
      const point = route.points[i]!;
      const p = planPointToPixel(point, viewport);
      const d = Math.hypot(p.x - px.x, p.y - px.y);
      if (d <= vertexRadius && (bestVertex === null || d < bestVertex.d)) {
        bestVertex = {
          anchor: {
            kind: 'route-vertex',
            label: route.name,
            point: { ...point },
            routeId: route.id,
            vertexIndex: i,
            isEndpoint: i === 0 || i === route.points.length - 1,
            ...(route.kind !== undefined ? { routeKind: route.kind } : {}),
            ...(route.color !== undefined ? { routeColor: route.color } : {}),
            ...(route.oneWay !== undefined ? { routeOneWay: route.oneWay } : {}),
          },
          d,
        };
      }
    }
  }
  return bestVertex?.anchor ?? null;
}

/**
 * 分叉锚点提示：白底圆 + 品牌色圆 + 白色「+」。
 *
 * 2026-11-16 用户「操作的过程中需要有提示」：按住 Alt 时鼠标下要有看得见的“能从这里长线”的把。
 * 与分区/边界的加点把手同一套视觉语言，只是多一圈白底好压在深色底图上。
 */
export function drawBranchAnchor(
  c: PlanCanvasContext,
  px: { x: number; y: number },
  opts: { color?: string } = {},
): void {
  const { ctx } = c;
  const color = opts.color ?? PLANNING_LAYER_COLORS.route;
  ctx.save();
  ctx.beginPath();
  ctx.arc(px.x, px.y, 11, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px.x, px.y, 8, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(px.x - 4, px.y);
  ctx.lineTo(px.x + 4, px.y);
  ctx.moveTo(px.x, px.y - 4);
  ctx.lineTo(px.x, px.y + 4);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.98)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

/**
 * 2026-11-16 用户：「道路上的 icon 还是没改」——折点上的芯片改成跟属性栏同一套字形。
 *
 * 之前每个折点画的是 OnePlan 贴纸（pedestrian-access / vehicle-access / load-zone）：
 * 那套图自带 PED / VEH / LZ 英文小字与自己的图案，跟属性栏那三颗线性图标
 * （行人 / 货车 / 包裹）不是一套语言，看着像两个产品。这里改成自绘：
 * - 圆片底色 = 动线类型色（与属性栏选中态、图例同源）
 * - 字形 = 同一份 24 单位设计稿（行人 / 货车 / 包裹），白色 1.5 px 外环 + 白色描边
 * - 不画任何文字（2026-11-15 已要求「文字不要显示」）
 */
export type RouteKindGlyph = 'pedestrian' | 'vehicle' | 'service';

export function drawRouteKindChip(
  c: PlanCanvasContext,
  px: { x: number; y: number },
  kind: RouteKindGlyph,
  opts: { color: string; diameter?: number; alpha?: number },
): void {
  const { ctx } = c;
  const d = opts.diameter ?? 15;
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  // 圆片：底色是动线类型色，外圈白环（深底图上也能压出来）。
  ctx.beginPath();
  ctx.arc(px.x, px.y, d / 2 - 0.75, 0, Math.PI * 2);
  ctx.fillStyle = opts.color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.94)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // 字形：设计稿按 24×24 单位写（与 lucide 同口径），缩放到约 62% 直径。
  const unit = (d * 0.62) / 24;
  const gx = (x: number) => px.x + (x - 12) * unit;
  const gy = (y: number) => px.y + (y - 12) * unit;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.97)';
  ctx.lineWidth = Math.max(1.1, d * 0.095);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (kind === 'pedestrian') {
    // 行人：头 + 躯干 + 双臂 + 双腿（同 PersonStanding 的骨架）。
    ctx.beginPath();
    ctx.arc(gx(12), gy(5.4), 2.5 * unit, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(gx(12), gy(8));
    ctx.lineTo(gx(12), gy(13.4));
    ctx.moveTo(gx(6.2), gy(8.6));
    ctx.lineTo(gx(12), gy(10.8));
    ctx.lineTo(gx(17.8), gy(8.6));
    ctx.moveTo(gx(8.6), gy(20.6));
    ctx.lineTo(gx(12), gy(13.4));
    ctx.lineTo(gx(15.4), gy(20.6));
    ctx.stroke();
  } else if (kind === 'vehicle') {
    // 车辆：车厢 + 车头 + 两只轮子（同 Truck 的骨架）。
    ctx.beginPath();
    ctx.moveTo(gx(3), gy(7));
    ctx.lineTo(gx(13.6), gy(7));
    ctx.lineTo(gx(13.6), gy(16));
    ctx.lineTo(gx(3), gy(16));
    ctx.closePath();
    ctx.moveTo(gx(13.6), gy(10.6));
    ctx.lineTo(gx(17.4), gy(10.6));
    ctx.lineTo(gx(20.6), gy(13.6));
    ctx.lineTo(gx(20.6), gy(16));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(gx(7.2), gy(18.4), 1.7 * unit, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(gx(16.6), gy(18.4), 1.7 * unit, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // 后勤：立体包裹（同 Package 的骨架：六边形轮廓 + 顶盖 + 中缝）。
    ctx.beginPath();
    ctx.moveTo(gx(12), gy(3.2));
    ctx.lineTo(gx(20.3), gy(7.7));
    ctx.lineTo(gx(20.3), gy(16.3));
    ctx.lineTo(gx(12), gy(20.8));
    ctx.lineTo(gx(3.7), gy(16.3));
    ctx.lineTo(gx(3.7), gy(7.7));
    ctx.closePath();
    ctx.moveTo(gx(3.7), gy(7.7));
    ctx.lineTo(gx(12), gy(12.2));
    ctx.lineTo(gx(20.3), gy(7.7));
    ctx.moveTo(gx(12), gy(12.2));
    ctx.lineTo(gx(12), gy(20.8));
    ctx.stroke();
  }
  ctx.restore();
}

/** 锁定钮是否被点到（热区比视觉大一圈，好点）。 */
export function hitScopeLockButton(
  rect: { x: number; y: number; w: number; h: number },
  px: { x: number; y: number },
  tolerance = 2,
): boolean {
  return px.x >= rect.x - tolerance && px.x <= rect.x + rect.w + tolerance
    && px.y >= rect.y - tolerance && px.y <= rect.y + rect.h + tolerance;
}

/**
 * 画锁定钮：白色圆角小牌 + 一枚锁形图标；锁上后整块变墨色（与白色角标区分开关状态）。
 * 图标是画出来的（不依赖图标集）：锁体 + 锁环，开锁时锁环向右翘起。
 * 2026-11-17 罗盘拖转：rect.angle（弧度）存在时整块钮绕自身中心旋转——视觉是旋转方块，
 * 命中区仍是 rect 轴对齐外接矩形（scopeLockButtonRect 已放大到 1.5 倍边长覆盖旋转外接）。
 */
export function drawScopeLockButton(
  c: PlanCanvasContext,
  rect: { x: number; y: number; w: number; h: number; angle?: number },
  locked: boolean,
): void {
  const { ctx } = c;
  const angle = rect.angle ?? 0;
  const size = SCOPE_LOCK_SIZE;
  ctx.save();
  // 旋转态：进「钮中心为原点」的本地系（测试假 ctx 没有 translate/rotate，无角度时走绝对坐标老路径）。
  let x: number;
  let y: number;
  if (angle) {
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.rotate(angle);
    x = -size / 2;
    y = -size / 2;
  } else {
    x = rect.x;
    y = rect.y;
  }
  const w = size;
  const h = size;
  const radius = 6;
  // 与 2D 的白框同一套质感：白面 + 淡影，锁上反成墨面。
  ctx.shadowColor = 'rgba(10, 14, 20, 0.18)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
  ctx.fillStyle = locked ? 'rgba(17, 19, 23, 0.92)' : 'rgba(255, 255, 255, 0.96)';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = locked ? 'rgba(255, 255, 255, 0.9)' : 'rgba(17, 19, 23, 0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const gx = x + size / 2;
  const gy = y + size / 2 + 0.5;
  const ink = locked ? 'rgba(255, 255, 255, 0.96)' : 'rgba(17, 19, 23, 0.78)';
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 1.7;
  ctx.lineCap = 'round';
  // 锁体用实心：24 px 的钮上，描边方框读起来像「窗口」，实心才像锁。
  const bodyTop = gy - 0.6;
  ctx.beginPath();
  ctx.rect(gx - 4.8, bodyTop, 9.6, 7.4);
  ctx.fill();
  // 锁环：一个 U 形拱，两边立腿直接坐在锁体上（只画半弧会跟锁体脱节）。
  // 2026-11-16 用户「这不是锁上的图标吗」：未锁时必须看得出是「开口锁」——
  // 锁上=两腿都落在锁体上；未锁=整体抬高一截，右腿悬空不接锁体。
  const shackleR = 3.1;
  const shackleBase = locked ? bodyTop : bodyTop - 2.2;
  ctx.beginPath();
  if (locked) {
    ctx.moveTo(gx - shackleR, bodyTop);
    ctx.lineTo(gx - shackleR, shackleBase - 0.01);
    // 从 180° 顺时针画到 360°：canvas 角度向下为正，这段正好是拱顶。
    ctx.arc(gx, shackleBase, shackleR, Math.PI, Math.PI * 2);
    ctx.lineTo(gx + shackleR, bodyTop);
  } else {
    // 左腿仍插在锁体上（轴），右腿抬起来悬在锁体上方 → 全球通用的“开锁”形。
    ctx.moveTo(gx - shackleR, bodyTop);
    ctx.lineTo(gx - shackleR, shackleBase);
    ctx.arc(gx, shackleBase, shackleR, Math.PI, Math.PI * 2);
    ctx.lineTo(gx + shackleR, shackleBase + 1.2);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.restore();
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
 * 底图明暗：决定“压在图上”的文字用深字还是白字。
 * 2026-11-16 用户：「这个文字是不是也要根据不同的地图给适配？比如说深色的话分区就要是白色的」。
 */
export type PlanBasemapTone = 'dark' | 'light';

/**
 * 图上文字配色：深底白字 + 深描边，浅底深字 + 白描边。
 * 描边恒为字的反色——卫星影像亮暗交错（黑色路面旁边是浅灰楼顶）时，
 * 光换字色还会碰到“字和底一样亮”的地方，反色描边能把字抽出来。
 */
export function planLabelInk(tone: PlanBasemapTone): { fill: string; halo: string } {
  return tone === 'dark'
    ? { fill: 'rgba(255,255,255,0.96)', halo: 'rgba(8,12,18,0.66)' }
    : { fill: 'rgba(15,22,32,0.88)', halo: 'rgba(255,255,255,0.92)' };
}

/** 统一的图上文字：先画反色描边打底，再填字（名字较短时 2.4 px 描边刚好不糊笔画）。 */
function paintPlanLabel(
  c: PlanCanvasContext,
  text: string,
  x: number,
  y: number,
  tone: PlanBasemapTone,
  font: string,
  textAlign: CanvasTextAlign = 'center',
  textBaseline: CanvasTextBaseline = 'middle',
): void {
  const { ctx } = c;
  const ink = planLabelInk(tone);
  ctx.save();
  ctx.font = font;
  ctx.textAlign = textAlign;
  ctx.textBaseline = textBaseline;
  ctx.lineWidth = 2.8;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink.halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = ink.fill;
  ctx.fillText(text, x, y);
  ctx.restore();
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
  /** 2026-11-16：分区名跟着底图明暗走（深色卫星图用白字），滑入即适配。 */
  opts: { tone?: PlanBasemapTone } = {},
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
    const label = ringCenterPixel(c, zone.polygon);
    if (label) {
      paintPlanLabel(c, zone.name, label.x, label.y, opts.tone ?? 'light', '11px system-ui, sans-serif');
    }
    // 2026-11-16 用户指令「室内分区上那扇自动门先关掉，只留图标库里手动放的」：
    // 分区不再自动画门（上一条指令先做的那扇作废），门由用户在「入口和通道图标」里自己摆。
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
    /** 2026-11-16 场景预设落成的小场地：带 `scene-preset:` 前缀，2D 用双虚线 + 名称标出来。 */
    templateId?: string | undefined;
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
    const sceneVenue = f.templateId?.startsWith('scene-preset:') ?? false;
    const fillAlpha = (sceneVenue ? 0.1 : 0.16) * (f.opacity ?? 1);
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
    } else if (sceneVenue) {
      // 小场地在 2D 里不是普通物料的一格：外圈双虚线，内圈再收一道，看起来像“摆进来的一整个馆”。
      ctx.strokeStyle = own;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([8, 5]);
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      if (w > 16 && h > 16) {
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.strokeRect(-w / 2 + 5, -h / 2 + 5, w - 10, h - 10);
      }
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
    } else if (sceneVenue) {
      // 未选中时也给一个低调的名字标，用户一眼知道这块矩形是刚摆进来的哪个馆。
      const label = (f.name ?? '小场地').slice(0, 18);
      if (label) {
        ctx.save();
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = Math.min(w - 8, ctx.measureText(label).width + 12);
        if (tw > 18) {
          ctx.fillStyle = 'rgba(31, 107, 58, 0.78)';
          ctx.fillRect(center.x - tw / 2, center.y - 8, tw, 16);
          ctx.fillStyle = 'rgba(255,255,255,0.96)';
          ctx.fillText(label, center.x, center.y + 0.5, tw - 8);
        }
        ctx.restore();
      }
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
 * 2026-11-16 设施落位幽灵的唯一几何来源：2D 画布与 3D draft 共用。
 * 尺寸取模板真实宽深（与 buildFacility 一致），rotationDeg 为落位前 R/Shift+R 的角度，
 * invalid 用与提交同一套 facilityPlacementIssues 判定（越界红/合法绿由渲染层取色）。
 */
export interface FacilityPlacementGhost {
  ring: PlanPoint[];
  invalid: boolean;
}

export function facilityPlacementGhost(
  template: { width: number; depth: number },
  position: PlanPoint,
  rotationDeg: number,
  boundary: readonly PlanPoint[],
): FacilityPlacementGhost {
  const ring = facilityFootprintRing({
    position,
    rotationDeg,
    size: { width: template.width, depth: template.depth },
  });
  return { ring, invalid: facilityPlacementIssues(ring, boundary).length > 0 };
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
 * （实线/长划/点划）。oneWay 沿线逐段画箭头表达方向；选中路线画白描边高亮（H2-d）。
 * 2026-11-15 用户指令：选中不再画名称文字，只留白色高亮。
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
    // 2026-11-15 用户反馈：长段只两端有箭头，中间看不出朝向（端点箭头还会被节点徽标/⚠ 盖住），
    // 这里给够长的段在中点再补一只箭头；短段不加，否则箭头会连成一串。
    if (r.oneWay) {
      for (let i = 1; i < r.points.length; i++) {
        drawArrowAt(c, r.points[i - 1]!, r.points[i]!, color);
        drawSegmentMidArrow(c, r.points[i - 1]!, r.points[i]!, color);
      }
    }
    // 2026-11-15 用户指令「文字就不要显示了」：选中动线不再画名字标签——
    // 名字在线下那个黑色徽标旁又小又重叠，改由类型贴纸（图）表达动线类型，
    // 名字留在右侧面板/问题清单里看（画布上不再出现浮字）。
    // 白描边高亮保留：选中态仍然要能从线上看出来。
  }
}

/**
 * 漫游态环色（B3）：已进区 = 青，已落座 = 琥珀。与岗位色分开：岗位色说「他是谁」，
 * 环说「他此刻在干什么」，两者不能抢同一个通道。浅图/深图都看得见。
 */
export const WORKER_ROAM_COLORS = { zone: '#1f9d8f', seated: '#d0872a' } as const;

/**
 * 人员：圆形点位 + 角色名与数量标注，人员色；选中画白圈（H2-d）。
 * warning 为 true 时改红描边（点位越界警示，数据本身保留）。
 *
 * 2026-11-16 用户：「地图上应该就直接是图标，而不是一个点、上面再一个图标，感觉是重复信息」——
 * `chip: true` 表示调用方会在同一点位画 16 px 岗位图标芯片（画布 outdoor-plan-canvas.tsx
 * 负责把贴纸画上去），本层于是不再画那颗圆点，只留选中/越界圈与「岗位 ×人数」文字。
 * 缺省仍是圆点（无岗位贴纸的岗位、单测与外部调用不受影响）。
 */
export function drawWorkerLayer(
  c: PlanCanvasContext,
  workers: readonly { id?: string; position: PlanPoint; count: number; role: string; selected?: boolean; warning?: boolean; /** 调用方已画岗位图标芯片：不再画圆点。 */ chip?: boolean; /** 2026-11-12 活动包点位：契约 planWorkerSchema.color，缺省取 tokens 人员色。 */ color?: string | undefined; /** B3：3D 漫游态（进区 / 落座），walking 与缺省都不画状态环。 */ state?: 'walking' | 'zone' | 'seated' | undefined }[],
  opts: { tone?: PlanBasemapTone } = {},
): void {
  const { ctx, viewport } = c;
  const color = PLANNING_LAYER_COLORS.worker;
  /** 芯片半径（px）：与画布那边的 16 px 芯片同口径，圈与文字都按它让位。 */
  const chipRadius = 8;
  for (const w of workers) {
    const pt = planPointToPixel(w.position, viewport);
    if (!w.chip) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = hexWithAlpha(w.color ?? color, 0.85);
      ctx.fill();
      ctx.strokeStyle = w.warning ? '#c0392b' : '#fff';
      ctx.lineWidth = w.warning ? 1.6 : 1;
      ctx.stroke();
    } else if (w.warning) {
      // 圆点被芯片取代后，越界仍需一眼看出：红圈套在芯片外沿（芯片由画布后画，圈要让到外面）。
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, chipRadius + 1, 0, Math.PI * 2);
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (w.selected) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, w.chip ? chipRadius + 3.5 : 8.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
    // B3：漫游态环画在最外圈（比选中白圈再外 1 px），三个环不互相遮。
    if (w.state === 'zone' || w.state === 'seated') {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, w.chip ? chipRadius + 4.5 : 10, 0, Math.PI * 2);
      ctx.strokeStyle = WORKER_ROAM_COLORS[w.state];
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // 2026-11-16 用户：「图标细分之后就不需要在地图上显示名字了」——岗位名交给图标本身，
    // 只有多人位才补一枚「×N」（数量是图标表达不了的）；单人位不写任何字。
    // 颜色跟底图明暗走（深色卫星图上的深字根本看不见）。
    if (w.count > 1) {
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      // 文字起点按芯片/圆点让位：芯片版贴右沿 3 px、竖直居中（10 px 字 → 上方 5 px）。
      paintPlanLabel(
        c,
        `×${w.count}`,
        pt.x + (w.chip ? chipRadius + 3 : 6),
        pt.y - (w.chip ? chipRadius - 3 : 2),
        opts.tone ?? 'light',
        '10px system-ui, sans-serif',
        'left',
        'top',
      );
    }
  }
}

/**
 * 出入口节点：三型专属色菱形底形（绿进 / 红出 / 青双向）+ 选中白圈；
 * unconnected 为 true 时画红色警示点（未连接任何动线，H2-d）。
 * 正方形符号在贴纸未加载的帧里就是本层唯一的形状，所以颜色必须按 kind 分，
 * 不能再用「出口灰、其余蓝」的二元分法（2026-11-15 用户：三型要能一眼分开）。
 */
/**
 * 出入口节点：三型专属色圆牌（绿进 / 红出 / 青双向）+ 选中白圈；
 * unconnected 为 true 时画红色警示点（未连接任何动线，H2-d）。
 *
 * 2026-11-16 用户：「3D 的时候出入口这个圈圈还蛮形象的，2D 上画的 icon 是不是太看不清了」。
 * 确实：地图底图（卫星影像 + 路名）花，14 px 的细字形贴纸直接被她在。
 * 所以 2D 也改成同一套「圆牌」语言：
 * - 类型色空心环（外径 21 px、环厚 5.2 px）——中间留洞，底图与动线从洞里穿过去；
 * - 环内外各邻 1.6 px 白边——浅底图与卫星图上都能把环从背景里“扢”出来；
 * - 名字文本用白色描边当底气（map label 常见手法），不再被底图吃掉；
 * - 贴纸（同色圆片 + 白色字形）画在圆盘上；贴纸没加载时这一层自己就是完整圆牌。
 */
/**
 * 出入口名字的显示阀值（米/像素）：视角比它更粗（缩得更小）就只画圆牌不画名字。
 * 2026-11-16 用户：「缩小时只留圆牌不画名字，放大或选中时才出名字」。
 * 0.16 m/px 约对应 z20（杭州纬度 z19 约 0.26、z21 约 0.065）：
 * 也就是“看得出街区细节了”才出名字，否则一屏十几个名字反而把底图刷满。
 */
export const PLAN_NODE_LABEL_M_PER_PX = 0.16;

/**
 * 出入口环的半径（px）：**随缩放走**，与道路同一口径。
 *
 * 2026-11-16 用户：「这个环的缩放比例特别奇怪。和道路一样行不行?」——
 * 固定 21 px 的环在低倍会把整个场地糊满（环挤在一起像贴纸堆），高倍时又偏小。
 * 所以按「米/像素」收敛：z19 基准 10.5 px，缩小时收到 6 px，放大时放到 13 px。
 */
export function accessRingRadiusPx(viewport: PlanViewport): number {
  const mpp = planMetersPerPixel(viewport);
  const ratio = Math.sqrt(0.26 / Math.max(1e-6, mpp));
  return Math.min(13, Math.max(6, 10.5 * ratio));
}

export function drawAccessLayer(
  c: PlanCanvasContext,
  nodes: readonly { id?: string; kind: 'entry' | 'exit' | 'both'; position: PlanPoint; name: string; selected?: boolean; unconnected?: boolean }[],
  opts: { tone?: PlanBasemapTone } = {},
): void {
  const { ctx, viewport } = c;
  /** 环外径（px）：随缩放收敛，见 accessRingRadiusPx。 */
  const R = accessRingRadiusPx(viewport);
  /**
   * 环厚（px）：跟着外径走（约一半），小环不会被滚成实心盘。
   * 2026-11-16 用户：「出入口现在不要是图标，我更喜欢右边这种环形的东西」。
   */
  const RING = Math.max(2.6, R * 0.5);
  const mid = R - RING / 2;
  // 2026-11-16 用户：「名字分级显示：缩小时只留圆牌不画名字，放大或选中时才出名字」。
  const showNames = planMetersPerPixel(viewport) <= PLAN_NODE_LABEL_M_PER_PX;
  for (const n of nodes) {
    const pt = planPointToPixel(n.position, viewport);
    const color = PLANNING_NODE_KIND_COLORS[n.kind] ?? PLANNING_NODE_KIND_COLORS.both;
    ctx.save();
    // 白色底环：比彩色环宽 3.2 px，内外各露出 1.6 px，地图花也能把环拉出来。
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, mid, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = RING + 3.2;
    ctx.stroke();
    // 类型色环：中间是空的（不再画实心盘，也不往环里放图标）。
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, mid, 0, Math.PI * 2);
    ctx.strokeStyle = hexWithAlpha(color, 0.95);
    ctx.lineWidth = RING;
    ctx.stroke();
    ctx.restore();
    if (n.selected) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, R + 4.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.restore();
    }
    if (n.unconnected) {
      // 白描边把警示点从彩色圆牌上扒开（出口圆牌本身就是红的，不描边会糊在一起）。
      ctx.save();
      ctx.beginPath();
      ctx.arc(pt.x + R - 1.5, pt.y - R + 1.5, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = '#c0392b';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
    }
    // 名字：白色描边打底再填深色字，背后是卫星图也读得出来。
    // 2026-11-16：缩小到一定程度就不画名字（满屏浮字比图标本身更乱），选中/放大才出。
    if (!showNames && !n.selected) continue;
    // 2026-11-16：底图偏暗时把字反成白色 + 深描边，否则白描边变成“白贴纸”。
    paintPlanLabel(c, n.name, pt.x + R + 3.5, pt.y, opts.tone ?? 'light', '600 11.5px system-ui, sans-serif', 'left');
  }
}

/* ---------------- 绘制草稿（H2-b 画边界/画分区） ---------------- */

/**
 * 顶点收集草稿：虚线折线 + 顶点方块；≥3 点时首点画闭合热区圆圈提示。
 *
 * 2026-11-17 用户「画红线时草稿是绿的，压在卫星图上看不清，应该改成红色虚线」：
 * 草稿颜色一律由调用方给，画用地红线时直接用地界红（`PLANNING_BOUNDARY_LINE_COLOR`）——
 * 绿线在影像上和植被、分区同族，永远争不到层级；虚线只承担「还没落笔」这一层语义。
 *
 * 随之而来的坑：草稿本来就红了，`draftInvalid` 再“转红”等于没信号。
 * 所以非法形状（自交/重合）改成**加重一档 + 收密虚线**：线比正常草稿粗一圈、节奏更急，
 * 压在正常红虚线上也一眼分得出这圈圈不成。
 */
export function drawDraftLayer(
  c: PlanCanvasContext,
  draft: readonly PlanPoint[],
  color: string,
  opts: { draftInvalid?: boolean } = {},
): void {
  if (draft.length === 0) return;
  const { ctx, viewport } = c;
  const invalid = opts.draftInvalid === true;
  const stroke = invalid ? PLANNING_CONFLICT_COLORS.conflict : color;
  const lineWidth = invalid ? 3.4 : 2;
  const dash: [number, number] = invalid ? [5, 4] : [8, 5];
  if (draft.length >= 2) {
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dash);
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
 * 出入口节点放置幽灵：跟随指针的菱形预览 + 三型专属色 + 名称标签。
 * 颜色与落地后的贴纸芯片一致，按下工具就能看出自己正在放哪一种。
 */
export function drawNodeGhost(
  c: PlanCanvasContext,
  kind: 'entry' | 'exit' | 'both',
  name: string,
  position: PlanPoint,
): void {
  const { ctx, viewport } = c;
  const color = PLANNING_NODE_KIND_COLORS[kind] ?? PLANNING_NODE_KIND_COLORS.both;
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
    /** 2026-11-16 读数据 DOM 贴片渲染时置 false（不再在画布上重复画一遍文字）。 */
    showLabel?: boolean;
  }[],
): void {
  const { ctx } = c;
  const color = measureStroke(c);
  for (const m of measurements) {
    if (m.points.length < 2) continue;
    if (m.kind === 'area' && m.points.length < 3) continue;
    if (m.kind === 'area') {
      traceRing(c, m.points);
      ctx.fillStyle = measureFill(c, m.selected ? 0.2 : 0.12);
      ctx.fill();
      // 选中态：先铺一圈白色宽光晕，再压回测量色——图上能一眼看出“这条被选中了”。
      if (m.selected) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = m.selected ? 2.5 : 1.5;
      ctx.stroke();
      ctx.restore();
      const label = m.showLabel === false ? null : zoneLabelPixel(c, m.points);
      if (label) drawMeasureLabel(c, formatAreaM2(measureValue(m)), label.x, label.y);
    } else {
      ctx.save();
      ctx.strokeStyle = m.selected ? 'rgba(255,255,255,0.9)' : color;
      ctx.lineWidth = m.selected ? 5 : 2;
      tracePolyline(c, m.points);
      ctx.stroke();
      ctx.restore();
      if (m.selected) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        tracePolyline(c, m.points);
        ctx.stroke();
        ctx.restore();
      }
      // 端点白心圆环（Google 测距节点）。
      for (const p of [m.points[0]!, m.points[m.points.length - 1]!]) {
        const pt = planPointToPixel(p, c.viewport);
        drawMeasureNode(c, pt.x, pt.y);
      }
      // 2026-11-16 用户：「文字和线段平行」+「线段中间带过程标尺」——
      // 读数不再横贴在中间，而是沿线段方向旋转；长段按自适应步长打刻度（100 m / 200 m …）。
      if (m.showLabel !== false) drawMeasureRuler(c, m.points, { total: true });
    }
  }
}

/**
 * 测量草稿（临时测量）：已收点实线 + 顶点圆环 + 指针橡皮筋，线段上带过程标尺
 * （累计刻度 + 贴线旋转读数）；面积 ≥3 点时首点画闭合热区圆圈提示。
 */
export function drawMeasureDraft(
  c: PlanCanvasContext,
  draft: readonly PlanPoint[],
  kind: PlanMeasureKind,
  cursorPoint?: PlanPoint,
): void {
  const { ctx } = c;
  const color = measureStroke(c);
  if (draft.length >= 2) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
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
    ctx.strokeStyle = measureFill(c, 0.55);
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
    drawMeasureNode(c, pt.x, pt.y, 3.5);
  }
  // 2026-11-16 用户：「测量的时候线段中间带有过程标尺」——草稿阶段就把刻度/累计读数打在线上，
  // 指针段也算在内（不然拖到一半看不到刻度）。总长读数仍由下面的 measureDraftReadout 负责。
  if (kind !== 'area') {
    const rulerPoints = cursorPoint ? [...draft, cursorPoint] : draft;
    if (rulerPoints.length >= 2) drawMeasureRuler(c, rulerPoints, { total: false });
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
 *
 * 2026-11-15：同一条线上的多条问题已在上游合并成一枚（见 `groupConflictIssues`），
 * 这里用 `count` 把枚数写在徽章里（1 条仍画「!」，多条画数字），不再在线上一路撒叹号。
 */
export function drawConflictMarkers(
  c: PlanCanvasContext,
  conflicts: readonly { key: string; status: 'conflict' | 'missing' | 'unverified'; at: PlanPoint; count?: number }[],
  opts: { highlightKey?: string | null } = {},
): void {
  const { ctx, viewport } = c;
  for (const conflict of conflicts) {
    const pt = planPointToPixel(conflict.at, viewport);
    const color = PLANNING_CONFLICT_COLORS[conflict.status];
    const highlighted = opts.highlightKey === conflict.key;
    const count = conflict.count ?? 1;
    const stacked = count > 1;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, highlighted ? 10 : stacked ? 9.5 : 8, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = highlighted ? 2 : 1.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, stacked ? 6.5 : 5.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.font = `bold ${stacked ? 8.5 : 9}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(stacked ? String(count) : '!', pt.x, pt.y + 0.5);
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

/** 分区标注锚点：首两个顶点中点（稳定且贴近人眼关注处）。
 *  2026-11-15 用户指令：分区名字要写在区域正中心，不再用角落/边中点（drawZoneLayer 已改用 ringCenterPixel）。*/
function zoneLabelPixel(
  c: PlanCanvasContext,
  polygon: readonly PlanPoint[],
): { x: number; y: number } | null {
  if (polygon.length < 2) return null;
  const a = planPointToPixel(polygon[0], c.viewport);
  const b = planPointToPixel(polygon[1], c.viewport);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** 点在多边形内（射线法，像素坐标）。 */
function pointInPixelRing(x: number, y: number, ring: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * 区域标注锚点：多边形面积质心（“写在区域正中心”）。
 * 凹/L 形分区的质心可能落在多边形外，这时在包围盒内网格采样，取离质心最近的内部点；
 * 退化（零面积）则回落到包围盒中心，保证总有落笔点。
 */
export function ringCenterPixel(
  c: PlanCanvasContext,
  ring: readonly PlanPoint[],
): { x: number; y: number } | null {
  if (ring.length < 3) return null;
  const px = ring.map(point => planPointToPixel(point, c.viewport));
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < px.length; i++) {
    const a = px[i]!;
    const b = px[(i + 1) % px.length]!;
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  const minX = Math.min(...px.map(p => p.x));
  const maxX = Math.max(...px.map(p => p.x));
  const minY = Math.min(...px.map(p => p.y));
  const maxY = Math.max(...px.map(p => p.y));
  if (Math.abs(twiceArea) < 1e-6) return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const centroid = { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) };
  if (pointInPixelRing(centroid.x, centroid.y, px)) return centroid;
  let best: { x: number; y: number } | null = null;
  let bestDist = Infinity;
  const steps = 12;
  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      const x = minX + ((maxX - minX) * i) / steps;
      const y = minY + ((maxY - minY) * j) / steps;
      if (!pointInPixelRing(x, y, px)) continue;
      const dist = Math.hypot(x - centroid.x, y - centroid.y);
      if (dist < bestDist) { bestDist = dist; best = { x, y }; }
    }
  }
  return best ?? centroid;
}

/**
 * 2026-11-16 用户：「点击下面的×就消失了」——读数据做成图上可关的贴片，需要一个跟画布
 * 读数完全同位置的屏幕锚点（否则贴片会和画布文字错位）。距离/路径取段中点，面积取
 * 画布面积读数用的同一落点（首边中点）。
 */
export function measureReadoutAnchor(
  viewport: PlanViewport,
  measurement: { kind: 'distance' | 'area' | 'path'; points: readonly PlanPoint[] },
): { x: number; y: number } | null {
  const points = measurement.points;
  if (points.length < 2) return null;
  if (measurement.kind === 'area') {
    if (points.length < 3) return null;
    const a = planPointToPixel(points[0]!, viewport);
    const b = planPointToPixel(points[1]!, viewport);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  if (points.length === 2) {
    const a = planPointToPixel(points[0]!, viewport);
    const b = planPointToPixel(points[1]!, viewport);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  return planPointToPixel(points[Math.floor(points.length / 2)]!, viewport);
}

/** 测量读数标签：深色半透明底衬 + 青色文字（宽按文本长度估算，不依赖 measureText）。 */
function drawMeasureLabel(c: PlanCanvasContext, text: string, x: number, y: number): void {  const { ctx } = c;
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 读数直接贴线：线色文字 + 反色描边光晕保证在瓦片上可读（Google 测距口径，无深色胶囊）。
  const halo = c.dark ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3;
  ctx.strokeStyle = halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = measureStroke(c);
  ctx.fillText(text, x, y);
}

/* ---------------- 2026-11-16 用户指令：过程标尺 + 贴线平行文字 ---------------- */

/** 刻度步长候选（米）：挑一个「屏幕上够稀」的最小档。 */
export const MEASURE_RULER_STEPS_M = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000] as const;
/** 相邻刻度至少隔这么多 CSS px（再密就换大一档）。 */
export const MEASURE_RULER_MIN_TICK_PX = 60;

/** 当前缩放下的标尺步长（米）。 */
export function measureRulerStepM(viewport: PlanViewport): number {
  const want = MEASURE_RULER_MIN_TICK_PX * planMetersPerPixel(viewport);
  return MEASURE_RULER_STEPS_M.find(step => step >= want) ?? MEASURE_RULER_STEPS_M[MEASURE_RULER_STEPS_M.length - 1]!;
}

/** 文字要顺着线读：把屏幕角度翻到 (-90°, 90°] 区间，避免倒字。 */
export function readableSegmentAngle(dx: number, dy: number): number {
  const angle = Math.atan2(dy, dx);
  if (angle > Math.PI / 2) return angle - Math.PI;
  if (angle <= -Math.PI / 2) return angle + Math.PI;
  return angle;
}

/** 贴线旋转文字：沿线段方向排，法线方向抬起 offsetPx，带反色光晕。 */
function drawRotatedMeasureLabel(
  c: PlanCanvasContext,
  text: string,
  x: number,
  y: number,
  angle: number,
  offsetPx: number,
): void {
  const { ctx } = c;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const halo = c.dark ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3;
  ctx.strokeStyle = halo;
  ctx.strokeText(text, 0, -offsetPx);
  ctx.fillStyle = measureStroke(c);
  ctx.fillText(text, 0, -offsetPx);
  ctx.restore();
}

/**
 * 过程标尺：沿折线按自适应步长打垂直刻度，并把**从起点算起的累计距离**贴在线上（文字与线段平行）。
 * 段太短打不下刻度时，给该段中点一个段末累计读数；`total` 打开时末端再贴一次总长。
 * 返回本次画上的刻度（米）与文字，便于单测直接断言“刻度打在哪儿”。
 */
export function drawMeasureRuler(
  c: PlanCanvasContext,
  points: readonly PlanPoint[],
  options: { labels?: boolean; total?: boolean } = {},
): { stepM: number; labels: string[]; ticksM: number[] } {
  const labels: string[] = [];
  const ticksM: number[] = [];
  const stepM = measureRulerStepM(c.viewport);
  if (points.length < 2) return { stepM, labels, ticksM };
  const { ctx } = c;
  const color = measureStroke(c);
  const metersPerPx = planMetersPerPixel(c.viewport);
  const px = points.map(point => planPointToPixel(point, c.viewport));
  let travelledM = 0;
  let nextMarkM = stepM;
  for (let index = 1; index < px.length; index += 1) {
    const a = px[index - 1]!;
    const b = px[index]!;
    const segPx = Math.hypot(b.x - a.x, b.y - a.y);
    if (segPx < 0.5) continue;
    const segM = segPx * metersPerPx;
    const angle = readableSegmentAngle(b.x - a.x, b.y - a.y);
    let marked = false;
    while (nextMarkM <= travelledM + segM + 1e-9) {
      const t = Math.min(1, Math.max(0, (nextMarkM - travelledM) / segM));
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      // 刻度：垂直于线段的短横。
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.lineTo(0, 4);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      ticksM.push(nextMarkM);
      if (options.labels !== false) {
        const text = formatLengthM(nextMarkM);
        drawRotatedMeasureLabel(c, text, x, y, angle, 10);
        labels.push(text);
      }
      marked = true;
      nextMarkM += stepM;
    }
    // 这一整段一个刻度都没落上：给段中点一个累计读数，不留“没数字的线”。
    if (!marked && options.labels !== false && segPx >= 34) {
      const text = formatLengthM(travelledM + segM);
      drawRotatedMeasureLabel(c, text, (a.x + b.x) / 2, (a.y + b.y) / 2, angle, 10);
      labels.push(text);
    }
    travelledM += segM;
  }
  if (options.total !== false && options.labels !== false && px.length >= 2) {
    const last = px[px.length - 1]!;
    const prev = px[px.length - 2]!;
    drawRotatedMeasureLabel(c, formatLengthM(travelledM), last.x, last.y, readableSegmentAngle(last.x - prev.x, last.y - prev.y), 16);
  }
  return { stepM, labels, ticksM };
}

function drawArrowAt(c: PlanCanvasContext, from: PlanPoint, to: PlanPoint, color: string): void {
  const { viewport } = c;
  const a = planPointToPixel(from, viewport);
  const b = planPointToPixel(to, viewport);
  drawArrowHead(c, b.x, b.y, Math.atan2(b.y - a.y, b.x - a.x), color);
}

/** 线段中点方向标：段短于 56px 就不画（与端点箭头挤在一起反而看不清方向）。 */
const ROUTE_MID_ARROW_MIN_PX = 56;

function drawSegmentMidArrow(c: PlanCanvasContext, from: PlanPoint, to: PlanPoint, color: string): void {
  const { viewport } = c;
  const a = planPointToPixel(from, viewport);
  const b = planPointToPixel(to, viewport);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < ROUTE_MID_ARROW_MIN_PX) return;
  drawArrowHead(c, (a.x + b.x) / 2, (a.y + b.y) / 2, Math.atan2(dy, dx), color);
}

/** 在像素位置按角度画一只实心箭头（端点方向标与中点方向标共用同一形状）。 */
function drawArrowHead(c: PlanCanvasContext, x: number, y: number, angle: number, color: string): void {
  const { ctx } = c;
  ctx.save();
  ctx.translate(x, y);
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

/** 测量中性线色：深底白、浅底近黑（Google 测距口径）。 */
function measureStroke(c: PlanCanvasContext): string {
  return c.dark ? PLANNING_MEASURE_COLORS.dark : PLANNING_MEASURE_COLORS.light;
}

/** 测量面积淡填：线色按透明度派生。 */
function measureFill(c: PlanCanvasContext, alpha: number): string {
  return hexWithAlpha(measureStroke(c), alpha);
}

/** 测量节点：白心圆环 + 线色描边（Google 测距端点）。 */
function drawMeasureNode(c: PlanCanvasContext, x: number, y: number, r = 4): void {
  const { ctx } = c;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = measureStroke(c);
  ctx.lineWidth = 1.5;
  ctx.stroke();
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
