'use client';

/**
 * 户外 2D 规划满铺画布组件（H2-a 基础 + H2-b 编辑交互 + H2-c 设施 + H2-d 动线/节点/人员）。
 *
 * H4-a 视觉复刻（design tokens 全量 + 图标体系）：
 * - 面板表面色/排版字号/图标尺寸全部消费 `outdoor-plan-tokens`（原内联 hex 已收敛）；
 * - 编辑工具按钮、图层栈开关、信息页签、撤销按钮各配 Lucide 线条图标（自绘同风格，
 *   经 outdoor-plan-icons 的编译期闭环映射）；
 * - 清单行加类型胶囊（图标+类型名药丸，色从图层色派生，与图例/图层栈同源）。
 *
 * 组合方式：底图（公开源/天地图瓦片，复用 tdt-probe 工具）+ 业务图层
 * （outdoor-plan-canvas 纯函数）+ 内嵌图层栈开关与编辑面板。独立组件，不动 `room-organizer.tsx`。
 *
 * H3-a 米制测量与派生统计（规则在 site-plan-measure 纯函数层）：
 * - 测量模式三类型：距离（单击两点、或按住拖线自动固定）/ 面积（单击描点近首点闭合、
 *   或按住对角拖矩形，Shift 正方形）/ 路径（单击加点双击提交、或按住自由手绘采样）；
 *   草稿期实时读数跟指针（临时测量，Esc 丢弃）；
 * - 固定测量进 plan.measurements（契约可选字段），面板列出读数与删除；
 *   读数一律从米制 ENU 几何现算，缩放不影响数值；
 * - 测量为图层栈最上层（可隐藏），选中动线面板显示全长。
 *
 * H3-c 规划信息面板（左栏常驻，规则在 site-plan-legend / site-plan-inventory 纯函数层）：
 * - 四页签：总览（全案派生统计 + 当前可见统计分开显示）/ 清单（六类实体，
 *   支持类型 × 所属区 × 只看问题筛选）/ 问题（可定位问题清单）/ 图例（生成器输出）；
 * - 双向定位：点清单行/问题条 → 选中实体并平移视图居中；点地图对象 →
 *   清单行高亮并滚动到可见（同步聚焦清单）；
 * - 隐藏图层不改变全案统计与图例（与 H3-a 同口径）。
 *
 * H2-d 动线/节点/人员（规则在 site-plan-routes 纯函数层，组件只做接线）：
 * - 画动线：选类型（人行/车辆/后勤，三类三色）+ 可选单向，单击加路径点、双击或
 *   「完成动线」提交；端点靠近出入口自动吸附并记录 nodeId 引用（节点是唯一端点来源）；
 * - 放节点：入口/出口/两用，单击连续放置；浏览模式拖动节点 → 引用路线端点随动
 *   （movePlanNode 预览，松手提交）；删除节点自动剥离动线引用但保留几何；
 * - 布人员：面板填岗位/人数，单击放置；落点在分区内自动归属（inferWorkerZoneId）；
 * - 选中互斥（动线/节点/人员/设施四类），面板可改名/改类型/改归属/反转方向/删除；
 * - undo 栈（commitPlan 快照，Ctrl+Z 或面板「撤销」，上限 30 步）。
 *
 * H2-c 设施模板拖放（放置规则在 site-plan-facilities 纯函数层）：
 * - 「放设施」模式下面板出模板目录；点选模板后幽灵占地跟随鼠标（占地预览，越界变红），
 *   单击提交、可连续放置；从模板按钮拖拽（HTML5 DnD）到画布 dragover/drop 同样生效；
 * - Esc 取消放置回浏览；放置即选中（白圈高亮 + 面板改名/删除），越界设施出红虚线警示与问题条目。
 *
 * H2-b 编辑模式（编辑规则全部在 site-plan-editing 纯函数层，组件只做接线）：
 * - 浏览：拖拽平移、滚轮缩放；单击设施命中即选中，空白处点击取消选中。
 * - 画边界：单击加顶点、近首点闭合提交；自交/重合/面积不足拒绝并给原因，Esc 取消草稿。
 * - 编辑边界：拖动顶点实时校验，非法移动吸附回上一个合法位置，松手提交。
 * - 画分区：选语义后圈区提交（语义默认色/透明度）；自交/退化阻止提交，越界与重叠放行但出提示。
 * 分区颜色/透明度/命名可在面板内直接编辑（契约可选字段 opacity，0.05–0.6 区间）。
 */

import { forwardRef, Fragment, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
} from 'lucide-react';
import { BasemapTileCache, paintBasemapTiles } from '@/components/room-organizer/lib/plan-tile-cache';
import {
  defaultLayerVisibility,
  drawAccessLayer,
  drawAnnotationDraft,
  drawAnnotationLayer,
  drawBoundaryLayer,
  drawConflictMarkers,
  drawDraftLayer,
  drawFacilityGhost,
  drawFacilityLayer,
  drawMeasureDraft,
  drawMeasureLayer,
  drawNodeGhost,
  drawRouteDraft,
  drawRouteLayer,
  drawRouteProposalLayer,
  drawFlowSimulationLayer,
  drawSearchArea,
  drawSearchPin,
  drawSceneObjectsLayer,
  drawWorkerLayer,
  drawZoneLayer,
  drawZoneProposalLayer,
  enuToLngLat,
  isLayerVisible,
  lngLatToEnu,
  planMetersPerPixel,
  planPixelToPoint,
  planPointToPixel,
  type LayerVisibility,
  type PlanViewport,
} from '../lib/outdoor-plan-canvas';
import { createFlowWalkers, stepFlowWalkers, walkerPoints, routeDensity, type FlowWalker } from '../lib/flow-sim';
import {
  PLAN_CONFLICT_CATEGORY_LABELS,
  planConflictIssues,
  type PlanConflictIssue,
} from '../lib/site-plan-conflicts';
import {
  PLAN_MIN_VERTEX_GAP_M,
  PLAN_MIN_ZONE_AREA_M2,
  PLAN_RING_MAX_VERTICES,
  buildZone,
  checkBoundaryRing,
  checkPlanRing,
  defaultZoneColor,
  insertRingVertex,
  moveRingVertex,
  planPointDistanceM,
  planPointInRing,
  planRingSelfIntersects,
  planZonesOverlap,
  planZoneIssues,
  removeRingVertex,
  zoneOutsideBoundaryIssue,
  type PlanEditIssue,
  type PlanZoneIssue,
} from '../lib/site-plan-editing';
import {
  FACILITY_HANDLE_MIN_FOOTPRINT_PX,
  FACILITY_HANDLE_PX,
  buildFacility,
  facilityContainsPoint,
  facilityFootprintRing,
  facilityGroupAlign,
  facilityGroupBounds,
  facilityGroupDistribute,
  facilityGroupScale,
  facilityHandleAt,
  facilityHandles,
  facilityInRect,
  facilityPlacementIssues,
  facilitySideResize,
  findFacilityTemplate,
  planFacilityIssues,
  type FacilityAlignMode,
  type FacilitySideIndex,
  type PlanFacilityIssue,
  type PlanFacilityTemplate,
  type PlanRect,
} from '../lib/site-plan-facilities';
import { resolveFacilityTemplate } from '../lib/plan-facility-catalog';
import {
  FACILITY_GENERATE_POLL_MS,
  getFacilityGenerateLinksRevision,
  getGeneratedFacilityModelsRevision,
  listFacilityGenerateLinks,
  listGeneratedFacilityModels,
  registerGeneratedFacilityModel,
  resolveFacilityGenerateLink,
  subscribeFacilityGenerateLinks,
  subscribeGeneratedFacilityModels,
} from '../lib/facility-generated-models';
import { newLocalGlbKey, validateLocalGlbPick } from '../lib/glb-import';
import { MAX_FACILITY_MODEL_CANDIDATES, loadFacilityModelCandidates, type FacilityModelCandidate } from '../lib/plan-facility-models';
import {
  PLAN_ROUTE_MAX_VERTICES,
  buildRoute,
  buildWorker,
  detachNodeFromRoutes,
  movePlanNode,
  nodeRouteRefs,
  planNodeIssues,
  planWorkerIssues,
  reverseRoute,
  type PlanNodeIssue,
  type PlanWorkerIssue,
} from '../lib/site-plan-routes';
import { nearestRingEdge, planGridStepM, snapPointToGrid } from '../lib/site-plan-snap';
import {
  PLAN_MEASURE_MAX_VERTICES,
  buildMeasurement,
  formatAreaM2,
  formatLengthM,
  measureValue,
  planOverviewStats,
  type PlanMeasureKind,
} from '../lib/site-plan-measure';
import {
  annotationDistanceM,
  buildAnnotation,
  planShapeDraftTarget,
  PLAN_SHAPE_KINDS,
  type PlanShapeKind,
} from '../lib/site-plan-annotate';
import { buildPlanLegend } from '../lib/site-plan-legend';
import {
  buildPlanInventory,
  filterPlanInventory,
  planInventoryKindLabel,
  type PlanInventoryFilter,
  type PlanInventoryKind,
  type PlanInventoryRow,
} from '../lib/site-plan-inventory';
import {
  addPlanLevel,
  deletePlanLevel,
  filterPlanByLevel,
  planLevels,
  renamePlanLevel,
} from '../lib/plan-levels';
import {
  basemapSourceAttribution,
  publicSourceTileUrl,
  tdtProbeTileUrl,
  visibleTileGrid,
  type ProbePublicSource,
  type TdtProbeLayer,
} from '../lib/tdt-probe';
import { alignedTileCenter } from '../lib/basemap-alignment';
import { planningIcon } from './outdoor-plan-icons';
import { OUTDOOR_TOOL_ICONS, type OutdoorToolKey } from './outdoor-tool-icons';
import { MaterialSymbol } from '../panels/material-symbol';
import { OneplanSticker } from './oneplan-stickers';
import {
  drawOneplanScaleSticker,
  drawOneplanSticker,
  facilitySticker,
  nodeSticker,
  oneplanStickerSrc,
  planStickerDescriptors,
  preloadOneplanStickers,
  routeSticker,
  subscribeOneplanStickerLoads,
  workerSticker,
  zoneSticker,
} from '../lib/oneplan-stickers';
import {
  isPackTemplateId,
  libraryEntries,
  libraryEntryColor,
  libraryFacilityTemplate,
  libraryStickerFor,
  packFacilityTemplate,
  packsToEntries,
  registerPackEntries,
  searchLibraryEntries,
  type LibraryEntry,
  type OneplanManifest,
  type OneplanPacksFile,
} from '../lib/oneplan-library';
import {
  AREA_ROW_LABEL,
  EXTRA_ROW_LABEL,
  INFRA_ROW_LABEL,
  LABOR_ROLES,
  LABOR_ROW_LABEL,
  entranceIconItems,
  extraBucket,
  groupCatalogResults,
  infraBuckets,
  packBuckets,
  type PackBucket,
} from '../lib/oneplan-catalog';
import {
  PLANNING_CONFLICT_COLORS,
  PLANNING_EDIT_MODE_ICONS,
  PLANNING_EDIT_MODE_LABELS,
  PLANNING_INFO_TAB_ICONS,
  PLANNING_ICON_SIZES,
  PLANNING_LABELS,
  PLANNING_LAYER_COLORS,
  PLANNING_LAYER_ICONS,
  PLANNING_RADIUS,
  PLANNING_ROUTE_KIND_COLORS,
  PLANNING_SPACING,
  PLANNING_SURFACE,
  PLANNING_TEXT,
  PLANNING_TYPOGRAPHY,
  PLANNING_ZONE_COLORS,
  PLANNING_ZONE_OPACITY,
  withAlphaHex,
  type PlanningEditMode,
  type PlanningIconName,
  type PlanningLayerKind,
  type PlanningRouteKind,
  type PlanningZoneSemantic,
} from '@/lib/outdoor-plan-tokens';
import {
  planAnnotationKindLabels,
  planMeasurementKindLabels,
  planRouteKindLabels,
  planRouteKinds,
  planRouteLengthM,
  planZoneSemanticLabels,
  planZoneSemantics,
  type PlanFacility,
  type PlanNode,
  type PlanPoint,
  type PlanRoute,
  type PlanWorker,
  type PlanZone,
  type SitePlanData,
} from '../../../../supabase/functions/_shared/site-plan';
import type { PlanSceneObject } from '../lib/plan-item-bridge';

export type CanvasBasemapSource = TdtProbeLayer | ProbePublicSource;

interface View {
  lng: number;
  lat: number;
  zoom: number;
}

export interface OutdoorPlanCanvasProps {
  plan: SitePlanData;
  /** 图源：默认 OSM 街道（公开免费）。天地图两档线上浏览器直连 / 本机走 3199 代理。 */
  source?: CanvasBasemapSource;
  initialView?: Partial<View>;
  /** 图层可见性（受控模式）；缺省全开、组件内开关直接生效。 */
  visibility?: LayerVisibility;
  onVisibilityChange?: (next: LayerVisibility) => void;
  onViewChange?: (next: View) => void;
  /** H2-b：编辑提交回调（边界更新/顶点移动/新增分区/分区样式）。不传则只读浏览。 */
  onPlanChange?: (plan: SitePlanData) => void;
  /**
   * P2-c：图层栈与编辑浮窗的外挂宿主元素 id（左栏卡片）。传了则 portal 过去
   * （inline 卡片样式，宿主不存在时自动回落画布内浮窗）；缺省浮窗留在画布内。
   */
  panelsHostId?: string;
  /** P2-d：规划信息浮窗的独立宿主 id（两张卡分属左栏两个容器、显隐独立）。缺省跟随 panelsHostId。 */
  infoPanelHostId?: string;
  /**
   * P2-h：物件库面板的宿主 id（左栏第三个页签）。549 件 OnePlan 贴纸在这里被看见、
   * 被搜索、被点选后进入放置模式；缺省时物件库面板留在画布内浮窗。
   */
  libraryPanelHostId?: string;
  /**
   * 2026-11-11 图层（Level）行的宿主 id（左栏卡片头部，OnePlan levels-popover 同款位置）。
   * Level = 自定义独立「画布/设计方案」，不是楼层高度；缺省时行内浮在画布顶部。
   */
  levelsHostId?: string;
  /**
   * 2026-11-11 用户指令：测量区独立宿主 id（图层行下方、添加物件/已放置物件页签上方，
   * 两个页签下常驻可见）。缺省时测量区留在「已放置物件」面板内（画布内浮窗兜底形态不变）。
   */
  measureHostId?: string;
  /**
   * 2026-11-11 用户指令：标注区独立宿主 id（测量区下方、页签上方，两个页签下常驻可见）。
   * 缺省时标注区留在「已放置物件」面板内（画布内浮窗兑底形态不变）。
   */
  annotateHostId?: string;
  /**
   * 2026-11-12 用户指令「3D 的时候也要可编辑」：右轨三张工具卡（测量/标注/属性）的出镜宿主。
   * 接管态下画布本体在覆盖层里保活隐藏，卡片 portal 到这个宿主才能在 3D 里看见；
   * 缺省（2D 卡内）时浮窗照旧画在画布内。
   */
  inspectorHostId?: string;
  /** 活动图层切换上报（3D 地面图层据此只镜像当前层）。挂载时先报一次初始层。 */
  onActiveLevelChange?: ((levelId: string) => void) | undefined;
  /**
   * P4-b：底图形态。`map`（缺省）走瓦片地图；`floor` 是室内平面底——不请求任何瓦片，
   * 只画纸面与米制网格，好让室内「标注区」和户外地图共用同一张画布与同一套工具。
   */
  base?: 'map' | 'floor';
  /**
   * P2-g：undo/redo 可用态上报（室内工具排的撤销/重做钮据此启用）。
   * 变化时才触发，父级用 useState 落盘即可。
   */
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
  /**
   * 2026-11-12 用户指令「三个按钮对应的卡片要拆开」：测量 / 标注 / 属性 不再共用一张带页签的
   * 卡，各自一张独立卡片、可同时展开。这里按卡上报展开态（右轨三枚圆钮的按下态）。
   */
  onInspectorChange?: (state: { openTabs: Record<'measure' | 'annotate' | 'selection', boolean> }) => void;
  /**
   * 2026-11-12 B1 选择工具：绘制/浏览模式上报（右栏工具排「选择」钮的按下态据此渲染）。
   * setMode 每次切换都报；挂载时不报（右栏缺省按 view 处理）。
   */
  onModeChange?: (mode: PlanningEditMode) => void;
  /**
   * B：搜地点落点（纯视图辅助，不写进 plan）。有值时在对应经纬度画一枚定位钉 +
   * 名称标签；换地点/清空即重画，不参与统计、交付或冲突判定。
   */
  searchPin?: { lng: number; lat: number; label: string } | null;
  /**
   * 2026-11-12 搜地点「选区」：行政区边界环（经纬度），画成浅填充 + 虚线描边。
   * 与定位钉同性质——纯视图辅助，不写进 plan，不参与统计与冲突判定。
   */
  searchArea?: { polygon: [number, number][]; label: string; kind?: 'area' | 'line' } | null;
  /**
   * V-2d（2026-11-13）流线提案预览：虚线路线 + 出入口圆点，应用前不进 plan。
   * 与定位钉同性质——纯视图辅助；「应用」走 handle.applyRoutes（commitPlan 可撤销）。
   */
  routeProposal?: { routes: PlanRoute[]; nodes: PlanNode[] } | null;
  /**
   * V-3c（2026-11-13）区域提案预览：虚线分区 + 物料幽灵，应用前不进 plan。
   * 「应用」走 handle.applyZoneProposal（commitPlan 可撤销）。
   */
  zoneProposal?: { zones: PlanZone[]; facilities: PlanFacility[] } | null;
  /**
   * V-4b（2026-11-13）流动模拟：非 null 时在给定流线上跑 2D 行人动画（66ms 步进），
   * 密度按每 10m 人数着色。纯视图动画——不写 plan，置 null 即停。
   */
  flowSimRoutes?: PlanRoute[] | null;
  /**
   * 2026-11-11 统一视图：室内 3D 场景的落位（物料 + 场地实景扫描）投影到户外 2D 画布。
   * 只读展示层——不参与命中测试/交互，不写进 plan。
   */
  sceneObjects?: readonly PlanSceneObject[] | undefined;
  /**
   * V-5b/c（2026-11-13）：属性卡「模型」区底部的生成/上传入口外发——
   * kind 'text'=「生成一个」（文生 3D）、'image'=「上传图片生成」（图生 3D）。
   * 主线接线（organizer → overlay → 本组件）：organizer 侧 recordFacilityGenerateLink
   * 记「这炉生成给哪个设施」+ stageMaterialGenerate 预填左栏物料生成框（仍须确认额度）；
   * 提交成功后 MaterialCreateCell 消费链接落 taskid↔facility，本组件轮询回填候选首位。
   * 独立只读分享页（plan-share）不传：按钮保留、回调缺省 no-op（?. 调用）。
   */
  onOpenMaterialGenerate?: (facilityId: string, kind: 'text' | 'image') => void;
}

const TILE = 256;
/**
 * 规划地图的缩放区间（用户实测反馈：活动场地最起码在一个城市里，
 * 缩到省/国家/世界级对做活动毫无意义，只会让「场地」变成看不见的一个点；
 * 上限放到 19 是为了贴到单棵树/斑马线的粒度）。
 */
const MAP_MIN_ZOOM = 12;
/**
 * 2026-11-11 用户反馈「放大倍数不够」：按图源分档放大上限——CARTO 瓦片原生支持到 z21、
 * 天地图影像/矢量 z18（z19+ 返回占位图）；纸面格网模式用 FLOOR 档。
 * OSM 官方瓦片 z20 直接 400（实测 tile.openstreetmap.org/20/... → 400 Bad Request，
 * 且 400 响应无 CORS 头，浏览器报「blocked by CORS policy」），所以 OSM 上限是 z19。
 */
function mapMaxZoomFor(source: CanvasBasemapSource): number {
  if (source === 'carto-light' || source === 'carto-dark') return 21;
  if (source === 'osm') return 19;
  // 2026-11-12 实测（杭州大剧院同坐标瓦片）：天地图影像 z18 是真影像（7487b），
  // z19/z20 返回的是同一张占位图（同 4769b、同 MD5）——真实数据到 z18 为止。
  // 上限按 18，更高级别由 paintBasemapTiles 的 overzoom 把 z18 瓦片等比拉伸
  // （清晰度优于占位图），与 3D 的 maxZoomForSource('img')=18 口径一致。
  if (source === 'img') return 18;
  // 2026-11-12 用户反馈「放大后满屏此区域无卫星图」实测（杭州/上海/北京/深圳/广州/成都六城
  // 同一哈希）：高德卫星 z19/z20 一律返回 4235 字节的灰色占位图（图上就印着「此区域无卫星图」），
  // 真影像到 z18 为止。原生级别按 18，19~22 级由 paintBasemapTiles 的 overzoom 把 z18
  // 瓦片等比拉伸——放大后保留最大精度影像（模糊放大），不再出现占位灰块。
  // 矢量（街道/街道注记）z19 起返回 100 多字节空瓦片 → 上限同为 18。
  if (source === 'amap-satellite') return 18;
  if (source === 'amap-streets' || source === 'amap-streets-labels') return 18;
  return 18;
}
/**
 * 2026-11-12 用户「放大倍数不够」：视图允许拉到的最大级别（不等于瓦片级别）。
 * 超过图源上限的部分由 `paintBasemapTiles` 的 overzoom 把上限级瓦片等比放大，
 * 再往里就是模糊放大——但缩放/平移/标尺照常工作，不会因为「没有 z20 瓦片」卡住。
 * 22 比 OSM 的 19 再多 8 倍（≈0.03 m/px，一张 1600px 画布只覆盖约 50m），
 * 足够贴到单个家具/护栏的把手。
 */
const MAP_MAX_ZOOM = 22;
/**
 * P4-b：室内平面底（`base='floor'`）的缩放区间。没有瓦片，zoom 只当米/像素的标尺用：
 * 18 ≈ 0.5 m/px（一眼看整间屋子），23 ≈ 0.02 m/px（看单个桌面）。
 */
const FLOOR_MIN_ZOOM = 18;
const FLOOR_MAX_ZOOM = 23;
/** 纸面底与网格色（与三维场景的冷灰地面区分开，避免和物料抢视线）。 */
const FLOOR_PAPER = '#f6f4ef';
const FLOOR_GRID_MINOR = 'rgba(23, 26, 31, 0.07)';
const FLOOR_GRID_MAJOR = 'rgba(23, 26, 31, 0.16)';

/**
 * P4-b：室内平面底。不请求任何瓦片，只把「一张纸 + 米制网格」铺出来；
 * 场地轮廓/分区/设施/动线由业务层照常叠上来，于是室内与户外共用同一套画布代码。
 * 网格间距随缩放自适应（1 m / 5 m / 20 m），原点对齐 plan 的 (0,0)，
 * 且 plan 的 y 轴向北 → 屏幕 y 递减。
 */
function paintFloorGrid(
  ctx: CanvasRenderingContext2D,
  viewport: PlanViewport,
  cssW: number,
  cssH: number,
): void {
  ctx.save();
  ctx.fillStyle = FLOOR_PAPER;
  ctx.fillRect(0, 0, cssW, cssH);
  const metersPerPx = planMetersPerPixel(viewport);
  if (Number.isFinite(metersPerPx) && metersPerPx > 0) {
    const pxPerMeter = 1 / metersPerPx;
    const stepM = pxPerMeter >= 24 ? 1 : pxPerMeter >= 8 ? 5 : 20;
    const spacing = stepM * pxPerMeter;
    if (spacing >= 4) {
      const origin = planPointToPixel({ x: 0, y: 0 }, viewport);
      const fromCol = Math.floor((0 - origin.x) / spacing) - 1;
      const toCol = Math.ceil((cssW - origin.x) / spacing) + 1;
      ctx.lineWidth = 1;
      for (let col = fromCol; col <= toCol; col += 1) {
        ctx.strokeStyle = col % 5 === 0 ? FLOOR_GRID_MAJOR : FLOOR_GRID_MINOR;
        const x = Math.round(origin.x + col * spacing) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, cssH);
        ctx.stroke();
      }
      const fromRow = Math.floor((origin.y - cssH) / spacing) - 1;
      const toRow = Math.ceil(origin.y / spacing) + 1;
      for (let row = fromRow; row <= toRow; row += 1) {
        ctx.strokeStyle = row % 5 === 0 ? FLOOR_GRID_MAJOR : FLOOR_GRID_MINOR;
        const y = Math.round(origin.y - row * spacing) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(cssW, y);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const isTdt = (s: CanvasBasemapSource): s is TdtProbeLayer => s === 'vec' || s === 'img';

const LAYER_ORDER: readonly ['boundary', 'zone', 'facility', 'route', 'worker', 'access', 'measure', 'annotate'] = ['boundary', 'zone', 'facility', 'route', 'worker', 'access', 'measure', 'annotate'];

/** 图层行键（node 不单列，节点挂 access 组）——别用含 node 的 PlanningLayerKind 当行键。 */
type PlanLayerRow = (typeof LAYER_ORDER)[number];

/** 2026-11-11 物件库「已放置」行的类型色点（取图层色，同图层栈口径）。 */
const PLACED_KIND_COLORS: Record<PlanInventoryKind, string> = {
  zone: PLANNING_LAYER_COLORS.zone,
  facility: PLANNING_LAYER_COLORS.facility,
  route: PLANNING_LAYER_COLORS.route,
  node: PLANNING_LAYER_COLORS.access,
  worker: PLANNING_LAYER_COLORS.worker,
  measurement: PLANNING_LAYER_COLORS.measure,
  annotation: PLANNING_LAYER_COLORS.annotate,
};

/** 2026-11-11 图层卡 OnePlan 镜像：清单 kind → 图层（文件夹行尾的可见性/锁定按层读写）。 */
const LAYER_OF_INVENTORY_KIND: Record<PlanInventoryKind, PlanLayerRow> = {
  zone: 'zone',
  facility: 'facility',
  route: 'route',
  node: 'access',
  worker: 'worker',
  measurement: 'measure',
  annotation: 'annotate',
};

/** 顶点手柄的命中半径（CSS px），与 drawBoundaryLayer 的手柄绘制半径一致。 */
const VERTEX_HANDLE_HIT_PX = 10;
/** P2-j：双击加点的「离边界线」命中半径（CSS px）：比拖动顶点更宽松，方便插点。 */
const VERTEX_EDGE_HIT_PX = 14;
/** 首顶点闭合热区半径（CSS px），与 drawDraftLayer 的闭合圆圈一致。 */
const DRAFT_CLOSE_HIT_PX = 10;
/** 区分「单击加顶点」与「拖拽平移」的位移阈值（CSS px）。 */
const CLICK_MAX_MOVE_PX = 4;
/** 2026-11-11 拖拽式测量：路径自由手绘的采样间距（CSS px，约每 8px 收一个点）。 */
const MEASURE_FREEHAND_SAMPLE_PX = 8;
/** 出入口节点命中/吸附半径（CSS px）：点选与动线端点吸附共用。 */
const NODE_HIT_PX = 11;
/** 人员点位命中半径（CSS px）。 */
const WORKER_HIT_PX = 9;
/** 2026-11-11 用户指令：自由标注命中半径（CSS px）：点选文本 pill 与形状边缘共用。 */
const ANNOTATION_HIT_PX = 8;
/** 路线折线命中半径（CSS px）：点到段距离。 */
const ROUTE_HIT_PX = 8;
/* ---------------- 2026-11-12 OnePlan Selection tool：组选/框选绘制（B2/B3） ---------------- */

/** 组柄方块边长（CSS px）——OnePlan 组包围盒白方柄同款小柄。 */
const GROUP_HANDLE_PX = 8;
/** 组柄命中半径（CSS px），略大于方块好点中。 */
const GROUP_HANDLE_HIT_PX = 12;
/** 组选/框选用蓝：对齐 OnePlan 截图选中蓝（单选画布仍走品牌绿，不动既有观感）。 */
const GROUP_SELECT_BLUE = '#3b82f6';

/** 组包围盒四角（plan 米制）：0=NW 1=NE 2=SE 3=SW。 */
function groupCornerPlanPoints(bounds: PlanRect): PlanPoint[] {
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
}

/** marquee 像素矩形 → plan 米制矩形（框选命中用）。 */
function marqueePlanRect(marquee: { startPx: { x: number; y: number }; curPx: { x: number; y: number } }, viewport: PlanViewport): PlanRect {
  const a = planPixelToPoint(marquee.startPx, viewport);
  const b = planPixelToPoint(marquee.curPx, viewport);
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/** 组角柄像素命中：返回角序号（0–3），未命中 null。 */
function groupCornerHandleAtPx(px: { x: number; y: number }, bounds: PlanRect, viewport: PlanViewport): number | null {
  const corners = groupCornerPlanPoints(bounds);
  for (let i = 0; i < corners.length; i += 1) {
    const corner = planPointToPixel(corners[i]!, viewport);
    if (Math.hypot(px.x - corner.x, px.y - corner.y) <= GROUP_HANDLE_HIT_PX) return i;
  }
  return null;
}

/** 组包围盒：蓝细线 + 四角白方柄（缩放拖动中加粗当前角）。 */
function drawGroupSelection(ctx: CanvasRenderingContext2D, viewport: PlanViewport, bounds: PlanRect, activeCorner: number | null): void {
  const corners = groupCornerPlanPoints(bounds).map(p => planPointToPixel(p, viewport));
  ctx.save();
  ctx.strokeStyle = GROUP_SELECT_BLUE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(corners[0]!.x, corners[0]!.y);
  for (let i = 1; i < 4; i += 1) ctx.lineTo(corners[i]!.x, corners[i]!.y);
  ctx.closePath();
  ctx.stroke();
  for (let i = 0; i < 4; i += 1) {
    ctx.beginPath();
    ctx.rect(corners[i]!.x - GROUP_HANDLE_PX / 2, corners[i]!.y - GROUP_HANDLE_PX / 2, GROUP_HANDLE_PX, GROUP_HANDLE_PX);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = activeCorner === i ? 2 : 1;
    ctx.stroke();
  }
  ctx.restore();
}

/** 框选拖拽矩形：蓝细线 + 淡填充（OnePlan marquee 同观感）。 */
function drawMarqueeRect(ctx: CanvasRenderingContext2D, marquee: { startPx: { x: number; y: number }; curPx: { x: number; y: number } }): void {
  const x = Math.min(marquee.startPx.x, marquee.curPx.x);
  const y = Math.min(marquee.startPx.y, marquee.curPx.y);
  const w = Math.abs(marquee.curPx.x - marquee.startPx.x);
  const h = Math.abs(marquee.curPx.y - marquee.startPx.y);
  ctx.save();
  ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = GROUP_SELECT_BLUE;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}
/** undo 栈深度上限（评审稿「撤销和恢复均保留有效引用」；快照体积小，30 步足够）。 */
const UNDO_LIMIT = 30;

/* ---------------- P2-i 摆设手感：设施手柄 / 图层锁定 / 比例尺指北针 ---------------- */

/** 设施尺寸可编辑区间（米）：与面板输入/契约同口径，拖动不会被拖成 0 或无限大。 */
const FACILITY_MIN_SIZE_M = 0.5;
const FACILITY_MAX_SIZE_M = 100;

/** P2-i：图层锁定表（key 缺省 = 未锁；只锁可编辑的业务层）。 */
type LockedLayerMap = Partial<Record<PlanningLayerKind, boolean>>;

/** P2-i：设施画布直接操作的拖拽会话（move=拖本体；rotate=拖旋转柄；resize=拖角柄；side=拖边柄单面拉伸）。 */
interface FacilityDragState {
  id: string;
  kind: 'move' | 'rotate' | 'resize' | 'side';
  /** resize 时的角柄序号（对应 facilityFootprintRing 角序 SW→SE→NE→NW）。 */
  corner: number;
  /** side 时的边柄序号（0=南 1=东 2=北 3=西）。 */
  side: number;
  startPt: PlanPoint;
  startPx: { x: number; y: number };
  startFacility: PlanFacility;
  moved: boolean;
  /** 拖拽中的预览（仅绘制用；松手才提交，避免每帧进 undo 栈）。 */
  preview: PlanFacility;
}

/** P2-i + 2026-11-11「多个面」：画选中设施的编辑手柄（虚线占地框 + 四角改尺寸方柄 + 四边单面拉伸圆柄 + 顶部旋转圆柄）。
    小物件自动走虚拟外扩盒（FACILITY_HANDLE_MIN_FOOTPRINT_PX），手柄永不在不可达位置。 */
function drawFacilityHandles(ctx: CanvasRenderingContext2D, viewport: PlanViewport, facility: PlanFacility) {
  const handles = facilityHandles(facility, viewport, FACILITY_HANDLE_MIN_FOOTPRINT_PX);
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  handles.corners.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(handles.topMid.x, handles.topMid.y);
  ctx.lineTo(handles.rotate.x, handles.rotate.y);
  ctx.stroke();
  const half = FACILITY_HANDLE_PX / 2;
  ctx.fillStyle = 'rgba(24, 26, 32, 0.88)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  for (const pt of handles.corners) {
    ctx.fillRect(pt.x - half, pt.y - half, FACILITY_HANDLE_PX, FACILITY_HANDLE_PX);
    ctx.strokeRect(pt.x - half, pt.y - half, FACILITY_HANDLE_PX, FACILITY_HANDLE_PX);
  }
  // 四边中点单面拉伸柄：小圆柄（视觉比角柄小一号，与旋转柄同形）。
  const sideR = FACILITY_HANDLE_PX / 2 - 1;
  for (const pt of handles.sides) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, sideR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(handles.rotate.x, handles.rotate.y, FACILITY_HANDLE_PX, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** 比例尺「好读数」候选（1/2/5×10^n）：挑最接近目标像素长度的米数。 */
const SCALE_NICE_METERS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];

function niceScaleMeters(metersPerPx: number, targetPx: number): { meters: number; px: number } {
  const targetM = Math.max(1e-6, metersPerPx * targetPx);
  let meters = SCALE_NICE_METERS[0]!;
  for (const candidate of SCALE_NICE_METERS) {
    if (Math.abs(Math.log(candidate / targetM)) < Math.abs(Math.log(meters / targetM))) meters = candidate;
  }
  return { meters, px: meters / metersPerPx };
}

/**
 * P2-i：画布左下角常驻比例尺 + 指北针。
 * 2026-11-11 用户指令「按范式改」：对齐 Google/高德式比例尺——无底盒、细线两端竖须、
 * 文字白描边（亮暗底图都可读）、小指北针；不再自制 i/尺子按钮（空间标定/光照 HUD 属室内，户外态由 CSS 隐藏）。
 * 与导出 PNG（site-plan-png 的 scaleBarMeters/northArrowGeometry）同口径：比例尺按当前缩放级
 * 真实换算，指北针固定「地图北向上」；瓦片底图与纸面底图都画，隐藏项由图层栈控制时不影响。
 */
function drawScaleAndNorth(ctx: CanvasRenderingContext2D, viewport: PlanViewport, cssW: number, cssH: number) {
  const mPerPx = planMetersPerPixel(viewport);
  if (!Number.isFinite(mPerPx) || mPerPx <= 0) return;
  const { meters } = niceScaleMeters(mPerPx, 96);
  const barPx = Math.max(24, Math.min(meters / mPerPx, Math.max(24, cssW - 170)));
  const label = meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
  const left = 14;
  const barY = cssH - 18;
  ctx.save();
  ctx.lineCap = 'butt';
  // 标准范式：文字白描边（halo）+ 深字，线上下短须——亮暗底图都可读。
  ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.strokeText(label, left, barY - 8);
  ctx.fillStyle = 'rgba(30, 32, 38, 0.92)';
  ctx.fillText(label, left, barY - 8);
  // 细线：白描边打底 + 深色主线，两端竖须。
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath();
  ctx.moveTo(left, barY);
  ctx.lineTo(left + barPx, barY);
  ctx.moveTo(left, barY - 5);
  ctx.lineTo(left, barY + 5);
  ctx.moveTo(left + barPx, barY - 5);
  ctx.lineTo(left + barPx, barY + 5);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(30, 32, 38, 0.92)';
  ctx.beginPath();
  ctx.moveTo(left, barY);
  ctx.lineTo(left + barPx, barY);
  ctx.moveTo(left, barY - 5);
  ctx.lineTo(left, barY + 5);
  ctx.moveTo(left + barPx, barY - 5);
  ctx.lineTo(left + barPx, barY + 5);
  ctx.stroke();
  // 指北针：小三角 + N（地图北向上，固定）。
  const nx = left + barPx + 26;
  const ny = barY - 6;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath();
  ctx.moveTo(nx, ny - 12);
  ctx.lineTo(nx - 6, ny + 2);
  ctx.lineTo(nx + 6, ny + 2);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = 'rgba(30, 32, 38, 0.92)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeText('N', nx, barY + 10);
  ctx.fillText('N', nx, barY + 10);
  ctx.restore();
}

/** 图源署名（右下角，Google/OnePlan 同款范式；OSM ODbL 要求可见署名）。
 *  文案随图源走（`basemapSourceAttribution`），高德三档不再挂天地图的名。 */
function drawAttribution(ctx: CanvasRenderingContext2D, source: CanvasBasemapSource, cssW: number, cssH: number) {
  const text = basemapSourceAttribution(source);
  ctx.save();
  ctx.font = '10px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'right';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  const x = cssW - 74; // 让开右下角图源切换圆钮（right 24 + 34 宽）
  const y = cssH - 14;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = 'rgba(30, 32, 38, 0.78)';
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** H3-c 规划信息面板页签（顺序固定：总览/清单/问题/图例）。 */
const INFO_TABS = ['overview', 'inventory', 'issues', 'legend'] as const;
const INFO_TAB_LABELS: Record<(typeof INFO_TABS)[number], string> = {
  overview: '总览',
  inventory: '清单',
  issues: '问题',
  legend: '图例',
};
/** 清单/问题列表单屏上限（与 PLAN_ISSUE_LIST_LIMIT 同口径，超出提示余量）。 */
const PLAN_INFO_LIST_LIMIT = 40;
/** 锚点缺省（与 initialView 同源）：plan.anchor 缺省时的经纬度。 */
const DEFAULT_ANCHOR_LNG = 120.141306;
const DEFAULT_ANCHOR_LAT = 30.2545;

/** H4-a 清单六类的类型胶囊：图标与图层图标映射同源，色用图层色。 */
const INVENTORY_KIND_ICONS: Record<PlanInventoryKind, PlanningIconName> = {
  zone: PLANNING_LAYER_ICONS.zone,
  facility: PLANNING_LAYER_ICONS.facility,
  route: PLANNING_LAYER_ICONS.route,
  node: PLANNING_LAYER_ICONS.node,
  worker: PLANNING_LAYER_ICONS.worker,
  measurement: PLANNING_LAYER_ICONS.measure,
  annotation: PLANNING_LAYER_ICONS.annotate,
};
const INVENTORY_KIND_COLORS: Record<PlanInventoryKind, string> = {
  zone: PLANNING_LAYER_COLORS.zone,
  facility: PLANNING_LAYER_COLORS.facility,
  route: PLANNING_LAYER_COLORS.route,
  node: PLANNING_LAYER_COLORS.node,
  worker: PLANNING_LAYER_COLORS.worker,
  measurement: PLANNING_LAYER_COLORS.measure,
  annotation: PLANNING_LAYER_COLORS.annotate,
};

/** H4-a 类型胶囊：清单行的「图标+类型」药丸，色从图层色派生（withAlphaHex），不另立色值。 */
function TypeCapsule({ kind, label }: { kind: PlanInventoryKind; label: string }) {
  const Icon = planningIcon(INVENTORY_KIND_ICONS[kind]);
  const color = INVENTORY_KIND_COLORS[kind];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: '0 6px',
        borderRadius: 999,
        border: `1px solid ${withAlphaHex(color, 0.55)}`,
        background: withAlphaHex(color, 0.14),
        fontSize: PLANNING_TYPOGRAPHY.hint,
        lineHeight: '16px',
        color: PLANNING_SURFACE.panelText,
      }}
    >
      <Icon size={PLANNING_ICON_SIZES.capsule} color={color} aria-hidden />
      {label}
    </span>
  );
}

/** 问题页签的可定位条目：文本 + 状态色 + 锚点 + 关联实体（点条目选中并居中）。 */
interface PlanLocatableIssue {
  key: string;
  text: string;
  color?: string;
  anchor: PlanPoint;
  routeId?: string;
  facilityId?: string;
  nodeId?: string;
  workerId?: string;
}

/** 浮窗宿主包装：宿主存在时 portal 过去（DOM 位置换到外部容器），否则原地渲染。 */
function PanelPortal({ host, children }: { host: HTMLElement | null; children: React.ReactNode }): JSX.Element {
  if (!host) return <>{children}</>;
  return createPortal(children, host);
}

/** P2-g：室外画布对外命令句柄（室内工具排通用钮转发：撤销/重做/缩放/截图）。 */
export interface OutdoorPlanCanvasHandle {
  /** 缩放一档（+/-1）与滚轮同源。 */
  zoomBy(direction: 1 | -1): void;
  /** 当前业务层画布截图 dataURL（无 canvas 时 null）。 */
  captureImage(): string | null;
  /** 撤销（与画布顶部「撤销」钮、Ctrl+Z 同源）。 */
  undo(): void;
  /** 重做（撤销的反向；新编辑会清空重做栈）。 */
  redo(): void;
  /** 撤销/重做可用态（工具排按钮 disabled 用）。 */
  canUndo(): boolean;
  canRedo(): boolean;
  /** P2-k：飞到某个经纬度（可带 zoom）；只动视图，不改 plan/anchor。 */
  focusLngLat(lng: number, lat: number, zoom?: number): void;
  /** 2026-11-12 选区：把视野框到 `[west, south, east, north]`（只动视图，不改 plan/anchor）。 */
  focusBounds(bounds: [number, number, number, number]): void;
  /** V-2d：应用流线提案（合并 routes/nodes 进 plan，commitPlan 可撤销）；空提案回 false。 */
  applyRoutes(routes: PlanRoute[], nodes: PlanNode[]): boolean;
  /** V-3c：应用区域提案（合并 zones/facilities 进 plan，commitPlan 可撤销）；空提案回 false。 */
  applyZoneProposal(zones: PlanZone[], facilities: PlanFacility[]): boolean;
  /** 当前 2D 视口（切 3D 时用来对着同一中心把地图斜起来）。 */
  getView(): PlanViewport;
  /** 当前绘制/浏览模式：3D 里非浏览态要关掉左键环绕，把点击交给编辑。 */
  getMode(): string;
  /** 2026-11-12 B1 选择工具：切绘制/浏览模式（右栏工具排「选择」钮转发）。 */
  setMode(mode: string): void;
  /** 2026-11-12 测量/标注收进右轨圆钮：开/关「工具与属性」浮窗并切页签。 */
  setInspector(open: boolean, tab?: 'measure' | 'annotate' | 'selection'): void;
  /** 2D 底图瓦片缓存（含往上 4 级祖先兜底）；3D 共用这份，切换时不用重新下图。 */
  getTileCache(): BasemapTileCache;
  /** 图层里的「底图」开关：2D / 3D 共用。 */
  getBasemapVisible(): boolean;
  /**
   * 3D 倾斜地图把地面命中转成规划坐标后，走和 2D 画布同一套编辑手势。
   * 按下时返回 true 表示编辑手势吃掉了这次点击（3D 应暂停环绕）。
   */
  pointerFromPlan(
    kind: 'down' | 'move' | 'up' | 'leave' | 'dblclick' | 'contextmenu',
    hit: { px: { x: number; y: number }; pt: PlanPoint } | null,
    flags?: { button?: number; shiftKey?: boolean; clientX?: number; clientY?: number; viewport?: PlanViewport },
  ): boolean;
  /** 3D 编辑时用来同步预览、选中态和正在画/放的草稿。 */
  getEditVisuals(): PlanEditVisuals;
  /** 2026-11-12 B3 一期：当前户外选区 id（zone/facility/route/node/worker/annotation + 组选设施）；无选空数组。 */
  getSelectedIds(): string[];
}

/** 3D 倾斜地图用来叠当前编辑预览（草稿折线、幽灵占位）。 */
export interface PlanEditVisuals {
  plan: SitePlanData;
  selectedZoneId: string | null;
  /** 2026-11-12 3D 手柄：当前选中的设施 id（null=无选中）；3D 据此挂编辑手柄。 */
  selectedFacilityId: string | null;
  /** 2026-11-12 3D 手柄：设施层当前可直接编辑（浏览/选择模式 + 未锁定）；false 时 3D 不挂柄。 */
  facilityEditable: boolean;
  draft: {
    ring: PlanPoint[];
    ringColor: string;
    fill: boolean;
    route: PlanPoint[];
    routeColor: string;
    measure: PlanPoint[];
    measureColor: string;
    annotate: PlanPoint[];
    annotateColor: string;
    ghostMarker: { position: PlanPoint; color: string } | null;
  };
}

export const OutdoorPlanCanvasImpl = forwardRef<OutdoorPlanCanvasHandle, OutdoorPlanCanvasProps>(function OutdoorPlanCanvas({
  plan,
  source = 'osm',
  base = 'map',
  initialView,
  visibility,
  onVisibilityChange,
  onViewChange,
  onPlanChange,
  panelsHostId,
  infoPanelHostId,
  libraryPanelHostId,
  levelsHostId,
  measureHostId,
  annotateHostId,
  inspectorHostId,
  onActiveLevelChange,
  onHistoryChange,
  onInspectorChange,
  onModeChange,
  searchPin,
  searchArea,
  routeProposal,
  zoneProposal,
  flowSimRoutes,
  sceneObjects,
  onOpenMaterialGenerate,
}: OutdoorPlanCanvasProps, ref) {
  // 浮窗外挂宿主（左栏卡片）：宿主 DOM 在覆盖层首帧后才有，effect 后解析；
  // 查不到（左栏收起/未渲染）时 PanelPortal 自动回落画布内浮窗。
  // 两卡分属两个容器：图层栈跟 panelsHostId，规划信息跟 infoPanelHostId（缺省同前）。
  const [layerPanelHost, setLayerPanelHost] = useState<HTMLElement | null>(null);
  const [infoPanelHost, setInfoPanelHost] = useState<HTMLElement | null>(null);
  const [libraryPanelHost, setLibraryPanelHost] = useState<HTMLElement | null>(null);
  const [levelsPanelHost, setLevelsPanelHost] = useState<HTMLElement | null>(null);
  const [measurePanelHost, setMeasurePanelHost] = useState<HTMLElement | null>(null);
  const [annotatePanelHost, setAnnotatePanelHost] = useState<HTMLElement | null>(null);
  const [inspectorPanelHost, setInspectorPanelHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!panelsHostId && !infoPanelHostId && !libraryPanelHostId && !levelsHostId && !measureHostId && !annotateHostId && !inspectorHostId) return undefined;
    let alive = true;
    const current = { layers: null as HTMLElement | null, info: null as HTMLElement | null, library: null as HTMLElement | null, levels: null as HTMLElement | null, measure: null as HTMLElement | null, annotate: null as HTMLElement | null, inspector: null as HTMLElement | null };
    const resolve = () => {
      if (!alive) return;
      const next = {
        layers: panelsHostId ? document.getElementById(panelsHostId) : null,
        info: (infoPanelHostId ?? panelsHostId) ? document.getElementById(infoPanelHostId ?? panelsHostId ?? '') : null,
        library: libraryPanelHostId ? document.getElementById(libraryPanelHostId) : null,
        levels: levelsHostId ? document.getElementById(levelsHostId) : null,
        measure: measureHostId ? document.getElementById(measureHostId) : null,
        annotate: annotateHostId ? document.getElementById(annotateHostId) : null,
        inspector: inspectorHostId ? document.getElementById(inspectorHostId) : null,
      };
      if (next.layers !== current.layers) { current.layers = next.layers; setLayerPanelHost(next.layers); }
      if (next.info !== current.info) { current.info = next.info; setInfoPanelHost(next.info); }
      if (next.library !== current.library) { current.library = next.library; setLibraryPanelHost(next.library); }
      if (next.levels !== current.levels) { current.levels = next.levels; setLevelsPanelHost(next.levels); }
      if (next.measure !== current.measure) { current.measure = next.measure; setMeasurePanelHost(next.measure); }
      if (next.annotate !== current.annotate) { current.annotate = next.annotate; setAnnotatePanelHost(next.annotate); }
      if (next.inspector !== current.inspector) { current.inspector = next.inspector; setInspectorPanelHost(next.inspector); }
    };
    resolve();
    // 规划信息的宿主现在挂在 Bingo 面板里：Bingo 开/关会让宿主晚出现或消失，靠观察器补解析。
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => resolve());
    observer?.observe(document.body, { childList: true, subtree: true });
    return () => { alive = false; observer?.disconnect(); setLayerPanelHost(null); setInfoPanelHost(null); setLibraryPanelHost(null); setLevelsPanelHost(null); setMeasurePanelHost(null); setAnnotatePanelHost(null); setInspectorPanelHost(null); };
  }, [panelsHostId, infoPanelHostId, libraryPanelHostId, levelsHostId, measureHostId, annotateHostId, inspectorHostId]);
  const stageRef = useRef<HTMLDivElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const planCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({
    lng: initialView?.lng ?? (plan.anchor?.lng ?? 120.141306),
    lat: initialView?.lat ?? (plan.anchor?.lat ?? 30.2545),
    zoom: initialView?.zoom ?? (base === 'floor' ? 20 : 16),
  });
  const sourceRef = useRef<CanvasBasemapSource>(source);
  const planRef = useRef<SitePlanData>(plan);
  // 2026-11-11 图层（Level = 独立设计方案，非楼层）：活动层 id 同时进 state（面板渲染）与 ref（draw/命中读取）。
  const [activeLevelId, setActiveLevelId] = useState<string>(() => planLevels(plan)[0]!.id);
  const activeLevelIdRef = useRef<string>(activeLevelId);
  // 图层行 popover：开关 + 重命名草稿 + 删除两步确认（arm 后需再点一次「确认删除」）。
  const [levelMenuOpen, setLevelMenuOpen] = useState(false);
  const [renamingLevelId, setRenamingLevelId] = useState<string | null>(null);
  const [levelNameDraft, setLevelNameDraft] = useState('');
  const [deleteArmLevelId, setDeleteArmLevelId] = useState<string | null>(null);
  const panRef = useRef<{ x: number; y: number }>();
  const layerStateRef = useRef<LayerVisibility>(visibility ?? defaultLayerVisibility());
  // 底图瓦片缓存：同一 URL 只加载一次，缺当前层级时用上一级兜底 —— 缩放不再一闪一闪。
  const basemapCacheRef = useRef<BasemapTileCache | null>(null);
  const tileRedrawRafRef = useRef(0);
  // P4-b：底图形态放 ref 里，draw 才能在不重建回调的前提下切纸面/瓦片。
  const baseModeRef = useRef<'map' | 'floor'>(base);
  const drawRef = useRef<() => void>(() => {});
  // P2-k：搜地点落钉（props 变化时同步到 ref 再重绘，draw 保持零依赖）。
  const searchPinRef = useRef<{ lng: number; lat: number; label: string } | null>(searchPin ?? null);
  const searchAreaRef = useRef<{ polygon: [number, number][]; label: string; kind?: 'area' | 'line' } | null>(searchArea ?? null);
  // V-2d：流线提案预览（同一路数；应用走 handle.applyRoutes，预览本身不进 plan）。
  const routeProposalRef = useRef<{ routes: PlanRoute[]; nodes: PlanNode[] } | null>(routeProposal ?? null);
  // V-3c：区域提案预览（同一路数；应用走 handle.applyZoneProposal，预览本身不进 plan）。
  const zoneProposalRef = useRef<{ zones: PlanZone[]; facilities: PlanFacility[] } | null>(zoneProposal ?? null);
  // V-4b：流动模拟（walkers 状态放 ref，ticker 步进后整帧重绘；模拟不写 plan）。
  const flowSimRef = useRef<{ walkers: FlowWalker[]; routes: PlanRoute[] } | null>(null);

  // H2-b 编辑状态（state 供渲染面板，ref 供稳定 draw() 读取）。
  const modeRef = useRef<PlanningEditMode>('view');
  const draftRef = useRef<PlanPoint[]>([]);
  const previewRingRef = useRef<PlanPoint[] | null>(null);
  const dragVertexRef = useRef<number | null>(null);
  const downPxRef = useRef<{ x: number; y: number } | null>(null);
  const issuesRef = useRef<PlanZoneIssue[]>([]);
  // H2-c 设施放置：待放模板、幽灵位置、选中设施。
  // P2-h：物件库里的物件不是 8 个内置模板之一，所以额外记一份模板对象（尺寸/名称来自库条目）。
  const facilityTemplateRef = useRef<string | null>(null);
  const facilityTemplateObjRef = useRef<PlanFacilityTemplate | null>(null);
  const ghostPointRef = useRef<PlanPoint | null>(null);
  const selectedFacilityRef = useRef<string | null>(null);
  const facilityIssuesRef = useRef<PlanFacilityIssue[]>([]);
  // H2-d 动线/节点/人员：绘制草稿、语义选择、选中实体、问题清单、undo。
  const routeKindRef = useRef<PlanningRouteKind>('pedestrian');
  const routeDraftRef = useRef<PlanPoint[]>([]);
  const routeCursorRef = useRef<PlanPoint | null>(null);
  const routeOneWayRef = useRef(false);
  const nodeKindRef = useRef<PlanNode['kind']>('entry');
  const nodeGhostRef = useRef<PlanPoint | null>(null);
  const workerGhostRef = useRef<PlanPoint | null>(null);
  const [basemapVisible, setBasemapVisible] = useState(true);
  const basemapVisibleRef = useRef(true);
  // 2026-11-12 用户「地图加载时页面灰扑扑」：底图补瓦片期间在画布顶部给一枚轻提示。
  const [basemapLoading, setBasemapLoading] = useState(false);
  const basemapLoadingRef = useRef(false);
  const workerRoleRef = useRef('安保');
  const workerCountRef = useRef(1);
  // 2026-11-12 活动包物件预设：动线（颜色/名称/线型）、分区（颜色/名称）、人员点位色。
  // setMode 统一清空；pickPackEntry 在切模式之后写入。
  const routePresetRef = useRef<{ kind: PlanningRouteKind; color?: string; name?: string } | null>(null);
  const zonePresetRef = useRef<{ color?: string; name?: string } | null>(null);
  const workerPresetColorRef = useRef<string | null>(null);
  const selectedRouteRef = useRef<string | null>(null);
  const selectedNodeRef = useRef<string | null>(null);
  const selectedWorkerRef = useRef<string | null>(null);
  const nodeIssuesRef = useRef<PlanNodeIssue[]>([]);
  const workerIssuesRef = useRef<PlanWorkerIssue[]>([]);
  const dragNodeRef = useRef<{ id: string; moved: boolean } | null>(null);
  const nodeDragPreviewRef = useRef<{ node: PlanNode; routes: PlanRoute[] } | null>(null);
  const historyRef = useRef<SitePlanData[]>([]);
  /** P2-g 重做栈：撤销时把当前快照推进来，任何新编辑清空（与 historyRef 对称，同样 30 步）。 */
  const redoRef = useRef<SitePlanData[]>([]);
  // H3-a 测量：类型、草稿、指针（临时读数）。
  const measureKindRef = useRef<PlanMeasureKind>('distance');
  const measureDraftRef = useRef<PlanPoint[]>([]);
  const measureCursorRef = useRef<PlanPoint | null>(null);
  /** 2026-11-11 拖拽式测量：左键按下起点 + 是否已越过点击阈值（进入拖拽）。 */
  const measureDragRef = useRef<{ startPx: { x: number; y: number }; startPt: PlanPoint; active: boolean } | null>(null);
  /**
   * 2026-11-11 用户指令：自由标注（OnePlan T + 形状）。形状四类共用一份草稿/拖拽会话
   * （rect/circle/line 拖拽或两点、triangle 单击 3 点）；文本走 noteInput 就地输入，不占草稿。
   */
  const annotateShapeRef = useRef<PlanShapeKind>('rect');
  const annotateDraftRef = useRef<PlanPoint[]>([]);
  const annotateCursorRef = useRef<PlanPoint | null>(null);
  const annotateDragRef = useRef<{ startPx: { x: number; y: number }; startPt: PlanPoint; active: boolean } | null>(null);
  const selectedAnnotationRef = useRef<string | null>(null);
  // H3-b 冲突/缺失：可定位标记（规则检查输出，恒在业务层之上）。
  const conflictIssuesRef = useRef<PlanConflictIssue[]>([]);
  /**
   * P2-i 设施直接操作：画布上拖动 / 拖旋转柄 / 拖四角改尺寸的会话状态。
   * preview 只在绘制里用，松手才 commitPlan（拖拽过程不写 undo 栈）。
   */
  const facilityDragRef = useRef<FacilityDragState | null>(null);
  /* 2026-11-12 OnePlan Selection tool（B1–B3）：框选多选设施。
     multiSelectedFacilityIds 与单选互斥（≥2 件才叫组选，1 件回落单选）；
     marquee 框选与组拖拽/组缩放会话都走 ref（draw 读取）+ state（驱动重渲）。 */
  const [multiSelectedFacilityIds, setMultiSelectedFacilityIds] = useState<string[]>([]);
  const multiSelectedFacilityIdsRef = useRef<string[]>([]);
  const marqueeRectRef = useRef<{ startPx: { x: number; y: number }; curPx: { x: number; y: number } } | null>(null);
  /** 组会话：move=整组平移；scale=角柄等比缩放（anchor=对角，米制）。preview 与单选拖拽同机制，松手一条 undo。 */
  const groupDragRef = useRef<{
    kind: 'move' | 'scale';
    items: PlanFacility[];
    bounds: PlanRect;
    anchor: PlanPoint;
    startPt: PlanPoint;
    startPx: { x: number; y: number };
    corner: number;
    moved: boolean;
    preview: PlanFacility[] | null;
  } | null>(null);
  /** P2-i 图层锁定：锁定层不参与命中与编辑（显示、统计、图例口径不变）。 */
  const lockedLayersRef = useRef<LockedLayerMap>({});
  /** P2-j 分区选中与顶点改形：选中的分区 id + 正在拖的顶点 + 拖动预览多边形。 */
  const selectedZoneRef = useRef<string | null>(null);
  const dragZoneVertexRef = useRef<{ zoneId: string; index: number } | null>(null);
  const zoneDragPreviewRef = useRef<{ zoneId: string; polygon: PlanPoint[] } | null>(null);

  const [view, setView] = useState<View>({ ...viewRef.current });
  const [dragging, setDragging] = useState(false);
  const [layerState, setLayerState] = useState<LayerVisibility>(visibility ?? defaultLayerVisibility());
  /** P2-i 图层锁定（UI 状态；命中过滤读 lockedLayersRef，避免闭包过期）。 */
  const [lockedLayers, setLockedLayers] = useState<LockedLayerMap>({});
  const [panelOpen, setPanelOpen] = useState(true);
  /** 2026-11-11 OnePlan Placed Objects 文件夹树：类型文件夹展开状态（缺省全展开）。 */
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [mode, setModeState] = useState<PlanningEditMode>('view');
  const [zoneSemantic, setZoneSemantic] = useState<PlanningZoneSemantic>('audience');
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<PlanZoneIssue[]>([]);
  const [facilityTemplateId, setFacilityTemplateId] = useState<string | null>(null);
  // P2-h 物件库：549 件 OnePlan 贴纸（左栏第三个页签）。清单 440 KB，只在挂载时拉一次。
  const [libraryAll, setLibraryAll] = useState<LibraryEntry[]>([]);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryStatus, setLibraryStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  // 2026-11-12 活动包：packs.json（物件级，6 包 203 件）+ 面板视图（树 / OnePlan marketplace 包浏览）。
  const [libraryPacks, setLibraryPacks] = useState<OneplanPacksFile['packs']>([]);
  const [libraryView, setLibraryView] = useState<'tree' | 'packs'>('tree');
  const [openPackId, setOpenPackId] = useState<string | null>(null);
  
  /**
   * P2-k 目录（用户 m05190）：进户外规划就是三段行——区域、路线及交通 / 基础设施 / 劳动力。
   * 2026-11-11 用户指令（m00575）：一级段与二级子组**都要能同时展开多个**——
   * 以前 `librarySection`/`librarySubgroup` 是单选（手风琴），点开「电力」会把「照明」收掉，
   * 用户要对比几类设备时只能来回点。现改为「展开集合」：一级存 section id，
   * 二级存 `${sectionId}:${subKey}`（带段前缀，避免不同段的同名子组互相覆盖）。
   */
  const [openLibrarySections, setOpenLibrarySections] = useState<string[]>(['areas']);
  const [openLibrarySubgroups, setOpenLibrarySubgroups] = useState<string[]>(['areas:区域']);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(null);
  /** P2-l 右键层级菜单（用户 m05344）：上移一层 / 置于顶层 / 下移一层 / 置于底层。 */
  const [facilityMenu, setFacilityMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [facilityIssues, setFacilityIssues] = useState<PlanFacilityIssue[]>([]);
  const [routeKind, setRouteKind] = useState<PlanningRouteKind>('pedestrian');
  // 2026-11-11 OnePlan 纯度：oneWay/草稿计数/节点类型/人数的纯 UI 态随图层伴随项移除——
  // 画布逻辑读各自的 ref（draw 侧真值），oneWay/类型/人数改在选中实体编辑器里调。
  const [, setRouteDraftCount] = useState(0);
  const [workerRole, setWorkerRole] = useState('安保');
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  /** 2026-11-11 OnePlan Repeat 阵列：沿物件自身旋转轴复制 cols×rows（含原件），间距可调。 */
  const [repeatCols, setRepeatCols] = useState(2);
  const [repeatRows, setRepeatRows] = useState(1);
  const [repeatGapX, setRepeatGapX] = useState(1);
  const [repeatGapY, setRepeatGapY] = useState(1);
  // 2026-11-12 OnePlan 面板换页：属性页 ⇄ 阵列复制页（标题行图标钮切换，选中变化即回属性页）。
  const [facilityCardMode, setFacilityCardMode] = useState<'props' | 'repeat'>('props');
  // 手风琴（+ 布场信息 / + 备注）：默认收起，同 OnePlan。
  const [facilitySetupOpen, setFacilitySetupOpen] = useState(false);
  const [facilityNotesOpen, setFacilityNotesOpen] = useState(false);
  // V-5a 模型候选切换：选中设施的 3D 模型候选（loadFacilityModelCandidates：内置映射同步
  // + 在线物料库异步兜底，上限 5）。属性卡「模型」网格渲染；点候选写 facility.modelOverride。
  const [facilityModelCandidates, setFacilityModelCandidates] = useState<{ templateId: string; items: FacilityModelCandidate[] } | null>(null);
  // V-5b/c：生成/导入注册表的 revision——回填完成（或 GLB 导入）时候选网格实时重排。
  const generatedModelsRevision = useSyncExternalStore(
    subscribeGeneratedFacilityModels,
    getGeneratedFacilityModelsRevision,
    getGeneratedFacilityModelsRevision,
  );
  const facilityGenerateLinksRevision = useSyncExternalStore(
    subscribeFacilityGenerateLinks,
    getFacilityGenerateLinksRevision,
    getFacilityGenerateLinksRevision,
  );
  useEffect(() => {
    const facility = selectedFacilityId ? plan.facilities.find(f => f.id === selectedFacilityId) : null;
    const templateId = facility?.templateId ?? null;
    if (!templateId) {
      setFacilityModelCandidates(null);
      return undefined;
    }
    // 同模板换选不重拉（函数式 set 同引用即跳过），plan 编辑重跑只是自愈。
    let alive = true;
    setFacilityModelCandidates(current => (current?.templateId === templateId ? current : { templateId, items: [] }));
    void loadFacilityModelCandidates([templateId])
      .then(map => {
        if (!alive) return;
        // V-5b/c：生成/导入回填的候选排最前（「生成完回填候选首位」），库内候选殿后；
        // 上限放行生成位，不让回填把库内候选挤没。
        const generated = listGeneratedFacilityModels(facility?.id);
        const items = [...generated, ...(map.get(templateId) ?? [])]
          .slice(0, MAX_FACILITY_MODEL_CANDIDATES + generated.length);
        setFacilityModelCandidates(current => (current?.templateId === templateId ? { templateId, items } : current));
      })
      .catch(() => {
        /* 在线候选拉不到：网格只显示「自动」位，不空崩。 */
      });
    return () => { alive = false; };
  }, [selectedFacilityId, plan, generatedModelsRevision]);

  /**
   * V-5b/c：选中设施的生成任务轮询。链接在 recordFacilityGenerateLink 时落库（含 localStorage），
   * 换选再回来接着轮；imported → 候选首位回填（注册表订阅刷新网格），failed → 消息并清链接。
   */
  const [facilityGenerateStatus, setFacilityGenerateStatus] = useState<{ facilityId: string; name: string; message: string } | null>(null);
  useEffect(() => {
    if (!selectedFacilityId) {
      setFacilityGenerateStatus(null);
      return undefined;
    }
    let alive = true;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        for (const link of listFacilityGenerateLinks(selectedFacilityId)) {
          const result = await resolveFacilityGenerateLink(link.taskid);
          if (!alive) return;
          if (result.state === 'imported') {
            setFacilityGenerateStatus(null);
            setEditMessage(`「${result.model.name}」生成完成，已回填「${result.model.facilityName}」候选首位，点候选即可切 3D 模型。`);
          } else if (result.state === 'failed') {
            setFacilityGenerateStatus(null);
            setEditMessage(`「${link.name}」${result.message}`);
          } else {
            setFacilityGenerateStatus({ facilityId: link.facilityId, name: link.name, message: result.message });
          }
        }
        if (alive && listFacilityGenerateLinks(selectedFacilityId).length === 0) setFacilityGenerateStatus(null);
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => { void tick(); }, FACILITY_GENERATE_POLL_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, [selectedFacilityId, facilityGenerateLinksRevision, generatedModelsRevision]);

  /** V-5b/c：本机 GLB 直传兜底（≤10MB，会话内有效）。缓存键 local-glb:* 与室内导入同链路。 */
  const glbImportInputRef = useRef<HTMLInputElement | null>(null);
  const handleImportFacilityGlb = async (file: File | undefined) => {
    const facility = selectedFacilityId ? plan.facilities.find(f => f.id === selectedFacilityId) : null;
    if (!file || !facility) return;
    const invalid = validateLocalGlbPick(file);
    if (invalid) {
      setEditMessage(invalid);
      return;
    }
    // three/glb-assets 只在真导入时动态进包：2D 画布主包不带 three。
    try {
      const [{ importLocalGlb }] = await Promise.all([import('../three/glb-assets')]);
      const asset = await importLocalGlb(file, newLocalGlbKey());
      registerGeneratedFacilityModel({
        slug: `generated:${asset.key}`,
        name: asset.name,
        glbUrl: asset.key,
        width: asset.width,
        depth: asset.depth,
        height: asset.height,
        facilityId: facility.id,
        facilityName: facility.name,
        createdAt: Date.now(),
        sessionOnly: true,
      });
      setEditMessage(`「${asset.name}」已导入并回填候选首位（仅本次编辑有效，刷新后需重新导入），点候选即可切 3D 模型。`);
    } catch (error) {
      setEditMessage(error instanceof Error ? error.message : 'GLB 导入失败，请重试。');
    }
  };
  /** P2-j：选中的分区（画布上画顶点手柄，拖顶点改形）。 */
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [nodeIssues, setNodeIssues] = useState<PlanNodeIssue[]>([]);
  const [workerIssues, setWorkerIssues] = useState<PlanWorkerIssue[]>([]);
  const [historyCount, setHistoryCount] = useState(0);
  /** P2-g 重做栈深度（state 供工具排 disabled，ref 供命令句柄即时查询）。 */
  const [redoCount, setRedoCount] = useState(0);
  const [measureKind, setMeasureKind] = useState<PlanMeasureKind>('distance');
  const [measureDraftCount, setMeasureDraftCount] = useState(0);
  // 2026-11-11 用户指令：自由标注 UI 态（形状类型/草稿计数/选中/文本就地输入框）。
  const [annotateShape, setAnnotateShape] = useState<PlanShapeKind>('rect');
  const [annotateDraftCount, setAnnotateDraftCount] = useState(0);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  /** 文本标注就地输入框：锚点（米制）+ 屏幕位置（渲染时现算）+ 草稿文本。 */
  const [noteInput, setNoteInput] = useState<{ pt: PlanPoint; value: string } | null>(null);
  /** noteInput 的 ref 镜像（事件回调里读最新值，避免闭包旧值）。 */
  const noteInputRef = useRef<{ pt: PlanPoint; value: string } | null>(null);
  /** 同步更新文本输入框的 state 与 ref。 */
  function updateNoteInput(next: { pt: PlanPoint; value: string } | null) {
    noteInputRef.current = next;
    setNoteInput(next);
  }
  const [conflictIssues, setConflictIssues] = useState<PlanConflictIssue[]>([]);
  // H3-c 规划信息面板：页签、开关、筛选与提示消息（面板自带 status 行，只读也可用）。
  const [infoOpen, setInfoOpen] = useState(true);
  // 2026-11-12 用户指令：三张卡拆开——测量 / 标注 / 属性各一张，各自展开/收起，可并存。
  const [inspectorPanels, setInspectorPanels] = useState<Record<'measure' | 'annotate' | 'selection', boolean>>({ measure: false, annotate: false, selection: false });
  const setInspectorPanel = useCallback((tab: 'measure' | 'annotate' | 'selection', open: boolean) => {
    setInspectorPanels(current => (current[tab] === open ? current : { ...current, [tab]: open }));
  }, []);
  // 2026-11-12 「好用一点的交互」：卡头可折叠（只收内容、不关卡片），三张卡同时开着也不挤。
  const [inspectorCollapsed, setInspectorCollapsed] = useState<Record<'measure' | 'annotate' | 'selection', boolean>>({ measure: false, annotate: false, selection: false });
  const toggleInspectorCollapsed = useCallback((tab: 'measure' | 'annotate' | 'selection') => {
    setInspectorCollapsed(current => ({ ...current, [tab]: !current[tab] }));
  }, []);
  const [infoTab, setInfoTab] = useState<(typeof INFO_TABS)[number]>('overview');
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [invKind, setInvKind] = useState<PlanInventoryFilter['kind']>('all');
  const [invZone, setInvZone] = useState<PlanInventoryFilter['zone']>(undefined);
  const [invIssuesOnly, setInvIssuesOnly] = useState(false);
  const infoPanelRef = useRef<HTMLDivElement>(null);

  function setMode(next: PlanningEditMode) {
    modeRef.current = next;
    draftRef.current = [];
    previewRingRef.current = null;
    dragVertexRef.current = null;
    facilityTemplateRef.current = null;
    ghostPointRef.current = null;
    setFacilityTemplateId(null);
    routeDraftRef.current = [];
    routeCursorRef.current = null;
    nodeGhostRef.current = null;
    workerGhostRef.current = null;
    measureDraftRef.current = [];
    measureCursorRef.current = null;
    measureDragRef.current = null;
    // 2026-11-11 用户指令：切模式清空标注草稿与文本输入框。
    annotateDraftRef.current = [];
    annotateCursorRef.current = null;
    annotateDragRef.current = null;
    setAnnotateDraftCount(0);
    updateNoteInput(null);
    dragNodeRef.current = null;
    nodeDragPreviewRef.current = null;
    // 2026-11-12 活动包预设随切模式重置（pickPackEntry 在 setMode 之后写入，不受影响）。
    routePresetRef.current = null;
    zonePresetRef.current = null;
    workerPresetColorRef.current = null;
    setRouteDraftCount(0);
    setMeasureDraftCount(0);
    // 2026-11-12 B2 选择工具：结束组会话/框选会话；进绘图模式（非 view/select）连组选一起清
    //（OnePlan 同语义：选择态只在浏览/选择两个工具间保留）。
    groupDragRef.current = null;
    marqueeRectRef.current = null;
    if (next !== 'select' && next !== 'view') clearMultiSelection(false);
    setModeState(next);
    setEditMessage(null);
    onModeChange?.(next);
    draw();
  }

  function setDraft(next: PlanPoint[]) {
    draftRef.current = next;
    draw();
  }

  function setPreviewRing(next: PlanPoint[] | null) {
    previewRingRef.current = next;
    draw();
  }

  /* ---------------- 2026-11-11 图层（Level = 独立设计方案，非楼层） ---------------- */

  /** 当前活动层的过滤视图：绘制/命中/统计/问题清单统一口径；边界与锚点跨层共享。 */
  function viewPlan(): SitePlanData {
    return filterPlanByLevel(planRef.current, activeLevelIdRef.current);
  }

  /** 新实体的图层戳：默认（第一）层省略 levelId——缺省即第一层，旧数据形态不变。 */
  function activeLevelStamp(): { levelId?: string } {
    const levels = planLevels(planRef.current);
    const id = activeLevelIdRef.current;
    return id === levels[0]!.id ? {} : { levelId: id };
  }

  /** 切换活动层：清全部选中与半成品草稿（另一层的实体不挂着本层选中态），回浏览模式。 */
  function switchLevel(id: string) {
    if (id === activeLevelIdRef.current) return;
    if (!planLevels(planRef.current).some(level => level.id === id)) return;
    activeLevelIdRef.current = id;
    setActiveLevelId(id);
    clearMultiSelection(false);
    selectFacility(null);
    selectZone(null);
    selectRoute(null);
    selectNode(null);
    selectWorker(null);
    selectAnnotation(null);
    setFacilityMenu(null);
    draftRef.current = [];
    setDraft([]);
    routeDraftRef.current = [];
    setRouteDraftCount(0);
    measureDraftRef.current = [];
    setMeasureDraftCount(0);
    annotateDraftRef.current = [];
    setAnnotateDraftCount(0);
    updateNoteInput(null);
    ghostPointRef.current = null;
    nodeGhostRef.current = null;
    routeCursorRef.current = null;
    measureCursorRef.current = null;
    measureDragRef.current = null;
    annotateCursorRef.current = null;
    annotateDragRef.current = null;
    if (modeRef.current !== 'view') setMode('view');
    setEditMessage(null);
    onActiveLevelChange?.(id);
    draw();
  }

  /** 新建图层并切换（走 commitPlan 可撤销；名称自动「图层 N」）。 */
  function addLevel() {
    const result = addPlanLevel(planRef.current);
    if (!result.ok) {
      setEditMessage(result.issue.message);
      return;
    }
    commitPlan(result.value.plan);
    switchLevel(result.value.level.id);
    setEditMessage(`已新建「${result.value.level.name}」并切换过去；撤销可回退。`);
  }

  /** 重命名图层（popover 就地输入提交；走 commitPlan 可撤销）。 */
  function renameLevel(id: string, name: string) {
    const result = renamePlanLevel(planRef.current, id, name);
    if (!result.ok) {
      setEditMessage(result.issue.message);
      return;
    }
    commitPlan(result.value);
    setRenamingLevelId(null);
    setEditMessage('图层已重命名。');
  }

  /** 删除图层（两步确认后的执行体；连带删该层全部实体，走 commitPlan 可撤销）。 */
  function removeLevel(id: string) {
    const result = deletePlanLevel(planRef.current, id);
    if (!result.ok) {
      setEditMessage(result.issue.message);
      return;
    }
    const fallback = planLevels(result.value)[0]!.id;
    commitPlan(result.value);
    setDeleteArmLevelId(null);
    if (activeLevelIdRef.current === id) switchLevel(fallback);
    setEditMessage('图层连同其中的内容已删除；撤销可找回。');
  }

  /** 编辑提交：undo 栈推入旧快照（上限 UNDO_LIMIT），再同步 ref 与父级。 */
  function commitPlan(next: SitePlanData) {
    historyRef.current.push(planRef.current);
    if (historyRef.current.length > UNDO_LIMIT) historyRef.current.shift();
    setHistoryCount(historyRef.current.length);
    // 新编辑分叉历史：重做栈作废（与编辑器通例一致）。
    if (redoRef.current.length > 0) {
      redoRef.current = [];
      setRedoCount(0);
    }
    planRef.current = next;
    onPlanChange?.(next);
  }

  /** 撤销（Ctrl+Z / 面板按钮）：弹出栈顶恢复；选中实体可能随撤销消失，全清选中。 */
  function undoPlan() {
    const prev = historyRef.current.pop();
    if (!prev) return;
    redoRef.current.push(planRef.current);
    if (redoRef.current.length > UNDO_LIMIT) redoRef.current.shift();
    setRedoCount(redoRef.current.length);
    setHistoryCount(historyRef.current.length);
    selectFacility(null);
    selectRoute(null);
    selectNode(null);
    selectWorker(null);
    planRef.current = prev;
    onPlanChange?.(prev);
    setEditMessage('已撤销上一步。');
    draw();
  }

  /** P2-g 重做：把刚撤销的快照放回去（不新增历史项，避免与 undo 打乒乓）。 */
  function redoPlan() {
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current.push(planRef.current);
    if (historyRef.current.length > UNDO_LIMIT) historyRef.current.shift();
    setHistoryCount(historyRef.current.length);
    setRedoCount(redoRef.current.length);
    selectFacility(null);
    selectRoute(null);
    selectNode(null);
    selectWorker(null);
    planRef.current = next;
    onPlanChange?.(next);
    setEditMessage('已重做。');
    draw();
  }

  // P2-g：undo/redo 可用态上报（室内工具排撤销/重做钮的 disabled 与点击都走这里）。
  useEffect(() => {
  onHistoryChange?.({ canUndo: historyCount > 0, canRedo: redoCount > 0 });
}, [historyCount, redoCount, onHistoryChange]);

  // 右轨「测量 / 标注」圆钮的按下态同步（浮窗收进右轨后，开关/页签在这里上报）。
  useEffect(() => {
    onInspectorChange?.({ openTabs: inspectorPanels });
  }, [inspectorPanels, onInspectorChange]);

  useEffect(() => {
    planRef.current = plan;
    // 图层有效性兜底：撤销「新建图层」/「删除图层」后当前层可能已不存在，落回第一层。
    const levels = planLevels(plan);
    if (!levels.some(level => level.id === activeLevelIdRef.current)) {
      activeLevelIdRef.current = levels[0]!.id;
      setActiveLevelId(levels[0]!.id);
      onActiveLevelChange?.(levels[0]!.id);
    }
    // 问题清单按当前层视图现算（图层是独立设计：跨层重叠/碰撞不算问题）。
    const view = filterPlanByLevel(plan, activeLevelIdRef.current);
    issuesRef.current = planZoneIssues(view);
    setIssues(issuesRef.current);
    facilityIssuesRef.current = planFacilityIssues(view);
    setFacilityIssues(facilityIssuesRef.current);
    nodeIssuesRef.current = planNodeIssues(view);
    setNodeIssues(nodeIssuesRef.current);
    workerIssuesRef.current = planWorkerIssues(view);
    setWorkerIssues(workerIssuesRef.current);
    conflictIssuesRef.current = planConflictIssues(view);
    setConflictIssues(conflictIssuesRef.current);
    // 选中实体被外层删掉时静默取消选中，避免面板悬挂引用。
    if (selectedFacilityRef.current && !plan.facilities.some(f => f.id === selectedFacilityRef.current)) {
      selectedFacilityRef.current = null;
      setSelectedFacilityId(null);
    }
    if (selectedNodeRef.current && !plan.nodes.some(n => n.id === selectedNodeRef.current)) {
      selectedNodeRef.current = null;
      setSelectedNodeId(null);
    }
    if (selectedRouteRef.current && !plan.routes.some(r => r.id === selectedRouteRef.current)) {
      selectedRouteRef.current = null;
      setSelectedRouteId(null);
    }
    if (selectedWorkerRef.current && !plan.workers.some(w => w.id === selectedWorkerRef.current)) {
      selectedWorkerRef.current = null;
      setSelectedWorkerId(null);
    }
    draw();
  }, [plan]);
  // 挂载即上报初始活动层（3D 地面图层据此只镜像当前层）。
  useEffect(() => {
    onActiveLevelChange?.(activeLevelIdRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { sourceRef.current = source; draw(); }, [source]);
  useEffect(() => {
    if (visibility) {
      setLayerState(visibility);
      layerStateRef.current = visibility;
      draw();
    }
  }, [visibility]);
  useEffect(() => { layerStateRef.current = layerState; draw(); }, [layerState]);

  // H3-c 地图→清单同步聚焦：画布选中实体后（清单页签激活时）滚动到对应行并高亮。
  useEffect(() => {
    if (!infoOpen || infoTab !== 'inventory') return;
    const id = selectedFacilityId ?? selectedRouteId ?? selectedNodeId ?? selectedWorkerId;
    if (!id) return;
    const frame = requestAnimationFrame(() => {
      const row = infoPanelRef.current?.querySelector(`[data-inventory-id="${id}"]`);
      row?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedFacilityId, selectedRouteId, selectedNodeId, selectedWorkerId, infoTab, infoOpen]);

  // 底图「加载中」状态上报：只在跨态时 set 一次，避免每帧重渲染。
  const publishBasemapLoading = useCallback((loading: boolean) => {
    if (basemapLoadingRef.current === loading) return;
    basemapLoadingRef.current = loading;
    setBasemapLoading(loading);
  }, []);

  const draw = useCallback(() => {
    const stage = stageRef.current;
    const baseCanvas = baseCanvasRef.current;
    const planCanvas = planCanvasRef.current;
    if (!stage || !baseCanvas || !planCanvas) return;
    const baseCtx = baseCanvas.getContext('2d');
    const planCtx = planCanvas.getContext('2d');
    if (!baseCtx || !planCtx) return;

    const cssW = stage.clientWidth;
    const cssH = stage.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    for (const canvas of [baseCanvas, planCanvas]) {
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }
    }
    baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    baseCtx.clearRect(0, 0, cssW, cssH);
    planCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    planCtx.clearRect(0, 0, cssW, cssH);

    const v = viewRef.current;
    const activeSource = sourceRef.current;
    // 2026-11-11 图层：画布只画当前活动层的实体（边界/锚点跨层共享，过滤视图原样保留）。
    const current = viewPlan();
    const vis = layerStateRef.current;

    // 1) 底图（baseCanvas）：公开源单层 / 天地图双层，异步瓦片只画在底图 canvas 上，
    //    永不覆盖业务层。
    const viewport: PlanViewport = {
      lng: v.lng,
      lat: v.lat,
      zoom: v.zoom,
      canvasW: cssW,
      canvasH: cssH,
      // H3-c：传真实锚点，平移/定位时规划层随地图同步移动（不再是钉死的画布中心）。
      anchorLng: current.anchor?.lng ?? DEFAULT_ANCHOR_LNG,
      anchorLat: current.anchor?.lat ?? DEFAULT_ANCHOR_LAT,
    };
    const world = 2 ** v.zoom * TILE;
    // 2026-11-12 用户「放大倍数不够」：视图 zoom 可以超过图源瓦片级别，超过部分把上限级
    // 瓦片等比放大（overzoom）——再往里是模糊放大，但还能继续拉近看清手里的东西。
    const tileZoom = Math.min(Math.round(v.zoom), mapMaxZoomFor(activeSource));
    const overScale = 2 ** (v.zoom - tileZoom);
    // 2026-11-11 坐标系对齐：高德三档瓦片是 GCJ-02，与应用锚点同系直接用；
    // OSM/Carto/天地图是 WGS-84，取瓦片前把视点换算到 WGS-84 网格，
    // 否则整张底图相对场地边界偏几百米（杭州实测约 520 m）。
    const tileCenter = alignedTileCenter(v.lng, v.lat, activeSource);
    const centerPx = (tileCenter.lng + 180) / 360 * world;
    const latRad = tileCenter.lat * Math.PI / 180;
    const centerPy = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * world;
    if (baseModeRef.current === 'floor') {
      // P4-b：室内平面底——不请求任何瓦片，只铺纸面 + 米制网格。
      // 场地轮廓/分区/设施/动线由下面的业务层照常叠上来，所以室内外是同一套画布代码。
      paintFloorGrid(baseCtx, viewport, cssW, cssH);
      publishBasemapLoading(false);
    } else if (!basemapVisibleRef.current) {
      // 图层里关了底图：不再铺瓦片，业务层照常画。
      publishBasemapLoading(false);
    } else {
    const grid = visibleTileGrid(tileCenter.lng, tileCenter.lat, tileZoom, cssW / overScale, cssH / overScale);
    if (!basemapCacheRef.current) basemapCacheRef.current = new BasemapTileCache({ max: 1200 });
    const siteFocus = (() => {
      if (current.boundary.length >= 3) {
        let sx = 0;
        let sy = 0;
        for (const point of current.boundary) {
          const pix = planPointToPixel(point, viewport);
          sx += pix.x;
          sy += pix.y;
        }
        return { x: sx / current.boundary.length, y: sy / current.boundary.length };
      }
      return planPointToPixel({ x: 0, y: 0 }, viewport);
    })();
    paintBasemapTiles({
      ctx: baseCtx,
      cache: basemapCacheRef.current,
      zoom: v.zoom,
      tileZoom,
      centerPx,
      centerPy,
      cssW,
      cssH,
      tileSize: TILE,
      tiles: grid.tiles,
      focusX: siteFocus.x,
      focusY: siteFocus.y,
      urlsFor: (z, x, y) => {
        if (isTdt(activeSource)) {
          const pair = tdtProbeTileUrl(activeSource, z, x, y);
          return [pair.base, pair.annotation];
        }
        return [publicSourceTileUrl(activeSource, z, x, y)];
      },
      onDirty: () => {
        // 新瓦片到位：合并成一帧重绘，别一张图触发一次 draw。
        if (tileRedrawRafRef.current) return;
        tileRedrawRafRef.current = requestAnimationFrame(() => {
          tileRedrawRafRef.current = 0;
          drawRef.current();
        });
      },
    });
    // 「加载中」信号取限流器视角（在途+排队）：成败都会结算，归零可靠；
    // paint 结果里的 pending 含已失败格（网络断时永远 >0），不能拿来当转圈依据。
    publishBasemapLoading(basemapCacheRef.current.loadingCount > 0);
    }

    // 2) 业务图层（planCanvas，叠在底图之上）：按图层栈顺序叠加，
    //    底图瓦片异步返回时不会覆盖业务层。
    // 节点拖动预览：被拖节点与受影响路线端点随动预览（未 commit 前仅绘制）。
    const nodeDragPreview = nodeDragPreviewRef.current;
    const nodes = nodeDragPreview
      ? current.nodes.map(n => (n.id === nodeDragPreview.node.id ? nodeDragPreview.node : n))
      : current.nodes;
    const routes = nodeDragPreview
      ? current.routes.map(r => nodeDragPreview.routes.find(rr => rr.id === r.id) ?? r)
      : current.routes;
    const editingBoundary = modeRef.current === 'boundary-vertex';
    const boundary = previewRingRef.current ?? current.boundary;
    if (isLayerVisible(vis, 'boundary')) drawBoundaryLayer({ ctx: planCtx, viewport }, boundary, { vertexHandles: editingBoundary });

    // 分区警示：越界/重叠的分区画红虚线描边（数据本身不改动）。
    const warningZoneIds = new Set(
      issuesRef.current.filter(i => i.issue.code === 'out-of-boundary' || i.issue.code === 'zones-overlap').map(i => i.zoneId),
    );
    if (isLayerVisible(vis, 'zone')) {
      // P2-j：拖动分区顶点时用预览多边形替换原分区（松手才提交）。
      const zonePreview = zoneDragPreviewRef.current;
      const drawnZones = zonePreview
        ? current.zones.map(zone => (zone.id === zonePreview.zoneId ? { ...zone, polygon: zonePreview.polygon } : zone))
        : current.zones;
      drawZoneLayer(
        { ctx: planCtx, viewport },
        drawnZones.map(zone => ({ ...zone, warning: warningZoneIds.has(zone.id) })),
      );
      // P2-j：选中的分区画顶点手柄（与边界顶点同一套视觉/命中半径）。
      const selectedZone = selectedZoneRef.current
        ? drawnZones.find(zone => zone.id === selectedZoneRef.current) ?? null
        : null;
      if (selectedZone && selectedZone.polygon.length >= 3 && modeRef.current === 'view' && !layerLocked('zone')) {
        const px = selectedZone.polygon.map(pt => planPointToPixel(pt, viewport));
        planCtx.save();
        planCtx.strokeStyle = 'rgba(255,255,255,0.85)';
        planCtx.lineWidth = 1.5;
        planCtx.setLineDash([5, 4]);
        planCtx.beginPath();
        px.forEach((p, i) => (i === 0 ? planCtx.moveTo(p.x, p.y) : planCtx.lineTo(p.x, p.y)));
        planCtx.closePath();
        planCtx.stroke();
        planCtx.setLineDash([]);
        for (const p of px) {
          planCtx.fillStyle = 'rgba(18,20,26,0.9)';
          planCtx.strokeStyle = '#ffffff';
          planCtx.lineWidth = 2;
          planCtx.beginPath();
          planCtx.arc(p.x, p.y, 5, 0, Math.PI * 2);
          planCtx.fill();
          planCtx.stroke();
        }
        planCtx.restore();
      }
      // H4-b：分区语义贴纸（OnePlan 地图符号/面域底形）画在名称上方，不压名称文本；
      // 命中测试仍按多边形判定（drawZoneLayer 之外无改动）。
      for (const zone of current.zones) {
        if (zone.polygon.length < 2) continue;
        const sticker = zoneSticker(zone.semantic);
        if (!sticker) continue;
        const a = planPointToPixel(zone.polygon[0]!, viewport);
        const b = planPointToPixel(zone.polygon[1]!, viewport);
        drawOneplanSticker(planCtx, sticker, (a.x + b.x) / 2, (a.y + b.y) / 2 - 14, 16, { alpha: 0.95 });
      }
    }
    if (isLayerVisible(vis, 'facility')) {
      const warningFacilityIds = new Set(
        facilityIssuesRef.current.filter(i => i.issue.code === 'out-of-boundary').map(i => i.facilityId),
      );
      // P2-i：拖拽中的预览只替换原设施（其余设施/警示/选中态照旧）；松手才提交。
      // 2026-11-12 B2：组会话（整组移动/缩放）预览同机制合并进同一张替换表。
      const dragPreview = facilityDragRef.current?.preview ?? null;
      const groupPreview = groupDragRef.current?.preview ?? null;
      const previewMap = new Map<string, PlanFacility>();
      if (dragPreview) previewMap.set(dragPreview.id, dragPreview);
      if (groupPreview) for (const item of groupPreview) previewMap.set(item.id, item);
      const drawnFacilities = previewMap.size > 0
        ? current.facilities.map(f => previewMap.get(f.id) ?? f)
        : current.facilities;
      drawFacilityLayer(
        { ctx: planCtx, viewport },
        drawnFacilities.map(f => ({ ...f, warning: warningFacilityIds.has(f.id) })),
        {
          selectedId: selectedFacilityRef.current,
          // 2026-11-12 B3：组选件也画白圈（OnePlan 多选观感）；名称标签只留单选。
          selectedIds: multiSelectedFacilityIdsRef.current.length >= 2 ? multiSelectedFacilityIdsRef.current : null,
        },
      );
      // H4-b：设施贴纸。scale 类按米制占地矩形拉伸（真实尺度，底形 + 前景线稿，旋转矩阵同
      // drawFacilityLayer）；点位类（医疗/安保/垃圾）在占地中心画符号。不改变命中矩形与选中态
      // （白色选中外圈画在矩形外侧，贴纸不覆盖）。
      const metersPerPx = planMetersPerPixel(viewport);
      for (const facility of drawnFacilities) {
        // P2-h：物件库来的设施带 `oneplan:` 前缀，用库里的真贴纸；8 个内置模板仍走原映射。
        // 2026-11-12：`pack:` 活动包物件走包索引，芯片/底形用物件主题色（OnePlan 同款彩底）。
        const packEntry = isPackTemplateId(facility.templateId)
          ? packEntryIndexRef.current.get(facility.templateId)
          : undefined;
        const sticker = packEntry?.sticker
          ?? libraryStickerFor(facility.templateId)
          ?? facilitySticker(facility.templateId);
        if (!sticker) continue;
        // 2026-11-12 图标跟色：设施自带 color（Styling 色板/放置落色）优先；
        // 没有的老物件按模板 slug 走确定性调色板补色——地图上不再一片黑，也不动用户数据。
        const colorSlug = packEntry?.slug
          ?? (facility.templateId.startsWith('oneplan:') ? facility.templateId.split(':')[2] ?? '' : '');
        const itemColor = facility.color ?? (colorSlug ? libraryEntryColor({ slug: colorSlug }) : undefined);
        const pt = planPointToPixel(facility.position, viewport);
        const fw = Math.max(4, facility.size.width / metersPerPx);
        const fh = Math.max(4, facility.size.depth / metersPerPx);
        if (sticker.kind === 'scale') {
          // 最小 12px 保证贴纸可辨（与 drawFacilityLayer 的 4px 下限同思路，只为视觉兜底）。
          drawOneplanScaleSticker(
            planCtx, sticker.slug, pt.x, pt.y,
            Math.max(fw, 12), Math.max(fh, 12), facility.rotationDeg,
            { alpha: 0.9, ...(itemColor ? { color: itemColor } : {}) },
          );
        } else {
          const size = Math.max(16, Math.min(28, Math.min(fw, fh) * 0.9));
          drawOneplanSticker(planCtx, sticker, pt.x, pt.y, size, {
            alpha: 0.95,
            // 2026-11-12 用户指令「地图里面图标颜色没改」：设施芯片一律跟物件色
            // （Styling 色板改色即时生效；无主题色回落深色芯片）。
            ...(itemColor ? { color: itemColor } : {}),
          });
        }
      }
      // P2-i：选中设施的可直接拖拽手柄（四角改尺寸 + 顶部旋转）；锁定设施层或非浏览模式不画。
      // 2026-11-12 B2：选择（select）模式同样可用（OnePlan Selection tool 下也能旋转/改尺寸）。
      const selectedForHandles = selectedFacilityRef.current
        ? drawnFacilities.find(f => f.id === selectedFacilityRef.current) ?? null
        : null;
      if (
        selectedForHandles
        && !lockedLayersRef.current.facility
        && (modeRef.current === 'view' || modeRef.current === 'select')
        && onPlanChange
      ) {
        drawFacilityHandles(planCtx, viewport, selectedForHandles);
      }
      // 2026-11-12 B3：组选（≥2 件）共享包围盒——OnePlan 蓝细线 + 四角白柄；缩放会话高亮当前角。
      if (multiSelectedFacilityIdsRef.current.length >= 2 && !lockedLayersRef.current.facility && onPlanChange) {
        const groupItems = multiSelectedFacilityIdsRef.current
          .map(id => (previewMap.size > 0 ? previewMap.get(id) : undefined) ?? current.facilities.find(f => f.id === id))
          .filter((f): f is PlanFacility => Boolean(f));
        const bounds = facilityGroupBounds(groupItems);
        if (bounds) {
          drawGroupSelection(planCtx, viewport, bounds, groupDragRef.current?.kind === 'scale' ? groupDragRef.current.corner : null);
        }
      }
      // 2026-11-12 B2：框选拖拽矩形（最上层，盖住业务层）。
      if (marqueeRectRef.current) {
        drawMarqueeRect(planCtx, marqueeRectRef.current);
      }
    }
    // 2026-11-11 统一视图：室内 3D 场景的落位（物料 + 实景扫描）投影层——业务层画完后叠上去。
    // 只读展示，不参与命中测试/交互。
    drawSceneObjectsLayer({ ctx: planCtx, viewport }, sceneObjects ?? []);
    if (isLayerVisible(vis, 'route')) {
      drawRouteLayer(
        { ctx: planCtx, viewport },
        routes.map(r => ({ ...r, selected: r.id === selectedRouteRef.current })),
      );
      // H4-b：动线类型徽标（画在中点顶点下方；线型/箭头/选中白描边仍由 drawRouteLayer 负责）。
      for (const route of routes) {
        if (route.points.length < 2) continue;
        const sticker = routeSticker(route.kind);
        if (!sticker) continue;
        const mid = planPointToPixel(route.points[Math.floor(route.points.length / 2)]!, viewport);
        drawOneplanSticker(planCtx, sticker, mid.x, mid.y + 15, 13, { alpha: 0.95 });
      }
    }
    if (isLayerVisible(vis, 'worker')) {
      const warningWorkerIds = new Set(
        workerIssuesRef.current.filter(i => i.issue.code === 'out-of-boundary').map(i => i.workerId),
      );
      drawWorkerLayer(
        { ctx: planCtx, viewport },
        current.workers.map(w => ({
          ...w,
          selected: w.id === selectedWorkerRef.current,
          warning: warningWorkerIds.has(w.id),
        })),
      );
      // H4-b：人员岗位贴纸（画在圆点上方，避开圆点与「岗位 ×人数」文本）。
      for (const worker of current.workers) {
        const sticker = workerSticker(worker.role);
        if (!sticker) continue;
        const pt = planPointToPixel(worker.position, viewport);
        drawOneplanSticker(planCtx, sticker, pt.x, pt.y - 13, 14, { alpha: 0.95 });
      }
    }
    if (isLayerVisible(vis, 'access')) {
      const unconnectedIds = new Set(nodeIssuesRef.current.map(i => i.nodeId));
      drawAccessLayer(
        { ctx: planCtx, viewport },
        nodes.map(n => ({
          ...n,
          selected: n.id === selectedNodeRef.current,
          unconnected: unconnectedIds.has(n.id),
        })),
      );
      // H4-b：出入口贴纸居中替换菱形符号；未连接警示点在贴纸之后补画（视觉提示不被盖住），
      // 选中白圈半径 9.5 > 贴纸半宽 7，仍可见。
      for (const node of nodes) {
        const sticker = nodeSticker(node.kind);
        if (!sticker) continue;
        const pt = planPointToPixel(node.position, viewport);
        drawOneplanSticker(planCtx, sticker, pt.x, pt.y, 14, { alpha: 0.95 });
        if (unconnectedIds.has(node.id)) {
          planCtx.beginPath();
          planCtx.arc(pt.x + 6, pt.y - 6, 3, 0, Math.PI * 2);
          planCtx.fillStyle = '#c0392b';
          planCtx.fill();
        }
      }
    }
    // H3-a 固定测量标注（测量图层在最上层；隐藏测量层不影响数据与统计）。
    if (isLayerVisible(vis, 'measure')) {
      drawMeasureLayer({ ctx: planCtx, viewport }, current.measurements ?? []);
    }
    // 2026-11-11 用户指令：自由标注图层（文本/形状；随「标注」图层开关隐藏，不影响数据与统计）。
    if (isLayerVisible(vis, 'annotate')) {
      drawAnnotationLayer(
        { ctx: planCtx, viewport },
        (current.annotations ?? []).map(a => ({ ...a, selected: a.id === selectedAnnotationRef.current })),
      );
    }

    // H3-b 冲突/缺失可定位标记：规则检查输出，恒画在业务层之上（不随图层隐藏），
    // 点击命中判定由组件按同半径处理（定位到关联动线）。
    drawConflictMarkers({ ctx: planCtx, viewport }, conflictIssuesRef.current);

    // 3) 绘制草稿（画边界/画分区）：≥3 点后闭合预览；形状非法（自交）画红色。
    const activeMode = modeRef.current;
    if (activeMode === 'boundary' || activeMode === 'zone') {
      const draftPoints = draftRef.current;
      if (draftPoints.length > 0) {
        const draftColor = activeMode === 'zone'
          // 2026-11-12 活动包区预设：草稿直接用物件主题色。
          ? (zonePresetRef.current?.color ?? defaultZoneColor(zoneSemanticRef.current))
          : PLANNING_LAYER_COLORS.boundary;
        const draftInvalid = draftPoints.length >= 4 && planRingSelfIntersects(draftPoints);
        drawDraftLayer({ ctx: planCtx, viewport }, draftPoints, draftColor, { draftInvalid });
      }
    }

    // 4) H2-d 动线草稿与节点放置幽灵；H3-a 测量草稿（临时读数跟指针）。
    if (activeMode === 'route') {
      drawRouteDraft({ ctx: planCtx, viewport }, routeDraftRef.current, routeKindRef.current, routeCursorRef.current ?? undefined);
    }
    if (activeMode === 'measure') {
      drawMeasureDraft({ ctx: planCtx, viewport }, measureDraftRef.current, measureKindRef.current, measureCursorRef.current ?? undefined);
    }
    // 2026-11-11 用户指令：形状草稿（拖拽实时预览 / 三角形逐点橡皮筋）。
    if (activeMode === 'shape') {
      drawAnnotationDraft({ ctx: planCtx, viewport }, annotateDraftRef.current, annotateShapeRef.current, annotateCursorRef.current ?? undefined);
    }
    if (activeMode === 'node' && nodeGhostRef.current) {
      const names = { entry: '入口', exit: '出口', both: '出入口' } as const;
      drawNodeGhost({ ctx: planCtx, viewport }, nodeKindRef.current, names[nodeKindRef.current], nodeGhostRef.current);
    }

    // 5) 设施放置幽灵（H2-c）：跟随指针的占地预览，越界变红；叠加在所有图层之上。
    if (activeMode === 'facility' && ghostPointRef.current && facilityTemplateRef.current) {
      const pendingId = facilityTemplateRef.current;
      const override = facilityTemplateObjRef.current;
      const template = override && override.templateId === pendingId
        ? override
        : findFacilityTemplate(pendingId) ?? resolveFacilityTemplate(pendingId);
      if (template) {
        const footprint = facilityFootprintRing({
          position: ghostPointRef.current,
          rotationDeg: 0,
          size: { width: template.width, depth: template.depth },
        });
        const invalid = facilityPlacementIssues(footprint, current.boundary).length > 0;
        drawFacilityGhost({ ctx: planCtx, viewport }, template, ghostPointRef.current, { invalid });
      }
    }

    // 6) P2-i：常驻比例尺 + 指北针（画在最上层，任何底图/图层组合下都在同一位置）。
    drawScaleAndNorth(planCtx, viewport, cssW, cssH);
    // 图源署名：纸面模式无图源不画；瓦片源按许可要求常驻右下角（Google/OnePlan 同款范式）。
    if (baseModeRef.current !== 'floor') drawAttribution(planCtx, sourceRef.current, cssW, cssH);

    // 7) P2-k：搜地点落钉（纯视图辅助，不进 plan、不参与统计与冲突）。
    // 7a) 先画选区面（行政区边界），再画钉——钉压在上面不会被浅填充吞掉。
    const areaShape = searchAreaRef.current;
    if (areaShape && areaShape.polygon.length >= 3) {
      const points = areaShape.polygon.map(([lng, lat]) => lngLatToEnu(
        lng,
        lat,
        current.anchor?.lng ?? DEFAULT_ANCHOR_LNG,
        current.anchor?.lat ?? DEFAULT_ANCHOR_LAT,
      ));
      // 出框后中心挂着定位钉时，选区顶部标签让位给钉上胶囊（同一名称不画两枚）。
      drawSearchArea({ ctx: planCtx, viewport }, {
        points,
        label: areaShape.label,
        showLabel: !searchPinRef.current,
        ...(areaShape.kind ? { kind: areaShape.kind } : {}),
      });
    }
    const pin = searchPinRef.current;
    if (pin) {
      const pinPoint = lngLatToEnu(
        pin.lng,
        pin.lat,
        current.anchor?.lng ?? DEFAULT_ANCHOR_LNG,
        current.anchor?.lat ?? DEFAULT_ANCHOR_LAT,
      );
      drawSearchPin({ ctx: planCtx, viewport }, { point: pinPoint, label: pin.label });
    }

    // 7b) V-2d：流线提案预览（虚线 + 出入口圆点）——画在搜钉之上，应用前不进 plan。
    if (routeProposalRef.current) {
      drawRouteProposalLayer({ ctx: planCtx, viewport }, routeProposalRef.current);
    }
    // 7c) V-3c：区域提案预览（虚线分区 + 物料幽灵）——同上，应用前不进 plan。
    if (zoneProposalRef.current) {
      drawZoneProposalLayer({ ctx: planCtx, viewport }, zoneProposalRef.current);
    }
    // 7d) V-4b：流动模拟（行人点 + 密度着色）——纯视图动画，不写 plan。
    if (flowSimRef.current) {
      drawFlowSimulationLayer({ ctx: planCtx, viewport }, {
        routes: flowSimRef.current.routes,
        walkerPoints: walkerPoints(flowSimRef.current.walkers, flowSimRef.current.routes),
        density: routeDensity(flowSimRef.current.walkers, flowSimRef.current.routes),
      });
    }

    // 本机验收桥：把 viewport 与选中设施的手柄坐标暴露出来（只读，生产构建没有），
    // 这样 Playwright 脚本能精确点到手柄，而不用靠猜像素。
    if (process.env.NODE_ENV !== 'production') {
      const selectedNow = selectedFacilityRef.current
        ? current.facilities.find(f => f.id === selectedFacilityRef.current) ?? null
        : null;
      (window as unknown as { __scendancePlanDebug?: unknown }).__scendancePlanDebug = {
        viewport: { zoom: viewport.zoom, metersPerPixel: planMetersPerPixel(viewport) },
        mode: modeRef.current,
        canvas: { width: cssW, height: cssH },
        /** 当前吸附网格步长（米），验收脚本用它判断顶点是否真的落在网格上。 */
        gridStepM: planGridStepM(viewport),
        /** ENU 米 → 画布 CSS 像素（验收脚本用它把边界顶点/分区顶点换到鼠标坐标）。 */
        project: (pt: PlanPoint) => planPointToPixel(pt, viewport),
        selected: selectedNow
          ? {
              id: selectedNow.id,
              handles: facilityHandles(selectedNow, viewport, FACILITY_HANDLE_MIN_FOOTPRINT_PX),
            }
          : null,
      };
    }
  }, [sceneObjects, publishBasemapLoading]);

  // 瓦片加载完成后的异步重绘走 ref，避免 onDirty 依赖整份 draw 造成互相引用。
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  // 2026-11-11 统一视图：落位投影层变了（物料/实景扫描增删改）就重画一次。
  useEffect(() => {
    draw();
  }, [sceneObjects, draw]);

  // P2-k：搜地点落钉变化（含清空）立即重绘一次；不改 draw 依赖。
  useEffect(() => {
    searchPinRef.current = searchPin ?? null;
    drawRef.current();
  }, [searchPin]);
  // 选区：同一定位钉的同步路数（props → ref → 重绘）。
  useEffect(() => {
    searchAreaRef.current = searchArea ?? null;
    drawRef.current();
  }, [searchArea]);
  // V-2d：流线提案预览（props → ref → 重绘；应用走 handle.applyRoutes，预览本身不进 plan）。
  useEffect(() => {
    routeProposalRef.current = routeProposal ?? null;
    drawRef.current();
  }, [routeProposal]);
  // V-3c：区域提案预览（props → ref → 重绘；应用走 handle.applyZoneProposal）。
  useEffect(() => {
    zoneProposalRef.current = zoneProposal ?? null;
    drawRef.current();
  }, [zoneProposal]);
  // V-4b：流动模拟 ticker——流线集合变化（或停止）时重建 walkers；跑动期 66ms 步进重绘。
  useEffect(() => {
    if (!flowSimRoutes || flowSimRoutes.length === 0) {
      flowSimRef.current = null;
      drawRef.current();
      return undefined;
    }
    flowSimRef.current = { walkers: createFlowWalkers(flowSimRoutes), routes: flowSimRoutes };
    drawRef.current();
    const timer = window.setInterval(() => {
      const sim = flowSimRef.current;
      if (!sim) return;
      sim.walkers = stepFlowWalkers(sim.walkers, sim.routes, 0.066);
      drawRef.current();
    }, 66);
    return () => window.clearInterval(timer);
  }, [flowSimRoutes]);

  // P4-b：底图形态切换（纸面 ↔ 瓦片）立即重绘一次；不改 draw 依赖，免得重建回调。
  useEffect(() => {
    baseModeRef.current = base;
    drawRef.current();
  }, [base]);

  // H4-b：OnePlan 贴纸是异步图片——加载完成/失败后补一次重绘，避免首帧缺图标后不再补画。
  useEffect(() => subscribeOneplanStickerLoads(() => draw()), [draw]);

  // H4-b：规划变化时预取本屏用到的贴纸（失败静默，绘制时回落到既有 Lucide 图标）。
  useEffect(() => {
    const descriptors = planStickerDescriptors(plan);
    // P2-h：物件库放的设施带 `oneplan:` 前缀，映射表里没有，单独补它的贴纸。
    for (const facility of plan.facilities) {
      const sticker = libraryStickerFor(facility.templateId);
      if (sticker) descriptors.push(sticker);
    }
    preloadOneplanStickers(descriptors);
  }, [plan]);

  // P2-h 物件库清单：只在有库面板宿主时才拉（manifest 440 KB 不该拖慢其它用法）。
  // 2026-11-12 活动包 packs.json 一并拉取；它失败不拖垮基建类目（活动包段缺省）。
  useEffect(() => {
    if (!libraryPanelHostId) return undefined;
    let cancelled = false;
    setLibraryStatus('loading');
    const manifestPromise = fetch('/oneplan-icons/manifest.json')
      .then(response => (response.ok ? (response.json() as Promise<OneplanManifest>) : Promise.reject(new Error(String(response.status)))));
    const packsPromise = fetch('/oneplan-icons/packs.json')
      .then(response => (response.ok ? (response.json() as Promise<OneplanPacksFile>) : Promise.reject(new Error(String(response.status)))))
      .catch(() => null);
    Promise.all([manifestPromise, packsPromise])
      .then(([manifest, packsFile]) => {
        if (cancelled) return;
        setLibraryAll(libraryEntries(manifest.assets ?? []));
        setLibraryPacks(packsFile?.packs ?? []);
        setLibraryStatus('ready');
      })
      .catch(() => { if (!cancelled) setLibraryStatus('failed'); });
    return () => { cancelled = true; };
  }, [libraryPanelHostId]);

  // 2026-11-12 活动包：物件级条目（pack: 前缀模板）+ 按包分桶 + templateId 索引。
  const packEntries = useMemo(() => packsToEntries({ packs: libraryPacks }), [libraryPacks]);
  const packGroups = useMemo(() => packBuckets(libraryPacks, packEntries), [libraryPacks, packEntries]);
  const packEntryIndexRef = useRef<Map<string, LibraryEntry>>(new Map());
  useEffect(() => {
    const map = new Map<string, LibraryEntry>();
    for (const entry of packEntries) {
      if (!entry.packId || !entry.packItemId) continue;
      map.set(`pack:${entry.packId}:${entry.packItemId}`, entry);
    }
    packEntryIndexRef.current = map;
    // 3D 贴纸占位反查 `pack:` 模板用（模块级登记，随包清单刷新）。
    registerPackEntries(packEntries);
    // 包贴纸预取（icon 白字形 / scale 成对 / area 轮廓）；完成走订阅重绘。
    preloadOneplanStickers(packEntries.map(entry => entry.sticker));
  }, [packEntries]);

  // P2-k 目录：搜索结果按用户目录分组；三段各自的桶（只在有库面板时才算）。
  const librarySearchResults = useMemo(
    () => (libraryQuery.trim() ? groupCatalogResults(searchLibraryEntries([...libraryAll, ...packEntries], libraryQuery)) : []),
    [libraryAll, packEntries, libraryQuery],
  );
  const libraryInfra = useMemo(() => infraBuckets(libraryAll), [libraryAll]);
  const libraryEntranceIcons = useMemo(() => entranceIconItems(libraryAll), [libraryAll]);
  const libraryExtra = useMemo(() => extraBucket(libraryAll), [libraryAll]);
  const libraryTotal = libraryAll.length + packEntries.length;
  // 物件库模板 id → 模板对象（拖动进画布时 pickFacilityTemplate 只拿到 id，靠这张表还原尺寸）。
  // 2026-11-12：`pack:` 活动包模板同表收口（主题色随模板带进 buildFacility）。
  const libraryTemplatesRef = useRef<Map<string, PlanFacilityTemplate>>(new Map());
  useEffect(() => {
    const map = new Map<string, PlanFacilityTemplate>();
    for (const entry of libraryAll) {
      const template = libraryFacilityTemplate(entry);
      map.set(template.templateId, template);
    }
    for (const entry of packEntries) {
      if (entry.placeKind !== 'facility' || !entry.packId || !entry.packItemId) continue;
      const template = packFacilityTemplate(entry);
      map.set(template.templateId, template);
    }
    libraryTemplatesRef.current = map;
  }, [libraryAll, packEntries]);

  // zoneSemantic 同步给稳定 draw()：单独 ref，避免把语义塞进 draw 依赖。
  const zoneSemanticRef = useRef<PlanningZoneSemantic>(zoneSemantic);
  useEffect(() => { zoneSemanticRef.current = zoneSemantic; draw(); }, [zoneSemantic]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    draw();
    const observer = new ResizeObserver(() => draw());
    observer.observe(stage);
    return () => observer.disconnect();
  }, [draw]);

  // 2026-11-11 用户 m00249：从 3D 切回 2D（画布重挂载）时以**场地边界**为中心并按边界适配缩放，
  // 不要每次都落回 plan.anchor（预置锚点是西湖正中）zoom 16。只在首次挂载时做一次；
  // 调用方显式给了 zoom（如截图导出）才让位。
  const fitBoundaryDoneRef = useRef(false);
  useEffect(() => {
    if (fitBoundaryDoneRef.current) return;
    if (baseModeRef.current !== 'map' || initialView?.zoom !== undefined) {
      fitBoundaryDoneRef.current = true;
      return undefined;
    }
    const boundary = planRef.current.boundary;
    if (boundary.length < 3) return undefined;
    let raf = 0;
    let tries = 0;
    const fit = () => {
      const stage = stageRef.current;
      const width = stage?.clientWidth ?? 0;
      const height = stage?.clientHeight ?? 0;
      if (width < 40 || height < 40) {
        if (tries++ < 240) raf = window.requestAnimationFrame(fit);
        return;
      }
      fitBoundaryDoneRef.current = true;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      boundary.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
      if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;
      const anchor = planRef.current.anchor;
      const geo = enuToLngLat((minX + maxX) / 2, (minY + maxY) / 2, anchor?.lng ?? DEFAULT_ANCHOR_LNG, anchor?.lat ?? DEFAULT_ANCHOR_LAT);
      // 边界外留 35% 余量：矮墙/标签不至于贴边。
      const span = Math.max(8, maxX - minX, maxY - minY) * 1.35;
      const mPerPx = span / Math.max(80, Math.min(width, height));
      const zoom = Math.log2((40075016.686 * Math.cos(geo.lat * Math.PI / 180)) / (mPerPx * 256));
      commitView({
        lng: clamp(geo.lng, -180, 180),
        lat: clamp(geo.lat, -85, 85),
        // 瓦片按整数级别取图（paintBasemapTiles 直接把 zoom 拼进瓦片 URL），这里必须取整，
        // 否则会请求 19.509… 这类非整数级别瓦片，OSM 直接 CORS/404 失败。
        zoom: clamp(Math.round(zoom), MAP_MIN_ZOOM, MAP_MAX_ZOOM),
      });
    };
    raf = window.requestAnimationFrame(fit);
    return () => window.cancelAnimationFrame(raf);
    // plan.boundary.length：画布常常先挂载、草稿后才读到（plan 异步到）——
    // 首次挂载时边界还是空数组的话，等边界到位再来一次；成功适配一次后 ref 会兜住不再跳。
  }, [initialView, plan.boundary.length]);

  // Esc 取消：清草稿、退回浏览模式（评审稿「Esc 取消无历史项」口径）。
  // Ctrl+Z / Cmd+Z 撤销（H2-d）：焦点在输入控件内时不拦截；只读画布不响应。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const inField = tag === 'input' || tag === 'textarea' || tag === 'select';
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        if (inField || !onPlanChange) return;
        event.preventDefault();
        undoPlan();
        return;
      }
      // P2-g：Ctrl/Cmd+Shift+Z 重做（与工具排重做钮同源）。
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'z') {
        if (inField || !onPlanChange) return;
        event.preventDefault();
        redoPlan();
        return;
      }
      if (event.key !== 'Escape') return;
      if (modeRef.current === 'view') {
        // 2026-11-12 B2：浏览态 Esc = 取消组选（OnePlan 同语义；单选清空沿用既有行为不变）。
        clearMultiSelection();
        return;
      }
      setMode('view');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // P2-i 选中实体的键盘操作：Delete/Backspace 删除、Ctrl/Cmd+D 复制设施、方向键微调设施
  // （1 m，Shift=10 m）。输入框内不拦截；只读画布不响应。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!onPlanChange) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      // 2026-11-12 B1 OnePlan 同款工具快捷键：H=浏览（Hand）、S=选择（Selection）。带修饰键不拦（Ctrl+S 等）。
      if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key === 'h' || event.key === 'H' || event.key === 's' || event.key === 'S')) {
        const next: PlanningEditMode = event.key.toLowerCase() === 'h' ? 'view' : 'select';
        if (modeRef.current !== next) {
          event.preventDefault();
          setMode(next);
        }
        return;
      }
      // 2026-11-12 B2：组选（≥2 件）优先于单选——批量复制/删除/微调各一条 undo。
      const multiIds = multiSelectedFacilityIdsRef.current;
      if (multiIds.length >= 2) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
          event.preventDefault();
          duplicateFacilitiesMulti(multiIds);
          return;
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          deleteFacilitiesMulti(multiIds);
          return;
        }
        const step = event.shiftKey ? 10 : 1;
        const delta: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, step],
          ArrowDown: [0, -step],
        };
        const groupMove = delta[event.key];
        if (groupMove) {
          event.preventDefault();
          nudgeFacilitiesMulti(multiIds, groupMove[0], groupMove[1]);
        }
        return;
      }
      const facilityId = selectedFacilityRef.current;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        if (!facilityId) return;
        event.preventDefault();
        duplicateFacility(facilityId);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (facilityId) {
          event.preventDefault();
          deleteFacility(facilityId);
          return;
        }
        const routeId = selectedRouteRef.current;
        if (routeId) {
          event.preventDefault();
          deleteRoute(routeId);
          return;
        }
        const nodeId = selectedNodeRef.current;
        if (nodeId) {
          event.preventDefault();
          deleteNode(nodeId);
          return;
        }
        const workerId = selectedWorkerRef.current;
        if (workerId) {
          event.preventDefault();
          deleteWorker(workerId);
          return;
        }
        // 2026-11-11：分区选中（Placed Objects 树点行）也支持 Delete/Backspace 删除。
        const zoneId = selectedZoneRef.current;
        if (zoneId) {
          event.preventDefault();
          deleteZone(zoneId);
          return;
        }
        // 2026-11-11 用户指令：选中标注按 Delete/Backspace 删除（与其他实体选中互斥，兜底）。
        const annotationId = selectedAnnotationRef.current;
        if (annotationId) {
          event.preventDefault();
          deleteAnnotation(annotationId);
          return;
        }
        return;
      }
      if (!facilityId) return;
      const step = event.shiftKey ? 10 : 1;
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
      };
      const move = delta[event.key];
      if (!move) return;
      event.preventDefault();
      nudgeFacility(facilityId, move[0], move[1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const viewportOverrideRef = useRef<PlanViewport | null>(null);

  function currentViewport(): PlanViewport {
    if (viewportOverrideRef.current) return viewportOverrideRef.current;
    const stage = stageRef.current;
    const anchor = planRef.current.anchor;
    return {
      lng: viewRef.current.lng,
      lat: viewRef.current.lat,
      zoom: viewRef.current.zoom,
      canvasW: stage?.clientWidth ?? 0,
      canvasH: stage?.clientHeight ?? 0,
      anchorLng: anchor?.lng ?? DEFAULT_ANCHOR_LNG,
      anchorLat: anchor?.lat ?? DEFAULT_ANCHOR_LAT,
    };
  }

  const pointerOverrideRef = useRef<{ px: { x: number; y: number }; pt: PlanPoint } | null>(null);
  const pointerFrom3dRef = useRef(false);
  const pointerConsumedRef = useRef(false);

  function eventPlanPoint(event: { clientX: number; clientY: number }): { px: { x: number; y: number }; pt: PlanPoint } | null {
    if (pointerOverrideRef.current) return pointerOverrideRef.current;
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    const px = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return { px, pt: planPixelToPoint(px, currentViewport()) };
  }

  function commitView(next: View) {
    viewRef.current = next;
    setView({ ...next });
    onViewChange?.(next);
    draw();
  }

  function pan(dx: number, dy: number) {
    const v = viewRef.current;
    const w = 2 ** v.zoom * TILE;
    const dLng = -dx / w * 360;
    const latRad = v.lat * Math.PI / 180;
    // H3-c 修复：跟手平移——下拖（dy 正）相机北移，屏幕位移 = dLat·world·sec/360 = dy；
    // 旧版符号相反且少 2π 因子（下拖 40px 内容反而上移约 6px）。
    const dLat = dy / w * 360 * Math.cos(latRad);
    commitView({
      lng: clamp(v.lng + dLng, -180, 180),
      lat: clamp(v.lat + dLat, -85, 85),
      zoom: v.zoom,
    });
  }

  function zoomBy(dir: number) {
    const v = viewRef.current;
    // P4-b：室内平面底没有瓦片，zoom 只当米/像素标尺，区间比地图更贴近家具尺度。
    const floor = baseModeRef.current === 'floor';
    commitView({
      ...v,
      zoom: clamp(
        v.zoom + dir,
        floor ? FLOOR_MIN_ZOOM : MAP_MIN_ZOOM,
        floor ? FLOOR_MAX_ZOOM : MAP_MAX_ZOOM,
      ),
    });
  }

  // P2-g：对外命令句柄（室内工具排通用钮转发：撤销/重做/缩放/截图）。
  // 不写依赖数组：每次渲染重建，句柄永远拿到当帧的闭包（这些函数都读 ref，成本可忽略）。
  useImperativeHandle(ref, () => ({
    zoomBy: (direction: 1 | -1) => zoomBy(direction),
    captureImage: () => planCanvasRef.current?.toDataURL('image/png') ?? null,
    undo: () => undoPlan(),
    redo: () => redoPlan(),
    canUndo: () => historyRef.current.length > 0,
    canRedo: () => redoRef.current.length > 0,
    focusLngLat: (lng: number, lat: number, zoom?: number) => focusLngLat(lng, lat, zoom),
    focusBounds: (bounds: [number, number, number, number]) => focusBounds(bounds),
    /** V-2d：应用流线提案（合并进 plan，走 commitPlan 可撤销）；成功返回 true。 */
    applyRoutes: (routes: PlanRoute[], nodes: PlanNode[]) => {
      const current = planRef.current;
      if (routes.length === 0 && nodes.length === 0) return false;
      commitPlan({
        ...current,
        routes: [...current.routes, ...routes],
        nodes: [...current.nodes, ...nodes],
      });
      return true;
    },
    /** V-3c：应用区域提案（合并 zones/facilities 进 plan，commitPlan 可撤销）；空提案回 false。 */
    applyZoneProposal: (zones: PlanZone[], facilities: PlanFacility[]) => {
      const current = planRef.current;
      if (zones.length === 0 && facilities.length === 0) return false;
      commitPlan({
        ...current,
        zones: [...current.zones, ...zones],
        facilities: [...current.facilities, ...facilities],
      });
      return true;
    },
    getView: () => currentViewport(),
    getMode: () => modeRef.current,
    setMode: (next: string) => setMode(next as PlanningEditMode),
    setInspector: (open: boolean, tab?: 'measure' | 'annotate' | 'selection') => {
      // 2026-11-12 三张卡拆开：每张卡独立展开/收起，互不影响。
      if (!tab) {
        setInspectorPanels(open ? { measure: true, annotate: true, selection: true } : { measure: false, annotate: false, selection: false });
        return;
      }
      setInspectorPanel(tab, open);
      // 从右轨重新打开时顺手展开卡身，避免「点了按钮但看不到内容」。
      if (open) setInspectorCollapsed(current => (current[tab] ? { ...current, [tab]: false } : current));
    },
    getTileCache: () => {
      if (!basemapCacheRef.current) basemapCacheRef.current = new BasemapTileCache({ max: 1200 });
      return basemapCacheRef.current;
    },
    getBasemapVisible: () => basemapVisibleRef.current,
    pointerFromPlan: (kind, hit, flags) => {
      pointerOverrideRef.current = hit;
      pointerFrom3dRef.current = true;
      pointerConsumedRef.current = kind !== 'down';
      viewportOverrideRef.current = flags?.viewport ?? null;
      const ev = {
        button: flags?.button ?? 0,
        shiftKey: flags?.shiftKey ?? false,
        clientX: flags?.clientX ?? 0,
        clientY: flags?.clientY ?? 0,
        preventDefault() {},
        nativeEvent: { defaultPrevented: false },
      } as unknown as React.MouseEvent;
      try {
        if (kind === 'down') handleStageMouseDown(ev);
        else if (kind === 'move') handleStageMouseMove(ev);
        else if (kind === 'up') handleStageMouseUp(ev);
        else if (kind === 'leave') handleStageMouseLeave();
        else if (kind === 'dblclick') handleStageDoubleClick(ev);
      } finally {
        pointerOverrideRef.current = null;
        pointerFrom3dRef.current = false;
        viewportOverrideRef.current = null;
      }
      return pointerConsumedRef.current;
    },
    getEditVisuals: () => {
      let next = planRef.current;
      const zonePreview = zoneDragPreviewRef.current;
      if (zonePreview) {
        next = {
          ...next,
          zones: next.zones.map((zone) => (zone.id === zonePreview.zoneId ? { ...zone, polygon: zonePreview.polygon } : zone)),
        };
      }
      const facilityDrag = facilityDragRef.current;
      if (facilityDrag?.preview) {
        next = {
          ...next,
          facilities: next.facilities.map((facility) => (facility.id === facilityDrag.preview.id ? facilityDrag.preview : facility)),
        };
      }
      // 2026-11-12 B2 组会话预览：整组移动/缩放与单件拖拽同机制（3D 编辑态视觉同步）。
      const groupPreview = groupDragRef.current?.preview;
      if (groupPreview) {
        next = {
          ...next,
          facilities: next.facilities.map((facility) => groupPreview.find((p) => p.id === facility.id) ?? facility),
        };
      }
      const nodePreview = nodeDragPreviewRef.current;
      if (nodePreview) {
        next = {
          ...next,
          nodes: next.nodes.map((node) => (node.id === nodePreview.node.id ? nodePreview.node : node)),
          routes: next.routes.map((route) => nodePreview.routes.find((item) => item.id === route.id) ?? route),
        };
      }
      if (previewRingRef.current) {
        next = { ...next, boundary: previewRingRef.current };
      }
      const DRAFT_ID = "00000000-0000-4000-8000-000000000001";
      const mode = modeRef.current;
      if (mode === "facility" && ghostPointRef.current) {
        const template = facilityTemplateObjRef.current
          ?? (facilityTemplateRef.current
            ? libraryTemplatesRef.current.get(facilityTemplateRef.current) ?? resolveFacilityTemplate(facilityTemplateRef.current)
            : null);
        if (template) {
          next = {
            ...next,
            facilities: [
              ...next.facilities,
              {
                id: DRAFT_ID,
                templateId: template.templateId,
                name: template.name,
                position: { x: ghostPointRef.current.x, y: ghostPointRef.current.y },
                rotationDeg: 0,
                size: { width: template.width, depth: template.depth },
                notes: "",
              },
            ],
          };
        }
      }
      if (mode === "node" && nodeGhostRef.current) {
        const kind = nodeKindRef.current;
        next = {
          ...next,
          nodes: [
            ...next.nodes,
            { id: DRAFT_ID, kind, name: "待放", position: { x: nodeGhostRef.current.x, y: nodeGhostRef.current.y }, notes: "" },
          ],
        };
      }
      if (mode === "worker" && workerGhostRef.current) {
        next = {
          ...next,
          workers: [
            ...next.workers,
            {
              id: DRAFT_ID,
              role: workerRoleRef.current,
              count: 1,
              position: { x: workerGhostRef.current.x, y: workerGhostRef.current.y },
              notes: "",
            },
          ],
        };
      }
      const ring = (mode === "zone" || mode === "boundary") ? draftRef.current.slice() : [];
      const route = routeDraftRef.current.slice();
      if (routeCursorRef.current) route.push(routeCursorRef.current);
      const measure = measureDraftRef.current.slice();
      if (measureCursorRef.current) measure.push(measureCursorRef.current);
      const annotate = annotateDraftRef.current.slice();
      if (annotateCursorRef.current) annotate.push(annotateCursorRef.current);
      return {
        plan: next,
        selectedZoneId: selectedZoneRef.current,
        // 2026-11-12 3D 手柄：把选中设施与可编辑态透出，3D 侧只画柄不拷贝编辑逻辑。
        selectedFacilityId: selectedFacilityRef.current,
        facilityEditable: !!onPlanChange && !layerLocked('facility') && (modeRef.current === 'view' || modeRef.current === 'select'),
        draft: {
          ring,
          ringColor: mode === "zone"
            // 2026-11-12 活动包区预设：草稿直接用物件主题色。
            ? (zonePresetRef.current?.color ?? defaultZoneColor(zoneSemanticRef.current))
            : PLANNING_LAYER_COLORS.boundary,
          fill: mode === "zone" && ring.length >= 3,
          route: mode === "route" ? route : [],
          routeColor: routePresetRef.current?.color ?? PLANNING_ROUTE_KIND_COLORS[routeKindRef.current],
          measure: mode === "measure" ? measure : [],
          measureColor: PLANNING_LAYER_COLORS.measure,
          annotate: (mode === "shape" || mode === "note") ? annotate : [],
          annotateColor: PLANNING_LAYER_COLORS.annotate,
          ghostMarker: null,
        },
      };
    },
    getSelectedIds: () => {
      const picked = [selectedZoneRef.current, selectedFacilityRef.current, selectedRouteRef.current, selectedNodeRef.current, selectedWorkerRef.current, selectedAnnotationRef.current, ...multiSelectedFacilityIdsRef.current];
      return [...new Set(picked.filter((id): id is string => !!id))];
    },
  }));

  /** 图层栈开关：切换某层可见并回传（受控/非受控均生效）。 */
  function setLayerVisible(kind: PlanningLayerKind, visible: boolean) {
    const next = { ...layerState, [kind]: visible };
    setLayerState(next);
    layerStateRef.current = next;
    onVisibilityChange?.(next);
    draw();
  }

  /** P2-i 图层锁定：锁定层不参与命中/编辑（显示与统计口径不变）；锁设施层时顺手清选中。 */
  function setLayerLocked(kind: PlanningLayerKind, locked: boolean) {
    const next: LockedLayerMap = { ...lockedLayersRef.current, [kind]: locked };
    lockedLayersRef.current = next;
    setLockedLayers(next);
    if (locked && kind === 'facility') selectFacility(null);
    draw();
  }

  /** P2-i：设施能否在画布上直接操作——浏览模式 + 设施层未锁定。 */
  function facilityDirectEditable(): boolean {
    return modeRef.current === 'view' && !layerLocked('facility');
  }

  /** P2-i：某图层是否锁定（缺省 false；锁定层不参与点选/拖动，显示与统计照旧）。 */
  function layerLocked(kind: PlanningLayerKind): boolean {
    return lockedLayersRef.current[kind] === true;
  }

  /* ---------------- H2-b 编辑交互 ---------------- */

  function nearestBoundaryVertexIndex(px: { x: number; y: number }): number | null {
    const boundary = previewRingRef.current ?? planRef.current.boundary;
    let best: { index: number; dist: number } | null = null;
    boundary.forEach((p, index) => {
      const vp = planPointToPixel(p, currentViewport());
      const dist = Math.hypot(vp.x - px.x, vp.y - px.y);
      if (dist <= VERTEX_HANDLE_HIT_PX && (best === null || dist < best.dist)) best = { index, dist };
    });
    return best === null ? null : (best as { index: number }).index;
  }

  /** P2-j：双击边界 → 在最近那条边上插一个顶点（投影点吸网格），面积不足/自交则拒绝。 */
  function insertBoundaryVertexAt(px: { x: number; y: number }) {
    const current = planRef.current;
    const viewport = currentViewport();
    const edge = nearestRingEdge(current.boundary, px, viewport);
    if (!edge || edge.distPx > VERTEX_EDGE_HIT_PX) {
      setEditMessage('双击边界线上才能加点（离边太远）。');
      return;
    }
    const snapped = snapPointToGrid(edge.point, viewport);
    const result = insertRingVertex(current.boundary, edge.index, snapped);
    if (!result.ok) {
      setEditMessage(result.issue.message);
      return;
    }
    const check = checkBoundaryRing(result.value);
    if (!check.ok) {
      setEditMessage(check.issue.message);
      return;
    }
    commitPlan({ ...current, boundary: result.value });
    setEditMessage(`边界已插入顶点（约 ${Math.round(check.areaM2)} m²）。`);
  }

  /** P2-j：双击边界顶点 → 删掉它（最少 3 点、面积下限由 checkBoundaryRing 把关）。 */
  function removeBoundaryVertexAt(index: number) {
    const current = planRef.current;
    const result = removeRingVertex(current.boundary, index);
    if (!result.ok) {
      setEditMessage(result.issue.message);
      return;
    }
    const check = checkBoundaryRing(result.value);
    if (!check.ok) {
      setEditMessage(check.issue.message);
      return;
    }
    commitPlan({ ...current, boundary: result.value });
    setEditMessage(`边界已删除顶点（约 ${Math.round(check.areaM2)} m²）。`);
  }

  function handleDrawClick(px: { x: number; y: number }, pt: PlanPoint) {
    // H2-c：放设施模式单击提交（可连续放置）。
    if (modeRef.current === 'facility') {
      placeFacilityAt(pt);
      return;
    }
    // H2-d：画动线加点 / 放节点 / 布人员（均连续放置或收集）。
    if (modeRef.current === 'route') {
      addRoutePoint(pt);
      return;
    }
    if (modeRef.current === 'node') {
      placeNodeAt(pt);
      return;
    }
    if (modeRef.current === 'worker') {
      placeWorkerAt(pt);
      return;
    }
    // H3-a：测量收点（距离第 2 点自动提交；面积近首点闭合）。
    if (modeRef.current === 'measure') {
      addMeasurePoint(px, pt);
      return;
    }
    // 2026-11-11 用户指令：文本标注点一下放置就地输入框（Enter 提交 / Esc 取消）。
    // 已有输入框未提交时点新位置：旧框有内容先提交，再把输入框挪到新点（不打断连续标注）。
    if (modeRef.current === 'note') {
      const prev = noteInputRef.current;
      if (prev && prev.value.trim().length > 0) {
        commitAnnotation({ kind: 'note', points: [{ x: prev.pt.x, y: prev.pt.y }], text: prev.value.trim() });
      }
      updateNoteInput({ pt: { x: pt.x, y: pt.y }, value: '' });
      return;
    }
    // 2026-11-11 用户指令：形状单击收点（rect/circle/line 两点、triangle 三点自动提交）。
    if (modeRef.current === 'shape') {
      addShapePoint(pt);
      return;
    }
    const draftPoints = draftRef.current;
    // 近首点 → 尝试闭合提交。
    if (draftPoints.length >= 3) {
      const firstPx = planPointToPixel(draftPoints[0]!, currentViewport());
      if (Math.hypot(firstPx.x - px.x, firstPx.y - px.y) <= DRAFT_CLOSE_HIT_PX) {
        closeDraft();
        return;
      }
    }
    if (draftPoints.length >= PLAN_RING_MAX_VERTICES) {
      setEditMessage(`顶点已达上限 ${PLAN_RING_MAX_VERTICES} 个，先闭合或按 Esc 取消。`);
      return;
    }
    for (const existing of draftPoints) {
      if (planPointDistanceM(existing, pt) < PLAN_MIN_VERTEX_GAP_M) {
        setEditMessage('离已有的点太近（<0.5 m），当作重复点击忽略。');
        return;
      }
    }
    setDraft([...draftPoints, { x: pt.x, y: pt.y }]);
    setEditMessage(null);
  }

  function closeDraft() {
    const draftPoints = draftRef.current;
    const current = planRef.current;
    if (modeRef.current === 'boundary') {
      const check = checkBoundaryRing(draftPoints);
      if (!check.ok) {
        setEditMessage(check.issue.message);
        return;
      }
      commitPlan({ ...current, boundary: draftPoints.map(p => ({ x: p.x, y: p.y })) });
      setMode('view');
      setEditMessage(`边界已更新（约 ${Math.round(check.areaM2)} m²）。`);
      return;
    }
    if (modeRef.current === 'zone') {
      const semantic = zoneSemanticRef.current;
      const view = viewPlan();
      // 2026-11-12 活动包预设：分区名/主题色随包物件（OnePlan 区预设同语义）。
      const zonePreset = zonePresetRef.current;
      const name = zonePreset?.name ?? `${planZoneSemanticLabels[semantic]} ${view.zones.length + 1}`;
      const result = buildZone({ semantic, name, polygon: draftPoints }, current.boundary, view.zones);
      if (!result.ok) {
        setEditMessage(result.issue.message);
        return;
      }
      commitPlan({
        ...current,
        zones: [...current.zones, {
          ...result.value,
          ...(zonePreset?.color ? { color: zonePreset.color } : {}),
          ...activeLevelStamp(),
        }],
      });
      setMode('view');
      const hint = result.issues && result.issues.length > 0 ? `，注意：${result.issues.map(i => i.message).join('；')}` : '';
      setEditMessage(`分区「${name}」已添加${hint}`);
    }
  }

  function updateZone(id: string, patch: Partial<Pick<PlanZone, 'name' | 'color' | 'opacity'>>) {
    const current = planRef.current;
    commitPlan({ ...current, zones: current.zones.map(zone => (zone.id === id ? { ...zone, ...patch } : zone)) });
  }

  /* ---------------- H2-c 设施放置与选中 ---------------- */

  function selectFacility(id: string | null) {
    selectedFacilityRef.current = id;
    setSelectedFacilityId(id);
    if (id) selectZone(null);
    draw();
  }

  /* ---------------- P2-l 设施层级（右键菜单）---------------- */

  /**
   * 用户 m05344：物件放在场地之后可以右键「上移一层 / 置于顶层 / 下移一层 / 置于底层」。
   * 层级就存在 `plan.facilities` 数组顺序里（契约是 strictObject，不能加 zIndex 字段）：
   * 数组越靠后画得越上，所以重排数组即可，草稿/导出/3D 都自动跟着变。
   */
  function reorderFacility(id: string, action: 'up' | 'top' | 'down' | 'bottom') {
    const current = planRef.current;
    const index = current.facilities.findIndex(item => item.id === id);
    if (index < 0) return;
    const next = [...current.facilities];
    const [moved] = next.splice(index, 1);
    if (action === 'top') next.push(moved);
    else if (action === 'bottom') next.unshift(moved);
    else {
      const target = action === 'up' ? Math.min(next.length, index + 1) : Math.max(0, index - 1);
      next.splice(target, 0, moved);
    }
    if (next.every((item, i) => item.id === current.facilities[i]?.id)) {
      setFacilityMenu(null);
      return;
    }
    commitPlan({ ...current, facilities: next });
    const label = action === 'up' ? '上移一层' : action === 'top' ? '置于顶层' : action === 'down' ? '下移一层' : '置于底层';
    const at = next.findIndex(item => item.id === id) + 1;
    setEditMessage(`「${moved.name}」${label}（第 ${at} / ${next.length} 层）。`);
    setSelectedFacilityId(id);
    selectedFacilityRef.current = id;
    setFacilityMenu(null);
    draw();
  }

  /* ---------------- P2-j 分区选中与顶点改形 ---------------- */

  function selectZone(id: string | null) {
    selectedZoneRef.current = id;
    setSelectedZoneId(id);
    if (id) {
      selectedFacilityRef.current = null;
      setSelectedFacilityId(null);
    }
    draw();
  }

  /** 分区顶点手柄：选中的分区在屏幕上画小方块，命中半径与边界顶点一致。 */
  function nearestZoneVertexIndex(zone: PlanZone, px: { x: number; y: number }): number | null {
    const viewport = currentViewport();
    let hitIndex: number | null = null;
    let hitDist = VERTEX_HANDLE_HIT_PX;
    for (let index = 0; index < zone.polygon.length; index += 1) {
      const p = planPointToPixel(zone.polygon[index]!, viewport);
      const distPx = Math.hypot(px.x - p.x, px.y - p.y);
      if (distPx <= hitDist) {
        hitIndex = index;
        hitDist = distPx;
      }
    }
    return hitIndex;
  }

  /** 分区多边形改完要守住三条：形状合法、仍在场地边界内、不与别的分区重叠。 */
  function zonePolygonIssue(zone: PlanZone, polygon: PlanPoint[], current: SitePlanData): PlanEditIssue | null {
    const ring = checkPlanRing(polygon, PLAN_MIN_ZONE_AREA_M2, `分区「${zone.name}」`);
    if (!ring.ok) return ring.issue;
    const outside = zoneOutsideBoundaryIssue(polygon, current.boundary);
    if (outside) return outside;
    for (const other of current.zones) {
      if (other.id === zone.id) continue;
      if (planZonesOverlap(polygon, other.polygon)) {
        return { code: 'zones-overlap', message: `会和「${other.name}」重叠，换个位置。` } as PlanEditIssue;
      }
    }
    return null;
  }

  /** 在面板点选模板（也可直接拖拽到画布）：记录待放模板，幽灵随鼠标。 */
  function pickFacilityTemplate(templateId: string) {
    facilityTemplateRef.current = templateId;
    const builtin = findFacilityTemplate(templateId);
    // P2-h：`oneplan:` 模板不在内置目录里，从物件库映射表取（拖动/键盘选择也走这里）。
    // 2026-11-11 目录合并：物件库没加载完（或来源是历史 `oneplan:` id）时，用统一目录兜底，
    // 保证清单/图例/3D 与放置用的是同一份名字与尺寸。
    facilityTemplateObjRef.current = builtin && builtin.templateId === templateId
      ? builtin
      : libraryTemplatesRef.current.get(templateId) ?? resolveFacilityTemplate(templateId);
    setFacilityTemplateId(templateId);
    setEditMessage(null);
    draw();
  }

  /**
   * P2-h：物件库里点选一件物件。库条目的 templateId 形如 `oneplan:icon:tent`，
   * 不在 8 个内置模板里，所以把「模板对象」本身记下来，放置与幽灵预览都读它。
   */
  function pickLibraryEntry(entry: LibraryEntry) {
    const template = libraryFacilityTemplate(entry);
    // 顺序要紧：setMode 会清空待放模板（切模式即重置草稿），所以先切模式再落模板。
    setMode('facility');
    facilityTemplateRef.current = template.templateId;
    facilityTemplateObjRef.current = template;
    setFacilityTemplateId(template.templateId);
    setEditMessage(`已选「${entry.nameZh}」（${template.width}×${template.depth} m），在地图上单击放置；Esc 结束。`);
    draw();
  }

  /**
   * 2026-11-12 活动包物件点选：按 placeKind 分派——
   * facility 走 `pack:` 模板放置（主题色随模板落 facility.color）；
   * route / area 是画线/画区预设（动线色与分区色用物件主题色，OnePlan 赛道包同语义）；
   * worker（纯色圆点位）走布人员，点位色用物件主题色。
   */
  function pickPackEntry(entry: LibraryEntry) {
    if (entry.placeKind === 'route') {
      setMode('route');
      routePresetRef.current = {
        kind: entry.slug === 'route-dash' ? 'service' : 'pedestrian',
        ...(entry.color ? { color: entry.color } : {}),
        name: entry.nameZh,
      };
      setEditMessage(`画「${entry.nameZh}」：单击加路径点，双击完成（主题色动线）；Esc 结束。`);
      draw();
      return;
    }
    if (entry.placeKind === 'area') {
      zonePresetRef.current = { ...(entry.color ? { color: entry.color } : {}), name: entry.nameZh };
      setZoneSemantic('reserved');
      setMode('zone');
      setEditMessage(`画「${entry.nameZh}」：单击加顶点，双击或靠近首点闭合（主题色区域）；Esc 结束。`);
      draw();
      return;
    }
    if (entry.placeKind === 'worker') {
      workerPresetColorRef.current = entry.color ?? null;
      startLaborRole(entry.nameZh);
      return;
    }
    const template = packFacilityTemplate(entry);
    setMode('facility');
    facilityTemplateRef.current = template.templateId;
    facilityTemplateObjRef.current = template;
    setFacilityTemplateId(template.templateId);
    setEditMessage(`已选「${entry.nameZh}」（${template.width}×${template.depth} m），在地图上单击放置；Esc 结束。`);
    draw();
  }

  /**
   * P2-k 第一段工具：区域（圈分区）/ 入口和通道图标（上面列出图标，点了按设施放）/
   * 路线（画动线）。都是已有编辑模式的入口，这里只是把按钮接到 setMode。
   */
  function startAreaTool(tool: 'boundary' | 'zone' | 'node' | 'route') {
    if (!onPlanChange) return;
    selectFacility(null);
    setSelectedZoneId(null);
    setMode(tool);
    if (tool === 'boundary') {
      // 2026-11-11：边界重画入口回归（OnePlan 化时曾随顶部工具条丢失）——画完闭合即替换起步矩形。
      setEditMessage('重画场地边界：沿场地单击加顶点，双击或点回起点闭合替换旧边界；Esc 取消。');
    } else if (tool === 'zone') {
      setEditMessage('画区域：在场地内单击加顶点，双击或靠近首点闭合；Esc 结束。');
    } else if (tool === 'node') {
      setEditMessage('放入口/出口：单击地图落一个节点，可连续放；Esc 结束。');
    } else {
      setEditMessage('画路线：单击加路径点，双击完成；Esc 结束。');
    }
  }

  /** P2-k 第三段：劳动力按钮 → 直接进「布人员」模式，岗位名就是按钮名。 */
  function startLaborRole(role: string) {
    if (!onPlanChange) return;
    workerRoleRef.current = role;
    setWorkerRole(role);
    setMode('worker');
    setEditMessage(`布「${role}」：单击地图落一个点位，可连续放；Esc 结束。`);
  }

  /**
   * 2026-11-11 物件库 OnePlan 镜像：全宽行（图标 chip + 名称），两级树里所有条目共用。
   * chip 用真实贴纸图（icon 类深底白字形 / scale、area 浅底线稿），语义分区与动线类型用色块。
   */
  function renderOneplanItemRow(input: {
    key: string;
    testId: string;
    label: string;
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    trailing?: React.ReactNode | undefined;
    title?: string;
    draggable?: boolean;
    onDragStart?: ((event: React.DragEvent<HTMLButtonElement>) => void) | undefined;
    /** 2026-11-11 用户指令：右键删除已放置物件。 */
    onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  }) {
    return (
      <button
        key={input.key}
        type="button"
        data-testid={input.testId}
        aria-pressed={input.active}
        title={input.title}
        onClick={input.onClick}
        draggable={input.draggable}
        onDragStart={input.onDragStart}
        onContextMenu={input.onContextMenu}
        style={{
          all: 'unset',
          cursor: 'pointer',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '5px 6px',
          paddingLeft: 30,
          borderRadius: PLANNING_RADIUS.sm,
          border: `1px solid ${input.active ? PLANNING_SURFACE.selectedBorder : 'transparent'}`,
          background: input.active ? PLANNING_SURFACE.selectedBg : 'transparent',
          color: PLANNING_SURFACE.panelText,
          fontSize: PLANNING_TYPOGRAPHY.row,
        }}
      >
        {input.icon}
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{input.label}</span>
        {input.trailing}
      </button>
    );
  }

  /** OnePlan 镜像：一级组头（chevron + 组图标 + 名称 + 计数）。多段可同时展开（用户 m00575）。 */
  function renderOneplanGroupHeader(input: {
    id: 'areas' | 'infra' | 'labor' | 'extra';
    label: string;
    count: number;
    icon: PlanningIconName;
  }) {
    const open = openLibrarySections.includes(input.id);
    const Icon = planningIcon(input.icon);
    return (
      <button
        type="button"
        data-testid={`catalog-section-${input.id}`}
        aria-expanded={open}
        onClick={() => setOpenLibrarySections(prev => (prev.includes(input.id) ? prev.filter(id => id !== input.id) : [...prev, input.id]))}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          gap: 8,
          padding: '7px 2px',
          color: PLANNING_SURFACE.panelText,
          fontSize: 13,
          fontWeight: 600,
          borderTop: `1px solid ${PLANNING_SURFACE.panelBorder}`,
        }}
      >
        <span aria-hidden style={{ fontSize: 10, width: 10 }}>{open ? '▾' : '▸'}</span>
        <Icon size={14} aria-hidden color={PLANNING_SURFACE.panelText} />
        <span style={{ flex: 1 }}>{input.label}</span>
        <span style={{ opacity: 0.65, fontWeight: 400, fontSize: 11 }}>{input.count}</span>
      </button>
    );
  }

  /** OnePlan 镜像：二级子组头（区域 / 入口和通道图标 / 路线 / 17 个基建类目 / 图元）。多子组可同时展开（用户 m00575）。 */
  function renderOneplanSubgroupHeader(input: { sectionId: string; key: string; label: string; count: number; icon?: PlanningIconName }) {
    const openKey = `${input.sectionId}:${input.key}`;
    const open = openLibrarySubgroups.includes(openKey);
    const Icon = input.icon ? planningIcon(input.icon) : null;
    return (
      <button
        type="button"
        data-testid={`catalog-subgroup-${input.key}`}
        aria-expanded={open}
        onClick={() => setOpenLibrarySubgroups(prev => (prev.includes(openKey) ? prev.filter(k => k !== openKey) : [...prev, openKey]))}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          gap: 8,
          padding: '6px 2px',
          paddingLeft: 18,
          color: PLANNING_SURFACE.panelText,
          fontSize: PLANNING_TYPOGRAPHY.row,
          fontWeight: 600,
        }}
      >
        <span aria-hidden style={{ fontSize: 10, width: 10 }}>{open ? '▾' : '▸'}</span>
        {Icon && <Icon size={13} aria-hidden color={PLANNING_SURFACE.panelText} />}
        <span style={{ flex: 1 }}>{input.label}</span>
        <span style={{ opacity: 0.65, fontWeight: 400, fontSize: 11 }}>{input.count}</span>
      </button>
    );
  }

  /**
   * 2026-11-12 活动包物件 chip：主题色圆片/方块 + 字形图（icon 白字形、scale 深线稿、
   * area 黑轮廓、route 线型字形）；generic 纯色圆点位没有字形，就是一颗彩点。
   */
  function packChipNode(entry: LibraryEntry, size = 22, key?: string) {
    return (
      <span
        key={key}
        aria-hidden
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          flex: '0 0 auto',
          borderRadius: entry.kind === 'icon' ? 999 : 6,
          background: entry.color ?? '#23252c',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.28)',
        }}
      >
        {entry.placeKind !== 'worker' && (
          <img
            src={oneplanStickerSrc(entry.sticker)}
            alt=""
            width={size - 8}
            height={size - 8}
            loading="lazy"
            style={{ display: 'block' }}
          />
        )}
      </span>
    );
  }

  /** 包物件的放置入口/拖拽/title（树段、包浏览、搜索三处共用）。 */
  function renderPackItemRows(items: readonly LibraryEntry[]) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map(entry => {
          if (!entry.packId || !entry.packItemId) return null;
          const templateId = `pack:${entry.packId}:${entry.packItemId}`;
          const isFacility = entry.placeKind === 'facility';
          const placeLabel = entry.placeKind === 'route'
            ? '动线'
            : entry.placeKind === 'area'
              ? '区域'
              : entry.placeKind === 'worker'
                ? '点位'
                : null;
          return renderOneplanItemRow({
            key: templateId,
            testId: `pack-item-${entry.packId}-${entry.packItemId}`,
            label: entry.nameZh,
            active: isFacility && facilityTemplateId === templateId,
            onClick: () => pickPackEntry(entry),
            title: placeLabel
              ? `${entry.nameZh}：点击进入画${placeLabel === '点位' ? '人员点位' : placeLabel}（主题色已带）`
              : `${entry.nameZh} / ${entry.nameEn}（默认 ${entry.width}×${entry.depth} m）`,
            draggable: isFacility,
            onDragStart: isFacility
              ? (event: React.DragEvent<HTMLButtonElement>) => {
                // 与内置模板同一条拖放通道：画布 onDrop 读 text/plain 后落模板（含主题色）。
                event.dataTransfer.setData('text/plain', templateId);
                event.dataTransfer.effectAllowed = 'copy';
              }
              : undefined,
            icon: packChipNode(entry),
            trailing: placeLabel
              ? <span aria-hidden style={{ fontSize: 10, opacity: 0.6, flex: '0 0 auto' }}>{placeLabel}</span>
              : undefined,
          });
        })}
      </div>
    );
  }

  /**
   * OnePlan marketplace 包行镜像：2×2 预览 chip（前 3 件 + 「+N」）+ 包名 + 件数。
   * tree 变体点击展开包内物件；market 变体（底部「物件库」浏览）点击进入包详情。
   */
  function renderOneplanPackRow(input: { pack: PackBucket; open: boolean; onToggle: () => void; variant?: 'tree' | 'market' }) {
    const { pack, open, onToggle } = input;
    const market = input.variant === 'market';
    const hiddenCount = pack.items.length - pack.previews.length;
    return (
      <button
        type="button"
        data-testid={`catalog-pack-${pack.id}`}
        aria-expanded={open}
        onClick={onToggle}
        style={{
          all: 'unset',
          cursor: 'pointer',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: market ? '7px 6px' : '5px 4px',
          paddingLeft: market ? 6 : 18,
          borderRadius: PLANNING_RADIUS.sm,
          border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
          background: PLANNING_SURFACE.fieldBg,
          color: PLANNING_SURFACE.panelText,
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 22px)',
            gridTemplateRows: 'repeat(2, 22px)',
            placeItems: 'center',
            gap: 3,
            padding: 3,
            borderRadius: 6,
            border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
            flex: '0 0 auto',
          }}
        >
          {pack.previews.map(preview => packChipNode(preview, 22, preview.id))}
          {hiddenCount > 0 && <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.75 }}>+{hiddenCount}</span>}
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
          <span style={{ fontSize: PLANNING_TYPOGRAPHY.row, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
            {pack.nameZh}
          </span>
          <span style={{ fontSize: PLANNING_TYPOGRAPHY.hint, opacity: 0.65 }}>
            {pack.items.length} 件物件
          </span>
        </span>
        <span aria-hidden style={{ fontSize: 10, width: 10, flex: '0 0 auto' }}>{open ? '▾' : '▸'}</span>
      </button>
    );
  }

  /** OnePlan 镜像：贴纸条目行（搜索、入口图标、基建类目、图元四处共用）。 */
  function renderOneplanStickerRows(items: readonly LibraryEntry[]) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map(entry => {
          // 2026-11-12 搜索结果里的活动包物件：彩色 chip + pickPackEntry 语义分派。
          if (entry.packId) {
            const packTemplateIdStr = entry.packItemId ? `pack:${entry.packId}:${entry.packItemId}` : '';
            return renderOneplanItemRow({
              key: entry.id,
              testId: `pack-item-${entry.packId}-${entry.packItemId}`,
              label: entry.nameZh,
              active: entry.placeKind === 'facility' && facilityTemplateId === packTemplateIdStr,
              onClick: () => pickPackEntry(entry),
              title: `${entry.nameZh} / ${entry.nameEn}`,
              draggable: entry.placeKind === 'facility',
              onDragStart: entry.placeKind === 'facility'
                ? (event: React.DragEvent<HTMLButtonElement>) => {
                  event.dataTransfer.setData('text/plain', packTemplateIdStr);
                  event.dataTransfer.effectAllowed = 'copy';
                }
                : undefined,
              icon: packChipNode(entry),
            });
          }
          const template = libraryFacilityTemplate(entry);
          const active = facilityTemplateId === template.templateId;
          return renderOneplanItemRow({
            key: entry.id,
            testId: `library-item-${entry.kind}-${entry.slug}`,
            label: entry.nameZh,
            active,
            onClick: () => pickLibraryEntry(entry),
            title: `${entry.nameZh} / ${entry.nameEn}（默认 ${entry.width}×${entry.depth} m）`,
            draggable: true,
            onDragStart: event => {
              // 与内置模板同一条拖放通道：画布 onDrop 读 text/plain 后落模板。
              event.dataTransfer.setData('text/plain', template.templateId);
              event.dataTransfer.effectAllowed = 'copy';
            },
            icon: (
              <span
                aria-hidden
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  flex: '0 0 auto',
                  borderRadius: entry.kind === 'icon' ? 999 : 6,
                  // 2026-11-12 主题色：icon 类彩色圆底 + 白字形（OnePlan marketplace 同款）；
                  // scale/area 浅底 + 主题色线稿（mask 染色），无色回落原样。
                  background: entry.kind === 'icon' ? libraryEntryColor(entry) : '#eef1f4',
                }}
              >
                {entry.kind !== 'icon' ? (
                  <span
                    aria-hidden
                    style={{
                      display: 'block',
                      width: 16,
                      height: 16,
                      backgroundColor: libraryEntryColor(entry),
                      WebkitMaskImage: `url("${oneplanStickerSrc(entry.sticker)}")`,
                      maskImage: `url("${oneplanStickerSrc(entry.sticker)}")`,
                      WebkitMaskSize: 'contain',
                      maskSize: 'contain',
                      WebkitMaskRepeat: 'no-repeat',
                      maskRepeat: 'no-repeat',
                      WebkitMaskPosition: 'center',
                      maskPosition: 'center',
                    }}
                  />
                ) : (
                  <img src={oneplanStickerSrc(entry.sticker)} alt="" width={16} height={16} loading="lazy" style={{ display: 'block' }} />
                )}
              </span>
            ),
          });
        })}
      </div>
    );
  }

  /** 待放模板的统一解析：库模板优先，其次内置目录，最后走合并目录兜底。 */
  function resolvePendingTemplate(): PlanFacilityTemplate | null {
    const id = facilityTemplateRef.current;
    if (!id) return null;
    const override = facilityTemplateObjRef.current;
    if (override && override.templateId === id) return override;
    const builtin = findFacilityTemplate(id);
    if (builtin && builtin.templateId === id) return builtin;
    // 2026-11-11 目录合并：`oneplan:` 历史 id / 物件库未就绪时，也解析出名字与占地。
    return resolveFacilityTemplate(id);
  }

  function placeFacilityAt(pt: PlanPoint) {
    const templateId = facilityTemplateRef.current;
    if (!templateId) {
      setEditMessage('先在面板点选一个设施模板。');
      return;
    }
    const template = resolvePendingTemplate();
    if (!template) {
      setEditMessage(`设施模板「${templateId}」不存在。`);
      return;
    }
    const current = planRef.current;
    const view = viewPlan();
    const result = buildFacility({ templateId, template, position: pt }, current.boundary, view.facilities);
    if (!result.ok) {
      setEditMessage(result.issue.message);
      return;
    }
    commitPlan({ ...current, facilities: [...current.facilities, { ...result.value, ...activeLevelStamp() }] });
    selectFacility(result.value.id);
    const hint = result.issues && result.issues.length > 0 ? `，注意：${result.issues.map(i => i.message).join('；')}` : '';
    setEditMessage(`已放置「${result.value.name}」，继续单击放置或 Esc 结束${hint}`);
  }

  /**
   * P2-i：设施改名/备注之外，接旋转（度）与尺寸（宽×深，米）——面板输入与画布手柄共用，
   * 尺寸按 FACILITY_MIN/MAX 夹紧，旋转归一化到 [0,360)；全部走 commitPlan（可撤销）。
   */
  function updateFacility(
    id: string,
    patch: Partial<Pick<PlanFacility,
      'name' | 'notes' | 'rotationDeg' | 'color' | 'opacity' | 'strokeStyle' | 'modelOverride'
      | 'vendorName' | 'vendorZone' | 'inDate' | 'inTime' | 'outDate' | 'outTime' | 'electricKw'
    >> & { size?: { width: number; depth: number } },
  ) {
    // 空名会让 plan 过不了契约校验：改名时忽略空值。
    if (patch.name !== undefined && patch.name.trim().length === 0) return;
    const current = planRef.current;
    const facilities = current.facilities.map(f => {
      if (f.id !== id) return f;
      const size = patch.size
        ? {
            width: clamp(patch.size.width, FACILITY_MIN_SIZE_M, FACILITY_MAX_SIZE_M),
            depth: clamp(patch.size.depth, FACILITY_MIN_SIZE_M, FACILITY_MAX_SIZE_M),
          }
        : f.size;
      const rotationDeg = patch.rotationDeg !== undefined ? ((patch.rotationDeg % 360) + 360) % 360 : f.rotationDeg;
      return { ...f, ...patch, size, rotationDeg };
    });
    commitPlan({ ...current, facilities });
  }

  function deleteFacility(id: string) {
    const current = planRef.current;
    commitPlan({ ...current, facilities: current.facilities.filter(f => f.id !== id) });
    selectFacility(null);
    setEditMessage('设施已删除。');
  }

  /** P2-i：方向键微调选中设施（1 m，Shift=10 m），共用一条 undo 记录。 */
  function nudgeFacility(id: string, dx: number, dy: number) {
    const current = planRef.current;
    if (!current.facilities.some(f => f.id === id)) return;
    commitPlan({
      ...current,
      facilities: current.facilities.map(f =>
        f.id === id ? { ...f, position: { x: f.position.x + dx, y: f.position.y + dy } } : f,
      ),
    });
  }

  /** P2-i Ctrl+D：复制选中设施（同模板/尺寸/旋转，偏移 2 m，名称加「副本」），复制件成为新选中。 */
  /** 2026-11-11 OnePlan Repeat 阵列：沿物件自身旋转轴复制 cols×rows（原件占 (0,0) 格），间距沿轴可调，一条 undo。 */
  function applyRepeatFacility(fac: PlanFacility, cols: number, rows: number, gapX: number, gapY: number) {
    const theta = (fac.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const copies: PlanFacility[] = [];
    const baseName = fac.name.replace(/ \d+$/, '');
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        if (i === 0 && j === 0) continue;
        const lu = i * (fac.size.width + gapX);
        const lv = j * (fac.size.depth + gapY);
        copies.push({
          ...fac,
          id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-r${i}-${j}`,
          name: `${baseName} ${copies.length + 1}`,
          position: { x: fac.position.x + lu * cos - lv * sin, y: fac.position.y + lu * sin + lv * cos },
        });
      }
    }
    if (copies.length === 0) return;
    commitPlan({ ...planRef.current, facilities: [...planRef.current.facilities, ...copies] });
    setEditMessage(`已按 ${cols}×${rows} 阵列复制 ${copies.length} 件（间距 ${gapX}×${gapY} m）。`);
    draw();
  }

  function duplicateFacility(id: string) {
    const facility = planRef.current.facilities.find(f => f.id === id);
    if (!facility) return;
    const copy: PlanFacility = {
      ...facility,
      id: crypto.randomUUID(),
      name: `${facility.name} 副本`,
      position: { x: facility.position.x + 2, y: facility.position.y + 2 },
    };
    commitPlan({ ...planRef.current, facilities: [...planRef.current.facilities, copy] });
    selectFacility(copy.id);
    setEditMessage(`已复制「${facility.name}」，可直接拖动或用面板改尺寸/旋转。`);
  }

  /* ---------------- 2026-11-12 OnePlan Selection tool：框选多选（B1–B3） ---------------- */

  /** 清空组选（ref+state 同步；drawAfter=false 供 setMode 等随后自会 draw 的调用方）。 */
  function clearMultiSelection(drawAfter = true) {
    if (multiSelectedFacilityIdsRef.current.length === 0) return;
    multiSelectedFacilityIdsRef.current = [];
    setMultiSelectedFacilityIds([]);
    if (drawAfter) draw();
  }

  /** 组选成立（≥2 件）：清单选/分区/标注选中，进入多选态。 */
  function selectFacilityGroup(ids: string[]) {
    selectedFacilityRef.current = null;
    setSelectedFacilityId(null);
    selectZone(null);
    selectAnnotation(null);
    multiSelectedFacilityIdsRef.current = ids;
    setMultiSelectedFacilityIds(ids);
    setInfoTab('inventory');
    draw();
  }

  /** 组选批量删除（一条 undo）。 */
  function deleteFacilitiesMulti(ids: string[]) {
    const current = planRef.current;
    const idSet = new Set(ids);
    commitPlan({ ...current, facilities: current.facilities.filter(f => !idSet.has(f.id)) });
    clearMultiSelection(false);
    setEditMessage(`已删除 ${ids.length} 件设施。`);
    draw();
  }

  /** 组选批量复制（整体偏移 2 m，一条 undo；复制件成为新组选）。 */
  function duplicateFacilitiesMulti(ids: string[]) {
    const current = planRef.current;
    const idSet = new Set(ids);
    const copies: PlanFacility[] = [];
    const nextFacilities = current.facilities.map(f => f);
    for (const facility of current.facilities) {
      if (!idSet.has(facility.id)) continue;
      copies.push({
        ...facility,
        id: crypto.randomUUID(),
        name: `${facility.name.replace(/ \d+$/, '')} ${current.facilities.filter(f2 => f2.templateId === facility.templateId).length + copies.length + 1}`,
        position: { x: facility.position.x + 2, y: facility.position.y + 2 },
      });
    }
    if (copies.length === 0) return;
    commitPlan({ ...current, facilities: [...nextFacilities, ...copies] });
    multiSelectedFacilityIdsRef.current = copies.map(c => c.id);
    setMultiSelectedFacilityIds(multiSelectedFacilityIdsRef.current);
    setEditMessage(`已复制 ${copies.length} 件设施（整体右移 2 m）。`);
    draw();
  }

  /** 组选方向键微调（1 m，Shift=10 m），一条 undo。 */
  function nudgeFacilitiesMulti(ids: string[], dx: number, dy: number) {
    const current = planRef.current;
    const idSet = new Set(ids);
    commitPlan({
      ...current,
      facilities: current.facilities.map(f => (idSet.has(f.id) ? { ...f, position: { x: f.position.x + dx, y: f.position.y + dy } } : f)),
    });
  }

  /** 2026-11-12 组对齐（室内多选胶囊同款八向）：一条 undo。 */
  function alignFacilitiesMulti(ids: string[], mode: FacilityAlignMode) {
    const current = planRef.current;
    const items = current.facilities.filter(f => ids.includes(f.id));
    if (items.length < 2) return;
    const aligned = facilityGroupAlign(items, mode);
    const map = new Map(aligned.map(f => [f.id, f] as const));
    commitPlan({ ...current, facilities: current.facilities.map(f => map.get(f.id) ?? f) });
  }

  /** 2026-11-12 组等距分布（≥3 件生效，纯函数内兜底）：一条 undo。 */
  function distributeFacilitiesMulti(ids: string[], axis: 'x' | 'y') {
    const current = planRef.current;
    const items = current.facilities.filter(f => ids.includes(f.id));
    if (items.length < 3) return;
    const distributed = facilityGroupDistribute(items, axis);
    const map = new Map(distributed.map(f => [f.id, f] as const));
    commitPlan({ ...current, facilities: current.facilities.map(f => map.get(f.id) ?? f) });
  }

  /* ---------------- P2-i 设施画布直接操作（拖/旋转/改尺寸） ---------------- */

  function newFacilityDrag(
    facility: PlanFacility,
    kind: FacilityDragState['kind'],
    corner: number,
    side: number,
    pt: PlanPoint,
    px: { x: number; y: number },
  ): FacilityDragState {
    return { id: facility.id, kind, corner, side, startPt: pt, startPx: px, startFacility: facility, moved: false, preview: facility };
  }

  /**
   * 按下时的命中顺序：选中设施的旋转柄 → 四边单面拉伸柄 → 四角改尺寸柄 → 任意设施本体（命中即选中并准备拖动）。
   * 返回 true 表示这次按下被设施接管（不再走节点拖动/平移）。
   */
  function startFacilityDrag(px: { x: number; y: number }, pt: PlanPoint): boolean {
    if (!facilityDirectEditable()) return false;
    const current = planRef.current;
    const viewport = currentViewport();
    const selected = selectedFacilityRef.current
      ? current.facilities.find(f => f.id === selectedFacilityRef.current) ?? null
      : null;
    if (selected) {
      const handle = facilityHandleAt(selected, viewport, px, FACILITY_HANDLE_MIN_FOOTPRINT_PX);
      if (handle) {
        facilityDragRef.current = newFacilityDrag(
          selected,
          handle.kind,
          handle.kind === 'resize' ? handle.corner : -1,
          handle.kind === 'side' ? handle.side : -1,
          pt,
          px,
        );
        return true;
      }
    }
    const hitFacility = [...viewPlan().facilities].reverse().find(f => facilityContainsPoint(pt, f));
    if (!hitFacility) return false;
    selectFacility(hitFacility.id);
    facilityDragRef.current = newFacilityDrag(hitFacility, 'move', -1, -1, pt, px);
    return true;
  }

  /** 拖拽预览：移动=整体平移；旋转=绕中心跟指针角度（Shift 吸附 15°）；改尺寸=对角点固定；单边=对面固定。 */
  function facilityDragPreview(drag: FacilityDragState, pt: PlanPoint, snapRotation: boolean): PlanFacility {
    const start = drag.startFacility;
    if (drag.kind === 'move') {
      return {
        ...start,
        position: { x: start.position.x + (pt.x - drag.startPt.x), y: start.position.y + (pt.y - drag.startPt.y) },
      };
    }
    if (drag.kind === 'rotate') {
      const center = start.position;
      const from = Math.atan2(drag.startPt.y - center.y, drag.startPt.x - center.x);
      const to = Math.atan2(pt.y - center.y, pt.x - center.x);
      const deg = start.rotationDeg + ((to - from) * 180) / Math.PI;
      const snapped = snapRotation ? Math.round(deg / 15) * 15 : deg;
      return { ...start, rotationDeg: ((snapped % 360) + 360) % 360 };
    }
    if (drag.kind === 'side') {
      // 2026-11-11「多个面」编辑：拖边柄单面拉伸——对面固定，宽深独立变化，中心随拉伸轴平移。
      const next = facilitySideResize(start, drag.side as FacilitySideIndex, pt, { minM: FACILITY_MIN_SIZE_M, maxM: FACILITY_MAX_SIZE_M });
      return { ...start, position: next.position, size: next.size };
    }
    // resize：对角点固定，指针投影到本地方向得到新宽深，中心按新尺寸回推。
    const theta = (start.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const signX = drag.corner === 1 || drag.corner === 2 ? 1 : -1;
    const signY = drag.corner >= 2 ? 1 : -1;
    const halfW = start.size.width / 2;
    const halfD = start.size.depth / 2;
    const oppX = start.position.x - signX * halfW * cos + signY * halfD * sin;
    const oppY = start.position.y - signX * halfW * sin - signY * halfD * cos;
    const dx = pt.x - oppX;
    const dy = pt.y - oppY;
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;
    const width = clamp(Math.abs(localX), FACILITY_MIN_SIZE_M, FACILITY_MAX_SIZE_M);
    const depth = clamp(Math.abs(localY), FACILITY_MIN_SIZE_M, FACILITY_MAX_SIZE_M);
    return {
      ...start,
      position: {
        x: oppX + signX * (width / 2) * cos - signY * (depth / 2) * sin,
        y: oppY + signX * (width / 2) * sin + signY * (depth / 2) * cos,
      },
      size: { width, depth },
    };
  }

  /* ---------------- H2-d 动线 / 节点 / 人员 ---------------- */

  function selectRoute(id: string | null) {
    selectedRouteRef.current = id;
    setSelectedRouteId(id);
    if (id !== null) {
      selectFacility(null); selectNode(null); selectWorker(null);
    }
    draw();
  }

  function selectNode(id: string | null) {
    selectedNodeRef.current = id;
    setSelectedNodeId(id);
    if (id !== null) {
      selectFacility(null); selectRoute(null); selectWorker(null);
    }
    draw();
  }

  function selectWorker(id: string | null) {
    selectedWorkerRef.current = id;
    setSelectedWorkerId(id);
    if (id !== null) {
      selectFacility(null); selectRoute(null); selectNode(null);
    }
    draw();
  }

  /** 像素点到线段的最短距离（点选路线用）。 */
  function pointSegmentDistancePx(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  /** 命中检测：最近的出入口节点（NODE_HIT_PX 内），无则 null。只命中当前层。 */
  function nearestNodeIdAt(px: { x: number; y: number }): string | null {
    let best: { id: string; d: number } | null = null;
    for (const n of viewPlan().nodes) {
      const pt = planPointToPixel(n.position, currentViewport());
      const d = Math.hypot(pt.x - px.x, pt.y - px.y);
      if (d <= NODE_HIT_PX && (best === null || d < best.d)) best = { id: n.id, d };
    }
    return best?.id ?? null;
  }

  /** 命中检测：最近的人员点位（WORKER_HIT_PX 内），无则 null。只命中当前层。 */
  function nearestWorkerIdAt(px: { x: number; y: number }): string | null {
    let best: { id: string; d: number } | null = null;
    for (const w of viewPlan().workers) {
      const pt = planPointToPixel(w.position, currentViewport());
      const d = Math.hypot(pt.x - px.x, pt.y - px.y);
      if (d <= WORKER_HIT_PX && (best === null || d < best.d)) best = { id: w.id, d };
    }
    return best?.id ?? null;
  }

  /** 命中检测：最近的路线折线（ROUTE_HIT_PX 内的点到段距离），无则 null。只命中当前层。 */
  function nearestRouteIdAt(px: { x: number; y: number }): string | null {
    let best: { id: string; d: number } | null = null;
    for (const r of viewPlan().routes) {
      for (let i = 1; i < r.points.length; i++) {
        const a = planPointToPixel(r.points[i - 1]!, currentViewport());
        const b = planPointToPixel(r.points[i]!, currentViewport());
        const d = pointSegmentDistancePx(px, a, b);
        if (d <= ROUTE_HIT_PX && (best === null || d < best.d)) best = { id: r.id, d };
      }
    }
    return best?.id ?? null;
  }

  /** H3-b 命中检测：最近的冲突/缺失标记（与绘制半径一致，标记恒在业务层之上）。 */
  function nearestConflictAt(px: { x: number; y: number }): PlanConflictIssue | null {
    let best: { issue: PlanConflictIssue; d: number } | null = null;
    for (const issue of conflictIssuesRef.current) {
      const pt = planPointToPixel(issue.at, currentViewport());
      const d = Math.hypot(pt.x - px.x, pt.y - px.y);
      if (d <= 10 && (best === null || d < best.d)) best = { issue, d };
    }
    return best?.issue ?? null;
  }

  /** 动线端点吸附：SNAP 距离内的最近节点（只吸当前层节点），返回 {nodeId, position} 或 null。 */
  function snapNodeAt(pt: PlanPoint): { nodeId: string; position: PlanPoint } | null {
    const vp = currentViewport();
    const metersPerPx = planMetersPerPixel(vp);
    const snapM = NODE_HIT_PX * metersPerPx;
    let best: { nodeId: string; position: PlanPoint; d: number } | null = null;
    for (const n of viewPlan().nodes) {
      const d = planPointDistanceM(n.position, pt);
      if (d <= snapM && (best === null || d < best.d)) best = { nodeId: n.id, position: n.position, d };
    }
    return best ? { nodeId: best.nodeId, position: best.position } : null;
  }

  /** 画动线模式单击加点（近已有点忽略；上限 128）。 */
  function addRoutePoint(pt: PlanPoint) {
    const draftPoints = routeDraftRef.current;
    if (draftPoints.length >= PLAN_ROUTE_MAX_VERTICES) {
      setEditMessage(`动线顶点已达上限 ${PLAN_ROUTE_MAX_VERTICES} 个，先完成或按 Esc 取消。`);
      return;
    }
    for (const existing of draftPoints) {
      if (planPointDistanceM(existing, pt) < PLAN_MIN_VERTEX_GAP_M) {
        setEditMessage('离已有的点太近（<0.5 m），当作重复点击忽略。');
        return;
      }
    }
    routeDraftRef.current = [...draftPoints, { x: pt.x, y: pt.y }];
    setRouteDraftCount(routeDraftRef.current.length);
    setEditMessage(null);
    draw();
  }

  /** 完成/提交动线：端点吸附节点（唯一端点来源），buildRoute 校验后提交；可连续画下一条。 */
  function finishRoute() {
    const draftPoints = routeDraftRef.current;
    if (draftPoints.length < 2) {
      setEditMessage('动线至少要 2 个点：单击加路径点，完成后点「完成动线」。');
      return;
    }
    const current = planRef.current;
    const view = viewPlan();
    const startSnap = snapNodeAt(draftPoints[0]!);
    const endSnap = snapNodeAt(draftPoints[draftPoints.length - 1]!);
    const points = draftPoints.map((p, i) => {
      if (i === 0 && startSnap) return startSnap.position;
      if (i === draftPoints.length - 1 && endSnap && endSnap.nodeId !== startSnap?.nodeId) return endSnap.position;
      return p;
    });
    const result = buildRoute(
      {
        // 2026-11-12 活动包预设：动线名/主题色/线型随包物件（finishRoute 后保留，可连画同款）。
        kind: routePresetRef.current?.kind ?? routeKindRef.current,
        name: routePresetRef.current?.name ?? `${planRouteKindLabels[routeKindRef.current]}动线 ${view.routes.length + 1}`,
        points,
        oneWay: routeOneWayRef.current,
        ...(routePresetRef.current?.color ? { color: routePresetRef.current.color } : {}),
        ...(startSnap ? { startNodeId: startSnap.nodeId } : {}),
        ...(endSnap && endSnap.nodeId !== startSnap?.nodeId ? { endNodeId: endSnap.nodeId } : {}),
      },
      view.nodes,
    );
    if (!result.ok) {
      setEditMessage(result.issue.message);
      return;
    }
    commitPlan({ ...current, routes: [...current.routes, { ...result.value, ...activeLevelStamp() }] });
    routeDraftRef.current = [];
    routeCursorRef.current = null;
    setRouteDraftCount(0);
    selectRoute(result.value.id);
    const snapHint = startSnap || endSnap ? '，端点已连接到出入口节点' : '';
    setEditMessage(`动线「${result.value.name}」已添加${snapHint}；继续画下一条或 Esc 结束。`);
  }

  /** 放节点模式单击：自动编号命名，连续放置。 */
  function placeNodeAt(pt: PlanPoint) {
    const current = planRef.current;
    const names = { entry: '入口', exit: '出口', both: '出入口' } as const;
    const node: PlanNode = {
      id: crypto.randomUUID(),
      kind: nodeKindRef.current,
      name: `${names[nodeKindRef.current]} ${viewPlan().nodes.length + 1}`,
      position: { x: pt.x, y: pt.y },
      ...activeLevelStamp(),
      notes: '',
    };
    commitPlan({ ...current, nodes: [...current.nodes, node] });
    selectNode(node.id);
    setEditMessage(`已放置「${node.name}」，继续单击放置或 Esc 结束。`);
  }

  /** 布人员模式单击：岗位/人数取面板值，落点自动归属分区（当前层分区）；连续放置。 */
  function placeWorkerAt(pt: PlanPoint) {
    const current = planRef.current;
    const view = viewPlan();
    const result = buildWorker(
      { role: workerRoleRef.current, count: workerCountRef.current, position: pt },
      view.boundary,
      view.zones,
    );
    if (!result.ok) {
      setEditMessage(result.issue.message);
      return;
    }
    commitPlan({
      ...current,
      workers: [...current.workers, {
        ...result.value,
        // 2026-11-12 活动包纯色圆点位：点位色用物件主题色（契约 planWorkerSchema.color）。
        ...(workerPresetColorRef.current ? { color: workerPresetColorRef.current } : {}),
        ...activeLevelStamp(),
      }],
    });
    selectWorker(result.value.id);
    const hint = result.issues && result.issues.length > 0 ? `，注意：${result.issues.map(i => i.message).join('；')}` : '';
    setEditMessage(`已布「${result.value.role} ×${result.value.count}」${hint}；继续单击放置或 Esc 结束。`);
  }

  function updateRoute(id: string, patch: Partial<Pick<PlanRoute, 'name' | 'kind' | 'oneWay'>>) {
    const current = planRef.current;
    if (patch.name !== undefined && patch.name.trim().length === 0) return;
    commitPlan({ ...current, routes: current.routes.map(r => (r.id === id ? { ...r, ...patch } : r)) });
  }

  function reverseSelectedRoute(id: string) {
    const current = planRef.current;
    const route = current.routes.find(r => r.id === id);
    if (!route) return;
    commitPlan({ ...current, routes: current.routes.map(r => (r.id === id ? reverseRoute(r) : r)) });
    setEditMessage('动线方向已反转（起终点引用已互换）。');
  }

  function deleteRoute(id: string) {
    const current = planRef.current;
    commitPlan({ ...current, routes: current.routes.filter(r => r.id !== id) });
    selectRoute(null);
    setEditMessage('动线已删除。');
  }

  function updateNode(id: string, patch: Partial<Pick<PlanNode, 'name' | 'kind'>>) {
    const current = planRef.current;
    if (patch.name !== undefined && patch.name.trim().length === 0) return;
    commitPlan({ ...current, nodes: current.nodes.map(n => (n.id === id ? { ...n, ...patch } : n)) });
  }

  function deleteNode(id: string) {
    const current = planRef.current;
    // 引用该节点的动线剥离 nodeId 引用但保留几何（评审稿「删除关联保留有效引用」）。
    commitPlan({
      ...current,
      nodes: current.nodes.filter(n => n.id !== id),
      routes: detachNodeFromRoutes(id, current.routes),
    });
    selectNode(null);
    setEditMessage('出入口已删除；关联动线保留几何、引用已解除。');
  }

  function updateWorker(id: string, patch: Partial<Pick<PlanWorker, 'role' | 'count' | 'zoneId'>>) {
    const current = planRef.current;
    if (patch.role !== undefined && patch.role.trim().length === 0) return;
    if (patch.count !== undefined && (!Number.isInteger(patch.count) || patch.count < 1)) return;
    commitPlan({ ...current, workers: current.workers.map(w => (w.id === id ? { ...w, ...patch } : w)) });
  }

  function deleteWorker(id: string) {
    const current = planRef.current;
    commitPlan({ ...current, workers: current.workers.filter(w => w.id !== id) });
    selectWorker(null);
    setEditMessage('人员点位已删除。');
  }

  /* ---------------- H3-a 测量（临时读数 + 固定测量） ---------------- */

  /** 2026-11-11 面积拖拽：起止点对角张成 ENU 轴对齐矩形（ENU x 东 y 北与屏幕轴一致）；Shift = 正方形。 */
  function measureRectPoints(a: PlanPoint, b: PlanPoint, square: boolean): PlanPoint[] {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    if (square) {
      const side = Math.max(Math.abs(dx), Math.abs(dy));
      dx = (dx >= 0 ? 1 : -1) * side;
      dy = (dy >= 0 ? 1 : -1) * side;
    }
    const x0 = Math.min(a.x, a.x + dx);
    const x1 = Math.max(a.x, a.x + dx);
    const y0 = Math.min(a.y, a.y + dy);
    const y1 = Math.max(a.y, a.y + dy);
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  }

  /** 测量模式单击收点：面积近首点闭合；距离第 2 点自动提交；其余累积。
   *  近已有点（<0.5 m）忽略；顶点上限与契约一致。 */
  function addMeasurePoint(px: { x: number; y: number }, pt: PlanPoint) {
    const kind = measureKindRef.current;
    const draft = measureDraftRef.current;
    if (kind === 'area' && draft.length >= 3) {
      const firstPx = planPointToPixel(draft[0]!, currentViewport());
      if (Math.hypot(firstPx.x - px.x, firstPx.y - px.y) <= DRAFT_CLOSE_HIT_PX) {
        finishMeasure();
        return;
      }
    }
    if (draft.length >= PLAN_MEASURE_MAX_VERTICES) {
      setEditMessage(`测量顶点已达上限 ${PLAN_MEASURE_MAX_VERTICES} 个，先提交或按 Esc 取消。`);
      return;
    }
    for (const existing of draft) {
      if (planPointDistanceM(existing, pt) < PLAN_MIN_VERTEX_GAP_M) {
        setEditMessage('离已有的点太近（<0.5 m），当作重复点击忽略。');
        return;
      }
    }
    measureDraftRef.current = [...draft, { x: pt.x, y: pt.y }];
    setMeasureDraftCount(measureDraftRef.current.length);
    setEditMessage(null);
    if (kind === 'distance' && measureDraftRef.current.length >= 2) {
      finishMeasure();
      return;
    }
    draw();
  }

  /** 提交并固定测量：buildMeasurement 校验后 commitPlan；清草稿可连续测量。 */
  function finishMeasure() {
    const kind = measureKindRef.current;
    const draft = measureDraftRef.current;
    if (draft.length < (kind === 'area' ? 3 : 2)) {
      setEditMessage(kind === 'area'
        ? '面积测量：按住对角拖出矩形（Shift 正方形），或单击描顶点、点回起点闭合。'
        : kind === 'distance'
          ? '距离测量：按住拖一条线，或单击起点和终点。'
          : '路径测量：按住自由手绘，或单击加路径点、双击提交。');
      return;
    }
    const current = planRef.current;
    const existing = current.measurements ?? [];
    const result = buildMeasurement({
      kind,
      name: `${planMeasurementKindLabels[kind]} ${(viewPlan().measurements ?? []).length + 1}`,
      points: draft,
    });
    if (!result.ok) {
      setEditMessage(result.issue.message);
      return;
    }
    commitPlan({ ...current, measurements: [...existing, { ...result.value, ...activeLevelStamp() }] });
    measureDraftRef.current = [];
    measureCursorRef.current = null;
    setMeasureDraftCount(0);
    const valueText = result.value.kind === 'area'
      ? formatAreaM2(measureValue(result.value))
      : formatLengthM(measureValue(result.value));
    setEditMessage(`已固定测量「${result.value.name}」= ${valueText}；继续测量或 Esc 结束。`);
  }

  /** 删除固定测量标注（测量不是实体，删了就没了；不参与冲突判定，无需剥离引用）。 */
  function deleteMeasurement(id: string) {
    const current = planRef.current;
    commitPlan({ ...current, measurements: (current.measurements ?? []).filter(m => m.id !== id) });
    setEditMessage('测量标注已删除。');
  }

  /* ---------------- 2026-11-11 用户指令：自由标注（文本 + 形状） ---------------- */

  /** 选中标注（与其他实体选中互斥）。 */
  function selectAnnotation(id: string | null) {
    selectedAnnotationRef.current = id;
    setSelectedAnnotationId(id);
    if (id !== null) {
      selectFacility(null); selectZone(null); selectRoute(null); selectNode(null); selectWorker(null);
    }
    draw();
  }

  /** 提交一条标注：buildAnnotation 校验后 commitPlan（进 undo 栈）；文本/形状共用。 */
  function commitAnnotation(input: { kind: PlanShapeKind | 'note'; points: PlanPoint[]; radiusM?: number; text?: string }) {
    const current = planRef.current;
    const count = (viewPlan().annotations ?? []).length + 1;
    const textSummary = (input.text ?? '').trim().split('\n')[0] ?? '';
    const name = input.kind === 'note'
      ? (textSummary.slice(0, 20) || `文本 ${count}`)
      : `${planAnnotationKindLabels[input.kind]} ${count}`;
    const result = buildAnnotation({ ...input, name });
    if (!result.ok) {
      setEditMessage(result.issue.message);
      return false;
    }
    commitPlan({ ...current, annotations: [...(current.annotations ?? []), { ...result.value, ...activeLevelStamp() }] });
    setEditMessage(`已添加标注「${result.value.name}」；继续标注或 Esc 结束。`);
    return true;
  }

  /** 形状单击收点：近已有点（<0.5 m）忽略；rect/circle/line 收满 2 点、triangle 收满 3 点自动提交。 */
  function addShapePoint(pt: PlanPoint) {
    const kind = annotateShapeRef.current;
    const draft = annotateDraftRef.current;
    for (const existing of draft) {
      if (planPointDistanceM(existing, pt) < PLAN_MIN_VERTEX_GAP_M) {
        setEditMessage('离已有的点太近（<0.5 m），当作重复点击忽略。');
        return;
      }
    }
    const next = [...draft, { x: pt.x, y: pt.y }];
    annotateDraftRef.current = next;
    setAnnotateDraftCount(next.length);
    setEditMessage(null);
    if (next.length >= planShapeDraftTarget(kind)) {
      finishShape(next);
      return;
    }
    draw();
  }

  /** 提交形状：成功后清草稿可连续标注。 */
  function finishShape(points: PlanPoint[]) {
    const kind = annotateShapeRef.current;
    const ok = commitAnnotation({
      kind,
      points,
      ...(kind === 'circle' ? { radiusM: planPointDistanceM(points[0]!, points[1]!) } : {}),
    });
    annotateDraftRef.current = [];
    annotateCursorRef.current = null;
    annotateDragRef.current = null;
    setAnnotateDraftCount(0);
    draw();
    return ok;
  }

  /** 删除标注（标注不是实体，删了就没了；不参与冲突判定，无需剥离引用）。 */
  function deleteAnnotation(id: string) {
    const current = planRef.current;
    commitPlan({ ...current, annotations: (current.annotations ?? []).filter(a => a.id !== id) });
    if (selectedAnnotationRef.current === id) selectAnnotation(null);
    setEditMessage('标注已删除。');
  }

  /** 标注命中测试（浏览模式点选）：容差 8 CSS px 换算成米，数组倒序 = 上层优先。 */
  function nearestAnnotationIdAt(pt: PlanPoint): string | null {
    const toleranceM = ANNOTATION_HIT_PX * planMetersPerPixel(currentViewport());
    const annotations = viewPlan().annotations ?? [];
    for (const a of [...annotations].reverse()) {
      if (annotationDistanceM(pt, a) <= toleranceM) return a.id;
    }
    return null;
  }

  /* ---------------- H3-c 双向定位 ---------------- */

  /** 平移视图使米制 ENU 点居中（zoom 不变；ENU→经纬度复用画布库锚点近似投影）。 */
  function centerViewOn(pt: PlanPoint) {
    const anchor = planRef.current.anchor;
    const geo = enuToLngLat(pt.x, pt.y, anchor?.lng ?? DEFAULT_ANCHOR_LNG, anchor?.lat ?? DEFAULT_ANCHOR_LAT);
    commitView({
      lng: clamp(geo.lng, -180, 180),
      lat: clamp(geo.lat, -85, 85),
      zoom: viewRef.current.zoom,
    });
  }

  /**
   * P2-k 搜地点：把视图飞到某个经纬度（可指定 zoom，缺省保持当前级别）。
   * 只动视图，不改 plan / anchor —— 搜地点是「看一眼这块地」，不是重新标定。
   */
  function focusLngLat(lng: number, lat: number, zoom?: number) {
    const floor = baseModeRef.current === 'floor';
    commitView({
      lng: clamp(lng, -180, 180),
      lat: clamp(lat, -85, 85),
      zoom: clamp(
        zoom ?? viewRef.current.zoom,
        floor ? FLOOR_MIN_ZOOM : MAP_MIN_ZOOM,
        floor ? FLOOR_MAX_ZOOM : MAP_MAX_ZOOM,
      ),
    });
  }

  /**
   * 2026-11-12 搜地点选区：把视野框到给定经纬度外框 `[west, south, east, north]`。
   * 墨卡托反解：先按画布像素算「要多大世界宽度才装得下这块地」，再换回 zoom。
   * 只动视图，不改 plan / anchor。
   */
  function focusBounds(bounds: [number, number, number, number]) {
    const [west, south, east, north] = bounds;
    if (![west, south, east, north].every(value => Number.isFinite(value))) return;
    if (!(east > west) || !(north > south)) return;
    const floor = baseModeRef.current === 'floor';
    const vp = currentViewport();
    const mercY = (lat: number) => {
      const rad = (clamp(lat, -85, 85) * Math.PI) / 180;
      return Math.log(Math.tan(Math.PI / 4 + rad / 2));
    };
    const spanLng = east - west;
    const spanMerc = Math.max(1e-9, mercY(north) - mercY(south));
    const worldForWidth = (vp.canvasW * 360) / spanLng;
    const worldForHeight = (vp.canvasH * Math.PI * 2) / spanMerc;
    // 0.35 级余量：边界贴着画布四边会显得局促。
    const zoom = Math.log2(Math.min(worldForWidth, worldForHeight) / 256) - 0.35;
    commitView({
      lng: clamp((west + east) / 2, -180, 180),
      lat: clamp((south + north) / 2, -85, 85),
      zoom: clamp(
        zoom,
        floor ? FLOOR_MIN_ZOOM : MAP_MIN_ZOOM,
        floor ? FLOOR_MAX_ZOOM : MAP_MAX_ZOOM,
      ),
    });
  }

  /** 清单行 → 地图：居中锚点 + 选中实体（分区/测量无选中态，仅居中）。 */  /** 2026-11-11：分区删除（树行右键/Delete 入口）——worker/facility 的 zoneId 引用一并摘除，不留悬空。 */
  function deleteZone(id: string) {
    const zone = planRef.current.zones.find(z => z.id === id);
    if (!zone) return;
    commitPlan({
      ...planRef.current,
      zones: planRef.current.zones.filter(z => z.id !== id),
      workers: planRef.current.workers.map(w => (w.zoneId === id ? { ...w, zoneId: undefined } : w)),
      facilities: planRef.current.facilities.map(f => (f.zoneId === id ? { ...f, zoneId: undefined } : f)),
    });
    if (selectedZoneId === id) selectZone(null);
    setEditMessage(`已删除分区「${zone.name}」。`);
  }

  /** 2026-11-11：树行右键删除的统一入口（按行 kind 分发到既有删除器）。 */
  function deleteRow(row: PlanInventoryRow) {
    if (row.kind === 'zone') deleteZone(row.id);
    else if (row.kind === 'facility') deleteFacility(row.id);
    else if (row.kind === 'route') deleteRoute(row.id);
    else if (row.kind === 'node') deleteNode(row.id);
    else if (row.kind === 'worker') deleteWorker(row.id);
    else if (row.kind === 'measurement') deleteMeasurement(row.id);
    // 2026-11-11 用户指令：树行右键删除自由标注。
    else if (row.kind === 'annotation') deleteAnnotation(row.id);
  }

  function locateRow(row: PlanInventoryRow) {
    centerViewOn(row.anchor);
    if (row.kind === 'facility') {
      selectRoute(null);
      selectNode(null);
      selectWorker(null);
      selectFacility(row.id);
    } else if (row.kind === 'zone') {
      // 2026-11-11：分区实例行点击 = 选中（图层面板浮出该分区的名称/颜色/透明度编辑器）+ 居中。
      selectZone(row.id);
    } else if (row.kind === 'route') {
      selectRoute(row.id);
    } else if (row.kind === 'node') {
      selectNode(row.id);
    } else if (row.kind === 'worker') {
      selectWorker(row.id);
    } else if (row.kind === 'annotation') {
      // 2026-11-11 用户指令：标注行点击 = 选中（白描边高亮）+ 居中，Delete 可删。
      selectAnnotation(row.id);
    }
    setInfoMessage(`已在地图上定位「${row.name}」。`);
  }

  /** 问题条目 → 地图：居中锚点，关联实体可选中。 */
  function locateIssue(entry: PlanLocatableIssue) {
    centerViewOn(entry.anchor);
    if (entry.routeId) {
      selectRoute(entry.routeId);
    } else if (entry.facilityId) {
      selectRoute(null);
      selectNode(null);
      selectWorker(null);
      selectFacility(entry.facilityId);
    } else if (entry.nodeId) {
      selectNode(entry.nodeId);
    } else if (entry.workerId) {
      selectWorker(entry.workerId);
    }
    setInfoMessage(`已定位：${entry.text}`);
  }

  function viewHitSelectable(hit: { px: { x: number; y: number }; pt: PlanPoint }): boolean {
    if (!onPlanChange) return false;
    if (nearestConflictAt(hit.px)) return true;
    if (!layerLocked('node') && nearestNodeIdAt(hit.px)) return true;
    if (!layerLocked('worker') && nearestWorkerIdAt(hit.px)) return true;
    if (!layerLocked('route') && nearestRouteIdAt(hit.px)) return true;
    if (!layerLocked('annotate') && nearestAnnotationIdAt(hit.pt)) return true;
    if (!layerLocked('facility') && viewPlan().facilities.some((facility) => facilityContainsPoint(hit.pt, facility))) return true;
    if (!layerLocked('zone') && viewPlan().zones.some((zone) => planPointInRing(hit.pt, zone.polygon))) return true;
    return false;
  }

  function handleStageMouseDown(event: React.MouseEvent) {
    const activeMode = modeRef.current;
    const hit = eventPlanPoint(event);
    if (activeMode === 'view') {
      // P2-i：设施手柄/本体优先接管（旋转、改尺寸、整体拖动），其次才落到节点与平移。
      if (hit && onPlanChange && startFacilityDrag(hit.px, hit.pt)) {
        pointerConsumedRef.current = true;
        downPxRef.current = hit.px;
        setDragging(true);
        return;
      }
      // P2-j：选中分区后按住它的顶点即改形（优先于平移）。
      if (hit && onPlanChange && !layerLocked('zone')) {
        const zoneId = selectedZoneRef.current;
        const zone = zoneId ? planRef.current.zones.find(z => z.id === zoneId) ?? null : null;
        if (zone) {
          const index = nearestZoneVertexIndex(zone, hit.px);
          if (index !== null) {
            pointerConsumedRef.current = true;
            dragZoneVertexRef.current = { zoneId: zone.id, index };
            zoneDragPreviewRef.current = { zoneId: zone.id, polygon: zone.polygon };
            downPxRef.current = hit.px;
            setDragging(true);
            return;
          }
        }
      }
      // H2-d：浏览模式按住出入口节点即拖动（引用路线端点随动），不启动平移（锁定层不响应）。
      if (hit && !layerLocked('node')) {
        const nodeId = nearestNodeIdAt(hit.px);
        if (nodeId) {
          pointerConsumedRef.current = true;
          dragNodeRef.current = { id: nodeId, moved: false };
          downPxRef.current = hit.px;
          setDragging(true);
          return;
        }
      }
      // 3D 里空地点击仍归镜头环绕；点中分区/线/点位则吃掉这次按下，好在抬起时选中或拖动。
      if (pointerFrom3dRef.current) {
        if (hit) {
          downPxRef.current = hit.px;
          pointerConsumedRef.current = viewHitSelectable(hit);
        } else {
          pointerConsumedRef.current = false;
        }
        return;
      }
      panRef.current = { x: event.clientX, y: event.clientY };
      downPxRef.current = hit ? hit.px : null;
      setDragging(true);
      return;
    }
    if (activeMode === 'select') {
      // 2026-11-12 B2 框选模式：组角柄(缩放) > 已选单件手柄 > 组内件(整组移动) > 新命中(shift 加减选/单选拖动) > 空白(marquee)。
      if (!hit) return;
      pointerConsumedRef.current = true;
      downPxRef.current = hit.px;
      setDragging(true);
      const multi = multiSelectedFacilityIdsRef.current;
      const viewport = currentViewport();
      if (!layerLocked('facility')) {
        // ① 已选单件的编辑手柄（旋转/单边/角，与浏览模式同一套）：select 模式也可用。
        const selected = selectedFacilityRef.current
          ? planRef.current.facilities.find(f => f.id === selectedFacilityRef.current) ?? null
          : null;
        if (selected && onPlanChange) {
          const handle = facilityHandleAt(selected, viewport, hit.px, FACILITY_HANDLE_MIN_FOOTPRINT_PX);
          if (handle) {
            facilityDragRef.current = newFacilityDrag(selected, handle.kind, handle.kind === 'resize' ? handle.corner : -1, handle.kind === 'side' ? handle.side : -1, hit.pt, hit.px);
            return;
          }
        }
        // ② 组角柄：整组等比缩放（对角锚定）。
        if (multi.length >= 2) {
          const items = multi.map(id => planRef.current.facilities.find(f => f.id === id)).filter((f): f is PlanFacility => Boolean(f));
          const bounds = facilityGroupBounds(items);
          if (bounds) {
            const corner = groupCornerHandleAtPx(hit.px, bounds, viewport);
            if (corner !== null) {
              const anchorPlan = groupCornerPlanPoints(bounds)[(corner + 2) % 4]!;
              groupDragRef.current = { kind: 'scale', items, bounds, anchor: anchorPlan, startPt: hit.pt, startPx: hit.px, corner, moved: false, preview: null };
              return;
            }
          }
        }
        // ③ 命中设施：shift 切换组员资格；无 shift=组内件整组移动 / 组外件单选拖动。
        const hitFacility = [...viewPlan().facilities].reverse().find(f => facilityContainsPoint(hit.pt, f));
        if (hitFacility) {
          if (event.shiftKey) {
            const next = multi.includes(hitFacility.id)
              ? multi.filter(id => id !== hitFacility.id)
              : [...multi, hitFacility.id];
            if (next.length >= 2) selectFacilityGroup(next);
            else if (next.length === 1) { clearMultiSelection(false); selectFacility(next[0]!); }
            else { clearMultiSelection(false); selectFacility(null); }
            return;
          }
          if (multi.includes(hitFacility.id)) {
            const items = multi.map(id => planRef.current.facilities.find(f => f.id === id)).filter((f): f is PlanFacility => Boolean(f));
            groupDragRef.current = {
              kind: 'move',
              items,
              bounds: facilityGroupBounds(items) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 },
              anchor: { x: 0, y: 0 },
              startPt: hit.pt,
              startPx: hit.px,
              corner: -1,
              moved: false,
              preview: null,
            };
            return;
          }
          selectFacility(hitFacility.id);
          facilityDragRef.current = newFacilityDrag(hitFacility, 'move', -1, -1, hit.pt, hit.px);
          return;
        }
      }
      // ④ 空白按下：起 marquee（松手按矩形框选；没拖动=单击清空）。
      marqueeRectRef.current = { startPx: hit.px, curPx: hit.px };
      return;
    }
    if (!hit) return;
    pointerConsumedRef.current = true;
    downPxRef.current = hit.px;
    // 2026-11-11 拖拽式测量：左键按下记起点；位移过阈值进拖拽，否则仍算单击加点。
    if (activeMode === 'measure') {
      measureDragRef.current = event.button === 0 ? { startPx: hit.px, startPt: hit.pt, active: false } : null;
    }
    // 2026-11-11 用户指令：形状拖拽会话起点（rect 对角/line 两端/circle 中心；单击加点同样先记起点）。
    // 三角形走纯三点单击，不拖；草稿已有未完成的点时不重开拖拽（等下一次单击收点）。
    if (activeMode === 'shape') {
      annotateDragRef.current = event.button === 0 && annotateDraftRef.current.length === 0 && annotateShapeRef.current !== 'triangle'
        ? { startPx: hit.px, startPt: hit.pt, active: false }
        : null;
    }
    if (activeMode === 'boundary-vertex') {
      // P2-i：边界层锁定时顶点不可拖动。
      dragVertexRef.current = layerLocked('boundary') ? null : nearestBoundaryVertexIndex(hit.px);
    }
  }

  function handleStageMouseMove(event: React.MouseEvent) {
    const activeMode = modeRef.current;
    if (activeMode === 'select') {
      // 2026-11-12 B2：组会话预览 > 单件拖拽预览（与浏览同一套）> marquee 更新。select 模式不平移。
      const hit = eventPlanPoint(event);
      if (!hit) return;
      const groupDrag = groupDragRef.current;
      if (groupDrag) {
        if (Math.hypot(hit.px.x - groupDrag.startPx.x, hit.px.y - groupDrag.startPx.y) > CLICK_MAX_MOVE_PX) {
          groupDrag.moved = true;
        }
        if (groupDrag.moved) {
          if (groupDrag.kind === 'move') {
            const dx = hit.pt.x - groupDrag.startPt.x;
            const dy = hit.pt.y - groupDrag.startPt.y;
            groupDrag.preview = groupDrag.items.map(f => ({ ...f, position: { x: f.position.x + dx, y: f.position.y + dy } }));
          } else {
            // B3 角柄等比缩放：以指针相对锚点的位移比求系数（x 轴为主，退化时用 y 轴）。
            const startCorner = groupCornerPlanPoints(groupDrag.bounds)[groupDrag.corner]!;
            const ax = startCorner.x - groupDrag.anchor.x;
            const ay = startCorner.y - groupDrag.anchor.y;
            const factorX = ax !== 0 ? (hit.pt.x - groupDrag.anchor.x) / ax : 0;
            const factorY = ay !== 0 ? (hit.pt.y - groupDrag.anchor.y) / ay : 0;
            const factor = factorX !== 0 ? factorX : factorY;
            groupDrag.preview = facilityGroupScale(groupDrag.items, groupDrag.anchor, factor, { minM: FACILITY_MIN_SIZE_M, maxM: FACILITY_MAX_SIZE_M });
          }
          setEditMessage(null);
          draw();
        }
        return;
      }
      const facilityDrag = facilityDragRef.current;
      if (facilityDrag) {
        if (Math.hypot(hit.px.x - facilityDrag.startPx.x, hit.px.y - facilityDrag.startPx.y) > CLICK_MAX_MOVE_PX) {
          facilityDrag.moved = true;
        }
        if (facilityDrag.moved) {
          facilityDrag.preview = facilityDragPreview(facilityDrag, hit.pt, event.shiftKey);
          setEditMessage(null);
          draw();
        }
        return;
      }
      if (marqueeRectRef.current) {
        marqueeRectRef.current = { ...marqueeRectRef.current, curPx: hit.px };
        draw();
      }
      return;
    }
    if (activeMode === 'view') {
      // P2-i：设施拖拽预览（移动/旋转/改尺寸）；松手才 commitPlan，拖拽过程不进 undo 栈。
      const facilityDrag = facilityDragRef.current;
      if (facilityDrag) {
        const hit = eventPlanPoint(event);
        if (!hit) return;
        if (Math.hypot(hit.px.x - facilityDrag.startPx.x, hit.px.y - facilityDrag.startPx.y) > CLICK_MAX_MOVE_PX) {
          facilityDrag.moved = true;
        }
        if (facilityDrag.moved) {
          facilityDrag.preview = facilityDragPreview(facilityDrag, hit.pt, event.shiftKey);
          setEditMessage(null);
          draw();
        }
        return;
      }
      // H2-d：拖动出入口节点 → 引用路线端点随动预览（松手提交）。
      if (dragZoneVertexRef.current) {
        const hit = eventPlanPoint(event);
        if (!hit) return;
        const drag = dragZoneVertexRef.current;
        const base = zoneDragPreviewRef.current?.polygon ?? planRef.current.zones.find(z => z.id === drag.zoneId)?.polygon;
        if (!base) return;
        const result = moveRingVertex(base, drag.index, snapPointToGrid(hit.pt, currentViewport()));
        if (result.ok) {
          zoneDragPreviewRef.current = { zoneId: drag.zoneId, polygon: result.value };
          setEditMessage(null);
          draw();
        } else {
          setEditMessage(result.issue.message);
        }
        return;
      }
      if (dragNodeRef.current) {
        const hit = eventPlanPoint(event);
        if (!hit) return;
        const down = downPxRef.current;
        if (down && Math.hypot(hit.px.x - down.x, hit.px.y - down.y) > CLICK_MAX_MOVE_PX) {
          dragNodeRef.current.moved = true;
        }
        const node = planRef.current.nodes.find(n => n.id === dragNodeRef.current?.id);
        if (!node) return;
        const result = movePlanNode(node, hit.pt, planRef.current.routes);
        if (result.ok) {
          nodeDragPreviewRef.current = result.value;
          setEditMessage(null);
          draw();
        } else {
          setEditMessage(result.issue.message);
        }
        return;
      }
      if (!panRef.current) return;
      pan(event.clientX - panRef.current.x, event.clientY - panRef.current.y);
      panRef.current = { x: event.clientX, y: event.clientY };
      return;
    }
    if (activeMode === 'boundary-vertex' && dragVertexRef.current !== null) {
      const hit = eventPlanPoint(event);
      if (!hit) return;
      const result = moveRingVertex(
        previewRingRef.current ?? planRef.current.boundary,
        dragVertexRef.current,
        snapPointToGrid(hit.pt, currentViewport()),
      );
      if (result.ok) {
        setPreviewRing(result.value);
        setEditMessage(null);
      } else {
        // 非法位置不预览（吸附回上一合法位置），给原因。
        setEditMessage(result.issue.message);
      }
      return;
    }
    // H2-c：放设施幽灵跟随鼠标（占地预览）。
    if (activeMode === 'facility' && facilityTemplateRef.current) {
      const hit = eventPlanPoint(event);
      if (!hit) return;
      const ghost = ghostPointRef.current;
      if (!ghost || ghost.x !== hit.pt.x || ghost.y !== hit.pt.y) {
        ghostPointRef.current = hit.pt;
        draw();
      }
      return;
    }
    // H2-d：画动线橡皮筋 / 放节点幽灵跟随鼠标。
    if (activeMode === 'route') {
      const hit = eventPlanPoint(event);
      if (!hit) return;
      routeCursorRef.current = hit.pt;
      draw();
      return;
    }
    // H3-a：测量临时读数跟指针；2026-11-11 拖拽式测量（距离拉线 / 面积矩形 / 路径手绘）。
    if (activeMode === 'measure') {
      const hit = eventPlanPoint(event);
      if (!hit) return;
      const drag = measureDragRef.current;
      if (drag) {
        if (!drag.active && Math.hypot(hit.px.x - drag.startPx.x, hit.px.y - drag.startPx.y) > CLICK_MAX_MOVE_PX) {
          drag.active = true;
          // 拖拽开始即开新测量（覆盖单击已收的半成品点）。
          measureDraftRef.current = measureKindRef.current === 'area' ? [] : [{ x: drag.startPt.x, y: drag.startPt.y }];
          setMeasureDraftCount(measureDraftRef.current.length);
        }
        if (drag.active) {
          const kind = measureKindRef.current;
          const prevCount = measureDraftRef.current.length;
          if (kind === 'area') {
            measureDraftRef.current = measureRectPoints(drag.startPt, hit.pt, event.shiftKey);
          } else if (kind === 'path') {
            const draft = measureDraftRef.current;
            const lastPx = planPointToPixel(draft[draft.length - 1]!, currentViewport());
            if (Math.hypot(hit.px.x - lastPx.x, hit.px.y - lastPx.y) >= MEASURE_FREEHAND_SAMPLE_PX && draft.length < PLAN_MEASURE_MAX_VERTICES) {
              measureDraftRef.current = [...draft, { x: hit.pt.x, y: hit.pt.y }];
            }
          }
          // 面积拖拽：指针不进读数（预览环就是矩形本身，跟指针会多算一个点）。
          measureCursorRef.current = kind === 'area' ? null : hit.pt;
          if (measureDraftRef.current.length !== prevCount) setMeasureDraftCount(measureDraftRef.current.length);
          draw();
          return;
        }
      }
      measureCursorRef.current = hit.pt;
      draw();
      return;
    }
    if (activeMode === 'node') {
      const hit = eventPlanPoint(event);
      if (!hit) return;
      const ghost = nodeGhostRef.current;
      if (!ghost || ghost.x !== hit.pt.x || ghost.y !== hit.pt.y) {
        nodeGhostRef.current = hit.pt;
        draw();
      }
    }
    if (activeMode === 'worker') {
      const hit = eventPlanPoint(event);
      if (!hit) return;
      const ghost = workerGhostRef.current;
      if (!ghost || ghost.x !== hit.pt.x || ghost.y !== hit.pt.y) {
        workerGhostRef.current = hit.pt;
        draw();
      }
    }
    // 2026-11-11 用户指令：形状模式指针跟踪 + 拖拽实时预览（rect 对角 / line 两端 / circle 半径）。
    if (activeMode === 'shape') {
      const hit = eventPlanPoint(event);
      if (!hit) return;
      annotateCursorRef.current = hit.pt;
      const drag = annotateDragRef.current;
      if (drag) {
        if (!drag.active && Math.hypot(hit.px.x - drag.startPx.x, hit.px.y - drag.startPx.y) > CLICK_MAX_MOVE_PX) {
          drag.active = true;
        }
        if (drag.active) {
          annotateDraftRef.current = [{ x: drag.startPt.x, y: drag.startPt.y }, { x: hit.pt.x, y: hit.pt.y }];
          setAnnotateDraftCount(2);
          draw();
          return;
        }
      }
      draw();
      return;
    }
  }

  function handleStageMouseUp(event: React.MouseEvent) {
    const activeMode = modeRef.current;
    if (activeMode === 'select') {
      // 2026-11-12 B2 框选松手：组提交 > 单件提交 > marquee 命中入组 / 单击清空。
      const down = downPxRef.current;
      downPxRef.current = null;
      setDragging(false);
      const groupDrag = groupDragRef.current;
      groupDragRef.current = null;
      if (groupDrag) {
        if (groupDrag.moved && groupDrag.preview && onPlanChange) {
          const previewIds = new Set(groupDrag.preview.map(p => p.id));
          commitPlan({
            ...planRef.current,
            facilities: planRef.current.facilities.map(f => (previewIds.has(f.id) ? groupDrag.preview!.find(p => p.id === f.id) ?? f : f)),
          });
          setEditMessage(groupDrag.kind === 'move' ? `已整组移动 ${groupDrag.items.length} 件设施。` : `已整组缩放 ${groupDrag.items.length} 件设施。`);
        }
        draw();
        return;
      }
      const facilityDrag = facilityDragRef.current;
      if (facilityDrag) {
        facilityDragRef.current = null;
        if (facilityDrag.moved && onPlanChange && facilityDrag.preview) {
          const preview = facilityDrag.preview;
          commitPlan({ ...planRef.current, facilities: planRef.current.facilities.map(f => (f.id === preview.id ? preview : f)) });
          selectFacility(preview.id);
          setInfoTab('inventory');
          setEditMessage(
            facilityDrag.kind === 'move'
              ? `「${preview.name}」已移动。`
              : facilityDrag.kind === 'rotate'
                ? `「${preview.name}」已旋转到 ${Math.round(preview.rotationDeg)}°。`
                : `「${preview.name}」尺寸改为 ${preview.size.width.toFixed(1)} × ${preview.size.depth.toFixed(1)} m。`,
          );
          return;
        }
      }
      const marquee = marqueeRectRef.current;
      marqueeRectRef.current = null;
      if (marquee && down && Math.hypot(marquee.curPx.x - marquee.startPx.x, marquee.curPx.y - marquee.startPx.y) > CLICK_MAX_MOVE_PX) {
        // 拖出了矩形 → 框选（中心或足迹顶点入矩形；单件回落单选，多件成组）。
        if (!onPlanChange || layerLocked('facility')) return;
        const rect = marqueePlanRect(marquee, currentViewport());
        const hits = viewPlan().facilities.filter(f => facilityInRect(f, rect));
        // shift+框选 = 与现有组选取并集（OnePlan 同语义）；无 shift = 替换。
        const base = event.shiftKey ? multiSelectedFacilityIdsRef.current : [];
        const merged = Array.from(new Set([...base, ...hits.map(f => f.id)]));
        if (merged.length === 1) {
          selectFacility(merged[0]!);
          setInfoTab('inventory');
        } else if (merged.length > 1) {
          selectFacilityGroup(merged);
          setEditMessage(`已框选 ${merged.length} 件设施。`);
        } else {
          clearMultiSelection(false);
          selectFacility(null);
          selectZone(null);
          selectAnnotation(null);
        }
        draw();
        return;
      }
      // 单击（没拖出矩形）：mousedown 已处理命中件，这里只兜底「空白单击=清空全部选中」。
      if (down) {
        const hit = eventPlanPoint(event);
        if (!hit || Math.hypot(hit.px.x - down.x, hit.px.y - down.y) <= CLICK_MAX_MOVE_PX) {
          const hitFacility = hit && !layerLocked('facility')
            ? [...viewPlan().facilities].reverse().find(f => facilityContainsPoint(hit.pt, f))
            : null;
          if (!hitFacility) {
            clearMultiSelection(false);
            selectFacility(null);
            selectZone(null);
            selectAnnotation(null);
            draw();
          }
        }
      }
      return;
    }
    if (activeMode === 'view') {
      const down = downPxRef.current;
      downPxRef.current = null;
      panRef.current = undefined;
      setDragging(false);
      // P2-i：设施拖拽松手——确实拖动过 → 提交预览（移动/旋转/改尺寸一条 undo）；
      // 没拖动则当单击，继续走下面的既有选中顺序。
      const facilityDrag = facilityDragRef.current;
      if (facilityDrag) {
        facilityDragRef.current = null;
        if (facilityDrag.moved && onPlanChange) {
          const preview = facilityDrag.preview;
          const current = planRef.current;
          commitPlan({ ...current, facilities: current.facilities.map(f => (f.id === preview.id ? preview : f)) });
          selectFacility(preview.id);
          setInfoTab('inventory');
          setEditMessage(
            facilityDrag.kind === 'move'
              ? `「${preview.name}」已移动。`
              : facilityDrag.kind === 'rotate'
                ? `「${preview.name}」已旋转到 ${Math.round(preview.rotationDeg)}°。`
                : `「${preview.name}」尺寸改为 ${preview.size.width.toFixed(1)} × ${preview.size.depth.toFixed(1)} m。`,
          );
          return;
        }
      }
      // P2-j：分区顶点拖动松手——有预览才提交（一条 undo），否则视为未改动。
      const zoneDrag = dragZoneVertexRef.current;
      if (zoneDrag) {
        dragZoneVertexRef.current = null;
        const preview = zoneDragPreviewRef.current;
        zoneDragPreviewRef.current = null;
        if (preview && onPlanChange) {
          const current = planRef.current;
          const zone = current.zones.find(z => z.id === preview.zoneId);
          if (zone) {
            const issue = zonePolygonIssue(zone, preview.polygon, current);
            if (issue) {
              setEditMessage(issue.message);
            } else {
              commitPlan({
                ...current,
                zones: current.zones.map(z => (z.id === zone.id ? { ...z, polygon: preview.polygon } : z)),
              });
              selectZone(zone.id);
              setEditMessage(`「${zone.name}」形状已更新。`);
            }
            draw();
          }
        }
        return;
      }
      // H2-d：拖动节点松手：确实拖动过 → 提交随动结果；否则视为点选该节点。
      if (dragNodeRef.current) {
        const drag = dragNodeRef.current;
        const preview = nodeDragPreviewRef.current;
        dragNodeRef.current = null;
        nodeDragPreviewRef.current = null;
        if (drag.moved && preview) {
          const current = planRef.current;
          commitPlan({
            ...current,
            nodes: current.nodes.map(n => (n.id === preview.node.id ? preview.node : n)),
            routes: current.routes.map(r => preview.routes.find(rr => rr.id === r.id) ?? r),
          });
          selectNode(preview.node.id);
          setEditMessage(`出入口已移动；引用它的动线端点已随动。`);
          return;
        }
        selectNode(drag.id);
        return;
      }
      // H2-c/H2-d：浏览模式单击命中即选中（冲突标记 > 节点 > 人员 > 路线 > 设施），空白取消全部选中。
      if (down && onPlanChange) {
        const hit = eventPlanPoint(event);
        if (hit && Math.hypot(hit.px.x - down.x, hit.px.y - down.y) <= CLICK_MAX_MOVE_PX) {
          // H3-b：冲突/缺失标记恒在业务层之上，先于实体命中；点击定位到关联动线。
          const conflict = nearestConflictAt(hit.px);
          if (conflict) {
            const related = conflict.routeIds[0];
            if (related) {
              selectRoute(related);
              setEditMessage(`已定位「${PLAN_CONFLICT_CATEGORY_LABELS[conflict.category]}」：${conflict.message}`);
            } else {
              setEditMessage(`${PLAN_CONFLICT_CATEGORY_LABELS[conflict.category]}：${conflict.message}`);
            }
            setInfoTab('inventory');
            return;
          }
          const hitNode = layerLocked('node') ? null : nearestNodeIdAt(hit.px);
          if (hitNode) { selectNode(hitNode); setInfoTab('inventory'); return; }
          const hitWorker = layerLocked('worker') ? null : nearestWorkerIdAt(hit.px);
          if (hitWorker) { selectWorker(hitWorker); setInfoTab('inventory'); return; }
          const hitRoute = layerLocked('route') ? null : nearestRouteIdAt(hit.px);
          if (hitRoute) { selectRoute(hitRoute); setInfoTab('inventory'); return; }
          // 2026-11-11 用户指令：标注画在业务层之上，点选先于设施/分区（锁定标注层不响应）。
          const hitAnnotation = layerLocked('annotate') ? null : nearestAnnotationIdAt(hit.pt);
          if (hitAnnotation) { selectAnnotation(hitAnnotation); setInfoTab('inventory'); return; }
          const hitFacility = layerLocked('facility')
            ? null
            : [...viewPlan().facilities].reverse().find(f => facilityContainsPoint(hit.pt, f));
          if (hitFacility) {
            selectFacility(hitFacility.id);
            setInfoTab('inventory');
            return;
          }
          // P2-j：设施没命中再看分区（点中分区体 → 选中，之后可拖它的顶点改形）。
          const hitZone = layerLocked('zone')
            ? null
            : [...viewPlan().zones].reverse().find(z => planPointInRing(hit.pt, z.polygon));
          if (hitZone) {
            selectZone(hitZone.id);
            setEditMessage(`已选中分区「${hitZone.name}」：拖白色顶点改形状。`);
            setInfoTab('inventory');
            return;
          }
          selectFacility(null);
          selectZone(null);
          selectAnnotation(null);
        }
      }
      return;
    }
    if (activeMode === 'boundary-vertex') {
      if (dragVertexRef.current !== null && previewRingRef.current && onPlanChange) {
        commitPlan({ ...planRef.current, boundary: previewRingRef.current });
        setEditMessage('边界顶点已更新。');
      }
      dragVertexRef.current = null;
      setPreviewRing(null);
      return;
    }
    // 2026-11-11 拖拽式测量松手：距离拉线 / 面积矩形 / 路径手绘直接固定；太短的拖拽提示并丢弃。
    if (activeMode === 'measure') {
      const drag = measureDragRef.current;
      measureDragRef.current = null;
      if (drag?.active) {
        const discard = (message: string) => {
          measureDraftRef.current = [];
          measureCursorRef.current = null;
          setMeasureDraftCount(0);
          setEditMessage(message);
          draw();
        };
        const hit = eventPlanPoint(event);
        if (!hit) {
          discard('拖拽结束点不在画布内，已丢弃这次拖拽测量。');
          return;
        }
        const kind = measureKindRef.current;
        if (kind === 'distance') {
          if (planPointDistanceM(drag.startPt, hit.pt) < PLAN_MIN_VERTEX_GAP_M) {
            discard('拖出的距离太短（<0.5 m），按住拖长一点再松手。');
            return;
          }
          measureDraftRef.current = [{ x: drag.startPt.x, y: drag.startPt.y }, { x: hit.pt.x, y: hit.pt.y }];
        } else if (kind === 'area') {
          const w = Math.abs(hit.pt.x - drag.startPt.x);
          const h = Math.abs(hit.pt.y - drag.startPt.y);
          if (w < PLAN_MIN_VERTEX_GAP_M || h < PLAN_MIN_VERTEX_GAP_M) {
            discard('拖出的区域太小（宽和高都要 ≥0.5 m），按住拖大一点再松手。');
            return;
          }
          measureDraftRef.current = measureRectPoints(drag.startPt, hit.pt, event.shiftKey);
        } else {
          const draft = measureDraftRef.current;
          const last = draft[draft.length - 1];
          if (last && planPointDistanceM(last, hit.pt) >= PLAN_MIN_VERTEX_GAP_M && draft.length < PLAN_MEASURE_MAX_VERTICES) {
            measureDraftRef.current = [...draft, { x: hit.pt.x, y: hit.pt.y }];
          }
          if (measureDraftRef.current.length < 2) {
            discard('拖出的路径太短，按住拖长一点再松手。');
            return;
          }
        }
        finishMeasure();
        return;
      }
    }
    // 2026-11-11 用户指令：形状拖拽松手固定（rect 对角 / line 两端 / circle 中心+半径）；太小由校验层提示。
    if (activeMode === 'shape') {
      const drag = annotateDragRef.current;
      annotateDragRef.current = null;
      if (drag?.active) {
        const hit = eventPlanPoint(event);
        if (!hit) {
          annotateDraftRef.current = [];
          annotateCursorRef.current = null;
          setAnnotateDraftCount(0);
          setEditMessage('拖拽结束点不在画布内，已丢弃这次形状。');
          draw();
          return;
        }
        finishShape([{ x: drag.startPt.x, y: drag.startPt.y }, { x: hit.pt.x, y: hit.pt.y }]);
        return;
      }
    }
    // 绘制模式：位移小于阈值的抬起才算单击加顶点。
    const hit = eventPlanPoint(event);
    const down = downPxRef.current;
    downPxRef.current = null;
    if (!hit || !down) return;
    if (Math.hypot(hit.px.x - down.x, hit.px.y - down.y) > CLICK_MAX_MOVE_PX) return;
    handleDrawClick(hit.px, hit.pt);
  }

  function handleStageDoubleClick(event: { preventDefault(): void; clientX: number; clientY: number }) {
        // P2-l（用户 m05374）：画区域/边界时双击左键 = 完成绘制（少于 3 点不闭合）。
        if (modeRef.current === 'zone' || modeRef.current === 'boundary') {
          pointerConsumedRef.current = true;
          event.preventDefault();
          if (draftRef.current.length >= 3) closeDraft();
          else setEditMessage(`至少要 3 个节点才能闭合（当前 ${draftRef.current.length} 个）。`);
          return;
        }
        // H2-d：画动线模式下双击提交；H3-a：测量模式下双击提交（面积/路径）。
        if (modeRef.current === 'route') {
          pointerConsumedRef.current = true;
          event.preventDefault();
          finishRoute();
        } else if (modeRef.current === 'measure') {
          pointerConsumedRef.current = true;
          event.preventDefault();
          finishMeasure();
        } else if (modeRef.current === 'view') {
          // P2-j：双击顶点删点、双击边界线插点（两下都是「改几何」，不进其它手势）。
          const hit = eventPlanPoint(event);
          if (!hit || !onPlanChange || !facilityDirectEditable()) return;
          if (layerLocked('boundary')) {
            setEditMessage('边界图层已锁定，先解锁再改。');
            return;
          }
          pointerConsumedRef.current = true;
          event.preventDefault();
          const vertex = nearestBoundaryVertexIndex(hit.px);
          if (vertex !== null) removeBoundaryVertexAt(vertex);
          else insertBoundaryVertexAt(hit.px);
        }
  }

  function handleStageMouseLeave() {
    panRef.current = undefined;
    setDragging(false);
    downPxRef.current = null;
    dragVertexRef.current = null;
    setPreviewRing(null);
    ghostPointRef.current = null;
    routeCursorRef.current = null;
    nodeGhostRef.current = null;
    workerGhostRef.current = null;
    measureCursorRef.current = null;
    // 拖拽测量中离开画布：丢弃拖拽会话（已收的单击草稿点保留，与既有半成品口径一致）。
    measureDragRef.current = null;
    // 2026-11-11 用户指令：形状拖拽离开画布同样丢弃会话（拖拽预览草稿一并清；单击已收的点保留）。
    if (annotateDragRef.current?.active) {
      annotateDraftRef.current = [];
      setAnnotateDraftCount(0);
    }
    annotateDragRef.current = null;
    annotateCursorRef.current = null;
    // 节点拖动中离开画布：预览不提交，回弹原位。
    dragNodeRef.current = null;
    nodeDragPreviewRef.current = null;
    // P2-i：设施拖拽中离开画布同样丢弃预览（不提交）。
    facilityDragRef.current = null;
    // P2-j：分区顶点拖动中离开画布同样丢弃预览。
    dragZoneVertexRef.current = null;
    zoneDragPreviewRef.current = null;
    draw();
  }

  const readOnly = !onPlanChange;
  // 2026-11-11 图层：面板统计/清单/选中全部以当前层视图为准（boundary/levels 等共享字段原样在）。
  const levelView = filterPlanByLevel(plan, activeLevelId);
  const levelList = planLevels(plan);
  const activeLevelIndex = Math.max(0, levelList.findIndex(level => level.id === activeLevelId));
  const activeLevelName = levelList[activeLevelIndex]?.name ?? '图层 1';
  const selectedFacility = selectedFacilityId ? plan.facilities.find(f => f.id === selectedFacilityId) ?? null : null;
  const selectedRoute = selectedRouteId ? plan.routes.find(r => r.id === selectedRouteId) ?? null : null;
  const selectedNode = selectedNodeId ? plan.nodes.find(n => n.id === selectedNodeId) ?? null : null;
  const selectedWorker = selectedWorkerId ? plan.workers.find(w => w.id === selectedWorkerId) ?? null : null;
  // 2026-11-11 用户指令：右上角浮窗「属性」页签的角标 = 当前同时选中的物件数（点选后自动切过来）。
  const selectionInspectorCount = (selectedZoneId ? 1 : 0) + (selectedFacility ? 1 : 0) + (selectedRoute ? 1 : 0) + (selectedNode ? 1 : 0) + (selectedWorker ? 1 : 0) + (multiSelectedFacilityIds.length >= 2 ? 1 : 0);
  useEffect(() => {
    if (selectionInspectorCount === 0) return;
    // 选中物件 → 只把「属性」卡展开（测量/标注卡的开合不受影响）。
    setInspectorPanel('selection', true);
  }, [selectionInspectorCount]);
  // 2026-11-12 换页守卫：选中一变就回属性页并收起手风琴，别把 Repeat 页/展开态挂到另一件物件上。
  useEffect(() => {
    setFacilityCardMode('props');
    setFacilitySetupOpen(false);
    setFacilityNotesOpen(false);
  }, [selectedFacility?.id]);
  // 2026-11-12 B2 组选与单选互斥：任一单选实体出现即清组选（组选流程自身不经这些 setter）。
  useEffect(() => {
    if (multiSelectedFacilityIdsRef.current.length === 0) return;
    if (selectedFacilityId || selectedZoneId || selectedRouteId || selectedNodeId || selectedWorkerId || selectedAnnotationId) {
      multiSelectedFacilityIdsRef.current = [];
      setMultiSelectedFacilityIds([]);
    }
  }, [selectedFacilityId, selectedZoneId, selectedRouteId, selectedNodeId, selectedWorkerId, selectedAnnotationId]);

  /* ---------------- H3-c 规划信息面板（全部现算） ---------------- */
  // 冲突条目按状态着色（冲突红/缺失橙/待核实灰，tokens 同源）——信息卡「问题」页签与画布标记共用口径。
  const conflictTextColors: Record<PlanConflictIssue['status'], string> = {
    conflict: PLANNING_CONFLICT_COLORS.conflict,
    missing: PLANNING_CONFLICT_COLORS.missing,
    unverified: PLANNING_CONFLICT_COLORS.unverified,
  };
  const overviewStats = planOverviewStats(levelView);
  const visibleCounts = {
    zone: layerState.zone ? levelView.zones.length : 0,
    facility: layerState.facility ? levelView.facilities.length : 0,
    route: layerState.route ? levelView.routes.length : 0,
    node: layerState.access ? levelView.nodes.length : 0,
    worker: layerState.worker ? levelView.workers.length : 0,
    measurement: layerState.measure ? (levelView.measurements ?? []).length : 0,
    annotation: layerState.annotate ? (levelView.annotations ?? []).length : 0,
  };
  const inventoryRows = buildPlanInventory(levelView);
  const filteredInventoryRows = filterPlanInventory(inventoryRows, { kind: invKind, zone: invZone, issuesOnly: invIssuesOnly });
  const legendGroups = buildPlanLegend(levelView);
  const anchorById = new Map(inventoryRows.map(row => [row.id, row.anchor] as const));
  const infoIssues: PlanLocatableIssue[] = [
    ...conflictIssues.map(item => ({
      key: `c-${item.key}`,
      text: `${item.status === 'conflict' ? '⚠' : item.status === 'missing' ? '缺' : '核'} ${PLAN_CONFLICT_CATEGORY_LABELS[item.category]}：${item.message}`,
      color: conflictTextColors[item.status],
      anchor: item.at,
      routeId: item.routeIds[0],
      facilityId: item.facilityId,
    })),
    ...issues.map((item, i) => ({
      key: `z-${item.zoneId}-${item.issue.code}-${i}`,
      text: `${item.zoneName}：${item.issue.message}`,
      anchor: anchorById.get(item.zoneId) ?? { x: 0, y: 0 },
    })),
    ...facilityIssues.map((item, i) => ({
      key: `f-${item.facilityId}-${i}`,
      text: `${item.facilityName}：${item.issue.message}`,
      anchor: anchorById.get(item.facilityId) ?? { x: 0, y: 0 },
      facilityId: item.facilityId,
    })),
    ...nodeIssues.map((item, i) => ({
      key: `n-${item.nodeId}-${i}`,
      text: `出入口「${item.nodeName}」：${item.issue.message}`,
      anchor: anchorById.get(item.nodeId) ?? { x: 0, y: 0 },
      nodeId: item.nodeId,
    })),
    ...workerIssues.map((item, i) => ({
      key: `w-${item.workerId}-${i}`,
      text: `人员「${item.workerRole}」：${item.issue.message}`,
      anchor: anchorById.get(item.workerId) ?? { x: 0, y: 0 },
      workerId: item.workerId,
    })),
  ];
  const inventoryRowSelected = (row: PlanInventoryRow): boolean =>
    (row.kind === 'zone' && row.id === selectedZoneId)
    || (row.kind === 'facility' && row.id === selectedFacilityId)
    || (row.kind === 'route' && row.id === selectedRouteId)
    || (row.kind === 'node' && row.id === selectedNodeId)
    || (row.kind === 'worker' && row.id === selectedWorkerId)
    // 2026-11-11 用户指令：标注行选中高亮（与画布白描边同步）。
    || (row.kind === 'annotation' && row.id === selectedAnnotationId);
  // 2026-11-11 图层卡 OnePlan Placed Objects：按「kind+类型名」分组的文件夹（measurement 单独一个恒在文件夹渲染）。
  const placedFolderRows = (() => {
    const folders: { key: string; kind: PlanInventoryKind; label: string; rows: PlanInventoryRow[] }[] = [];
    for (const row of inventoryRows) {
      if (row.kind === 'measurement') continue;
      const key = `${row.kind}:${row.typeLabel}`;
      const existing = folders.find(f => f.key === key);
      if (existing) existing.rows.push(row);
      else folders.push({ key, kind: row.kind, label: row.typeLabel, rows: [row] });
    }
    return folders;
  })();
  // 面板内点击不再冒泡到画布（否则勾选/选模板/点按钮会在面板对应画布位置误加草稿点或放置实体）。
  const stopPanelMouse = (event: React.MouseEvent) => event.stopPropagation();
  // 两张卡各有宿主：图层卡看 layerPanelHost，规划信息卡看 infoPanelHost——
  // 之前共用一个开关，规划信息的宿主（Bingo 里）缺席时会用「外挂态」样式却渲染在画布流里，拉成顶部横条。
  const panelInline = !!layerPanelHost;
  const infoPanelInline = !!infoPanelHost;
  // 2026-11-11 OnePlan 纯度：有宿主时内容直接铺在左栏面板里（去卡片壳，高度交给宿主滚动）——
  // 用户实测「多做了一层外框、高度受限」；壳只保留给无宿主的浮动兜底（演示页/独立工作台）。
  const hostedPanelStyle: React.CSSProperties = {
    position: 'relative',
    zIndex: 3,
    minWidth: 0,
    color: PLANNING_SURFACE.panelText,
    fontSize: PLANNING_TYPOGRAPHY.panel,
    pointerEvents: 'auto',
  };
  const panelStyle: React.CSSProperties = panelInline ? hostedPanelStyle : {
    position: 'absolute',
    // 2026-11-12 用户反馈「卡片挡着侧边了」：回落浮层让开右轨圆钮列（rail 右缘 12 + 宽 44 + 间距 12），
    // 与属性浮窗的 right:72 同一让位口径。
    right: 68,
    top: PLANNING_SPACING.sm,
    zIndex: 3,
    background: PLANNING_SURFACE.panelBg,
    border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
    borderRadius: PLANNING_RADIUS.md,
    padding: `${PLANNING_SPACING.sm}px ${PLANNING_SPACING.md}px`,
    color: PLANNING_SURFACE.panelText,
    fontSize: PLANNING_TYPOGRAPHY.panel,
    minWidth: 168,
    maxWidth: 240,
    pointerEvents: 'auto',
    maxHeight: 'calc(100% - 16px)',
    overflowY: 'auto',
  };
  const sectionTitle: React.CSSProperties = { marginTop: PLANNING_SPACING.sm, marginBottom: PLANNING_SPACING.xs, fontWeight: 600, opacity: 0.9 };
  const infoPanelStyle: React.CSSProperties = infoPanelInline ? {
    position: 'relative',
    zIndex: 3,
    background: PLANNING_SURFACE.panelBg,
    border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
    borderRadius: PLANNING_RADIUS.md,
    padding: `${PLANNING_SPACING.sm}px ${PLANNING_SPACING.md}px`,
    color: PLANNING_SURFACE.panelText,
    fontSize: PLANNING_TYPOGRAPHY.panel,
    minWidth: 0,
    pointerEvents: 'auto',
  } : {
    position: 'absolute',
    left: PLANNING_SPACING.sm,
    // 独立工作台左上角还浮着「地点搜索」条（workspace-place-search，z-index 6，高 38px、底边 y≈54），
    // 规划信息卡原来也在 top:8，页签行（y≈40-66）被它整块压住、清单页签点不到——下移让出这条搜索栏。
    top: 64,
    zIndex: 3,
    background: PLANNING_SURFACE.panelBg,
    border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
    borderRadius: PLANNING_RADIUS.md,
    padding: `${PLANNING_SPACING.sm}px ${PLANNING_SPACING.md}px`,
    color: PLANNING_SURFACE.panelText,
    fontSize: PLANNING_TYPOGRAPHY.panel,
    minWidth: 200,
    maxWidth: 260,
    pointerEvents: 'auto',
    maxHeight: 'calc(100% - 72px)',
    overflowY: 'auto',
  };
  const inventoryRowButtonStyle = (selected: boolean): React.CSSProperties => ({
    all: 'unset',
    cursor: 'pointer',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: PLANNING_SPACING.xs,
    width: '100%',
    padding: '3px 4px',
    marginTop: 2,
    borderRadius: PLANNING_RADIUS.sm,
    border: selected ? `1px solid ${PLANNING_SURFACE.selectedBorder}` : '1px solid transparent',
    background: selected ? PLANNING_SURFACE.selectedBg : 'transparent',
    color: PLANNING_SURFACE.panelText,
    fontSize: PLANNING_TYPOGRAPHY.row,
    textAlign: 'left',
  });
  const issueButtonStyle = (color?: string): React.CSSProperties => ({
    all: 'unset',
    cursor: 'pointer',
    color: color ?? PLANNING_SURFACE.panelText,
    fontSize: PLANNING_TYPOGRAPHY.row,
  });
  const modeButtonStyle = (active: boolean): React.CSSProperties => ({
    all: 'unset',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 7px',
    borderRadius: PLANNING_RADIUS.sm,
    border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
    background: active ? PLANNING_SURFACE.activeBg : 'transparent',
    color: PLANNING_SURFACE.panelText,
    fontSize: PLANNING_TYPOGRAPHY.row,
  });
  const zoneRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.xs };
  const selectStyle: React.CSSProperties = { background: PLANNING_SURFACE.fieldBg, color: PLANNING_SURFACE.panelText, border: `1px solid ${PLANNING_SURFACE.panelBorder}`, borderRadius: PLANNING_RADIUS.sm, fontSize: PLANNING_TYPOGRAPHY.row, padding: '2px 4px' };
  const UndoIcon = planningIcon('undo-2');
  const ViewModeIcon = planningIcon(PLANNING_EDIT_MODE_ICONS.view);
  const SelectModeIcon = planningIcon(PLANNING_EDIT_MODE_ICONS.select);
  const NodeToolIcon = planningIcon('door-open');
  const LibraryFooterIcon = planningIcon('layers');
  const LevelRowIcon = planningIcon('layers');
  /** 编辑器模式（有面板宿主）下，测量/标注 / 选中编辑合并进画布右上角浮窗。 */
  const outdoorInspectorActive = !!(!readOnly && (measurePanelHost || annotatePanelHost));

  /** 图层/已放置树实体行的图标：分区用分区实际颜色方块，其余用图层色圆点。 */
  const renderLayerEntityIcon = (row: PlanInventoryRow): React.ReactNode => {
    if (row.kind === 'zone') {
      const zone = levelView.zones.find(z => z.id === row.id);
      const color = zone?.color ?? PLANNING_ZONE_COLORS[zone?.semantic ?? 'audience'];
      return <span aria-hidden style={{ width: 16, height: 16, flex: '0 0 auto', borderRadius: 4, background: color, boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.55)' }} />;
    }
    return <span aria-hidden style={{ width: 12, height: 12, flex: '0 0 auto', borderRadius: 999, background: PLACED_KIND_COLORS[row.kind] }} />;
  };

  /* 2026-11-11 用户指令：测量区独立成块——有 measurePanelHost 时 portal 到图层行下方、
     添加物件/已放置物件页签上方（两页签下常驻）；无宿主时回落「已放置物件」面板内（旧形态）。 */
  const measureZone = !readOnly ? (
    <div
      data-testid="measure-zone"
      style={{ ...(measurePanelHost ? {} : { marginTop: PLANNING_SPACING.xs }), paddingBottom: PLANNING_SPACING.xs, borderBottom: `1px solid ${PLANNING_SURFACE.panelBorder}` }}
    >
      {/* 浮窗自带页签标题，搬进右上角后不再重复渲染这一行。 */}
      {!outdoorInspectorActive && (
        <div style={{ display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs }}>
          <span aria-hidden style={{ width: 12, height: 12, flex: '0 0 auto', borderRadius: 999, background: PLANNING_LAYER_COLORS.measure }} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>测量</span>
          <span style={{ flex: 1 }} />
          <span style={{ opacity: 0.6, fontSize: 11 }}>{levelView.measurements?.length ?? 0}</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.xs }}>
        {(['distance', 'area', 'path'] as const).map(k => (
          <button
            key={k}
            type="button"
            aria-pressed={mode === 'measure' && measureKind === k}
            data-testid={`measure-type-${k}`}
            style={{ ...modeButtonStyle(mode === 'measure' && measureKind === k), flex: 1, justifyContent: 'center' }}
            onClick={() => {
              measureKindRef.current = k;
              setMeasureKind(k);
              measureDraftRef.current = [];
              measureCursorRef.current = null;
              setMeasureDraftCount(0);
              setEditMessage(null);
              draw();
              setMode('measure');
            }}
          >
            {planMeasurementKindLabels[k]}
          </button>
        ))}
      </div>
      {/* 2026-11-11 拖拽式测量引导：拖拽为快速模式，单击保留精细逐点模式。 */}
      <div style={{ marginTop: PLANNING_SPACING.xs, opacity: 0.72, fontSize: 12 }}>
        按住拖动：距离拉线 · 面积矩形（Shift 正方形）· 路径手绘；单击 = 逐点精细测量。
      </div>
      {mode === 'measure' && measureKind !== 'distance' && (
        <button
          type="button"
          data-testid="measure-finish"
          disabled={measureKind === 'area' ? measureDraftCount < 3 : measureDraftCount < 2}
          style={{ ...modeButtonStyle(false), marginTop: PLANNING_SPACING.xs, width: '100%', justifyContent: 'center', opacity: (measureKind === 'area' ? measureDraftCount < 3 : measureDraftCount < 2) ? 0.5 : 1 }}
          onClick={() => finishMeasure()}
        >
          完成测量（{measureDraftCount} 点）
        </button>
      )}
      {(levelView.measurements?.length ?? 0) > 0 && levelView.measurements!.map(m => renderOneplanItemRow({
        key: `measure-${m.id}`,
        testId: `layer-entity-measurement-${m.id}`,
        label: `${m.name} = ${m.kind === 'area' ? formatAreaM2(measureValue(m)) : formatLengthM(measureValue(m))}`,
        active: false,
        onClick: () => {
          const row = inventoryRows.find(r => r.kind === 'measurement' && r.id === m.id);
          if (row) locateRow(row);
        },
        onContextMenu: event => { event.preventDefault(); deleteMeasurement(m.id); },
        title: '点击定位到地图；右键或 Delete 删除',
        icon: <span aria-hidden style={{ width: 12, height: 12, flex: '0 0 auto', borderRadius: 999, background: PLACED_KIND_COLORS.measurement }} />,
        trailing: (
          <button
            type="button"
            aria-label={`删除测量「${m.name}」`}
            className="sc-danger-quiet"
            style={{ cursor: 'pointer', fontSize: 11 }}
            onClick={event => { event.stopPropagation(); deleteMeasurement(m.id); }}
          >
            删除
          </button>
        ),
      }))}
    </div>
  ) : null;

  /* 2026-11-11 用户指令：标注区独立成块（测量区下方）——文本 T + 形状（形状态出四类型选项），
     有 annotatePanelHost 时 portal 过去（两页签下常驻）；无宿主回落「已放置物件」面板内。 */
  const annotateZone = !readOnly ? (
    <div
      data-testid="annotate-zone"
      style={{ ...(annotatePanelHost ? {} : { marginTop: PLANNING_SPACING.xs }), paddingBottom: PLANNING_SPACING.xs, borderBottom: `1px solid ${PLANNING_SURFACE.panelBorder}` }}
    >
      {/* 浮窗自带页签标题，搬进右上角后不再重复渲染这一行。 */}
      {!outdoorInspectorActive && (
        <div style={{ display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs }}>
          <span aria-hidden style={{ width: 12, height: 12, flex: '0 0 auto', borderRadius: 999, background: PLANNING_LAYER_COLORS.annotate }} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>标注</span>
          <span style={{ flex: 1 }} />
          <span style={{ opacity: 0.6, fontSize: 11 }}>{levelView.annotations?.length ?? 0}</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.xs }}>
        <button
          type="button"
          aria-pressed={mode === 'note'}
          data-testid="annotate-type-note"
          style={{ ...modeButtonStyle(mode === 'note'), flex: 1, justifyContent: 'center' }}
          onClick={() => setMode('note')}
        >
          文本
        </button>
        <button
          type="button"
          aria-pressed={mode === 'shape'}
          data-testid="annotate-type-shape"
          style={{ ...modeButtonStyle(mode === 'shape'), flex: 1, justifyContent: 'center' }}
          onClick={() => setMode('shape')}
        >
          形状
        </button>
      </div>
      {/* 2026-11-11 用户指令：形状态展开四类型选项（OnePlan 形状按钮点开同款）。 */}
      {mode === 'shape' && (
        <div style={{ display: 'flex', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.xs }}>
          {PLAN_SHAPE_KINDS.map(k => (
            <button
              key={k}
              type="button"
              aria-pressed={annotateShape === k}
              data-testid={`annotate-shape-${k}`}
              style={{ ...modeButtonStyle(annotateShape === k), flex: 1, justifyContent: 'center' }}
              onClick={() => {
                annotateShapeRef.current = k;
                setAnnotateShape(k);
                annotateDraftRef.current = [];
                annotateCursorRef.current = null;
                annotateDragRef.current = null;
                setAnnotateDraftCount(0);
                setEditMessage(null);
                draw();
              }}
            >
              {planAnnotationKindLabels[k]}
            </button>
          ))}
        </div>
      )}
      <div style={{ marginTop: PLANNING_SPACING.xs, opacity: 0.72, fontSize: 12 }}>
        文本：点一下放置就地输入（Enter 提交 / Esc 取消）；形状：矩形/圆形/线段按住拖（也可两点），三角形单击 3 点。
        {mode === 'shape' && annotateDraftCount > 0 && ` 已收 ${annotateDraftCount} 点（${planAnnotationKindLabels[annotateShape]}还需 ${planShapeDraftTarget(annotateShape) - annotateDraftCount} 点）。`}
      </div>
      {(levelView.annotations?.length ?? 0) > 0 && levelView.annotations!.map(a => renderOneplanItemRow({
        key: `annotate-${a.id}`,
        testId: `layer-entity-annotation-${a.id}`,
        label: a.kind === 'note' ? `文本：${(a.text || a.name).split('\n')[0]}` : a.name,
        active: a.id === selectedAnnotationId,
        onClick: () => {
          const row = inventoryRows.find(r => r.kind === 'annotation' && r.id === a.id);
          if (row) locateRow(row);
        },
        onContextMenu: event => { event.preventDefault(); deleteAnnotation(a.id); },
        title: '点击定位到地图；右键或 Delete 删除',
        icon: <span aria-hidden style={{ width: 12, height: 12, flex: '0 0 auto', borderRadius: 999, background: a.color ?? PLACED_KIND_COLORS.annotation }} />,
        trailing: (
          <button
            type="button"
            aria-label={`删除标注「${a.name}」`}
            className="sc-danger-quiet"
            style={{ cursor: 'pointer', fontSize: 11 }}
            onClick={event => { event.stopPropagation(); deleteAnnotation(a.id); }}
          >
            删除
          </button>
        ),
      }))}
    </div>
  ) : null;


  /* 2026-11-11 用户指令：测量、标注、选中物体的编辑合进画布右上角一个可收起浮窗。 */
  // 2026-11-12 坐标行（OnePlan Bench 卡同款）：设施 ENU 米 → 经纬度（plan.anchor 锚点，5 位小数同款格式）。
  const selectedFacilityGeo = selectedFacility
    ? enuToLngLat(selectedFacility.position.x, selectedFacility.position.y, plan.anchor?.lng ?? DEFAULT_ANCHOR_LNG, plan.anchor?.lat ?? DEFAULT_ANCHOR_LAT)
    : null;
  const selectedFacilityGeoLabel = selectedFacilityGeo ? `${selectedFacilityGeo.lat.toFixed(5)}, ${selectedFacilityGeo.lng.toFixed(5)}` : '';
  /* 2026-11-12 OnePlan Bench 卡同款控件样式：白底发丝线盒式输入、单位内嵌、28px 图标钮。 */
  const benchIconButtonStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, flex: '0 0 auto', padding: 0, background: 'none', border: 'none', borderRadius: PLANNING_RADIUS.sm, cursor: 'pointer', color: PLANNING_SURFACE.panelText };
  const benchSectionTitleStyle: React.CSSProperties = { fontWeight: 600, fontSize: PLANNING_TYPOGRAPHY.panel, color: PLANNING_SURFACE.panelText, marginBottom: PLANNING_SPACING.xs };
  const benchUnitBoxStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, height: 28, padding: '0 8px', background: PLANNING_SURFACE.panelBg, border: `1px solid ${PLANNING_SURFACE.panelBorder}`, borderRadius: PLANNING_RADIUS.sm, minWidth: 0 };
  const benchUnitLabelStyle: React.CSSProperties = { flex: '0 0 auto', fontSize: PLANNING_TYPOGRAPHY.row, opacity: 0.6 };
  const benchUnitSuffixStyle: React.CSSProperties = { flex: '0 0 auto', fontSize: PLANNING_TYPOGRAPHY.row, opacity: 0.6 };
  const benchUnitInputStyle: React.CSSProperties = { flex: 1, minWidth: 0, border: 'none', background: 'transparent', padding: 0, fontSize: PLANNING_TYPOGRAPHY.row, color: PLANNING_SURFACE.panelText, textAlign: 'right', outline: 'none' };
  const benchAccordionStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '8px 0', marginTop: PLANNING_SPACING.sm, background: 'none', border: 'none', borderTop: `1px solid ${PLANNING_SURFACE.panelBorder}`, cursor: 'pointer', fontSize: PLANNING_TYPOGRAPHY.panel, color: PLANNING_SURFACE.panelText, textAlign: 'left' };
  const benchSetupRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs, fontSize: PLANNING_TYPOGRAPHY.row, color: PLANNING_SURFACE.panelText };
  const benchSetupFieldStyle: React.CSSProperties = { flex: 1, minWidth: 0, background: PLANNING_SURFACE.fieldBg, color: PLANNING_SURFACE.panelText, border: `1px solid ${PLANNING_SURFACE.panelBorder}`, borderRadius: PLANNING_RADIUS.sm, fontSize: PLANNING_TYPOGRAPHY.row, padding: '2px 4px', outline: 'none' };
  /* 2026-11-12 室内多选胶囊移植（panels/viewport.tsx SelectionChip 同款观感）：
     组选浮层锚在组包围盒顶边中点上方（view state 驱动跟随平移缩放），拖组会话中隐藏。
     成组/存为组合不搬——SitePlan 契约没有 groups/组合概念。 */
  const chipPillStyle: React.CSSProperties = { padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, fontWeight: 600, fontSize: 11, letterSpacing: '0.02em', color: 'var(--pc-cyan-glow, #35624A)' };
  const chipAlignRowStyle: React.CSSProperties = { padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 2, borderRadius: 999, color: 'var(--pc-paper, #141416)' };
  const chipButtonStyle: React.CSSProperties = { border: '1px solid', borderRadius: 999, background: 'transparent', color: 'inherit', fontWeight: 700, fontSize: 10, padding: '1px 8px', cursor: 'pointer', whiteSpace: 'nowrap' };
  const chipIconButtonStyle: React.CSSProperties = { width: 22, height: 22, display: 'grid', placeItems: 'center', borderRadius: 7, background: 'transparent', color: 'inherit', border: '1.5px solid transparent', cursor: 'pointer', opacity: 0.9, padding: 0 };
  /** 组选胶囊锚点：组包围盒顶边中点 → 屏幕像素（每次渲染按当前视口现算，跟随平移/缩放/对齐后的新包围盒）。 */
  const multiGroupChipPx = (() => {
    if (multiSelectedFacilityIds.length < 2) return null;
    const items = multiSelectedFacilityIds
      .map(id => plan.facilities.find(f => f.id === id))
      .filter((f): f is PlanFacility => Boolean(f));
    const bounds = facilityGroupBounds(items);
    if (!bounds) return null;
    const topCenter = planPointToPixel({ x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY }, currentViewport());
    const cssWidth = typeof window === 'undefined' ? 1200 : window.innerWidth;
    return { x: Math.max(110, Math.min(topCenter.x, cssWidth - 110)), y: Math.max(8, topCenter.y - 62) };
  })();
  const BenchRepeatIcon = planningIcon('layout-grid');
  const BenchCopyIcon = planningIcon('copy');
  const BenchPlusIcon = planningIcon('plus');
  const BenchCloseIcon = planningIcon('x');
  const selectionInspectorZone = readOnly ? null : (
    <>
                {/* 2026-11-12 B2 组选态（≥2 件设施）：计数 + 批量动作；单件回落下方 Bench 卡。 */}
                {multiSelectedFacilityIds.length >= 2 && (
                  <div data-testid="facility-multi-panel" style={{ marginTop: PLANNING_SPACING.xs }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: PLANNING_SURFACE.panelText }}>已选 {multiSelectedFacilityIds.length} 件设施</div>
                    <div style={{ marginTop: 2, fontSize: 12, opacity: 0.72 }}>
                      拖组内任意一件整组移动 · 角柄整组缩放 · 方向键微调 · Ctrl+D 复制 · Delete 删除
                    </div>
                    <div style={{ display: 'flex', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.sm }}>
                      <button
                        type="button"
                        data-testid="facility-multi-duplicate"
                        style={modeButtonStyle(false)}
                        onClick={() => duplicateFacilitiesMulti(multiSelectedFacilityIds)}
                      >
                        复制
                      </button>
                      <button
                        type="button"
                        data-testid="facility-multi-delete"
                        style={modeButtonStyle(false)}
                        onClick={() => deleteFacilitiesMulti(multiSelectedFacilityIds)}
                      >
                        删除
                      </button>
                      <button type="button" style={modeButtonStyle(false)} onClick={() => clearMultiSelection()}>
                        取消选择
                      </button>
                    </div>
                  </div>
                )}
                {selectedZoneId && levelView.zones.filter(zone => zone.id === selectedZoneId).map(zone => (
                  <div
                    key={zone.id}
                    data-testid={`zone-row-${zone.id}`}
                    data-selected="true"
                    style={{
                      marginTop: PLANNING_SPACING.xs,
                      borderTop: `1px solid ${PLANNING_SURFACE.fieldBg}`,
                      paddingTop: PLANNING_SPACING.xs,
                      outline: `1px solid ${PLANNING_SURFACE.warnText}`, outlineOffset: 2, borderRadius: PLANNING_RADIUS.sm,
                    }}
                  >
                    <div style={zoneRowStyle}>
                      <button
                        type="button"
                        aria-pressed="true"
                        data-testid={`zone-select-${zone.id}`}
                        onClick={() => selectZone(null)}
                        style={{ ...zoneRowStyle, gap: 4, flex: '0 0 auto', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        title="取消选中"
                      >
                        取消选中
                      </button>
                      <input
                        aria-label={`分区「${zone.name}」颜色`}
                        type="color"
                        value={zone.color ?? PLANNING_ZONE_COLORS[zone.semantic]}
                        onChange={event => updateZone(zone.id, { color: event.target.value })}
                        style={{ width: 22, height: 18, padding: 0, border: 'none', background: 'none' }}
                      />
                      <input
                        aria-label={`分区「${zone.name}」名称`}
                        value={zone.name}
                        maxLength={60}
                        onChange={event => updateZone(zone.id, { name: event.target.value })}
                        style={{ flex: 1, minWidth: 0, background: PLANNING_SURFACE.fieldBg, color: PLANNING_SURFACE.panelText, border: `1px solid ${PLANNING_SURFACE.panelBorder}`, borderRadius: PLANNING_RADIUS.sm, fontSize: PLANNING_TYPOGRAPHY.row, padding: '2px 4px' }}
                      />
                    </div>
                    <label style={zoneRowStyle}>
                      透明度
                      <input
                        aria-label={`分区「${zone.name}」透明度`}
                        type="range"
                        min={PLANNING_ZONE_OPACITY.min}
                        max={PLANNING_ZONE_OPACITY.max}
                        step={0.01}
                        value={zone.opacity ?? PLANNING_ZONE_OPACITY.default}
                        onChange={event => updateZone(zone.id, { opacity: Number(event.target.value) })}
                        style={{ flex: 1 }}
                      />
                      <span style={{ width: 28, textAlign: 'right', opacity: 0.8 }}>{Math.round((zone.opacity ?? PLANNING_ZONE_OPACITY.default) * 100)}%</span>
                    </label>
                  </div>
                ))}

                {selectedFacility && multiSelectedFacilityIds.length < 2 && (
                  facilityCardMode === 'repeat' ? (
                    /* 2026-11-12 OnePlan 面板换页：整卡切成阵列复制（1 object selected + 布局/间距 + 关闭返回）。 */
                    <div role="region" aria-label="阵列复制面板" data-testid="facility-repeat-panel" style={{ marginTop: PLANNING_SPACING.xs }}>
                      <div style={{ fontSize: PLANNING_TYPOGRAPHY.hint, opacity: 0.65 }}>已选中 1 件物件</div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: PLANNING_SURFACE.panelText }}>阵列复制</span>
                        <button
                          type="button"
                          aria-label="返回物件属性"
                          data-testid="facility-repeat-back"
                          style={benchIconButtonStyle}
                          onClick={() => setFacilityCardMode('props')}
                        >
                          <BenchCloseIcon size={16} aria-hidden />
                        </button>
                      </div>
                      <div style={{ ...benchSectionTitleStyle, marginTop: PLANNING_SPACING.sm }}>布局</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: PLANNING_SPACING.sm }}>
                        <label style={benchUnitBoxStyle}>
                          <span style={benchUnitLabelStyle}>列</span>
                          <input
                            aria-label="阵列列数"
                            type="number"
                            min={1}
                            max={20}
                            value={repeatCols}
                            onChange={event => setRepeatCols(Math.max(1, Math.min(20, Math.floor(Number(event.target.value) || 1))))}
                            style={benchUnitInputStyle}
                          />
                        </label>
                        <label style={benchUnitBoxStyle}>
                          <span style={benchUnitLabelStyle}>行</span>
                          <input
                            aria-label="阵列行数"
                            type="number"
                            min={1}
                            max={20}
                            value={repeatRows}
                            onChange={event => setRepeatRows(Math.max(1, Math.min(20, Math.floor(Number(event.target.value) || 1))))}
                            style={benchUnitInputStyle}
                          />
                        </label>
                      </div>
                      <div style={{ ...benchSectionTitleStyle, marginTop: PLANNING_SPACING.sm }}>间距</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: PLANNING_SPACING.sm }}>
                        <label style={benchUnitBoxStyle}>
                          <span style={benchUnitLabelStyle}>列距</span>
                          <input
                            aria-label="阵列列间距（米）"
                            type="number"
                            min={0}
                            max={200}
                            step={0.5}
                            value={repeatGapX}
                            onChange={event => setRepeatGapX(Math.max(0, Math.min(200, Number(event.target.value) || 0)))}
                            style={benchUnitInputStyle}
                          />
                          <span style={benchUnitSuffixStyle}>m</span>
                        </label>
                        <label style={benchUnitBoxStyle}>
                          <span style={benchUnitLabelStyle}>行距</span>
                          <input
                            aria-label="阵列行间距（米）"
                            type="number"
                            min={0}
                            max={200}
                            step={0.5}
                            value={repeatGapY}
                            onChange={event => setRepeatGapY(Math.max(0, Math.min(200, Number(event.target.value) || 0)))}
                            style={benchUnitInputStyle}
                          />
                          <span style={benchUnitSuffixStyle}>m</span>
                        </label>
                      </div>
                      <button
                        type="button"
                        data-testid="facility-repeat"
                        style={{ ...modeButtonStyle(false), marginTop: PLANNING_SPACING.sm, width: '100%', justifyContent: 'center' }}
                        onClick={() => applyRepeatFacility(selectedFacility, repeatCols, repeatRows, repeatGapX, repeatGapY)}
                      >
                        按阵列复制 {repeatCols * repeatRows - 1} 件
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* 2026-11-12 OnePlan Bench 卡对齐：标题=物件名直改 + 阵列复制换页钮；坐标行=经纬度+复制图标（W3W 不做，无格式下拉）。 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: PLANNING_SPACING.xs }}>
                        <input
                          aria-label="选中设施名称"
                          value={selectedFacility.name}
                          maxLength={60}
                          onChange={event => updateFacility(selectedFacility.id, { name: event.target.value })}
                          style={{ flex: 1, minWidth: 0, background: 'transparent', color: PLANNING_SURFACE.panelText, border: 'none', outline: 'none', fontWeight: 700, fontSize: 14, padding: '4px 0' }}
                        />
                        <button
                          type="button"
                          aria-label="阵列复制"
                          title="阵列复制"
                          data-testid="facility-repeat-open"
                          style={benchIconButtonStyle}
                          onClick={() => setFacilityCardMode('repeat')}
                        >
                          <BenchRepeatIcon size={16} aria-hidden />
                        </button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span
                          data-testid="facility-geo-label"
                          style={{ flex: 1, minWidth: 0, fontSize: PLANNING_TYPOGRAPHY.panel, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {selectedFacilityGeoLabel}
                        </span>
                        <button
                          type="button"
                          aria-label="复制物件坐标"
                          title="复制坐标"
                          style={benchIconButtonStyle}
                          onClick={() => {
                            void navigator.clipboard?.writeText(selectedFacilityGeoLabel).then(() => setEditMessage(`坐标已复制：${selectedFacilityGeoLabel}`)).catch(() => setEditMessage('复制没成功，请手动记下。'));
                          }}
                        >
                          <BenchCopyIcon size={14} aria-hidden />
                        </button>
                      </div>
                      {/* Styling：色板圆点 + 盒式透明度数字输入（OnePlan 同款，无滑杆）。 */}
                      <div style={{ ...benchSectionTitleStyle, marginTop: PLANNING_SPACING.sm }}>样式</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.sm }}>
                        <input
                          aria-label="选中设施颜色"
                          type="color"
                          value={selectedFacility.color ?? PLANNING_LAYER_COLORS.facility}
                          onChange={event => updateFacility(selectedFacility.id, { color: event.target.value })}
                          style={{ width: 28, height: 28, flex: '0 0 auto', padding: 0, border: `1px solid ${PLANNING_SURFACE.panelBorder}`, borderRadius: 999, background: 'none', cursor: 'pointer' }}
                        />
                        <label style={{ ...benchUnitBoxStyle, width: 76, justifyContent: 'space-between' }}>
                          <input
                            aria-label="选中设施透明度"
                            type="number"
                            min={5}
                            max={100}
                            step={5}
                            value={Math.round((selectedFacility.opacity ?? 1) * 100)}
                            onChange={event => {
                              const percent = Number(event.target.value);
                              if (Number.isFinite(percent)) updateFacility(selectedFacility.id, { opacity: clamp(percent, 5, 100) / 100 });
                            }}
                            style={benchUnitInputStyle}
                          />
                          <span style={benchUnitSuffixStyle}>%</span>
                        </label>
                      </div>
                      {/* 2026-11-12 描边三态+无描边（OnePlan 同款）：实线/虚线/点线/无。 */}
                      <div style={{ display: 'flex', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.xs }} role="group" aria-label="描边样式">
                        {([['solid', '实线'], ['dashed', '虚线'], ['dotted', '点线'], ['none', '无']] as const).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={(selectedFacility.strokeStyle ?? 'solid') === value}
                            aria-label={`描边${label}`}
                            data-testid={`facility-stroke-${value}`}
                            style={{ ...modeButtonStyle((selectedFacility.strokeStyle ?? 'solid') === value), flex: 1, justifyContent: 'center' }}
                            onClick={() => updateFacility(selectedFacility.id, { strokeStyle: value })}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {/* Details：W/L 盒式输入，单位内嵌（OnePlan 同款）。 */}
                      <div style={{ ...benchSectionTitleStyle, marginTop: PLANNING_SPACING.sm }}>尺寸</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: PLANNING_SPACING.sm }}>
                        <label style={benchUnitBoxStyle}>
                          <span style={benchUnitLabelStyle}>W</span>
                          <input
                            aria-label="选中设施宽度（米）"
                            type="number"
                            min={FACILITY_MIN_SIZE_M}
                            max={FACILITY_MAX_SIZE_M}
                            step={0.5}
                            value={Number(selectedFacility.size.width.toFixed(1))}
                            onChange={event => {
                              const width = Number(event.target.value);
                              if (Number.isFinite(width)) updateFacility(selectedFacility.id, { size: { width, depth: selectedFacility.size.depth } });
                            }}
                            style={benchUnitInputStyle}
                          />
                          <span style={benchUnitSuffixStyle}>m</span>
                        </label>
                        <label style={benchUnitBoxStyle}>
                          <span style={benchUnitLabelStyle}>L</span>
                          <input
                            aria-label="选中设施深度（米）"
                            type="number"
                            min={FACILITY_MIN_SIZE_M}
                            max={FACILITY_MAX_SIZE_M}
                            step={0.5}
                            value={Number(selectedFacility.size.depth.toFixed(1))}
                            onChange={event => {
                              const depth = Number(event.target.value);
                              if (Number.isFinite(depth)) updateFacility(selectedFacility.id, { size: { width: selectedFacility.size.width, depth } });
                            }}
                            style={benchUnitInputStyle}
                          />
                          <span style={benchUnitSuffixStyle}>m</span>
                        </label>
                      </div>
                      {/* V-5a 模型候选（OnePlan 卡小标签+浅描边盒同款）：点缩略图写 facility.modelOverride，
                          3D plan-model-layer 即时换模型；「自动」清除 override 回自动挑选。一条 updateFacility=一条 undo。 */}
                      <div style={{ ...benchSectionTitleStyle, marginTop: PLANNING_SPACING.sm }}>模型</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: PLANNING_SPACING.xs }} role="group" aria-label="3D 模型候选">
                        <button
                          type="button"
                          aria-pressed={!selectedFacility.modelOverride}
                          data-testid="facility-model-auto"
                          title="按占地自动挑选模型（清除手动 override）"
                          style={{ position: 'relative', height: 48, padding: '0 4px', background: PLANNING_SURFACE.panelBg, border: `1px solid ${selectedFacility.modelOverride ? PLANNING_SURFACE.panelBorder : GROUP_SELECT_BLUE}`, borderRadius: PLANNING_RADIUS.sm, cursor: 'pointer', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          onClick={() => {
                            updateFacility(selectedFacility.id, { modelOverride: undefined });
                            setEditMessage(`「${selectedFacility.name}」已恢复自动挑选 3D 模型。`);
                          }}
                        >
                          <span style={{ fontSize: 12, color: PLANNING_SURFACE.panelText, opacity: 0.75 }}>自动</span>
                        </button>
                        {(facilityModelCandidates && facilityModelCandidates.templateId === selectedFacility.templateId
                          ? facilityModelCandidates.items
                          : []
                        ).map((candidate) => (
                          <button
                            key={candidate.slug}
                            type="button"
                            aria-pressed={selectedFacility.modelOverride === candidate.slug}
                            data-testid={`facility-model-${candidate.slug}`}
                            title={`${candidate.name}（${candidate.width}×${candidate.depth}×${candidate.height} m）`}
                            style={{ position: 'relative', height: 48, padding: 0, background: PLANNING_SURFACE.panelBg, border: `1px solid ${selectedFacility.modelOverride === candidate.slug ? GROUP_SELECT_BLUE : PLANNING_SURFACE.panelBorder}`, borderRadius: PLANNING_RADIUS.sm, cursor: 'pointer', overflow: 'hidden' }}
                            onClick={() => {
                              updateFacility(selectedFacility.id, { modelOverride: candidate.slug });
                              setEditMessage(`「${selectedFacility.name}」的 3D 模型已切换为「${candidate.name}」，切 3D 即时生效。`);
                            }}
                          >
                            {/* 缩略图盖在名称占位块上：加载失败 onError 隐藏图片 → 露出占位块，不空崩。 */}
                            {candidate.thumb ? (
                              <img
                                key={`${selectedFacility.id}:${candidate.slug}`}
                                src={candidate.thumb}
                                alt=""
                                loading="lazy"
                                onError={event => { event.currentTarget.style.display = 'none'; }}
                                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            ) : null}
                            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 4px 2px', fontSize: 10, lineHeight: '12px', color: PLANNING_SURFACE.panelText, textShadow: candidate.thumb ? '0 1px 2px rgba(0,0,0,0.6)' : 'none', pointerEvents: 'none' }}>
                              <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{candidate.name}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                      {/* V-5b/c 生成中状态行：轮询到待取回任务时给一句可读进度，完成后自动消失。 */}
                      {facilityGenerateStatus && facilityGenerateStatus.facilityId === selectedFacility.id ? (
                        <div role="status" style={{ marginTop: PLANNING_SPACING.xs, fontSize: 12, lineHeight: '16px', color: PLANNING_SURFACE.panelText, opacity: 0.75 }}>
                          「{facilityGenerateStatus.name}」{facilityGenerateStatus.message}，完成后自动回填候选首位。
                        </div>
                      ) : null}
                      {/* V-5b/c 生成/上传/导入入口：生成与图片经 onOpenMaterialGenerate 外发到主线物料生成框
                          （仍须确认额度）；GLB 直传走本机导入兜底（会话内有效），完成即回填候选首位。 */}
                      <div style={{ display: 'flex', gap: PLANNING_SPACING.sm, marginTop: PLANNING_SPACING.xs }}>
                        <input
                          ref={glbImportInputRef}
                          type="file"
                          accept=".glb,model/gltf-binary"
                          style={{ display: 'none' }}
                          onChange={event => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            void handleImportFacilityGlb(file);
                          }}
                        />
                        <button
                          type="button"
                          data-testid="facility-model-generate"
                          title="按设施名预填左栏物料生成框，确认额度后提交；生成完自动回填候选首位"
                          style={{ ...modeButtonStyle(false), flex: 1, justifyContent: 'center' }}
                          onClick={() => onOpenMaterialGenerate?.(selectedFacility.id, 'text')}
                        >
                          生成一个
                        </button>
                        <button
                          type="button"
                          data-testid="facility-model-upload"
                          title="上传一张图片，预填到物料生成框生成 3D 模型"
                          style={{ ...modeButtonStyle(false), flex: 1, justifyContent: 'center' }}
                          onClick={() => onOpenMaterialGenerate?.(selectedFacility.id, 'image')}
                        >
                          上传图片生成
                        </button>
                        <button
                          type="button"
                          data-testid="facility-model-import-glb"
                          title="导入本机 .glb（≤10MB），仅本次编辑有效"
                          style={{ ...modeButtonStyle(false), flex: 1, justifyContent: 'center' }}
                          onClick={() => glbImportInputRef.current?.click()}
                        >
                          导入 GLB
                        </button>
                      </div>
                      {/* + 布场信息（OnePlan Object setup 镜像：供应商/进撤场/用电）。 */}
                      <button
                        type="button"
                        aria-expanded={facilitySetupOpen}
                        data-testid="facility-setup-toggle"
                        style={benchAccordionStyle}
                        onClick={() => setFacilitySetupOpen(open => !open)}
                      >
                        <BenchPlusIcon size={14} aria-hidden style={{ transform: facilitySetupOpen ? 'rotate(45deg)' : 'none', transition: 'transform 120ms ease', flex: '0 0 auto' }} />
                        布场信息
                      </button>
                      {facilitySetupOpen && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: PLANNING_SPACING.xs, padding: `${PLANNING_SPACING.xs}px 0 ${PLANNING_SPACING.xs}px 20px` }}>
                          <label style={benchSetupRowStyle}>
                            供应商
                            <input
                              aria-label="设施供应商名称"
                              type="text"
                              value={selectedFacility.vendorName ?? ''}
                              maxLength={120}
                              onChange={event => updateFacility(selectedFacility.id, { vendorName: event.target.value })}
                              placeholder="输入名称"
                              style={benchSetupFieldStyle}
                            />
                          </label>
                          <label style={benchSetupRowStyle}>
                            区域
                            <input
                              aria-label="设施供应商区域"
                              type="text"
                              value={selectedFacility.vendorZone ?? ''}
                              maxLength={120}
                              onChange={event => updateFacility(selectedFacility.id, { vendorZone: event.target.value })}
                              placeholder="输入区域"
                              style={benchSetupFieldStyle}
                            />
                          </label>
                          <div style={benchSetupRowStyle}>
                            <span style={{ flex: '0 0 auto', opacity: 0.75 }}>进场</span>
                            <input
                              aria-label="设施进场日期"
                              type="date"
                              value={selectedFacility.inDate ?? ''}
                              onChange={event => updateFacility(selectedFacility.id, { inDate: event.target.value })}
                              style={benchSetupFieldStyle}
                            />
                            <input
                              aria-label="设施进场时间"
                              type="time"
                              value={selectedFacility.inTime ?? ''}
                              onChange={event => updateFacility(selectedFacility.id, { inTime: event.target.value })}
                              style={benchSetupFieldStyle}
                            />
                          </div>
                          <div style={benchSetupRowStyle}>
                            <span style={{ flex: '0 0 auto', opacity: 0.75 }}>撤场</span>
                            <input
                              aria-label="设施撤场日期"
                              type="date"
                              value={selectedFacility.outDate ?? ''}
                              onChange={event => updateFacility(selectedFacility.id, { outDate: event.target.value })}
                              style={benchSetupFieldStyle}
                            />
                            <input
                              aria-label="设施撤场时间"
                              type="time"
                              value={selectedFacility.outTime ?? ''}
                              onChange={event => updateFacility(selectedFacility.id, { outTime: event.target.value })}
                              style={benchSetupFieldStyle}
                            />
                          </div>
                          <label style={benchSetupRowStyle}>
                            用电
                            <input
                              aria-label="设施用电负荷（千瓦）"
                              type="number"
                              min={0}
                              max={10000}
                              step={0.1}
                              value={selectedFacility.electricKw ?? ''}
                              onChange={event => {
                                const raw = event.target.value;
                                updateFacility(selectedFacility.id, { electricKw: raw === '' ? undefined : Number(raw) });
                              }}
                              style={benchSetupFieldStyle}
                            />
                            <span style={benchUnitSuffixStyle}>kW</span>
                          </label>
                        </div>
                      )}
                      {/* + 备注（契约 notes 字段已有，500 字上限）。 */}
                      <button
                        type="button"
                        aria-expanded={facilityNotesOpen}
                        data-testid="facility-notes-toggle"
                        style={benchAccordionStyle}
                        onClick={() => setFacilityNotesOpen(open => !open)}
                      >
                        <BenchPlusIcon size={14} aria-hidden style={{ transform: facilityNotesOpen ? 'rotate(45deg)' : 'none', transition: 'transform 120ms ease', flex: '0 0 auto' }} />
                        备注
                      </button>
                      {facilityNotesOpen && (
                        <textarea
                          aria-label="选中设施备注"
                          data-testid="facility-notes-input"
                          rows={3}
                          maxLength={500}
                          value={selectedFacility.notes ?? ''}
                          onChange={event => updateFacility(selectedFacility.id, { notes: event.target.value })}
                          placeholder="输入备注…"
                          style={{ marginTop: PLANNING_SPACING.xs, marginLeft: 20, width: 'calc(100% - 20px)', boxSizing: 'border-box', resize: 'vertical', background: PLANNING_SURFACE.fieldBg, color: PLANNING_SURFACE.panelText, border: `1px solid ${PLANNING_SURFACE.panelBorder}`, borderRadius: PLANNING_RADIUS.sm, fontSize: PLANNING_TYPOGRAPHY.row, padding: '4px 6px', outline: 'none' }}
                        />
                      )}
                    </>
                  )
                )}

                {selectedRoute && (
                  <>
                    <div style={sectionTitle}>已选中动线</div>
                    <div style={zoneRowStyle}>
                      <input
                        aria-label="选中动线名称"
                        value={selectedRoute.name}
                        maxLength={60}
                        onChange={event => updateRoute(selectedRoute.id, { name: event.target.value })}
                        style={{ flex: 1, minWidth: 0, background: PLANNING_SURFACE.fieldBg, color: PLANNING_SURFACE.panelText, border: `1px solid ${PLANNING_SURFACE.panelBorder}`, borderRadius: PLANNING_RADIUS.sm, fontSize: PLANNING_TYPOGRAPHY.row, padding: '2px 4px' }}
                      />
                    </div>
                    <label style={zoneRowStyle}>
                      类型
                      <select
                        aria-label="选中动线类型"
                        value={selectedRoute.kind}
                        onChange={event => updateRoute(selectedRoute.id, { kind: event.target.value as PlanRoute['kind'] })}
                        style={selectStyle}
                      >
                        {planRouteKinds.map(k => <option key={k} value={k}>{planRouteKindLabels[k]}</option>)}
                      </select>
                    </label>
                    <label style={zoneRowStyle}>
                      <input
                        type="checkbox"
                        aria-label="选中动线单向"
                        checked={selectedRoute.oneWay}
                        onChange={event => updateRoute(selectedRoute.id, { oneWay: event.target.checked })}
                      />
                      单向（沿线方向箭头）
                    </label>
                    <div style={{ marginTop: PLANNING_SPACING.xs, opacity: 0.75 }}>
                      {selectedRoute.points.length} 点 · 全长 {formatLengthM(planRouteLengthM(selectedRoute.points))} · {selectedRoute.startNodeId ? '起点已连节点' : '起点自由'} · {selectedRoute.endNodeId ? '终点已连节点' : '终点自由'}
                    </div>
                    <div style={{ display: 'flex', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.xs, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        data-testid="route-reverse"
                        style={modeButtonStyle(false)}
                        onClick={() => reverseSelectedRoute(selectedRoute.id)}
                      >
                        反转方向
                      </button>
                      <button
                        type="button"
                        data-testid="route-delete"
                        style={modeButtonStyle(false)}
                        onClick={() => deleteRoute(selectedRoute.id)}
                      >
                        删除动线
                      </button>
                      <button type="button" style={modeButtonStyle(false)} onClick={() => selectRoute(null)}>
                        取消选择
                      </button>
                    </div>
                  </>
                )}

                {selectedNode && (() => {
                  const refs = nodeRouteRefs(selectedNode.id, plan.routes);
                  return (
                    <>
                      <div style={sectionTitle}>已选中出入口</div>
                      <div style={zoneRowStyle}>
                        <input
                          aria-label="选中出入口名称"
                          value={selectedNode.name}
                          maxLength={60}
                          onChange={event => updateNode(selectedNode.id, { name: event.target.value })}
                          style={{ flex: 1, minWidth: 0, background: PLANNING_SURFACE.fieldBg, color: PLANNING_SURFACE.panelText, border: `1px solid ${PLANNING_SURFACE.panelBorder}`, borderRadius: PLANNING_RADIUS.sm, fontSize: PLANNING_TYPOGRAPHY.row, padding: '2px 4px' }}
                        />
                      </div>
                      <label style={zoneRowStyle}>
                        类型
                        <select
                          aria-label="选中出入口类型"
                          value={selectedNode.kind}
                          onChange={event => updateNode(selectedNode.id, { kind: event.target.value as PlanNode['kind'] })}
                          style={selectStyle}
                        >
                          <option value="entry">入口</option>
                          <option value="exit">出口</option>
                          <option value="both">出入口（两用）</option>
                        </select>
                      </label>
                      <div style={{ marginTop: PLANNING_SPACING.xs, opacity: 0.75 }}>
                        {refs.startRoutes.length === 0 && refs.endRoutes.length === 0
                          ? '未连接任何动线（红点警示）。'
                          : `关联动线 ${refs.startRoutes.length + refs.endRoutes.length} 条（起点 ${refs.startRoutes.length} / 终点 ${refs.endRoutes.length}）`}
                      </div>
                      <div style={{ display: 'flex', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.xs, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          data-testid="node-delete"
                          style={modeButtonStyle(false)}
                          onClick={() => deleteNode(selectedNode.id)}
                        >
                          删除出入口
                        </button>
                        <button type="button" style={modeButtonStyle(false)} onClick={() => selectNode(null)}>
                          取消选择
                        </button>
                      </div>
                    </>
                  );
                })()}

                {selectedWorker && (
                  <>
                    <div style={sectionTitle}>已选中人员点位</div>
                    <div style={zoneRowStyle}>
                      <input
                        aria-label="选中人员岗位"
                        value={selectedWorker.role}
                        maxLength={60}
                        onChange={event => updateWorker(selectedWorker.id, { role: event.target.value })}
                        style={{ flex: 1, minWidth: 0, background: PLANNING_SURFACE.fieldBg, color: PLANNING_SURFACE.panelText, border: `1px solid ${PLANNING_SURFACE.panelBorder}`, borderRadius: PLANNING_RADIUS.sm, fontSize: PLANNING_TYPOGRAPHY.row, padding: '2px 4px' }}
                      />
                      <input
                        aria-label="选中人员人数"
                        type="number"
                        min={1}
                        max={9999}
                        value={selectedWorker.count}
                        onChange={event => updateWorker(selectedWorker.id, { count: Math.max(1, Math.min(9999, Math.floor(Number(event.target.value) || 1))) })}
                        style={{ width: 56, background: PLANNING_SURFACE.fieldBg, color: PLANNING_SURFACE.panelText, border: `1px solid ${PLANNING_SURFACE.panelBorder}`, borderRadius: PLANNING_RADIUS.sm, fontSize: PLANNING_TYPOGRAPHY.row, padding: '2px 4px' }}
                      />
                    </div>
                    <label style={zoneRowStyle}>
                      归属分区
                      <select
                        aria-label="选中人员归属分区"
                        value={selectedWorker.zoneId ?? ''}
                        onChange={event => updateWorker(selectedWorker.id, { zoneId: event.target.value || undefined })}
                        style={{ ...selectStyle, flex: 1, minWidth: 0 }}
                      >
                        <option value="">（自动 / 无）</option>
                        {levelView.zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
                      </select>
                    </label>
                    <div style={{ display: 'flex', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.xs }}>
                      <button
                        type="button"
                        data-testid="worker-delete"
                        style={modeButtonStyle(false)}
                        onClick={() => deleteWorker(selectedWorker.id)}
                      >
                        删除点位
                      </button>
                      <button type="button" style={modeButtonStyle(false)} onClick={() => selectWorker(null)}>
                        取消选择
                      </button>
                    </div>
                  </>
                )}

                {/* 问题提示列表已按 OnePlan 纯度移除（2026-11-11）；完整可定位问题清单在规划信息卡的「问题」页签。 */}

                <div role="status" aria-live="polite" style={{ marginTop: PLANNING_SPACING.sm, minHeight: 16, color: editMessage ? PLANNING_SURFACE.warnText : 'transparent' }}>
                  {editMessage ?? '·'}
                </div>
    </>
  );

  return (
    <div
      ref={stageRef}
      style={{
        position: 'relative', width: '100%', height: '100%', overflow: 'hidden',
        cursor: mode === 'view' ? (dragging ? 'grabbing' : 'grab') : 'crosshair',
      }}
      onMouseDown={handleStageMouseDown}
      onMouseMove={handleStageMouseMove}
      onMouseUp={handleStageMouseUp}
      onMouseLeave={handleStageMouseLeave}
      onDoubleClick={handleStageDoubleClick}
      onContextMenu={event => {
        // P2-l（用户 m05374）：画区域/边界时右键 = 移除上一个节点；其余模式右键点中设施 = 层级菜单。
        if (modeRef.current === 'zone' || modeRef.current === 'boundary' || modeRef.current === 'route') {
          const draft = draftRef.current;
          if (draft.length === 0) return;
          event.preventDefault();
          const next = draft.slice(0, -1);
          setDraft(next);
          setEditMessage(
            next.length === 0
              ? '已移除全部节点；自己按 Esc 退出绘制。'
              : `已移除上一个节点（还剩 ${next.length} 个）；双击左键完成绘制。`,
          );
          return;
        }
        if (modeRef.current !== 'view') return;
        const hit = eventPlanPoint(event);
        if (!hit) {
          setFacilityMenu(null);
          return;
        }
        const target = [...viewPlan().facilities].reverse().find(item => facilityContainsPoint(hit.pt, item));
        if (!target) {
          setFacilityMenu(null);
          return;
        }
        event.preventDefault();
        if (!layerLocked('facility')) selectFacility(target.id);
        setFacilityMenu({ x: event.clientX, y: event.clientY, id: target.id });
      }}
      onWheel={e => {
        // React 合成 wheel 在部分浏览器为 passive 监听，preventDefault 会告警；
        // 缩放改走原生非 passive 监听（挂载时注册、卸载时移除）。
        if (!e.nativeEvent.defaultPrevented) zoomBy(e.deltaY < 0 ? 1 : -1);
      }}
      onDragOver={event => {
        // H2-c：拖模板到画布 → 幽灵占地跟随（占地预览）。
        if (modeRef.current !== 'facility' || !facilityTemplateRef.current) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        const hit = eventPlanPoint(event);
        if (!hit) return;
        ghostPointRef.current = hit.pt;
        draw();
      }}
      onDragLeave={() => {
        if (modeRef.current === 'facility') {
          ghostPointRef.current = null;
          draw();
        }
      }}
      onDrop={event => {
        // H2-c：拖放提交（与单击提交同一入口 placeFacilityAt）。
        event.preventDefault();
        // P2-h：从物件库直接拖进来的模板，画布上还没有「待放模板」，先按拖动的 id 落模板。
        const dragged = event.dataTransfer.getData('text/plain');
        if (dragged) {
          // setMode 会清空待放模板，所以先切模式、再按拖动的 id 落模板。
          if (modeRef.current !== 'facility') setMode('facility');
          pickFacilityTemplate(dragged);
        }
        if (!facilityTemplateRef.current) return;
        const hit = eventPlanPoint(event);
        if (!hit) return;
        placeFacilityAt(hit.pt);
      }}
    >
      <canvas ref={baseCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-label="底图瓦片层" />
      <canvas ref={planCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} aria-label="户外规划业务图层" />
      {/* 2026-11-12 用户「地图加载时页面灰扑扑」：底图补瓦片期间顶部居中一枚轻提示，
          全部结算（含失败）即收；pointer-events 无、不挡任何画布交互。 */}
      {basemapLoading && (
        <div className="pc-top-chip absolute left-1/2" style={{ top: 14, transform: 'translateX(-50%)', zIndex: 26, pointerEvents: 'none' }}>
          <div className="pc-glass pc-glass--dark" role="status" aria-live="polite"
            style={{ padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, fontWeight: 600, fontSize: 11, letterSpacing: '0.02em', color: 'var(--pc-cyan-glow, #35624A)' }}>
            <span className="pc-basemap-loading__spinner" aria-hidden="true" />
            底图加载中…
          </div>
        </div>
      )}
      {/* 2026-11-12 室内多选胶囊移植：组选浮层（计数+复制/删除 / 对齐八向+等距），锚在组包围盒上方，
          拖组会话中隐藏（不跟随拖拽帧，松手回位）；对齐/等距各一条 undo。 */}
      {multiSelectedFacilityIds.length >= 2 && !groupDragRef.current && multiGroupChipPx && (
        <div className="pc-top-chip absolute" style={{ left: multiGroupChipPx.x, top: multiGroupChipPx.y, transform: 'translateX(-50%)', zIndex: 26 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
            <div className="pc-glass pc-glass--dark" style={chipPillStyle}>
              <BenchCopyIcon size={14} aria-hidden />
              {multiSelectedFacilityIds.length} 件 · 已选中 · 拖动即整体移动
              <button type="button" data-testid="facility-multi-copy" title="复制所选（Ctrl+D 同效）" style={chipButtonStyle} onClick={() => duplicateFacilitiesMulti(multiSelectedFacilityIds)}>
                复制
              </button>
              <button type="button" data-testid="facility-multi-remove" title="删除所选（Delete 同效）" style={chipButtonStyle} onClick={() => deleteFacilitiesMulti(multiSelectedFacilityIds)}>
                删除
              </button>
            </div>
            <div className="pc-glass pc-glass--dark" style={chipAlignRowStyle}>
              <button type="button" aria-label="左对齐" title="左对齐" style={chipIconButtonStyle} onClick={() => alignFacilitiesMulti(multiSelectedFacilityIds, 'min-x')}>
                <AlignLeft size={13} strokeWidth={1.75} aria-hidden />
              </button>
              <button type="button" aria-label="水平居中" title="水平居中" style={chipIconButtonStyle} onClick={() => alignFacilitiesMulti(multiSelectedFacilityIds, 'center-x')}>
                <AlignCenterHorizontal size={13} strokeWidth={1.75} aria-hidden />
              </button>
              <button type="button" aria-label="右对齐" title="右对齐" style={chipIconButtonStyle} onClick={() => alignFacilitiesMulti(multiSelectedFacilityIds, 'max-x')}>
                <AlignRight size={13} strokeWidth={1.75} aria-hidden />
              </button>
              <button type="button" aria-label={multiSelectedFacilityIds.length < 3 ? '水平等距（至少三件）' : '水平等距分布'} title={multiSelectedFacilityIds.length < 3 ? '水平等距（至少三件）' : '水平等距分布'} disabled={multiSelectedFacilityIds.length < 3} style={{ ...chipIconButtonStyle, cursor: multiSelectedFacilityIds.length < 3 ? 'not-allowed' : 'pointer', opacity: multiSelectedFacilityIds.length < 3 ? 0.35 : 0.9 }} onClick={() => distributeFacilitiesMulti(multiSelectedFacilityIds, 'x')}>
                <AlignHorizontalDistributeCenter size={13} strokeWidth={1.75} aria-hidden />
              </button>
              <span aria-hidden style={{ width: 1, height: 14, background: 'currentColor', opacity: 0.25 }} />
              <button type="button" aria-label="上对齐" title="上对齐" style={chipIconButtonStyle} onClick={() => alignFacilitiesMulti(multiSelectedFacilityIds, 'max-y')}>
                <AlignStartVertical size={13} strokeWidth={1.75} aria-hidden />
              </button>
              <button type="button" aria-label="垂直居中" title="垂直居中" style={chipIconButtonStyle} onClick={() => alignFacilitiesMulti(multiSelectedFacilityIds, 'center-y')}>
                <AlignCenterVertical size={13} strokeWidth={1.75} aria-hidden />
              </button>
              <button type="button" aria-label="下对齐" title="下对齐" style={chipIconButtonStyle} onClick={() => alignFacilitiesMulti(multiSelectedFacilityIds, 'min-y')}>
                <AlignEndVertical size={13} strokeWidth={1.75} aria-hidden />
              </button>
              <button type="button" aria-label={multiSelectedFacilityIds.length < 3 ? '垂直等距（至少三件）' : '垂直等距分布'} title={multiSelectedFacilityIds.length < 3 ? '垂直等距（至少三件）' : '垂直等距分布'} disabled={multiSelectedFacilityIds.length < 3} style={{ ...chipIconButtonStyle, cursor: multiSelectedFacilityIds.length < 3 ? 'not-allowed' : 'pointer', opacity: multiSelectedFacilityIds.length < 3 ? 0.35 : 0.9 }} onClick={() => distributeFacilitiesMulti(multiSelectedFacilityIds, 'y')}>
                <AlignVerticalDistributeCenter size={13} strokeWidth={1.75} aria-hidden />
              </button>
            </div>
          </div>
        </div>
      )}
      {/* P2-l 右键层级菜单（用户 m05344）：只动数组顺序，草稿/导出/3D 一起跟着变。 */}
      {facilityMenu && (
        <div
          data-testid="facility-context-menu"
          role="menu"
          aria-label="设施层级"
          style={{
            position: 'fixed',
            left: Math.min(facilityMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1440) - 172),
            top: Math.min(facilityMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 900) - 152),
            zIndex: 60,
            minWidth: 156,
            padding: 4,
            borderRadius: 10,
            background: PLANNING_SURFACE.panelBg,
            border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
            boxShadow: '0 12px 32px rgba(20, 20, 22, 0.28)',
          }}
          onMouseDown={stopPanelMouse}
          onContextMenu={event => event.preventDefault()}
        >
          {(
            [
              ['up', '上移一层'],
              ['top', '置于顶层'],
              ['down', '下移一层'],
              ['bottom', '置于底层'],
            ] as const
          ).map(([action, label]) => (
            <button
              key={action}
              type="button"
              role="menuitem"
              data-testid={`facility-order-${action}`}
              onClick={() => reorderFacility(facilityMenu.id, action)}
              style={{
                all: 'unset',
                display: 'block',
                boxSizing: 'border-box',
                width: '100%',
                padding: '6px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                color: PLANNING_SURFACE.panelText,
                fontSize: PLANNING_TYPOGRAPHY.row,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* 2026-11-11 图层行（Level = 独立设计方案，非楼层高度）：点行切换/重命名/删除，+ 新建并切换；
          2026-11-12 用户指令：列表改为**卡内展开**（随文档流推下后续内容），不再是浮窗弹层；
          portal 进左栏卡片头部宿主，无宿主时浮在画布顶部。 */}
      <PanelPortal host={levelsPanelHost}>
        <div
          data-testid="outdoor-levels-row"
          style={{
            position: levelsPanelHost ? 'relative' : 'absolute',
            ...(levelsPanelHost ? {} : { top: 8, left: '50%', transform: 'translateX(-50%)' }),
            zIndex: 5,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            margin: levelsPanelHost ? '0 10px' : 0,
            pointerEvents: 'auto',
          }}
          onMouseDown={stopPanelMouse}
          onMouseUp={stopPanelMouse}
          onDoubleClick={stopPanelMouse}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              padding: '2px 4px',
              borderRadius: PLANNING_RADIUS.md,
              background: PLANNING_SURFACE.panelBg,
              border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
              boxShadow: levelsPanelHost ? 'none' : '0 2px 8px rgba(20, 20, 22, 0.08)',
            }}
          >
          <button
            type="button"
            data-testid="levels-popover-trigger"
            aria-expanded={levelMenuOpen}
            aria-label={`当前图层 ${activeLevelName}，共 ${levelList.length} 层，点按管理图层`}
            onClick={() => { setLevelMenuOpen(open => !open); setRenamingLevelId(null); setDeleteArmLevelId(null); }}
            style={{
              all: 'unset',
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 6px', borderRadius: PLANNING_RADIUS.sm,
              color: PLANNING_SURFACE.panelText, fontSize: 15,
              cursor: 'pointer', minWidth: 0, flex: levelsPanelHost ? '1 1 0%' : '0 1 auto',
            }}
          >
            <LevelRowIcon size={18} />
            <span data-testid="levels-active-level-name" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{activeLevelName}</span>
            <span data-testid="levels-level-count" style={{ opacity: 0.6, fontSize: PLANNING_TYPOGRAPHY.row }}>({activeLevelIndex + 1}/{levelList.length})</span>
            <span aria-hidden style={{ fontSize: 10, opacity: 0.55, marginLeft: 'auto' }}>{levelMenuOpen ? '▾' : '▸'}</span>
          </button>
          {!readOnly && (
            <button
              type="button"
              data-testid="outdoor-level-add"
              aria-label={`新建并切换到第 ${levelList.length + 1} 层`}
              title="新建图层并切换"
              onClick={() => { addLevel(); }}
              style={{
                all: 'unset',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 26, height: 26, borderRadius: 8,
                border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
                color: PLANNING_SURFACE.panelText, fontSize: 16, cursor: 'pointer',
              }}
            >
              +
            </button>
          )}
          </div>
          {levelMenuOpen && (
            <div
              role="menu"
              aria-label="图层列表"
              data-testid="levels-popover"
              style={{
                position: 'static',
                width: '100%',
                boxSizing: 'border-box',
                padding: 4,
                borderRadius: 10,
                background: PLANNING_SURFACE.panelBg,
                border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
                boxShadow: levelsPanelHost ? 'none' : '0 2px 8px rgba(20, 20, 22, 0.08)',
              }}
            >
              {levelList.map((level, index) => (
                <div
                  key={level.id}
                  data-testid={`levels-item-${level.id}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 4px', borderRadius: PLANNING_RADIUS.sm }}
                >
                  {renamingLevelId === level.id ? (
                    <input
                      autoFocus
                      value={levelNameDraft}
                      data-testid={`levels-rename-input-${level.id}`}
                      onChange={event => setLevelNameDraft(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') renameLevel(level.id, levelNameDraft);
                        if (event.key === 'Escape') setRenamingLevelId(null);
                      }}
                      onBlur={() => renameLevel(level.id, levelNameDraft)}
                      style={{
                        flex: 1, minWidth: 0, padding: '4px 6px',
                        background: PLANNING_SURFACE.fieldBg, color: PLANNING_SURFACE.panelText,
                        border: `1px solid ${PLANNING_SURFACE.panelBorder}`, borderRadius: PLANNING_RADIUS.sm,
                        fontSize: PLANNING_TYPOGRAPHY.row,
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      data-testid={`levels-switch-${level.id}`}
                      onClick={() => { switchLevel(level.id); setLevelMenuOpen(false); }}
                      style={{
                        all: 'unset',
                        flex: 1, minWidth: 0,
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '6px 8px', borderRadius: PLANNING_RADIUS.sm,
                        color: PLANNING_SURFACE.panelText, fontSize: PLANNING_TYPOGRAPHY.row,
                        cursor: 'pointer',
                        fontWeight: index === activeLevelIndex ? 600 : 400,
                      }}
                    >
                      <span style={{ width: 14, textAlign: 'center', opacity: index === activeLevelIndex ? 1 : 0.35 }}>{index === activeLevelIndex ? '✓' : ''}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{level.name}</span>
                    </button>
                  )}
                  {!readOnly && renamingLevelId !== level.id && (
                    <>
                      <button
                        type="button"
                        title="重命名"
                        data-testid={`levels-rename-${level.id}`}
                        onClick={() => { setRenamingLevelId(level.id); setLevelNameDraft(level.name); setDeleteArmLevelId(null); }}
                        style={{ all: 'unset', padding: '2px 6px', borderRadius: PLANNING_RADIUS.sm, color: PLANNING_SURFACE.panelText, opacity: 0.7, fontSize: PLANNING_TYPOGRAPHY.row, cursor: 'pointer' }}
                      >
                        改名
                      </button>
                      <button
                        type="button"
                        title={deleteArmLevelId === level.id ? '再点一次确认删除（连同该层全部内容）' : '删除该图层'}
                        data-testid={`levels-delete-${level.id}`}
                        disabled={levelList.length <= 1}
                        onClick={() => {
                          if (deleteArmLevelId === level.id) {
                            removeLevel(level.id);
                            if (levelList.length <= 2) setLevelMenuOpen(false);
                          } else {
                            setDeleteArmLevelId(level.id);
                          }
                        }}
                        style={{
                          all: 'unset', padding: '2px 6px', borderRadius: PLANNING_RADIUS.sm,
                          color: deleteArmLevelId === level.id ? '#b42318' : PLANNING_SURFACE.panelText,
                          opacity: levelList.length <= 1 ? 0.35 : deleteArmLevelId === level.id ? 1 : 0.7,
                          fontSize: PLANNING_TYPOGRAPHY.row,
                          cursor: levelList.length <= 1 ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {deleteArmLevelId === level.id ? '确认删除' : '删除'}
                      </button>
                    </>
                  )}
                </div>
              ))}
              <div style={{ padding: '6px 8px 2px', opacity: 0.55, fontSize: PLANNING_TYPOGRAPHY.row }}>
                图层是同一套场地的不同设计方案；边界与定位跨图层共享。
              </div>
            </div>
          )}
        </div>
      </PanelPortal>

      {/* 2026-11-11 用户指令：文本标注就地输入框（Enter 提交 / Esc 取消；Shift+Enter 换行）。 */}
      {noteInput && (() => {
        const px = planPointToPixel(noteInput.pt, currentViewport());
        return (
          <textarea
            data-testid="annotate-note-input"
            autoFocus
            value={noteInput.value}
            placeholder="输入文本…"
            rows={2}
            onChange={event => updateNoteInput({ pt: noteInput.pt, value: event.target.value })}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.stopPropagation();
                const current = noteInputRef.current;
                const text = current?.value.trim() ?? '';
                if (current && text) {
                  commitAnnotation({ kind: 'note', points: [{ x: current.pt.x, y: current.pt.y }], text });
                }
                updateNoteInput(null);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                updateNoteInput(null);
              }
            }}
            style={{
              position: 'absolute', left: px.x, top: px.y, transform: 'translate(-50%, -50%)', zIndex: 5,
              minWidth: 150, maxWidth: 320, padding: '6px 8px', borderRadius: 6,
              border: `1.5px solid ${PLANNING_LAYER_COLORS.annotate}`, background: PLANNING_SURFACE.panelBg,
              color: PLANNING_SURFACE.panelText, fontSize: 12, fontFamily: 'system-ui, sans-serif',
              outline: 'none', resize: 'both', boxShadow: '0 2px 10px rgba(20, 20, 22, 0.16)',
            }}
          />
        );
      })()}

      {/* 2026-11-11 顶部工具条并入左栏图层卡（OnePlan 手风琴分组，用户拍板）。
          卡片收起或切到物件库页签时用这枚小 chip 提示当前模式，点击或 Esc 回浏览。 */}
      {!readOnly && mode !== 'view' && (
        <button
          type="button"
          data-testid="outdoor-mode-chip"
          onClick={() => setMode('view')}
          style={{
            position: 'absolute', top: levelsPanelHost ? 8 : 40, left: '50%', transform: 'translateX(-50%)', zIndex: 4,
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px',
            background: PLANNING_SURFACE.panelBg, border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
            borderRadius: PLANNING_RADIUS.md, color: PLANNING_SURFACE.panelText,
            fontSize: PLANNING_TYPOGRAPHY.row, cursor: 'pointer', pointerEvents: 'auto',
            boxShadow: '0 2px 8px rgba(20, 20, 22, 0.08)',
          }}
        >
          当前：{PLANNING_EDIT_MODE_LABELS[mode]} · Esc 返回浏览
        </button>
      )}

      {/* H3-c 规划信息面板：宿主在 Bingo 面板里；Bingo 收起时整块不渲染（不再在画布顶部拉成横条）。 */}
      {!(infoPanelHostId && !infoPanelHost) && <PanelPortal host={infoPanelHost}>
      <div ref={infoPanelRef} style={infoPanelStyle} onMouseDown={stopPanelMouse} onMouseUp={stopPanelMouse} onDoubleClick={stopPanelMouse}>
        <button
          type="button"
          data-testid="info-panel-toggle"
          onClick={() => setInfoOpen(open => !open)}
          style={{ all: 'unset', cursor: 'pointer', fontWeight: 600, display: 'block', width: '100%' }}
          aria-expanded={infoOpen}
        >
          规划信息 {infoOpen ? '▾' : '▸'}
        </button>
        {infoOpen && (
          <>
            <div role="tablist" aria-label="规划信息页签" style={{ display: 'flex', flexWrap: 'wrap', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.xs }}>
              {INFO_TABS.map(tab => {
                const TabIcon = planningIcon(PLANNING_INFO_TAB_ICONS[tab]);
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={infoTab === tab}
                    data-testid={`info-tab-${tab}`}
                    style={modeButtonStyle(infoTab === tab)}
                    onClick={() => setInfoTab(tab)}
                  >
                    <TabIcon size={PLANNING_ICON_SIZES.capsule} aria-hidden />
                    {INFO_TAB_LABELS[tab]}
                  </button>
                );
              })}
            </div>

            {infoTab === 'overview' && (
              <div data-testid="info-overview" style={{ lineHeight: 1.7 }}>
                <div style={sectionTitle}>全案统计</div>
                <div data-testid="info-overview-stats">
                  <div>场地面积 {formatAreaM2(overviewStats.boundaryAreaM2)}</div>
                  <div>分区 {overviewStats.zoneCount} · 设施 {overviewStats.facilityCount}</div>
                  <div>动线 {overviewStats.routeCount} 条 · 全长 {formatLengthM(overviewStats.routeLengthTotalM)}</div>
                  <div style={{ opacity: 0.85 }}>
                    人行 {formatLengthM(overviewStats.routeLengthMByKind.pedestrian)} · 车辆 {formatLengthM(overviewStats.routeLengthMByKind.vehicle)} · 后勤 {formatLengthM(overviewStats.routeLengthMByKind.service)}
                  </div>
                  <div>出入口 {overviewStats.nodeCount} · 人员 {overviewStats.workerTotalCount} 人 / {overviewStats.workerPostCount} 点</div>
                  <div>固定测量 {overviewStats.measurementCount}</div>
                  <div data-testid="info-issue-count">待处理问题 {overviewStats.issueCount + overviewStats.conflictCount}（冲突/缺失 {overviewStats.conflictCount}）</div>
                </div>
                <div style={sectionTitle}>当前可见（隐藏不改全案数字）</div>
                <div data-testid="info-visible-stats" style={{ opacity: 0.85 }}>
                  分区 {visibleCounts.zone} · 设施 {visibleCounts.facility} · 动线 {visibleCounts.route} · 出入口 {visibleCounts.node} · 人员 {visibleCounts.worker} · 测量 {visibleCounts.measurement} · 标注 {visibleCounts.annotation}
                </div>
              </div>
            )}

            {infoTab === 'inventory' && (
              <div data-testid="info-inventory">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.xs }}>
                  <select
                    aria-label="清单类型筛选"
                    value={invKind ?? 'all'}
                    onChange={event => setInvKind(event.target.value === 'all' ? 'all' : (event.target.value as PlanInventoryKind))}
                    style={selectStyle}
                  >
                    <option value="all">全部类型</option>
                    {(['zone', 'facility', 'route', 'node', 'worker', 'measurement', 'annotation'] as PlanInventoryKind[]).map(kind => (
                      <option key={kind} value={kind}>{planInventoryKindLabel(kind)}</option>
                    ))}
                  </select>
                  <select
                    aria-label="清单分区筛选"
                    value={invZone ?? 'all'}
                    onChange={event => setInvZone(event.target.value === 'all' ? undefined : event.target.value)}
                    style={selectStyle}
                  >
                    <option value="all">全部分区</option>
                    <option value="unassigned">未归属</option>
                    {levelView.zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input type="checkbox" checked={invIssuesOnly} onChange={event => setInvIssuesOnly(event.target.checked)} />
                    只看问题
                  </label>
                </div>
                <div data-testid="inventory-count" style={{ marginTop: PLANNING_SPACING.xs, opacity: 0.75 }}>
                  共 {filteredInventoryRows.length} 行 / 本层 {inventoryRows.length} 行
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {filteredInventoryRows.slice(0, PLAN_INFO_LIST_LIMIT).map(row => {
                    const selected = inventoryRowSelected(row);
                    return (
                      <li key={`${row.kind}-${row.id}`} data-inventory-id={row.id} data-testid="inventory-row">
                        <button type="button" onClick={() => locateRow(row)} style={inventoryRowButtonStyle(selected)} title="点击定位到地图">
                          {row.hasIssue && <span style={{ color: PLANNING_CONFLICT_COLORS.conflict }} title="命中问题/冲突清单">⚠</span>}
                          <span style={{ fontWeight: 600 }}>{row.name}</span>
                          <TypeCapsule kind={row.kind} label={row.typeLabel} />
                          {row.zoneName && <span style={{ opacity: 0.8 }}>{row.zoneName}</span>}
                          <span style={{ opacity: 0.85 }}>{row.metric}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {filteredInventoryRows.length > PLAN_INFO_LIST_LIMIT && (
                  <div style={{ opacity: 0.7 }}>其余 {filteredInventoryRows.length - PLAN_INFO_LIST_LIMIT} 行从略，可用筛选缩小范围。</div>
                )}
                {filteredInventoryRows.length === 0 && <div style={{ marginTop: PLANNING_SPACING.xs, opacity: 0.75 }}>没有符合筛选的行。</div>}
              </div>
            )}

            {infoTab === 'issues' && (
              <div data-testid="info-issues">
                {infoIssues.length === 0 ? (
                  <div style={{ marginTop: PLANNING_SPACING.xs, opacity: 0.8 }}>暂无待处理问题。</div>
                ) : (
                  <>
                    <div style={{ marginTop: PLANNING_SPACING.xs, opacity: 0.75 }}>共 {infoIssues.length} 条，点击条目定位：</div>
                    <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.6 }}>
                      {infoIssues.slice(0, PLAN_INFO_LIST_LIMIT).map(item => (
                        <li key={item.key}>
                          <button type="button" data-testid="info-issue-item" onClick={() => locateIssue(item)} style={issueButtonStyle(item.color)}>
                            {item.text}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {infoIssues.length > PLAN_INFO_LIST_LIMIT && (
                      <div style={{ opacity: 0.7 }}>其余 {infoIssues.length - PLAN_INFO_LIST_LIMIT} 条从略。</div>
                    )}
                  </>
                )}
              </div>
            )}

            {infoTab === 'legend' && (
              <div data-testid="info-legend">
                {legendGroups.map(group => (
                  <div key={group.title}>
                    <div style={sectionTitle}>{group.title}</div>
                    {group.entries.map(entry => {
                      return (
                        <div key={entry.label} data-testid="legend-entry" style={{ display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs, marginTop: 2 }}>
                          {/* H4-b：能对上 OnePlan 贴纸的条目用真实 SVG，其余/缺图回落 Lucide（entry.icon）。 */}
                          <OneplanSticker
                            sticker={entry.sticker ?? null}
                            fallbackIcon={entry.icon}
                            color={entry.swatch}
                            title={entry.label}
                          />
                          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: entry.swatch, display: 'inline-block' }} />
                          <span style={{ flex: 1 }}>{entry.label}</span>
                          <span>× {entry.count}</span>
                          {entry.detail && <span style={{ opacity: 0.75 }}>{entry.detail}</span>}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            <div role="status" aria-live="polite" style={{ marginTop: PLANNING_SPACING.sm, minHeight: 16, color: infoMessage ? PLANNING_SURFACE.warnText : 'transparent' }}>
              {infoMessage ?? '·'}
            </div>
          </>
        )}
      </div>
      </PanelPortal>}

      <PanelPortal host={layerPanelHost}>
      <div style={panelStyle} onMouseDown={stopPanelMouse} onMouseUp={stopPanelMouse} onDoubleClick={stopPanelMouse}>
        {/* 2026-11-11 OnePlan Placed Objects 镜像：头部计数 + 按类型分组的文件夹树。
            旧「图层栈与编辑/浏览/撤销/提示」清理掉——撤销走右栏工具排，浏览回 Esc，
            放置工具全在物件库页签（区域/入口/路线/基建/劳动力），本页签只管「画了什么」。 */}
        <button
          type="button"
          onClick={() => setPanelOpen(open => !open)}
          style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '3px 4px', borderRadius: PLANNING_RADIUS.sm, color: PLANNING_SURFACE.panelText, fontWeight: 600 }}
          aria-expanded={panelOpen}
        >
          <LibraryFooterIcon size={14} aria-hidden color={PLANNING_SURFACE.panelText} />
          <span style={{ flex: 1 }}>已放置物件</span>
          <span style={{ opacity: 0.7, fontWeight: 400, fontSize: PLANNING_TYPOGRAPHY.hint }}>({inventoryRows.length}/{libraryTotal})</span>
          <span aria-hidden style={{ fontSize: 10 }}>{panelOpen ? '▾' : '▸'}</span>
        </button>
        {panelOpen && (
          <>
            {/* 全局行：浏览 + 撤销——只在独立工作台（无宿主、浮窗形态）保留；
                主产品里去掉（2026-11-11 用户指令：撤销/浏览右栏工具排已经有了，Esc 也可回浏览）。 */}
            {!readOnly && !layerPanelHost && (
              <div style={{ display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.xs }}>
                <button
                  type="button"
                  aria-pressed={mode === 'view'}
                  data-testid="edit-mode-view"
                  style={modeButtonStyle(mode === 'view')}
                  onClick={() => setMode('view')}
                >
                  <ViewModeIcon size={PLANNING_ICON_SIZES.tool} aria-hidden />
                  {PLANNING_EDIT_MODE_LABELS.view}
                </button>
                {/* 2026-11-12 B1 OnePlan Selection tool：浏览旁并列「选择」（S/H 快捷键；hosted 态右栏工具排也有同款钮）。 */}
                <button
                  type="button"
                  aria-pressed={mode === 'select'}
                  data-testid="edit-mode-select"
                  style={modeButtonStyle(mode === 'select')}
                  onClick={() => setMode(mode === 'select' ? 'view' : 'select')}
                  title="选择（S）：拖框多选设施，整组移动/缩放"
                >
                  <SelectModeIcon size={PLANNING_ICON_SIZES.tool} aria-hidden />
                  {PLANNING_EDIT_MODE_LABELS.select}
                </button>
                <button
                  type="button"
                  data-testid="plan-undo"
                  aria-label="撤销上一步"
                  disabled={historyCount === 0}
                  style={{ ...modeButtonStyle(false), opacity: historyCount === 0 ? 0.5 : 1 }}
                  onClick={() => undoPlan()}
                >
                  <UndoIcon size={PLANNING_ICON_SIZES.tool} aria-hidden />
                  撤销
                </button>
              </div>
            )}

            {/* 2026-11-11 用户指令：测量区上移（图层行下方、页签上方，独立宿主常驻）；
                无宿主时回落此处（已放置物件面板内，Level 行下方的旧形态）。 */}
            {!measurePanelHost && measureZone}
            {/* 2026-11-11 用户指令：标注区回落（有独立宿主时 portal 到测量区下方）。 */}
            {!annotatePanelHost && annotateZone}

            {/* 底图作为图层栈最底层，开关同时作用于 2D 画布和 3D 场地。 */}
            <div style={{ marginTop: PLANNING_SPACING.xs }}>
              <div style={{ display: "flex", alignItems: "center", gap: PLANNING_SPACING.xs }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, padding: "3px 4px", color: PLANNING_SURFACE.panelText, fontSize: 13 }}>
                  <span aria-hidden style={{ width: 16, height: 16, flex: "0 0 auto", borderRadius: 4, background: "#8aa0ad", boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.55)" }} />
                  <span style={{ flex: 1 }}>底图</span>
                </div>
                <input
                  type="checkbox"
                  aria-label="显示底图"
                  data-testid="layer-visible-basemap"
                  checked={basemapVisible}
                  onChange={(event) => {
                    const visible = event.target.checked;
                    basemapVisibleRef.current = visible;
                    setBasemapVisible(visible);
                    draw();
                  }}
                />
              </div>
            </div>

            {/* 按类型分组的文件夹树（OnePlan folders tree）：文件夹行尾收编可见性/锁定
                （多类型同层时读写同一层状态，自动同步）；实例行点击定位+选中。 */}
            {placedFolderRows.map(folder => {
              const open = openFolders[folder.key] !== false;
              const layerKind = LAYER_OF_INVENTORY_KIND[folder.kind];
              const locked = lockedLayers[layerKind] === true;
              const LockIcon = planningIcon(locked ? 'lock' : 'lock-open');
              return (
                <div key={folder.key} style={{ marginTop: PLANNING_SPACING.xs }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs }}>
                    <button
                      type="button"
                      data-testid={`placed-folder-${folder.key}`}
                      aria-expanded={open}
                      title={`展开/收起${folder.label}`}
                      onClick={() => setOpenFolders(prev => ({ ...prev, [folder.key]: !open }))}
                      style={{
                        all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                        flex: 1, minWidth: 0, padding: '3px 4px', borderRadius: PLANNING_RADIUS.sm,
                        color: PLANNING_SURFACE.panelText, fontSize: 13, fontWeight: 400,
                      }}
                    >
                      <span aria-hidden style={{ fontSize: 10, width: 10 }}>{open ? '▾' : '▸'}</span>
                      {renderLayerEntityIcon(folder.rows[0])}
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder.label}</span>
                      <span style={{ opacity: 0.6, fontSize: 11 }}>{folder.rows.length}</span>
                    </button>
                    <input
                      type="checkbox"
                      aria-label={`显示${folder.label}图层`}
                      checked={layerState[layerKind]}
                      onChange={event => setLayerVisible(layerKind, event.target.checked)}
                    />
                    {/* P2-i 图层锁定：锁定后该层不参与点选/拖动（显示与统计不变）。 */}
                    {!readOnly && (
                      <button
                        type="button"
                        data-testid={`layer-lock-${layerKind}`}
                        aria-label={`${locked ? '解锁' : '锁定'}${PLANNING_LABELS[layerKind]}图层`}
                        aria-pressed={locked}
                        title={locked ? '解锁图层（恢复可编辑）' : '锁定图层（只读，不可选中或拖动）'}
                        onClick={() => setLayerLocked(layerKind, !locked)}
                        style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', padding: 2, borderRadius: PLANNING_RADIUS.sm, color: locked ? PLANNING_SURFACE.warnText : PLANNING_SURFACE.panelText, opacity: locked ? 1 : 0.4 }}
                      >
                        <LockIcon size={PLANNING_ICON_SIZES.tool} aria-hidden />
                      </button>
                    )}
                  </div>
                  {open && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {folder.rows.map(row => renderOneplanItemRow({
                        key: `${row.kind}-${row.id}`,
                        testId: `layer-entity-${row.kind}-${row.id}`,
                        label: row.name,
                        active: inventoryRowSelected(row),
                        onClick: () => locateRow(row),
                        onContextMenu: event => { event.preventDefault(); deleteRow(row); },
                        title: '点击定位到地图；右键或 Delete 删除',
                        icon: renderLayerEntityIcon(row),
                        trailing: <TypeCapsule kind={row.kind} label={row.typeLabel} />,
                      }))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* 场地边界文件夹（边界不在 inventory 里，单独一行）。 */}
            <div style={{ marginTop: PLANNING_SPACING.xs }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs }}>
                <button
                  type="button"
                  data-testid="placed-folder-boundary"
                  aria-expanded={openFolders['boundary'] !== false}
                  onClick={() => setOpenFolders(prev => ({ ...prev, boundary: !(prev.boundary !== false) }))}
                  style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, padding: '3px 4px', borderRadius: PLANNING_RADIUS.sm, color: PLANNING_SURFACE.panelText, fontSize: 13, fontWeight: 400 }}
                >
                  <span aria-hidden style={{ fontSize: 10, width: 10 }}>{openFolders['boundary'] !== false ? '▾' : '▸'}</span>
                  <span aria-hidden style={{ width: 16, height: 16, flex: '0 0 auto', borderRadius: 4, background: PLANNING_LAYER_COLORS.boundary, boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.55)' }} />
                  <span style={{ flex: 1 }}>场地边界</span>
                  <span style={{ opacity: 0.6, fontSize: 11 }}>{plan.boundary.length}</span>
                </button>
                <input
                  type="checkbox"
                  aria-label="显示场地边界图层"
                  checked={layerState.boundary}
                  onChange={event => setLayerVisible('boundary', event.target.checked)}
                />
                {!readOnly && (() => {
                  const locked = lockedLayers['boundary'] === true;
                  const LockIcon = planningIcon(locked ? 'lock' : 'lock-open');
                  return (
                    <button
                      type="button"
                      data-testid="layer-lock-boundary"
                      aria-label={`${locked ? '解锁' : '锁定'}场地边界图层`}
                      aria-pressed={locked}
                      onClick={() => setLayerLocked('boundary', !locked)}
                      style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', padding: 2, borderRadius: PLANNING_RADIUS.sm, color: locked ? PLANNING_SURFACE.warnText : PLANNING_SURFACE.panelText, opacity: locked ? 1 : 0.4 }}
                    >
                      <LockIcon size={PLANNING_ICON_SIZES.tool} aria-hidden />
                    </button>
                  );
                })()}
              </div>
              {openFolders['boundary'] !== false && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {plan.boundary.length === 0 ? (
                    <div style={{ paddingLeft: 30, opacity: 0.7, fontSize: PLANNING_TYPOGRAPHY.hint }}>
                      还没画边界——物件库 → 区域 → 场地边界
                    </div>
                  ) : (
                    renderOneplanItemRow({
                      key: 'layer-entity-boundary',
                      testId: 'layer-entity-boundary',
                      label: `场地边界（${plan.boundary.length} 点）`,
                      active: false,
                      onClick: () => {
                        const cx = plan.boundary.reduce((s, p) => s + p.x, 0) / plan.boundary.length;
                        const cy = plan.boundary.reduce((s, p) => s + p.y, 0) / plan.boundary.length;
                        centerViewOn({ x: cx, y: cy });
                      },
                      title: '点击定位到边界',
                      icon: <span aria-hidden style={{ width: 16, height: 16, flex: '0 0 auto', borderRadius: 4, background: PLANNING_LAYER_COLORS.boundary, boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.55)' }} />,
                    })
                  )}
                </div>
              )}
            </div>

            {/* H2-d 人员汇总已按 OnePlan 纯度移除（2026-11-11 用户拍板）；汇总口径仍可在规划信息卡统计里看。 */}

            {/* 2026-11-11 用户指令：选中物体的编辑已移到画布右上角「工具与属性」浮窗；独立工作台（无宿主）仍留在这里。 */}
            {!outdoorInspectorActive && selectionInspectorZone}

            <div style={{ marginTop: PLANNING_SPACING.sm, opacity: 0.75, fontSize: PLANNING_TYPOGRAPHY.hint }}>缩放 z{view.zoom}{readOnly ? ' · 只读浏览' : ''}</div>
          </>
        )}
      </div>
      </PanelPortal>

      {/* P2-h 物件库（左栏第三个页签）：549 件 OnePlan 贴纸在界面上被看见、被搜索、被点选放置。
          没有宿主 id 时（独立演示页 /outdoor-plan）也直接内联渲染，否则演示页里根本看不到目录。 */}
      {(!libraryPanelHostId || libraryPanelHost) && (
        <PanelPortal host={libraryPanelHost}>
          <div
            style={{
              ...panelStyle,
              // 2026-11-11 用户指令：footer 钉在卡片底部——hosted 卡 flex column 撑满宿主，树体 flex 滚动。
              ...(panelInline ? { display: 'flex', flexDirection: 'column', height: '100%' } : {}),
            }}
            onMouseDown={stopPanelMouse}
            onMouseUp={stopPanelMouse}
            onDoubleClick={stopPanelMouse}
            data-testid="outdoor-library-panel"
          >
            {/* 2026-11-11：顶层页签已按 OnePlan 分工（左栏=添加物件/已放置物件），卡片内不再嵌套页签。 */}
            {libraryStatus === 'failed' && (
              <div style={{ marginTop: PLANNING_SPACING.xs, color: PLANNING_SURFACE.dangerText, fontSize: PLANNING_TYPOGRAPHY.hint }}>
                物件库清单加载失败（/oneplan-icons/manifest.json），刷新页面重试。
              </div>
            )}
            {/* 2026-11-12 底部「物件库」进包浏览（OnePlan marketplace 镜像）：包列表 / 包详情；← 返回树。 */}
            {libraryView === 'packs' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.xs }}>
                  <button
                    type="button"
                    data-testid="packs-view-back"
                    onClick={() => { if (openPackId) setOpenPackId(null); else setLibraryView('tree'); }}
                    style={{
                      all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
                      padding: '2px 8px', borderRadius: PLANNING_RADIUS.sm,
                      border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
                      color: PLANNING_SURFACE.panelText, fontSize: PLANNING_TYPOGRAPHY.hint,
                    }}
                  >
                    ←
                  </button>
                  <strong style={{ flex: 1, fontSize: PLANNING_TYPOGRAPHY.row, color: PLANNING_SURFACE.panelText }}>
                    {openPackId ? (packGroups.find(p => p.id === openPackId)?.nameZh ?? '物件库') : '物件库'}
                  </strong>
                </div>
                <div style={{ marginTop: PLANNING_SPACING.xs, overflowY: 'auto', overflowX: 'hidden', paddingRight: 2, ...(panelInline ? { flex: 1, minHeight: 0 } : { maxHeight: 430 }) }}>
                  {openPackId ? (
                    (() => {
                      const pack = packGroups.find(p => p.id === openPackId);
                      return pack ? renderPackItemRows(pack.items) : null;
                    })()
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {packGroups.map(pack => (
                        <Fragment key={pack.id}>
                          {renderOneplanPackRow({
                            pack,
                            open: false,
                            onToggle: () => setOpenPackId(pack.id),
                            variant: 'market',
                          })}
                        </Fragment>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
            <>
              <input
                  value={libraryQuery}
                  onChange={event => setLibraryQuery(event.target.value)}
                  placeholder="搜索物件（中文 / English / slug）"
                  aria-label="搜索物件"
                  style={{
                    width: '100%',
                    marginTop: PLANNING_SPACING.xs,
                    padding: '4px 6px',
                    borderRadius: PLANNING_RADIUS.sm,
                    border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
                    background: PLANNING_SURFACE.fieldBg,
                    color: 'inherit',
                    fontSize: PLANNING_TYPOGRAPHY.hint,
                  }}
                />
                <div style={{ marginTop: PLANNING_SPACING.xs, overflowY: 'auto', overflowX: 'hidden', paddingRight: 2, ...(panelInline ? { flex: 1, minHeight: 0 } : { maxHeight: 430 }) }}>
                  {libraryQuery.trim() !== '' ? (
                    /* 搜索态：跨三段的结果，按用户目录分组（不再走 17 类折叠）。 */
                    librarySearchResults.length === 0 ? (
                      <div style={{ opacity: 0.75, fontSize: PLANNING_TYPOGRAPHY.hint }}>没有匹配「{libraryQuery}」的物件。</div>
                    ) : (
                      librarySearchResults.map(bucket => (
                        <div key={bucket.label} style={{ marginTop: PLANNING_SPACING.xs }}>
                          <div style={{ display: 'flex', gap: PLANNING_SPACING.xs, fontSize: PLANNING_TYPOGRAPHY.hint, fontWeight: 600 }}>
                            <span style={{ flex: 1 }}>{bucket.label}</span>
                            <span style={{ opacity: 0.7, fontWeight: 400 }}>{bucket.items.length}</span>
                          </div>
                          {renderOneplanStickerRows(bucket.items)}
                        </div>
                      ))
                    )
                  ) : (
                    <>
                      {/* 1. 区域、路线及交通 → 区域（9 语义）/ 入口和通道图标 / 路线（3 类） */}
                      {renderOneplanGroupHeader({
                        id: 'areas',
                        label: AREA_ROW_LABEL,
                        count: planZoneSemantics.length + libraryEntranceIcons.length + 1 + planRouteKinds.length,
                        icon: 'route',
                      })}
                      {openLibrarySections.includes('areas') && (
                        <>
                          {renderOneplanSubgroupHeader({ sectionId: 'areas', key: '区域', label: '区域', count: planZoneSemantics.length + 1, icon: 'hexagon' })}
                          {openLibrarySubgroups.includes('areas:区域') && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {/* 2026-11-11：边界重画入口回归（起步矩形是自动送的，用户可以整体重画）。 */}
                              {renderOneplanItemRow({
                                key: 'catalog-boundary',
                                testId: 'catalog-boundary',
                                label: plan.boundary.length > 0 ? '场地边界（重画）' : '场地边界',
                                active: mode === 'boundary',
                                onClick: () => startAreaTool('boundary'),
                                title: '沿场地单击加顶点，闭合后替换旧边界',
                                icon: <span aria-hidden style={{ width: 22, height: 22, flex: '0 0 auto', borderRadius: 6, background: PLANNING_LAYER_COLORS.boundary, boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.55)' }} />,
                              })}
                              {planZoneSemantics.map(s => renderOneplanItemRow({
                                key: `zone-${s}`,
                                testId: `catalog-zone-${s}`,
                                label: planZoneSemanticLabels[s],
                                active: mode === 'zone' && zoneSemantic === s,
                                onClick: () => { setZoneSemantic(s); startAreaTool('zone'); },
                                icon: <span aria-hidden style={{ width: 22, height: 22, flex: '0 0 auto', borderRadius: 6, background: PLANNING_ZONE_COLORS[s], boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.55)' }} />,
                              }))}
                            </div>
                          )}
                          {renderOneplanSubgroupHeader({ sectionId: 'areas', key: '入口和通道图标', label: '入口和通道图标', count: libraryEntranceIcons.length + 1, icon: 'door-open' })}
                          {openLibrarySubgroups.includes('areas:入口和通道图标') && (
                            <>
                              {renderOneplanItemRow({
                                key: 'catalog-node-row',
                                testId: 'catalog-area-node',
                                label: '出入口节点',
                                active: mode === 'node',
                                onClick: () => startAreaTool('node'),
                                icon: <NodeToolIcon size={16} aria-hidden color={PLANNING_LAYER_COLORS.access} />,
                              })}
                              {renderOneplanStickerRows(libraryEntranceIcons)}
                            </>
                          )}
                          {renderOneplanSubgroupHeader({ sectionId: 'areas', key: '路线', label: '路线', count: planRouteKinds.length, icon: 'route' })}
                          {openLibrarySubgroups.includes('areas:路线') && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {planRouteKinds.map(k => renderOneplanItemRow({
                                key: `route-${k}`,
                                testId: `catalog-route-${k}`,
                                label: planRouteKindLabels[k],
                                active: mode === 'route' && routeKind === k,
                                onClick: () => { routeKindRef.current = k; setRouteKind(k); draw(); startAreaTool('route'); },
                                icon: <span aria-hidden style={{ width: 22, height: 22, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ width: 16, height: 5, borderRadius: 3, background: PLANNING_ROUTE_KIND_COLORS[k] }} /></span>,
                              }))}
                            </div>
                          )}
                        </>
                      )}

                      {/* 2. 基础设施 → 17 个子组（OnePlan Infrastructure 镜像） */}
                      {renderOneplanGroupHeader({
                        id: 'infra',
                        label: INFRA_ROW_LABEL,
                        count: libraryInfra.reduce((sum, bucket) => sum + bucket.items.length, 0),
                        icon: 'tent',
                      })}
                      {openLibrarySections.includes('infra') && (
                        <>
                          {libraryInfra.map(bucket => (
                            <div key={bucket.label}>
                              {renderOneplanSubgroupHeader({ sectionId: 'infra', key: bucket.label, label: bucket.label, count: bucket.items.length })}
                              {openLibrarySubgroups.includes(`infra:${bucket.label}`) && renderOneplanStickerRows(bucket.items)}
                            </div>
                          ))}
                          {/* 2026-11-11 用户 m00575：17 个基建类目要能一次全摊开对比。 */}
                          {libraryInfra.length > 0 && (
                            <div style={{ display: 'flex', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.xs }}>
                              <button
                                type="button"
                                data-testid="catalog-infra-expand-all"
                                onClick={() => setOpenLibrarySubgroups(prev => Array.from(new Set([...prev, ...libraryInfra.map(bucket => `infra:${bucket.label}`)])))}
                                style={{
                                  all: 'unset', cursor: 'pointer', padding: '2px 6px', borderRadius: PLANNING_RADIUS.sm,
                                  border: `1px solid ${PLANNING_SURFACE.panelBorder}`, color: PLANNING_SURFACE.panelText,
                                  fontSize: PLANNING_TYPOGRAPHY.hint,
                                }}
                              >
                                展开全部类目
                              </button>
                              <button
                                type="button"
                                data-testid="catalog-infra-collapse-all"
                                onClick={() => setOpenLibrarySubgroups(prev => prev.filter(key => !key.startsWith('infra:')))}
                                style={{
                                  all: 'unset', cursor: 'pointer', padding: '2px 6px', borderRadius: PLANNING_RADIUS.sm,
                                  border: `1px solid ${PLANNING_SURFACE.panelBorder}`, color: PLANNING_SURFACE.panelText,
                                  fontSize: PLANNING_TYPOGRAPHY.hint,
                                }}
                              >
                                收起全部
                              </button>
                            </div>
                          )}
                          {libraryInfra.length === 0 && (
                            <div style={{ marginTop: PLANNING_SPACING.xs, opacity: 0.75, fontSize: PLANNING_TYPOGRAPHY.hint }}>物件库还没有载入完成。</div>
                          )}
                        </>
                      )}

                      {/* 3. 劳动力 → 9 个岗位行（OnePlan Workforce 彩色图标镜像） */}
                      {renderOneplanGroupHeader({ id: 'labor', label: LABOR_ROW_LABEL, count: LABOR_ROLES.length, icon: 'users' })}
                      {openLibrarySections.includes('labor') && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {LABOR_ROLES.map(role => {
                            const sticker = workerSticker(role) ?? { kind: 'icon' as const, slug: 'information-point', icon: 'users' as const };
                            return renderOneplanItemRow({
                              key: `labor-${role}`,
                              testId: `catalog-labor-${role}`,
                              label: role,
                              active: mode === 'worker' && workerRole === role,
                              onClick: () => startLaborRole(role),
                              icon: (
                                <span
                                  aria-hidden
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: 22,
                                    height: 22,
                                    flex: '0 0 auto',
                                    borderRadius: 999,
                                    background: '#23252c',
                                  }}
                                >
                                  <img src={oneplanStickerSrc(sticker)} alt="" width={16} height={16} loading="lazy" style={{ display: 'block' }} />
                                </span>
                              ),
                            });
                          })}
                        </div>
                      )}

                      {/* 4. 活动包与图元：OnePlan marketplace 的五个活动包（物件级）+ 中国节庆包按包分列，
                          图元/未映射条目收进「图元与其它」子组，不再拍平混排。 */}
                      {renderOneplanGroupHeader({
                        id: 'extra',
                        label: '活动包与图元',
                        count: packEntries.length + (libraryExtra[0]?.items.length ?? 0),
                        icon: 'shapes',
                      })}
                      {openLibrarySections.includes('extra') && (
                        <>
                          {packGroups.map(pack => {
                            const subgroupKey = `extra:pack-${pack.id}`;
                            const open = openLibrarySubgroups.includes(subgroupKey);
                            return (
                              <div key={pack.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {renderOneplanPackRow({
                                  pack,
                                  open,
                                  onToggle: () => setOpenLibrarySubgroups(prev => (prev.includes(subgroupKey) ? prev.filter(k => k !== subgroupKey) : [...prev, subgroupKey])),
                                })}
                                {open && renderPackItemRows(pack.items)}
                              </div>
                            );
                          })}
                          {libraryExtra[0] && (
                            <>
                              {renderOneplanSubgroupHeader({ sectionId: 'extra', key: 'primitives', label: EXTRA_ROW_LABEL, count: libraryExtra[0].items.length, icon: 'shapes' })}
                              {openLibrarySubgroups.includes('extra:primitives') && renderOneplanStickerRows(libraryExtra[0].items)}
                            </>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
            {/* 底部条（OnePlan "Object library" 镜像）：点击进包浏览视图。 */}
            <button
              type="button"
              data-testid="library-footer"
              onClick={() => { setLibraryView('packs'); setOpenPackId(null); }}
              style={{
                all: 'unset',
                cursor: 'pointer',
                boxSizing: 'border-box',
                marginTop: 'auto',
                width: '100%',
                borderTop: `1px solid ${PLANNING_SURFACE.panelBorder}`,
                paddingTop: PLANNING_SPACING.xs,
                display: 'flex',
                alignItems: 'center',
                gap: PLANNING_SPACING.xs,
                fontSize: PLANNING_TYPOGRAPHY.row,
                fontWeight: 600,
                color: PLANNING_SURFACE.panelText,
              }}
            >
              <LibraryFooterIcon size={14} aria-hidden color={PLANNING_SURFACE.panelText} />
              物件库
              <span style={{ opacity: 0.7, fontWeight: 400, fontSize: PLANNING_TYPOGRAPHY.hint }}>
                {libraryStatus === 'ready' ? `${libraryTotal} 件` : libraryStatus === 'loading' ? '载入中…' : ''}
              </span>
            </button>
            </>
            )}
          </div>
        </PanelPortal>
      )}
      {/* 2026-11-12 用户指令「三个按钮对应的卡片要拆开」：测量 / 标注 / 属性 各自一张独立卡片，
          各自展开收起、可同时存在；不再用一张卡 + 页签把它们绑在一起。
          2026-11-12 晚（用户：图标统一 / 视觉 / 好用一点的交互）：右轨与卡头共用 OUTDOOR_TOOL_ICONS，
          卡头可折叠、右上角可关闭，颜色按工具的图层色点睛。 */}
      {outdoorInspectorActive && (() => {
        const cards: {
          key: OutdoorToolKey;
          label: string;
          accent: string;
          count: number;
          testId: string;
          body: React.ReactNode;
        }[] = [
          {
            key: 'measure',
            label: '测量',
            accent: PLANNING_LAYER_COLORS.measure,
            count: levelView.measurements?.length ?? 0,
            testId: 'outdoor-inspector-card-measure',
            body: measureZone ?? <div style={{ opacity: 0.6, fontSize: 12 }}>只读浏览时不能测量。</div>,
          },
          {
            key: 'annotate',
            label: '标注',
            accent: PLANNING_LAYER_COLORS.annotate,
            count: levelView.annotations?.length ?? 0,
            testId: 'outdoor-inspector-card-annotate',
            body: annotateZone ?? <div style={{ opacity: 0.6, fontSize: 12 }}>只读浏览时不能标注。</div>,
          },
          {
            key: 'selection',
            label: '属性',
            accent: PLANNING_LAYER_COLORS.boundary,
            count: selectionInspectorCount,
            testId: 'outdoor-inspector-card-selection',
            // 2026-11-12：未选中实体时 selectionInspectorZone 只剩一行 aria-live 占位（'·'），
            // 卡片会显示一个孤零零的点。改成按选中数量决定：无选中 → 空状态引导。
            body: selectionInspectorCount > 0
              ? selectionInspectorZone
              : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '18px 8px', textAlign: 'center', color: PLANNING_TEXT.muted }}>
                  <span aria-hidden style={{ width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center', background: PLANNING_SURFACE.fieldBg, color: PLANNING_TEXT.muted }}>
                    <MaterialSymbol name={OUTDOOR_TOOL_ICONS.selection} size={18} />
                  </span>
                  <span style={{ fontSize: 12, lineHeight: 1.6 }}>在图上点选分区 / 设施 / 动线 / 出入口 / 人员，<br />这里会出现它的属性。</span>
                </div>
              ),
          },
        ];
        const visible = cards.filter(card => inspectorPanels[card.key]);
        if (visible.length === 0) {
          // 收起态不再画画布内浮条（入口在右轨圆钮，属性随选中实体自动浮出）。
          return null;
        }
        // 2026-11-12「3D 的时候也要可编辑」：接管态传了 inspectorHostId 时卡片 portal 出
        // 隐藏覆盖层出镜；2D 卡内无宿主，原地渲染不变。
        return (
          <PanelPortal host={inspectorPanelHost}>
          <div
            data-testid="outdoor-inspector-stack"
            style={{
              position: 'absolute', right: 96, top: 12, zIndex: 6,
              pointerEvents: 'auto',
              display: 'flex', flexDirection: 'column', gap: 8,
              width: 'min(300px, calc(100% - 96px))',
              maxHeight: 'calc(100% - 24px)',
            }}
          >
            {visible.map(card => {
              const collapsed = inspectorCollapsed[card.key];
              return (
                <section
                  key={card.key}
                  data-testid={card.testId}
                  data-collapsed={collapsed ? 'true' : 'false'}
                  role="complementary"
                  aria-label={`${card.label}卡片`}
                  className="sc-outdoor-toolcard"
                  style={{
                    flex: '0 0 auto',
                    display: 'flex', flexDirection: 'column', minHeight: 0,
                    background: PLANNING_SURFACE.panelBg,
                    border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
                    borderRadius: 12,
                    boxShadow: '0 10px 26px rgba(20, 24, 32, 0.10)',
                    overflow: 'hidden',
                    color: PLANNING_SURFACE.panelText,
                    fontSize: PLANNING_TYPOGRAPHY.panel,
                  }}
                  onMouseDown={stopPanelMouse}
                  onMouseUp={stopPanelMouse}
                  onDoubleClick={stopPanelMouse}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 6px 6px 8px' }}>
                    <button
                      type="button"
                      onClick={() => toggleInspectorCollapsed(card.key)}
                      aria-expanded={!collapsed}
                      aria-label={`${collapsed ? '展开' : '折叠'}${card.label}卡片`}
                      title={collapsed ? '展开' : '折叠'}
                      className="sc-outdoor-toolcard-btn"
                      style={{
                        cursor: 'pointer', flex: 1, minWidth: 0,
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '3px 6px 3px 4px', borderRadius: 8,
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 26, height: 26, flex: '0 0 auto', borderRadius: 8,
                          display: 'grid', placeItems: 'center',
                          background: `${card.accent}1a`, color: card.accent,
                        }}
                      >
                        <MaterialSymbol name={OUTDOOR_TOOL_ICONS[card.key]} size={16} />
                      </span>
                      <span style={{ fontWeight: 600, letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>{card.label}</span>
                      {card.count > 0 && (
                        <span
                          aria-hidden
                          // 2026-11-12 用户采纳视觉建议：计数角标随卡片主题色（与图标块同源），不再用灰底。
                          style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: withAlphaHex(card.accent, 0.14), color: card.accent, fontSize: 10, fontWeight: 600, lineHeight: '18px', textAlign: 'center' }}
                        >
                          {card.count}
                        </span>
                      )}
                      <span aria-hidden style={{ marginLeft: 'auto', display: 'grid', placeItems: 'center', color: PLANNING_TEXT.muted, transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 140ms ease' }}>
                        <MaterialSymbol name="keyboard_arrow_down" size={18} />
                      </span>
                    </button>
                    <button
                      type="button"
                      data-testid={`${card.testId}-collapse`}
                      aria-label={`关闭${card.label}卡片`}
                      title="关闭"
                      onClick={() => setInspectorPanel(card.key, false)}
                      className="sc-outdoor-toolcard-btn"
                      style={{ cursor: 'pointer', width: 28, height: 28, flex: '0 0 auto', borderRadius: 8, display: 'grid', placeItems: 'center', color: '#3f4448' }}
                    >
                      <MaterialSymbol name="close" size={18} />
                    </button>
                  </div>
                  {!collapsed && (
                    <div style={{ minHeight: 0, overflowY: 'auto', maxHeight: '46vh', padding: '0 12px 12px' }}>{card.body}</div>
                  )}
                </section>
              );
            })}
          </div>
          </PanelPortal>
        );
      })()}

    </div>
  );
});

export default OutdoorPlanCanvasImpl;
