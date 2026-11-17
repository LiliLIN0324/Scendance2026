'use client';
import { validateWorkflowPlan } from '../lib/outdoor-agent-planning';
import type { OutdoorEvidenceHighlight } from '../lib/outdoor-map-context';
import type { OutdoorMapEditHighlight } from '../lib/outdoor-agent-contract';
import { boundaryAtNewAnchor, canReanchorOutdoorPlan, planForPickedVenue } from '../lib/outdoor-plan-protection';
import { CAR_ROW_LABEL, PLAN_VEHICLE_ROW_LABEL, VEHICLE_TYPES } from '../lib/vehicle-types';
import { vehicleLabelOf } from '../lib/vehicle-entities';

import type { BackendSession } from '@/lib/backend-session';

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
 * - 测量模式两类型：距离（单击两点、或按住拖线自动固定；可继续加点成多段折线）/ 面积（单击描点近首点闭合、
 *   或按住对角拖矩形，Shift 正方形）；2026-11-17 用户「距离和路径一样，把路径删掉」后路径入口已下线。
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

import { forwardRef, Fragment, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
  ArrowLeftRight,
  ArrowRight,
  ArrowRightLeft,
  ImageUp,
  Sparkles,
  Upload,
} from 'lucide-react';
import { BasemapTileCache, paintBasemapTiles } from '@/components/room-organizer/lib/plan-tile-cache';
// B3：2D 人位按 3D 漫游态换色（进区青 / 落座琥珀）。只读注册表，不反向驱动 3D。
import { subscribePersonRoam, workerRoamState } from '@/components/room-organizer/three/people-anim';
import {
  defaultLayerVisibility,
  drawAccessLayer,
  drawAnnotationDraft,
  drawAnnotationLayer,
  drawBoundaryLayer,
  boundaryHaloToneFor,
  drawBranchAnchor,
  drawRouteKindChip,
  findRouteBranchAnchor,
  drawMapEditHighlight,
  drawBuildingLayer,
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
  drawDesignScopeMask,
  drawBoundaryEditHints,
  drawScopeLockButton,
  drawFlowSimulationLayer,
  drawSearchArea,
  drawSearchPin,
  drawSceneObjectsLayer,
  drawWorkerLayer,
  drawZoneLayer,
  drawZoneProposalLayer,
  type PlanBasemapTone,
  enuToLngLat,
  facilityPlacementGhost,
  hexWithAlpha,
  isLayerVisible,
  lngLatToEnu,
  placedItemsNeedsRedlineHint,
  placedRedlineCount,
  planMetersPerPixel,
  planPixelToPoint,
  planPointToPixel,
  hitScopeLockButton,
  scopeLockButtonRect,
  type LayerVisibility,
  type PlanViewport,
} from '../lib/outdoor-plan-canvas';
import { vehicleMarkerSpecs } from '../lib/vehicle-markers';
import {
  DEFAULT_SCOPE_MARGIN_M,
  expandRect,
  rectBigEnough,
  rectRing,
  resizeScopeEdge,
  nearestScopeEdgePx,
  scopeAreaM2,
  scopeContainsPoint,
  scopeEdgeIsHorizontal,
  scopeEdgeLabel,
  scopeForAppliedPlan,
  syncScopeForBoundary,
  type ScopeEdge,
} from '../lib/outdoor-design-scope';
import { createFlowWalkers, stepFlowWalkers, walkerPoints, routeDensity, type FlowWalker } from '../lib/flow-sim';
import {
  PLAN_CONFLICT_CATEGORY_LABELS,
  groupConflictIssues,
  planConflictIssues,
  type PlanConflictCluster,
  type PlanConflictIssue,
} from '../lib/site-plan-conflicts';
import {
  PLAN_MIN_VERTEX_GAP_M,
  PLAN_MIN_ZONE_AREA_M2,
  PLAN_RING_MAX_VERTICES,
  buildZone,
  checkBoundaryRing,
  defaultZoneColor,
  insertRingVertex,
  moveRingVertex,
  planPointDistanceM,
  planPointInRing,
  planRingSelfIntersects,
  planZoneIssues,
  removeRingVertex,
  zoneEditBlockingIssue,
  type PlanEditIssue,
  type PlanZoneIssue,
} from '../lib/site-plan-editing';
import { planBoundaryFromSearchArea } from '../lib/outdoor-venue-sync';
import { findZoneBoundsOverflow, zoneOverflowReason, type ZoneBoundsOverflow } from '../lib/plan-zone-bounds';
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
  facilitiesFootprintsIntersect,
  facilitySideResize,
  facilityUniformCornerResize,
  findFacilityTemplate,
  planFacilityIssues,
  type FacilityAlignMode,
  type FacilityCornerIndex,
  type FacilitySideIndex,
  type PlanFacilityIssue,
  type PlanFacilityTemplate,
  type PlanRect,
} from '../lib/site-plan-facilities';
import { resolveFacilityTemplate } from '../lib/plan-facility-catalog';
import { clearPlanFacilityDrag, getPlanFacilityDrag, setPlanFacilityDrag } from '../lib/plan-facility-drag';
import { clearPlanCatalogDrag, getPlanCatalogDrag, parsePlanCatalogDrag, PLAN_CATALOG_DRAG_MIME, type PlanCatalogDrag } from '../lib/plan-catalog-drag';
import { CATALOG_DRAG_MIME } from '../lib/catalog-drag';
import {
  FACILITY_GENERATE_POLL_MS,
  findGeneratedFacilityModel,
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
import { openGenerationSheet } from '../lib/generation-sheet';
import { loadFacilityModelCandidates, type FacilityModelCandidate } from '../lib/plan-facility-models';
import {
  facilityFootprintSpec,
  facilitySizeFromModel,
  normalizeFacilitySize,
  sizeWithMajor,
} from '../lib/facility-footprint-lock';
import {
  PLAN_ROUTE_MAX_VERTICES,
  buildNode,
  buildRoute,
  buildVehicle,
  buildWorker,
  detachNodeFromRoutes,
  insertRouteVertex,
  movePlanNode,
  inferZoneIdAt,
  moveRouteVertex,
  nodeOnRoutes,
  nodeRouteRefs,
  planNodeIssues,
  planWorkerIssues,
  removeRouteVertex,
  reconcileCrossingNodes,
  removeAutoCrossingNodesOfRoute,
  reverseRoute,
  routeVertexEditIssue,
  type PlanNodeIssue,
  type PlanWorkerIssue,
} from '../lib/site-plan-routes';
import { clampRingMoveToBoundary, nearestMergeTarget, nearestPolylineEdge, nearestRingEdge, nearestRouteSnapPoint, planGridStepM, snapPointToGrid, stickPointToBoundary } from '../lib/site-plan-snap';
// 2026-11-17 #118 补漏：属性卡「选中数」口径（车也算一件；漏算 → 车辆属性卡弹不出来）。
import { planSelectionCount } from '../lib/site-plan-selection';
// 2026-11-16 用户指令：门放到室内区域边线 10px 内要贴边、朝向垂直墙面。
import { snapDoorToIndoorEdge } from '../lib/plan-door-snap';
import { autoNodeName, renamedNodeName } from '../lib/site-plan-node-names';
import { WALK_ROLES, walkRoleCrowdType } from '../lib/walk-roles';
import { crowdTypeForRole } from '../lib/plan-crowd-placement';
import { encodeStageCover } from '@/lib/stage-cover';
import {
  PLAN_MEASURE_MAX_VERTICES,
  buildMeasurement,
  formatAreaM2,
  formatLengthM,
  measureDraftReadout,
  measureKindLabel,
  measureValue,
  planOverviewStats,
  type PlanMeasureKind,
  type PlanMeasureToolKind,
} from '../lib/site-plan-measure';
import {
  annotationDistanceM,
  buildAnnotation,
  planShapeDraftTarget,
  type PlanAnnotationStrokeWidth,
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
import { alignedTileCenter, sourceForLocation } from '../lib/basemap-alignment';
import { basemapNativeMaxZoom } from '../lib/basemap-zoom-caps';
import { planningIcon } from './outdoor-plan-icons';
import { AnnotateColorBar } from './annotate-color-bar';
import { AnnotateDrawTools } from './annotate-draw-tools';
import { useAnnotateDrawShortcuts } from '../hooks/use-annotate-draw-shortcuts';
import { annotateDrawSelectionLabel, resolveAnnotateDrawToolClick } from '../lib/annotate-draw-shortcuts';
import { applyOutdoorInspectorPanel, type OutdoorInspectorPanel } from '../lib/outdoor-inspector-panels';
import { OUTDOOR_TOOL_ICONS, type OutdoorToolKey } from './outdoor-tool-icons';
import { ZoneEventInput } from './zone-event-input';
import { MaterialSymbol } from '../panels/material-symbol';
import { OneplanSticker } from './oneplan-stickers';
import {
  drawOneplanScaleSticker,
  drawOneplanSticker,
  facilitySticker,
  nodeStickerColor,
  oneplanStickerSrc,
  planStickerDescriptors,
  preloadOneplanStickers,
  subscribeOneplanStickerLoads,
  workerRoleColor,
  workerSticker,
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
  vehicleIconItems,
  type PackBucket,
} from '../lib/oneplan-catalog';
import {
  PLANNING_BOUNDARY_LINE_COLOR,
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
// 2026-11-17：属性卡版式提成独立模块，好让回归脚本用同一份值量真实布局
// （「文字生成点不动」的根因是卡片被候选滚动条撑到上千像素宽，冲出宿主与视口）。
import {
  FACILITY_MODEL_ACTION_ROW_STYLE,
  FACILITY_MODEL_STRIP_STYLE,
  FACILITY_MODEL_STRIP_WRAPPER_STYLE,
  inspectorCardBodyStyle,
  inspectorCardStyle,
  inspectorStackStyle,
} from './outdoor-inspector-layout';
import {
  planAnnotationKindLabels,
  planRouteKindLabels,
  planRouteKinds,
  routeCarrier,
  planZoneSemanticLabels,
  planZoneSemantics,
  type PlanAnnotation,
  type PlanFacility,
  type PlanLevel,
  type PlanMeasurement,
  type PlanNode,
  type PlanPoint,
  type PlanRoute,
  type PlanVehicle,
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
  /** 2026-11-16 用户指令：地图方位角（弧度，顺时针为正，0=正北朝上；罗盘拖转 2D 生效）。缺省 0。 */
  bearing?: number;
}

export interface OutdoorPlanCanvasProps {
  generationProjectId?: string;
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
  onVenueBoundaryApplied?: ((anchor: NonNullable<SitePlanData['anchor']>) => void) | undefined;
  /**
   * 2026-11-17 用户实测：画红线时按 Esc 只切回浏览模式，外层工作流仍停在「核对具体活动范围」
   * 并以为已框出范围。取消也是状态变更，必须通知外层清掉这次未确认的候选。
   */
  onVenueBoundaryCanceled?: (() => void) | undefined;
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
  workflowPreview?:SitePlanData|null;
  workflowScopePreview?: boolean;
  mapEditHighlight?: OutdoorMapEditHighlight | null;
  evidenceHighlights?:OutdoorEvidenceHighlight[];
  zoneProposal?: { zones: PlanZone[]; facilities: PlanFacility[]; routes?: PlanRoute[]; nodes?: PlanNode[] } | null;
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
   * 2026-11-15：模型区三格改为打开「统一生成面板」（结果目标带入当前设施），
   * 不再自己开一张独立表单；`onOpenMaterialGenerate` 这条外发口随之退役。
   */
  generationController?: BackendSession | undefined;
}

const TILE = 256;
/**
 * 规划地图的缩放区间（用户实测反馈：活动场地最起码在一个城市里，
 * 缩到省/国家/世界级对做活动毫无意义，只会让「场地」变成看不见的一个点；
 * 上限放到 19 是为了贴到单棵树/斑马线的粒度）。
 */
const MAP_MIN_ZOOM = 12;

/** 采样底图亮度用的 16×16 缩小画布（模块级单例：只为读平均色，不参与显示）。 */
let toneProbeCanvas: HTMLCanvasElement | null = null;

/**
 * 2026-11-16 用户：「这个文字是不是也要根据不同的地图给适配？深色的分区就要是白色的」。
 * 把底图缩小到 16×16 读平均亮度：<108 视为深底（卫星影像 / 深色路网）→ 图上文字转白字。
 * 透明像素（瓦片还没到）跳过；整张都空或跨域污染画布读不出时，按图源类型兜底。
 */
function detectCanvasTone(canvas: HTMLCanvasElement | null, fallback: PlanBasemapTone): PlanBasemapTone {
  if (!canvas || typeof document === 'undefined') return fallback;
  try {
    if (!toneProbeCanvas) toneProbeCanvas = document.createElement('canvas');
    toneProbeCanvas.width = 16;
    toneProbeCanvas.height = 16;
    const probeCtx = toneProbeCanvas.getContext('2d', { willReadFrequently: true });
    if (!probeCtx) return fallback;
    probeCtx.clearRect(0, 0, 16, 16);
    probeCtx.drawImage(canvas, 0, 0, 16, 16);
    const { data } = probeCtx.getImageData(0, 0, 16, 16);
    let sum = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] ?? 0) < 8) continue;
      sum += 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
      count++;
    }
    if (count === 0) return fallback;
    return sum / count < 108 ? 'dark' : 'light';
  } catch {
    // 跨域瓦片污染画布之类：读不了就按图源类型兜底，绝不把异常抛进 draw。
    return fallback;
  }
}

/**
 * 2026-11-16 用户「不仅改名还要改图标视觉，现在没对上」：
 * 物件库 / 图层行的小图标直接画成画布上看到的梯子——
 * 用地红线 = 红描边 + 极淡红底（画布上就是红线 + 低透明场地底片）；
 * 设计范围 = 白纸面 + 四角墨色角标（画布上就是框外毛玻璃 + 白 L 角标，没有填色）。
 * 以前这里是一个绿方块 / 一个琥珀方块——玩家看到的是“哪条线是什么颜色”，
 * 而不是“它在地图上长什么样”。
 */
function BoundarySwatch({ size = 22 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        flex: '0 0 auto',
        borderRadius: 4,
        background: hexWithAlpha(PLANNING_BOUNDARY_LINE_COLOR, 0.14),
        boxShadow: `inset 0 0 0 2px ${PLANNING_BOUNDARY_LINE_COLOR}`,
      }}
    />
  );
}

/** 设计范围缩略：白纸 + 四角角标；plus = 中间加一个「+」（“按场地外扩”那条用）。 */
function ScopeSwatch({ size = 22, plus = false }: { size?: number; plus?: boolean }) {
  const inset = Math.max(2, size * 0.16);
  const arm = Math.max(3, size * 0.3);
  const ink = 'rgba(17,19,23,0.82)';
  const corners: [number, number, number, number][] = [
    [inset, inset, 1, 1],
    [size - inset, inset, -1, 1],
    [size - inset, size - inset, -1, -1],
    [inset, size - inset, 1, -1],
  ];
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        flex: '0 0 auto',
        borderRadius: 4,
        background: 'rgba(255,255,255,0.94)',
        boxShadow: 'inset 0 0 0 1px rgba(17,19,23,0.16)',
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {corners.map(([x, y, sx, sy]) => (
          <path
            key={`${x}-${y}`}
            d={`M ${x + sx * arm} ${y} L ${x} ${y} L ${x} ${y + sy * arm}`}
            fill="none"
            stroke={ink}
            strokeWidth={1.8}
            strokeLinecap="square"
          />
        ))}
        {plus && (
          <path
            d={`M ${size / 2 - 3} ${size / 2} L ${size / 2 + 3} ${size / 2} M ${size / 2} ${size / 2 - 3} L ${size / 2} ${size / 2 + 3}`}
            stroke={ink}
            strokeWidth={1.6}
          />
        )}
      </svg>
    </span>
  );
}
/**
 * 2026-11-11 用户反馈「放大倍数不够」：按图源分档放大上限——具体数字与实测依据全部收敛在
 * `lib/basemap-zoom-caps.ts` 的 `BASEMAP_NATIVE_MAX_ZOOM`，2D 画布 / 3D 贴地 / 瓦片金字塔共用一张表。
 * 超过上限的部分由 `paintBasemapTiles` 的 overzoom 把上限级瓦片等比拉伸，不再出现整屏灰块。
 */
function mapMaxZoomFor(source: CanvasBasemapSource): number {
  return basemapNativeMaxZoom(source);
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
  /**
   * 2026-11-16 罗盘拖转：true = 调用方已把 ctx 包进「绕中心旋转 bearing」的变换、
   * 传入的 viewport 是轴对齐口径（bearing:0），纸面与网格覆盖按对角线扩到旋转可视区。
   * 缺省 false = 旧行为逐像素不变。
   */
  rotatedFrame = false,
): void {
  ctx.save();
  ctx.fillStyle = FLOOR_PAPER;
  if (rotatedFrame) {
    // 旋转系里的矩形纸会露出四角：按对角线铺满中心 ± halfSpan。
    const halfSpan = Math.hypot(cssW, cssH) / 2;
    ctx.fillRect(cssW / 2 - halfSpan, cssH / 2 - halfSpan, halfSpan * 2, halfSpan * 2);
  } else {
    ctx.fillRect(0, 0, cssW, cssH);
  }
  const metersPerPx = planMetersPerPixel(viewport);
  if (Number.isFinite(metersPerPx) && metersPerPx > 0) {
    const pxPerMeter = 1 / metersPerPx;
    const stepM = pxPerMeter >= 24 ? 1 : pxPerMeter >= 8 ? 5 : 20;
    const spacing = stepM * pxPerMeter;
    if (spacing >= 4) {
      const origin = planPointToPixel({ x: 0, y: 0 }, viewport);
      // 旋转系可视范围是旋转矩形的 AABB（中心 ± 对角线/2）；轴对齐时与旧公式等价。
      const halfSpan = rotatedFrame ? Math.hypot(cssW, cssH) / 2 + spacing : null;
      const centerX = cssW / 2;
      const centerY = cssH / 2;
      const fromCol = halfSpan !== null ? Math.floor((centerX - halfSpan - origin.x) / spacing) - 1 : Math.floor((0 - origin.x) / spacing) - 1;
      const toCol = halfSpan !== null ? Math.ceil((centerX + halfSpan - origin.x) / spacing) + 1 : Math.ceil((cssW - origin.x) / spacing) + 1;
      ctx.lineWidth = 1;
      for (let col = fromCol; col <= toCol; col += 1) {
        ctx.strokeStyle = col % 5 === 0 ? FLOOR_GRID_MAJOR : FLOOR_GRID_MINOR;
        const x = Math.round(origin.x + col * spacing) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, cssH);
        ctx.stroke();
      }
      const fromRow = halfSpan !== null ? Math.floor((centerY - halfSpan - origin.y) / spacing) - 1 : Math.floor((origin.y - cssH) / spacing) - 1;
      const toRow = halfSpan !== null ? Math.ceil((centerY + halfSpan - origin.y) / spacing) + 1 : Math.ceil(origin.y / spacing) + 1;
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

/** 标注浮卡固定宽度：切工具/切颜色时不做横向跳，底部锚定下也不会因文案长度改变视觉重心。 */
const ANNOTATE_CARD_WIDTH = 286;

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
  vehicle: PLANNING_ROUTE_KIND_COLORS.vehicle,
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
  // 车辆实体挂在动线行下管理（车由路线承载，不另开图层行）。
  vehicle: 'route',
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

/**
 * 2026-11-16 用户指令：门的六种图标（单开/双开/推拉/旋转/卷帘/折叠）。
 * 只有它们走「贴室内分区边线」的吸附；其它物件仍按原样自由摆放。
 */
const DOOR_TEMPLATE_ID = /(^|:)(door|double-door|sliding-door|revolving-door|roller-shutter|folding-door)$/;
function isDoorTemplateId(templateId: string): boolean {
  return DOOR_TEMPLATE_ID.test(templateId);
}
/** 「再点一下会删」琥珀框的保留时长（ms）：手离开后不挂太久。 */
const BOUNDARY_DELETE_ARM_MS = 2400;
/** 刚插入顶点的宽限期（ms）：双击边线加点时，紧接着的那一下不该被当成“双击顶点删点”。 */
const BOUNDARY_INSERT_GRACE_MS = 500;
/**
 * 2026-11-16 用户「Alt 和双击删除的底层逻辑冲突了，很容易误删」：
 * 刚用 Alt 分叉起线后的这段窗口内，浏览/选择态的双击一律不删点。
 */
const BRANCH_DOUBLECLICK_GUARD_MS = 400;
/** 出入口节点命中/吸附半径（CSS px）：点选与动线端点吸附共用。 */
const NODE_HIT_PX = 11;
/** 人员点位命中半径（CSS px）。 */
const WORKER_HIT_PX = 9;
/** 2026-11-17 #118 补录入 UI：车辆命中半径（CSS px），与人员同款。 */
const VEHICLE_HIT_PX = 9;
/** 2026-11-11 用户指令：自由标注命中半径（CSS px）：点选文本 pill 与形状边缘共用。 */
const ANNOTATION_HIT_PX = 8;
/** 2026-11-16 固定测量标注的点选半径（点到折线/闭合环的像素距离）。 */
const MEASUREMENT_HIT_PX = 9;
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

/** marquee 的屏幕像素矩形（轴对齐）。bearing≠0 时屏幕矩形在平面系是斜矩形，命中改在屏幕系做。 */
function marqueeScreenRect(marquee: { startPx: { x: number; y: number }; curPx: { x: number; y: number } }): PlanRect {
  return {
    minX: Math.min(marquee.startPx.x, marquee.curPx.x),
    minY: Math.min(marquee.startPx.y, marquee.curPx.y),
    maxX: Math.max(marquee.startPx.x, marquee.curPx.x),
    maxY: Math.max(marquee.startPx.y, marquee.curPx.y),
  };
}

/** 屏幕系框选命中（bearing≠0 用）：设施中心或足迹环任一顶点投到屏幕 px 后落进 marquee 矩形。 */
function facilityInScreenRect(
  facility: { position: PlanPoint; rotationDeg: number; size: { width: number; depth: number } },
  marquee: { startPx: { x: number; y: number }; curPx: { x: number; y: number } },
  viewport: PlanViewport,
): boolean {
  const rect = marqueeScreenRect(marquee);
  const inRect = (p: { x: number; y: number }) => p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY;
  if (inRect(planPointToPixel(facility.position, viewport))) return true;
  return facilityFootprintRing(facility).some(pt => inRect(planPointToPixel(pt, viewport)));
}

/**
 * 屏幕系折线框选（bearing≠0 用）：与 routeLengthInRect 同款 Liang–Barsky，只是把端点投到
 * 屏幕 px 后裁剪——旋转是等距仿射，参数 t 不变，px 长度按米/像素换回米制读数。
 */
function routeLengthInScreenRect(
  points: PlanPoint[],
  marquee: { startPx: { x: number; y: number }; curPx: { x: number; y: number } },
  viewport: PlanViewport,
): number {
  const rect = marqueeScreenRect(marquee);
  const px = points.map(p => planPointToPixel(p, viewport));
  let totalPx = 0;
  for (let i = 1; i < px.length; i += 1) {
    const ax = px[i - 1]!.x;
    const ay = px[i - 1]!.y;
    const dx = px[i]!.x - ax;
    const dy = px[i]!.y - ay;
    let t0 = 0;
    let t1 = 1;
    let clipped = true;
    for (const [p, q] of [
      [-dx, ax - rect.minX],
      [dx, rect.maxX - ax],
      [-dy, ay - rect.minY],
      [dy, rect.maxY - ay],
    ] as const) {
      if (p === 0) {
        if (q < 0) { clipped = false; break; }
        continue;
      }
      const t = q / p;
      if (p < 0) {
        if (t > t1) { clipped = false; break; }
        if (t > t0) t0 = t;
      } else {
        if (t < t0) { clipped = false; break; }
        if (t < t1) t1 = t;
      }
    }
    if (!clipped || t1 <= t0) continue;
    totalPx += Math.hypot(dx * (t1 - t0), dy * (t1 - t0));
  }
  return totalPx * planMetersPerPixel(viewport);
}

/** 2026-11-14 用户指令「框选要能选上线段」：折线落在矩形内的长度（逐段 Liang–Barsky 裁剪求和）。 */
function routeLengthInRect(points: PlanPoint[], rect: PlanRect): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const ax = points[i - 1]!.x;
    const ay = points[i - 1]!.y;
    const dx = points[i]!.x - ax;
    const dy = points[i]!.y - ay;
    let t0 = 0;
    let t1 = 1;
    let clipped = true;
    for (const [p, q] of [
      [-dx, ax - rect.minX],
      [dx, rect.maxX - ax],
      [-dy, ay - rect.minY],
      [dy, rect.maxY - ay],
    ] as const) {
      if (p === 0) {
        if (q < 0) { clipped = false; break; }
        continue;
      }
      const t = q / p;
      if (p < 0) {
        if (t > t1) { clipped = false; break; }
        if (t > t0) t0 = t;
      } else {
        if (t < t0) { clipped = false; break; }
        if (t < t1) t1 = t;
      }
    }
    if (!clipped || t1 <= t0) continue;
    total += Math.hypot(dx * (t1 - t0), dy * (t1 - t0));
  }
  return total;
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
 * P2-i：画布右下角常驻比例尺 + 图源署名（2026-11-16 用户指令：比例尺与署名归到地图右下角，
 * 避让右侧竖控件簇；不再挤在左下折叠卡 / 底中工具条一带）。
 * 样式对齐 Google 式：细线两端竖须、柔和白色光晕（shadowBlur，不再粗白描边）、深字。
 * 与导出 PNG（site-plan-png 的 scaleBarMeters）同口径：比例尺按当前缩放级真实换算。
 */
/**
 * 2026-11-16 #118 方案 B：车辆实体只读标记。
 * 规格来源于 `lib/vehicle-markers`（与 3D 的 `plan-vehicle-entities` 同源），这里只负责
 * 米→像素与描边：缺模型用虚线框 + 「待补模型」文案，绝不假装有车模。
 */
function drawVehicleMarkers(
  { ctx, viewport }: { ctx: CanvasRenderingContext2D; viewport: PlanViewport },
  plan: Parameters<typeof vehicleMarkerSpecs>[0],
): void {
  const specs = vehicleMarkerSpecs(plan);
  if (specs.length === 0) return;
  ctx.save();
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const spec of specs) {
    // plan 系：长沿朝向 (cos,sin)，宽沿法向 (-sin,cos)。四角直接投到屏幕，矩形随缩放走。
    const cos = Math.cos(spec.headingRad);
    const sin = Math.sin(spec.headingRad);
    const halfLength = spec.lengthM / 2;
    const halfWidth = spec.widthM / 2;
    const corners = [
      [halfLength, halfWidth],
      [halfLength, -halfWidth],
      [-halfLength, -halfWidth],
      [-halfLength, halfWidth],
    ].map(([along, across]) => planPointToPixel({
      x: spec.x + along! * cos - across! * sin,
      y: spec.y + along! * sin + across! * cos,
    }, viewport));
    ctx.beginPath();
    corners.forEach((corner, index) => {
      if (index === 0) ctx.moveTo(corner.x, corner.y);
      else ctx.lineTo(corner.x, corner.y);
    });
    ctx.closePath();
    ctx.fillStyle = hexWithAlpha(spec.color, 0.18);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = spec.color;
    if (spec.modelMissing) ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (spec.label) {
      const textWidth = ctx.measureText(spec.label).width;
      const topY = Math.min(...corners.map((corner) => corner.y));
      const textX = (corners[0]!.x + corners[3]!.x) / 2 - textWidth / 2;
      const textY = topY - 10;
      // 白底托一下：压在正射底图/航拍上也读得出来。
      ctx.fillStyle = 'rgba(255,255,255,0.86)';
      ctx.fillRect(textX - 4, textY - 8, textWidth + 8, 16);
      ctx.fillStyle = PLANNING_SURFACE.panelText;
      ctx.fillText(spec.label, textX, textY);
    }
  }
  ctx.restore();
}

function drawScaleAttribution(ctx: CanvasRenderingContext2D, viewport: PlanViewport, cssW: number, cssH: number, source: CanvasBasemapSource | null) {
  const mPerPx = planMetersPerPixel(viewport);
  if (!Number.isFinite(mPerPx) || mPerPx <= 0) return;
  const { meters } = niceScaleMeters(mPerPx, 96);
  const label = meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
  const text = source ? basemapSourceAttribution(source) : null;
  const labelFont = '500 11px "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
  const attrFont = '10px "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';

  // 先量文字宽，整组右对齐到右下角（右缘避让右侧竖控件簇一列）。
  ctx.font = labelFont;
  const labelW = ctx.measureText(label).width;
  let attrW = 0;
  if (text) {
    ctx.font = attrFont;
    attrW = ctx.measureText(text).width;
  }
  const barPx = Math.max(24, Math.min(meters / mPerPx, Math.max(24, cssW - 320)));
  const scaleW = Math.max(labelW, barPx);
  const gap = 20;
  const groupW = scaleW + (text ? gap + attrW : 0);
  // 竖控件簇宽约 38 + 右缘 16 + 间距 16，比例尺组右缘让到竖簇左侧。
  const rightMargin = 72;
  const groupRight = cssW - rightMargin;
  const scaleLeft = groupRight - groupW;
  const attrLeft = scaleLeft + scaleW + gap;
  const barY = cssH - 24; // 与右下控件底部对齐
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.textBaseline = 'alphabetic';
  // 柔和白色光晕（blur，不再粗白描边）——亮暗底图都可读且不发糊。
  ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
  ctx.shadowBlur = 3;
  ctx.fillStyle = 'rgba(28, 32, 40, 0.88)';
  ctx.font = labelFont;
  ctx.fillText(label, scaleLeft, barY - 7);
  // 细线两端竖须：深色 2px 主线（自带白色光晕）。
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(28, 32, 40, 0.88)';
  ctx.beginPath();
  ctx.moveTo(scaleLeft, barY);
  ctx.lineTo(scaleLeft + barPx, barY);
  ctx.moveTo(scaleLeft, barY - 5);
  ctx.lineTo(scaleLeft, barY + 5);
  ctx.moveTo(scaleLeft + barPx, barY - 5);
  ctx.lineTo(scaleLeft + barPx, barY + 5);
  ctx.stroke();
  // 署名文字：跟在比例尺后同行（瓦片源才署名；纸面无图源不署名）。
  if (text) {
    ctx.font = attrFont;
    ctx.fillStyle = 'rgba(28, 32, 40, 0.62)';
    ctx.fillText(text, attrLeft, barY - 7);
  }
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
  vehicle: 'truck',
  measurement: PLANNING_LAYER_ICONS.measure,
  annotation: PLANNING_LAYER_ICONS.annotate,
};
const INVENTORY_KIND_COLORS: Record<PlanInventoryKind, string> = {
  zone: PLANNING_LAYER_COLORS.zone,
  facility: PLANNING_LAYER_COLORS.facility,
  route: PLANNING_LAYER_COLORS.route,
  node: PLANNING_LAYER_COLORS.node,
  worker: PLANNING_LAYER_COLORS.worker,
  vehicle: PLANNING_ROUTE_KIND_COLORS.vehicle,
  measurement: PLANNING_LAYER_COLORS.measure,
  annotation: PLANNING_LAYER_COLORS.annotate,
};

/** M4：出入口三型前置直选（工具箱目录分列，对齐动线三类），标签与放置命名同源。 */const NODE_KIND_OPTIONS: { kind: PlanNode['kind']; label: string }[] = [
  { kind: 'entry', label: '入口' },
  { kind: 'exit', label: '出口' },
  { kind: 'both', label: '出入口' },
];
const nodeKindLabel = (kind: PlanNode['kind']): string => NODE_KIND_OPTIONS.find(o => o.kind === kind)?.label ?? '出入口';

/**
 * 2026-11-16 用户：「类型也就几个类型，再说一遍，我讨厌下拉选取」。
 * 动线三类改成图标直选：人行=行人、车辆=货车、后勤=包裹。
 * 2026-11-16 用户补充：「人行应该改成行人，而不是脚印」——脚印容易被读成“已走过的痕迹”，
 * 而这里选的是“画什么类型的线”，所以用行人侧影（PersonStanding）。
 */
const ROUTE_KIND_ICONS: Record<PlanRoute['kind'], PlanningIconName> = {
  pedestrian: 'person-standing',
  vehicle: 'truck',
  service: 'package',
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
  /**
   * 2026-11-16 用户指令「2D 的时候罗盘也要能转」：罗盘拖转入参（弧度增量，与 3D
   * orbitByDelta 同口径——正增量 = 指针顺时针 = 罗盘针顺时针 = bearing 减）。
   */
  orbitByDelta(deltaRad: number): void;
  /** 罗盘点击回正北（bearing 归 0）。 */
  resetNorth(): void;
  /** 当前地图方位角（弧度，顺时针为正，0=正北朝上）；罗盘针实时轮询用。 */
  getBearing(): number;
  /** 当前业务层画布截图 dataURL（无 canvas 时 null）。 */
  captureImage(): string | null;
  /**
   * 2026-11-14 活动封面：底图瓦片+业务层的舞台合成截图（encodeStageCover 口径 640×380）。
   * captureImage 只画业务层（透明底），封面要的是用户眼前那张带瓦片的完整画面。
   */
  captureStageImage(): string | null;
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
  /**
   * 2026-11-16 用户指令：左栏那行「定位到设计范围」去掉，功能挪到右轨焦点钮（#tool-focus）。
   * 只动视图不动 plan；没有设计范围或顶点不足 3 个时静默不动（调用方据此回落到场地取景）。
   */
  focusDesignScope(): void;
  /** V-2d：应用流线提案（合并 routes/nodes 进 plan，commitPlan 可撤销）；空提案回 false。 */
  applyWorkflowPlan(next:SitePlanData,expected:string):boolean;
  openFacilityUpload(id:string):boolean;
  applyVenue(anchor: NonNullable<SitePlanData['anchor']>, boundary: SitePlanData['boundary']): boolean;
  inspectFacility(id: string): boolean;
  beginVenueBoundary(anchor: NonNullable<SitePlanData['anchor']>): boolean;
  applyRoutes(routes: PlanRoute[], nodes: PlanNode[]): boolean;
  /** V-3c：应用区域提案（合并 zones/facilities 进 plan，commitPlan 可撤销）；空提案回 false。 */
  applyZoneProposal(zones: PlanZone[], facilities: PlanFacility[], routes?: PlanRoute[], nodes?: PlanNode[]): boolean;
  /** M5：应用人员布点提案（逐条 buildWorker 校验后合并，commitPlan 可撤销）；全非法/空回 false。 */
  applyWorkers(workers: PlanWorker[]): boolean;
  /** M5：应用测量提案（逐条 buildMeasurement 校验后合并）；全非法/空回 false。 */
  applyMeasurements(measurements: PlanMeasurement[]): boolean;
  /** M5：应用标注提案（逐条 buildAnnotation 校验后合并）；全非法/空回 false。 */
  applyAnnotations(annotations: PlanAnnotation[]): boolean;
  /** M5：读当前楼层列表。 */
  getLevels(): PlanLevel[];
  /** M5：切到指定楼层（不存在回 false）。 */
  setActiveLevel(levelId: string): boolean;
  /** M5：单条设施新增（buildFacility 校验后合并）；校验不过回 false。 */
  addFacility(facility: PlanFacility): boolean;
  /** M5：单条设施删除；不存在回 false。 */
  removeFacility(id: string): boolean;
  /** M5：单条设施属性改；不存在回 false。 */
  updateFacility(id: string, patch: Partial<Pick<PlanFacility,
    'name' | 'notes' | 'rotationDeg' | 'color' | 'opacity' | 'strokeStyle' | 'modelOverride'
    | 'vendorName' | 'vendorZone' | 'inDate' | 'inTime' | 'outDate' | 'outTime' | 'electricKw'
  >> & { size?: { width: number; depth: number } }): boolean;
  /** 当前 2D 视口（切 3D 时用来对着同一中心把地图斜起来）。 */
  getView(): PlanViewport;
  /** 当前绘制/浏览模式：3D 里非浏览态要关掉左键环绕，把点击交给编辑。 */
  getMode(): string;
  /** 2026-11-12 B1 选择工具：切绘制/浏览模式（右栏工具排「选择」钮转发）。 */
  setMode(mode: string): void;
  /** 2026-11-15 测量直进：切距离/面积（工具条小标转发），不清当前绘制模式。 */
  setMeasureKind(kind: PlanMeasureToolKind): void;
  /** 读取当前测量模式（工具条小标回显图标用）。 */
  getMeasureKind(): PlanMeasureToolKind;
  /** 2026-11-15 户外网格吸附开关：开=对齐网格，关=自由摆放。 */
  setSnapOn(on: boolean): void;
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
    flags?: {
      button?: number;
      shiftKey?: boolean;
      /** 2026-11-16：Alt = 从已有点分叉画新动线，3D 必须跟 2D 一样透传。 */
      altKey?: boolean;
      ctrlKey?: boolean;
      metaKey?: boolean;
      clientX?: number;
      clientY?: number;
      viewport?: PlanViewport;
    },
  ): boolean;
  /** 3D 编辑时用来同步预览、选中态和正在画/放的草稿。 */
  getEditVisuals(): PlanEditVisuals;
  /** 2026-11-12 B3 一期：当前户外选区 id（zone/facility/route/node/worker/annotation + 组选设施）；无选空数组。 */
  getSelectedIds(): string[];
  /** 2026-11-16 3D 拖放：拖到地面时按模板预览幽灵（绿/红越界），返回是否已接管。 */
  previewFacilityDrop(templateId: string, point: PlanPoint): boolean;
  /** 2026-11-16 3D 拖放：松手落位（与 2D onDrop 同一入口）。 */
  dropFacilityAt(templateId: string, point: PlanPoint): boolean;
  /** 2026-11-16 3D 拖放离开：清掉幽灵（保留当前工具，方便接着点放）。 */
  clearFacilityDropPreview(): void;
  /** 2026-11-16 物料卡拖进 2D/3D：按模型真实宽深出幽灵。 */
  previewCatalogDrop(payload: PlanCatalogDrag, point: PlanPoint): boolean;
  /** 2026-11-16 物料卡松手：落成带 modelOverride 的设施。 */
  dropCatalogAt(payload: PlanCatalogDrag, point: PlanPoint): boolean;
  /** 2026-11-16 点物料卡：进入待放置，随后点画布/地面落位。 */
  armCatalogFacility(payload: PlanCatalogDrag): boolean;
}

/**
 * 2026-11-16 2D→3D 草稿同步：3D 接管态收到后立即重画 draft（R 旋转、Esc 取消、落位后清幽灵），
 * 不再等下一次指针移动才刷新。
 */
const PLAN_DRAFT_EVENT = 'sc-outdoor-plan-visuals';
function notifyPlanDraftChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PLAN_DRAFT_EVENT));
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
    /** 2026-11-16 设施落位前的占地幽灵：3D 接管态经 draft 通道渲染（旋转/越界与 2D 同源）。 */
    facilityGhost: {
      ring: PlanPoint[];
      invalid: boolean;
      /** 2026-11-16 物料卡预览：3D 在幽灵位置加载这张卡自己的模型（不回落模板默认模型）。 */
      preview: {
        slug: string;
        templateId: string;
        name: string;
        position: PlanPoint;
        rotationDeg: number;
        width: number;
        depth: number;
      } | null;
    } | null;
  };
}

/**
 * 描边样式预览字形（2026-11-15 用户指令：实线/虚线/点线/无用图标代替）。
 * 24×12 的一条线段，与画布上该描边的真实线型同构；「无」用带斜线的圆表示关闭。
 */
function StrokeGlyph({ style }: { style: 'solid' | 'dashed' | 'dotted' | 'none' }) {
  return (
    <svg width={24} height={12} viewBox="0 0 24 12" aria-hidden focusable="false" style={{ display: 'block' }}>
      {style === 'none' ? (
        <>
          <circle cx="12" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.6" />
          <line x1="8.8" y1="9.2" x2="15.2" y2="2.8" stroke="currentColor" strokeWidth="1.4" opacity="0.6" />
        </>
      ) : (
        <line
          x1="2"
          y1="6"
          x2="22"
          y2="6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={style === 'dashed' ? '5 4' : style === 'dotted' ? '1.6 3.4' : undefined}
        />
      )}
    </svg>
  );
}

export const OutdoorPlanCanvasImpl = forwardRef<OutdoorPlanCanvasHandle, OutdoorPlanCanvasProps>(function OutdoorPlanCanvas({
  plan,
  source = 'amap-streets',
  base = 'map',
  initialView,
  visibility,
  onVisibilityChange,
  onViewChange,
  onPlanChange,
  onVenueBoundaryApplied,
  onVenueBoundaryCanceled,
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
  workflowPreview, workflowScopePreview, mapEditHighlight, evidenceHighlights,
  flowSimRoutes,
  sceneObjects,
  generationProjectId,
  generationController,
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
  const workflowPreviewRef=useRef(workflowPreview);workflowPreviewRef.current=workflowPreview;
  const workflowScopePreviewRef = useRef(workflowScopePreview);
  workflowScopePreviewRef.current = workflowScopePreview;
  const mapEditHighlightRef = useRef(mapEditHighlight);
  mapEditHighlightRef.current = mapEditHighlight;
  const evidenceHighlightsRef=useRef(evidenceHighlights);evidenceHighlightsRef.current=evidenceHighlights;
  const zoneProposalRef = useRef<{ zones: PlanZone[]; facilities: PlanFacility[]; routes?: PlanRoute[]; nodes?: PlanNode[] } | null>(zoneProposal ?? null);
  // V-4b：流动模拟（walkers 状态放 ref，ticker 步进后整帧重绘；模拟不写 plan）。
  const flowSimRef = useRef<{ walkers: FlowWalker[]; routes: PlanRoute[] } | null>(null);

  // H2-b 编辑状态（state 供渲染面板，ref 供稳定 draw() 读取）。
  const modeRef = useRef<PlanningEditMode>('view');
  // Esc 取消画线要通知外层工作流；保持最新回调，键盘监听只注册一次。
  const onVenueBoundaryCanceledRef = useRef(onVenueBoundaryCanceled);
  onVenueBoundaryCanceledRef.current = onVenueBoundaryCanceled;
  const draftRef = useRef<PlanPoint[]>([]);
  const previewRingRef = useRef<PlanPoint[] | null>(null);
  const dragVertexRef = useRef<number | null>(null);
  // 2026-11-16：刚在边界线上插过点——松手时不要把“新插的顶”当成“点一下删掉”。
  const boundaryJustInsertedRef = useRef(false);
  const downPxRef = useRef<{ x: number; y: number } | null>(null);
  const issuesRef = useRef<PlanZoneIssue[]>([]);
  // H2-c 设施放置：待放模板、幽灵位置、选中设施。
  // P2-h：物件库里的物件不是 8 个内置模板之一，所以额外记一份模板对象（尺寸/名称来自库条目）。
  const facilityTemplateRef = useRef<string | null>(null);
  const facilityTemplateObjRef = useRef<PlanFacilityTemplate | null>(null);
  const ghostPointRef = useRef<PlanPoint | null>(null);
  /** 2026-11-16 门的贴边吸附：悬停算出的落点 / 法线，高亮与落位共用这一份。 */
  const doorSnapRef = useRef<{ point: PlanPoint; rotationDeg: number; zoneId: string; edge: readonly [PlanPoint, PlanPoint] } | null>(null);
  /** 2026-11-16 落位前旋转：R / Shift+R 每次 ±15°，2D 与 3D draft 共用同一个角度。 */
  const facilityRotationRef = useRef(0);
  /** 拖放刚落的 250ms 内不因 dragleave 清幽灵，否则连放第二件会丢预览。 */
  const facilityDropAtRef = useRef(0);
  /** 2026-11-16 物料卡拖放：记录「当前动态模板对应的物料 slug」，落位时写 modelOverride。 */
  const facilityCatalogRef = useRef<PlanCatalogDrag | null>(null);
  /** 点选物料卡后的待放载荷：即使落位前有别的 setMode/重选把 facilityCatalogRef 清掉，也仍能带上正确模型。 */
  const armedCatalogRef = useRef<PlanCatalogDrag | null>(null);
  const selectedFacilityRef = useRef<string | null>(null);
  const facilityIssuesRef = useRef<PlanFacilityIssue[]>([]);
  // H2-d 动线/节点/人员：绘制草稿、语义选择、选中实体、问题清单、undo。
  const routeKindRef = useRef<PlanningRouteKind>('pedestrian');
  /**
   * 2026-11-16 用户「我明明是在改车行道，点了 Alt 又改回了人行道」：
   * Alt 点在动线**端点**上时不是另起一条，而是接着这条线画；这里记住接的是谁、接哪头。
   */
  const routeExtendRef = useRef<{ routeId: string; at: 'start' | 'end' } | null>(null);
  const routeDraftRef = useRef<PlanPoint[]>([]);
  const routeCursorRef = useRef<PlanPoint | null>(null);
  const routeOneWayRef = useRef(false);
  // 2026-11-15 用户：「一般情况都是出入口」——新放的点默认就是出入口（纯进/纯出由用户自己改），
  // 动线穿边自动生成的交界点也走同一个默认值。
  const nodeKindRef = useRef<PlanNode['kind']>('both');
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
  const routePresetRef = useRef<{ id?: string; kind: PlanningRouteKind; color?: string; name?: string; carrier?: 'walk' | 'trolley' | 'vehicle' | 'mixed' } | null>(null);
  const zonePresetRef = useRef<{ color?: string; name?: string } | null>(null);
  const workerPresetColorRef = useRef<string | null>(null);
  // 2026-11-17 #118 补录入 UI：布车模式的待放车型与台数（面板值 → 落点时读取）。
  const vehicleTypeRef = useRef<PlanVehicle['type']>('business');
  const vehicleCountRef = useRef(1);
  const selectedRouteRef = useRef<string | null>(null);
  const selectedNodeRef = useRef<string | null>(null);
  const selectedWorkerRef = useRef<string | null>(null);
  const selectedVehicleRef = useRef<string | null>(null);
  const nodeIssuesRef = useRef<PlanNodeIssue[]>([]);
  const workerIssuesRef = useRef<PlanWorkerIssue[]>([]);
  const dragNodeRef = useRef<{ id: string; moved: boolean } | null>(null);
  const nodeDragPreviewRef = useRef<{ node: PlanNode; routes: PlanRoute[] } | null>(null);
  // 2026-11-14 用户指令「生成的任何东西都要可以编辑」：人员点位补整体拖拽（与出入口节点同款）。
  const dragWorkerRef = useRef<{ id: string; moved: boolean } | null>(null);
  const workerDragPreviewRef = useRef<{ worker: PlanWorker } | null>(null);
  const historyRef = useRef<SitePlanData[]>([]);
  /** P2-g 重做栈：撤销时把当前快照推进来，任何新编辑清空（与 historyRef 对称，同样 30 步）。 */
  const redoRef = useRef<SitePlanData[]>([]);
  // H3-a 测量：类型、草稿、指针（临时读数）。
  const measureKindRef = useRef<PlanMeasureToolKind>('distance');
  const measureDraftRef = useRef<PlanPoint[]>([]);
  const measureCursorRef = useRef<PlanPoint | null>(null);
  /** 2026-11-11 拖拽式测量：左键按下起点 + 是否已越过点击阈值（进入拖拽）。 */
  const measureDragRef = useRef<{ startPx: { x: number; y: number }; startPt: PlanPoint; active: boolean } | null>(null);
  /**
   * 2026-11-16 用户：「退出的时候自动删掉测量的线段」——本次测量会话里提交进 plan 的 id。
   * 离开测量工具时一次性删掉，测量只当“一次性标尺”，不在图上越积越多。
   */
  const measureSessionIdsRef = useRef<string[]>([]);
  /**
   * 2026-11-11 用户指令：自由标注（OnePlan T + 形状）。形状四类共用一份草稿/拖拽会话
   * （rect/circle/line 拖拽或两点、triangle 单击 3 点）；文本走 noteInput 就地输入，不占草稿。
   */
  const annotateShapeRef = useRef<PlanShapeKind>('rect');
  const annotateDraftRef = useRef<PlanPoint[]>([]);
  const annotateCursorRef = useRef<PlanPoint | null>(null);
  const annotateDragRef = useRef<{ startPx: { x: number; y: number }; startPt: PlanPoint; active: boolean } | null>(null);
  /** 2026-11-13 标注当前取色/描边档位：ref 镜像供事件回调与草稿闭包取最新值。 */
  const annotateColorRef = useRef<string>(PLANNING_LAYER_COLORS.annotate);
  const annotateStrokeWidthRef = useRef<PlanAnnotationStrokeWidth>('thin');
  const selectedAnnotationRef = useRef<string | null>(null);
  /**
   * 2026-11-16 用户：「场地上的测量和面积画完了就不会动，也清理不掉」——
   * 固定测量不再是“画上去就钉死的图像”：画布上可点选、按住拖动移位、Delete 删除。
   * 选中态与 drag 会话都走 ref（draw 闭包读最新值）。
   */
  const selectedMeasurementRef = useRef<string | null>(null);
  const dragMeasurementRef = useRef<{ id: string; kind: PlanMeasureKind; startPt: PlanPoint; base: PlanPoint[]; moved: boolean } | null>(null);
  const measurementDragPreviewRef = useRef<{ id: string; points: PlanPoint[] } | null>(null);
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
  // 2026-11-14 用户指令「框住多少选多少」：框选多选扩展到流线与出入口候选（设施组沿用既有通道）。
  const [multiSelectedRouteIds, setMultiSelectedRouteIds] = useState<string[]>([]);
  const multiSelectedRouteIdsRef = useRef<string[]>([]);
  const [multiSelectedNodeIds, setMultiSelectedNodeIds] = useState<string[]>([]);
  const multiSelectedNodeIdsRef = useRef<string[]>([]);
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
  /** P2-i 图层锁定：锁定层不参与命中与编辑（显示、统计、图例口径不变）。
   *  2026-11-16 用户：「给场地加一把锁，默认不编辑，解锁才编辑」——只有场地边界（绿色总区域）默认锁着，
   *  想改几何得先在左侧「场地边界」行点锁图标；其他图层（含分区）默认不锁。
   *  2026-11-16 用户更正：「我不要分区锁定啊，我说的是那个绿色的总区域」——分区回到默认可编辑。 */
  const lockedLayersRef = useRef<LockedLayerMap>({ boundary: true });
  /** P2-j 分区选中与顶点改形：选中的分区 id + 正在拖的顶点 + 拖动预览多边形。 */
  const selectedZoneRef = useRef<string | null>(null);
  const dragZoneVertexRef = useRef<{ zoneId: string; index: number; startPx: { x: number; y: number } } | null>(null);
  /**
   * 2026-11-15 用户指令「点线段中间就多一个点」：光标悬在选中分区边上时记下
   * 投影点与边序号，用于画「加点」手柄；点下去就插顶点并直接进入拖动。
   */
  const zoneEdgeHintRef = useRef<{ zoneId: string; point: PlanPoint; index: number } | null>(null);
  /** 2026-11-15：光标悬在选中分区的已有顶点上时高亮「可删」（点一下删掉，两侧自动相连）。 */
  const zoneVertexHoverRef = useRef<{ zoneId: string; index: number } | null>(null);
  /** 则是刚插完的点：紧接的松手别把它当成「点击删除」，否则插点会原地被抹掉。 */
  const justInsertedZoneVertexRef = useRef(false);
  /** 2026-11-15 用户指令「靠近就被吞掉」：当前拖动的顶点是否已吸到某个邻居上（画高亮用）。 */
  const zoneVertexSnapRef = useRef<{ zoneId: string; index: number } | null>(null);
  // 2026-11-14 用户反馈「没法编辑 Agent 生成的区域」：分区此前只能拖顶点改形，补整体拖动（与设施同款）。
  const dragZoneMoveRef = useRef<{ zoneId: string; startPt: PlanPoint; base: PlanPoint[]; moved: boolean } | null>(null);
  /** 2026-11-15：设计范围改成拖矩形，按下只记起点，不再攒顶点序列。 */
  const scopeDragRef = useRef<{ startPt: PlanPoint } | null>(null);
  /** 拖范围角点改尺寸：记对角（不动的那一个），保证结果永远是矩形。 */
  const scopeResizeRef = useRef<{ fixed: PlanPoint } | null>(null);
  /**
   * 2026-11-15 用户指令「几个侧边，点的时候也可以按照对应的方向拖动」：
   * 拖边只改一个方向（北/南动 y，东/西动 x）。ring 是按下时的框，对边位置钉在它里。
   */
  const scopeEdgeResizeRef = useRef<{ edge: ScopeEdge; ring: PlanPoint[] } | null>(null);
  /** 悬停到哪条边（只用于光标提示：↕ / ↔，不画任何东西）。 */
  const [scopeEdgeHover, setScopeEdgeHover] = useState<ScopeEdge | null>(null);
  const scopeEdgeHoverRef = useRef<ScopeEdge | null>(null);
  /**
   * 2026-11-15 用户指令「框外加一个锁，默认不锁；锁了就不会误触边框」：
   * 锁定只关掉拖角/拖边两条命中，不动 designScope 数据，也不影响重拖/清除按钮。
   * 纯 UI 状态（不进 plan）：锁定是当下操作习惯，不该写进场地数据被同步给别人。
   * 只存 ref：锁开关只影响画布绘制与命中，不需要 React 重渲染。
   */
  const scopeLockedRef = useRef(false);
  /** 悬停在可拖的边界顶点上（编辑提示 + 光标）。 */
  const [boundaryVertexHover, setBoundaryVertexHover] = useState<number | null>(null);
  const boundaryVertexHoverRef = useRef<number | null>(null);
  /** 悬停在边线上时的「+」加点把手：px 位置（画）+ 米制点与边序号（插点用）。 */
  const [boundaryEdgeHint, setBoundaryEdgeHint] = useState<{ x: number; y: number } | null>(null);
  const boundaryEdgeHintRef = useRef<{ x: number; y: number; index: number; pt: PlanPoint } | null>(null);
  /** 「点了一下、再点就删」的顶点：白框描边转琥珀（删除预警，不是已删）。 */
  const boundaryDeleteArmedRef = useRef<number | null>(null);
  /** 最近一次插点的时间戳：插完的那一下不能又变红、也不能再触发删点。 */
  const boundaryInsertedAtRef = useRef(0);
  const boundaryDeleteArmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (boundaryDeleteArmTimerRef.current !== null) clearTimeout(boundaryDeleteArmTimerRef.current);
  }, []);

  /** 按住 Alt 时鼠标下的“可以从这里长出一条新动线”的锚点（画提示用）。 */
  const [branchAnchorHint, setBranchAnchorHint] = useState<{ x: number; y: number; label: string } | null>(null);
  const branchAnchorHintRef = useRef<{ x: number; y: number; label: string; point: PlanPoint; nodeId?: string } | null>(null);
  /** 刚用 Alt 分叉起线的时刻：双击守护窗口的锚。 */
  const branchStartedAtRef = useRef<number>(-Infinity);
  const [altHeld, setAltHeld] = useState(false);
  const altHeldRef = useRef(false);
  // 2026-11-16 用户「按住 Alt 在原来的点上添加线」+「操作过程中需要有提示」：
  // Alt 按下时把候选锚点亮成「+」，松开/失焦立即熄灭，不留下幽灵把手。
  useEffect(() => {
    const clear = () => {
      if (!altHeldRef.current) return;
      altHeldRef.current = false;
      setAltHeld(false);
      branchAnchorHintRef.current = null;
      setBranchAnchorHint(null);
      draw();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || altHeldRef.current) return;
      altHeldRef.current = true;
      setAltHeld(true);
      // Alt = 分叉手势期间不许有“等待删除”的顶点留在手上（琥珀框会让人以为再点也不安全）。
      clearBoundaryDeleteArm();
      dragRouteVertexRef.current = null;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.altKey) return;
      clear();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clear);
    };
  }, []);
  /** 锁定状态悬停在边界上：光标给 not-allowed，点一下给“去哪解锁”的提示。 */
  const [boundaryLockedHover, setBoundaryLockedHover] = useState(false);
  const boundaryLockedHoverRef = useRef(false);
  /** 悬停在锁定钮上（光标变 pointer）。 */
  const [scopeLockHover, setScopeLockHover] = useState(false);
  const scopeLockHoverRef = useRef(false);
  /** 悬停在「场地边界」那枚锁上（光标变 pointer）。 */
  const [boundaryLockHover, setBoundaryLockHover] = useState(false);
  const boundaryLockHoverRef = useRef(false);
  const zoneDragPreviewRef = useRef<{ zoneId: string; polygon: PlanPoint[] } | null>(null);
  // 2026-11-14 用户指令「生成的任何东西都要可以编辑」：流线此前只能整条删除，补顶点拖拽改形。
  const dragRouteVertexRef = useRef<{ routeId: string; index: number; base: PlanPoint[]; merged: PlanRoute | null } | null>(null);
  const routeDragPreviewRef = useRef<{ routeId: string; points: PlanPoint[] } | null>(null);
  /**
   * 2026-11-15 用户指令「路线和分区一样，线上可以加点、减点、挪动合并点」：
   * 与分区同机制的三只 ref——悬停边中段（画「加点」手柄）、悬停已有折点（画红色「可删」环）、
   * 拖动时被吸住的邻居折点（琥珀大圈）。
   */
  const routeEdgeHintRef = useRef<{ routeId: string; point: PlanPoint; index: number } | null>(null);
  const routeVertexHoverRef = useRef<{ routeId: string; index: number } | null>(null);
  const routeVertexSnapRef = useRef<{ routeId: string; index: number } | null>(null);
  /** 刚插完的点：紧接的松手别把它当成「点击删除」，否则插点会原地被抹掉。 */
  const justInsertedRouteVertexRef = useRef(false);

  const [view, setView] = useState<View>({ ...viewRef.current });
  const [dragging, setDragging] = useState(false);
  const [layerState, setLayerState] = useState<LayerVisibility>(visibility ?? defaultLayerVisibility());
  /** P2-i 图层锁定（UI 状态；命中过滤读 lockedLayersRef，避免闭包过期）。 */
  const [lockedLayers, setLockedLayers] = useState<LockedLayerMap>({ boundary: true });
  const [panelOpen, setPanelOpen] = useState(true);
  /** 2026-11-11 OnePlan Placed Objects 文件夹树：类型文件夹展开状态（缺省全展开）。 */
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [mode, setModeState] = useState<PlanningEditMode>('view');
  const [zoneSemantic, setZoneSemantic] = useState<PlanningZoneSemantic>('audience');
  const [editMessage, setEditMessage] = useState<string | null>(null);
  /** 2026-11-15：边界/范围提交后的分区越界清单（提示条 + 一键收进）。 */
  const [zoneOverflow, setZoneOverflow] = useState<ZoneBoundsOverflow[]>([]);
  const [zoneUndoAvailable, setZoneUndoAvailable] = useState(false);
  /** 一键收进前的整份 plan（原坐标），供提示条上的「撤销」恢复。 */
  const zoneUndoRef = useRef<SitePlanData | null>(null);
  const [issues, setIssues] = useState<PlanZoneIssue[]>([]);
  /**
   * 2026-11-15 用户指令：分区重叠不阻编辑，只在画布上常驻报错，挪开就自动消失。
   * 直接从问题清单派生（不另存状态）——清单每次 plan 变化都重算，重叠一消失提示自然就没了。
   */
  const overlapNotices = issues
    .filter(item => item.issue.code === 'zones-overlap')
    .map(item => ({ a: item.zoneName, b: item.otherZoneName ?? '另一个分区' }));
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
   * P2-k 目录（用户 m05190）：进户外规划就是三段行——区域、路线及交通 / 基础设施 / 工作人员（原叫「劳动力」，2026-11-14 改名）。
   * 2026-11-11 用户指令（m00575）：一级段与二级子组**都要能同时展开多个**——
   * 以前 `librarySection`/`librarySubgroup` 是单选（手风琴），点开「电力」会把「照明」收掉，
   * 用户要对比几类设备时只能来回点。现改为「展开集合」：一级存 section id，
   * 二级存 `${sectionId}:${subKey}`（带段前缀，避免不同段的同名子组互相覆盖）。
   */
  const [openLibrarySections, setOpenLibrarySections] = useState<string[]>(['areas']);
  const [openLibrarySubgroups, setOpenLibrarySubgroups] = useState<string[]>(['areas:区域']);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(null);
  /**
   * 2026-11-14 统一右键菜单（用户拍板「右键弹浮窗，不再右键即删」）：
   * - 画布设施（浏览/选择模式点中实体）= 复制 + 层级四项 + 删除；
   * - 清单/面板行（已放置物件树行、测量行、标注行）= 按 kind 裁剪（分区/设施可复制）+ 删除。
   * 删除固定红字沉底加分隔线（破坏性动作置底）；键盘加速器 Delete/Ctrl+D 不变。
   */
  type PlanContextMenu =
    | { surface: 'stage-facility'; x: number; y: number; facilityId: string }
    | { surface: 'row'; x: number; y: number; row: PlanInventoryRow };
  const [contextMenu, setContextMenu] = useState<PlanContextMenu | null>(null);
  const contextMenuElementRef = useRef<HTMLDivElement | null>(null);
  // 菜单开着时：点菜单外任意处（画布/面板）或按 Esc 关闭；Esc 只关菜单不透传（避免顺手退出选择态）。
  useEffect(() => {
    if (!contextMenu) return;
    const onDocMouseDown = (event: MouseEvent) => {
      const menu = contextMenuElementRef.current;
      if (menu && event.target instanceof Node && menu.contains(event.target)) return;
      setContextMenu(null);
    };
    const onDocKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setContextMenu(null);
    };
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onDocKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true);
      document.removeEventListener('keydown', onDocKeyDown, true);
    };
  }, [contextMenu]);
  const [facilityIssues, setFacilityIssues] = useState<PlanFacilityIssue[]>([]);
  const [routeKind, setRouteKind] = useState<PlanningRouteKind>('pedestrian');
  // M4（2026-11-13）：出入口类型在工具箱前置直选（ref + state 双写，对齐动线 kind）；
  // oneWay/人数的纯 UI 态仍在选中实体编辑器里调，画布逻辑读各自的 ref（draw 侧真值）。
  const [nodeKind, setNodeKind] = useState<PlanNode['kind']>('both');
  const [, setRouteDraftCount] = useState(0);
  const [workerRole, setWorkerRole] = useState('安保');
  /** 2026-11-17 #118 补录入 UI：布车模式当前车型（面板高亮用，与 vehicleTypeRef 同值）。 */
  const [vehicleType, setVehicleType] = useState<PlanVehicle['type']>('business');
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  /** 2026-11-17 #118 补录入 UI：车辆选中（独立集合，与设施/人员/节点互斥）。 */
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  /** 2026-11-11 OnePlan Repeat 阵列：沿物件自身旋转轴复制 cols×rows（含原件），间距可调。 */
  const [repeatCols, setRepeatCols] = useState(2);
  const [repeatRows, setRepeatRows] = useState(1);
  const [repeatGapX, setRepeatGapX] = useState(1);
  const [repeatGapY, setRepeatGapY] = useState(1);
  /** 阵列碰撞安全间距（米）：候选副本占地向外留的空隙，0 为纯占地相交。 */
  const [repeatGapMargin, setRepeatGapMargin] = useState(0);
  // 阵列预览真值走 ref：draw 闭包依赖 sceneObjects、读不到最新 state，参数与卡片模式都由 ref 取。
  // state 仅用于面板渲染；输入变更时同步 ref 并触发一次 draw。
  const repeatParamsRef = useRef({ cols: 2, rows: 1, gapX: 1, gapY: 1, margin: 0, cardMode: 'props' as 'props' | 'repeat' });
  // 2026-11-12 OnePlan 面板换页：属性页 ⇄ 阵列复制页（标题行图标钮切换，选中变化即回属性页）。
  const [facilityCardMode, setFacilityCardMode] = useState<'props' | 'repeat'>('props');
  // 手风琴（+ 布场信息 / + 备注）：默认收起，同 OnePlan。
  const [facilitySetupOpen, setFacilitySetupOpen] = useState(false);
  const [facilityNotesOpen, setFacilityNotesOpen] = useState(false);
  // 2026-11-15：位置改成可编辑后，经纬度采用「输入中存草稿、失焦/回车才提交」：
  // 受控输入若每次按键就回写 5 位小数，用户连小数点都敲不进去。
  const [facilityGeoDraft, setFacilityGeoDraft] = useState<{ lat: string; lng: string } | null>(null);
  // 尺寸同理：宽/深也用草稿，否则敲「3.」时会被 1 位小数的回写吃掉小数点。
  const [facilitySizeDraft, setFacilitySizeDraft] = useState<{ width: string; depth: string } | null>(null);
  // V-5a 模型候选切换：选中设施的 3D 模型候选（loadFacilityModelCandidates：内置映射同步
  // + 在线物料库异步兜底，上限 5）。属性卡「模型」网格渲染；点候选写 facility.modelOverride。
  const [facilityModelCandidates, setFacilityModelCandidates] = useState<{
    templateId: string;
    items: FacilityModelCandidate[];
    defaultSlug: string | null;
  } | null>(null);
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
    setFacilityModelCandidates(current => (current?.templateId === templateId ? current : { templateId, items: [], defaultSlug: null }));
    void loadFacilityModelCandidates([templateId])
      .then(map => {
        if (!alive) return;
        // V-5b/c：生成/导入回填的候选排最前（「生成完回填候选首位」），库内候选殿后；
        // 上限放行生成位，不让回填把库内候选挤没。
        const generated = listGeneratedFacilityModels(facility?.id, generationProjectId);
        const library = map.get(templateId) ?? [];
        const items = [...generated, ...library];
        const defaultSlug = library[0]?.slug ?? null;
        setFacilityModelCandidates(current => (current?.templateId === templateId ? { templateId, items, defaultSlug } : current));
      })
      .catch(() => {
        if (!alive) return;
        // 在线库故障也不能吞掉本次生成/导入的候选。
        setFacilityModelCandidates({ templateId, items: listGeneratedFacilityModels(facility?.id, generationProjectId), defaultSlug: null });
      });
    return () => { alive = false; };
  }, [selectedFacilityId, plan, generatedModelsRevision, generationProjectId]);

  /** V5：按当前计划取回任务（不要求先点中），刷新后自动重新授权云模型。 */
  const [facilityGenerateStatus, setFacilityGenerateStatus] = useState<{ facilityId: string; name: string; message: string } | null>(null);
  const facilityPollCursor = useRef(0);
  useEffect(() => {
    let alive = true; let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const pending = listFacilityGenerateLinks(undefined, generationProjectId).filter(link => !link.terminal && planRef.current.facilities.some(f => f.id === link.facilityId) && !findGeneratedFacilityModel(`generated:${link.taskid}`));
        if (!pending.length) { if (alive) setFacilityGenerateStatus(null); return; }
        const start = facilityPollCursor.current % pending.length;
        const batch = [...pending.slice(start), ...pending.slice(0, start)].slice(0, 4);
        facilityPollCursor.current += batch.length;
        for (const link of batch) {
          if (!alive) return;
          const result = await resolveFacilityGenerateLink(link.taskid, generationController ? { cloud: generationController } : {});
          if (!alive) return;
          if (result.state === 'imported') {
            if (link.facilityId === selectedFacilityId) setFacilityGenerateStatus(null);
            setEditMessage(`「${result.model.name}」已回填「${result.model.facilityName}」候选；选候选才更换模型。`);
          } else if (result.state === 'failed') {
            if (link.facilityId === selectedFacilityId) setFacilityGenerateStatus(null);
            setEditMessage(`「${link.name}」${result.message}`);
          } else if (link.facilityId === selectedFacilityId) setFacilityGenerateStatus({ facilityId: link.facilityId, name: link.name, message: result.message });
        }
      } finally { busy = false; }
    };
    void tick();
    const timer = window.setInterval(() => { void tick(); }, FACILITY_GENERATE_POLL_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, [selectedFacilityId, facilityGenerateLinksRevision, generatedModelsRevision, generationController, plan.facilities, generationProjectId]);

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
  const [measureKind, setMeasureKind] = useState<PlanMeasureToolKind>('distance');
  const [measureDraftCount, setMeasureDraftCount] = useState(0);
  // 2026-11-11 用户指令：自由标注 UI 态（形状类型/草稿计数/选中/文本就地输入框）。
  const [annotateShape, setAnnotateShape] = useState<PlanShapeKind>('rect');
  const [annotateDraftCount, setAnnotateDraftCount] = useState(0);
  const [annotateColor, setAnnotateColor] = useState<string>(PLANNING_LAYER_COLORS.annotate);
  const [annotateStrokeWidth, setAnnotateStrokeWidth] = useState<PlanAnnotationStrokeWidth>('thin');
  /** 再点当前工具退出时的轻提示（只在这一处展示，避免依赖选中实体卡的状态位）。 */
  const [annotateNotice, setAnnotateNotice] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);
  /** 拖动测量时不再需要额外的 DOM 贴片，画布 draw() 自己会重画读数。 */
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
  /**
   * 2026-11-15 用户：「同一条线上的感叹号合并成一枚，点开再展开明细」。
   * 画布上每个关联对象只画一枚徽章（多条问题画数字），点它才展开清单。
   */
  const [conflictClusters, setConflictClusters] = useState<PlanConflictCluster[]>([]);
  const conflictClustersRef = useRef<PlanConflictCluster[]>([]);
  /**
   * 2026-11-16 用户「场地上又出现感叹号，不知道为什么」：那些橙色的「!」其实是
   * 「缺宽度 / 容量待核实」这类**提示**（status=missing/unverified），不是真冲突。
   * 它们每新画一条车行/后勤动线就冒一颗，一屏全是橙点，把真冲突淹了。
   * 所以默认图上只画**冲突（红）**；提示类要手动打开才上图（问题清单里一直能看到）。
   */
  const [showAdvisoryBadges, setShowAdvisoryBadges] = useState(false);
  const showAdvisoryBadgesRef = useRef(false);
  /** 当前展开明细的那一枚徽章（key），null = 没展开。 */
  const [conflictDetailKey, setConflictDetailKey] = useState<string | null>(null);
  const conflictDetailKeyRef = useRef<string | null>(null);
  function showConflictDetail(key: string | null) {
    conflictDetailKeyRef.current = key;
    setConflictDetailKey(key);
  }
  // H3-c 规划信息面板：页签、开关、筛选与提示消息（面板自带 status 行，只读也可用）。
  const [infoOpen, setInfoOpen] = useState(true);
  // 2026-11-12 用户指令：三张卡拆开——测量 / 标注 / 属性各一张，各自展开/收起。
  // 2026-11-17 用户：测量与标注不能同时用，就不该同时打开；开一张自动收另一张，属性卡保持独立。
  const [inspectorPanels, setInspectorPanels] = useState<Record<'measure' | 'annotate' | 'selection', boolean>>({ measure: false, annotate: false, selection: false });
  // 2026-11-16 用户指令：标注卡不要再和属性卡一起挤在右上角；作为「标注」钮的
  // 上浮面板锚定到底条按钮上方，像地图工具栏的 popover 一样有明确的来处。
  const [annotateAnchor, setAnnotateAnchor] = useState<{ left: number; bottom: number } | null>(null);
  // 2026-11-15 属性浮卡总开关：默认开；关闭后点选物件不再弹出属性卡（底条属性钮切换）。
  const [selectionPanelOn, setSelectionPanelOn] = useState(true);
  const selectionPanelOnRef = useRef(true);
  const setSelectionPanelEnabled = useCallback((on: boolean) => {
    selectionPanelOnRef.current = on;
    setSelectionPanelOn(on);
    setInspectorPanels(current => ({ ...current, selection: on }));
  }, []);
  // 2026-11-15 户外网格吸附开关：默认开；关闭后放置/拖动/拖顶点不再对齐网格（底条吸附钮切换）。
  const snapOnRef = useRef(true);
  const setSnapOn = useCallback((on: boolean) => {
    snapOnRef.current = on;
  }, []);
  const snapPoint = useCallback((pt: PlanPoint, viewport: PlanViewport): PlanPoint => (
    snapOnRef.current ? snapPointToGrid(pt, viewport) : pt
  ), []);
  const setInspectorPanel = useCallback((tab: OutdoorInspectorPanel, open: boolean) => {
    setInspectorPanels(current => applyOutdoorInspectorPanel(current, tab, open));
  }, []);
  // 2026-11-12 「好用一点的交互」：卡头可折叠（只收内容、不关卡片），三张卡同时开着也不挤。
  const [inspectorCollapsed, setInspectorCollapsed] = useState<Record<'measure' | 'annotate' | 'selection', boolean>>({ measure: false, annotate: false, selection: false });
  const toggleInspectorCollapsed = useCallback((tab: 'measure' | 'annotate' | 'selection') => {
    setInspectorCollapsed(current => ({ ...current, [tab]: !current[tab] }));
  }, []);
  // 2026-11-16 工具卡簇浮窗：默认右上角避让右轨圆钮列；标题栏可拖到画布内任意位置。
  const [inspectorPanelPos, setInspectorPanelPos] = useState<{ x: number; y: number } | null>(null);
  const inspectorPanelRef = useRef<HTMLDivElement>(null);
  const inspectorDragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number; moved: boolean } | null>(null);
  // 拖拽抬起后抑制紧随的那次 click，避免拖完面板误触发卡头折叠。
  const inspectorSuppressClickRef = useRef(false);
  const onInspectorPanelPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const panel = inspectorPanelRef.current;
    // 只允许从卡头拖拽；卡片内容区不拖。
    if (!panel || !(event.target as HTMLElement).closest('[data-inspector-header]')) return;
    const rect = panel.getBoundingClientRect();
    inspectorDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, baseX: rect.left, baseY: rect.top, moved: false };
  }, []);
  const onInspectorPanelPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = inspectorDragRef.current;
    const panel = inspectorPanelRef.current;
    if (!drag || !panel || drag.pointerId !== event.pointerId) return;
    const parent = panel.offsetParent as HTMLElement | null;
    const parentRect = parent?.getBoundingClientRect();
    const parentL = parentRect?.left ?? 0;
    const parentT = parentRect?.top ?? 0;
    const parentW = parent?.clientWidth ?? window.innerWidth;
    const parentH = parent?.clientHeight ?? window.innerHeight;
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    // 未越过阈值前不进入拖拽，保留单击折叠；越过才捕获指针并开始挪面板。
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      panel.setPointerCapture(event.pointerId);
    }
    const left = drag.baseX - parentL + dx;
    const top = drag.baseY - parentT + dy;
    const x = Math.min(Math.max(0, left), Math.max(0, parentW - w));
    const y = Math.min(Math.max(0, top), Math.max(0, parentH - h));
    setInspectorPanelPos({ x, y });
  }, []);
  const onInspectorPanelPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = inspectorDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      inspectorSuppressClickRef.current = true;
      inspectorPanelRef.current?.releasePointerCapture(event.pointerId);
    }
    inspectorDragRef.current = null;
  }, []);
  const onInspectorPanelHeaderClickCapture = useCallback((event: React.SyntheticEvent) => {
    if (inspectorSuppressClickRef.current) {
      event.stopPropagation();
      event.preventDefault();
      inspectorSuppressClickRef.current = false;
    }
  }, []);
  const [infoTab, setInfoTab] = useState<(typeof INFO_TABS)[number]>('overview');
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [invKind, setInvKind] = useState<PlanInventoryFilter['kind']>('all');
  const [invZone, setInvZone] = useState<PlanInventoryFilter['zone']>(undefined);
  const [invIssuesOnly, setInvIssuesOnly] = useState(false);
  const infoPanelRef = useRef<HTMLDivElement>(null);

  function setMode(next: PlanningEditMode) {
    if (next !== 'boundary') pendingVenueAnchorRef.current = undefined;
    // 2026-11-16 用户：「退出的时候自动删掉测量的线段」——测量是一次性标尺：
    // 离开测量工具就把本次会话的线全清掉，不留“画完就钉在图上”的残留。
    if (modeRef.current === 'measure' && next !== 'measure') dropMeasureSession();
    if (next === 'measure') measureSessionIdsRef.current = [];
    modeRef.current = next;
    draftRef.current = [];
    previewRingRef.current = null;
    scopeDragRef.current = null;
    scopeResizeRef.current = null;
    scopeEdgeResizeRef.current = null;
    scopeEdgeHoverRef.current = null;
    setScopeEdgeHover(null);
    dragVertexRef.current = null;
    boundaryJustInsertedRef.current = false;
    facilityTemplateRef.current = null;
    ghostPointRef.current = null;
    facilityCatalogRef.current = null;
    armedCatalogRef.current = null;
    facilityRotationRef.current = 0;
    setFacilityTemplateId(null);
    routeDraftRef.current = [];
    routeExtendRef.current = null;
    routeCursorRef.current = null;
    nodeGhostRef.current = null;
    measureDraftRef.current = [];
    measureCursorRef.current = null;
    measureDragRef.current = null;
    // 切工具时收掉测量的选中/拖动会话（绘制模式下点击是收点，不是选中）。
    selectedMeasurementRef.current = null;
    setSelectedMeasurementId(null);
    dragMeasurementRef.current = null;
    measurementDragPreviewRef.current = null;
    // 2026-11-11 用户指令：切模式清空标注草稿与文本输入框。
    annotateDraftRef.current = [];
    annotateCursorRef.current = null;
    annotateDragRef.current = null;
    setAnnotateDraftCount(0);
    updateNoteInput(null);
    // 2026-11-14 统一右键菜单：切工具随手关（菜单只在浏览/选择态开，保守兜底）。
    setContextMenu(null);
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
    // 2026-11-17：测量/标注真正互斥——进入任一种绘制工具就收起另一张工具卡，避免“卡开着但不是当前工具”。
    if (next === 'measure') setInspectorPanel('annotate', false);
    if (next === 'note' || next === 'shape') setInspectorPanel('measure', false);
    setModeState(next);
    setEditMessage(null);
    setAnnotateNotice(null);
    onModeChange?.(next);
    // 2026-11-16 用户「我现在好像画不了场地边界了啊？」：
    // 锁只该挡「没选工具时的误触」。点了「画边界 / 编辑边界」就是明摆着要改几何，
    // 进模式即自动解锁（否则单击收点会被锁直接拦下，工具看着就是坏的）。画完可在左栏再锁上。
    if ((next === 'boundary' || next === 'boundary-vertex') && lockedLayersRef.current.boundary === true) {
      const unlocked: LockedLayerMap = { ...lockedLayersRef.current, boundary: false };
      lockedLayersRef.current = unlocked;
      setLockedLayers(unlocked);
      setEditMessage('已自动解除用地红线锁定（选了红线工具就是要改它）；画完可在左侧「用地红线」行再锁上。');
    }
    // 还没红线、但地图上有搜索选区：把这块闭合范围放进红线草稿。
    // 点起点闭合走现有 closeDraft（写入 plan.boundary，再出确认卡）；Esc 仍是取消。
    if (next === 'boundary' && planRef.current.boundary.length < 3) {
      const seeded = planBoundaryFromSearchArea(searchArea ?? null, planRef.current.anchor);
      if (seeded) {
        draftRef.current = seeded;
        setEditMessage('地图上的范围已放进红线草稿。点一下起点闭合，确认后写入方案；Esc 取消。');
      }
    }
    draw();
    notifyPlanDraftChanged();
  }

  /**
   * 2026-11-16 落位前旋转（2D/3D 同一键）：R +15°，Shift+R −15°，Esc 取消。
   * 只改“还没放下的那一个”的角度；已落位的设施仍走选中手柄。
   */
  function rotatePendingFacility(deltaDeg: number): boolean {
    if (modeRef.current !== 'facility' || !facilityTemplateRef.current) return false;
    const next = ((facilityRotationRef.current + deltaDeg) % 360 + 360) % 360;
    facilityRotationRef.current = next;
    setEditMessage(`待放置已旋转 ${Math.round(next)}°；R / Shift+R 调整，Esc 取消。`);
    draw();
    notifyPlanDraftChanged();
    return true;
  }

  // 2026-11-15 测量直进：只切换距离/面积，清空当前草稿，不强切绘制模式；是否进入收点由调用方 setMode('measure') 决定。
  function applyMeasureKind(kind: PlanMeasureToolKind) {
    measureKindRef.current = kind;
    setMeasureKind(kind);
    measureDraftRef.current = [];
    measureCursorRef.current = null;
    setMeasureDraftCount(0);
    setEditMessage(null);
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
    setContextMenu(null);
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

  /**
   * 边界/设计范围一变，就把全案分区重判一遍（2026-11-15 用户指令）。
   *
   * 为什么必须在这里做：分区是先画的、边界是后改的，提交边界时没人复验，
   * 早期分区就静静留在外面。这里同时记一份「改动前」快照，供一键收进后撤销回原坐标。
   */
  function reviewZonesAfterBoundsChange(next: SitePlanData, previous: SitePlanData): ZoneBoundsOverflow[] {
    const overflow = findZoneBoundsOverflow({
      boundary: next.boundary,
      designScope: next.designScope ?? [],
      zones: next.zones,
    });
    setZoneOverflow(overflow);
    if (overflow.length > 0) {
      zoneUndoRef.current = previous;
      setZoneUndoAvailable(true);
    }
    return overflow;
  }

  function overflowSuffix(overflow: ZoneBoundsOverflow[]): string {
    return overflow.length > 0 ? ` 有 ${overflow.length} 个分区越界，可一键收进。` : '';
  }

  /** 一键收进：把能自动摆回的分区按建议坐标提交（平移优先，其次保形收缩）。 */
  function pullOverflowZonesIntoBounds() {
    const current = planRef.current;
    const suggestions = new Map(
      zoneOverflow.filter(item => item.pulled !== null).map(item => [item.zoneId, item.pulled!] as const),
    );
    if (suggestions.size === 0) {
      setEditMessage('这些分区没法自动收进（红线与设计范围不相交，或缩到最小面积也放不下）；请先确认红线，或手动拖动分区。');
      return;
    }
    const next: SitePlanData = {
      ...current,
      zones: current.zones.map(zone =>
        suggestions.has(zone.id) ? { ...zone, polygon: suggestions.get(zone.id)!.map(p => ({ x: p.x, y: p.y })) } : zone,
      ),
    };
    zoneUndoRef.current = current;
    setZoneUndoAvailable(true);
    commitPlan(next);
    const still = findZoneBoundsOverflow({ boundary: next.boundary, designScope: next.designScope ?? [], zones: next.zones });
    setZoneOverflow(still);
    setEditMessage(
      still.length > 0
        ? `已收进 ${suggestions.size} 个分区；还有 ${still.length} 个放不下，请手动调整或先扩大红线。`
        : `已把 ${suggestions.size} 个分区收进红线，原坐标已保留，可点「撤销」恢复。`,
    );
    draw();
  }

  /** 撤销一键收进：直接回填快照（与 undoPlan 同口径，把当前状态塞进 redo 栈）。 */
  function undoZonePull() {
    const snapshot = zoneUndoRef.current;
    if (!snapshot) return;
    redoRef.current.push(planRef.current);
    if (redoRef.current.length > UNDO_LIMIT) redoRef.current.shift();
    setRedoCount(redoRef.current.length);
    planRef.current = snapshot;
    onPlanChange?.(snapshot);
    zoneUndoRef.current = null;
    setZoneUndoAvailable(false);
    setZoneOverflow(
      findZoneBoundsOverflow({ boundary: snapshot.boundary, designScope: snapshot.designScope ?? [], zones: snapshot.zones }),
    );
    setEditMessage('已恢复收进前的坐标。');
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

  // 标注卡关闭后不再保留上一次退出提示；下次开卡从默认提示开始。
  useEffect(() => {
    if (!inspectorPanels.annotate) setAnnotateNotice(null);
  }, [inspectorPanels.annotate]);

  // 标注面板锚点跟随底条工具钮；窗口变化时重算，保证弹出层始终在按钮正上方。
  // 用 layout effect 在绘制前落位，避免先闪一下右上角再跳到底条上方。
  useLayoutEffect(() => {
    if (!inspectorPanels.annotate) {
      setAnnotateAnchor(null);
      return;
    }
    let raf = 0;
    const place = (): void => {
      const button = document.querySelector<HTMLElement>('#tool-annotate');
      if (!button) {
        setAnnotateAnchor(null);
        return;
      }
      const rect = button.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        setAnnotateAnchor(null);
        return;
      }
      const panelWidth = Math.min(ANNOTATE_CARD_WIDTH, window.innerWidth - 24);
      const halfPanel = panelWidth / 2;
      const margin = 12;
      const left = Math.min(
        Math.max(rect.left + rect.width / 2, margin + halfPanel),
        window.innerWidth - margin - halfPanel,
      );
      setAnnotateAnchor({ left, bottom: window.innerHeight - rect.top + 10 });
    };
    // 先在 layout effect 里同步落位，避免首帧按右上角渲染后再跳到底条上方；
    // 再排一帧兜底底条刚挂上、按钮尺寸尚未稳定的情况。
    place();
    raf = window.requestAnimationFrame(place);
    const onDockOpened = (): void => {
      place();
      window.requestAnimationFrame(place);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scendance:outdoor-dock-opened', onDockOpened);
    document.addEventListener('scroll', place, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scendance:outdoor-dock-opened', onDockOpened);
      document.removeEventListener('scroll', place, true);
    };
  }, [inspectorPanels.annotate]);

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
    conflictClustersRef.current = groupConflictIssues(conflictIssuesRef.current);
    setConflictClusters(conflictClustersRef.current);
    // 2026-11-15：越界提示条跟真实 plan 同步（拖分区、撤销、外部提案都算），与问题清单同口径按当前层算。
    setZoneOverflow(
      findZoneBoundsOverflow({ boundary: view.boundary, designScope: view.designScope ?? [], zones: view.zones }),
    );
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
    // 2026-11-17 #118 补录入 UI：车辆被删后自动清选中，避免面板悬挂引用。
    if (selectedVehicleRef.current && !(plan.vehicles ?? []).some(v => v.id === selectedVehicleRef.current)) {
      selectedVehicleRef.current = null;
      setSelectedVehicleId(null);
    }
    draw();
  }, [plan]);
  // 挂载即上报初始活动层（3D 地面图层据此只镜像当前层）。
  useEffect(() => {
    onActiveLevelChange?.(activeLevelIdRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    sourceRef.current = source;
    // 换图源必须清空瓦片缓存：旧源在途请求的 handler 作废、加载计数归零，
    // 否则旧瓦片继续占并发空位、「底图加载中」不消退，不同源同坐标瓦片还会串味。
    basemapCacheRef.current?.clear();
    draw();
  }, [source]);
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
    const cssW = stage.clientWidth;
    const cssH = stage.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(cssW * dpr);
    const height = Math.round(cssH * dpr);
    // 漫游会隐藏 2D 舞台。保留上一帧，等 ResizeObserver 报告可用尺寸后再绘制。
    if (width <= 0 || height <= 0) return;

    const baseCtx = baseCanvas.getContext('2d');
    const planCtx = planCanvas.getContext('2d');
    if (!baseCtx || !planCtx) return;
    for (const canvas of [baseCanvas, planCanvas]) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }
    baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    baseCtx.clearRect(0, 0, cssW, cssH);
    planCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    planCtx.clearRect(0, 0, cssW, cssH);

    const v = viewRef.current;
    // 2026-11-17：境外案例用高德/天地图只会是灰图或白底——按场地中心换全球卫星源，
    // 境内原样返回。当帧的瓦片、上限、文字明暗、署名全跟这个 `activeSource` 走。
    const current = viewPlan();
    const requestedSource = sourceRef.current;
    const activeSource = sourceForLocation(
      requestedSource,
      current.anchor?.lng ?? v.lng,
      current.anchor?.lat ?? v.lat,
    );
    // 测量中性线在卫星/深色底图上转白；室内纸面模式按浅底处理。
    const darkBasemap = baseModeRef.current !== 'floor'
      && (activeSource === 'carto-dark' || activeSource === 'amap-satellite' || activeSource === 'esri-satellite' || activeSource === 'img');
    // 2026-11-11 图层：画布只画当前活动层的实体（边界/锚点跨层共享，过滤视图原样保留）。
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
      bearing: v.bearing ?? 0,
    };
    // 2026-11-16 罗盘拖转 2D：bearing≠0 时底图/纸面画进「绕中心旋转」的 ctx 包裹层，
    // 业务层经投影函数（同一旋转口径）自动跟随；屏幕系角标在包裹层外保持水平。
    // 地图内容屏幕转角 = -bearing，与罗盘针同向（针 = -bearing）。
    const mapBearing = v.bearing ?? 0;
    const rotateBaseCtx = (): void => {
      if (!mapBearing) return;
      baseCtx.save();
      baseCtx.translate(cssW / 2, cssH / 2);
      baseCtx.rotate(-mapBearing);
      baseCtx.translate(-cssW / 2, -cssH / 2);
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
      // 罗盘拖转：ctx 包一层旋转，投影传轴对齐口径（bearing:0）避免双重旋转。
      rotateBaseCtx();
      paintFloorGrid(baseCtx, { ...viewport, bearing: 0 }, cssW, cssH, Boolean(mapBearing));
      if (mapBearing) baseCtx.restore();
      publishBasemapLoading(false);
    } else if (!basemapVisibleRef.current) {
      // 图层里关了底图：不再铺瓦片，业务层照常画。
      publishBasemapLoading(false);
    } else {
    // 旋转可视区在轴对齐瓦片系里是旋转矩形的 AABB：W'=W|cos|+H|sin|、H'=W|sin|+H|cos|。
    const cosB = Math.abs(Math.cos(mapBearing));
    const sinB = Math.abs(Math.sin(mapBearing));
    const effW = (cssW * cosB + cssH * sinB) / overScale;
    const effH = (cssW * sinB + cssH * cosB) / overScale;
    const grid = visibleTileGrid(tileCenter.lng, tileCenter.lat, tileZoom, effW, effH);
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
    rotateBaseCtx();
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
      ...(mapBearing ? { cullW: cssW * cosB + cssH * sinB, cullH: cssW * sinB + cssH * cosB } : {}),
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
    if (mapBearing) baseCtx.restore();
    // 「加载中」信号取限流器视角（在途+排队）：成败都会结算，归零可靠；
    // paint 结果里的 pending 含已失败格（网络断时永远 >0），不能拿来当转圈依据。
    publishBasemapLoading(basemapCacheRef.current.loadingCount > 0);
    }

    // 2026-11-16 用户：「这个文字是不是也要根据不同的地图给适配？深色的话分区就要是白色的」。
    // 采样底图平均亮度：偏暗（卫星影像/深色路网）→ 图上文字改白字 + 深描边。
    // 室内纸面/关掉底图时不采（那两种底本身是浅色）。
    const labelTone = detectCanvasTone(
      basemapVisibleRef.current && baseModeRef.current !== 'floor' ? baseCanvas : null,
      activeSource === 'img' || activeSource === 'amap-satellite' || activeSource === 'esri-satellite' ? 'dark' : 'light',
    );

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
    // 2026-11-14：流线顶点拖拽预览（未 commit 前仅绘制，与分区/设施同机制）。
    const routeDragPreview = routeDragPreviewRef.current;
    const drawnRoutes = routeDragPreview
      ? routes.map(r => (r.id === routeDragPreview.routeId ? { ...r, points: routeDragPreview.points } : r))
      : routes;
    // 2026-11-16 用户「解锁了之后还是无法编辑」：不再要求先进「编辑边界」模式——
    // 只要边界没锁，浏览模式就挂大号实心方点（可直接拖）；选择模式仍是框选，不给可拖错觉。
    const boundaryMode = modeRef.current;
    const editingBoundary = lockedLayersRef.current.boundary !== true
      && (boundaryMode === 'boundary-vertex' || boundaryMode === 'view');
    const boundary = previewRingRef.current ?? current.boundary;
    const review = mapEditHighlightRef.current;
    const layer = { ctx: planCtx, viewport };
    // 2026-11-15 用户指令「先快速画一个大陆」：设计范围要先压暗框外，再画边界/分区。
    // 压暗必须在最下层——否则暗色会盖在分区色块和设施贴纸上，框内反而看不清。
    const designScope = current.designScope ?? [];
    if (designScope.length >= 3) {
      // 2026-11-15 用户「顶部的设计信息有点烦，锁住再显示」：
      // 平时不挂面积标签（框本身已经说明范围）；锁上后才显示，连同解锁提示一起。
      const scopeLocked = scopeLockedRef.current;
      // 2026-11-15：框右上外侧的锁定钮（默认不锁；锁上后拖角/拖边不再响应）。
      const lockRect = scopeLockButtonRect(
        designScope.map(point => planPointToPixel(point, viewport)),
        viewport,
      );
      drawDesignScopeMask(layer, designScope, {
        // 未锁定时不传 label：`exactOptionalPropertyTypes` 下显式 undefined 不算「没传」。
        ...(scopeLocked ? { label: `设计范围 · 约 ${Math.round(scopeAreaM2(designScope))} m² · 已锁定 · 点锁解锁` } : {}),
        // 标签靠右延伸时要给锁定钮让位，不然文字会被钮压住。
        ...(lockRect ? { labelMaxRightPx: lockRect.x - 8 } : {}),
        // 2026-11-15 视觉定稿：框外改白色毛玻璃——取样源是刚铺好的底图 canvas，
        // 只虚化底图，框外的流线/设施（业务层）仍清晰可读。
        frostSource: { canvas: baseCanvas, cssWidth: cssW, cssHeight: cssH },
      });
      if (lockRect) drawScopeLockButton(layer, lockRect, scopeLocked);
    }
    if (isLayerVisible(vis, 'boundary')) {
      // 2026-11-16 用户「这个的区域设计…我不是说了也是上锁的逻辑吗」：
      // 锁上时连顶点小点也不画——那几个点会被当成「可拖手柄」，锁了还画看着就像没锁。
      drawBoundaryLayer(layer, boundary, {
        // 「边界没锁 + 浏览/选择/编辑边界」= 可拖的编辑态，方点画大一号。
        vertexHandles: editingBoundary,
        vertexDots: lockedLayersRef.current.boundary !== true,
        // 2026-11-16 用户：不同底图上的对比要不一样——矢量底灰线，影像/深色底亮线。
        halo: boundaryHaloToneFor(activeSource),
        // 2026-11-16 用户「锁定之后不要描边」：锁上就只留一层淡填色，没有任何边。
        locked: lockedLayersRef.current.boundary === true,
      });
      // 2026-11-16 用户「你要补上一些交互提示」：悬停顶点给高亮框，悬停边线给「+」加点把手。
      // 只在真能拖的浏览模式画，免得给出看不见的假手感。
      if (editingBoundary && boundaryMode === 'view') {
        drawBoundaryEditHints(layer, boundary, {
          vertexHoverIndex: boundaryVertexHoverRef.current,
          armedVertexIndex: boundaryDeleteArmedRef.current,
          edgeHintPx: boundaryEdgeHintRef.current,
        });
      }
      // 2026-11-16 用户：点击第一下，白底方框的绿色描边就转琥珀——预告“再点一下会删”，
      // 而不是删完才闪。琥珀框会跟着钉子留在那个顶点上，直到交互改变或超时。
      if (review?.kind === 'scope' && !editingBoundary) drawMapEditHighlight(layer, boundary, 'area');
      // 2026-11-16 用户「场地右上角也加一个小锁」：绿色总区域自带一枚锁，不用再跑左栅。
      if (boundaryMode === 'view' || boundaryMode === 'select' || boundaryMode === 'boundary-vertex') {
        const boundaryLockRect = boundaryLockRectAt(viewport);
        if (boundaryLockRect) {
          drawScopeLockButton(layer, boundaryLockRect, lockedLayersRef.current.boundary === true);
        }
      }
    }
    // 2026-11-14 用户指令「建筑给室内分区」：建筑足迹灰块（室内禁区），画在分区层之下。
    if ((current.buildings ?? []).length) {
      drawBuildingLayer({ ctx: planCtx, viewport }, current.buildings ?? []);
    }

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
        { tone: labelTone },
      );
      // 2026-11-16 用户指令：门贴边时把那条边高亮出来，并在落点画一道法线小刻度，
      // 让人一眼看出「会被吸到这条边、门朝这边」；松手后高亮自动消失。
      const doorSnap = doorSnapRef.current;
      if (doorSnap && modeRef.current === 'facility') {
        const [edgeA, edgeB] = doorSnap.edge;
        const pa = planPointToPixel(edgeA, viewport);
        const pb = planPointToPixel(edgeB, viewport);
        const at = planPointToPixel(doorSnap.point, viewport);
        const rad = (doorSnap.rotationDeg * Math.PI) / 180;
        planCtx.save();
        planCtx.strokeStyle = '#1f8a5b';
        planCtx.lineCap = 'round';
        planCtx.lineWidth = 3;
        planCtx.beginPath();
        planCtx.moveTo(pa.x, pa.y);
        planCtx.lineTo(pb.x, pb.y);
        planCtx.stroke();
        planCtx.lineWidth = 2;
        planCtx.beginPath();
        planCtx.moveTo(at.x, at.y);
        // 屏幕系 y 向下，所以世界法线的 y 轴取反。
        planCtx.lineTo(at.x + Math.cos(rad) * 16, at.y - Math.sin(rad) * 16);
        planCtx.stroke();
        planCtx.restore();
      }
      if (review?.kind === 'zones') {
        for (const zone of drawnZones) {
          if (review.zoneIds.includes(zone.id)) drawMapEditHighlight(layer, zone.polygon, 'area');
        }
      }
      // P2-j：选中的分区画顶点手柄（与边界顶点同一套视觉/命中半径）。
      const selectedZone = selectedZoneRef.current
        ? drawnZones.find(zone => zone.id === selectedZoneRef.current) ?? null
        : null;
      if (selectedZone && selectedZone.polygon.length >= 3 && modeRef.current === 'view' && !layerLocked('zone')) {
        const px = selectedZone.polygon.map(pt => planPointToPixel(pt, viewport));
        // 2026-11-15 用户反馈「舞台区 1 一选中就变灰底灰描边」：选中不再另叠一层白虚线 + 深灰把手，
        // 描边与手柄直接沿用这个分区自己的颜色——形状一眼还是“那一块”，只是多了可拖的把手。
        const zoneColor = selectedZone.color ?? defaultZoneColor(selectedZone.semantic);
        planCtx.save();
        planCtx.strokeStyle = withAlphaHex(zoneColor, 0.95);
        planCtx.lineWidth = 1.8;
        planCtx.setLineDash([6, 4]);
        planCtx.beginPath();
        px.forEach((p, i) => (i === 0 ? planCtx.moveTo(p.x, p.y) : planCtx.lineTo(p.x, p.y)));
        planCtx.closePath();
        planCtx.stroke();
        planCtx.setLineDash([]);
        const hoverVertex = zoneVertexHoverRef.current;
        const snapVertex = zoneVertexSnapRef.current;
        px.forEach((p, i) => {
          const hot = hoverVertex !== null && hoverVertex.zoneId === selectedZone.id && hoverVertex.index === i;
          const magnet = snapVertex !== null && snapVertex.zoneId === selectedZone.id && snapVertex.index === i;
          // 悬停顶点用红环白心（点了就删）；被吸住的目标用琥珀大圈（马上要并到这里）；
          // 平时就是白心 + 分区色描边的细把手。
          planCtx.fillStyle = hot ? '#ffffff' : magnet ? '#F2A33C' : '#ffffff';
          planCtx.strokeStyle = hot ? '#E5484D' : magnet ? '#ffffff' : withAlphaHex(zoneColor, 0.95);
          planCtx.lineWidth = magnet ? 2.5 : hot ? 2 : 1.8;
          planCtx.beginPath();
          planCtx.arc(p.x, p.y, magnet ? 8 : hot ? 6 : 4.5, 0, Math.PI * 2);
          planCtx.fill();
          planCtx.stroke();
        });
        // 2026-11-15：悬停边中段 → 画一枚「加点」手柄（白底墨环 + 十字），点下去就插点。
        const edgeHint = zoneEdgeHintRef.current;
        if (edgeHint && edgeHint.zoneId === selectedZone.id) {
          const hp = planPointToPixel(edgeHint.point, viewport);
          planCtx.beginPath();
          planCtx.arc(hp.x, hp.y, 6, 0, Math.PI * 2);
          planCtx.fillStyle = 'rgba(255,255,255,0.96)';
          planCtx.fill();
          planCtx.strokeStyle = 'rgba(18,20,26,0.9)';
          planCtx.lineWidth = 2;
          planCtx.stroke();
          planCtx.beginPath();
          planCtx.moveTo(hp.x - 3, hp.y);
          planCtx.lineTo(hp.x + 3, hp.y);
          planCtx.moveTo(hp.x, hp.y - 3);
          planCtx.lineTo(hp.x, hp.y + 3);
          planCtx.stroke();
        }
        planCtx.restore();
      }
      // 2026-11-15 用户指令「分区里没有图标，不要任性加图标」：删掉画布上的分区语义贴纸。
      // 分区数据（planZoneSchema）并没有 icon 字段，工具箱里也只有色块 + 语义名，
      // 画布上再多画一枚图标就是凭空给定用户的数据加了不存在的东西。
      // 名称仍由 drawZoneLayer 按面积质心居中绘制；若以后契约真加了 icon 字段，
      // 再在分区内部按那个字段画，而不是按语义推断。
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
      const previewGhost = pendingFacilityGhost();
      const previewTarget = previewGhost?.preview
        ? [...current.facilities].reverse().find(f => facilityContainsPoint(previewGhost.position, f)) ?? null
        : null;
      const baseFacilities = previewMap.size > 0
        ? current.facilities.map(f => previewMap.get(f.id) ?? f)
        : current.facilities;
      // 物料卡预览压在已有设施上：旧设施的占地/图标先藏掉，只留卡片幽灵；松手原地换模型。
      const drawnFacilities = previewTarget
        ? baseFacilities.filter(f => f.id !== previewTarget.id)
        : baseFacilities;
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
          ?? (facility.templateId.startsWith('oneplan:') || facility.templateId.startsWith('library:')
            ? facility.templateId.split(':')[2] ?? ''
            : '');
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
    // 2026-11-16 #118 方案 B：车辆实体（只读标记，与 3D plan-vehicle-entities 同源规格）。
    // 放在业务层之后、动线之前：车压住分区/设施底图，但不盖动线与节点手柄。
    drawVehicleMarkers({ ctx: planCtx, viewport }, filterPlanByLevel(plan, activeLevelIdRef.current));
    if (isLayerVisible(vis, 'route')) {
      drawRouteLayer(
        { ctx: planCtx, viewport },
        drawnRoutes.map(r => ({
          ...r,
          // 2026-11-14：框选跨类型多选——流线多选同样高亮。
          selected: r.id === selectedRouteRef.current || multiSelectedRouteIdsRef.current.includes(r.id),
        })),
      );
      if (review?.kind === 'main-routes') {
        for (const route of drawnRoutes) {
          if (review.routeIds.includes(route.id)) drawMapEditHighlight(layer, route.points, 'route');
        }
      }
      // H4-b：动线类型贴纸（线型/箭头/选中白描边仍由 drawRouteLayer 负责）。
      // 2026-11-15 用户指令：「把 icon 放在每个节点上，文字不要显示，icon 和线条同色」。
      // 所以每个折点都是一枚与线同色的类型芯片；原来「中间一枚芯片 + 其余黑点」的混排取消——
      // 芯片本身就是节点手柄（可拖、点一下删、拖到相邻就被吸住），不再另画黑点。
      // 2026-11-16 用户：「道路上的 icon 还是没改」——每个折点不再画 OnePlan 贴纸
      // （那套图自带 PED / VEH / LZ 英文小字），改成与属性栏同源的自绘芯片：
      // 底色 = 动线类型色，字形 = 行人 / 货车 / 包裹，白环 + 白描边，不写文字。
      for (const route of drawnRoutes) {
        const chipColor = route.color ?? PLANNING_ROUTE_KIND_COLORS[route.kind];
        for (const pt of route.points) {
          const p = planPointToPixel(pt, viewport);
          drawRouteKindChip({ ctx: planCtx, viewport }, p, route.kind, { color: chipColor, diameter: 15, alpha: 0.97 });
        }
      }
      // 2026-11-15 用户指令「路线和分区一样」：悬停/被吸住的手柄提示还留着——
      // 悬停在节点上：红环（点一下就删）；拖到相邻节点 12 px 内：琥珀环（松手并到这里）。
      const selectedRouteForHandles = selectedRouteRef.current
        ? drawnRoutes.find(r => r.id === selectedRouteRef.current) ?? null
        : null;
      if (selectedRouteForHandles && selectedRouteForHandles.points.length >= 2 && !layerLocked('route')) {
        const px = selectedRouteForHandles.points.map(pt => planPointToPixel(pt, viewport));
        const hoverVertex = routeVertexHoverRef.current;
        const snapVertex = routeVertexSnapRef.current;
        planCtx.save();
        px.forEach((p, i) => {
          const hot = hoverVertex !== null && hoverVertex.routeId === selectedRouteForHandles.id && hoverVertex.index === i;
          const magnet = snapVertex !== null && snapVertex.routeId === selectedRouteForHandles.id && snapVertex.index === i;
          if (!hot && !magnet) return;
          planCtx.beginPath();
          planCtx.arc(p.x, p.y, magnet ? 11 : 10, 0, Math.PI * 2);
          planCtx.strokeStyle = hot ? '#E5484D' : '#F2A33C';
          planCtx.lineWidth = magnet ? 2.5 : 2;
          planCtx.stroke();
        });
        // 悬停在线中段 → 「加点」手柄（白底墨环 + 十字，与分区同一套视觉）。
        const edgeHint = routeEdgeHintRef.current;
        if (edgeHint && edgeHint.routeId === selectedRouteForHandles.id) {
          const hp = planPointToPixel(edgeHint.point, viewport);
          planCtx.beginPath();
          planCtx.arc(hp.x, hp.y, 6, 0, Math.PI * 2);
          planCtx.fillStyle = 'rgba(255,255,255,0.96)';
          planCtx.fill();
          planCtx.strokeStyle = 'rgba(18,20,26,0.9)';
          planCtx.lineWidth = 2;
          planCtx.stroke();
          planCtx.beginPath();
          planCtx.moveTo(hp.x - 3, hp.y);
          planCtx.lineTo(hp.x + 3, hp.y);
          planCtx.moveTo(hp.x, hp.y - 3);
          planCtx.lineTo(hp.x, hp.y + 3);
          planCtx.stroke();
        }
        planCtx.restore();
      }
    }
    if (isLayerVisible(vis, 'worker')) {
      const warningWorkerIds = new Set(
        workerIssuesRef.current.filter(i => i.issue.code === 'out-of-boundary').map(i => i.workerId),
      );
      // 2026-11-14 用户指令「生成的任何东西都要可以编辑」：人员点位拖拽预览（未 commit 前仅绘制）。
      const workerDragPreview = workerDragPreviewRef.current;
      const drawnWorkers = workerDragPreview
        ? current.workers.map(w => (w.id === workerDragPreview.worker.id ? workerDragPreview.worker : w))
        : current.workers;
      drawWorkerLayer(
        { ctx: planCtx, viewport },
        drawnWorkers.map(w => ({
          ...w,
          selected: w.id === selectedWorkerRef.current,
          warning: warningWorkerIds.has(w.id),
          // 2026-11-16 用户：「地图上直接就是图标，不要一个点、上面再一个图标」——
          // 有岗位贴纸的人位只留图标（圆点交给贴纸自己当底），无贴纸的岗位仍画圆点。
          chip: workerSticker(w.role) !== null,
          // B3：有人在区内/坐着时给人位加状态色环；未在 3D 注册（无人群）就不画。
          state: workerRoamState(w.id, w.count) ?? undefined,
        })),
        { tone: labelTone },
      );
      // H4-b：人员岗位图标（画在点位中心，就是这一个人位本身）。
      for (const worker of drawnWorkers) {
        const sticker = workerSticker(worker.role);
        if (!sticker) continue;
        const pt = planPointToPixel(worker.position, viewport);
        // 2026-11-16 用户「场地上的人物的 icon 全都是黑色的，左侧明明是有颜色的」：
        // 这里原来没传 color，落到 ONEOPLAN_CHIP_FILL 深色芯片（白字形＋近黑底＝一片黑），
        // 而左侧「工作人员」九行用的是 libraryEntryColor（同岗位永远同色），3D 那边也是同一张
        // 调色板（outdoor-plan-3d.tsx 的 roleColor）——只有 2D 这一处掉队。
        // 现按设施芯片同口径跟色：活动包点位自带色（worker.color）优先，其余按岗位 slug 回落。
        // 主题色优先级（2026-11-16）：点位自带色（活动包）> 岗位表里写死的九岗色 > slug 调色板。
        const chipColor = worker.color
          ?? workerRoleColor(worker.role)
          ?? libraryEntryColor({ slug: sticker.slug });
        drawOneplanSticker(planCtx, sticker, pt.x, pt.y, 16, { alpha: 0.95, color: chipColor });
      }
    }
    if (isLayerVisible(vis, 'access')) {
      const unconnectedIds = new Set(nodeIssuesRef.current.map(i => i.nodeId));
      drawAccessLayer(
        { ctx: planCtx, viewport },
        nodes.map(n => ({
          ...n,
          // 2026-11-14：框选跨类型多选——出入口候选多选同样高亮。
          selected: n.id === selectedNodeRef.current || multiSelectedNodeIdsRef.current.includes(n.id),
          unconnected: unconnectedIds.has(n.id),
        })),
        { tone: labelTone },
      );
      // H4-b：出入口贴纸画在「圆牌」上（直径 20 px）；
      // 2026-11-16 用户：「3D 那个圈圈很形象，2D 的 icon 有点看不清」——
      // 圆盘与白圈在 drawAccessLayer 里画，这里只负责把贴纸（同色圆片 + 白色字形）放上去；
      // 未连接警示点在贴纸之后补画，不被圆片盖住。
      // 2026-11-15：芯片色按 kind 走（绿进 / 红出 / 青双向），三型不再共用深色圆片。
      // 2026-11-16 用户：「出入口现在不要是图标，我更喜欢环形的东西」——
      // 圆牌已换成空心环（drawAccessLayer 自己画完），这里不再叠贴纸字形，
      // 只保留「未连接」警示点（画在环外右上方，不被环压住）。
      for (const node of nodes) {
        const pt = planPointToPixel(node.position, viewport);
        if (unconnectedIds.has(node.id)) {
          planCtx.beginPath();
          planCtx.arc(pt.x + 9, pt.y - 9, 3.6, 0, Math.PI * 2);
          planCtx.fillStyle = '#c0392b';
          planCtx.fill();
          planCtx.strokeStyle = '#ffffff';
          planCtx.lineWidth = 1.4;
          planCtx.stroke();
        }
      }
      if (review?.kind === 'main-routes') {
        const positions = nodes.filter(node => review.nodeIds.includes(node.id)).map(node => node.position);
        drawMapEditHighlight(layer, positions, 'entrance');
      }
    }
    // H3-a 固定测量标注（测量图层在最上层；隐藏测量层不影响数据与统计）。
    if (isLayerVisible(vis, 'measure')) {
      drawMeasureLayer(
        { ctx: planCtx, viewport, dark: darkBasemap },
        (current.measurements ?? []).map(m => ({
          ...m,
          // 拖动中的预览几何优先（松手才进 plan，一条 undo）。
          ...(measurementDragPreviewRef.current?.id === m.id ? { points: measurementDragPreviewRef.current.points } : {}),
          selected: m.id === selectedMeasurementRef.current,
          // 可编辑时读数走图上贴片（带 ×），画布不再重复画一遍文字。
          showLabel: readOnly,
        })),
      );
    }
    // 2026-11-11 用户指令：自由标注图层（文本/形状；随「标注」图层开关隐藏，不影响数据与统计）。
    if (isLayerVisible(vis, 'annotate')) {
      drawAnnotationLayer(
        { ctx: planCtx, viewport },
        (current.annotations ?? []).map(a => ({ ...a, selected: a.id === selectedAnnotationRef.current })),
      );
    }

    // H3-b 冲突/缺失可定位标记：规则检查输出，恒画在业务层之上（不随图层隐藏），
    // 点击命中判定由组件按同半径处理（展开该徽章的明细）。
    // 2026-11-15：一条线多枚叹号合并成一枚（数字 = 组内条数），默认只画冲突/缺宽度。
    drawConflictMarkers(
      { ctx: planCtx, viewport },
      visibleConflictClusters().map(cluster => ({ key: cluster.key, status: cluster.status, at: cluster.at, count: cluster.count })),
    );

    // 3) 绘制草稿（画边界/画分区/圈设计范围）：≥3 点后闭合预览；形状非法（自交）画红色。
    const activeMode = modeRef.current;
    // 2026-11-15：拖角改设计范围时不切模式，靠 scopeResizeRef 让草稿照样画出来（否则 view 模式下预览不画）。
    const draftingScope = activeMode === 'scope' || scopeResizeRef.current !== null || scopeEdgeResizeRef.current !== null;
    if (activeMode === 'boundary' || activeMode === 'zone' || draftingScope) {
      const draftPoints = draftRef.current;
      if (draftPoints.length > 0) {
        const draftColor = activeMode === 'zone'
          // 2026-11-12 活动包区预设：草稿直接用物件主题色。
          ? (zonePresetRef.current?.color ?? defaultZoneColor(zoneSemanticRef.current))
          : activeMode === 'scope' || draftingScope
            // 设计范围用琥珀色，与边界红区分（一眼看出这是外框，不是场地红线）。
            ? '#F2A33C'
            // 2026-11-17 用户「画红线时是绿的，看不清，应该改成红色虚线」：
            // 草稿和落笔后的红线同一色（虚线只表示还没闭合），不再用品牌绿。
            : PLANNING_BOUNDARY_LINE_COLOR;
        const draftInvalid = draftPoints.length >= 4 && planRingSelfIntersects(draftPoints);
        drawDraftLayer({ ctx: planCtx, viewport }, draftPoints, draftColor, { draftInvalid });
      }
    }

    // 4) H2-d 动线草稿与节点放置幽灵；H3-a 测量草稿（临时读数跟指针）。
    if (activeMode === 'route') {
      drawRouteDraft({ ctx: planCtx, viewport }, routeDraftRef.current, routeKindRef.current, routeCursorRef.current ?? undefined);
    }
    if (activeMode === 'measure') {
      drawMeasureDraft({ ctx: planCtx, viewport, dark: darkBasemap }, measureDraftRef.current, measureKindRef.current, measureCursorRef.current ?? undefined);
    }
    // 2026-11-11 用户指令：形状草稿（拖拽实时预览 / 三角形逐点橡皮筋）。
    if (activeMode === 'shape') {
      drawAnnotationDraft({ ctx: planCtx, viewport }, annotateDraftRef.current, annotateShapeRef.current, annotateCursorRef.current ?? undefined, annotateColorRef.current, annotateStrokeWidthRef.current);
    }
    // 2026-11-16 用户「操作过程中需要有提示」：Alt 分叉的「+」把手画在最上层，压过所有图层。
    if (branchAnchorHintRef.current && altHeldRef.current) {
      drawBranchAnchor({ ctx: planCtx, viewport }, branchAnchorHintRef.current);
    }
    if (activeMode === 'node' && nodeGhostRef.current) {
      drawNodeGhost({ ctx: planCtx, viewport }, nodeKindRef.current, nodeKindLabel(nodeKindRef.current), nodeGhostRef.current);
    }

    // 5) 设施放置幽灵（H2-c）：跟随指针的占地预览，越界变红；旋转/越界与 3D draft 同一份来源。
    const facilityGhost = pendingFacilityGhost();
    if (facilityGhost) {
      drawFacilityGhost(
        { ctx: planCtx, viewport },
        facilityGhost.template,
        facilityGhost.position,
        { rotationDeg: facilityGhost.rotationDeg, invalid: facilityGhost.invalid },
      );
    }

    // D) 阵列复制幽灵预览：repeat 面板打开时按当前列/行/间距画出全部副本落点；越界/碰撞格标红。
    if (repeatParamsRef.current.cardMode === 'repeat' && selectedFacilityRef.current) {
      const repeatAnchor = current.facilities.find(f => f.id === selectedFacilityRef.current) ?? null;
      if (repeatAnchor) {
        const rp = repeatParamsRef.current;
        const repeatPreview = evaluateRepeatPreview(repeatAnchor, rp.cols, rp.rows, rp.gapX, rp.gapY, current.facilities, current.boundary, rp.margin);
        for (const slot of repeatPreview.slots) {
          drawFacilityGhost(
            { ctx: planCtx, viewport },
            { name: repeatAnchor.name, width: repeatAnchor.size.width, depth: repeatAnchor.size.depth },
            slot.position,
            { rotationDeg: repeatAnchor.rotationDeg, invalid: slot.invalid },
          );
        }
      }
    }

    // 6) P2-i：常驻比例尺 + 署名（右下角，避让右侧竖控件簇；2026-11-16 用户指令归位）。
    //    指北针/取景/缩放/漫游等控件在右侧竖列（DOM，outdoor-plan-overlay），画布角标只画比例尺与署名。
    //    纸面模式无图源不画署名。
    drawScaleAttribution(planCtx, viewport, cssW, cssH, baseModeRef.current !== 'floor' ? activeSource : null);

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
    const workflow=workflowPreviewRef.current;
    if(workflow){
      if (workflowScopePreviewRef.current && workflow.anchor && isLayerVisible(vis, 'boundary')) {
        drawSearchArea({ ctx: planCtx, viewport: { ...viewport, anchorLng: workflow.anchor.lng, anchorLat: workflow.anchor.lat } }, {
          points: workflow.boundary,
          label: '候选活动范围（待核对）',
        });
      }
      const changed=<T extends {id:string}>(next:T[],before:T[])=>next.filter(a=>JSON.stringify(a)!==JSON.stringify(before.find(b=>b.id===a.id)));
      drawZoneProposalLayer({ctx:planCtx,viewport},{zones:changed(workflow.zones,current.zones),facilities:changed(workflow.facilities,current.facilities)});
      drawRouteProposalLayer({ctx:planCtx,viewport},{routes:changed(workflow.routes,current.routes),nodes:changed(workflow.nodes,current.nodes)});
      for(const worker of changed(workflow.workers,current.workers)){const pt=planPointToPixel(worker.position,viewport);planCtx.save();planCtx.setLineDash([4,3]);planCtx.strokeStyle=PLANNING_SURFACE.panelText;planCtx.beginPath();planCtx.arc(pt.x,pt.y,7,0,Math.PI*2);planCtx.stroke();planCtx.fillStyle=PLANNING_SURFACE.panelText;planCtx.fillText(`${worker.role} ×${worker.count}（预览）`,pt.x+9,pt.y);planCtx.restore();}
    }
    for(const highlight of evidenceHighlightsRef.current??[]){
      const pts=highlight.geometry.points.map(p=>planPointToPixel(p,viewport));if(!pts.length)continue;
      planCtx.save();planCtx.strokeStyle=PLANNING_SURFACE.panelText;planCtx.lineWidth=3;planCtx.setLineDash([6,4]);planCtx.beginPath();
      if(highlight.geometry.type==='point')planCtx.arc(pts[0]!.x,pts[0]!.y,11,0,Math.PI*2);
      else{planCtx.moveTo(pts[0]!.x,pts[0]!.y);for(const pt of pts.slice(1))planCtx.lineTo(pt.x,pt.y);if(highlight.geometry.type==='polygon')planCtx.closePath();}
      planCtx.stroke();planCtx.restore();
    }
    if (zoneProposalRef.current) {
      drawZoneProposalLayer({ ctx: planCtx, viewport }, zoneProposalRef.current);
      if (zoneProposalRef.current.routes?.length) drawRouteProposalLayer({ ctx: planCtx, viewport }, { routes: zoneProposalRef.current.routes, nodes: zoneProposalRef.current.nodes ?? [] });
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
        /** 2026-11-17 自动设计范围验收：边界点数 + 设计范围是否在（面积 m²）。 */
        boundaryPoints: current.boundary.length,
        /** 顶点数组（拖拽验收要精确按住顶点）。 */
        boundary: current.boundary.map(p => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })),
        boundaryBBoxM: current.boundary.length ? {
          w: Math.round(Math.max(...current.boundary.map(p => p.x)) - Math.min(...current.boundary.map(p => p.x))),
          h: Math.round(Math.max(...current.boundary.map(p => p.y)) - Math.min(...current.boundary.map(p => p.y))),
        } : null,
        scopeBBoxM: current.designScope?.length ? {
          w: Math.round(Math.max(...current.designScope.map(p => p.x)) - Math.min(...current.designScope.map(p => p.x))),
          h: Math.round(Math.max(...current.designScope.map(p => p.y)) - Math.min(...current.designScope.map(p => p.y))),
        } : null,
        designScopeAreaM2: current.designScope?.length ? Math.round(scopeAreaM2(current.designScope)) : null,
        /** 当前吸附网格步长（米），验收脚本用它判断顶点是否真的落在网格上。 */
        gridStepM: planGridStepM(viewport),
        /** ENU 米 → 画布 CSS 像素（验收脚本用它把边界顶点/分区顶点换到鼠标坐标）。 */
        project: (pt: PlanPoint) => planPointToPixel(pt, viewport),
        /** 画布 CSS 像素 → ENU 米（2026-11-17：屏幕中心画框验收用）。 */
        unproject: (px: { x: number; y: number }) => planPixelToPoint(px, viewport),
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

  // B3：3D 漫游态跳档（进区 / 坐下 / 起身 / 回线）时重绘 2D 人位状态环。
  // 与流场模拟同一款合并重绘：一帧最多一次，draw 本身读当前注册表。
  useEffect(() => {
    let raf = 0;
    return subscribePersonRoam(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        drawRef.current();
      });
    });
  }, []);

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
  useEffect(()=>{draw();},[workflowPreview,workflowScopePreview,mapEditHighlight,evidenceHighlights]);
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
  // 2026-11-16：车组＝库里点名的那几种车，一段平铺；服务类 / 服务以外靠条目配色区分（后勤金 / 车行紫）。
  const libraryVehicleIcons = useMemo(() => vehicleIconItems(libraryAll), [libraryAll]);
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

  // 地图舞台滚轮/触控板捏合：passive:false 才能 preventDefault 拦住浏览器原生页面滚动
  // 与捏合(Ctrl+wheel)页面缩放。原生动作若不拦截，会和地图缩放叠加，把画布布局/投影挤错位，
  // 表现为放大后周边点位看似消失。缩放走指针锚定（zoomAtPoint），指针下的点保持不动。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      const target = event.target as Element | null;
      // 2026-11-15 用户报「在属性面板里滚动，地图却跟着缩放」：面板 DOM 就在舞台内，
      // 而原生 wheel 监听挂在舞台（比 React 根上的合成事件更早跑），面板上的
      // onWheel={stopPanelWheel} 拦不住它——这里直接按 data-plan-panel 跳过，让面板自己滚。
      if (target?.closest?.('[data-plan-panel]')) return;
      if (!stage.contains(target as Node)) return;
      event.preventDefault();
      zoomAtPoint(event.deltaY < 0 ? 1 : -1, event.clientX, event.clientY);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [zoomAtPoint]);

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
    // 2026-11-17 用户「案例库画完了红线，外面没有白色框」：有设计范围时按**范围**取景。
    // 只框边界的话，外扩 20 m 的白框正好落在视口外——框其实在数据里，却看着像没生成。
    const scope = planRef.current.designScope ?? [];
    const viewRing = scope.length >= 3 ? scope : boundary;
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
      viewRing.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
      if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;
      const anchor = planRef.current.anchor;
      const geo = enuToLngLat((minX + maxX) / 2, (minY + maxY) / 2, anchor?.lng ?? DEFAULT_ANCHOR_LNG, anchor?.lat ?? DEFAULT_ANCHOR_LAT);
      // 边界（或设计范围）外留 35% 余量：矮墙/标签不至于贴边。
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
        // 2026-11-16 用户：「正在画线时 Ctrl+Z 应该撤我刚放的点，而不是我之前画好的上一条线」。
        // 半成品在手上时，历史栈里的东西其实是“上一次任务”，撤它等于把人带丢。
        if (undoDraftStep()) return;
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
      // 2026-11-16 设施落位前旋转：R +15°，Shift+R −15°（2D / 3D 接管态同一个 window 监听）。
      if (
        modeRef.current === 'facility'
        && !inField
        && !target?.isContentEditable
        && !event.ctrlKey && !event.metaKey && !event.altKey
        && (event.key === 'r' || event.key === 'R')
      ) {
        event.preventDefault();
        rotatePendingFacility(event.shiftKey ? -15 : 15);
        return;
      }
      if (event.key !== 'Escape') return;
      // 与撤销/重做、删除/方向键同口径：焦点在输入控件内时 Esc 只归输入框，不退出画布绘制模式。
      if (inField || target?.isContentEditable) return;
      // 2026-11-17 用户实测：手画活动范围时按 Esc 只切回浏览，外层仍停在「核对具体活动范围」，
      // 地图上又留着这次草稿，看起来像「已框出、待写进方案」。Esc 是取消这次画线：
      // 清掉草稿、退出模式，并通知工作流撤掉未确认候选，绝不把它留在待写入状态。
      if (modeRef.current === 'boundary') {
        event.preventDefault();
        event.stopPropagation();
        const hadDraft = draftRef.current.length > 0;
        setMode('view');
        setEditMessage(
          hadDraft
            ? '已取消这次画线：未写入活动范围。需要时再点「在地图上手画活动范围」。'
            : '已退出画线模式；活动范围未改动。',
        );
        onVenueBoundaryCanceledRef.current?.();
        return;
      }
      // 2026-11-16 用户：「点 esc 就退出物体编辑模式」——选择模式的 Esc 一步到位：
      // 清空选中（属性卡、3D 手柄随之收回）并回到浏览模式。
      if (modeRef.current === 'select') {
        clearEntitySelection();
        setMode('view');
        return;
      }
      if (modeRef.current === 'view') {
        // 2026-11-15：先收起问题明细卡（开着卡时 Esc 只关它），没有卡再取消组选。
        if (conflictDetailKeyRef.current) {
          showConflictDetail(null);
          return;
        }
        // 一层一层收：组选 → 单选 → 无选中。
        if (
          multiSelectedFacilityIdsRef.current.length > 0
          || multiSelectedRouteIdsRef.current.length > 0
          || multiSelectedNodeIdsRef.current.length > 0
        ) {
          clearMultiSelection();
          return;
        }
        // 浏览态再按 Esc：退出单选编辑（旧版只清组选，单选会一直挂着）。
        if (
          selectedFacilityRef.current
          || selectedZoneRef.current
          || selectedRouteRef.current
          || selectedNodeRef.current
          || selectedWorkerRef.current
          || selectedAnnotationRef.current
          || selectedMeasurementRef.current
        ) {
          clearEntitySelection();
        }
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
      // 2026-11-14：跨类型多选（流线/出入口）——Delete 批量删除；其余按键不占用。
      const multiRouteIds = multiSelectedRouteIdsRef.current;
      const multiNodeIds = multiSelectedNodeIdsRef.current;
      if (multiRouteIds.length || multiNodeIds.length) {
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          deleteCrossMulti();
        }
        return;
      }
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
        // 2026-11-17 #118 补录入 UI：选中的车辆同样一条 Delete 就删。
        const vehicleId = selectedVehicleRef.current;
        if (vehicleId) {
          event.preventDefault();
          deleteVehicle(vehicleId);
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
        // 2026-11-16 用户：「测量画完清理不掉」——选中的测量同样一条 Delete 就删。
        const measurementId = selectedMeasurementRef.current;
        if (measurementId) {
          event.preventDefault();
          deleteMeasurement(measurementId);
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

  // 2026-11-16 绘图五工具（Figma）：T 文本 / R 矩形 / O 圆形 / Y 三角形 / L 线段。
  // 再按当前工具不重进，避免清掉半成品；落位旋转仍独占 facility 下的 R。
  useAnnotateDrawShortcuts({
    enabled: Boolean(onPlanChange),
    getMode: () => modeRef.current,
    getShape: () => annotateShapeRef.current,
    onReveal: () => {
      // 底条收起时按 T/R/O/Y/L：先把底条展开，标注浮卡才有锚点，不会闪到右上角。
      window.dispatchEvent(new CustomEvent('scendance:open-outdoor-dock'));
      setInspectorPanel('annotate', true);
    },
    onNote: () => setMode('note'),
    onShape: kind => {
      annotateShapeRef.current = kind;
      setAnnotateShape(kind);
      setMode('shape');
    },
  });

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
      bearing: viewRef.current.bearing ?? 0,
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
    // bearing 缺省保留当前转角（focusBounds/focusLngLat/fit 等不重置旋转）；显式传 0 才回正北。
    const merged: View = { ...next, bearing: next.bearing ?? viewRef.current.bearing ?? 0 };
    viewRef.current = merged;
    setView({ ...merged });
    onViewChange?.(merged);
    draw();
  }

  function pan(dx: number, dy: number) {
    const v = viewRef.current;
    // 2026-11-16 bearing：屏幕位移先转回北朝上（轴对齐）系再走原有经纬换算——
    // 屏幕系内容位移 Δscreen → 轴系 Δaxis = R(bearing)·Δscreen（绕中心的同一旋转）。
    const bearing = v.bearing ?? 0;
    const ax = bearing ? dx * Math.cos(bearing) - dy * Math.sin(bearing) : dx;
    const ay = bearing ? dx * Math.sin(bearing) + dy * Math.cos(bearing) : dy;
    const w = 2 ** v.zoom * TILE;
    const dLng = -ax / w * 360;
    const latRad = v.lat * Math.PI / 180;
    // H3-c 修复：跟手平移——下拖（dy 正）相机北移，屏幕位移 = dLat·world·sec/360 = dy；
    // 旧版符号相反且少 2π 因子（下拖 40px 内容反而上移约 6px）。
    const dLat = ay / w * 360 * Math.cos(latRad);
    commitView({
      lng: clamp(v.lng + dLng, -180, 180),
      lat: clamp(v.lat + dLat, -85, 85),
      zoom: v.zoom,
      ...(v.bearing !== undefined ? { bearing: v.bearing } : {}),
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

  /**
   * 指针锚定缩放：缩放后指针下的地图点保持不动（对标 Leaflet / Mapbox），
   * 不再围绕画面中心把周边点位径向甩出画外。室内平面底没有经纬度投影，回退中心锚。
   */
  function zoomAtPoint(dir: number, clientX?: number, clientY?: number) {
    const v = viewRef.current;
    const floor = baseModeRef.current === 'floor';
    const nextZoom = clamp(
      v.zoom + dir,
      floor ? FLOOR_MIN_ZOOM : MAP_MIN_ZOOM,
      floor ? FLOOR_MAX_ZOOM : MAP_MAX_ZOOM,
    );
    if (nextZoom === v.zoom) return;
    if (floor) {
      commitView({ ...v, zoom: nextZoom });
      return;
    }
    const stage = stageRef.current;
    const W = stage?.clientWidth ?? 0;
    const H = stage?.clientHeight ?? 0;
    const rect = stage?.getBoundingClientRect();
    const px = rect && clientX !== undefined && clientY !== undefined
      ? { x: clientX - rect.left, y: clientY - rect.top }
      : { x: W / 2, y: H / 2 };
    const dx0 = px.x - W / 2;
    const dy0 = px.y - H / 2;
    // 2026-11-16 bearing：指针相对中心的位移转回轴对齐系（R(bearing)）再走径向锚定数学——
    // 缩放锚定是绕中心的径向运算，旋转不变，只需把指针位置换到北朝上系。
    const bearing = v.bearing ?? 0;
    const dx = bearing ? dx0 * Math.cos(bearing) - dy0 * Math.sin(bearing) : dx0;
    const dy = bearing ? dx0 * Math.sin(bearing) + dy0 * Math.cos(bearing) : dy0;
    const world = 2 ** v.zoom * TILE;
    const world2 = 2 ** nextZoom * TILE;
    // 与 pan() 同一套小角度线性近似：先取指针相对中心的经纬度，缩放后再把中心挪到
    // 「指针仍落在同一屏幕位置」所需的偏移，避免自造墨卡托反解把纬度带飞。
    const cosLat = Math.cos(v.lat * Math.PI / 180);
    const ptrLng = v.lng + dx / world * 360;
    const ptrLat = v.lat - dy / world * 360 * cosLat;
    const nextLng = ptrLng - dx / world2 * 360;
    const nextLat = ptrLat + dy / world2 * 360 * cosLat;
    commitView({
      lng: clamp(nextLng, -180, 180),
      lat: clamp(nextLat, -85, 85),
      zoom: nextZoom,
      ...(v.bearing !== undefined ? { bearing: v.bearing } : {}),
    });
  }

  // 舞台合成截图：底图+业务层两张 device 像素画布 1:1 叠进离屏画布，先铺纸底
  // （JPEG 无透明通道，空底图直接 encode 会透成黑底），再走 encodeStageCover 出封面。
  function captureStageImage(): string | null {
    const baseCanvas = baseCanvasRef.current, planCanvas = planCanvasRef.current;
    if (!baseCanvas || !planCanvas) return null;
    const width = baseCanvas.width || planCanvas.width, height = baseCanvas.height || planCanvas.height;
    if (!width || !height) return null;
    const composite = document.createElement('canvas');
    composite.width = width; composite.height = height;
    const ctx = composite.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#f5f6f7';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(baseCanvas, 0, 0);
    ctx.drawImage(planCanvas, 0, 0);
    return encodeStageCover(composite);
  }

  // P2-g：对外命令句柄（室内工具排通用钮转发：撤销/重做/缩放/截图）。
  // 不写依赖数组：每次渲染重建，句柄永远拿到当帧的闭包（这些函数都读 ref，成本可忽略）。
  useImperativeHandle(ref, () => ({
    zoomBy: (direction: 1 | -1) => zoomBy(direction),
    captureImage: () => planCanvasRef.current?.toDataURL('image/png') ?? null,
    captureStageImage: () => captureStageImage(),
    undo: () => undoPlan(),
    redo: () => redoPlan(),
    canUndo: () => historyRef.current.length > 0,
    canRedo: () => redoRef.current.length > 0,
    // 2026-11-16 罗盘拖转 2D：与 3D orbitByDelta 同口径（正增量 = 针顺时针 = bearing 减）。
    orbitByDelta: (deltaRad: number) => {
      const v = viewRef.current;
      commitView({
        lng: v.lng,
        lat: v.lat,
        zoom: v.zoom,
        bearing: ((v.bearing ?? 0) - deltaRad) % (Math.PI * 2),
      });
    },
    resetNorth: () => {
      const v = viewRef.current;
      commitView({ lng: v.lng, lat: v.lat, zoom: v.zoom, bearing: 0 });
    },
    getBearing: () => viewRef.current.bearing ?? 0,
    focusLngLat: (lng: number, lat: number, zoom?: number) => focusLngLat(lng, lat, zoom),
    focusBounds: (bounds: [number, number, number, number]) => focusBounds(bounds),
    focusDesignScope: () => focusDesignScope(planRef.current.designScope ?? []),
    inspectFacility: id => {
      const facility = planRef.current.facilities.find(item => item.id === id);
      if (!facility) return false;
      if (facility.levelId) setActiveLevelId(facility.levelId);
      setMode('select'); selectFacility(id); if (selectionPanelOnRef.current) setInspectorPanel('selection', true);
      setInspectorCollapsed(current => ({ ...current, selection: false }));
      return true;
    },
    beginVenueBoundary: anchor => {
      if (!canReanchorOutdoorPlan(planRef.current, anchor)) { setEditMessage('已有规划不能直接更换地理锚点，请先新建户外活动；当前内容保持不变。'); return false; }
      pendingVenueAnchorRef.current = anchor;
      focusLngLat(anchor.lng, anchor.lat, 17);
      setMode('boundary');
      setEditMessage('没有真实轮廓：请在地图上逐点圈出用地，闭合后才会写入新锚点与用地红线；Esc 取消。');
      return true;
    },
    applyWorkflowPlan:(next,expected)=>{
      const current=planRef.current;if(JSON.stringify(current)!==expected||!next.anchor)return false;
      // 2026-11-14「以第一个选区为准」：提案已不携带任何旧坐标系内容（换场清空）时允许换锚点——
      // 没有内容被静默搬动；内容存续时维持原有换锚保护。
      const frameBound=[next.zones,next.routes,next.nodes,next.facilities,next.workers,next.annotations,next.measurements].some(items=>items?.length);
      if(frameBound&&!canReanchorOutdoorPlan(current,next.anchor))return false;
      try{validateWorkflowPlan(current,next);}catch{return false;}
      // 2026-11-17 「同一标准」兜底：提议自己换了红线却没带白框（旧提案 / 别的产出路径），
      // 落地时按新红线外扩 20 m 补一只；来件带框就听它的，红线未变则保留现场那只（可能是用户拖过的）。
      const scope = scopeForAppliedPlan({
        currentBoundary: current.boundary,
        nextBoundary: next.boundary,
        nextScope: next.designScope,
      });
      commitPlan(scope ? { ...next, designScope: scope } : next);setEditMessage('已应用当前对话提案，可整批撤销。');draw();return true;
    },
    openFacilityUpload:id=>{if(!planRef.current.facilities.some(f=>f.id===id))return false;setMode('select');selectFacility(id);if(selectionPanelOnRef.current)setInspectorPanel('selection',true);requestAnimationFrame(()=>glbImportInputRef.current?.click());return true;},
    applyVenue: (anchor, boundary) => {
      if (!checkBoundaryRing(boundary).ok) return false;
      // 2026-11-16 用户定稿「换场地就是新场地」：锚点真挪了，旧草稿的分区/设施/流线/点位/人员整批删掉，
      // 只留新锚点与新用地红线（仍走 commitPlan，可整批撤销）；同一锚点重画边界则保留内容。
      // 2026-11-17 用户指令「画好红线默认=设计范围」：两条分支都自动生成外扩 20 m 的设计范围。
      const { plan: next, replaced, cleared } = planForPickedVenue(planRef.current, anchor, boundary);
      const withScope: SitePlanData = { ...next, designScope: expandRect(boundary, DEFAULT_SCOPE_MARGIN_M) };
      commitPlan(withScope);
      if (replaced) {
        setEditMessage(cleared > 0
          ? `已换场地：旧草稿的 ${cleared} 项内容已清空，可撤销。设计范围已按新场地自动生成（四边外扩 ${DEFAULT_SCOPE_MARGIN_M} m）。`
          : `已换场地：旧草稿已清空，可撤销。设计范围已按新场地自动生成（四边外扩 ${DEFAULT_SCOPE_MARGIN_M} m）。`);
      } else {
        setEditMessage(`红线已更新，设计范围已按场地四边外扩 ${DEFAULT_SCOPE_MARGIN_M} m 自动生成；要自定义就点「重拖设计范围」。`);
      }
      return true;
    },
    /** V-2d：应用流线提案（合并进 plan，走 commitPlan 可撤销）；成功返回 true。 */
    applyRoutes: (routes: PlanRoute[], nodes: PlanNode[]) => {
      const current = planRef.current;
      if (routes.length === 0 && nodes.length === 0) return false;
      commitPlan({
        ...current,
        routes: [...current.routes, ...routes.map(route => ({ ...route, ...activeLevelStamp() }))],
        nodes: [...current.nodes, ...nodes.map(node => ({ ...node, ...activeLevelStamp() }))],
      });
      return true;
    },
    /** V-3c：应用区域提案（合并 zones/facilities 进 plan，commitPlan 可撤销）；空提案回 false。 */
    applyZoneProposal: (zones: PlanZone[], facilities: PlanFacility[], routes: PlanRoute[] = [], nodes: PlanNode[] = []) => {
      const current = planRef.current;
      if (zones.length === 0 && facilities.length === 0) return false;
      commitPlan({
        ...current,
        zones: [...current.zones, ...zones.map(zone => ({ ...zone, ...activeLevelStamp() }))],
        facilities: [...current.facilities, ...facilities.map(facility => ({ ...facility, ...activeLevelStamp() }))],
        routes: [...current.routes, ...routes.map(route => ({ ...route, ...activeLevelStamp() }))],
        nodes: [...current.nodes, ...nodes.map(node => ({ ...node, ...activeLevelStamp() }))],
      });
      return true;
    },
    /** M5：合并人员布点进 plan（commitPlan 可撤销）；逐条 buildWorker 校验，全非法/空回 false。 */
    applyWorkers: (workers: PlanWorker[]) => {
      const current = planRef.current;
      if (workers.length === 0) return false;
      const valid: PlanWorker[] = [];
      for (const worker of workers) {
        const result = buildWorker(
          {
            role: worker.role, count: worker.count, position: worker.position, notes: worker.notes, id: worker.id,
            ...(worker.zoneId !== undefined ? { zoneId: worker.zoneId } : {}),
            ...(worker.color !== undefined ? { color: worker.color } : {}),
            ...(worker.assetId !== undefined ? { assetId: worker.assetId } : {}),
          },
          current.boundary,
          current.zones,
        );
        if (result.ok) valid.push(result.value);
      }
      if (valid.length === 0) return false;
      commitPlan({ ...current, workers: [...current.workers, ...valid.map(worker => ({ ...worker, ...activeLevelStamp() }))] });
      return true;
    },
    /** M5：合并测量进 plan；逐条 buildMeasurement 几何校验，全非法/空回 false。 */
    applyMeasurements: (measurements: PlanMeasurement[]) => {
      const current = planRef.current;
      if (measurements.length === 0) return false;
      const valid: PlanMeasurement[] = [];
      for (const measurement of measurements) {
        const result = buildMeasurement({
          kind: measurement.kind, name: measurement.name, points: measurement.points, id: measurement.id,
          ...(measurement.notes ? { notes: measurement.notes } : {}),
        });
        if (result.ok) valid.push(result.value);
      }
      if (valid.length === 0) return false;
      commitPlan({ ...current, measurements: [...(current.measurements ?? []), ...valid.map(measurement => ({ ...measurement, ...activeLevelStamp() }))] });
      return true;
    },
    /** M5：合并标注进 plan；逐条 buildAnnotation 几何校验，全非法/空回 false。 */
    applyAnnotations: (annotations: PlanAnnotation[]) => {
      const current = planRef.current;
      if (annotations.length === 0) return false;
      const valid: PlanAnnotation[] = [];
      for (const annotation of annotations) {
        const result = buildAnnotation({
          kind: annotation.kind, name: annotation.name, points: annotation.points,
          text: annotation.text, notes: annotation.notes, id: annotation.id,
          ...(annotation.radiusM !== undefined ? { radiusM: annotation.radiusM } : {}),
          ...(annotation.color !== undefined ? { color: annotation.color } : {}),
          ...(annotation.strokeWidth !== undefined ? { strokeWidth: annotation.strokeWidth } : {}),
        });
        if (result.ok) valid.push(result.value);
      }
      if (valid.length === 0) return false;
      commitPlan({ ...current, annotations: [...(current.annotations ?? []), ...valid.map(annotation => ({ ...annotation, ...activeLevelStamp() }))] });
      return true;
    },
    /** M5：读当前楼层列表。 */
    getLevels: () => planLevels(planRef.current),
    /** M5：切到指定楼层；不存在回 false。 */
    setActiveLevel: (levelId: string) => {
      if (!planLevels(planRef.current).some(level => level.id === levelId)) return false;
      switchLevel(levelId);
      return true;
    },
    /** M5：单条设施新增；id 已存在回 false。校验在提案侧 buildFacility 完成。 */
    addFacility: (facility: PlanFacility) => {
      const current = planRef.current;
      if (current.facilities.some(f => f.id === facility.id)) return false;
      commitPlan({ ...current, facilities: [...current.facilities, { ...facility, ...activeLevelStamp() }] });
      return true;
    },
    /** M5：单条设施删除；不存在回 false。 */
    removeFacility: (id: string) => {
      if (!planRef.current.facilities.some(f => f.id === id)) return false;
      deleteFacility(id);
      return true;
    },
    /** M5：单条设施属性改；不存在回 false。 */
    updateFacility: (id: string, patch) => {
      if (!planRef.current.facilities.some(f => f.id === id)) return false;
      updateFacility(id, patch);
      return true;
    },
    getView: () => currentViewport(),
    getMode: () => modeRef.current,
    setMode: (next: string) => setMode(next as PlanningEditMode),
    setMeasureKind: (kind: PlanMeasureToolKind) => applyMeasureKind(kind),
    getMeasureKind: () => measureKindRef.current,
    setSnapOn: (on: boolean) => setSnapOn(on),
    setInspector: (open: boolean, tab?: 'measure' | 'annotate' | 'selection') => {
      // 2026-11-17 用户：测量/标注不能同时用，就不该同时开；属性卡只读，保持独立。
      if (!tab) {
        setInspectorPanels(open ? { measure: true, annotate: false, selection: true } : { measure: false, annotate: false, selection: false });
        setSelectionPanelEnabled(open);
        return;
      }
      // 属性卡是总开关：关闭后点选物件不再弹属性卡。
      if (tab === 'selection') { setSelectionPanelEnabled(open); return; }
      // 打开一张工具卡时，先退出另一张卡对应的绘制模式，避免卡和画布工具各说各话。
      if (open && tab === 'measure' && (modeRef.current === 'note' || modeRef.current === 'shape')) setMode('view');
      if (open && tab === 'annotate') {
        // 键盘 T/R/O/Y/L 会直接开卡；底条可能还收着，先展开底条让浮卡有锚点，再落卡。
        window.dispatchEvent(new CustomEvent('scendance:open-outdoor-dock'));
        if (modeRef.current === 'measure') setMode('view');
        // 重新开卡时清掉上次退出留下的轻提示，避免一开卡就显示旧消息。
        setAnnotateNotice(null);
      }
      // 关闭标注卡等于收起标注工具；否则画布还在画、工具条却没了。
      if (!open && tab === 'annotate') {
        if (modeRef.current === 'note' || modeRef.current === 'shape') setMode('view');
        setAnnotateNotice(null);
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
          const spec = facilityFootprintSpec(template.templateId);
          next = {
            ...next,
            facilities: [
              ...next.facilities,
              {
                id: DRAFT_ID,
                templateId: template.templateId,
                name: template.name,
                position: { x: ghostPointRef.current.x, y: ghostPointRef.current.y },
                rotationDeg: doorSnapRef.current?.rotationDeg ?? facilityRotationRef.current,
                size: { width: spec.width, depth: spec.depth },
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
      const ghost = pendingFacilityGhost();
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
            // 用地红线草稿与 2D 同一色（2026-11-17 用户：画的时候绿色看不清，改红）。
            : PLANNING_BOUNDARY_LINE_COLOR,
          fill: mode === "zone" && ring.length >= 3,
          route: mode === "route" ? route : [],
          routeColor: routePresetRef.current?.color ?? PLANNING_ROUTE_KIND_COLORS[routeKindRef.current],
          measure: mode === "measure" ? measure : [],
          measureColor: PLANNING_LAYER_COLORS.measure,
          annotate: (mode === "shape" || mode === "note") ? annotate : [],
          annotateColor: PLANNING_LAYER_COLORS.annotate,
          ghostMarker: null,
          // 2026-11-16 3D 接管态落位前的占地幽灵：与 2D 同一份 ring / 越界结果。
          facilityGhost: ghost ? { ring: ghost.ring, invalid: ghost.invalid, preview: ghost.preview } : null,
        },
      };
    },
    getSelectedIds: () => {
      const picked = [selectedZoneRef.current, selectedFacilityRef.current, selectedRouteRef.current, selectedNodeRef.current, selectedWorkerRef.current, selectedAnnotationRef.current, ...multiSelectedFacilityIdsRef.current];
      return [...new Set(picked.filter((id): id is string => !!id))];
    },
    previewFacilityDrop,
    dropFacilityAt: dropFacilityAtPoint,
    clearFacilityDropPreview,
    previewCatalogDrop,
    dropCatalogAt,
    armCatalogFacility,
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
      setEditMessage('双击红线上才能加点（离线太远）。');
      return;
    }
    const snapped = snapPoint(edge.point, viewport);
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
    // 2026-11-17 用户拍板：红线改动只要还在白框里就不动框；顶出去才重置为外扩 20 m。
    const scope = syncScopeForBoundary(current.designScope, result.value, DEFAULT_SCOPE_MARGIN_M);
    commitPlan({ ...current, boundary: result.value, ...(scope ? { designScope: scope } : {}) });
    boundaryInsertedAtRef.current = performance.now();
    setEditMessage(`红线已插入顶点（约 ${Math.round(check.areaM2)} m²）。${scope ? '红线顶出白框，设计范围已随红线外扩 20 m 重置。' : ''}`);
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
    // 删顶点只会缩小红线，白框必然还兜得住——不触发同步。
    commitPlan({ ...current, boundary: result.value });
    clearBoundaryDeleteArm();
    setEditMessage(`红线已删除顶点（约 ${Math.round(check.areaM2)} m²）。`);
  }

  /** 点亮/熄灭「再点一下就删」的琥珀框（只改显示，不改计划）。 */
  function armBoundaryVertexDelete(index: number) {
    boundaryDeleteArmedRef.current = index;
    if (boundaryDeleteArmTimerRef.current !== null) clearTimeout(boundaryDeleteArmTimerRef.current);
    boundaryDeleteArmTimerRef.current = setTimeout(() => {
      boundaryDeleteArmTimerRef.current = null;
      if (boundaryDeleteArmedRef.current === null) return;
      boundaryDeleteArmedRef.current = null;
      draw();
    }, BOUNDARY_DELETE_ARM_MS);
  }

  function clearBoundaryDeleteArm() {
    if (boundaryDeleteArmTimerRef.current !== null) {
      clearTimeout(boundaryDeleteArmTimerRef.current);
      boundaryDeleteArmTimerRef.current = null;
    }
    if (boundaryDeleteArmedRef.current === null) return;
    boundaryDeleteArmedRef.current = null;
    draw();
  }

  function handleDrawClick(px: { x: number; y: number }, pt: PlanPoint) {
    // 2026-11-15 设计范围 = 拖矩形，不吃单击收点（否则又会变回多段线）。
    if (modeRef.current === 'scope') return;
    // H2-c：放设施模式单击提交（可连续放置）。
    if (modeRef.current === 'facility') {
      // 2026-11-16 用户指令：门在室内分区边线 10px 内落位时贴边、朝向垂直墙面。
      const armed = facilityTemplateRef.current;
      const snap = armed && isDoorTemplateId(armed)
        ? snapDoorToIndoorEdge({ pt, zones: planRef.current.zones, viewport: currentViewport() })
        : null;
      if (snap) {
        facilityRotationRef.current = snap.rotationDeg;
        placeFacilityAt(snap.point);
        return;
      }
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
    // 2026-11-17 #118 补录入 UI：布车模式单击落一台车（连续放置）。
    if (modeRef.current === 'vehicle') {
      placeVehicleAt(pt);
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
    // 2026-11-16 用户：「场地加一把锁，默认不编辑」——已画好的边界不允许被「画边界」直接覆掉。
    // 进了画边界模式就已在 setMode 里自动解锁，这里只作为兼底（防止外部直接改模式绕过）。
    if (modeRef.current === 'boundary' && layerLocked('boundary') && planRef.current.boundary.length >= 3) {
      setEditMessage('用地红线已锁定：先在左侧「用地红线」行解锁，再重画红线。');
      return;
    }
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

  const pendingVenueAnchorRef = useRef<SitePlanData['anchor']>(undefined);

  function closeDraft() {
    const draftPoints = draftRef.current;
    const current = planRef.current;
    if (modeRef.current === 'boundary') {
      const nextAnchor = pendingVenueAnchorRef.current;
      if (nextAnchor && !canReanchorOutdoorPlan(current, nextAnchor)) { setEditMessage('规划已有内容变化，本次不改变地理锚点；请新建户外活动后选址。'); setMode('view'); return; }
      const priorAnchor = current.anchor ?? { lng: DEFAULT_ANCHOR_LNG, lat: DEFAULT_ANCHOR_LAT };
      const boundary = nextAnchor ? boundaryAtNewAnchor(draftPoints, priorAnchor, nextAnchor) : draftPoints;
      const check = checkBoundaryRing(boundary);
      if (!check.ok) {
        setEditMessage(check.issue.message);
        return;
      }
      // 2026-11-17 用户指令「画好用地红线，默认就是画好了设计范围，扩 20 m，不用画两次」：
      // 红线闭合一律自动生成设计范围（重画红线 = 旧框已失配，跟着重置）；要自定义再点「重拖设计范围」。
      const initialScope = expandRect(boundary, DEFAULT_SCOPE_MARGIN_M);
      const nextBoundaryPlan: SitePlanData = {
        ...current,
        ...(nextAnchor ? { anchor: nextAnchor } : {}),
        boundary: boundary.map(p => ({ x: p.x, y: p.y })),
        designScope: initialScope,
      };
      commitPlan(nextBoundaryPlan);
      if (nextAnchor) onVenueBoundaryApplied?.(nextAnchor);
      pendingVenueAnchorRef.current = undefined;
      setMode('view');
      focusDesignScope(initialScope);
      const boundaryOverflow = reviewZonesAfterBoundsChange(nextBoundaryPlan, current);
      setEditMessage(`红线已更新（约 ${Math.round(check.areaM2)} m²），设计范围已按场地四边外扩 ${DEFAULT_SCOPE_MARGIN_M} m 自动生成；要自定义就点「重拖设计范围」。${overflowSuffix(boundaryOverflow)}`);
      return;
    }
    // 2026-11-15：圈设计范围——闭合即整圈替换；只校验几何有效性（面积/自交），
    // 不与场地边界比较：设计范围天然比场地大，拿边界口径判它会永远「越界」。
    if (modeRef.current === 'scope') {
      const check = checkBoundaryRing(draftPoints);
      if (!check.ok) {
        setEditMessage(check.issue.message);
        return;
      }
      const nextScopePlan: SitePlanData = { ...current, designScope: draftPoints.map(p => ({ x: p.x, y: p.y })) };
      commitPlan(nextScopePlan);
      setMode('view');
      const scopeOverflow = reviewZonesAfterBoundsChange(nextScopePlan, current);
      setEditMessage(
        `设计范围已更新（约 ${Math.round(check.areaM2)} m²）：框外压暗，流线可以走在场地外这一圈里。${overflowSuffix(scopeOverflow)}`,
      );
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

  function updateZone(id: string, patch: Partial<Pick<PlanZone, 'name' | 'color' | 'opacity' | 'event'>>) {
    const current = planRef.current;
    commitPlan({ ...current, zones: current.zones.map(zone => (zone.id === id ? { ...zone, ...patch } : zone)) });
  }

  /* ---------------- H2-c 设施放置与选中 ---------------- */

  function selectFacility(id: string | null) {
    selectedFacilityRef.current = id;
    setSelectedFacilityId(id);
    // 2026-11-14：单选互斥——选中即清其它实体（流线/分区/节点/人员）与跨类型多选。
    if (id) {
      selectZone(null);
      selectRoute(null);
      selectNode(null);
      selectWorker(null);
      selectVehicle(null);
      selectMeasurement(null);
      clearMultiSelection(false);
    }
    draw();
  }

  /** 2026-11-16 用户：「点 esc 就退出物体编辑模式」——取消全部单选实体，属性卡与 3D 手柄一起收回。 */
  function clearEntitySelection() {
    selectFacility(null);
    selectZone(null);
    selectRoute(null);
    selectNode(null);
    selectWorker(null);
    selectAnnotation(null);
    selectMeasurement(null);
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
      setContextMenu(null);
      return;
    }
    commitPlan({ ...current, facilities: next });
    const label = action === 'up' ? '上移一层' : action === 'top' ? '置于顶层' : action === 'down' ? '下移一层' : '置于底层';
    const at = next.findIndex(item => item.id === id) + 1;
    setEditMessage(`「${moved.name}」${label}（第 ${at} / ${next.length} 层）。`);
    setSelectedFacilityId(id);
    selectedFacilityRef.current = id;
    setContextMenu(null);
    draw();
  }

  /* ---------------- P2-j 分区选中与顶点改形 ---------------- */

  function selectZone(id: string | null) {
    selectedZoneRef.current = id;
    setSelectedZoneId(id);
    if (id) {
      selectedFacilityRef.current = null;
      setSelectedFacilityId(null);
      selectRoute(null);
      selectNode(null);
      selectWorker(null);
      selectMeasurement(null);
      clearMultiSelection(false);
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

  /** 2026-11-14：流线顶点手柄命中（与分区顶点同一套命中半径）。 */
  function nearestRouteVertexIndex(route: { points: PlanPoint[] }, px: { x: number; y: number }): number | null {
    const viewport = currentViewport();
    let hitIndex: number | null = null;
    let hitDist = VERTEX_HANDLE_HIT_PX;
    for (let index = 0; index < route.points.length; index += 1) {
      const p = planPointToPixel(route.points[index]!, viewport);
      const distPx = Math.hypot(px.x - p.x, px.y - p.y);
      if (distPx <= hitDist) {
        hitIndex = index;
        hitDist = distPx;
      }
    }
    return hitIndex;
  }

  /**
   * 2026-11-15 用户：「从场地外的线到场地边界的时候，交界处会自动变成出入口」。
   * 动线新增/改形提交前调一次：把交界处重新对齐到当前交点上。
   * 2026-11-15 用户补充：「单向的流线，进去的就是入口，出来的就是出口；双向的就是出入口」——
   * 新建/复用的节点类型都按这条线当前的方向判（手动改过类型的不会被动）。
   * 返回要提交的整案 + 新增/挪动/改型/删除的节点（用于提示文案）。
   */
  function planWithCrossingNodes(
    plan: SitePlanData,
    route: PlanRoute,
  ): { plan: SitePlanData; added: PlanNode[]; moved: PlanNode[]; retyped: PlanNode[]; removed: PlanNode[] } {
    const result = reconcileCrossingNodes(route, {
      boundary: plan.boundary,
      nodes: plan.nodes,
      routes: plan.routes,
    });
    const changed = result.added.length > 0 || result.moved.length > 0 || result.retyped.length > 0 || result.removed.length > 0;
    return {
      plan: changed ? { ...plan, nodes: result.nodes } : plan,
      added: result.added,
      moved: result.moved,
      retyped: result.retyped,
      removed: result.removed,
    };
  }

  /**
   * 2026-11-15 用户指令「路线和分区一样的，需要在线段上可以加点、减点、挪动合并点」：
   * 选中动线的按下接管——折点手柄 > 边中段插点 > 不接管（留给点选/平移）。
   * 与分区同一顺序、同一命中半径（顶点 8 px / 边 9 px），两边手感一致。
   */
  function beginRouteVertexEdit(
    route: PlanRoute,
    hit: { px: { x: number; y: number }; pt: PlanPoint },
  ): boolean {
    const index = nearestRouteVertexIndex(route, hit.px);
    if (index !== null) {
      dragRouteVertexRef.current = { routeId: route.id, index, base: route.points, merged: null };
      routeDragPreviewRef.current = { routeId: route.id, points: route.points };
      downPxRef.current = hit.px;
      pointerConsumedRef.current = true;
      setDragging(true);
      return true;
    }
    const edge = nearestPolylineEdge(route.points, hit.px, currentViewport());
    if (!edge || edge.distPx > 9) return false;
    const inserted = insertRouteVertex(route, edge.index, snapPointToGrid(edge.point, currentViewport()));
    if (!inserted.ok) {
      setEditMessage(inserted.issue.message);
      return false;
    }
    const insertBase: SitePlanData = {
      ...planRef.current,
      routes: planRef.current.routes.map(item => (item.id === route.id ? inserted.value : item)),
    };
    // 2026-11-15：加点把线拉到边界外又拉回来时，交界处同样自动生成出入口。
    const withCrossings = planWithCrossingNodes(insertBase, inserted.value);
    commitPlan(withCrossings.plan);
    routeEdgeHintRef.current = null;
    justInsertedRouteVertexRef.current = true;
    dragRouteVertexRef.current = { routeId: route.id, index: edge.index + 1, base: inserted.value.points, merged: null };
    routeDragPreviewRef.current = { routeId: route.id, points: inserted.value.points };
    downPxRef.current = hit.px;
    pointerConsumedRef.current = true;
    setDragging(true);
    setEditMessage('已在线上插入折点，继续拖动调整；松手生效（点中线上的折点即可删掉它）。');
    draw();
    return true;
  }

  /** 分区多边形改完要守住三条：形状合法、仍在场地边界内、不与别的分区重叠。 */
  function zonePolygonIssue(zone: PlanZone, polygon: PlanPoint[], current: SitePlanData): PlanEditIssue | null {
    // 2026-11-15 用户指令：重叠不再挡住提交（重叠只上常驻提示，挪开即消失）；
    // 自交/退化/越界仍然硬拦，因为那些是「立刻就不成立」的形状。
    return zoneEditBlockingIssue(polygon, current.boundary, `分区「${zone.name}」`);
  }

  /** 在面板点选模板（也可直接拖拽到画布）：记录待放模板，幽灵随鼠标。 */
  function pickFacilityTemplate(templateId: string) {
    armedCatalogRef.current = null;
    facilityTemplateRef.current = templateId;
    // 换模板就回到 0°；同一模板连续放时保留上一次的角度（方便成排摆）。
    if (facilityRotationRef.current !== 0) facilityRotationRef.current = 0;
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
    notifyPlanDraftChanged();
  }

  /**
   * P2-h：物件库里点选一件物件。库条目的 templateId 形如 `oneplan:icon:tent`，
   * 不在 8 个内置模板里，所以把「模板对象」本身记下来，放置与幽灵预览都读它。
   */
  function pickLibraryEntry(entry: LibraryEntry) {
    armedCatalogRef.current = null;
    const template = libraryFacilityTemplate(entry);
    // 2026-11-12 再点同一件已选设施 = 取消选择回浏览（允许「一件都不选」）。
    if (modeRef.current === 'facility' && facilityTemplateRef.current === template.templateId) {
      setMode('view');
      return;
    }
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
    armedCatalogRef.current = null;
    // 2026-11-12 再点当前已激活的同一件包物件 = 取消选择回浏览（与目录贴纸同一口径）。
    const packTemplateId = entry.packItemId ? `pack:${entry.packId}:${entry.packItemId}` : '';
    const alreadyActive = entry.placeKind === 'route'
      ? modeRef.current === 'route' && routePresetRef.current?.name === entry.nameZh
      : entry.placeKind === 'area'
        ? modeRef.current === 'zone' && zonePresetRef.current?.name === entry.nameZh
        : entry.placeKind === 'worker'
          ? modeRef.current === 'worker' && workerRoleRef.current === entry.nameZh
          : modeRef.current === 'facility' && facilityTemplateRef.current === packTemplateId;
    if (alreadyActive) {
      setMode('view');
      return;
    }
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
   * 目录条目点选统一口径：已处于该工具（active）时再点一次取消选择、回浏览；
   * 未激活才进入对应放置工具。允许最终「一件栏目都不选」。
   */
  function armOrDisarm(active: boolean, arm: () => void) {
    if (active) setMode('view');
    else arm();
  }

  /**
   * P2-k 第一段工具：区域（圈分区）/ 入口和通道图标（上面列出图标，点了按设施放）/
   * 路线（画动线）。都是已有编辑模式的入口，这里只是把按钮接到 setMode。
   */
  function startAreaTool(tool: 'boundary' | 'scope' | 'zone' | 'node' | 'route') {
    if (!onPlanChange) return;
    // setMode 会把锁着的场地自动解锁；先记一下旧状态，好在提示里说清楚。
    const boundaryWasLocked = lockedLayersRef.current.boundary === true;
    selectFacility(null);
    setSelectedZoneId(null);
    setMode(tool);
    if (tool === 'boundary') {
      // 2026-11-11：边界重画入口回归（OnePlan 化时曾随顶部工具条丢失）——画完闭合即替换起步矩形。
      setEditMessage(boundaryWasLocked
        ? '重画用地红线：用地原为锁定，已自动解锁；沿用地单击加顶点，双击或点回起点闭合替换旧红线，Esc 取消。'
        : '重画用地红线：沿用地单击加顶点，双击或点回起点闭合替换旧红线；Esc 取消。');
    } else if (tool === 'scope') {
      setEditMessage('拖出设计范围：按住鼠标拖一个矩形（可以比场地大一圈），松手即生效；Esc 取消。');
    } else if (tool === 'zone') {
      setEditMessage('画区域：在场地内单击加顶点，双击或靠近首点闭合；Esc 结束。');
    } else if (tool === 'node') {
      setEditMessage('放入口/出口/出入口：单击地图落一个节点，可连续放；Esc 结束。');
    } else {
      setEditMessage('画路线：单击加路径点，双击完成；Esc 结束。');
    }
  }

  /** P2-k 第三段：劳动力按钮 → 直接进「布人员」模式，岗位名就是按钮名。 */
  function startLaborRole(role: string) {
    if (!onPlanChange) return;
    // 2026-11-12 再点当前岗位 = 取消选择回浏览（允许一件都不选）。
    if (modeRef.current === 'worker' && workerRoleRef.current === role) {
      setMode('view');
      return;
    }
    workerRoleRef.current = role;
    setWorkerRole(role);
    setMode('worker');
    setEditMessage(`布「${role}」：单击地图落一个点位，可连续放；Esc 结束。`);
  }

  /**
   * 2026-11-17 #118 补录入 UI：车辆按钮 → 直接进「布车」模式，点地图落一台车。
   *
   * 与岗位同款（不进表单，车型名就是按钮名），台数默认 1、落位后可在属性卡改。
   * 车型取自 `VEHICLE_TYPES` 登记表（与契约 planVehicleTypes 一一对应）。
   */
  function startVehicleType(type: PlanVehicle['type']) {
    if (!onPlanChange) return;
    // 再点当前车型 = 取消选择回浏览（允许一辆都不放）。
    if (modeRef.current === 'vehicle' && vehicleTypeRef.current === type) {
      setMode('view');
      return;
    }
    vehicleTypeRef.current = type;
    vehicleCountRef.current = 1;
    setVehicleType(type);
    setMode('vehicle');
    const entry = VEHICLE_TYPES.find(item => item.id === type);
    setEditMessage(`布「${entry?.name ?? type}」：单击地图落一台车，可连续放；Esc 结束。`);
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
    onDragStart?: ((event: React.DragEvent<HTMLDivElement>) => void) | undefined;
    onDragEnd?: (() => void) | undefined;
    /** 2026-11-11 用户指令：右键删除已放置物件。 */
    onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
  }) {
    // 2026-11-13 修复嵌套按钮：行根用 div + role=button，避免 trailing 删除钮再嵌一层 <button> 触发 HTML 嵌套非法 / hydration 报错。
    return (
      <div
        key={input.key}
        role="button"
        tabIndex={0}
        data-testid={input.testId}
        aria-pressed={input.active}
        title={input.title}
        onClick={input.onClick}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            input.onClick();
          }
        }}
        draggable={input.draggable}
        onDragStart={input.onDragStart}
        onDragEnd={input.onDragEnd}
        onContextMenu={input.onContextMenu}
        style={{
          all: 'unset',
          cursor: 'pointer',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: PLANNING_SPACING.xs,
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
      </div>
    );
  }

  /** OnePlan 镜像：一级组头（chevron + 组图标 + 名称 + 计数）。多段可同时展开（用户 m00575）。 */
  function renderOneplanGroupHeader(input: {
    id: 'areas' | 'vehicles' | 'infra' | 'labor' | 'extra';
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
          gap: PLANNING_SPACING.xs,
          padding: '7px 2px',
          color: PLANNING_SURFACE.panelText,
          fontSize: PLANNING_TYPOGRAPHY.panel,
          fontWeight: 600,
          borderTop: `1px solid ${PLANNING_SURFACE.panelBorder}`,
        }}
      >
        <span aria-hidden style={{ fontSize: PLANNING_TYPOGRAPHY.hint, width: 10 }}>{open ? '▾' : '▸'}</span>
        <Icon size={PLANNING_ICON_SIZES.legend} aria-hidden color={PLANNING_SURFACE.panelText} />
        <span style={{ flex: 1 }}>{input.label}</span>
        <span style={{ opacity: 0.65, fontWeight: 400, fontSize: PLANNING_TYPOGRAPHY.row }}>{input.count}</span>
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
          gap: PLANNING_SPACING.xs,
          padding: '6px 2px',
          paddingLeft: 18,
          color: PLANNING_SURFACE.panelText,
          fontSize: PLANNING_TYPOGRAPHY.row,
          fontWeight: 600,
        }}
      >
        <span aria-hidden style={{ fontSize: PLANNING_TYPOGRAPHY.hint, width: 10 }}>{open ? '▾' : '▸'}</span>
        {Icon && <Icon size={PLANNING_ICON_SIZES.legend} aria-hidden color={PLANNING_SURFACE.panelText} />}
        <span style={{ flex: 1 }}>{input.label}</span>
        <span style={{ opacity: 0.65, fontWeight: 400, fontSize: PLANNING_TYPOGRAPHY.row }}>{input.count}</span>
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

  /** 包物件是否处于已激活状态（与 pickPackEntry 的反查口径一致；再点即取消选择）。 */
  function packEntryActive(entry: LibraryEntry, templateId: string): boolean {
    if (entry.placeKind === 'route') return mode === 'route' && routePresetRef.current?.name === entry.nameZh;
    if (entry.placeKind === 'area') return mode === 'zone' && zonePresetRef.current?.name === entry.nameZh;
    if (entry.placeKind === 'worker') return mode === 'worker' && workerRole === entry.nameZh;
    return mode === 'facility' && facilityTemplateId === templateId;
  }

  /** 包物件的放置入口/拖拽/title（树段、包浏览、搜索三处共用）。 */
  function renderPackItemRows(items: readonly LibraryEntry[]) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map(entry => {
          if (!entry.packId || !entry.packItemId) return null;
          const templateId = `pack:${entry.packId}:${entry.packItemId}`;
          const isFacility = entry.placeKind === 'facility';
          const packActive = packEntryActive(entry, templateId);
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
            active: packActive,
            onClick: () => armOrDisarm(packActive, () => pickPackEntry(entry)),
            title: placeLabel
              ? `${entry.nameZh}：点击进入画${placeLabel === '点位' ? '人员点位' : placeLabel}（主题色已带）`
              : `${entry.nameZh} / ${entry.nameEn}（默认 ${entry.width}×${entry.depth} m）`,
            draggable: isFacility,
            onDragStart: isFacility
              ? (event: React.DragEvent<HTMLDivElement>) => {
                // 与内置模板同一条拖放通道：画布 onDrop 读 text/plain 后落模板（含主题色）。
                setPlanFacilityDrag(templateId);
                event.dataTransfer.setData('text/plain', templateId);
                event.dataTransfer.effectAllowed = 'copy';
              }
              : undefined,
            onDragEnd: isFacility ? clearPlanFacilityDrag : undefined,
            icon: packChipNode(entry),
            trailing: placeLabel
              ? <span aria-hidden style={{ fontSize: PLANNING_TYPOGRAPHY.hint, opacity: 0.6, flex: '0 0 auto' }}>{placeLabel}</span>
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
          {hiddenCount > 0 && <span style={{ fontSize: PLANNING_TYPOGRAPHY.hint, fontWeight: 600, opacity: 0.75 }}>+{hiddenCount}</span>}
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
          <span style={{ fontSize: PLANNING_TYPOGRAPHY.row, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
            {pack.nameZh}
          </span>
          <span style={{ fontSize: PLANNING_TYPOGRAPHY.hint, opacity: 0.65 }}>
            {pack.items.length} 件物件
          </span>
        </span>
        <span aria-hidden style={{ fontSize: PLANNING_TYPOGRAPHY.hint, width: 10, flex: '0 0 auto' }}>{open ? '▾' : '▸'}</span>
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
            const packActive = packEntryActive(entry, packTemplateIdStr);
            return renderOneplanItemRow({
              key: entry.id,
              testId: `pack-item-${entry.packId}-${entry.packItemId}`,
              label: entry.nameZh,
              active: packActive,
              onClick: () => armOrDisarm(packActive, () => pickPackEntry(entry)),
              title: `${entry.nameZh} / ${entry.nameEn}`,
              draggable: entry.placeKind === 'facility',
              onDragStart: entry.placeKind === 'facility'
                ? (event: React.DragEvent<HTMLDivElement>) => {
                  setPlanFacilityDrag(packTemplateIdStr);
                  event.dataTransfer.setData('text/plain', packTemplateIdStr);
                  event.dataTransfer.effectAllowed = 'copy';
                }
                : undefined,
              onDragEnd: entry.placeKind === 'facility' ? clearPlanFacilityDrag : undefined,
              icon: packChipNode(entry),
            });
          }
          const template = libraryFacilityTemplate(entry);
          const active = mode === 'facility' && facilityTemplateId === template.templateId;
          return renderOneplanItemRow({
            key: entry.id,
            testId: `library-item-${entry.kind}-${entry.slug}`,
            label: entry.nameZh,
            active,
            onClick: () => armOrDisarm(active, () => pickLibraryEntry(entry)),
            title: `${entry.nameZh} / ${entry.nameEn}（默认 ${entry.width}×${entry.depth} m）`,
            draggable: true,
            onDragStart: event => {
              // 与内置模板同一条拖放通道：画布 onDrop 读 text/plain 后落模板。
              setPlanFacilityDrag(template.templateId);
              event.dataTransfer.setData('text/plain', template.templateId);
              event.dataTransfer.effectAllowed = 'copy';
            },
            onDragEnd: clearPlanFacilityDrag,
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
                  borderRadius: entry.kind === 'icon' || entry.chipStyle === 'icon' ? 999 : 6,
                  // 2026-11-12 主题色：icon 类彩色圆底 + 白字形（OnePlan marketplace 同款）；
                  // scale/area 浅底 + 主题色线稿（mask 染色），无色回落原样。
                  // 2026-11-16：`chipStyle: 'icon'`（车组）强制走彩底 + 白字形，icon / scale 混排也同一套视觉。
                  background: entry.kind === 'icon' || entry.chipStyle === 'icon' ? libraryEntryColor(entry) : '#eef1f4',
                }}
              >
                {entry.kind !== 'icon' ? (
                  <span
                    aria-hidden
                    style={{
                      display: 'block',
                      width: 16,
                      height: 16,
                      backgroundColor: entry.chipStyle === 'icon' ? '#ffffff' : libraryEntryColor(entry),
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

  /**
   * 2026-11-16 设施放置幽灵的唯一来源：2D 画布与 3D draft 共用同一份 ring / 角度 / 越界判定。
   * 之前幽灵只画在 2D 画布上，3D 接管时画布被隐藏，等于盲放。
   * 尺寸取模板真实宽深（与 buildFacility 一致），不再用 footprintSpec 的占位尺寸。
   */
  function pendingFacilityGhost(): {
    template: PlanFacilityTemplate;
    position: PlanPoint;
    rotationDeg: number;
    ring: PlanPoint[];
    invalid: boolean;
    preview: {
      slug: string;
      templateId: string;
      name: string;
      position: PlanPoint;
      rotationDeg: number;
      width: number;
      depth: number;
    } | null;
  } | null {
    if (modeRef.current !== 'facility') return null;
    const position = ghostPointRef.current;
    if (!position || !facilityTemplateRef.current) return null;
    const template = resolvePendingTemplate();
    if (!template) return null;
    const rotationDeg = facilityRotationRef.current;
    const { ring, invalid } = facilityPlacementGhost(template, position, rotationDeg, planRef.current.boundary);
    // 2026-11-16 物料卡：3D 预览按这张卡的 slug 加载；普通设施没有 catalog 载荷，不额外挂模型。
    const catalog = facilityCatalogRef.current ?? armedCatalogRef.current;
    const preview = catalog && catalog.slug && catalog.templateId === template.templateId
      ? {
          slug: catalog.slug,
          templateId: catalog.templateId,
          name: catalog.name,
          position,
          rotationDeg,
          width: template.width,
          depth: template.depth,
        }
      : null;
    return { template, position, rotationDeg, ring, invalid, preview };
  }

  /** 2026-11-16 拖放预览：2D onDragOver 与 3D 地面 dragover 共用，拖起即出幽灵。 */
  function previewFacilityDrop(templateId: string, point: PlanPoint): boolean {
    if (!templateId) return false;
    if (modeRef.current !== 'facility') setMode('facility');
    if (facilityTemplateRef.current !== templateId) pickFacilityTemplate(templateId);
    ghostPointRef.current = point;
    draw();
    notifyPlanDraftChanged();
    return true;
  }

  /** 2026-11-16 拖放落位：与单击放置共用 placeFacilityAt，角度/尺寸/校验不另走一套。 */
  function dropFacilityAtPoint(templateId: string, point: PlanPoint): boolean {
    if (!templateId) return false;
    if (modeRef.current !== 'facility') setMode('facility');
    if (facilityTemplateRef.current !== templateId) pickFacilityTemplate(templateId);
    ghostPointRef.current = point;
    facilityDropAtRef.current = Date.now();
    placeFacilityAt(point);
    return true;
  }

  /** 2026-11-16 拖出画布：只清幽灵，不清工具（用户可能接着点放）。 */
  function clearFacilityDropPreview(): void {
    if (modeRef.current !== 'facility') return;
    if (Date.now() - facilityDropAtRef.current < 250) return;
    if (!ghostPointRef.current) return;
    ghostPointRef.current = null;
    draw();
    notifyPlanDraftChanged();
  }

  /** 2026-11-16 物料卡拖放：动态模板（真实宽深）+ 记录 slug，落位写 modelOverride。 */
  function catalogFacilityTemplate(payload: PlanCatalogDrag): PlanFacilityTemplate {
    return { templateId: payload.templateId, name: payload.name, width: payload.width, depth: payload.depth, note: '物料库模型' };
  }

  function armCatalogFacility(payload: PlanCatalogDrag): boolean {
    if (!payload.slug || !(payload.width > 0) || !(payload.depth > 0)) return false;
    // setMode 会清待放模板，必须先切模式再写模板。
    setMode('facility');
    facilityTemplateRef.current = payload.templateId;
    facilityTemplateObjRef.current = catalogFacilityTemplate(payload);
    facilityCatalogRef.current = payload;
    armedCatalogRef.current = payload;
    setFacilityTemplateId(payload.templateId);
    setEditMessage(`已选「${payload.name}」（${payload.width}×${payload.depth} m），在地图/地面上单击放置；Esc 结束。`);
    draw();
    notifyPlanDraftChanged();
    return true;
  }

  function previewCatalogDrop(payload: PlanCatalogDrag, point: PlanPoint): boolean {
    if (!payload.slug || !(payload.width > 0) || !(payload.depth > 0)) return false;
    if (modeRef.current !== 'facility' || facilityCatalogRef.current?.slug !== payload.slug) {
      if (modeRef.current !== 'facility') setMode('facility');
      facilityTemplateRef.current = payload.templateId;
      facilityTemplateObjRef.current = catalogFacilityTemplate(payload);
      facilityCatalogRef.current = payload;
      setFacilityTemplateId(payload.templateId);
    }
    armedCatalogRef.current = payload;
    ghostPointRef.current = point;
    draw();
    notifyPlanDraftChanged();
    return true;
  }

  function dropCatalogAt(payload: PlanCatalogDrag, point: PlanPoint): boolean {
    if (!previewCatalogDrop(payload, point)) return false;
    facilityDropAtRef.current = Date.now();
    placeFacilityAt(point, payload.slug);
    return true;
  }

  function placeFacilityAt(pt: PlanPoint, explicitModelSlug?: string) {
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
    const catalog = facilityCatalogRef.current ?? armedCatalogRef.current;
    const modelOverride = explicitModelSlug ?? (catalog && catalog.templateId === templateId ? catalog.slug : undefined);
    // 物料卡落在已有设施上：把它当作「换这个物件的模型」，不叠第二件。
    // 用户从库里拖卡到 3D 已有物件上时，期望看到的就是这一件跟着变；旧数据缺 modelOverride 也在这里补上。
    if (modelOverride) {
      const target = [...current.facilities].reverse().find(f => facilityContainsPoint(pt, f));
      if (target) {
        commitPlan({
          ...current,
          facilities: current.facilities.map(f => f.id === target.id
            ? {
              ...f,
              templateId,
              modelOverride,
              size: { width: template.width, depth: template.depth },
              ...activeLevelStamp(),
            }
            : f),
        });
        selectFacility(target.id);
        setEditMessage(`已把「${target.name}」换成「${template.name}」，2D/3D 同一件跟着换模型。`);
        ghostPointRef.current = null;
        draw();
        notifyPlanDraftChanged();
        return;
      }
    }
    // 2026-11-16 用户「物料要有归属意识」：落点落在哪个分区，这件物料就归那个区（与人员/出入口同口径）。
    const zoneId = inferZoneIdAt(pt, current.zones);
    const result = buildFacility(
      { templateId, template, position: pt, rotationDeg: facilityRotationRef.current, ...(zoneId ? { zoneId } : {}) },
      current.boundary,
      view.facilities,
    );
    if (!result.ok) {
      setEditMessage(result.issue.message);
      return;
    }
    commitPlan({ ...current, facilities: [...current.facilities, { ...result.value, ...(modelOverride ? { modelOverride } : {}), ...activeLevelStamp() }] });
    selectFacility(result.value.id);
    const hint = result.issues && result.issues.length > 0 ? `，注意：${result.issues.map(i => i.message).join('；')}` : '';
    const angle = facilityRotationRef.current;
    setEditMessage(`已放置「${result.value.name}」${angle ? `（${Math.round(angle)}°）` : ''}，继续单击放置或 Esc 结束${hint}`);
    // 2026-11-16 落位后清掉跟随幽灵：否则 3D 预览模型会和刚落地的真模型叠在同一位置。
    ghostPointRef.current = null;
    draw();
    notifyPlanDraftChanged();
  }

  /**
   * P2-i：设施改名/备注之外，接旋转（度）与尺寸（宽×深，米）——面板输入与画布手柄共用，
   * 尺寸按 FACILITY_MIN/MAX 夹紧，旋转归一化到 [0,360)；全部走 commitPlan（可撤销）。
   */
  function updateFacility(
    id: string,
    patch: Partial<Pick<PlanFacility,
      'name' | 'notes' | 'rotationDeg' | 'color' | 'opacity' | 'strokeStyle' | 'modelOverride' | 'zoneId'
      | 'vendorName' | 'vendorZone' | 'inDate' | 'inTime' | 'outDate' | 'outTime' | 'electricKw'
    >> & { size?: { width: number; depth: number } },
  ) {
    // 空名会让 plan 过不了契约校验：改名时忽略空值。
    if (patch.name !== undefined && patch.name.trim().length === 0) return;
    const current = planRef.current;
    const facilities = current.facilities.map(f => {
      if (f.id !== id) return f;
      // #51 方案甲收口：任何来源（手柄/面板/程序化写入）的尺寸都吸附到权威宽高比，
      // 已等比的输入幂等不变，自由比例按长边为锚纠偏，夹取在统一界内。
      // 2026-11-15 用户口径：换模型时 2D 占地改成新模型的真实尺寸（模型只提供「默认多大」），
      // 之后用户在 2D 缩放任等比跟随——换算统一在这里做，不让调用方各自记。
      const modelOverride = Object.hasOwn(patch, 'modelOverride') ? patch.modelOverride : f.modelOverride;
      const modelChanged = modelOverride !== f.modelOverride;
      const requestedSize = patch.size
        ?? (modelChanged ? facilitySizeFromModel(facilityFootprintSpec(f.templateId, modelOverride)) : undefined);
      const size = requestedSize
        ? normalizeFacilitySize(requestedSize, f.templateId, { minM: FACILITY_MIN_SIZE_M, maxM: FACILITY_MAX_SIZE_M }, modelOverride)
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

  /**
   * 2026-11-15 用户：位置要能直接改。属性卡里展示的是经纬度（与坐标行同口径），
   * 这里把经纬度逆映射回 ENU 米再落盘，仍走 commitPlan（可撤销）。
   */
  function moveFacilityTo(id: string, position: PlanPoint) {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    const current = planRef.current;
    if (!current.facilities.some(f => f.id === id)) return;
    // 2026-11-16 用户「物料要有归属意识」：位置变了归属重算——搬进哪个分区就归哪个区，
    // 搬出所有分区就是未归属（与人员/出入口的「按落点归属」同一口径）。
    commitPlan({
      ...current,
      facilities: current.facilities.map(f =>
        f.id === id
          ? { ...f, position: { x: position.x, y: position.y }, zoneId: inferZoneIdAt(position, current.zones) }
          : f,
      ),
    });
  }

  /** 提交纬度/经度草稿（失焦或回车）：无效值直接丢弃，不回退上一次合法位置。 */
  function commitFacilityGeoDraft() {
    const draft = facilityGeoDraft;
    setFacilityGeoDraft(null);
    if (!draft || !selectedFacility) return;
    const lat = Number(draft.lat);
    const lng = Number(draft.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return;
    const anchorLng = plan.anchor?.lng ?? DEFAULT_ANCHOR_LNG;
    const anchorLat = plan.anchor?.lat ?? DEFAULT_ANCHOR_LAT;
    moveFacilityTo(selectedFacility.id, lngLatToEnu(lng, lat, anchorLng, anchorLat));
  }

  /** 提交宽/深草稿（失焦或回车）：仍走等比缩放，保证 2D 框不会变形。 */
  function commitFacilitySizeDraft() {
    const draft = facilitySizeDraft;
    setFacilitySizeDraft(null);
    if (!draft || !selectedFacility) return;
    const width = Number(draft.width);
    const depth = Number(draft.depth);
    if (!Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0) return;
    // 以长边为锚一次性回写两轴，避免「先改宽、再改深」两次提交、两次撤销。
    const major = Math.max(width, depth);
    updateFacility(selectedFacility.id, {
      size: sizeWithMajor(selectedFacility.size, major, selectedFacility.templateId,
        { minM: FACILITY_MIN_SIZE_M, maxM: FACILITY_MAX_SIZE_M }),
    });
  }

  /** P2-i：方向键微调选中设施（1 m，Shift=10 m），共用一条 undo 记录。 */
  function nudgeFacility(id: string, dx: number, dy: number) {
    const current = planRef.current;
    if (!current.facilities.some(f => f.id === id)) return;
    commitPlan({
      ...current,
      facilities: current.facilities.map(f => {
        if (f.id !== id) return f;
        const position = { x: f.position.x + dx, y: f.position.y + dy };
        // 微调也是位移：跨过分区边界就换归属。
        return { ...f, position, zoneId: inferZoneIdAt(position, current.zones) };
      }),
    });
  }

  /** P2-i Ctrl+D：复制选中设施（同模板/尺寸/旋转，偏移 2 m，名称加「副本」），复制件成为新选中。 */
  /** 2026-11-11 OnePlan Repeat 阵列：沿物件自身旋转轴复制 cols×rows（原件占 (0,0) 格），间距沿轴可调，一条 undo。 */
  /**
   * D 块阵列幽灵预览评估：沿原件自身旋转轴算出每个副本落点，逐格判越界 / 碰撞。
   * 口径：
   *  - 越界：占地四角环过 facilityPlacementIssues（与放置设施同口径）；
   *  - 碰撞：两个占地矩形是否相交（facilitiesFootprintsIntersect，SAT 任意旋转通用）；
   *    marginM 为候选盒外扩的安全间距（米），0 为纯占地相交，面板「碰撞间距」可调；
   *  - 越界策略：只要有非法格就整体禁提交（跳过非法格只生成合法格的方案留待拍板）；
   *  - 件数上限：REPEAT_MAX_COPIES，参照 Figpea Repeat 单次 500 件，这里取保守值。
   */
  const REPEAT_MAX_COPIES = 100;
  function evaluateRepeatPreview(
    anchor: PlanFacility,
    cols: number,
    rows: number,
    gapX: number,
    gapY: number,
    facilities: readonly PlanFacility[],
    boundary: readonly PlanPoint[],
    marginM = 0,
  ): { slots: { position: PlanPoint; invalid: boolean }[]; total: number; invalidCount: number; overLimit: boolean } {
    const theta = (anchor.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const placed = facilities.filter(f => f.id !== anchor.id);
    const slots: { position: PlanPoint; invalid: boolean }[] = [];
    let invalidCount = 0;
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        if (i === 0 && j === 0) continue;
        const lu = i * (anchor.size.width + gapX);
        const lv = j * (anchor.size.depth + gapY);
        const position: PlanPoint = { x: anchor.position.x + lu * cos - lv * sin, y: anchor.position.y + lu * sin + lv * cos };
        const footprint = facilityFootprintRing({ position, rotationDeg: anchor.rotationDeg, size: anchor.size });
        let invalid = facilityPlacementIssues(footprint, boundary).length > 0;
        if (!invalid) {
          const candidate = { position, rotationDeg: anchor.rotationDeg, size: anchor.size };
          invalid = placed.some(other => facilitiesFootprintsIntersect(candidate, other, marginM));
        }
        if (invalid) invalidCount += 1;
        else placed.push({ ...anchor, id: `__repeat-preview-${j}-${i}`, position });
        slots.push({ position, invalid });
      }
    }
    return { slots, total: slots.length, invalidCount, overLimit: slots.length > REPEAT_MAX_COPIES };
  }

  /** 阵列输入变更：同步 ref 真值并重画画布（state 供面板渲染，ref 供 draw 闭包读取）。 */
  function updateRepeatParams(patch: Partial<{ cols: number; rows: number; gapX: number; gapY: number; margin: number }>) {
    Object.assign(repeatParamsRef.current, patch);
    draw();
  }
  /** 属性页 ⇄ 阵列页切换：state 驱动面板，ref 同步给画布幽灵层。 */
  function switchRepeatCardMode(mode: 'props' | 'repeat') {
    setFacilityCardMode(mode);
    repeatParamsRef.current.cardMode = mode;
    draw();
  }

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
        const position = { x: fac.position.x + lu * cos - lv * sin, y: fac.position.y + lu * sin + lv * cos };
        copies.push({
          ...fac,
          id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-r${i}-${j}`,
          name: `${baseName} ${copies.length + 1}`,
          position,
          // 副本可能落到别的分区：逐件按落点重算归属，不无条件继承原件。
          zoneId: inferZoneIdAt(position, planRef.current.zones),
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
    const position = { x: facility.position.x + 2, y: facility.position.y + 2 };
    const copy: PlanFacility = {
      ...facility,
      id: crypto.randomUUID(),
      name: `${facility.name} 副本`,
      position,
      zoneId: inferZoneIdAt(position, planRef.current.zones),
    };
    commitPlan({ ...planRef.current, facilities: [...planRef.current.facilities, copy] });
    selectFacility(copy.id);
    setEditMessage(`已复制「${facility.name}」，可直接拖动或用面板改尺寸/旋转。`);
  }

  /* ---------------- 2026-11-12 OnePlan Selection tool：框选多选（B1–B3） ---------------- */

  /** 清空组选（ref+state 同步；drawAfter=false 供 setMode 等随后自会 draw 的调用方）。 */
  function clearMultiSelection(drawAfter = true) {
    multiSelectedFacilityIdsRef.current = [];
    setMultiSelectedFacilityIds([]);
    // 2026-11-14：框选多选扩展到流线/出入口——一并清。
    multiSelectedRouteIdsRef.current = [];
    setMultiSelectedRouteIds([]);
    multiSelectedNodeIdsRef.current = [];
    setMultiSelectedNodeIds([]);
    if (drawAfter) draw();
  }

  /** 2026-11-14：跨类型多选批删（Delete 与属性面板共用）——流线整删、出入口删并解除路线引用。 */
  function deleteCrossMulti() {
    const multiRouteIds = multiSelectedRouteIdsRef.current;
    const multiNodeIds = multiSelectedNodeIdsRef.current;
    if (!multiRouteIds.length && !multiNodeIds.length) return;
    const current = planRef.current;
    commitPlan({
      ...current,
      routes: multiNodeIds.reduce(
        (acc, nodeId) => detachNodeFromRoutes(nodeId, acc),
        current.routes.filter(r => !multiRouteIds.includes(r.id)),
      ),
      nodes: current.nodes.filter(n => !multiNodeIds.includes(n.id)),
    });
    multiSelectedRouteIdsRef.current = [];
    setMultiSelectedRouteIds([]);
    multiSelectedNodeIdsRef.current = [];
    setMultiSelectedNodeIds([]);
    setEditMessage(`已删除 ${multiRouteIds.length} 条流线、${multiNodeIds.length} 个出入口候选；关联引用已解除。`);
    draw();
  }

  /** 组选成立（≥2 件）：清单选/分区/标注选中，进入多选态。 */
  function selectFacilityGroup(ids: string[]) {
    selectedFacilityRef.current = null;
    setSelectedFacilityId(null);
    selectZone(null);
    selectAnnotation(null);
    // 2026-11-14：跨类型多选互斥——设施组成立时清流线/出入口多选（注意先清再设）。
    multiSelectedRouteIdsRef.current = [];
    setMultiSelectedRouteIds([]);
    multiSelectedNodeIdsRef.current = [];
    setMultiSelectedNodeIds([]);
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
    // resize（#51 方案甲）：对角固定的等比角缩放，宽深同乘统一系数，中心按新尺寸回推。
    const next = facilityUniformCornerResize(
      start,
      drag.corner as FacilityCornerIndex,
      pt,
      { minM: FACILITY_MIN_SIZE_M, maxM: FACILITY_MAX_SIZE_M },
    );
    return { ...start, position: next.position, size: next.size };
  }

  /* ---------------- H2-d 动线 / 节点 / 人员 ---------------- */

  function selectRoute(id: string | null) {
    selectedRouteRef.current = id;
    setSelectedRouteId(id);
    if (id !== null) {
      selectFacility(null); selectZone(null); selectNode(null); selectWorker(null); selectVehicle(null); selectMeasurement(null);
      clearMultiSelection(false);
    }
    draw();
  }

  function selectNode(id: string | null) {
    selectedNodeRef.current = id;
    setSelectedNodeId(id);
    if (id !== null) {
      selectFacility(null); selectRoute(null); selectWorker(null); selectVehicle(null); selectMeasurement(null);
      clearMultiSelection(false);
    }
    draw();
  }

  function selectWorker(id: string | null) {
    selectedWorkerRef.current = id;
    setSelectedWorkerId(id);
    if (id !== null) {
      selectFacility(null); selectRoute(null); selectNode(null); selectMeasurement(null); selectVehicle(null);
    }
    draw();
  }

  /**
   * 2026-11-17 #118 补录入 UI：选中车辆（独立集合，与设施/分区/动线/节点/人员互斥）。
   * 与 selectWorker 同款：id 为 null 时只清状态，不反向清别人（避免互斥递归）。
   */
  function selectVehicle(id: string | null) {
    selectedVehicleRef.current = id;
    setSelectedVehicleId(id);
    if (id !== null) {
      selectFacility(null); selectRoute(null); selectNode(null); selectWorker(null); selectMeasurement(null);
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

  /** 命中检测：最近的车辆（VEHICLE_HIT_PX 内），无则 null。只命中当前层。 */
  function nearestVehicleIdAt(px: { x: number; y: number }): string | null {
    let best: { id: string; d: number } | null = null;
    for (const v of viewPlan().vehicles ?? []) {
      const pt = planPointToPixel(v.position, currentViewport());
      const d = Math.hypot(pt.x - px.x, pt.y - px.y);
      if (d <= VEHICLE_HIT_PX && (best === null || d < best.d)) best = { id: v.id, d };
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

  /** 画布上该画的徽章：默认只画真冲突（红）；缺宽度/容量待核实属于提示，手动开才上图。 */
  function visibleConflictClusters(): PlanConflictCluster[] {
    const all = conflictClustersRef.current;
    return all.filter(cluster => cluster.status === 'conflict' || showAdvisoryBadgesRef.current);
  }

  /** 切换「提示类徽标（缺宽度 / 容量待核实）」是否上图（ref 与 state 双写，draw() 里读的是 ref）。 */
  function toggleShowAdvisoryBadges(next: boolean) {
    showAdvisoryBadgesRef.current = next;
    setShowAdvisoryBadges(next);
    // 隐藏了提示类就不该还留着它的明细卡。
    if (!next) {
      const detail = conflictClustersRef.current.find(cluster => cluster.key === conflictDetailKeyRef.current);
      if (detail && detail.status !== 'conflict') showConflictDetail(null);
    }
    draw();
  }

  /** H3-b 命中检测：最近的合并徽章（与绘制半径一致，标记恒在业务层之上）。 */
  function nearestConflictClusterAt(px: { x: number; y: number }): PlanConflictCluster | null {
    let best: { cluster: PlanConflictCluster; d: number } | null = null;
    for (const cluster of visibleConflictClusters()) {
      const pt = planPointToPixel(cluster.at, currentViewport());
      const d = Math.hypot(pt.x - px.x, pt.y - px.y);
      // 带数字的徽章画得稍大，命中半径跟着放宽一点。
      const radius = cluster.count > 1 ? 12 : 10;
      if (d <= radius && (best === null || d < best.d)) best = { cluster, d };
    }
    return best?.cluster ?? null;
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
  function addRoutePoint(pt: PlanPoint) {    const draftPoints = routeDraftRef.current;
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
    setEditMessage(outsideScopeHint(planRef.current.designScope ?? [], pt));
    draw();
  }

  /**
   * 动线点落在设计范围外（蒙版区）时只提示、不拒绝（2026-11-15 用户定）：
   * 现场常有借用市政道路、地铁口前空地的情况，硬拦会把真实方案挡在门外；
   * 但范围是为了让视线集中在「这次要设计的地」，所以必须当场说一句。
   */
  function outsideScopeHint(designScope: readonly PlanPoint[], pt: PlanPoint): string | null {
    if (designScope.length < 3) return null;
    if (scopeContainsPoint(designScope, pt)) return null;
    return '这个点在设计范围外（蒙版区）：仍然保留，但先确认要不要把设计范围扩大一点。';
  }

  /** 完成/提交动线：端点吸附节点（唯一端点来源），buildRoute 校验后提交；可连续画下一条。 */
  function finishRoute() {
    const draftPoints = routeDraftRef.current;
    // 2026-11-16 用户「点了 Alt 又改回了人行道」：从端点续接时，结束不是新建一条线，
    // 而是把新点并回原动线（id/名称/类型/颜色/宽度/单行全保留，一条 undo 可撤）。
    const extend = routeExtendRef.current;
    routeExtendRef.current = null;
    if (extend) {
      const current = planRef.current;
      const view = viewPlan();
      const source = view.routes.find(route => route.id === extend.routeId);
      if (source) {
        const tail = draftPoints.slice(1);
        if (tail.length === 0) {
          setEditMessage('续接至少还要再点 1 个点：单击加点，双击结束。');
          return;
        }
        const mergedRaw = extend.at === 'end'
          ? [...source.points, ...tail]
          : [...[...tail].reverse(), ...source.points];
        const startSnap = snapNodeAt(mergedRaw[0]!);
        const endSnap = snapNodeAt(mergedRaw[mergedRaw.length - 1]!);
        const points = mergedRaw.map((p, i) => {
          if (i === 0 && startSnap) return startSnap.position;
          if (i === mergedRaw.length - 1 && endSnap && endSnap.nodeId !== startSnap?.nodeId) return endSnap.position;
          return p;
        });
        const issue = routeVertexEditIssue(points);
        if (issue) {
          setEditMessage(issue.message);
          return;
        }
        const next: PlanRoute = { ...source, points: points.map(p => ({ x: p.x, y: p.y })) };
        const startNodeId = extend.at === 'start' ? startSnap?.nodeId : source.startNodeId;
        const endNodeId = extend.at === 'end' ? endSnap?.nodeId : source.endNodeId;
        if (startNodeId) next.startNodeId = startNodeId; else delete next.startNodeId;
        if (endNodeId) next.endNodeId = endNodeId; else delete next.endNodeId;
        // 续接不再重算边界交点：已存在的交点节点保持不变，避免重复插节点。
        commitPlan({
          ...current,
          routes: current.routes.map(route => (route.id === source.id ? next : route)),
        });
        routeDraftRef.current = [];
        routeCursorRef.current = null;
        setRouteDraftCount(0);
        selectRoute(source.id);
        setEditMessage(`已续接「${source.name}」（${planRouteKindLabels[next.kind]}）：现在 ${next.points.length} 个折点；可继续画或 Esc 结束。`);
        return;
      }
    }
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
        // 载体：车的预设自带 vehicle；手画车辆动线也是机动车；人行/后勤吃默认步行（2026-11-16）。
        carrier: routePresetRef.current?.carrier ?? (routeKindRef.current === 'vehicle' ? 'vehicle' : 'walk'),
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
    // 2026-11-15 用户：「从场地外的线到场地边界的时候，交界处会自动变成入口/出口/出入口」。
    // 交点处还没有节点时补一个：类型按这条线的方向判（单向进场→入口、离场→出口，双向→出入口）。
    const routeBase: SitePlanData = {
      ...current,
      routes: [...current.routes, { ...result.value, ...activeLevelStamp() }],
    };
    const withCrossings = planWithCrossingNodes(routeBase, result.value);
    commitPlan(withCrossings.plan);
    routeDraftRef.current = [];
    routeCursorRef.current = null;
    setRouteDraftCount(0);
    selectRoute(result.value.id);
    const snapHint = startSnap || endSnap ? '，端点已连接到出入口节点' : '';
    const crossingHint = withCrossings.added.length > 0
      ? `；交界处已自动加${withCrossings.added.map(node => `「${node.name}」（${nodeKindLabel(node.kind)}）`).join('、')}`
      : '';
    setEditMessage(`动线「${result.value.name}」已添加${snapHint}${crossingHint}；继续画下一条或 Esc 结束。`);
  }

  /** 放节点模式单击：类型取当前工具箱选择，落点自动归属分区，自动编号命名，连续放置。 */
  function placeNodeAt(pt: PlanPoint) {
    const current = planRef.current;
    const view = viewPlan();
    const stamp = activeLevelStamp();
    const result = buildNode(
      {
        kind: nodeKindRef.current,
        // 2026-11-15 用户：自动名按「类型 + 递增数字」，且各类型各自编号（此前用全局点位总数，
        // 放第三个出口会叫「出口 3」但中间夹着入口，编号看着像乱跳）。
        name: autoNodeName(nodeKindRef.current, view.nodes),
        position: pt,
        ...(stamp.levelId !== undefined ? { levelId: stamp.levelId } : {}),
      },
      view.boundary,
      view.zones,
    );
    if (!result.ok) {
      setEditMessage(result.issue.message);
      return;
    }
    const node = result.value;
    commitPlan({ ...current, nodes: [...current.nodes, node] });
    selectNode(node.id);
    const hint = result.issues && result.issues.length > 0 ? `，注意：${result.issues.map(i => i.message).join('；')}` : '';
    setEditMessage(`已放置「${node.name}」${hint}；继续单击放置或 Esc 结束。`);
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

  /**
   * 2026-11-17 #118 补录入 UI：布车模式单击落一台车。
   *
   * 车型/台数取面板值，落点自动归属分区（当前层分区），连续放置。
   * **不自动挂模型**：契约里 `modelSlug` 缺省就是「库内没有该车型 GLB」，
   * 回落登记表首项会把「待补模型」显示成有车模（#118 §3.5）——要挂模型在属性卡里显式选。
   */
  function placeVehicleAt(pt: PlanPoint) {
    const current = planRef.current;
    const view = viewPlan();
    const result = buildVehicle(
      { type: vehicleTypeRef.current, count: vehicleCountRef.current, position: pt },
      view.boundary,
      view.zones,
    );
    if (!result.ok) {
      setEditMessage(result.issue.message);
      return;
    }
    commitPlan({
      ...current,
      vehicles: [...(current.vehicles ?? []), { ...result.value, ...activeLevelStamp() }],
    });
    selectVehicle(result.value.id);
    const hint = result.issues && result.issues.length > 0 ? `，注意：${result.issues.map(i => i.message).join('；')}` : '';
    setEditMessage(`已布「${vehicleLabelOf(result.value)} ×${result.value.count}」${hint}；继续单击放置或 Esc 结束。`);
  }

  function updateRoute(id: string, patch: Partial<Pick<PlanRoute, 'name' | 'kind' | 'oneWay' | 'carrier'>>) {
    const current = planRef.current;
    if (patch.name !== undefined && patch.name.trim().length === 0) return;
    const route = current.routes.find(r => r.id === id);
    if (!route) return;
    const nextRoute: PlanRoute = { ...route, ...patch };
    const base: SitePlanData = {
      ...current,
      routes: current.routes.map(r => (r.id === id ? nextRoute : r)),
    };
    // 2026-11-15 用户：「单向的进去就是入口，出来的就是出口；双向的就是出入口」——
    // 切单向/双向就是把交界处重新判一次型（同一只节点改型改名，不新建）。
    if (patch.oneWay === undefined) {
      commitPlan(base);
      return;
    }
    const updated = planWithCrossingNodes(base, nextRoute);
    commitPlan(updated.plan);
    if (updated.retyped.length > 0) {
      setEditMessage(`已按${nextRoute.oneWay ? '单向' : '双向'}流向调整交界处：${updated.retyped.map(node => `「${node.name}」（${nodeKindLabel(node.kind)}）`).join('、')}。`);
    }
  }

  function reverseSelectedRoute(id: string) {
    const current = planRef.current;
    const route = current.routes.find(r => r.id === id);
    if (!route) return;
    const nextRoute = reverseRoute(route);
    const base: SitePlanData = {
      ...current,
      routes: current.routes.map(r => (r.id === id ? nextRoute : r)),
    };
    // 方向一反，进/出也反了：交界处的入口/出口跟着对调（双向线不受影响）。
    const updated = planWithCrossingNodes(base, nextRoute);
    commitPlan(updated.plan);
    setEditMessage(
      updated.retyped.length > 0
        ? `动线方向已反转；交界处随之调整：${updated.retyped.map(node => `「${node.name}」（${nodeKindLabel(node.kind)}）`).join('、')}。`
        : '动线方向已反转（起终点引用已互换）。',
    );
  }

  function deleteRoute(id: string) {
    const current = planRef.current;
    // 2026-11-15：删动线时把它自己建的交界出入口一并收走（被别人引用 / 用户改过名字的保留）。
    const nodes = removeAutoCrossingNodesOfRoute(id, current);
    commitPlan({
      ...current,
      routes: current.routes.filter(r => r.id !== id),
      ...(nodes.length !== current.nodes.length ? { nodes } : {}),
    });
    selectRoute(null);
    setEditMessage(nodes.length !== current.nodes.length ? '动线已删除（交界处自动生成的出入口一并移除）。' : '动线已删除。');
  }

  function updateNode(id: string, patch: Partial<Pick<PlanNode, 'name' | 'kind' | 'zoneId'>>) {
    const current = planRef.current;
    if (patch.name !== undefined && patch.name.trim().length === 0) return;
    const target = current.nodes.find(n => n.id === id);
    // 2026-11-15 用户：「入口改成出口之后自动改名」——换类型时把自动名里的类型词换掉，
    // 编号尽量保持不变；用户手改过的名字（不带「入口 N」形态）不碰。
    const autoRenamed = target && patch.kind !== undefined && patch.kind !== target.kind && patch.name === undefined
      ? renamedNodeName(target.name, patch.kind, current.nodes, id)
      : undefined;
    commitPlan({
      ...current,
      nodes: current.nodes.map(n => (n.id === id
        ? { ...n, ...patch, ...(autoRenamed !== undefined && autoRenamed !== n.name ? { name: autoRenamed } : {}) }
        : n)),
    });
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

  function updateWorker(id: string, patch: Partial<Pick<PlanWorker, 'role' | 'count' | 'zoneId' | 'assetId'>>) {
    const current = planRef.current;
    if (patch.role !== undefined && patch.role.trim().length === 0) return;
    if (patch.count !== undefined && (!Number.isInteger(patch.count) || patch.count < 1)) return;
    // 固定角色必须是登记表里可走的漫游角色；未登记/不可走视为未绑定，不写入。
    if (patch.assetId !== undefined && patch.assetId && !WALK_ROLES.some(role => role.assetId === patch.assetId && role.walkable)) return;
    commitPlan({ ...current, workers: current.workers.map(w => (w.id === id ? { ...w, ...patch } : w)) });
  }

  function deleteWorker(id: string) {
    const current = planRef.current;
    commitPlan({ ...current, workers: current.workers.filter(w => w.id !== id) });
    selectWorker(null);
    setEditMessage('人员点位已删除。');
  }

  /**
   * 2026-11-17 #118 补录入 UI：改车辆（车型/台数/归属分区/模型）。
   *
   * 模型 slug 只能取**该车型登记表里那几条**——不借近似车型（12m 大巴按 7.5m 箱货
   * 会算小落客区与转弯半径）。台数按契约上限 99 收。
   */
  function updateVehicle(id: string, patch: Partial<Pick<PlanVehicle, 'type' | 'count' | 'zoneId' | 'modelSlug'>>) {
    const current = planRef.current;
    if (patch.count !== undefined && (!Number.isInteger(patch.count) || patch.count < 1 || patch.count > 99)) return;
    const vehicle = (current.vehicles ?? []).find(v => v.id === id);
    if (!vehicle) return;
    if (patch.modelSlug !== undefined && patch.modelSlug) {
      const allowed = VEHICLE_TYPES.find(item => item.id === vehicle.type)?.modelSlugs ?? [];
      if (!allowed.includes(patch.modelSlug)) return;
    }
    // 换车型时，原来那台车的模型多半不适用于新车型（不许借近似车型）：一并摘掉，退回「待补模型」。
    const nextType = patch.type ?? vehicle.type;
    const allowedForNext = VEHICLE_TYPES.find(item => item.id === nextType)?.modelSlugs ?? [];
    const modelSlug = patch.modelSlug !== undefined
      ? patch.modelSlug
      : (vehicle.modelSlug && allowedForNext.includes(vehicle.modelSlug) ? vehicle.modelSlug : undefined);
    commitPlan({
      ...current,
      vehicles: (current.vehicles ?? []).map(v => (v.id === id
        ? { ...v, ...patch, ...(modelSlug ? { modelSlug } : { modelSlug: undefined }) }
        : v)),
    });
  }

  function deleteVehicle(id: string) {
    const current = planRef.current;
    commitPlan({ ...current, vehicles: (current.vehicles ?? []).filter(v => v.id !== id) });
    selectVehicle(null);
    setEditMessage('车辆已删除。');
  }

  /* ---------------- H3-a 测量（临时读数 + 固定测量） ---------------- */

  /**
   * 丢弃本次测量画上的全部线（退出测量工具 / 点卡片 × 时自动执行）。
   * 只删本会话的 id：历史/别人留下的测量不动。
   */
  function dropMeasureSession() {
    const ids = measureSessionIdsRef.current;
    measureSessionIdsRef.current = [];
    measureDraftRef.current = [];
    measureCursorRef.current = null;
    measureDragRef.current = null;
    measurementDragPreviewRef.current = null;
    dragMeasurementRef.current = null;
    setMeasureDraftCount(0);
    if (ids.length === 0) return;
    const current = planRef.current;
    const remaining = (current.measurements ?? []).filter(item => !ids.includes(item.id));
    if (remaining.length !== (current.measurements ?? []).length) {
      commitPlan({ ...current, measurements: remaining });
    }
    if (selectedMeasurementRef.current && ids.includes(selectedMeasurementRef.current)) {
      selectedMeasurementRef.current = null;
      setSelectedMeasurementId(null);
    }
  }

  /** 测量卡片的 ×：退出测量并清掉本次画的线（与 Esc / 切工具同一结果）。 */
  function closeMeasureRuler() {
    dropMeasureSession();
    setMode('view');
    setEditMessage('测量已清除。');
  }

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
    // 2026-11-16 用户：「可以多段线测量」——距离不再收满两点就自动提交，
    // 单击继续加段（累计读数 + 过程标尺跟着长），双击 / 「完成」 / 右键结束。
    draw();
  }

  /** 提交并固定测量：buildMeasurement 校验后 commitPlan；清草稿可连续测量。 */
  function finishMeasure() {
    const kind = measureKindRef.current;
    const draft = measureDraftRef.current;
    if (draft.length < (kind === 'area' ? 3 : 2)) {
      setEditMessage(kind === 'area'
        ? '面积测量：按住对角拖出矩形（Shift 正方形），或单击描顶点、点回起点闭合。'
        : '距离测量：按住拖一条线，或单击起点和终点；继续单击可接成多段。');
      return;
    }
    const current = planRef.current;
    const existing = current.measurements ?? [];
    // 契约：distance 恰好 2 点；多段距离按 path 口径提交（读数同为折线总长），展示仍叫距离。
    const commitKind: PlanMeasureKind = kind === 'distance' && draft.length > 2 ? 'path' : kind;
    const result = buildMeasurement({
      kind: commitKind,
      name: `${measureKindLabel(kind)} ${(viewPlan().measurements ?? []).length + 1}`,
      points: draft,
    });
    if (!result.ok) {
      setEditMessage(result.issue.message);
      return;
    }
    commitPlan({ ...current, measurements: [...existing, { ...result.value, ...activeLevelStamp() }] });
    measureSessionIdsRef.current = [...measureSessionIdsRef.current, result.value.id];
    measureDraftRef.current = [];
    measureCursorRef.current = null;
    setMeasureDraftCount(0);
    const valueText = result.value.kind === 'area'
      ? formatAreaM2(measureValue(result.value))
      : formatLengthM(measureValue(result.value));
    setEditMessage(`已量「${result.value.name}」= ${valueText}；可接着加一段，或双击 / Esc 结束（退出会自动清掉这条线）。`);
  }

  /** 删除固定测量标注（测量不是实体，删了就没了；不参与冲突判定，无需剥离引用）。 */
  function deleteMeasurement(id: string) {
    const current = planRef.current;
    commitPlan({ ...current, measurements: (current.measurements ?? []).filter(m => m.id !== id) });
    if (selectedMeasurementRef.current === id) {
      selectedMeasurementRef.current = null;
      setSelectedMeasurementId(null);
    }
    setEditMessage('测量标注已删除。');
    draw();
  }

  /**
   * 2026-11-16 选中固定测量（与其它实体互斥）：选中后信息条直接报读数与可做的事，
   * 画布上可拖动移位、Delete 删除；面板行的「删除」保留不动。
   */
  function selectMeasurement(id: string | null) {
    selectedMeasurementRef.current = id;
    setSelectedMeasurementId(id);
    if (id) {
      selectFacility(null); selectZone(null); selectRoute(null); selectNode(null); selectWorker(null); selectVehicle(null); selectAnnotation(null);
      clearMultiSelection(false);
      const measurement = (planRef.current.measurements ?? []).find(m => m.id === id);
      if (measurement) {
        const valueText = measurement.kind === 'area'
          ? formatAreaM2(measureValue(measurement))
          : formatLengthM(measureValue(measurement));
        setEditMessage(`已选中${measureKindLabel(measurement.kind)}测量「${measurement.name}」= ${valueText}：按住拖动可移位，Delete 删除。`);
      }
    }
    draw();
  }

  /** 指针位置下的固定测量（轮廓/环 9 px 内，取最近一条）。 */
  function measurementAt(px: { x: number; y: number }): PlanMeasurement | null {
    const id = nearestMeasurementIdAt(px);
    return id ? (planRef.current.measurements ?? []).find(m => m.id === id) ?? null : null;
  }

  /** 开始一条测量拖动会话（浏览/选择模式共用）；返回 true = 这次按下被测量吃掉。 */
  function beginMeasurementDrag(measurement: PlanMeasurement, hit: { px: { x: number; y: number }; pt: PlanPoint }): boolean {
    selectMeasurement(measurement.id);
    const base = measurement.points.map(p => ({ x: p.x, y: p.y }));
    dragMeasurementRef.current = { id: measurement.id, kind: measurement.kind, startPt: hit.pt, base, moved: false };
    measurementDragPreviewRef.current = { id: measurement.id, points: base.map(p => ({ ...p })) };
    pointerConsumedRef.current = true;
    downPxRef.current = hit.px;
    setDragging(true);
    return true;
  }

  /* ---------------- 2026-11-11 用户指令：自由标注（文本 + 形状） ---------------- */

  /** 选中标注（与其他实体选中互斥）。 */
  function selectAnnotation(id: string | null) {
    selectedAnnotationRef.current = id;
    setSelectedAnnotationId(id);
    if (id !== null) {
      selectFacility(null); selectZone(null); selectRoute(null); selectNode(null); selectWorker(null); selectMeasurement(null);
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
    const result = buildAnnotation({
      ...input,
      name,
      color: annotateColorRef.current,
      ...(input.kind !== 'note' ? { strokeWidth: annotateStrokeWidthRef.current } : {}),
    });
    if (!result.ok) {
      setEditMessage(result.issue.message);
      return false;
    }
    commitPlan({ ...current, annotations: [...(current.annotations ?? []), { ...result.value, ...activeLevelStamp() }] });
    setEditMessage(`已添加标注「${result.value.name}」；继续标注或 Esc 结束。`);
    return true;
  }

  /**
   * 2026-11-17 用户：再点当前工具 = 退出回浏览。
   * 未提交的草稿/文字直接取消，只给一条轻提示，不弹确认框。
   */
  function exitAnnotateDraw() {
    const hadDraft = Boolean(noteInputRef.current?.value.trim()) || annotateDraftRef.current.length > 0;
    setMode('view');
    if (hadDraft) setAnnotateNotice('已退出标注，未提交的内容已取消。');
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

  /**
   * 2026-11-16 命中检测：最近的固定测量（点到描边折线/闭合环的像素距离）。
   * 只命中外轮廓与环，不把整块面积填充当热区（否则盖在大片场地上会抢走设施点选）。
   * 拖动中的预览几何同样参与命中，拖动时指针不会“掉”出标注。
   */
  function nearestMeasurementIdAt(px: { x: number; y: number }): string | null {
    const viewport = currentViewport();
    const measurements = viewPlan().measurements ?? [];
    let best: { id: string; d: number } | null = null;
    for (const m of measurements) {
      const preview = measurementDragPreviewRef.current;
      const points = preview?.id === m.id ? preview.points : m.points;
      if (points.length < 2) continue;
      const closed = m.kind === 'area' && points.length >= 3;
      const segmentCount = closed ? points.length : points.length - 1;
      for (let index = 0; index < segmentCount; index += 1) {
        const a = planPointToPixel(points[index]!, viewport);
        const b = planPointToPixel(points[(index + 1) % points.length]!, viewport);
        const d = pointSegmentDistancePx(px, a, b);
        if (d <= MEASUREMENT_HIT_PX && (best === null || d < best.d)) best = { id: m.id, d };
      }
    }
    return best?.id ?? null;
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
   * 2026-11-15 设计范围定位：把视野框到范围的外接矩形。
   * 为什么不用 centerViewOn：设计范围常常比视口大好几倍（外扩 20 m 就是 60 m 见方），
   * 只居中不缩放的话压暗区会铺满整块画布，用户看到的就是「整张图变暗、看不到那个框」，
   * 误以为蒙版坏了。这里复用 focusBounds 的墨卡托反解，一次把框塞进视口。
   */
  function focusDesignScope(scope: readonly PlanPoint[]) {
    if (scope.length < 3) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of scope) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return;
    const anchor = planRef.current.anchor;
    const lng0 = anchor?.lng ?? DEFAULT_ANCHOR_LNG;
    const lat0 = anchor?.lat ?? DEFAULT_ANCHOR_LAT;
    const sw = enuToLngLat(minX, minY, lng0, lat0);
    const ne = enuToLngLat(maxX, maxY, lng0, lat0);
    focusBounds([
      Math.min(sw.lng, ne.lng),
      Math.min(sw.lat, ne.lat),
      Math.max(sw.lng, ne.lng),
      Math.max(sw.lat, ne.lat),
    ]);
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

  /** 2026-11-14 统一右键菜单：分区复制（整体平移 2 m，名称加「副本」，一条 undo，与设施复制同口径）。 */
  function duplicateZone(id: string) {
    const zone = planRef.current.zones.find(z => z.id === id);
    if (!zone) return;
    const copy: PlanZone = {
      ...zone,
      id: crypto.randomUUID(),
      name: `${zone.name} 副本`,
      polygon: zone.polygon.map(p => ({ x: p.x + 2, y: p.y + 2 })),
      ...activeLevelStamp(),
    };
    commitPlan({ ...planRef.current, zones: [...planRef.current.zones, copy] });
    selectZone(copy.id);
    setEditMessage(`已复制分区「${zone.name}」，可直接拖动或用面板改色/透明度。`);
  }

  /** 2026-11-11：树行右键删除的统一入口（按行 kind 分发到既有删除器）。 */
  function deleteRow(row: PlanInventoryRow) {
    if (row.kind === 'zone') deleteZone(row.id);
    else if (row.kind === 'facility') deleteFacility(row.id);
    else if (row.kind === 'route') deleteRoute(row.id);
    else if (row.kind === 'node') deleteNode(row.id);
    else if (row.kind === 'worker') deleteWorker(row.id);
    // 2026-11-17 #118 补录入 UI：车辆行的删除也要真删（此前这一行是静默无动作）。
    else if (row.kind === 'vehicle') deleteVehicle(row.id);
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
    } else if (row.kind === 'vehicle') {
      // 2026-11-17 #118 补录入 UI：车辆行点击 = 选中 + 居中。
      selectVehicle(row.id);
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
    if (nearestConflictClusterAt(hit.px)) return true;
    if (!layerLocked('node') && nearestNodeIdAt(hit.px)) return true;
    if (!layerLocked('worker') && nearestWorkerIdAt(hit.px)) return true;
    if (!layerLocked('route') && nearestRouteIdAt(hit.px)) return true;
    // 2026-11-17 #118 补录入 UI：车辆可点选（独立集合，未做图层开关，暂不参与 layerLocked）。
    if (nearestVehicleIdAt(hit.px)) return true;
    if (!layerLocked('annotate') && nearestAnnotationIdAt(hit.pt)) return true;
    if (!layerLocked('facility') && viewPlan().facilities.some((facility) => facilityContainsPoint(hit.pt, facility))) return true;
    if (!layerLocked('zone') && viewPlan().zones.some((zone) => planPointInRing(hit.pt, zone.polygon))) return true;
    return false;
  }

  /**
   * 2026-11-15：设计范围四角的命中（12 px）。画面上只有白色 L 角标、不再画圆点手柄
   * （用户「这个圆形的点完全没必要存在」），所以热区要比视觉角标宽一圈，否则得精准点角心。
   * 只认 4 点矩形；旧的多段线数据不给角柄，避免拖出奇怪形状。
   */
  function scopeCornerIndexAt(px: { x: number; y: number }): number | null {
    const ring = planRef.current.designScope ?? [];
    if (ring.length !== 4) return null;
    const viewport = currentViewport();
    for (let index = 0; index < ring.length; index += 1) {
      const corner = planPointToPixel(ring[index]!, viewport);
      if (Math.hypot(corner.x - px.x, corner.y - px.y) <= 12) return index;
    }
    return null;
  }

  /**
   * 2026-11-15 用户指令「几个侧边，点的时候也可以按照对应的方向拖动」：
   * 边上按住的命中——8 px 带到四边，角点（12 px）优先，两套不抢：
   * 离角近就按角的双向缩放，离边近就只动那一条边。
   * ENU 口径：north = 屏幕上方（y 最小），south = 下方，west = 左，east = 右。
   */
  function scopeEdgeAt(px: { x: number; y: number }): ScopeEdge | null {
    const ring = planRef.current.designScope ?? [];
    if (ring.length !== 4) return null;
    const viewport = currentViewport();
    return nearestScopeEdgePx(ring.map(point => planPointToPixel(point, viewport)), px);
  }

  /** 锁定钮的当前矩形（框右上外侧）；没框就是 null。 */
  function scopeLockRectAt(viewport = currentViewport()) {
    const ring = planRef.current.designScope ?? [];
    if (ring.length < 3) return null;
    return scopeLockButtonRect(ring.map(point => planPointToPixel(point, viewport)), viewport);
  }

  /**
   * 场地边界（绿色总区域）的锁定钮：放在**设计白框右上角的内侧**（角的左下方向）。
   *
   * 2026-11-16 用户：「边界的锁在设计白框右上角位置的框内左下角」——两枚锁一外一内：
   * 白框自己的锁在框外右上角，边界锁在同一个角的框内，不会认错。
   * 没画设计范围时退回边界自己的包围盒，避免钮消失。
   */
  function boundaryLockRectAt(viewport = currentViewport()) {
    const scopeRing = planRef.current.designScope ?? [];
    const ring = scopeRing.length >= 3 ? scopeRing : (previewRingRef.current ?? planRef.current.boundary);
    if (ring.length < 3) return null;
    const rect = scopeLockButtonRect(
      ring.map(point => planPointToPixel(point, viewport)),
      viewport,
      { placement: 'inside' },
    );
    return rect;
  }

  /**
   * Ctrl+Z 的第一优先级：撤「正在画的草稿」的最后一个点。
   *
   * 2026-11-16 用户：「正在画线时 Ctrl+Z 应该撤我刚放的点，而不是上一条画好的线」——
   * 草稿还在手上时，历史栈里存的是上一次任务，先撤它是错的。
   * 返回 true = 这次 Ctrl+Z 已被草稿消费；false = 交给历史栈。
   */
  function undoDraftStep(): boolean {
    const mode = modeRef.current;
    if (mode === 'route' && routeDraftRef.current.length > 0) {
      const next = routeDraftRef.current.slice(0, -1);
      routeDraftRef.current = next;
      setRouteDraftCount(next.length);
      setEditMessage(next.length === 0
        ? '已撤回起点（仍在画动线：单击重新开始，Esc 退出）。'
        : `已撤回刚放的点，还剩 ${next.length} 个；双击结束动线。`);
      draw();
      notifyPlanDraftChanged();
      return true;
    }
    if ((mode === 'zone' || mode === 'boundary') && draftRef.current.length > 0) {
      const next = draftRef.current.slice(0, -1);
      draftRef.current = next;
      setEditMessage(next.length === 0
        ? '草稿已清空（仍在收点模式：单击重新开始，Esc 退出）。'
        : `已撤回上一个点，还剩 ${next.length} 个。`);
      draw();
      notifyPlanDraftChanged();
      return true;
    }
    if (mode === 'measure' && measureDraftRef.current.length > 0) {
      const next = measureDraftRef.current.slice(0, -1);
      measureDraftRef.current = next;
      setMeasureDraftCount(next.length);
      setEditMessage(next.length === 0
        ? '已撤回测量起点。'
        : `已撤回上一个测量点，还剩 ${next.length} 个。`);
      draw();
      return true;
    }
    return false;
  }

  /**
   * 2026-11-16 用户「我明明是在改车行道，点了 Alt 又改回了人行道进行补充」：
   * Alt 的落点决定“画什么”：类型/颜色跟**来源动线**走（没来源就跟着已选中的线，再退到工具箱），
   * 不再沿用工具箱里上一次选的类型——那才是“改回人行道”的根源。
   * 另外：点在端点上 = 续接同一条线（不是另起一条）。
   */
  function branchIntentFor(anchor: { routeId?: string; isEndpoint?: boolean; vertexIndex?: number }) {
    const plan = planRef.current;
    const source = anchor.routeId ? plan.routes.find(route => route.id === anchor.routeId) : undefined;
    const selected = plan.routes.find(route => route.id === selectedRouteRef.current);
    const kind = source?.kind ?? selected?.kind ?? routeKindRef.current;
    const extendAt: 'start' | 'end' | null = source && anchor.isEndpoint
      ? (anchor.vertexIndex === 0 ? 'start' : 'end')
      : null;
    return { source, kind, extendAt, color: source?.color };
  }

  /** 开关场地边界锁：写的是图层锁，与左栅那一行同步。 */
  function toggleBoundaryLock() {
    const next = !layerLocked('boundary');
    setLayerLocked('boundary', next);
    if (next) clearBoundaryDeleteArm();
    setEditMessage(next
      ? '用地红线已锁定：拖顶点、加点都不再响应；再点右上角这枚锁即可解锁。'
      : '用地红线已解锁：可以拖顶点、双击加点 / 点顶点删点。');
  }

  /** 开关锁定：只关命中，不动数据；锁上时顺手清掉边悬停光标。 */
  function toggleScopeLock() {    const next = !scopeLockedRef.current;
    scopeLockedRef.current = next;
    scopeEdgeHoverRef.current = null;
    setScopeEdgeHover(null);
    setEditMessage(
      next
        ? '设计范围边框已锁定：拖角、拖四条边都不再响应（防止手滑改到范围）；再点一次锁即可解锁。'
        : '设计范围边框已解锁：可以拖角、拖四条边调整范围。',
    );
    draw();
  }

  function handleStageMouseDown(event: React.MouseEvent) {
    // 2026-11-16 罗盘拖转 2D：右下 Google 控制簇（罗盘/2D3D/缩放/漫游）挂在 stage 里，
    // 控件上的指针事件会一路冒泡到这里被当成画布手势——罗盘拖转就会连带平移地图。
    // 控件目标一律不当画布手势处理（其余 UI 冒泡行为不变）。
    if (event.target instanceof Element && event.target.closest('.oc-gmaps')) return;
    const activeMode = modeRef.current;
    const hit = eventPlanPoint(event);
    // 2026-11-16 用户「按住 Alt 在原来的点上添加线」：Alt + 点已有点 = 从它分叉一条新动线。
    // 2026-11-16 用户反馈「和双击删除冲突，很容易误删」：Alt 现在是一个**严格手势**——
    // 只要按着 Alt，任何删除/加点/选中都不允许跑；没命中已有点就只给提示，不做事。
    if (event.altKey) {
      const anchor = hit && onPlanChange && (activeMode === 'view' || activeMode === 'select' || activeMode === 'route')
        ? findRouteBranchAnchor(planRef.current, hit.px, currentViewport(), { nodeRadiusPx: NODE_HIT_PX + 4 })
        : null;
      pointerConsumedRef.current = true;
      downPxRef.current = null;
      if (!anchor) {
        setEditMessage(activeMode === 'route'
          ? '正在画动线：松开 Alt 单击即可加点（Alt 只用来从已有点分叉）。'
          : 'Alt 只能从已有的点（出入口 / 动线折点）分叉画线；空白处请松开 Alt 再点。');
        return;
      }
      if (activeMode === 'route' && routeDraftRef.current.length > 0) {
        setEditMessage('正在画动线：先双击结束或 Esc 取消，再按住 Alt 从别的点分叉。');
        return;
      }
      branchAnchorHintRef.current = null;
      setBranchAnchorHint(null);
      clearBoundaryDeleteArm();
      const intent = branchIntentFor(anchor);
      setMode('route');
      // setMode 会清草稿与预设——类型/颜色/续接目标必须在它之后写回去。
      routeKindRef.current = intent.kind;
      setRouteKind(intent.kind);
      routePresetRef.current = intent.color ? { kind: intent.kind, color: intent.color } : null;
      routeExtendRef.current = intent.source && intent.extendAt
        ? { routeId: intent.source.id, at: intent.extendAt }
        : null;
      // setMode 会清草稿——首点必须在它之后写进去。
      routeDraftRef.current = [{ ...anchor.point }];
      setRouteDraftCount(1);
      branchStartedAtRef.current = performance.now();
      const kindLabel = planRouteKindLabels[intent.kind];
      setEditMessage(intent.extendAt
        ? `已接着「${anchor.label}」的${intent.extendAt === 'start' ? '起点' : '终点'}画（同一条${kindLabel}线，双击结束后并入、不新建）：单击加点，Ctrl+Z 撤刚放的点。`
        : `已从「${anchor.label}」分叉一条${kindLabel}新动线（沿用原线的类型/颜色）：单击加点、双击结束；Ctrl+Z 撤刚放的点。`);
      draw();
      return;
    }
    if (activeMode === 'scope') {
      // 2026-11-15 用户拍板：设计范围只画矩形——按住拖框，松手成框。
      if (!hit) return;
      scopeDragRef.current = { startPt: hit.pt };
      downPxRef.current = hit.px;
      pointerConsumedRef.current = true;
      setEditMessage('拖出一个矩形作为设计范围，松手生效；Shift = 正方形，Esc 取消。');
      return;
    }
    // 2026-11-16 用户「场地右上角也加一个小锁」：这枚锁先吃掉自己那一小块，
    // 浏览 / 选择 / 编辑边界三种模式都认——锁着时也能从画布上直接解开。
    if (hit) {
      const boundaryLockRect = boundaryLockRectAt();
      if (
        boundaryLockRect
        && hitScopeLockButton(boundaryLockRect, hit.px)
        && (activeMode === 'view' || activeMode === 'select' || activeMode === 'boundary-vertex')
      ) {
        pointerConsumedRef.current = true;
        downPxRef.current = hit.px;
        toggleBoundaryLock();
        return;
      }
    }
    // 2026-11-15 用户反馈「范围点不了」：画了四个角手柄就得更它们能拖。
    // 只认角点、只在浏览/选择模式，优先级排在内容命中之后、平移之前。
    if (hit && (activeMode === 'view' || activeMode === 'select')) {
      // 2026-11-15：框右上外侧的锁优先吃掉自己那一小块（否则会落到平移里）。
      const lockRect = scopeLockRectAt();
      if (lockRect && hitScopeLockButton(lockRect, hit.px)) {
        pointerConsumedRef.current = true;
        downPxRef.current = hit.px;
        toggleScopeLock();
        return;
      }
      if (!scopeLockedRef.current) {
        const cornerIndex = scopeCornerIndexAt(hit.px);
        if (cornerIndex !== null) {
          const ring = planRef.current.designScope ?? [];
          const fixed = ring[(cornerIndex + 2) % 4]!;
          scopeResizeRef.current = { fixed: { x: fixed.x, y: fixed.y } };
          downPxRef.current = hit.px;
          pointerConsumedRef.current = true;
          setEditMessage('拖角点调整设计范围（仍是轴对齐矩形）；Esc 取消。');
          return;
        }
        // 2026-11-15：角之外还有四条边——按住一条边只改这个方向，对边钉住不动。
        const edge = scopeEdgeAt(hit.px);
        if (edge !== null) {
          const ring = planRef.current.designScope ?? [];
          scopeEdgeResizeRef.current = { edge, ring: ring.map(point => ({ x: point.x, y: point.y })) };
          scopeEdgeHoverRef.current = edge;
          setScopeEdgeHover(edge);
          downPxRef.current = hit.px;
          pointerConsumedRef.current = true;
          setEditMessage(
            `拖动「设计范围${scopeEdgeLabel(edge)}边」调整范围（只改这个方向，对边不动）；Esc 取消。`,
          );
          return;
        }
      }
    }
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
            dragZoneVertexRef.current = { zoneId: zone.id, index, startPx: { x: hit.px.x, y: hit.px.y } };
            zoneDragPreviewRef.current = { zoneId: zone.id, polygon: zone.polygon };
            downPxRef.current = hit.px;
            setDragging(true);
            return;
          }
          // 2026-11-15 用户指令：点选中分区的边中段 → 就地插一个顶点，并直接进入拖动（松手才定形）。
          // 顺序：顶点手柄 > 边中段插点 > 分区体平移，三者命中半径从紧到松。
          const edgeHit = nearestRingEdge(zone.polygon, hit.px, currentViewport());
          if (edgeHit && edgeHit.distPx <= 9) {
            const inserted = insertRingVertex(
              zone.polygon,
              edgeHit.index,
              snapPointToGrid(edgeHit.point, currentViewport()),
              { minAreaM2: PLAN_MIN_ZONE_AREA_M2, label: `分区「${zone.name}」` },
            );
            if (!inserted.ok) {
              setEditMessage(inserted.issue.message);
              return;
            }
            const nextZones = planRef.current.zones.map(item =>
              item.id === zone.id ? { ...item, polygon: inserted.value } : item,
            );
            commitPlan({ ...planRef.current, zones: nextZones });
            zoneEdgeHintRef.current = null;
            justInsertedZoneVertexRef.current = true;
            dragZoneVertexRef.current = { zoneId: zone.id, index: edgeHit.index + 1, startPx: { x: hit.px.x, y: hit.px.y } };
            zoneDragPreviewRef.current = { zoneId: zone.id, polygon: inserted.value };
            downPxRef.current = hit.px;
            pointerConsumedRef.current = true;
            setDragging(true);
            setEditMessage('已在边上插入顶点，继续拖动调整；松手生效。');
            draw();
            return;
          }
          // 2026-11-14：按住分区体整体拖动（顶点优先，仍不命中才落这里）。
          if (planPointInRing(hit.pt, zone.polygon)) {
            pointerConsumedRef.current = true;
            dragZoneMoveRef.current = { zoneId: zone.id, startPt: hit.pt, base: zone.polygon, moved: false };
            zoneDragPreviewRef.current = { zoneId: zone.id, polygon: zone.polygon };
            downPxRef.current = hit.px;
            setDragging(true);
            return;
          }
        }
      }
      // 2026-11-16 用户「类似分区，把添加/删除/临近合并补上」：没锁时浏览模式按住边界顶点就能拖，
      // 拖到另一个顶点上松手即合并；双击顶点删、双击边加点（handleStageDoubleClick 里同一套）。
      if (hit && onPlanChange && !layerLocked('boundary')) {
        // 按到别处（或别的顶点）就把琥珀框熄灭：“待删”只对刚点的那一个成立。
        if (boundaryDeleteArmedRef.current !== null
          && nearestBoundaryVertexIndex(hit.px) !== boundaryDeleteArmedRef.current) {
          clearBoundaryDeleteArm();
        }
        // 先认边线上的「+」把手（比综的边线更好点中），点一下就插点并直接进入拖动。
        const edgeHint = boundaryEdgeHintRef.current;
        if (edgeHint && Math.hypot(hit.px.x - edgeHint.x, hit.px.y - edgeHint.y) <= 12) {
          const inserted = insertRingVertex(planRef.current.boundary, edgeHint.index, edgeHint.pt);
          if (!inserted.ok) {
            setEditMessage(inserted.issue.message);
            return;
          }
          const insertedCheck = checkBoundaryRing(inserted.value);
          if (!insertedCheck.ok) {
            setEditMessage(insertedCheck.issue.message);
            return;
          }
          setPreviewRing(inserted.value);
          dragVertexRef.current = edgeHint.index + 1;
          boundaryJustInsertedRef.current = true;
          boundaryInsertedAtRef.current = performance.now();
          pointerConsumedRef.current = true;
          downPxRef.current = hit.px;
          setEditMessage('已在边上插入顶点，继续拖动调整；双击顶点即可删除。');
          draw();
          return;
        }
        const boundaryVertex = nearestBoundaryVertexIndex(hit.px);
        if (boundaryVertex !== null) {
          dragVertexRef.current = boundaryVertex;
          downPxRef.current = hit.px;
          pointerConsumedRef.current = true;
          setPreviewRing(planRef.current.boundary);
          setEditMessage('拖动红线顶点改形；拖到另一个顶点上松手即合并，双击顶点可删除。');
          draw();
          return;
        }
      }
      // 2026-11-16：锁着时点边界不能“默不作声”——告知解锁入口。
      if (hit && layerLocked('boundary')) {
        const lockedEdge = nearestRingEdge(planRef.current.boundary, hit.px, currentViewport());
        if (lockedEdge && lockedEdge.distPx <= VERTEX_EDGE_HIT_PX) {
          setEditMessage('用地红线已锁定：点右上角那枚锁解锁后，就能拖顶点、双击边线加点。');
        }
      }
      // 2026-11-14：选中流线后按住顶点即改形（Agent 生成物可编辑；优先于节点拖动）。
      // 2026-11-15 用户指令：同一条交互里补上「点线上加点」——命中顺序与分区一致。
      if (hit && onPlanChange && !layerLocked('route')) {
        const routeId = selectedRouteRef.current;
        const route = routeId ? planRef.current.routes.find(r => r.id === routeId) ?? null : null;
        if (route && beginRouteVertexEdit(route, hit)) return;
      }
      // 2026-11-16 用户：「场地上的测量和面积画完了就不会动」——浏览模式按住测量本体就能拖动移位。
      if (hit && onPlanChange && !layerLocked('measure')) {
        const measurement = measurementAt(hit.px);
        if (measurement && beginMeasurementDrag(measurement, hit)) return;
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
      // 2026-11-14 用户指令「生成的任何东西都要可以编辑」：浏览模式按住人员点位即拖动。
      if (hit && !layerLocked('worker')) {
        const workerId = nearestWorkerIdAt(hit.px);
        if (workerId) {
          pointerConsumedRef.current = true;
          dragWorkerRef.current = { id: workerId, moved: false };
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
      // 2026-11-16 测量与实体同权：选择模式下按住测量本体即可拖动移位（与浏览模式同一套）。
      if (onPlanChange && !layerLocked('measure')) {
        const measurement = measurementAt(hit.px);
        if (measurement && beginMeasurementDrag(measurement, hit)) return;
      }
      // 2026-11-14：选中流线的 polyline 控制点抓取（跨模式，与浏览模式同一套）。
      // 2026-11-15：同样补上点线加点（与浏览模式完全同一套命中顺序）。
      if (onPlanChange && !layerLocked('route')) {
        const routeId = selectedRouteRef.current;
        const route = routeId ? planRef.current.routes.find(r => r.id === routeId) ?? null : null;
        if (route && beginRouteVertexEdit(route, hit)) return;
      }
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
      // 2026-11-16 用户：「场地和区域是一样的，也有加节点、减节点、挪节点」+「给场地加把锁」。
      // 先看锁：默认锁着，解锁后才有手柄、能加点/减点。
      if (layerLocked('boundary')) {
        setEditMessage('用地红线已锁定：在左侧「用地红线」行点锁图标解锁后就能加/减/挪顶点。');
        return;
      }
      const vertex = nearestBoundaryVertexIndex(hit.px);
      if (vertex !== null) {
        dragVertexRef.current = vertex;
        return;
      }
      // 点在边界线上 → 直接加点（与分区同一手感），并立即进入拖动。
      const viewport = currentViewport();
      const edge = nearestRingEdge(planRef.current.boundary, hit.px, viewport);
      if (!edge || edge.distPx > VERTEX_EDGE_HIT_PX) {
        dragVertexRef.current = null;
        return;
      }
      const inserted = insertRingVertex(planRef.current.boundary, edge.index, snapPointToGrid(edge.point, viewport));
      if (!inserted.ok) {
        setEditMessage(inserted.issue.message);
        return;
      }
      const check = checkBoundaryRing(inserted.value);
      if (!check.ok) {
        setEditMessage(check.issue.message);
        return;
      }
      setPreviewRing(inserted.value);
      dragVertexRef.current = edge.index + 1;
      boundaryJustInsertedRef.current = true;
      boundaryInsertedAtRef.current = performance.now();
      setEditMessage('已在红线上插入顶点，继续拖动调整；松手生效（点一下顶点即可删掉它）。');
      draw();
    }
  }

  function handleStageMouseMove(event: React.MouseEvent) {
    // 2026-11-16 用户「按住 Alt 在原来的点上添加线」：Alt 按着时，鼠标下的已有点亮一枚「+」，
    // 告诉你“从这里能长一条新线”；没锚点就什么都不画。
    if (altHeldRef.current) {
      const mode = modeRef.current;
      const editable = onPlanChange && (mode === 'view' || mode === 'select');
      const probe = editable ? eventPlanPoint(event) : null;
      const anchor = probe
        ? findRouteBranchAnchor(planRef.current, probe.px, currentViewport(), { nodeRadiusPx: NODE_HIT_PX + 4 })
        : null;
      const anchorPx = anchor ? planPointToPixel(anchor.point, currentViewport()) : null;
      const intent = anchor ? branchIntentFor(anchor) : null;
      const nextHint = anchor && anchorPx
        ? { x: anchorPx.x, y: anchorPx.y, label: anchor.label, point: anchor.point, ...(anchor.nodeId ? { nodeId: anchor.nodeId } : {}) }
        : null;
      const prevHint = branchAnchorHintRef.current;
      const changed = (nextHint?.label ?? null) !== (prevHint?.label ?? null)
        || Math.abs((nextHint?.x ?? 0) - (prevHint?.x ?? 0)) > 0.5
        || Math.abs((nextHint?.y ?? 0) - (prevHint?.y ?? 0)) > 0.5;
      if (changed) {
        branchAnchorHintRef.current = nextHint;
        setBranchAnchorHint(nextHint ? { x: nextHint.x, y: nextHint.y, label: nextHint.label } : null);
        if (nextHint && intent) {
          // 提示里先说清楚“会是什么类型、是续接还是新线”——避免画出来才发现变回人行道。
          const kindLabel = planRouteKindLabels[intent.kind];
          setEditMessage(intent.extendAt
            ? `松开 Alt 点这里就接着「${nextHint.label}」${intent.extendAt === 'start' ? '起点' : '终点'}继续画${kindLabel}线（同一条，不新建）。`
            : `松开 Alt 点这里就从「${nextHint.label}」分叉一条${kindLabel}新动线（类型/颜色跟原线一致）。`);
        }
        draw();
      }
    }
    // 2026-11-14：流线顶点拖拽预览跨模式（polyline 控制点，模式切换不打断编辑）。
    // 2026-11-15 用户指令「挪动合并点」：拖到相邻折点 12 px 内就吸过去（预览少一个点），拉远自动恢复。
    if (dragRouteVertexRef.current) {
      const hit = eventPlanPoint(event);
      if (!hit) return;
      const drag = dragRouteVertexRef.current;
      const viewport = currentViewport();
      const route = planRef.current.routes.find(r => r.id === drag.routeId) ?? null;
      if (!route) return;
      // 已经吸住时预览里已经没有这个点了，基准回到已提交的点列，才能再拉出来。
      const base = (routeVertexSnapRef.current !== null ? null : routeDragPreviewRef.current?.points) ?? route.points;
      const mergeTarget = base.length > 2 ? nearestMergeTarget(base, drag.index, hit.px, viewport, 12) : null;
      if (mergeTarget !== null) {
        const merged = removeRouteVertex({ ...route, points: base }, drag.index);
        if (merged.ok) {
          // 并点后的整条动线存进会话（端点被删时 removeRouteVertex 已解绑节点引用，提交要用它）。
          drag.merged = merged.value;
          routeDragPreviewRef.current = { routeId: drag.routeId, points: merged.value.points };
          routeVertexSnapRef.current = {
            routeId: drag.routeId,
            index: mergeTarget > drag.index ? mergeTarget - 1 : mergeTarget,
          };
          setEditMessage('够近了：松手就把这个折点并到相邻折点上。');
          draw();
          return;
        }
      }
      if (routeVertexSnapRef.current !== null) {
        routeVertexSnapRef.current = null;
        drag.merged = null;
        draw();
      }
      const moved = moveRouteVertex({ ...route, points: base }, drag.index, snapPointToGrid(hit.pt, viewport));
      if (moved.ok) {
        routeDragPreviewRef.current = { routeId: drag.routeId, points: moved.value.points };
        setEditMessage(null);
        draw();
      } else {
        setEditMessage(moved.issue.message);
      }
      return;
    }
    const activeMode = modeRef.current;
    // 2026-11-15 设计范围拖框：必须在顶层拦（放在 view 分支里的话 scope 模式根本走不到，
    // 表现就是「拖了没反应、松手又提示范围太小」）。
    if (activeMode === 'scope' && scopeDragRef.current) {
      const hit = eventPlanPoint(event);
      if (!hit) return;
      const start = scopeDragRef.current.startPt;
      const current = snapPointToGrid(hit.pt, currentViewport());
      setDraft(event.shiftKey ? measureRectPoints(start, current, true) : rectRing(start, current));
      setEditMessage(null);
      return;
    }
    if (scopeResizeRef.current) {
      const hit = eventPlanPoint(event);
      if (!hit) return;
      setDraft(rectRing(scopeResizeRef.current.fixed, snapPointToGrid(hit.pt, currentViewport())));
      setEditMessage(null);
      return;
    }
    // 2026-11-15：拖边——只改一个方向（北/南动 y，东/西动 x），对边与另两个坐标不动。
    if (scopeEdgeResizeRef.current) {
      const hit = eventPlanPoint(event);
      if (!hit) return;
      const drag = scopeEdgeResizeRef.current;
      const snapped = snapPointToGrid(hit.pt, currentViewport());
      const coordinate = scopeEdgeIsHorizontal(drag.edge) ? snapped.y : snapped.x;
      const next = resizeScopeEdge(drag.ring, drag.edge, coordinate);
      if (next) setDraft(next);
      setEditMessage(null);
      return;
    }
    // 2026-11-15 用户指令：范围的边也能拖——悬停到边就给方向光标（画面上不加线，靠光标提示）。
    // 锁定钮单独给 pointer；锁上后整条边不再给 ↕/↔（光标就是「现在改不了」的提示）。
    if (!dragging) {
      const hoverHit = eventPlanPoint(event);
      const hoverLockRect = hoverHit ? scopeLockRectAt() : null;
      const hoverLock = Boolean(hoverHit && hoverLockRect && hitScopeLockButton(hoverLockRect, hoverHit.px));
      if (hoverLock !== scopeLockHoverRef.current) {
        scopeLockHoverRef.current = hoverLock;
        setScopeLockHover(hoverLock);
      }
      // 2026-11-16：场地边界那枚锁同样给 pointer（两种锁互不叠，各自只认自己那一小块）。
      const hoverBoundaryLockRect = hoverHit ? boundaryLockRectAt() : null;
      const hoverBoundaryLock = Boolean(
        hoverHit && hoverBoundaryLockRect && hitScopeLockButton(hoverBoundaryLockRect, hoverHit.px),
      );
      if (hoverBoundaryLock !== boundaryLockHoverRef.current) {
        boundaryLockHoverRef.current = hoverBoundaryLock;
        setBoundaryLockHover(hoverBoundaryLock);
      }
      const canResize = (activeMode === 'view' || activeMode === 'select') && onPlanChange && !scopeLockedRef.current;
      const hoverEdge = canResize && hoverHit && !hoverLock ? scopeEdgeAt(hoverHit.px) : null;
      if (hoverEdge !== scopeEdgeHoverRef.current) {
        scopeEdgeHoverRef.current = hoverEdge;
        setScopeEdgeHover(hoverEdge);
      }
    }
    // 2026-11-15：悬停在选中分区的边中段 → 维护「加点」手柄；
    // 悬停在已有顶点 → 那一点高亮成「可删」样式（点一下就删）。变了才重绘，不多刷帧。
    if ((activeMode === 'view' || activeMode === 'select') && !dragging && onPlanChange && !layerLocked('zone')) {
      const hoverHit = eventPlanPoint(event);
      const hoverZoneId = selectedZoneRef.current;
      const hoverZone = hoverZoneId ? planRef.current.zones.find(z => z.id === hoverZoneId) ?? null : null;
      const vertexIndex = hoverHit && hoverZone ? nearestZoneVertexIndex(hoverZone, hoverHit.px) : null;
      // 顶点优先：已经在顶点上就不再提示加点，不然两个手柄叠在一起。
      const edge =
        hoverHit && hoverZone && vertexIndex === null
          ? nearestRingEdge(hoverZone.polygon, hoverHit.px, currentViewport())
          : null;
      const hint =
        hoverZone && edge && edge.distPx <= 9
          ? { zoneId: hoverZone.id, point: edge.point, index: edge.index }
          : null;
      const nextVertex = hoverZone && vertexIndex !== null ? { zoneId: hoverZone.id, index: vertexIndex } : null;
      const prev = zoneEdgeHintRef.current;
      const prevVertex = zoneVertexHoverRef.current;
      const hintChanged =
        (prev === null) !== (hint === null) ||
        (prev !== null &&
          hint !== null &&
          (prev.index !== hint.index ||
            Math.hypot(prev.point.x - hint.point.x, prev.point.y - hint.point.y) > 0.05));
      const vertexChanged =
        (prevVertex === null) !== (nextVertex === null) ||
        (prevVertex !== null && nextVertex !== null && (prevVertex.index !== nextVertex.index || prevVertex.zoneId !== nextVertex.zoneId));
      if (hintChanged) zoneEdgeHintRef.current = hint;
      if (vertexChanged) zoneVertexHoverRef.current = nextVertex;
      if (hintChanged || vertexChanged) draw();
    }
    // 2026-11-15 用户指令「路线和分区一样」：流线用同一套悬停提示（可加点 / 可删点）。
    if ((activeMode === 'view' || activeMode === 'select') && !dragging && onPlanChange && !layerLocked('route')) {
      const hoverHit = eventPlanPoint(event);
      const hoverRouteId = selectedRouteRef.current;
      const hoverRoute = hoverRouteId ? planRef.current.routes.find(r => r.id === hoverRouteId) ?? null : null;
      const routeVertexIndex = hoverHit && hoverRoute ? nearestRouteVertexIndex(hoverRoute, hoverHit.px) : null;
      const routeEdge =
        hoverHit && hoverRoute && routeVertexIndex === null
          ? nearestPolylineEdge(hoverRoute.points, hoverHit.px, currentViewport())
          : null;
      const routeHint =
        hoverRoute && routeEdge && routeEdge.distPx <= 9
          ? { routeId: hoverRoute.id, point: routeEdge.point, index: routeEdge.index }
          : null;
      const nextRouteVertex = hoverRoute && routeVertexIndex !== null
        ? { routeId: hoverRoute.id, index: routeVertexIndex }
        : null;
      const prevHint = routeEdgeHintRef.current;
      const prevVertex = routeVertexHoverRef.current;
      const routeHintChanged =
        (prevHint === null) !== (routeHint === null) ||
        (prevHint !== null &&
          routeHint !== null &&
          (prevHint.index !== routeHint.index ||
            Math.hypot(prevHint.point.x - routeHint.point.x, prevHint.point.y - routeHint.point.y) > 0.05));
      const routeVertexChanged =
        (prevVertex === null) !== (nextRouteVertex === null) ||
        (prevVertex !== null && nextRouteVertex !== null &&
          (prevVertex.index !== nextRouteVertex.index || prevVertex.routeId !== nextRouteVertex.routeId));
      if (routeHintChanged) routeEdgeHintRef.current = routeHint;
      if (routeVertexChanged) routeVertexHoverRef.current = nextRouteVertex;
      if (routeHintChanged || routeVertexChanged) draw();
    }
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
      // 2026-11-16 用户「解锁了之后还是无法编辑」：浏览模式下拖边界顶点（大号实心方点）。
      if (dragVertexRef.current !== null) {        const vertexHit = eventPlanPoint(event);
        if (!vertexHit) return;
        const ring = previewRingRef.current ?? planRef.current.boundary;
        const next = snapPointToGrid(vertexHit.pt, currentViewport());
        const anchor = ring[dragVertexRef.current];
        if (!anchor || planPointDistanceM(anchor, next) < 0.01) return;
        const result = moveRingVertex(ring, dragVertexRef.current, next);
        if (result.ok) {
          setPreviewRing(result.value);
          setEditMessage(null);
        } else {
          setEditMessage(result.issue.message);
        }
        return;
      }
      // 2026-11-16 用户「你要补上一些交互提示」：没在拖东西时，把“哪里能拖、哪里能加点”悬停出来。
      // 未锁：顶点→白框高亮 + grab；边线→「+」把手（点即插点）。已锁：光标 not-allowed，点一下告诉你去哪解。
      {
        const hoverHit = eventPlanPoint(event);
        if (onPlanChange && hoverHit) {
          const hoverViewport = currentViewport();
          if (layerLocked('boundary')) {
            if (boundaryVertexHoverRef.current !== null || boundaryEdgeHintRef.current) {
              boundaryVertexHoverRef.current = null;
              boundaryEdgeHintRef.current = null;
              setBoundaryVertexHover(null);
              setBoundaryEdgeHint(null);
              draw();
            }
            const ringEdge = nearestRingEdge(planRef.current.boundary, hoverHit.px, hoverViewport);
            const lockedHover = ringEdge !== null && ringEdge.distPx <= VERTEX_EDGE_HIT_PX;
            if (lockedHover !== boundaryLockedHoverRef.current) {
              boundaryLockedHoverRef.current = lockedHover;
              setBoundaryLockedHover(lockedHover);
            }
          } else {
            if (boundaryLockedHoverRef.current) {
              boundaryLockedHoverRef.current = false;
              setBoundaryLockedHover(false);
            }
            const vertexIndex = nearestBoundaryVertexIndex(hoverHit.px);
            if (vertexIndex !== boundaryVertexHoverRef.current) {
              boundaryVertexHoverRef.current = vertexIndex;
              setBoundaryVertexHover(vertexIndex);
              draw();
            }
            const ringEdge = vertexIndex === null
              ? nearestRingEdge(planRef.current.boundary, hoverHit.px, hoverViewport)
              : null;
            const nextHint = ringEdge && ringEdge.distPx <= VERTEX_EDGE_HIT_PX
              ? (() => {
                const px = planPointToPixel(ringEdge.point, hoverViewport);
                return { x: px.x, y: px.y, index: ringEdge.index, pt: ringEdge.point };
              })()
              : null;
            const prevHint = boundaryEdgeHintRef.current;
            const hintChanged = (nextHint?.index ?? -1) !== (prevHint?.index ?? -1)
              || Math.abs((nextHint?.x ?? 0) - (prevHint?.x ?? 0)) > 0.5
              || Math.abs((nextHint?.y ?? 0) - (prevHint?.y ?? 0)) > 0.5;
            if (hintChanged) {
              boundaryEdgeHintRef.current = nextHint;
              setBoundaryEdgeHint(nextHint ? { x: nextHint.x, y: nextHint.y } : null);
              draw();
            }
          }
        }
      }
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
        const viewport = currentViewport();
        const committed = planRef.current.zones.find(z => z.id === drag.zoneId) ?? null;
        // 已经吸住时预览里已经没这个点了，基准回到已提交的形状，才能再拉出来。
        const base = (zoneVertexSnapRef.current !== null ? null : zoneDragPreviewRef.current?.polygon) ?? committed?.polygon;
        if (!base) return;
        // 2026-11-15 用户指令「靠近最近点就被吞」：拖到另一顶点够近时，预览直接换成
        // 「去掉这个点」的形状——看上去就是被吸进去了；松手按这个形状提交（少一个顶点）。
        // 拉开距离会自动恢复，不会误删。
        const mergeTarget = nearestMergeTarget(base, drag.index, hit.px, viewport, 12);
        if (mergeTarget !== null && committed) {
          const merged = removeRingVertex(committed.polygon, drag.index, {
            minAreaM2: PLAN_MIN_ZONE_AREA_M2,
            label: `分区「${committed.name}」`,
          });
          if (merged.ok) {
            zoneDragPreviewRef.current = { zoneId: drag.zoneId, polygon: merged.value };
            zoneVertexSnapRef.current = {
              zoneId: drag.zoneId,
              index: mergeTarget > drag.index ? mergeTarget - 1 : mergeTarget,
            };
            setEditMessage('够近了：松手就把这个顶点并到相邻顶点上。');
            draw();
            return;
          }
        }
        if (zoneVertexSnapRef.current !== null) {
          zoneVertexSnapRef.current = null;
          draw();
        }
        const stuck = stickPointToBoundary(snapPoint(hit.pt, viewport), planRef.current.boundary, viewport);
        const stickHint = stuck.stuck ? '已贴到用地红线上；沿着红线拖可以调位置。' : null;
        const result = moveRingVertex(
          base,
          drag.index,
          // 2026-11-16 用户：「挪到接近场地边缘老是识别超出场地，能不能直接贴边设计」。
          // 边界当墙：顶点落到场外或贴近边界时直接吸到边界上，不再产生「越界」。
          stuck.point,
        );
        if (result.ok) {
          zoneDragPreviewRef.current = { zoneId: drag.zoneId, polygon: result.value };
          setEditMessage(stickHint);
          draw();
        } else {
          setEditMessage(result.issue.message);
        }
        return;
      }
      // 2026-11-14：分区整体拖动预览（网格吸附，松手提交，越界由 zonePolygonIssue 拒绝）。
      if (dragZoneMoveRef.current) {
        const hit = eventPlanPoint(event);
        if (!hit) return;
        const drag = dragZoneMoveRef.current;
        const down = downPxRef.current;
        if (down && Math.hypot(hit.px.x - down.x, hit.px.y - down.y) > CLICK_MAX_MOVE_PX) {
          drag.moved = true;
        }
        if (drag.moved) {
          const snapped = snapPoint(hit.pt, currentViewport());
          const origin = snapPoint(drag.startPt, currentViewport());
          const translated = drag.base.map(p => ({ x: p.x + (snapped.x - origin.x), y: p.y + (snapped.y - origin.y) }));
          // 2026-11-16：整体拖动也是「撞墙就停」，不让整个分区被推出场地。
          const clamped = clampRingMoveToBoundary(drag.base, translated, planRef.current.boundary);
          const hitWall = clamped.some((p, i) => Math.hypot(p.x - translated[i]!.x, p.y - translated[i]!.y) > 1e-6);
          zoneDragPreviewRef.current = { zoneId: drag.zoneId, polygon: clamped };
          setEditMessage(hitWall ? '已到用地红线，继续拖不会跑到红线外。' : null);
          draw();
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
        // 2026-11-15 用户：「手放的出入口移到流线上时自动吸附在线上，挪开也没问题」。
        // 软吸附：指针离动线 ≤12 px 就吸到线的投影点，拉开自动脱开（不留硬约束）。
        const routeSnap = nearestRouteSnapPoint(hit.px, planRef.current.routes, currentViewport());
        const target = routeSnap ?? hit.pt;
        const result = movePlanNode(node, target, planRef.current.routes);
        if (routeSnap && result.ok) {
          setEditMessage('已吸附到动线上；继续拖动离开即可脱开。');
        }
        if (result.ok) {
          nodeDragPreviewRef.current = result.value;
          setEditMessage(null);
          draw();
        } else {
          setEditMessage(result.issue.message);
        }
        return;
      }
      // 2026-11-14：人员点位拖拽预览（网格吸附，松手提交）。
      if (dragWorkerRef.current) {
        const hit = eventPlanPoint(event);
        if (!hit) return;
        const down = downPxRef.current;
        if (down && Math.hypot(hit.px.x - down.x, hit.px.y - down.y) > CLICK_MAX_MOVE_PX) {
          dragWorkerRef.current.moved = true;
        }
        if (dragWorkerRef.current.moved) {
          const worker = planRef.current.workers.find(w => w.id === dragWorkerRef.current?.id);
          if (!worker) return;
          workerDragPreviewRef.current = { worker: { ...worker, position: snapPoint(hit.pt, currentViewport()) } };
          setEditMessage(null);
          draw();
        }
        return;
      }
      // 2026-11-16 测量拖动预览：整条标注平移（松手才进 plan），读数随几何现算。
      if (dragMeasurementRef.current) {
        const hit = eventPlanPoint(event);
        if (!hit) return;
        const drag = dragMeasurementRef.current;
        const down = downPxRef.current;
        if (down && Math.hypot(hit.px.x - down.x, hit.px.y - down.y) > CLICK_MAX_MOVE_PX) drag.moved = true;
        if (drag.moved) {
          const dx = hit.pt.x - drag.startPt.x;
          const dy = hit.pt.y - drag.startPt.y;
          measurementDragPreviewRef.current = { id: drag.id, points: drag.base.map(p => ({ x: p.x + dx, y: p.y + dy })) };
          setEditMessage(null);
          draw();
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
      const ring = previewRingRef.current ?? planRef.current.boundary;
      const next = snapPoint(hit.pt, currentViewport());
      const anchor = ring[dragVertexRef.current];
      // 2026-11-15 用户反馈「点一下边界就报面积太小」：原地一点不该走形状复验。
      // 没真的挪动（<1 cm，含吸附回原位）就直接返回，不能因为场地小就往外跳报错。
      if (!anchor || planPointDistanceM(anchor, next) < 0.01) return;
      const result = moveRingVertex(ring, dragVertexRef.current, next);
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
      // 2026-11-16 用户指令：门靠近室内区域边线时先吸过去，悬停就给贴边高亮。
      const snap = isDoorTemplateId(facilityTemplateRef.current)
        ? snapDoorToIndoorEdge({ pt: hit.pt, zones: planRef.current.zones, viewport: currentViewport() })
        : null;
      const nextPoint = snap ? snap.point : hit.pt;
      const snapChanged =
        (doorSnapRef.current?.zoneId ?? null) !== (snap?.zoneId ?? null) ||
        (snap !== null && (Math.abs(doorSnapRef.current!.point.x - snap.point.x) > 1e-9 || Math.abs(doorSnapRef.current!.point.y - snap.point.y) > 1e-9));
      doorSnapRef.current = snap;
      const ghost = ghostPointRef.current;
      if (snapChanged || !ghost || ghost.x !== nextPoint.x || ghost.y !== nextPoint.y) {
        ghostPointRef.current = nextPoint;
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
    // 2026-11-11 拖拽式测量（距离拉线 / 面积矩形）；2026-11-17 路径手绘随路径入口一起下线。
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
    // 2026-11-16 Alt 分叉期间，松手不能落进“单击选中 / 点折点删点”那几条路径。
    if (event.altKey) {
      downPxRef.current = null;
      return;
    }
    // 2026-11-14：流线顶点拖拽松手跨模式——提交改形（一条 undo）；相邻重复点直接回退。
    // 2026-11-15 用户指令「减点」：点一下折点（没拖）= 删掉它，两侧自动相连；并点松手即少一个点。
    const routeDrag = dragRouteVertexRef.current;
    if (routeDrag) {
      dragRouteVertexRef.current = null;
      const preview = routeDragPreviewRef.current;
      routeDragPreviewRef.current = null;
      const upHit = eventPlanPoint(event);
      const down = downPxRef.current;
      const clickOnly =
        upHit !== null && down !== null
          ? Math.hypot(upHit.px.x - down.x, upHit.px.y - down.y) < 4
          : false;
      if (clickOnly && !justInsertedRouteVertexRef.current && onPlanChange) {
        const current = planRef.current;
        const route = current.routes.find(r => r.id === routeDrag.routeId);
        if (route) {
          const removed = removeRouteVertex(route, routeDrag.index);
          if (!removed.ok) {
            setEditMessage(removed.issue.message);
          } else {
            const removeBase: SitePlanData = {
              ...current,
              routes: current.routes.map(r => (r.id === route.id ? removed.value : r)),
            };
            // 删点可能把“进界”那一段拉长，交界处的出入口跟着补上。
            commitPlan(planWithCrossingNodes(removeBase, removed.value).plan);
            selectRoute(route.id);
            setEditMessage(`已删除这个折点，两侧折点已相连（剩 ${removed.value.points.length} 个）；撤销可找回。`);
          }
          routeVertexHoverRef.current = null;
          draw();
          return;
        }
      }
      justInsertedRouteVertexRef.current = false;
      if (preview && onPlanChange) {
        const current = planRef.current;
        const route = current.routes.find(r => r.id === preview.routeId);
        if (route) {
          const mergedNow = routeVertexSnapRef.current !== null;
          routeVertexSnapRef.current = null;
          const issue = routeVertexEditIssue(preview.points);
          if (issue) {
            setEditMessage(issue.message);
          } else {
            // 并点提交并点结果（含端点引用解绑）；普通拖点只改坐标。
            const nextRoute: PlanRoute = routeDrag.merged && routeDrag.merged.points.length === preview.points.length
              ? { ...routeDrag.merged, id: route.id }
              : { ...route, points: preview.points };
            const dragBase: SitePlanData = {
              ...current,
              routes: current.routes.map(r => (r.id === route.id ? nextRoute : r)),
            };
            // 2026-11-15：拖点把线拖进场/拖出场后，交界处自动补出入口（已有节点 0.5 m 内不重复建）。
            const dragged = planWithCrossingNodes(dragBase, nextRoute);
            commitPlan(dragged.plan);
            selectRoute(route.id);
            const crossingHint = dragged.added.length > 0
              ? `；交界处已自动加${dragged.added.map(node => `「${node.name}」（${nodeKindLabel(node.kind)}）`).join('、')}`
              : '';
            setEditMessage(
              mergedNow
                ? `已把这个折点并到相邻折点上（剩 ${preview.points.length} 个）${crossingHint}；撤销可找回。`
                : `「${route.name}」路线已更新（${preview.points.length} 个折点）${crossingHint}。`,
            );
          }
          draw();
        }
      }
      return;
    }
    const activeMode = modeRef.current;
    if (activeMode === 'scope') {
      if (!scopeDragRef.current) return;
      scopeDragRef.current = null;
      downPxRef.current = null;
      const ring = draftRef.current;
      setDraft([]);
      if (!onPlanChange) return;
      if (!rectBigEnough(ring)) {
        setEditMessage('范围太小了：按住鼠标拖出一个矩形（最短边 2 m）。');
        draw();
        return;
      }
      const area = scopeAreaM2(ring);
      const previousScopePlan = planRef.current;
      const nextScopePlan: SitePlanData = { ...previousScopePlan, designScope: ring.map(point => ({ x: point.x, y: point.y })) };
      commitPlan(nextScopePlan);
      setMode('view');
      const dragOverflow = reviewZonesAfterBoundsChange(nextScopePlan, previousScopePlan);
      setEditMessage(`设计范围已设为矩形（约 ${Math.round(area)} m²），框外压暗。${overflowSuffix(dragOverflow)}`);
      draw();
      return;
    }
    if (scopeResizeRef.current || scopeEdgeResizeRef.current) {
      const resizedEdge = scopeEdgeResizeRef.current?.edge ?? null;
      scopeResizeRef.current = null;
      scopeEdgeResizeRef.current = null;
      downPxRef.current = null;
      const ring = draftRef.current;
      setDraft([]);
      if (!onPlanChange) return;
      // 按下就松（没拖）：什么也不改，也不用报「太小」——那只是点了一下角/边。
      if (ring.length !== 4) {
        draw();
        return;
      }
      if (!rectBigEnough(ring)) {
        setEditMessage('范围太小了（最短边 2 m），本次调整已取消。');
        draw();
        return;
      }
      const previousResizePlan = planRef.current;
      const nextResizePlan: SitePlanData = { ...previousResizePlan, designScope: ring.map(point => ({ x: point.x, y: point.y })) };
      commitPlan(nextResizePlan);
      const resizeOverflow = reviewZonesAfterBoundsChange(nextResizePlan, previousResizePlan);
      setEditMessage(
        resizedEdge
          ? `设计范围${scopeEdgeLabel(resizedEdge)}边已移到新位置（约 ${Math.round(scopeAreaM2(ring))} m²），对边与另外两个方向没动。${overflowSuffix(resizeOverflow)}`
          : `设计范围已调整为矩形（约 ${Math.round(scopeAreaM2(ring))} m²）。${overflowSuffix(resizeOverflow)}`,
      );
      draw();
      return;
    }
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
            facilities: planRef.current.facilities.map(f => {
              if (!previewIds.has(f.id)) return f;
              const moved = groupDrag.preview!.find(p => p.id === f.id) ?? f;
              // 整组移动也逐件重算归属：可能一部分搬出了原分区。
              return { ...moved, zoneId: inferZoneIdAt(moved.position, planRef.current.zones) };
            }),
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
        if (!onPlanChange) return;
        const viewportNow = currentViewport();
        // 2026-11-16 bearing：屏幕矩形在旋转平面系是斜矩形，AABB 命中会多选——
        // bearing≠0 改走屏幕系（投影自带旋转）；bearing=0 原平面系路径逐字节不变。
        const rotatedHit = Boolean(viewportNow.bearing);
        const rect = marqueePlanRect(marquee, viewportNow);
        const hits = layerLocked('facility')
          ? []
          : viewPlan().facilities.filter(f => (rotatedHit ? facilityInScreenRect(f, marquee, viewportNow) : facilityInRect(f, rect)));
        // 2026-11-14 用户指令「框住多少选多少」：流线（段与矩形相交）与出入口（点在矩形内）一并入多选。
        const routeIds = layerLocked('route')
          ? []
          : viewPlan().routes.filter(r => (rotatedHit ? routeLengthInScreenRect(r.points, marquee, viewportNow) : routeLengthInRect(r.points, rect)) > 0).map(r => r.id);
        const nodeInRect = (p: PlanPoint) => {
          if (!rotatedHit) return p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY;
          const sp = planPointToPixel(p, viewportNow);
          const srect = marqueeScreenRect(marquee);
          return sp.x >= srect.minX && sp.x <= srect.maxX && sp.y >= srect.minY && sp.y <= srect.maxY;
        };
        const nodeIds = layerLocked('node')
          ? []
          : viewPlan().nodes.filter(n => nodeInRect(n.position)).map(n => n.id);
        // shift+框选 = 与现有组选取并集（OnePlan 同语义）；无 shift = 替换。
        const base = event.shiftKey ? multiSelectedFacilityIdsRef.current : [];
        const merged = Array.from(new Set([...base, ...hits.map(f => f.id)]));
        if (merged.length === 1 && !routeIds.length && !nodeIds.length) {
          clearMultiSelection(false);
          selectFacility(merged[0]!);
          setInfoTab('inventory');
        } else if (merged.length > 1 || routeIds.length || nodeIds.length) {
          clearMultiSelection(false);
          if (merged.length) {
            multiSelectedFacilityIdsRef.current = merged;
            setMultiSelectedFacilityIds(merged);
          } else {
            selectedFacilityRef.current = null;
            setSelectedFacilityId(null);
          }
          multiSelectedRouteIdsRef.current = routeIds;
          setMultiSelectedRouteIds(routeIds);
          multiSelectedNodeIdsRef.current = nodeIds;
          setMultiSelectedNodeIds(nodeIds);
          selectZone(null);
          selectAnnotation(null);
          setInfoTab('inventory');
          setEditMessage(`已框选：设施 ${merged.length} · 流线 ${routeIds.length} · 出入口 ${nodeIds.length}。Delete 批量删除。`);
        } else {
          clearMultiSelection(false);
          selectFacility(null);
          selectZone(null);
          selectRoute(null);
          selectNode(null);
          selectWorker(null);
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
            // 2026-11-14 用户反馈「分区/流线点不了」：选择模式此前只认设施，点分区/流线落到空白=清空。
            // 选择模式同样可点选流线与分区（改形仍走浏览模式的顶点拖拽）。
            const hitRoute = hit && !layerLocked('route') ? nearestRouteIdAt(hit.px) : null;
            if (hitRoute) {
              const route = viewPlan().routes.find(r => r.id === hitRoute);
              clearMultiSelection(false);
              selectFacility(null);
              selectZone(null);
              selectAnnotation(null);
              selectRoute(hitRoute);
              setInfoTab('inventory');
              setEditMessage(`已选中流线「${route?.name ?? ''}」：Esc 回浏览模式可拖顶点改走向。`);
              return;
            }
            const hitZone = hit && !layerLocked('zone')
              ? [...viewPlan().zones].reverse().find(z => planPointInRing(hit.pt, z.polygon))
              : null;
            if (hitZone) {
              clearMultiSelection(false);
              selectFacility(null);
              selectAnnotation(null);
              selectZone(hitZone.id);
              setInfoTab('inventory');
              setEditMessage(`已选中分区「${hitZone.name}」：Esc 回浏览模式可拖顶点改形。`);
              return;
            }
            clearMultiSelection(false);
            selectFacility(null);
            selectZone(null);
            selectRoute(null);
            selectNode(null);
            selectWorker(null);
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
      // 2026-11-16：浏览模式拖边界顶点松手——提交新形；落在别的顶点 12 px 内 = 合并。
      // 单击（没拖）不删点（双击才删），避免手一抖把场地少了只角。
      if (dragVertexRef.current !== null) {
        const vertexIndex = dragVertexRef.current;
        dragVertexRef.current = null;
        const preview = previewRingRef.current;
        setPreviewRing(null);
        if (preview && onPlanChange && vertexIndex < preview.length) {
          const viewport = currentViewport();
          const originPx = planPointToPixel(preview[vertexIndex]!, viewport);
          // 2026-11-16 用户：「没点到那个点，双击线也出现红框」——那是刚用「+」插进来的新顶点，
          // 不算“点了一下它”，不该变红。
          const justInserted = performance.now() - boundaryInsertedAtRef.current < BOUNDARY_INSERT_GRACE_MS;
          // 只点不拖 = 白框描边转琥珀（预告再点一下会删），这一下不提交任何改动。
          if (!justInserted && down && Math.hypot(down.x - originPx.x, down.y - originPx.y) <= CLICK_MAX_MOVE_PX) {
            armBoundaryVertexDelete(vertexIndex);
            setEditMessage('再点一下这个顶点就会删掉它（琥珀框 = 待删除）；拖动则改形。');
            return;
          }
          const movedPx = planPointToPixel(preview[vertexIndex]!, viewport);
          const mergeIndex = preview.findIndex((p, i) => i !== vertexIndex
            && Math.hypot(planPointToPixel(p, viewport).x - movedPx.x, planPointToPixel(p, viewport).y - movedPx.y) <= 12);
          const nextRing = mergeIndex === -1 ? preview : preview.filter((_, i) => i !== vertexIndex);
          if (nextRing.length >= 3) {
            const check = checkBoundaryRing(nextRing);
            if (!check.ok) {
              setEditMessage(check.issue.message);
              return;
            }
            // 刚插完点又松开（没拖）：形状早已提交过，这里不再压一条空 undo。
            const unchanged = nextRing.length === planRef.current.boundary.length
              && nextRing.every((p, i) => planPointDistanceM(p, planRef.current.boundary[i]!) < 0.01);
            if (unchanged) {
              setEditMessage('红线顶点未移动（拖动可改形）。');
              return;
            }
            // 2026-11-17 用户拍板：拖拽后仍在白框里不动框；顶出去重置为外扩 20 m。
            const scope = syncScopeForBoundary(planRef.current.designScope, nextRing, DEFAULT_SCOPE_MARGIN_M);
            commitPlan({ ...planRef.current, boundary: nextRing, ...(scope ? { designScope: scope } : {}) });
            clearBoundaryDeleteArm();
            setEditMessage(mergeIndex === -1
              ? `红线顶点已更新。${scope ? '红线顶出白框，设计范围已随红线外扩 20 m 重置。' : ''}`
              : '两个顶点已合并（撤销可找回）。');
          }
        }
        return;
      }
      // P2-i：设施拖拽松手——确实拖动过 → 提交预览（移动/旋转/改尺寸一条 undo）；
      // 没拖动则当单击，继续走下面的既有选中顺序。
      const facilityDrag = facilityDragRef.current;
      if (facilityDrag) {
        facilityDragRef.current = null;
        if (facilityDrag.moved && onPlanChange) {
          const preview = facilityDrag.preview;
          const current = planRef.current;
          // 归属跟着落点走：拖进别的分区就换归属，拖出所有分区变未归属。
          const placed = { ...preview, zoneId: inferZoneIdAt(preview.position, current.zones) };
          commitPlan({ ...current, facilities: current.facilities.map(f => (f.id === preview.id ? placed : f)) });
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
        // 2026-11-15 用户指令：点一下已有顶点（没拖动）= 删掉它，两侧顶点自动连上。
        // 判定用位移阈值：刚才拖过就不算点击，正常提交形状；刚插完点的松手也跳过。
        const upHit = eventPlanPoint(event);
        const moved = upHit !== null
          ? Math.hypot(upHit.px.x - zoneDrag.startPx.x, upHit.px.y - zoneDrag.startPx.y) >= 4
          : true;
        if (!moved && !justInsertedZoneVertexRef.current && onPlanChange) {
          const current = planRef.current;
          const zone = current.zones.find(z => z.id === zoneDrag.zoneId);
          if (zone) {
            const removed = removeRingVertex(zone.polygon, zoneDrag.index, {
              minAreaM2: PLAN_MIN_ZONE_AREA_M2,
              label: `分区「${zone.name}」`,
            });
            if (!removed.ok) {
              setEditMessage(removed.issue.message);
            } else {
              commitPlan({
                ...current,
                zones: current.zones.map(z => (z.id === zone.id ? { ...z, polygon: removed.value } : z)),
              });
              selectZone(zone.id);
              setEditMessage(`已删除顶点，两侧顶点已相连（剩 ${removed.value.length} 个）；撤销可找回。`);
            }
            zoneVertexHoverRef.current = null;
            draw();
            return;
          }
        }
        justInsertedZoneVertexRef.current = false;
        if (preview && onPlanChange) {
          const current = planRef.current;
          const zone = current.zones.find(z => z.id === preview.zoneId);
          if (zone) {
            const mergedNow = zoneVertexSnapRef.current !== null;
            zoneVertexSnapRef.current = null;
            const issue = zonePolygonIssue(zone, preview.polygon, current);
            if (issue) {
              setEditMessage(issue.message);
            } else {
              commitPlan({
                ...current,
                zones: current.zones.map(z => (z.id === zone.id ? { ...z, polygon: preview.polygon } : z)),
              });
              selectZone(zone.id);
              setEditMessage(
                mergedNow
                  ? `已把这个顶点并到相邻顶点上（剩 ${preview.polygon.length} 个）；撤销可找回。`
                  : `「${zone.name}」形状已更新。`,
              );
            }
            draw();
          }
        }
        return;
      }
      // 2026-11-14：分区整体拖动松手——moved 才提交（一条 undo），没拖动留给点选逻辑。
      const zoneMove = dragZoneMoveRef.current;
      if (zoneMove) {
        dragZoneMoveRef.current = null;
        const preview = zoneDragPreviewRef.current;
        zoneDragPreviewRef.current = null;
        if (zoneMove.moved && preview && onPlanChange) {
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
              setEditMessage(`「${zone.name}」已移动。`);
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
      // 2026-11-16 测量拖动松手：moved 才提交（一条 undo），没拖动留给点选。
      const measureMove = dragMeasurementRef.current;
      if (measureMove) {
        const preview = measurementDragPreviewRef.current;
        dragMeasurementRef.current = null;
        measurementDragPreviewRef.current = null;
        if (measureMove.moved && preview && onPlanChange) {
          const current = planRef.current;
          commitPlan({
            ...current,
            measurements: (current.measurements ?? []).map(m => (m.id === measureMove.id ? { ...m, points: preview.points } : m)),
          });
          selectMeasurement(measureMove.id);
          const valueText = measureMove.kind === 'area'
            ? formatAreaM2(measureValue({ kind: measureMove.kind, points: preview.points }))
            : formatLengthM(measureValue({ kind: measureMove.kind, points: preview.points }));
          setEditMessage(`${measureKindLabel(measureMove.kind)}测量已移动 = ${valueText}（原位已释放）。`);
          draw();
          return;
        }
        selectMeasurement(measureMove.id);
        return;
      }
      // 2026-11-14：人员点位拖动松手——moved 才提交（一条 undo），没拖动留给点选逻辑。
      if (dragWorkerRef.current) {
        const drag = dragWorkerRef.current;
        const preview = workerDragPreviewRef.current;
        dragWorkerRef.current = null;
        workerDragPreviewRef.current = null;
        if (drag.moved && preview && onPlanChange) {
          const current = planRef.current;
          commitPlan({
            ...current,
            workers: current.workers.map(w => (w.id === preview.worker.id ? preview.worker : w)),
          });
          selectWorker(preview.worker.id);
          setEditMessage(`「${preview.worker.role}」岗位已移动。`);
          return;
        }
        selectWorker(drag.id);
        return;
      }
      // H2-c/H2-d：浏览模式单击命中即选中（冲突标记 > 节点 > 人员 > 路线 > 设施），空白取消全部选中。
      if (down && onPlanChange) {
        const hit = eventPlanPoint(event);
        if (hit && Math.hypot(hit.px.x - down.x, hit.px.y - down.y) <= CLICK_MAX_MOVE_PX) {
          // H3-b：冲突/缺失标记恒在业务层之上，先于实体命中；点开看这一枚徽章的明细。
          const cluster = nearestConflictClusterAt(hit.px);
          if (cluster) {
            const related = cluster.routeIds[0];
            if (related) selectRoute(related);
            showConflictDetail(cluster.key);
            setEditMessage(
              cluster.count > 1
                ? `该动线有 ${cluster.count} 条问题，已展开明细。`
                : `${PLAN_CONFLICT_CATEGORY_LABELS[cluster.issues[0]!.category]}：${cluster.issues[0]!.message}`,
            );
            setInfoTab('issues');
            return;
          }
          // 点到别处就把明细收起来（下面各分支都是新选择）。
          showConflictDetail(null);
          const hitNode = layerLocked('node') ? null : nearestNodeIdAt(hit.px);
          if (hitNode) { selectNode(hitNode); setInfoTab('inventory'); return; }
          const hitWorker = layerLocked('worker') ? null : nearestWorkerIdAt(hit.px);
          if (hitWorker) { selectWorker(hitWorker); setInfoTab('inventory'); return; }
          // 2026-11-17 #118 补录入 UI：车辆点选（独立集合）。
          const hitVehicle = nearestVehicleIdAt(hit.px);
          if (hitVehicle) { selectVehicle(hitVehicle); setInfoTab('inventory'); return; }
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
          selectRoute(null);
          selectNode(null);
          selectWorker(null);
          selectAnnotation(null);
        }
      }
      return;
    }
    if (activeMode === 'boundary-vertex') {
      // 2026-11-16：与分区一致——点一下顶点（没拖动）= 删掉它；拖过就提交新形状。
      const upHit = eventPlanPoint(event);
      const moved = upHit !== null && downPxRef.current !== null
        ? Math.hypot(upHit.px.x - downPxRef.current.x, upHit.px.y - downPxRef.current.y) >= 4
        : true;
      const insertedNow = boundaryJustInsertedRef.current;
      boundaryJustInsertedRef.current = false;
      const hitIndex = dragVertexRef.current;
      dragVertexRef.current = null;
      if (!moved && !insertedNow && hitIndex !== null) {
        setPreviewRing(null);
        removeBoundaryVertexAt(hitIndex);
        return;
      }
      if (hitIndex !== null && previewRingRef.current && onPlanChange) {
        // 2026-11-17 用户拍板：拖拽后仍在白框里不动框；顶出去重置为外扩 20 m。
        const scope = syncScopeForBoundary(planRef.current.designScope, previewRingRef.current, DEFAULT_SCOPE_MARGIN_M);
        commitPlan({ ...planRef.current, boundary: previewRingRef.current, ...(scope ? { designScope: scope } : {}) });
        setEditMessage(`红线顶点已更新。${scope ? '红线顶出白框，设计范围已随红线外扩 20 m 重置。' : ''}`);
      }
      setPreviewRing(null);
      return;
    }
    // 2026-11-11 拖拽式测量松手：距离拉线 / 面积矩形直接固定（路径手绘已随路径入口下线）；太短的拖拽提示并丢弃。
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

  function handleStageDoubleClick(event: { preventDefault(): void; clientX: number; clientY: number; altKey?: boolean }) {
    // 2026-11-16 用户「Alt 和双击删除的底层逻辑冲突了，很容易误删」：
    // 双击在这一层是“删点 / 边上加一点 / 闭合收点”，与 Alt 分叉抢同一次点击。规则改成：
    //   1) 按着 Alt 的双击永远不删点、不加点、不闭合（只提示）；
    //   2) 刚用 Alt 分叉起的 400 ms 内，浏览/选择态的双击也忽略（两次 Alt 点击不该把起点删掉）。
    if (event.altKey === true) {
      event.preventDefault();
      pointerConsumedRef.current = true;
      setEditMessage('Alt 状态下双击不会删点（避免误删）；要删点请先松开 Alt。');
      return;
    }
    if ((modeRef.current === 'view' || modeRef.current === 'select')
      && performance.now() - branchStartedAtRef.current < BRANCH_DOUBLECLICK_GUARD_MS) {
      event.preventDefault();
      pointerConsumedRef.current = true;
      return;
    }
        // P2-l（用户 m05374）：画区域/边界时双击左键 = 完成绘制（少于 3 点不闭合）。
        // 2026-11-15：圈设计范围沿用同一手感——双击闭合，不再要求“点回起点”。
        if (modeRef.current === 'zone' || modeRef.current === 'boundary' || modeRef.current === 'scope') {
          pointerConsumedRef.current = true;
          event.preventDefault();
          if (draftRef.current.length >= 3) closeDraft();
          else setEditMessage(`至少要 3 个节点才能闭合（当前 ${draftRef.current.length} 个）。`);
          return;
        }
        // H2-d：画动线模式下双击提交；H3-a：测量模式下双击提交（距离/面积）。
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
            setEditMessage('用地红线图层已锁定，先解锁再改。');
            return;
          }
          // 2026-11-16 用户：「双击线也出现红框」——双击线加点时第一下已经插好顶点了，
          // 第二下别再把它当“双击顶点”删掉（否则加了又没，还红一下）。
          if (performance.now() - boundaryInsertedAtRef.current < BOUNDARY_INSERT_GRACE_MS) {
            boundaryInsertedAtRef.current = 0;
            pointerConsumedRef.current = true;
            event.preventDefault();
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
    if (scopeEdgeHoverRef.current !== null) {
      scopeEdgeHoverRef.current = null;
      setScopeEdgeHover(null);
    }
    if (scopeLockHoverRef.current) {
      scopeLockHoverRef.current = false;
      setScopeLockHover(false);
    }
    if (boundaryLockHoverRef.current) {
      boundaryLockHoverRef.current = false;
      setBoundaryLockHover(false);
    }
    dragVertexRef.current = null;
    boundaryJustInsertedRef.current = false;
    setPreviewRing(null);
    ghostPointRef.current = null;
    routeCursorRef.current = null;
    nodeGhostRef.current = null;
    workerGhostRef.current = null;
    measureCursorRef.current = null;
    if (zoneEdgeHintRef.current) {
      zoneEdgeHintRef.current = null;
      draw();
    }
    // 2026-11-16：边界的悬停提示同理——离开画布不该留一枚幽灵「+」或高亮框。
    if (boundaryVertexHoverRef.current !== null || boundaryEdgeHintRef.current) {
      boundaryVertexHoverRef.current = null;
      boundaryEdgeHintRef.current = null;
      setBoundaryVertexHover(null);
      setBoundaryEdgeHint(null);
      draw();
    }
    if (boundaryLockedHoverRef.current) {
      boundaryLockedHoverRef.current = false;
      setBoundaryLockedHover(false);
    }
    // 2026-11-16：Alt 分叉提示也不要跟着鼠标跑出画布。
    if (branchAnchorHintRef.current) {
      branchAnchorHintRef.current = null;
      setBranchAnchorHint(null);
      draw();
    }
    clearBoundaryDeleteArm();
    zoneVertexSnapRef.current = null;
    zoneVertexHoverRef.current = null;
    // 2026-11-15：流线加点的悬停手柄同理——离开画布不该留一枚“幽灵加号”。
    if (routeEdgeHintRef.current) {
      routeEdgeHintRef.current = null;
      draw();
    }
    routeVertexSnapRef.current = null;
    routeVertexHoverRef.current = null;
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
    // 2026-11-14：分区整体拖动同理。
    dragZoneMoveRef.current = null;
    zoneDragPreviewRef.current = null;
    // 2026-11-14：流线顶点拖拽同理。
    dragRouteVertexRef.current = null;
    routeDragPreviewRef.current = null;
    // 2026-11-14：人员点位拖拽同理。
    dragWorkerRef.current = null;
    workerDragPreviewRef.current = null;
    draw();
  }

  const readOnly = !onPlanChange;
  // 2026-11-11 图层：面板统计/清单/选中全部以当前层视图为准（boundary/levels 等共享字段原样在）。
  const levelView = filterPlanByLevel(plan, activeLevelId);
  const levelList = planLevels(plan);
  const activeLevelIndex = Math.max(0, levelList.findIndex(level => level.id === activeLevelId));
  const activeLevelName = levelList[activeLevelIndex]?.name ?? '图层 1';
  const selectedFacility = selectedFacilityId ? plan.facilities.find(f => f.id === selectedFacilityId) ?? null : null;
  // D 块：阵列预览评估（与画布幽灵同口径），供提交钮禁用与原因回读。
  const repeatPreview = selectedFacility
    ? evaluateRepeatPreview(selectedFacility, repeatCols, repeatRows, repeatGapX, repeatGapY, plan.facilities, plan.boundary, repeatGapMargin)
    : null;
  const repeatBlocked = !repeatPreview || repeatPreview.invalidCount > 0 || repeatPreview.overLimit;
  const selectedRoute = selectedRouteId ? plan.routes.find(r => r.id === selectedRouteId) ?? null : null;
  const selectedNode = selectedNodeId ? plan.nodes.find(n => n.id === selectedNodeId) ?? null : null;
  const selectedWorker = selectedWorkerId ? plan.workers.find(w => w.id === selectedWorkerId) ?? null : null;
  /** 2026-11-17 #118 补录入 UI：当前选中的车辆（独立集合）。 */
  const selectedVehicle = selectedVehicleId ? (plan.vehicles ?? []).find(v => v.id === selectedVehicleId) ?? null : null;
  /** 该车型在物料库里登记的模型（只有登记过的才能选；没有就是「待补模型」）。 */
  const selectedVehicleModelSlugs = selectedVehicle ? (VEHICLE_TYPES.find(item => item.id === selectedVehicle.type)?.modelSlugs ?? []) : [];
  // 固定角色选项：可走漫游角色；与当前岗位同类的排前，其余在后。
  const selectedWorkerCrowdType = selectedWorker ? crowdTypeForRole(selectedWorker.role) : null;
  const workerRoleOptions = (() => {
    const walkable = WALK_ROLES.filter(role => role.walkable);
    if (!selectedWorkerCrowdType) return walkable;
    return [
      ...walkable.filter(role => walkRoleCrowdType(role) === selectedWorkerCrowdType),
      ...walkable.filter(role => walkRoleCrowdType(role) !== selectedWorkerCrowdType),
    ];
  })();
  // 2026-11-11 用户指令：右上角浮窗「属性」页签的角标 = 当前同时选中的物件数（点选后自动切过来）。
  // 2026-11-17 #118 补漏：车辆也必须算进去——角标为 0 时整张「属性」卡会被空状态顶掉，
  // 车辆属性卡（车型/台数/分区/车型模型/删除）在编辑器里就永远够不着。
  const selectionInspectorCount = planSelectionCount({
    zone: !!selectedZoneId,
    facility: !!selectedFacility,
    route: !!selectedRoute,
    node: !!selectedNodeId,
    worker: !!selectedWorkerId,
    vehicle: !!selectedVehicle,
    multiRoute: multiSelectedRouteIds.length,
    multiNode: multiSelectedNodeIds.length,
    multiFacility: multiSelectedFacilityIds.length,
  });
  useEffect(() => {
    if (selectionInspectorCount === 0 || !selectionPanelOnRef.current) return;
    // 选中物件 → 只把「属性」卡展开（测量/标注卡的开合不受影响）。
    setInspectorPanel('selection', true);
  }, [selectionInspectorCount]);
  // 2026-11-12 换页守卫：选中一变就回属性页并收起手风琴，别把 Repeat 页/展开态挂到另一件物件上。
  useEffect(() => {
    setFacilityCardMode('props');
    repeatParamsRef.current.cardMode = 'props';
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
    // 2026-11-17 #118 补录入 UI：车辆暂不设独立图层开关（跟随「车」组），按当前层实体数计。
    vehicle: (levelView.vehicles ?? []).length,
    measurement: layerState.measure ? (levelView.measurements ?? []).length : 0,
    annotation: layerState.annotate ? (levelView.annotations ?? []).length : 0,
  };
  const inventoryRows = buildPlanInventory(levelView);
  // 2026-11-16 用户「清单要能按分区筛」：分区被删后自动退回「全部分区」，
  // 不让筛选值：指向不存在的区（否则下拉空白、清单一空到底，看着像数据丢了）。
  const invZoneActive = invZone === undefined || invZone === 'unassigned' || levelView.zones.some(zone => zone.id === invZone)
    ? invZone
    : undefined;
  const filteredInventoryRows = filterPlanInventory(inventoryRows, { kind: invKind, zone: invZoneActive, issuesOnly: invIssuesOnly });
  // 件数口径与筛选一致：受当前类型 / 只看问题约束，只算能归属的类型（设施 / 人员）。
  const invZoneCounts = (() => {
    const counts = new Map<string, number>();
    let unassigned = 0;
    for (const row of filterPlanInventory(inventoryRows, { kind: invKind, issuesOnly: invIssuesOnly })) {
      // 2026-11-17 #118：车辆也能归属分区（落位时自动归属），按区筛选时一并计入。
      if (row.kind !== 'facility' && row.kind !== 'worker' && row.kind !== 'vehicle') continue;
      if (row.zoneId) counts.set(row.zoneId, (counts.get(row.zoneId) ?? 0) + 1);
      else unassigned += 1;
    }
    return { counts, unassigned };
  })();
  const legendGroups = buildPlanLegend(levelView);
  const anchorById = new Map(inventoryRows.map(row => [row.id, row.anchor] as const));
  const infoIssues: PlanLocatableIssue[] = [
    // 2026-11-15：与画布同口径——默认只列冲突/缺宽度，「容量待核实」手动打开才出现。
    ...conflictIssues
      .filter(item => showAdvisoryBadges || item.status !== 'unverified')
      .map(item => ({
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
  // 滚轮同理：面板经 portal 挂到地图舞台外的宿主，若让 wheel 沿 React 树冒泡回 stage，
  // 会被当成地图缩放。成熟地图产品（Leaflet / Mapbox / 高德）的滚轮缩放只绑地图视口，
  // 侧栏滚动只滚动侧栏、不带动地图。面板根节点在此截断冒泡。
  const stopPanelWheel = (event: React.WheelEvent) => event.stopPropagation();
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
  /**
   * 2026-11-16 用户：「出入口现在不要是图标，我更喜欢右边这种环形的东西」。
   * 工具箱行图标跟着画布一起改：kind 色空心环（环厚 ≈ 外径一半，与画布环同比例）。
   */
  const nodeKindToolIcon = (kind: PlanNode['kind']) => (
    <span
      aria-hidden
      style={{
        display: 'block',
        width: 18,
        height: 18,
        flex: '0 0 auto',
        borderRadius: 999,
        border: `4.5px solid ${nodeStickerColor(kind)}`,
        boxSizing: 'border-box',
        background: 'transparent',
      }}
    />
  );
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
      style={{ ...(measurePanelHost ? {} : { marginTop: PLANNING_SPACING.xs }), paddingBottom: PLANNING_SPACING.xs }}
    >
      {/* 浮窗自带页签标题，搬进右上角后不再重复渲染这一行。 */}
      {!outdoorInspectorActive && (
        <div style={{ display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs }}>
          <span aria-hidden style={{ width: 12, height: 12, flex: '0 0 auto', borderRadius: 999, background: PLANNING_LAYER_COLORS.measure }} />
          <span style={{ fontWeight: 600, fontSize: PLANNING_TYPOGRAPHY.panel }}>测量</span>
          <span style={{ flex: 1 }} />
          <span style={{ opacity: 0.6, fontSize: PLANNING_TYPOGRAPHY.row }}>{levelView.measurements?.length ?? 0}</span>
        </div>
      )}
      {/* 2026-11-15 模式切换已收进底条合体钮小标；卡片内不再放模式入口，只保留当前读数。 */}
      <div style={{ marginTop: PLANNING_SPACING.xs }}>
        {(() => {
          const readout = measureDraftReadout(measureKind, measureDraftRef.current, measureCursorRef.current ?? undefined);
          return (
            <span
              aria-hidden
              style={{ display: 'block', textAlign: 'right', fontSize: PLANNING_TYPOGRAPHY.row, fontWeight: 600, color: readout ? PLANNING_SURFACE.panelText : PLANNING_TEXT.muted }}
            >
              {readout ?? '—'}
            </span>
          );
        })()}
      </div>
      {/* 2026-11-12 精简：不再常驻三模式长说明，只给当前模式一句短引导；拖拽快速、单击逐点两种手势都保留。 */}
      <div style={{ marginTop: PLANNING_SPACING.xs, opacity: 0.72, fontSize: PLANNING_TYPOGRAPHY.hint }}>
        {measureKind === 'distance' && '点起点，连续单击加段；双击 /「完成」结束'}
        {measureKind === 'area' && '拖矩形（Shift 正方形），或点选闭合'}
      </div>
      {mode === 'measure' && (
        <button
          type="button"
          data-testid="measure-finish"
          disabled={measureKind === 'area' ? measureDraftCount < 3 : measureDraftCount < 2}
          style={{ ...modeButtonStyle(false), marginTop: PLANNING_SPACING.xs, width: '100%', justifyContent: 'center', opacity: (measureKind === 'area' ? measureDraftCount < 3 : measureDraftCount < 2) ? 0.5 : 1 }}
          onClick={() => finishMeasure()}
        >
          完成（{measureDraftCount} 点）
        </button>
      )}
      {(levelView.measurements?.length ?? 0) > 0 && levelView.measurements!.map(m => renderOneplanItemRow({
        key: `measure-${m.id}`,
        testId: `layer-entity-measurement-${m.id}`,
        label: `${m.name} = ${m.kind === 'area' ? formatAreaM2(measureValue(m)) : formatLengthM(measureValue(m))}`,
        active: selectedMeasurementId === m.id,
        onClick: () => {
          selectMeasurement(m.id);
          const row = inventoryRows.find(r => r.kind === 'measurement' && r.id === m.id);
          if (row) locateRow(row);
        },
        onContextMenu: event => {
          event.preventDefault();
          event.stopPropagation();
          const row = inventoryRows.find(r => r.kind === 'measurement' && r.id === m.id);
          if (row) setContextMenu({ surface: 'row', x: event.clientX, y: event.clientY, row });
        },
        title: '点击定位到地图；右键菜单删除',
        icon: <span aria-hidden style={{ width: 12, height: 12, flex: '0 0 auto', borderRadius: 999, background: PLACED_KIND_COLORS.measurement }} />,
        trailing: (
          <button
            type="button"
            aria-label={`删除测量「${m.name}」`}
            className="sc-danger-quiet"
            style={{ cursor: 'pointer', fontSize: PLANNING_TYPOGRAPHY.row }}
            onClick={event => { event.stopPropagation(); deleteMeasurement(m.id); }}
          >
            删除
          </button>
        ),
      }))}
    </div>
  ) : null;

  /** 提示行永远占位（含未选工具），底部锚定的卡片不会因切工具/提示消息而改高度。 */
  const annotateHint = mode === 'note'
    ? '文本 · 点一下输入，Enter 提交'
    : mode === 'shape'
      ? (annotateDraftCount > 0
        ? `${planAnnotationKindLabels[annotateShape]} · 已收 ${annotateDraftCount} 点，还需 ${planShapeDraftTarget(annotateShape) - annotateDraftCount} 点`
        : `${planAnnotationKindLabels[annotateShape]} · ${annotateShape === 'triangle' ? '单击 3 点连成三角形' : '按住拖或点两个点'}`)
      : '选一个工具，在图上绘制';

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
          <span style={{ fontWeight: 600, fontSize: PLANNING_TYPOGRAPHY.panel }}>标注</span>
          <span style={{ flex: 1 }} />
          <span style={{ opacity: 0.6, fontSize: PLANNING_TYPOGRAPHY.row }}>{levelView.annotations?.length ?? 0}</span>
        </div>
      )}
      {/* 2026-11-16 绘图工具条：T / 矩形 / 圆形 / 三角形 / 线段平铺，颜色条另常驻。 */}
      <AnnotateDrawTools
        active={mode === 'note' ? 'note' : mode === 'shape' ? annotateShape : null}
        onNote={() => {
          if (resolveAnnotateDrawToolClick({ tool: 'note', mode, shape: annotateShape }) === 'exit') {
            exitAnnotateDraw();
            return;
          }
          setMode('note');
        }}
        onShape={kind => {
          if (resolveAnnotateDrawToolClick({ tool: kind, mode, shape: annotateShape }) === 'exit') {
            exitAnnotateDraw();
            return;
          }
          annotateShapeRef.current = kind;
          setAnnotateShape(kind);
          setMode('shape');
        }}
      />
      {/* 2026-11-16 颜色点与线宽常驻（Figma 颜色条），不收进形状下拉。文本/形状共用取色。 */}
      <AnnotateColorBar
        color={annotateColor}
        strokeWidth={annotateStrokeWidth}
        showStrokeWidth={mode !== 'note'}
        onColor={value => { annotateColorRef.current = value; setAnnotateColor(value); draw(); }}
        onStrokeWidth={value => { annotateStrokeWidthRef.current = value; setAnnotateStrokeWidth(value); draw(); }}
      />
      <div
        data-testid="annotate-hint"
        role={annotateNotice ? 'status' : undefined}
        aria-live={annotateNotice ? 'polite' : undefined}
        title={annotateNotice ?? annotateHint}
        style={{
          marginTop: PLANNING_SPACING.xs,
          height: 16,
          lineHeight: '16px',
          fontSize: PLANNING_TYPOGRAPHY.hint,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          color: annotateNotice ? PLANNING_SURFACE.warnText : undefined,
          opacity: annotateNotice ? 1 : 0.78,
        }}
      >
        {annotateNotice ?? annotateHint}
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
        onContextMenu: event => {
          event.preventDefault();
          event.stopPropagation();
          const row = inventoryRows.find(r => r.kind === 'annotation' && r.id === a.id);
          if (row) setContextMenu({ surface: 'row', x: event.clientX, y: event.clientY, row });
        },
        title: '点击定位到地图；右键菜单删除',
        icon: <span aria-hidden style={{ width: 12, height: 12, flex: '0 0 auto', borderRadius: 999, background: a.color ?? PLACED_KIND_COLORS.annotation }} />,
        trailing: (
          <button
            type="button"
            aria-label={`删除标注「${a.name}」`}
            className="sc-danger-quiet"
            style={{ cursor: 'pointer', fontSize: PLANNING_TYPOGRAPHY.row }}
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
  /* 2026-11-12 OnePlan Bench 卡同款控件样式：白底发丝线盒式输入、单位内嵌、28px 图标钮。 */
  const benchIconButtonStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, flex: '0 0 auto', padding: 0, background: 'none', border: 'none', borderRadius: PLANNING_RADIUS.sm, cursor: 'pointer', color: PLANNING_SURFACE.panelText };
  /* 2026-11-15 视觉统一（以用户提供的 Figma 属性面板为参照）：
     ① 分区标题 = 12px/600 + 上方发丝线（Figma 的 Position / Layout / Fill… 靠这条线分节）；
     ② 输入框 = 浅灰填充块，无描边（Figma #F5F5F5），不再是白底细边；
     ③ 值左对齐，轴标/单位当框内浅灰前缀（X / Y / W / H 那套）；
     ④ 图标钮保留 28px 命中区，但默不作声，只在标题行里作次行动作。 */
  const benchSectionTitleStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: PLANNING_TYPOGRAPHY.panel, color: PLANNING_SURFACE.panelText, marginTop: 12, paddingTop: 10, marginBottom: 6, borderTop: `1px solid ${PLANNING_SURFACE.panelBorder}` };
  const benchUnitBoxStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 8px', background: PLANNING_SURFACE.fieldBg, border: '1px solid transparent', borderRadius: PLANNING_RADIUS.sm, minWidth: 0 };
  const benchUnitLabelStyle: React.CSSProperties = { flex: '0 0 auto', fontSize: PLANNING_TYPOGRAPHY.row, color: PLANNING_TEXT.faint };
  const benchUnitSuffixStyle: React.CSSProperties = { flex: '0 0 auto', fontSize: PLANNING_TYPOGRAPHY.row, color: PLANNING_TEXT.faint };
  const benchUnitInputStyle: React.CSSProperties = { flex: 1, minWidth: 0, border: 'none', background: 'transparent', padding: 0, fontSize: PLANNING_TYPOGRAPHY.panel, color: PLANNING_SURFACE.panelText, textAlign: 'left', outline: 'none', fontVariantNumeric: 'tabular-nums' };
  const benchAccordionStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '10px 0', marginTop: 12, background: 'none', border: 'none', borderTop: `1px solid ${PLANNING_SURFACE.panelBorder}`, cursor: 'pointer', fontSize: PLANNING_TYPOGRAPHY.panel, fontWeight: 600, color: PLANNING_SURFACE.panelText, textAlign: 'left' };
  /* 2026-11-15 属性卡行尾小按钮（多选头部 复制 / 删除）：24px 高、发丝描边、灰底白面，
     与 Figma 面板里的次级按钮同权重——不再用 modeButtonStyle（那是模式切换胶囊，比正文还重）。 */
  const benchPanelButtonStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 24, padding: '0 10px', borderRadius: PLANNING_RADIUS.sm, border: `1px solid ${PLANNING_SURFACE.panelBorder}`, background: PLANNING_SURFACE.panelBg, color: PLANNING_SURFACE.panelText, fontSize: PLANNING_TYPOGRAPHY.row, fontWeight: 600, lineHeight: 1, cursor: 'pointer', whiteSpace: 'nowrap' };
  // 2026-11-15 模型来源三格（文字生成 / 图片生成 / 导入 GLB）已改成常驻按钮，
  // 说明进 title，所以原来的 modelAction* 三行文本样式不再需要。
  const benchSetupRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs, fontSize: PLANNING_TYPOGRAPHY.row, color: PLANNING_SURFACE.panelText };
  const benchSetupFieldStyle: React.CSSProperties = { flex: 1, minWidth: 0, background: PLANNING_SURFACE.fieldBg, color: PLANNING_SURFACE.panelText, border: '1px solid transparent', borderRadius: PLANNING_RADIUS.sm, fontSize: PLANNING_TYPOGRAPHY.row, padding: '5px 8px', outline: 'none' };
  /* 2026-11-12 室内多选胶囊移植（panels/viewport.tsx SelectionChip 同款观感）：
     组选浮层锚在组包围盒顶边中点上方（view state 驱动跟随平移缩放），拖组会话中隐藏。
     成组/存为组合不搬——SitePlan 契约没有 groups/组合概念。 */
  const chipButtonStyle: React.CSSProperties = { border: '1px solid', borderRadius: 999, background: 'transparent', color: 'inherit', fontWeight: 700, fontSize: PLANNING_TYPOGRAPHY.hint, padding: '1px 8px', cursor: 'pointer', whiteSpace: 'nowrap' };
  /** 组选工具条已并入右侧属性卡（facility-group-panel），画布不再算锚点。 */
  const BenchRepeatIcon = planningIcon('layout-grid');
  const BenchPlusIcon = planningIcon('plus');
  const BenchCloseIcon = planningIcon('x');
  const selectionInspectorZone = readOnly ? null : (
    <>
                {/* 2026-11-15 用户：多选在属性卡里只说一次——一个头部（件数 + 分类明细）、
                    一份复制/删除、一条「对齐」工具条。原先「已选 N 件设施」「已选 N 项」两块
                    各说一遍、复制/删除各出一遍，读起来像两个不相干的面板。 */}
                {(multiSelectedFacilityIds.length >= 2 || multiSelectedRouteIds.length > 0 || multiSelectedNodeIds.length > 0) && (() => {
                  const grouped = multiSelectedFacilityIds.length >= 2;
                  const facilityCount = grouped ? multiSelectedFacilityIds.length : 0;
                  const total = facilityCount + multiSelectedRouteIds.length + multiSelectedNodeIds.length;
                  const breakdown = [
                    facilityCount ? `设施 ${facilityCount}` : '',
                    multiSelectedRouteIds.length ? `流线 ${multiSelectedRouteIds.length}` : '',
                    multiSelectedNodeIds.length ? `出入口 ${multiSelectedNodeIds.length}` : '',
                  ].filter(Boolean).join(' · ');
                  const deleteAll = () => (
                    grouped && multiSelectedRouteIds.length + multiSelectedNodeIds.length === 0
                      ? deleteFacilitiesMulti(multiSelectedFacilityIds)
                      : deleteCrossMulti()
                  );
                  return (
                    <div data-testid="cross-multi-panel" style={{ marginTop: PLANNING_SPACING.xs }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: 14, color: PLANNING_SURFACE.panelText, minWidth: 0 }}>已选 {total} 项</span>
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flex: '0 0 auto' }}>
                          {grouped && (
                            <button
                              type="button"
                              data-testid="facility-multi-copy"
                              title="复制所选（Ctrl+D 同效）"
                              style={benchPanelButtonStyle}
                              onClick={() => duplicateFacilitiesMulti(multiSelectedFacilityIds)}
                            >
                              复制
                            </button>
                          )}
                          <button
                            type="button"
                            data-testid="cross-multi-delete"
                            title="删除所选（Delete 同效）"
                            style={{ ...benchPanelButtonStyle, color: PLANNING_SURFACE.dangerText }}
                            onClick={deleteAll}
                          >
                            删除
                          </button>
                        </span>
                      </div>
                      <div style={{ marginTop: 3, fontSize: PLANNING_TYPOGRAPHY.hint, color: PLANNING_TEXT.muted }}>{breakdown}</div>
                      {grouped && (
                        <div style={{ marginTop: 2, fontSize: PLANNING_TYPOGRAPHY.hint, color: PLANNING_TEXT.muted }}>
                          拖动即整体移动 · 拖角等比缩放 · Delete 删除
                        </div>
                      )}
                      {multiSelectedRouteIds.map(id => {
                        const route = levelView.routes.find(r => r.id === id);
                        if (!route) return null;
                        return (
                          <div key={id} className="sc-multi-row">
                            <span className="sc-multi-row__kind">流线</span>
                            <span className="sc-multi-row__name">{route.name}</span>
                            <button type="button" className="sc-multi-row__act" aria-label={`移除流线「${route.name}」`} onClick={() => {
                              const next = multiSelectedRouteIdsRef.current.filter(x => x !== id);
                              multiSelectedRouteIdsRef.current = next;
                              setMultiSelectedRouteIds(next);
                              draw();
                            }}>移除</button>
                            <button type="button" className="sc-multi-row__act sc-multi-row__act--danger" aria-label={`删除流线「${route.name}」`} onClick={() => {
                              deleteRoute(id);
                              const next = multiSelectedRouteIdsRef.current.filter(x => x !== id);
                              multiSelectedRouteIdsRef.current = next;
                              setMultiSelectedRouteIds(next);
                              draw();
                            }}>删除</button>
                          </div>
                        );
                      })}
                      {multiSelectedNodeIds.map(id => {
                        const node = levelView.nodes.find(n => n.id === id);
                        if (!node) return null;
                        return (
                          <div key={id} className="sc-multi-row">
                            <span className="sc-multi-row__kind">出入口</span>
                            <span className="sc-multi-row__name">{node.name}</span>
                            <button type="button" className="sc-multi-row__act" aria-label={`移除出入口「${node.name}」`} onClick={() => {
                              const next = multiSelectedNodeIdsRef.current.filter(x => x !== id);
                              multiSelectedNodeIdsRef.current = next;
                              setMultiSelectedNodeIds(next);
                              draw();
                            }}>移除</button>
                            <button type="button" className="sc-multi-row__act sc-multi-row__act--danger" aria-label={`删除出入口「${node.name}」`} onClick={() => {
                              deleteNode(id);
                              const next = multiSelectedNodeIdsRef.current.filter(x => x !== id);
                              multiSelectedNodeIdsRef.current = next;
                              setMultiSelectedNodeIds(next);
                              draw();
                            }}>删除</button>
                          </div>
                        );
                      })}
                      {grouped && (
                        <>
                          <div style={benchSectionTitleStyle}>对齐</div>
                          {/* 2026-11-15 视觉：等宽 8 键 + 悬停浅灰，分组之间一条发丝线；
                              等距需 ≥3 件，禁用只降不透明度（仍占位，不跳动）。 */}
                          <div data-testid="facility-group-panel" className="sc-align-tool">
                            {([
                              ['左对齐', 'min-x', AlignLeft, false],
                              ['水平居中', 'center-x', AlignCenterHorizontal, false],
                              ['右对齐', 'max-x', AlignRight, false],
                              ['水平等距', 'distribute-x', AlignHorizontalDistributeCenter, true],
                            ] as const).map(([label, key, Icon, needsThree]) => {
                              const disabled = needsThree && multiSelectedFacilityIds.length < 3;
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  aria-label={disabled ? `${label}（至少三件）` : label}
                                  title={disabled ? `${label}（至少三件）` : label}
                                  disabled={disabled}
                                  data-testid={`facility-multi-${key}`}
                                  className="sc-align-tool__btn"
                                  onClick={() => (key === 'distribute-x' ? distributeFacilitiesMulti(multiSelectedFacilityIds, 'x') : alignFacilitiesMulti(multiSelectedFacilityIds, key))}
                                >
                                  <Icon size={13} strokeWidth={1.75} aria-hidden />
                                </button>
                              );
                            })}
                            <span aria-hidden className="sc-align-tool__sep" />
                            {([
                              ['上对齐', 'max-y', AlignStartVertical, false],
                              ['垂直居中', 'center-y', AlignCenterVertical, false],
                              ['下对齐', 'min-y', AlignEndVertical, false],
                              ['垂直等距', 'distribute-y', AlignVerticalDistributeCenter, true],
                            ] as const).map(([label, key, Icon, needsThree]) => {
                              const disabled = needsThree && multiSelectedFacilityIds.length < 3;
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  aria-label={disabled ? `${label}（至少三件）` : label}
                                  title={disabled ? `${label}（至少三件）` : label}
                                  disabled={disabled}
                                  data-testid={`facility-multi-${key}`}
                                  className="sc-align-tool__btn"
                                  onClick={() => (key === 'distribute-y' ? distributeFacilitiesMulti(multiSelectedFacilityIds, 'y') : alignFacilitiesMulti(multiSelectedFacilityIds, key))}
                                >
                                  <Icon size={13} strokeWidth={1.75} aria-hidden />
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                      <div style={{ marginTop: 8 }}>
                        <button type="button" className="sc-quiet-link" onClick={() => clearMultiSelection()}>取消选择</button>
                      </div>
                    </div>
                  );
                })()}
                {selectedZoneId && levelView.zones.filter(zone => zone.id === selectedZoneId).map(zone => (
                  <div
                    key={zone.id}
                    data-testid={`zone-row-${zone.id}`}
                    data-selected="true"
                    style={{
                      marginTop: PLANNING_SPACING.xs,
                      borderTop: `1px solid ${PLANNING_SURFACE.fieldBg}`,
                      paddingTop: PLANNING_SPACING.xs,
                      // 2026-11-15 用户指令：去掉属性块的橘色描边（顶部已有分隔线 + 「取消选中」按钮，
                      // 再套一圈琥珀色高亮反而碍眼）。只保留圆角，不再画 outline。
                      borderRadius: PLANNING_RADIUS.sm,
                    }}
                  >
                    <div style={zoneRowStyle}>
                      <input
                        aria-label={`分区「${zone.name}」颜色`}
                        type="color"
                        value={zone.color ?? PLANNING_ZONE_COLORS[zone.semantic]}
                        onChange={event => updateZone(zone.id, { color: event.target.value })}
                        title="改分区颜色"
                        style={{ width: 18, height: 18, padding: 0, border: 'none', background: 'none', borderRadius: 4, flex: '0 0 auto' }}
                      />
                      <input
                        aria-label={`分区「${zone.name}」名称`}
                        title="点一下改名字"
                        value={zone.name}
                        maxLength={60}
                        onChange={event => updateZone(zone.id, { name: event.target.value })}
                        // 2026-11-15 用户反馈：名字框一片灰底 + 灰描边很抢眼。改成“标题”长相：
                        // 透明底、无常规描边，只在聚焦时透出细边，一眼看出是分区名而不是待填输入框。
                        style={{ flex: 1, minWidth: 0, background: 'transparent', color: PLANNING_SURFACE.panelText, border: '1px solid transparent', borderRadius: PLANNING_RADIUS.sm, fontSize: 14, fontWeight: 600, padding: '2px 4px' }}
                        onFocus={event => { event.currentTarget.style.borderColor = PLANNING_SURFACE.panelBorder; }}
                        onBlur={event => { event.currentTarget.style.borderColor = 'transparent'; }}
                      />
                      {/* 2026-11-15 用户指令：「取消选中」摆在名字前面很怪——当成属性卡的关闭钮，放行尾。 */}
                      <button
                        type="button"
                        data-testid={`zone-select-${zone.id}`}
                        aria-label="取消选中"
                        title="取消选中（Esc）"
                        onClick={() => selectZone(null)}
                        style={{
                          flex: '0 0 auto', width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          padding: 0, background: 'none', border: 'none', cursor: 'pointer',
                          color: PLANNING_SURFACE.panelText, opacity: 0.55, fontSize: 15, lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <label style={zoneRowStyle} title="这条分区服务于哪场活动：填了就代替分区名显示在图上，也会作为 AI 排布时的参考">
                      事件
                      <ZoneEventInput key={`${generationProjectId ?? 'local'}:${zone.id}`} name={zone.name}
                        value={zone.event}
                        onCommit={value => updateZone(zone.id, { event: value })}
                        style={{ flex: 1, minWidth: 0, fontSize: PLANNING_TYPOGRAPHY.row }} />
                    </label>
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
                          onClick={() => switchRepeatCardMode('props')}
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
                            onChange={event => { const v = Math.max(1, Math.min(20, Math.floor(Number(event.target.value) || 1))); setRepeatCols(v); updateRepeatParams({ cols: v }); }}
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
                            onChange={event => { const v = Math.max(1, Math.min(20, Math.floor(Number(event.target.value) || 1))); setRepeatRows(v); updateRepeatParams({ rows: v }); }}
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
                            onChange={event => { const v = Math.max(0, Math.min(200, Number(event.target.value) || 0)); setRepeatGapX(v); updateRepeatParams({ gapX: v }); }}
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
                            onChange={event => { const v = Math.max(0, Math.min(200, Number(event.target.value) || 0)); setRepeatGapY(v); updateRepeatParams({ gapY: v }); }}
                            style={benchUnitInputStyle}
                          />
                          <span style={benchUnitSuffixStyle}>m</span>
                        </label>
                      </div>
                      <label style={{ ...benchUnitBoxStyle, width: '100%', marginTop: PLANNING_SPACING.sm }}>
                        <span style={benchUnitLabelStyle}>碰撞间距</span>
                        <input
                          aria-label="阵列碰撞安全间距（米）"
                          data-testid="facility-repeat-margin"
                          type="number"
                          min={0}
                          max={20}
                          step={0.5}
                          value={repeatGapMargin}
                          onChange={event => { const v = Math.max(0, Math.min(20, Number(event.target.value) || 0)); setRepeatGapMargin(v); updateRepeatParams({ margin: v }); }}
                          style={benchUnitInputStyle}
                        />
                        <span style={benchUnitSuffixStyle}>m</span>
                      </label>
                      <div style={{ marginTop: 2, fontSize: PLANNING_TYPOGRAPHY.hint, opacity: 0.6 }}>副本与已有物件之间预留的空隙，0 为按占地紧贴判定。</div>
                      {repeatPreview && repeatBlocked && (
                        <div
                          style={{ marginTop: PLANNING_SPACING.sm, fontSize: PLANNING_TYPOGRAPHY.hint, color: PLANNING_SURFACE.dangerText }}
                          role="alert"
                        >
                          {repeatPreview.overLimit
                            ? `超出单次上限 ${REPEAT_MAX_COPIES} 件，请减少列数或行数。`
                            : `${repeatPreview.invalidCount} 格越界或与现有物件碰撞，请调整布局或间距。`}
                        </div>
                      )}
                      <button
                        type="button"
                        data-testid="facility-repeat"
                        disabled={repeatBlocked}
                        style={{ ...modeButtonStyle(false), marginTop: PLANNING_SPACING.sm, width: '100%', justifyContent: 'center', opacity: repeatBlocked ? 0.5 : 1, cursor: repeatBlocked ? 'not-allowed' : 'pointer' }}
                        onClick={() => { if (!repeatBlocked) applyRepeatFacility(selectedFacility, repeatCols, repeatRows, repeatGapX, repeatGapY); }}
                      >
                        {repeatPreview && repeatPreview.overLimit
                          ? `超出上限 ${REPEAT_MAX_COPIES} 件`
                          : `按阵列复制 ${repeatPreview?.total ?? repeatCols * repeatRows - 1} 件`}
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
                          onClick={() => switchRepeatCardMode('repeat')}
                        >
                          <BenchRepeatIcon size={16} aria-hidden />
                        </button>
                      </div>
                      {/* 2026-11-15 用户：位置与尺寸压成一块——标题留在上面（位置 / 尺寸两栏），
                          下面一行就是具体数字；四项都直接可改：纬/经 逆映射回米，W/L 等比缩放。
                          2026-11-15 视觉修正：属性卡实际只有 ~233 CSS px 宽（截图 DPR2），
                          两栏并排时每个格子只剩 ~34 px 文字宽，30.25214 / W 2.05 全被裁。
                          改成两组上下堆：标题在上、数字占满整行，四项仍在一屏内全部可改。 */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${PLANNING_SURFACE.panelBorder}` }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: PLANNING_TYPOGRAPHY.row, fontWeight: 600, color: PLANNING_TEXT.soft, marginBottom: 4 }}>位置</div>
                          <div style={{ display: 'flex', gap: 6 }}>
                        <label style={{ ...benchUnitBoxStyle, flex: '1 1 0', padding: '0 6px', gap: 3 }} title="纬度（可改，失焦或回车生效）">
                          <input
                            aria-label="选中设施纬度"
                            type="text"
                            inputMode="decimal"
                            value={facilityGeoDraft?.lat ?? (selectedFacilityGeo ? selectedFacilityGeo.lat.toFixed(5) : '')}
                            onFocus={() => setFacilityGeoDraft({
                              lat: selectedFacilityGeo ? selectedFacilityGeo.lat.toFixed(5) : '',
                              lng: selectedFacilityGeo ? selectedFacilityGeo.lng.toFixed(5) : '',
                            })}
                            onChange={event => setFacilityGeoDraft(prev => ({
                              lat: event.target.value,
                              lng: prev?.lng ?? (selectedFacilityGeo ? selectedFacilityGeo.lng.toFixed(5) : ''),
                            }))}
                            onBlur={commitFacilityGeoDraft}
                            onKeyDown={event => { if (event.key === 'Enter') commitFacilityGeoDraft(); }}
                            style={benchUnitInputStyle}
                          />
                        </label>
                        <label style={{ ...benchUnitBoxStyle, flex: '1 1 0', padding: '0 6px', gap: 3 }} title="经度（可改，失焦或回车生效）">
                          <input
                            aria-label="选中设施经度"
                            type="text"
                            inputMode="decimal"
                            value={facilityGeoDraft?.lng ?? (selectedFacilityGeo ? selectedFacilityGeo.lng.toFixed(5) : '')}
                            onFocus={() => setFacilityGeoDraft({
                              lat: selectedFacilityGeo ? selectedFacilityGeo.lat.toFixed(5) : '',
                              lng: selectedFacilityGeo ? selectedFacilityGeo.lng.toFixed(5) : '',
                            })}
                            onChange={event => setFacilityGeoDraft(prev => ({
                              lat: prev?.lat ?? (selectedFacilityGeo ? selectedFacilityGeo.lat.toFixed(5) : ''),
                              lng: event.target.value,
                            }))}
                            onBlur={commitFacilityGeoDraft}
                            onKeyDown={event => { if (event.key === 'Enter') commitFacilityGeoDraft(); }}
                            style={benchUnitInputStyle}
                          />
                        </label>
                        </div>
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: PLANNING_TYPOGRAPHY.row, fontWeight: 600, color: PLANNING_TEXT.soft, marginBottom: 4 }}>尺寸</div>
                          <div style={{ display: 'flex', gap: 6 }}>
                        <label style={{ ...benchUnitBoxStyle, flex: '1 1 0', padding: '0 6px', gap: 3 }} title="宽度（米，失焦或回车生效）">
                          <span style={benchUnitLabelStyle}>W</span>
                          <input
                            aria-label="选中设施宽度（米）"
                            type="text"
                            inputMode="decimal"
                            value={facilitySizeDraft?.width ?? selectedFacility.size.width.toFixed(1)}
                            onFocus={() => setFacilitySizeDraft({
                              width: selectedFacility.size.width.toFixed(1),
                              depth: selectedFacility.size.depth.toFixed(1),
                            })}
                            onChange={event => setFacilitySizeDraft(prev => ({
                              width: event.target.value,
                              depth: prev?.depth ?? selectedFacility.size.depth.toFixed(1),
                            }))}
                            onBlur={commitFacilitySizeDraft}
                            onKeyDown={event => { if (event.key === 'Enter') commitFacilitySizeDraft(); }}
                            style={benchUnitInputStyle}
                          />
                          <span style={benchUnitSuffixStyle}>m</span>
                        </label>
                        <label style={{ ...benchUnitBoxStyle, flex: '1 1 0', padding: '0 6px', gap: 3 }} title="深度/长度（米，失焦或回车生效）">
                          <span style={benchUnitLabelStyle}>L</span>
                          <input
                            aria-label="选中设施深度（米）"
                            type="text"
                            inputMode="decimal"
                            value={facilitySizeDraft?.depth ?? selectedFacility.size.depth.toFixed(1)}
                            onFocus={() => setFacilitySizeDraft({
                              width: selectedFacility.size.width.toFixed(1),
                              depth: selectedFacility.size.depth.toFixed(1),
                            })}
                            onChange={event => setFacilitySizeDraft(prev => ({
                              width: prev?.width ?? selectedFacility.size.width.toFixed(1),
                              depth: event.target.value,
                            }))}
                            onBlur={commitFacilitySizeDraft}
                            onKeyDown={event => { if (event.key === 'Enter') commitFacilitySizeDraft(); }}
                            style={benchUnitInputStyle}
                          />
                          <span style={benchUnitSuffixStyle}>m</span>
                        </label>
                          </div>
                        </div>
                        {/* 2026-11-15 用户：「复制坐标没用」——删掉这颗钮（经纬度本来就能就地改，要抄走直接框选文本）。 */}
                      </div>
                      {/* 2026-11-16 用户「物料要有归属意识」：归属直接写在属性卡里——清单/CSV 的「所属分区」列、
                          分区筛选都吃这个字段；换区会自动重算，也可以在这里手动钉到某一个区。 */}
                      <div style={benchSectionTitleStyle}>归属</div>
                      <label style={{ ...benchUnitBoxStyle, flex: '1 1 0' }} title="这件物料属于哪个分区">
                        <span style={{ fontSize: PLANNING_TYPOGRAPHY.row, color: PLANNING_TEXT.soft, flex: '0 0 auto' }}>分区</span>
                        <select
                          aria-label="选中设施归属分区"
                          value={selectedFacility.zoneId ?? ''}
                          onChange={event => updateFacility(selectedFacility.id, { zoneId: event.target.value || undefined })}
                          style={{ ...selectStyle, flex: 1, minWidth: 0 }}
                        >
                          <option value="">未归属</option>
                          {plan.zones.map(zone => (
                            <option key={zone.id} value={zone.id}>{zone.name}</option>
                          ))}
                        </select>
                      </label>
                      {/* 样式：色块 + 十六进制 + 透明度（对齐 Figma 的 Fill 行：色块在最左，数值成对排）。 */}
                      <div style={benchSectionTitleStyle}>样式</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <label style={{ ...benchUnitBoxStyle, flex: '0 0 auto', width: 108 }} title="改颜色">
                          <input
                            aria-label="选中设施颜色"
                            type="color"
                            value={selectedFacility.color ?? PLANNING_LAYER_COLORS.facility}
                            onChange={event => updateFacility(selectedFacility.id, { color: event.target.value })}
                            style={{ width: 16, height: 16, flex: '0 0 auto', padding: 0, border: 'none', borderRadius: 4, background: 'none', cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: PLANNING_TYPOGRAPHY.row, color: PLANNING_TEXT.soft, textTransform: 'uppercase', fontVariantNumeric: 'tabular-nums' }}>
                            {(selectedFacility.color ?? PLANNING_LAYER_COLORS.facility).replace('#', '')}
                          </span>
                        </label>
                        <label style={{ ...benchUnitBoxStyle, flex: '1 1 0' }} title="透明度">
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
                      {/* 描边三态+无描边：单滑动药丸分段控件（等宽单选，药丸随选中段滑动；选择立即生效，无提交钮）。 */}
                      {(() => {
                        const strokeOptions = [['solid', '实线'], ['dashed', '虚线'], ['dotted', '点线'], ['none', '无']] as const;
                        const currentStroke = selectedFacility.strokeStyle ?? 'solid';
                        const activeStrokeIndex = Math.max(0, strokeOptions.findIndex(([v]) => v === currentStroke));
                        const segGap = PLANNING_SPACING.xs;
                        const segCount = strokeOptions.length;
                        return (
                          <div
                            className="sc-seg"
                            role="group"
                            aria-label="描边样式"
                            style={{ marginTop: PLANNING_SPACING.xs, background: PLANNING_SURFACE.fieldBg }}
                          >
                            <span
                              aria-hidden
                              className="sc-seg__pill"
                              style={{
                                left: `calc((100% + ${segGap}px) * ${activeStrokeIndex / segCount})`,
                                width: `calc((100% - ${segGap * (segCount - 1)}px) / ${segCount})`,
                                background: PLANNING_SURFACE.activeBg,
                                boxShadow: '0 1px 2px rgba(20, 24, 32, 0.10)',
                              }}
                            />
                            {strokeOptions.map(([value, label]) => {
                              const active = currentStroke === value;
                              return (
                                <button
                                  key={value}
                                  type="button"
                                  aria-pressed={active}
                                  aria-label={`描边${label}`}
                                  title={label}
                                  data-testid={`facility-stroke-${value}`}
                                  className="sc-seg__btn"
                                  style={{ color: active ? PLANNING_SURFACE.selectedBorder : PLANNING_SURFACE.panelText }}
                                  onClick={() => updateFacility(selectedFacility.id, { strokeStyle: value })}
                                >
                                  <StrokeGlyph style={value} />
                                </button>
                              );
                            })}
                          </div>
                        );
                      })()}
                      {/* 当前模型排首位，素材库的默认模型保留标记，点它清除 override。 */}
                      <div style={benchSectionTitleStyle}>模型</div>
                      {/* 2026-11-17：候选条外面包一层 flex 行。候选条自己是横向滚动条，
                          固有宽度 = 候选数 × 68px；不包这一层，它会把整张属性卡撑到上千像素宽，
                          冲出宿主与视口，「文字生成 / 图片生成 / 导入 GLB」三颗按钮就落在可视区之外，
                          真鼠标点下去命中的是底图 canvas。包一层之后滚动条自己滚，卡片宽度回到设计稿的 ~233px。 */}
                      <div style={FACILITY_MODEL_STRIP_WRAPPER_STYLE}>
                      <div
                        role="group"
                        aria-label="3D 模型候选"
                        data-testid="facility-model-strip"
                        style={FACILITY_MODEL_STRIP_STYLE}
                      >
                        {(() => {
                          const raw = facilityModelCandidates && facilityModelCandidates.templateId === selectedFacility.templateId ? facilityModelCandidates.items : [];
                          const override = selectedFacility.modelOverride;
                          const picked = override ? raw.findIndex(item => item.slug === override) : -1;
                          return picked > 0 ? [raw[picked]!, ...raw.slice(0, picked), ...raw.slice(picked + 1)] : raw;
                        })().map(candidate => {
                          const isDefault = candidate.slug === facilityModelCandidates?.defaultSlug;
                          const active = candidate.slug === (selectedFacility.modelOverride ?? facilityModelCandidates?.defaultSlug);
                          return (
                          <button
                            key={candidate.slug}
                            type="button"
                            aria-pressed={active}
                            data-testid={`facility-model-${candidate.slug}`}
                            data-default={isDefault ? 'true' : undefined}
                            title={`${candidate.name}（${candidate.width}×${candidate.depth}×${candidate.height} m）${isDefault ? ' · 素材库默认模型' : ''}`}
                            style={{ flex: '0 0 auto', width: 64, height: 60, padding: 0, background: PLANNING_SURFACE.panelBg, border: `1px solid ${active ? GROUP_SELECT_BLUE : PLANNING_SURFACE.panelBorder}`, borderRadius: PLANNING_RADIUS.sm, cursor: 'pointer', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
                            onClick={() => {
                              if (active) return;
                              updateFacility(selectedFacility.id, { modelOverride: isDefault ? undefined : candidate.slug });
                              setEditMessage(`「${selectedFacility.name}」已换用「${candidate.name}」，2D 占地已重置为模型真实尺寸（约 ${candidate.width.toFixed(1)}×${candidate.depth.toFixed(1)} m）；之后拖角缩放，3D 等比跟随。`);
                            }}
                          >
                            {/* 2026-11-15 上图下名：缩略图 40px + 名称条 18px。名称原先压在图上（白字 + textShadow），
                                碰浅色模型直接糊成一片；独立名称条后任何缩略图都读得清。 */}
                            <span aria-hidden style={{ position: 'relative', display: 'block', height: 40, width: '100%', overflow: 'hidden', background: PLANNING_SURFACE.fieldBg }}>
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
                              {isDefault ? (
                                <span style={{ position: 'absolute', left: 3, top: 3, padding: '0 3px', height: 13, lineHeight: '13px', borderRadius: 3, background: 'rgba(20, 20, 22, 0.62)', color: '#fff', fontSize: 9, fontWeight: 600, letterSpacing: '0.02em' }}>默认</span>
                              ) : null}
                            </span>
                            <span style={{ height: 18, width: '100%', padding: '0 4px', lineHeight: '18px', textAlign: 'center', fontSize: 10, color: PLANNING_TEXT.muted, borderTop: `1px solid ${PLANNING_SURFACE.panelBorder}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {candidate.name}
                            </span>
                          </button>
                          );
                        })}
                        {/* 2026-11-15：候选为空时把原因写出来，别让「模型」这一行看着像没加载完。 */}
                        {!(facilityModelCandidates && facilityModelCandidates.templateId === selectedFacility.templateId && facilityModelCandidates.items.length > 0) && (
                          <span style={{ alignSelf: 'center', fontSize: PLANNING_TYPOGRAPHY.hint, opacity: 0.6, lineHeight: '14px' }}>
                            素材库里没有和这个图标对应的 3D 模型，可在下方「生成或导入模型」补一个。
                          </span>
                        )}
                      </div>
                      </div>
                      {(() => {
                        const raw = facilityModelCandidates && facilityModelCandidates.templateId === selectedFacility.templateId ? facilityModelCandidates.items : [];
                        const builtinFirst = raw.find(candidate => candidate.slug === facilityModelCandidates?.defaultSlug);
                        const override = selectedFacility.modelOverride;
                        if (!builtinFirst || !override || override === builtinFirst.slug) return null;
                        return (
                          <button
                            type="button"
                            data-testid="facility-model-reset-default"
                            className="sc-quiet-link"
                            style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            title="把首张模型还原成素材库内置的默认模型"
                            onClick={() => {
                              updateFacility(selectedFacility.id, { modelOverride: undefined });
                              setEditMessage(`「${selectedFacility.name}」已恢复默认模型「${builtinFirst.name}」，2D 占地按它的真实尺寸（约 ${builtinFirst.width.toFixed(1)}×${builtinFirst.depth.toFixed(1)} m）。`);
                            }}
                          >
                            设为默认：「{builtinFirst.name}」
                          </button>
                        );
                      })()}
                      {/* V-5b/c 生成中状态行：轮询到待取回任务时给一句可读进度，完成后自动消失。 */}
                      {facilityGenerateStatus && facilityGenerateStatus.facilityId === selectedFacility.id ? (
                        <div role="status" style={{ marginTop: PLANNING_SPACING.xs, fontSize: PLANNING_TYPOGRAPHY.panel, lineHeight: '16px', color: PLANNING_SURFACE.panelText, opacity: 0.75 }}>
                          「{facilityGenerateStatus.name}」{facilityGenerateStatus.message}，完成后自动回填候选首位。
                        </div>
                      ) : null}
                      {/* 2026-11-15 生成/上传/导入三个入口统一打开「生成」面板（预选输入方式 + 设施目标），
                          不再在画布上叠一张原位表单。下面这个隐藏 input 留给本机 GLB 的校验/入库逻辑复用，
                          但入口已搬到面板里，点画布按钮不会再触发它。
                          同一天用户反馈「模型下面四个应该是好用的按钮或展开区域」：
                          改为与布场信息/备注同一只手风琴，展开后是三行带图标与说明的整行按钮。 */}
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
                      {/* 2026-11-15 用户：「生成和导入模型不应该收在下方，因为这个很重要」。
                          原来它是一条折叠手风琴且默认关闭——最需要入口的动作反而最不显眼。
                          改成模型条正下方三格常驻：文字生成 / 图片生成 / 导入 GLB，
                          图标在上、名称在下，与模型卡同一视觉重量；说明挤进 title，不再占两行。 */}
                      <div role="group" aria-label="生成或导入模型" style={FACILITY_MODEL_ACTION_ROW_STYLE}>
                        <button
                          type="button"
                          data-testid="facility-model-generate"
                          title="按设施名预填生成面板，确认额度后提交；生成完回填到模型条首位"
                          className="sc-model-action"
                          onClick={() => openGenerationSheet({ task: 'model', scope: 'facility', source: 'text', facility: { id: selectedFacility.id, name: selectedFacility.name } })}
                        >
                          <Sparkles size={14} aria-hidden />
                          <span>文字生成</span>
                        </button>
                        <button
                          type="button"
                          data-testid="facility-model-upload"
                          title="上传一张现场照片，生成对应的 3D 模型"
                          className="sc-model-action"
                          onClick={() => openGenerationSheet({ task: 'model', scope: 'facility', source: 'image', facility: { id: selectedFacility.id, name: selectedFacility.name } })}
                        >
                          <ImageUp size={14} aria-hidden />
                          <span>图片生成</span>
                        </button>
                        <button
                          type="button"
                          data-testid="facility-model-import-glb"
                          title="导入本机 .glb（≤10 MB，仅本次编辑有效）"
                          className="sc-model-action"
                          onClick={() => openGenerationSheet({ task: 'model', scope: 'facility', source: 'import', facility: { id: selectedFacility.id, name: selectedFacility.name } })}
                        >
                          <Upload size={14} aria-hidden />
                          <span>导入 GLB</span>
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
                    {/* 2026-11-15 用户第二轮指令：去掉「已选中动线」标题行和「删除动线」文字按钮，
                        单向/反转合成同一行图标控件。删除仍可用 Delete/Backspace 或清单页签行删除。 */}
                    <div style={{ ...zoneRowStyle, marginTop: 0 }}>
                      <input
                        aria-label="选中动线名称"
                        title="点一下改名字"
                        value={selectedRoute.name}
                        maxLength={60}
                        onChange={event => updateRoute(selectedRoute.id, { name: event.target.value })}
                        style={{ flex: 1, minWidth: 0, background: 'transparent', color: PLANNING_SURFACE.panelText, border: '1px solid transparent', borderRadius: PLANNING_RADIUS.sm, fontSize: 14, fontWeight: 600, padding: '2px 4px' }}
                        onFocus={event => { event.currentTarget.style.borderColor = PLANNING_SURFACE.panelBorder; }}
                        onBlur={event => { event.currentTarget.style.borderColor = 'transparent'; }}
                      />
                      <button
                        type="button"
                        data-testid="route-deselect"
                        aria-label="取消选择"
                        title="取消选择（Esc）"
                        onClick={() => selectRoute(null)}
                        style={{
                          flex: '0 0 auto', width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          padding: 0, background: 'none', border: 'none', cursor: 'pointer',
                          color: PLANNING_SURFACE.panelText, opacity: 0.55, fontSize: 15, lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </div>
                    {/* 2026-11-16 用户：「类型也就几个类型，再说一遍，我讨厌下拉选取」——
                        下拉换成三颗图标直选，颜色用动线类型色（与画布芯片同源）。 */}
                    <div style={{ ...zoneRowStyle, gap: PLANNING_SPACING.xs }}>
                      <span style={{ flex: '0 0 auto', fontSize: PLANNING_TYPOGRAPHY.row }}>类型</span>
                      <div
                        className="sc-seg"
                        role="group"
                        aria-label="选中动线类型"
                        style={{ width: 96, flex: '0 0 auto', background: PLANNING_SURFACE.fieldBg }}
                      >
                        {planRouteKinds.map(kind => {
                          const Icon = planningIcon(ROUTE_KIND_ICONS[kind]);
                          const active = selectedRoute.kind === kind;
                          const tint = PLANNING_ROUTE_KIND_COLORS[kind];
                          return (
                            <button
                              key={kind}
                              type="button"
                              aria-pressed={active}
                              aria-label={`类型：${planRouteKindLabels[kind]}`}
                              title={planRouteKindLabels[kind]}
                              data-testid={`route-kind-${kind}`}
                              className="sc-seg__btn"
                              style={{
                                // 2026-11-16 用户：「切换应该底部的圆圈底色就是对应的颜色；
                                // 选中左右边距很奇怪」——不再用滑动药丸，每颗自己上色
                                // （人行蓝 / 车辆紫 / 后勤金），选中就是色块本身，
                                // 左右边距由容器 padding + gap 均分，不再有位移误差。
                                background: active ? tint : 'transparent',
                                color: active ? '#ffffff' : PLANNING_SURFACE.panelText,
                                boxShadow: active ? '0 1px 2px rgba(20, 24, 32, 0.18)' : 'none',
                                transition: 'background 120ms ease, color 120ms ease',
                              }}
                              onClick={() => updateRoute(selectedRoute.id, { kind })}
                            >
                              <Icon size={14} aria-hidden />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {/* 2026-11-16 用户：「如果是双向的，也用不到反向。那我其实就三个状态啊？」
                        于是并成一组三颗的分段控件：双向 / 单向 / 反向。
                        数据里方向只有“双向/单向”两个持久态（单向时 points 顺序就是行进方向），
                        所以第三颗是“翻一下”的动作：双向时置灰，单项时才可点。 */}
                    {(() => {
                      const oneWay = selectedRoute.oneWay;
                      const options = [
                        { key: 'both', label: '双向', Icon: ArrowLeftRight, testId: 'route-direction-both', active: !oneWay, disabled: false },
                        { key: 'oneway', label: '单向', Icon: ArrowRight, testId: 'route-direction-oneway', active: oneWay, disabled: false },
                        { key: 'reverse', label: '反向', Icon: ArrowRightLeft, testId: 'route-reverse', active: false, disabled: !oneWay },
                      ] as const;
                      return (
                        <div style={{ ...zoneRowStyle, gap: PLANNING_SPACING.xs }}>
                          <span style={{ flex: '0 0 auto', fontSize: PLANNING_TYPOGRAPHY.row }}>方向</span>
                          <div
                            className="sc-seg"
                            role="group"
                            aria-label="动线方向"
                            style={{ width: 96, flex: '0 0 auto', background: PLANNING_SURFACE.fieldBg }}
                          >
                            {options.map(({ key, label, Icon, testId, active, disabled }) => (
                              <button
                                key={key}
                                type="button"
                                aria-pressed={active}
                                aria-disabled={disabled}
                                aria-label={label}
                                title={disabled ? `${label}（单向时才能用）` : `${label}（${key === 'reverse' ? '把流向翻一下' : key === 'both' ? '不画方向箭头' : '沿线画方向箭头'}）`}
                                data-testid={testId}
                                className="sc-seg__btn"
                                style={{
                                  // 同一处修改：选中底色直接长在按钮上，不再靠绝对定位的药丸，
                                  // 这样左右边距永远对称（以前第 2/3 颗会偏 3~5 px）。
                                  background: active ? PLANNING_SURFACE.activeBg : 'transparent',
                                  boxShadow: active ? '0 1px 2px rgba(20, 24, 32, 0.10)' : 'none',
                                  transition: 'background 120ms ease, color 120ms ease',
                                  color: active ? PLANNING_SURFACE.selectedBorder : PLANNING_SURFACE.panelText,
                                  opacity: disabled ? 0.35 : 1,
                                  cursor: disabled ? 'not-allowed' : 'pointer',
                                }}
                                onClick={() => {
                                  if (disabled) return;
                                  if (key === 'reverse') reverseSelectedRoute(selectedRoute.id);
                                  else updateRoute(selectedRoute.id, { oneWay: key === 'oneway' });
                                }}
                              >
                                <Icon size={14} aria-hidden />
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    {/* 2026-11-16 用户：动线属性里加「通行方式」——人行 / 车行 / 人车一起 */}
                    <div style={{ ...zoneRowStyle, gap: PLANNING_SPACING.xs }}>
                      <span style={{ flex: '0 0 auto', fontSize: PLANNING_TYPOGRAPHY.row }}>通行</span>
                      <div role="group" aria-label="动线通行方式" style={{ flex: 1, display: 'flex', gap: 2, padding: 2, borderRadius: 6, background: PLANNING_SURFACE.fieldBg }}>
                        {([
                          { id: 'walk', label: '人行' },
                          { id: 'vehicle', label: '车行' },
                          { id: 'mixed', label: '人车一起' },
                        ] as const).map(option => {
                          const active = routeCarrier(selectedRoute) === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              aria-pressed={active}
                              data-testid={`route-carrier-${option.id}`}
                              title={option.label === '人车一起' ? '这条线人和车共用：冲突判定会同时和纯人行、纯车行配对' : `${option.label}：布点密度和冲突判定都按它算`}
                              onClick={() => updateRoute(selectedRoute.id, { carrier: option.id })}
                              style={{
                                flex: 1,
                                padding: '4px 0',
                                border: 'none',
                                borderRadius: 4,
                                cursor: 'pointer',
                                fontSize: PLANNING_TYPOGRAPHY.row,
                                background: active ? PLANNING_SURFACE.activeBg : 'transparent',
                                color: active ? PLANNING_SURFACE.selectedBorder : PLANNING_SURFACE.panelText,
                                fontWeight: active ? 600 : 400,
                              }}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                {selectedNode && (() => {
                  const refs = nodeRouteRefs(selectedNode.id, plan.routes);
                  // 2026-11-15 用户：「明明出入口已经在动线上了，还是显示未在动线上」。
                  // 交界处自动建的出入口压在动线中段，不是起终点引用，但它确实连着——要一起算。
                  const onRoutes = nodeOnRoutes(selectedNode.position, plan.routes);
                  const routeIds = new Set([...refs.startRoutes, ...refs.endRoutes, ...onRoutes].map(route => route.id));
                  const routeCount = routeIds.size;
                  const anchored = refs.startRoutes.length + refs.endRoutes.length;
                  return (
                    <>
                      {/* 2026-11-15 用户指令「出入口也重新设计一下」：跟分区那块同一套语法——
                          标题行 + 行尾 ×，名字当标题写，状态用一只小圆点，动作只剩一个轻量的删除。 */}
                      <div style={{ ...sectionTitle, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ flex: 1 }}>已选中出入口</span>
                        <button
                          type="button"
                          data-testid="node-deselect"
                          aria-label="取消选择"
                          title="取消选择（Esc）"
                          onClick={() => selectNode(null)}
                          style={{
                            flex: '0 0 auto', width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            padding: 0, background: 'none', border: 'none', cursor: 'pointer',
                            color: PLANNING_SURFACE.panelText, opacity: 0.55, fontSize: 15, lineHeight: 1,
                          }}
                        >
                          ×
                        </button>
                      </div>
                      <div style={zoneRowStyle}>
                        <input
                          aria-label="选中出入口名称"
                          title="点一下改名字"
                          value={selectedNode.name}
                          maxLength={60}
                          onChange={event => updateNode(selectedNode.id, { name: event.target.value })}
                          style={{ flex: 1, minWidth: 0, background: 'transparent', color: PLANNING_SURFACE.panelText, border: '1px solid transparent', borderRadius: PLANNING_RADIUS.sm, fontSize: 14, fontWeight: 600, padding: '2px 4px' }}
                          onFocus={event => { event.currentTarget.style.borderColor = PLANNING_SURFACE.panelBorder; }}
                          onBlur={event => { event.currentTarget.style.borderColor = 'transparent'; }}
                        />
                      </div>
                      {/* 2026-11-15 用户：「类型」不当下拉菜单做——三个图标直接点，省一次展开。
                          2026-11-16 用户：「出入口不要图标，喜欢环形」——这里也改成同款空心环。 */}
                      <div style={zoneRowStyle}>
                        <span>类型</span>
                        <span role="group" aria-label="选中出入口类型" style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                          {NODE_KIND_OPTIONS.map(option => {
                            const active = selectedNode.kind === option.kind;
                            const ringColor = nodeStickerColor(option.kind);
                            return (
                              <button
                                key={option.kind}
                                type="button"
                                data-testid={`node-kind-${option.kind}`}
                                aria-label={`改为${option.label}`}
                                aria-pressed={active}
                                title={`改为${option.label}${active ? '（当前）' : ''}`}
                                onClick={() => { if (!active) updateNode(selectedNode.id, { kind: option.kind }); }}
                                style={{
                                  all: 'unset' as const,
                                  cursor: active ? 'default' : 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: 26,
                                  height: 26,
                                  borderRadius: 999,
                                  // 未选中只留描边，选中补一圈「已选」环（品牌绿点睛，不自造色）。
                                  boxShadow: active ? `0 0 0 1px #fff, 0 0 0 2.5px ${PLANNING_SURFACE.selectedBorder}` : 'none',
                                }}
                              >
                                <span
                                  aria-hidden
                                  style={{
                                    display: 'block',
                                    width: 18,
                                    height: 18,
                                    borderRadius: 999,
                                    border: `4.5px solid ${ringColor}`,
                                    boxSizing: 'border-box',
                                    background: 'transparent',
                                    // 未选中去色：三型仍然看得见（不靠颜色滴），但一眼能看出哪个是当前值。
                                    filter: active ? 'none' : 'grayscale(1)',
                                    opacity: active ? 1 : 0.55,
                                  }}
                                />
                              </button>
                            );
                          })}
                        </span>
                      </div>
                      <label style={zoneRowStyle}>
                        归属分区
                        <select
                          aria-label="选中出入口归属分区"
                          value={selectedNode.zoneId ?? ''}
                          onChange={event => updateNode(selectedNode.id, { zoneId: event.target.value || undefined })}
                          style={{ ...selectStyle, flex: 1, minWidth: 0 }}
                        >
                          <option value="">（自动 / 无）</option>
                          {levelView.zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
                        </select>
                      </label>
                      <div style={{ marginTop: PLANNING_SPACING.xs, display: 'flex', alignItems: 'center', gap: 6, fontSize: PLANNING_TYPOGRAPHY.hint, color: PLANNING_SURFACE.panelText, opacity: 0.8 }}>
                        <span
                          aria-hidden
                          style={{ width: 6, height: 6, borderRadius: 999, flex: '0 0 auto', background: routeCount === 0 ? PLANNING_SURFACE.dangerText : '#3E9E63' }}
                        />
                        <span>
                          {routeCount === 0
                            ? '未连接任何动线'
                            : anchored > 0
                              ? `已连接 ${routeCount} 条动线（起点 ${refs.startRoutes.length} / 终点 ${refs.endRoutes.length}）`
                              : `位于 ${routeCount} 条动线中段`}
                        </span>
                      </div>
                      <button
                        type="button"
                        data-testid="node-delete"
                        title="删除这个出入口"
                        style={{
                          marginTop: PLANNING_SPACING.sm, padding: 0, background: 'none', border: 'none', cursor: 'pointer',
                          color: PLANNING_SURFACE.dangerText, fontSize: PLANNING_TYPOGRAPHY.row,
                        }}
                        onClick={() => deleteNode(selectedNode.id)}
                      >
                        删除出入口
                      </button>
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
                    <label style={zoneRowStyle}>
                      固定角色
                      <select
                        aria-label="选中人员固定角色"
                        value={selectedWorker.assetId ?? ''}
                        onChange={event => updateWorker(selectedWorker.id, { assetId: event.target.value || undefined })}
                        style={{ ...selectStyle, flex: 1, minWidth: 0 }}
                      >
                        <option value="">按岗位自动分配</option>
                        {workerRoleOptions.map(role => <option key={role.assetId} value={role.assetId}>{role.name}</option>)}
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

                {/*
                  2026-11-17 #118 补录入 UI：车辆属性卡（车型 / 台数 / 归属分区 / 车型模型 / 删除）。
                  模型下拉只列该车型在物料库里登记过的 slug——没有就是「待补模型」，不许借近似车型。
                */}
                {selectedVehicle && (
                  <>
                    <div style={sectionTitle}>已选中车辆</div>
                    <div style={zoneRowStyle}>
                      <select
                        aria-label="选中车辆车型"
                        value={selectedVehicle.type}
                        onChange={event => updateVehicle(selectedVehicle.id, { type: event.target.value as PlanVehicle['type'] })}
                        style={{ ...selectStyle, flex: 1, minWidth: 0 }}
                      >
                        {VEHICLE_TYPES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                      <input
                        aria-label="选中车辆台数"
                        type="number"
                        min={1}
                        max={99}
                        value={selectedVehicle.count}
                        onChange={event => updateVehicle(selectedVehicle.id, { count: Math.max(1, Math.min(99, Math.floor(Number(event.target.value) || 1))) })}
                        style={{ width: 56, background: PLANNING_SURFACE.fieldBg, color: PLANNING_SURFACE.panelText, border: `1px solid ${PLANNING_SURFACE.panelBorder}`, borderRadius: PLANNING_RADIUS.sm, fontSize: PLANNING_TYPOGRAPHY.row, padding: '2px 4px' }}
                      />
                    </div>
                    <label style={zoneRowStyle}>
                      归属分区
                      <select
                        aria-label="选中车辆归属分区"
                        value={selectedVehicle.zoneId ?? ''}
                        onChange={event => updateVehicle(selectedVehicle.id, { zoneId: event.target.value || undefined })}
                        style={{ ...selectStyle, flex: 1, minWidth: 0 }}
                      >
                        <option value="">（自动 / 无）</option>
                        {levelView.zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
                      </select>
                    </label>
                    <label style={zoneRowStyle}>
                      车型模型
                      <select
                        aria-label="选中车辆模型"
                        value={selectedVehicle.modelSlug ?? ''}
                        onChange={event => updateVehicle(selectedVehicle.id, { modelSlug: event.target.value || undefined })}
                        style={{ ...selectStyle, flex: 1, minWidth: 0 }}
                      >
                        <option value="">（待补模型）</option>
                        {selectedVehicleModelSlugs.map(slug => <option key={slug} value={slug}>{slug}</option>)}
                      </select>
                    </label>
                    <div style={{ display: 'flex', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.xs }}>
                      <button
                        type="button"
                        data-testid="vehicle-delete"
                        style={modeButtonStyle(false)}
                        onClick={() => deleteVehicle(selectedVehicle.id)}
                      >
                        删除车辆
                      </button>
                      <button type="button" style={modeButtonStyle(false)} onClick={() => selectVehicle(null)}>
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

  /* 2026-11-16 用户指令（量距手感，四条一起落地）：
     ① 文字与线段平行、② 线段中间带过程标尺 → lib 的 drawMeasureRuler 直接画在线上；
     ③ 可多段线测量 → 距离按折线累计（路径入口 2026-11-17 下线）；
     ④ 退出自动删线 → setMode 离开 measure 时 dropMeasureSession()。
     这条底部卡片是“当前标尺”的总览与关闭口（× = 退出并清除）。 */
  const measureSessionIds = measureSessionIdsRef.current;
  const sessionMeasurements = (levelView.measurements ?? []).filter(item => measureSessionIds.includes(item.id));
  const measureDraftText = measureDraftReadout(measureKind, measureDraftRef.current, measureCursorRef.current ?? undefined);
  const measureRulerCard = mode === 'measure' && !readOnly ? (() => {
    let sessionLengthM = 0;
    let sessionAreaM2 = 0;
    for (const item of sessionMeasurements) {
      if (item.kind === 'area') sessionAreaM2 += measureValue(item);
      else sessionLengthM += measureValue(item);
    }
    const title = measureKind === 'area' ? '测量面积' : '测量距离';
    const value = measureKind === 'area'
      ? (measureDraftText ?? (sessionAreaM2 > 0 ? formatAreaM2(sessionAreaM2) : '拖出矩形或点选闭合'))
      : (measureDraftText ?? (sessionLengthM > 0 ? formatLengthM(sessionLengthM) : '点起点开始，可连续加段'));
    return (
      <div
        data-testid="measure-ruler-card"
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 92,
          transform: 'translateX(-50%)',
          zIndex: 25,
          minWidth: 232,
          maxWidth: 320,
          background: 'var(--sc-surface, #ffffff)',
          color: PLANNING_SURFACE.panelText,
          borderRadius: 12,
          border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
          boxShadow: '0 6px 22px rgba(15,22,32,0.24)',
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          pointerEvents: 'auto',
          fontSize: PLANNING_TYPOGRAPHY.row,
        }}
        onPointerDown={event => event.stopPropagation()}
        onDoubleClick={event => event.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <strong style={{ fontWeight: 700 }}>{title}</strong>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            data-testid="measure-ruler-close"
            aria-label="退出测量并清除本次测量"
            title="退出测量并清除本次测量"
            style={{
              all: 'unset',
              cursor: 'pointer',
              width: 18,
              height: 18,
              borderRadius: 999,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              lineHeight: 1,
              color: 'rgba(15,22,32,0.62)',
            }}
            onClick={event => { event.stopPropagation(); closeMeasureRuler(); }}
          >
            ×
          </button>
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        <div style={{ opacity: 0.72, fontSize: PLANNING_TYPOGRAPHY.hint }}>
          单击继续加点 / 拖动量一段；双击或「完成」结束；退出测量会自动清掉这条线
        </div>
      </div>
    );
  })() : null;

  return (
    <div
      ref={stageRef}
      style={{
        position: 'relative', width: '100%', height: '100%', overflow: 'hidden',
        cursor: scopeLockHover || boundaryLockHover
          ? 'pointer'
          : altHeld && branchAnchorHint
            ? 'copy'
            : boundaryLockedHover
            ? 'not-allowed'
            : boundaryVertexHover !== null
              ? 'grab'
              : boundaryEdgeHint
                ? 'copy'
                : scopeEdgeHover
                  ? (scopeEdgeIsHorizontal(scopeEdgeHover) ? 'ns-resize' : 'ew-resize')
                  : mode === 'view' ? (dragging ? 'grabbing' : 'grab') : 'crosshair',
      }}
      onMouseDown={handleStageMouseDown}
      onMouseMove={handleStageMouseMove}
      onMouseUp={handleStageMouseUp}
      onMouseLeave={handleStageMouseLeave}
      onDoubleClick={handleStageDoubleClick}
      onContextMenu={event => {
        // 视口边界（与 onWheel 同口径）：面板经 portal 挂在舞台 DOM 之外，右键合成事件仍沿 React 树冒泡，
        // 目标不在舞台子树内直接忽略，避免在面板里右键误退画布草稿或弹出层级菜单。
        const stageGate = stageRef.current;
        if (!stageGate || !stageGate.contains(event.target as Node)) return;
        // P2-l（用户 m05374）：画区域/边界/流线时右键 = 移除上一个节点；
        // 浏览/选择模式右键点中设施 = 统一菜单（复制/层级/删除，2026-11-14）。
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
        if (modeRef.current !== 'view' && modeRef.current !== 'select') return;
        const hit = eventPlanPoint(event);
        if (!hit) {
          setContextMenu(null);
          return;
        }
        const target = [...viewPlan().facilities].reverse().find(item => facilityContainsPoint(hit.pt, item));
        if (!target) {
          setContextMenu(null);
          return;
        }
        event.preventDefault();
        // 选择模式下组选让位给单件聚焦（菜单动作都按单件语义走）；浏览模式组选本就不成立。
        clearMultiSelection(false);
        if (!layerLocked('facility')) selectFacility(target.id);
        setContextMenu({ surface: 'stage-facility', x: event.clientX, y: event.clientY, facilityId: target.id });
      }}
      onDragOver={event => {
        // 2026-11-16 物料卡直接拖进 2D：按卡片左下角图标对应的设施落位，
        // dragover 读不到 dataTransfer，用拖起时记下的模型宽深先出幽灵。
        const catalogDrag = getPlanCatalogDrag();
        const dragTypes = Array.from(event.dataTransfer.types);
        if (dragTypes.includes(PLAN_CATALOG_DRAG_MIME)) {
          if (!catalogDrag) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          const hit = eventPlanPoint(event);
          if (hit) previewCatalogDrop(catalogDrag, hit.pt);
          return;
        }
        // 物料卡没带户外载荷（旧代码/禁用态）时不要退化成上一次的设施模板，否则会落成别的物件。
        if (dragTypes.includes(CATALOG_DRAG_MIME)) return;
        // 2026-11-16 直接从物件库拖进来：dragover 读不到 dataTransfer，
        // 用拖起时记下的模板 id 提前出幽灵（与 3D 地面同一来源）。
        const draggedTemplate = getPlanFacilityDrag();
        if (!draggedTemplate) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        const hit = eventPlanPoint(event);
        if (!hit) return;
        previewFacilityDrop(draggedTemplate, hit.pt);
      }}
      onDragLeave={() => {
        clearFacilityDropPreview();
      }}
      onDrop={event => {
        // H2-c：拖放提交（与单击提交同一入口）。
        event.preventDefault();
        const types = Array.from(event.dataTransfer.types);
        if (types.includes(PLAN_CATALOG_DRAG_MIME)) {
          const catalogDrag = parsePlanCatalogDrag(event.dataTransfer.getData(PLAN_CATALOG_DRAG_MIME)) ?? getPlanCatalogDrag();
          clearPlanCatalogDrag();
          if (!catalogDrag) return;
          const hit = eventPlanPoint(event);
          if (hit) dropCatalogAt(catalogDrag, hit.pt);
          return;
        }
        if (types.includes(CATALOG_DRAG_MIME)) return;
        const dragged = event.dataTransfer.getData('text/plain') || getPlanFacilityDrag();
        clearPlanFacilityDrag();
        const hit = eventPlanPoint(event);
        if (!dragged || !hit) return;
        dropFacilityAtPoint(dragged, hit.pt);
      }}
    >
      <canvas ref={baseCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-label="底图瓦片层" />
      <canvas ref={planCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} aria-label="户外规划业务图层" />
      {measureRulerCard}
      {/* 2026-11-12 用户「地图加载时页面灰扑扑」：底图补瓦片期间顶部居中一枚轻提示，
          全部结算（含失败）即收；pointer-events 无、不挡任何画布交互。 */}
      {basemapLoading && (
        <div className="pc-top-chip absolute left-1/2" style={{ top: 14, transform: 'translateX(-50%)', zIndex: 26, pointerEvents: 'none' }}>
          <div className="pc-glass pc-glass--dark" role="status" aria-live="polite"
            style={{ padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, fontWeight: 600, fontSize: PLANNING_TYPOGRAPHY.row, letterSpacing: '0.02em', color: 'var(--pc-cyan-glow, #35624A)' }}>
            <span className="pc-basemap-loading__spinner" aria-hidden="true" />
            底图加载中…
          </div>
        </div>
      )}
      {/* 2026-11-15 用户指令：边界/范围改小后，把越界分区摆到明面上，并给「一键收进 + 撤销」。
          挂舞台层而不是面板里：用户此刻在画布上，提示就在画布上；mousedown 拦截避免误触平移。 */}
      {zoneOverflow.length > 0 || zoneUndoAvailable ? (
        <div
          className="pc-top-chip absolute left-1/2"
          data-testid="zone-out-of-bounds-chip"
          style={{ top: basemapLoading ? 54 : 14, transform: 'translateX(-50%)', zIndex: 27 }}
          onMouseDown={event => event.stopPropagation()}
          onDoubleClick={event => event.stopPropagation()}
        >
          <div
            className="pc-glass pc-glass--dark"
            role="status"
            aria-live="polite"
            style={{ padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, fontSize: PLANNING_TYPOGRAPHY.row, color: PLANNING_SURFACE.warnText, maxWidth: 620 }}
          >
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor', flex: '0 0 auto' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {zoneOverflow.length > 0 ? (
                <>
                  {zoneOverflow.length} 个分区越界：{zoneOverflow.slice(0, 2).map(item => `${item.zoneName}（${zoneOverflowReason(item)}）`).join('、')}
                  {zoneOverflow.length > 2 ? ' 等' : ''}
                </>
              ) : (
                '分区已收进红线，原坐标已保留'
              )}
            </span>
            {zoneOverflow.length > 0 && (
              <button
                type="button"
                data-testid="zone-pull-into-bounds"
                title="把能自动摆回的分区收进红线（先平移，放不下再保形收缩）"
                style={chipButtonStyle}
                onClick={pullOverflowZonesIntoBounds}
              >
                一键收进红线
              </button>
            )}
            {zoneUndoAvailable && (
              <button
                type="button"
                data-testid="zone-pull-undo"
                title="恢复收进前的原坐标"
                style={chipButtonStyle}
                onClick={undoZonePull}
              >
                撤销
              </button>
            )}
          </div>
        </div>
      ) : null}
      {/* 2026-11-15 用户指令：分区重叠不影响继续编辑，只在画布上挂一条常驻报错；
          挪开就自动消失（不弹模态、不拦鼠标、不挡拖拽）。 */}
      {overlapNotices.length > 0 && (
        <div
          className="pc-top-chip absolute left-1/2"
          data-testid="zone-overlap-chip"
          style={{
            top: (basemapLoading ? 54 : 14) + (zoneOverflow.length > 0 || zoneUndoAvailable ? 44 : 0),
            transform: 'translateX(-50%)',
            zIndex: 28,
            pointerEvents: 'none',
          }}
        >
          <div
            className="pc-glass pc-glass--dark"
            role="alert"
            aria-live="assertive"
            style={{ padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, fontSize: PLANNING_TYPOGRAPHY.row, color: PLANNING_SURFACE.warnText, maxWidth: 640 }}
          >
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: '#E5484D', flex: '0 0 auto' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {overlapNotices.length} 处分区重叠：
              {overlapNotices.slice(0, 2).map(item => `${item.a} × ${item.b}`).join('、')}
              {overlapNotices.length > 2 ? ' 等' : ''}
              （可以继续编辑，挪开就消失）
            </span>
          </div>
        </div>
      )}
      {/* 2026-11-15 用户：「浮胶囊的功能并进右侧属性卡」——件数/复制删除与八向对齐已移到
          属性卡的 facility-group-panel，画布上不再压工具条，免得挡住宅区与动线。 */}

      {/* 2026-11-14 统一右键菜单（用户拍板「右键弹浮窗，不再右键即删」）：
          画布设施 = 复制 + 层级四项 + 删除；清单/面板行 = 按 kind 裁剪（分区/设施可复制）+ 删除。
          删除固定红字沉底加分隔线；菜单壳沿用 P2-l（viewport 防溢出 + 阻断画布按下/滚轮）。 */}
      {contextMenu && (() => {
        const close = () => setContextMenu(null);
        const items: { key: string; label: string; hint?: string; danger?: boolean; run: () => void }[] = [];
        if (contextMenu.surface === 'stage-facility') {
          const facilityId = contextMenu.facilityId;
          items.push({ key: 'duplicate', label: '复制', hint: 'Ctrl+D', run: () => { close(); duplicateFacility(facilityId); } });
          for (const [action, label] of [['up', '上移一层'], ['top', '置于顶层'], ['down', '下移一层'], ['bottom', '置于底层']] as const) {
            items.push({ key: `order-${action}`, label, run: () => { close(); reorderFacility(facilityId, action); } });
          }
        } else {
          const row = contextMenu.row;
          if (row.kind === 'zone') items.push({ key: 'duplicate', label: '复制', run: () => { close(); duplicateZone(row.id); } });
          else if (row.kind === 'facility') items.push({ key: 'duplicate', label: '复制', hint: 'Ctrl+D', run: () => { close(); duplicateFacility(row.id); } });
        }
        items.push({
          key: 'delete',
          label: '删除',
          hint: 'Del',
          danger: true,
          run: () => {
            close();
            if (contextMenu.surface === 'stage-facility') deleteFacility(contextMenu.facilityId);
            else deleteRow(contextMenu.row);
          },
        });
        return (
          <div
            ref={contextMenuElementRef}
            data-testid="plan-context-menu"
            role="menu"
            aria-label="实体操作"
            style={{
              position: 'fixed',
              left: Math.min(contextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1440) - 188),
              top: Math.min(contextMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 900) - 240),
              zIndex: 60,
              minWidth: 172,
              padding: 4,
              borderRadius: 10,
              background: PLANNING_SURFACE.panelBg,
              border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
              boxShadow: '0 12px 32px rgba(20, 20, 22, 0.28)',
            }}
            onMouseDown={stopPanelMouse}
            onWheel={stopPanelWheel}
            onContextMenu={event => event.preventDefault()}
          >
            {items.map(item => (
              <Fragment key={item.key}>
                {item.danger && items.some(other => !other.danger) && (
                  <div
                    role="separator"
                    style={{ height: 1, margin: '4px 6px', background: PLANNING_SURFACE.panelBorder }}
                  />
                )}
                <button
                  type="button"
                  role="menuitem"
                  data-testid={`plan-context-${item.key}`}
                  onClick={item.run}
                  style={{
                    all: 'unset',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    boxSizing: 'border-box',
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    color: item.danger ? PLANNING_SURFACE.dangerText : PLANNING_SURFACE.panelText,
                    fontSize: PLANNING_TYPOGRAPHY.row,
                  }}
                >
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.hint && (
                    <span style={{ color: PLANNING_TEXT.muted, fontSize: PLANNING_TYPOGRAPHY.hint }}>{item.hint}</span>
                  )}
                </button>
              </Fragment>
            ))}
          </div>
        );
      })()}

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
          onWheel={stopPanelWheel}
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
              display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs,
              padding: '4px 6px', borderRadius: PLANNING_RADIUS.sm,
              color: PLANNING_SURFACE.panelText, fontSize: PLANNING_TYPOGRAPHY.panel,
              cursor: 'pointer', minWidth: 0, flex: levelsPanelHost ? '1 1 0%' : '0 1 auto',
            }}
          >
            <LevelRowIcon size={PLANNING_ICON_SIZES.tool} />
            <span data-testid="levels-active-level-name" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{activeLevelName}</span>
            <span data-testid="levels-level-count" style={{ opacity: 0.6, fontSize: PLANNING_TYPOGRAPHY.row }}>({activeLevelIndex + 1}/{levelList.length})</span>
            <span aria-hidden style={{ fontSize: PLANNING_TYPOGRAPHY.hint, opacity: 0.55, marginLeft: 'auto' }}>{levelMenuOpen ? '▾' : '▸'}</span>
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
                width: 24, height: 24, borderRadius: PLANNING_RADIUS.sm,
                border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
                color: PLANNING_SURFACE.panelText, fontSize: PLANNING_TYPOGRAPHY.panel, cursor: 'pointer',
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
                图层是同一套场地的不同设计方案；用地红线与定位跨图层共享。
              </div>
            </div>
          )}
        </div>
      </PanelPortal>

      {/* 2026-11-15 用户：合并徽章的明细卡——点徽章才展开，不再把一排叹号撒在线上。 */}
      {conflictDetailKey && (() => {
        const cluster = conflictClusters.find(item => item.key === conflictDetailKey);
        if (!cluster) return null;
        const viewport = currentViewport();
        const pt = planPointToPixel(cluster.at, viewport);
        const cardW = 260;
        const half = cardW / 2 + 8;
        const left = Math.min(Math.max(pt.x, half), Math.max(half, viewport.canvasW - half));
        const anchorName = cluster.routeIds[0]
          ? planRef.current.routes.find(route => route.id === cluster.routeIds[0])?.name
          : cluster.zoneId
            ? planRef.current.zones.find(zone => zone.id === cluster.zoneId)?.name
            : undefined;
        return (
          <div
            data-testid="conflict-detail"
            style={{
              position: 'absolute', left, top: pt.y + 14, transform: 'translateX(-50%)', zIndex: 7, width: cardW,
              background: PLANNING_SURFACE.panelBg, border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
              borderRadius: PLANNING_RADIUS.md, boxShadow: '0 8px 22px rgba(20, 20, 22, 0.18)',
              padding: '6px 8px 7px', color: PLANNING_SURFACE.panelText, fontSize: PLANNING_TYPOGRAPHY.row,
              fontFamily: 'system-ui, sans-serif', textAlign: 'left',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {anchorName ? `「${anchorName}」` : '问题'} · {cluster.count} 条
              </span>
              <button
                type="button"
                aria-label="收起问题明细"
                title="收起"
                onClick={() => showConflictDetail(null)}
                style={{ all: 'unset' as const, cursor: 'pointer', padding: '0 2px', color: PLANNING_SURFACE.panelText, opacity: 0.55, fontSize: 13, lineHeight: 1 }}
              >
                ×
              </button>
            </div>
            <ul style={{ margin: '4px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {cluster.issues.map(issue => (
                <li key={issue.key} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <span
                    aria-hidden
                    style={{ width: 6, height: 6, flex: '0 0 auto', marginTop: 5, borderRadius: 999, background: PLANNING_CONFLICT_COLORS[issue.status] }}
                  />
                  <span style={{ flex: 1, minWidth: 0, lineHeight: 1.45 }}>
                    <b style={{ fontWeight: 600 }}>{PLAN_CONFLICT_CATEGORY_LABELS[issue.category]}</b>
                    {' · '}
                    {issue.message}
                  </span>
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 5, fontSize: PLANNING_TYPOGRAPHY.hint, color: PLANNING_TEXT.muted }}>
              同一对象只占一枚徽章；红色＝冲突，橙色＝缺宽度。
            </div>
          </div>
        );
      })()}

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
              color: PLANNING_SURFACE.panelText, fontSize: PLANNING_TYPOGRAPHY.panel, fontFamily: 'system-ui, sans-serif',
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
          {annotateDrawSelectionLabel(mode, annotateShape)
            ? `当前：${annotateDrawSelectionLabel(mode, annotateShape)} · 再点一次或 Esc 退出`
            : `当前：${PLANNING_EDIT_MODE_LABELS[mode]} · Esc 返回浏览`}
        </button>
      )}

      {/* H3-c 规划信息面板：宿主在 Bingo 面板里；Bingo 收起时整块不渲染（不再在画布顶部拉成横条）。 */}
      {!(infoPanelHostId && !infoPanelHost) && <PanelPortal host={infoPanelHost}>
      <div ref={infoPanelRef} style={infoPanelStyle} onMouseDown={stopPanelMouse} onMouseUp={stopPanelMouse} onDoubleClick={stopPanelMouse} onWheel={stopPanelWheel}>
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
                  <div>出入口 {overviewStats.nodeCount} · 人员 {overviewStats.workerTotalCount} 人 / {overviewStats.workerPostCount} 点 · 车辆 {overviewStats.vehicleTotalCount} 台 / {overviewStats.vehicleCount} 处</div>
                  <div>固定测量 {overviewStats.measurementCount}</div>
                  <div data-testid="info-issue-count">待处理问题 {overviewStats.issueCount + overviewStats.conflictCount}（冲突/缺失 {overviewStats.conflictCount}）</div>
                </div>
                <div style={sectionTitle}>当前可见（隐藏不改全案数字）</div>
                <div data-testid="info-visible-stats" style={{ opacity: 0.85 }}>
                  分区 {visibleCounts.zone} · 设施 {visibleCounts.facility} · 动线 {visibleCounts.route} · 出入口 {visibleCounts.node} · 人员 {visibleCounts.worker} · 车辆 {visibleCounts.vehicle} · 测量 {visibleCounts.measurement} · 标注 {visibleCounts.annotation}
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
                    {(['zone', 'facility', 'route', 'node', 'worker', 'vehicle', 'measurement', 'annotation'] as PlanInventoryKind[]).map(kind => (
                      <option key={kind} value={kind}>{planInventoryKindLabel(kind)}</option>
                    ))}
                  </select>
                  <select
                    aria-label="清单分区筛选"
                    value={invZoneActive ?? 'all'}
                    onChange={event => setInvZone(event.target.value === 'all' ? undefined : event.target.value)}
                    style={selectStyle}
                  >
                    <option value="all">全部分区</option>
                    <option value="unassigned">未归属（{invZoneCounts.unassigned}）</option>
                    {levelView.zones.map(zone => (
                      <option key={zone.id} value={zone.id}>{zone.name}（{invZoneCounts.counts.get(zone.id) ?? 0}）</option>
                    ))}
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input type="checkbox" checked={invIssuesOnly} onChange={event => setInvIssuesOnly(event.target.checked)} />
                    只看问题
                  </label>
                </div>
                <div data-testid="inventory-count" style={{ marginTop: PLANNING_SPACING.xs, opacity: 0.75 }}>
                  共 {filteredInventoryRows.length} 行 / 本层 {inventoryRows.length} 行
                </div>
                {filteredInventoryRows.length === 0 && (
                  <div data-testid="inventory-empty" style={{ marginTop: PLANNING_SPACING.xs, opacity: 0.7 }}>
                    {invZoneActive !== undefined && invZoneActive !== 'unassigned'
                      ? '这个分区里还没有物料或人员；把物料拖进分区就会自动归属到它。'
                      : invZoneActive === 'unassigned'
                        ? '所有物料和人员都已经归到分区里了。'
                        : '当前筛选下没有行。'}
                  </div>
                )}
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
                {/* 2026-11-16：图上默认只画真冲突（红）；缺宽度/容量待核实属于提示，这里给一个口子放出来。 */}
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: PLANNING_SPACING.xs, opacity: 0.8, cursor: 'pointer' }}
                  title="缺宽度 = 通行带没评估；容量是按面积估算的规划假设，不是法规口径；两者都是提示，不是冲突"
                >
                  <input
                    type="checkbox"
                    data-testid="info-show-unverified"
                    checked={showAdvisoryBadges}
                    onChange={event => toggleShowAdvisoryBadges(event.target.checked)}
                  />
                  图上显示提示类（缺宽度 / 容量待核实，默认不上图）
                </label>
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
                          {/* H4-b：能对上 OnePlan 贴纸的条目用真实 SVG，其余/缺图回落 Lucide（entry.icon）。
                              2026-11-15：芯片再衬条目自己的 swatch 色，图例三型出入口与画布芯片同色。 */}
                          <OneplanSticker
                            sticker={entry.sticker ?? null}
                            fallbackIcon={entry.icon}
                            color={entry.swatch}
                            chipColor={entry.chipColor}
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
      <div style={panelStyle} onMouseDown={stopPanelMouse} onMouseUp={stopPanelMouse} onDoubleClick={stopPanelMouse} onWheel={stopPanelWheel}>
        {/* 2026-11-11 OnePlan Placed Objects 镜像：头部计数 + 按类型分组的文件夹树。
            旧「图层栈与编辑/浏览/撤销/提示」清理掉——撤销走右栏工具排，浏览回 Esc，
            放置工具全在物件库页签（区域/入口/路线/基建/劳动力），本页签只管「画了什么」。 */}
        <button
          type="button"
          onClick={() => setPanelOpen(open => !open)}
          style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs, width: '100%', padding: '3px 4px', borderRadius: PLANNING_RADIUS.sm, color: PLANNING_SURFACE.panelText, fontWeight: 600 }}
          aria-expanded={panelOpen}
        >
          <LibraryFooterIcon size={PLANNING_ICON_SIZES.legend} aria-hidden color={PLANNING_SURFACE.panelText} />
          <span style={{ flex: 1 }}>已放置物件</span>
          <span style={{ opacity: 0.7, fontWeight: 400, fontSize: PLANNING_TYPOGRAPHY.hint }}>({inventoryRows.length}/{libraryTotal})</span>
          <span aria-hidden style={{ fontSize: PLANNING_TYPOGRAPHY.hint }}>{panelOpen ? '▾' : '▸'}</span>
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
                <div style={{ display: "flex", alignItems: "center", gap: PLANNING_SPACING.xs, flex: 1, minWidth: 0, padding: "3px 4px", color: PLANNING_SURFACE.panelText, fontSize: PLANNING_TYPOGRAPHY.row }}>
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
                        all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs,
                        flex: 1, minWidth: 0, padding: '3px 4px', borderRadius: PLANNING_RADIUS.sm,
                        color: PLANNING_SURFACE.panelText, fontSize: PLANNING_TYPOGRAPHY.row, fontWeight: 400,
                      }}
                    >
                      <span aria-hidden style={{ fontSize: PLANNING_TYPOGRAPHY.hint, width: 10 }}>{open ? '▾' : '▸'}</span>
                      {renderLayerEntityIcon(folder.rows[0])}
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder.label}</span>
                      <span style={{ opacity: 0.6, fontSize: PLANNING_TYPOGRAPHY.row }}>{folder.rows.length}</span>
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
                        // 2026-11-14 统一右键菜单：不再右键即删；stopPropagation 防冒泡进舞台处理器二次弹菜单。
                        onContextMenu: event => {
                          event.preventDefault();
                          event.stopPropagation();
                          setContextMenu({ surface: 'row', x: event.clientX, y: event.clientY, row });
                        },
                        title: '点击定位到地图；右键复制/删除',
                        icon: renderLayerEntityIcon(row),
                        trailing: <TypeCapsule kind={row.kind} label={row.typeLabel} />,
                      }))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* 用地红线文件夹（红线不在 inventory 里，单独一行）。 */}
            <div style={{ marginTop: PLANNING_SPACING.xs }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs }}>
                <button
                  type="button"
                  data-testid="placed-folder-boundary"
                  aria-expanded={openFolders['boundary'] !== false}
                  onClick={() => setOpenFolders(prev => ({ ...prev, boundary: !(prev.boundary !== false) }))}
                  style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs, flex: 1, minWidth: 0, padding: '3px 4px', borderRadius: PLANNING_RADIUS.sm, color: PLANNING_SURFACE.panelText, fontSize: PLANNING_TYPOGRAPHY.row, fontWeight: 400 }}
                >
                  <span aria-hidden style={{ fontSize: PLANNING_TYPOGRAPHY.hint, width: 10 }}>{openFolders['boundary'] !== false ? '▾' : '▸'}</span>
                  <BoundarySwatch size={16} />
                  <span style={{ flex: 1 }}>用地红线</span>
                  <span style={{ opacity: 0.6, fontSize: PLANNING_TYPOGRAPHY.row }}>{placedRedlineCount({
                    boundaryCount: plan.boundary.length,
                    searchArea,
                    previewBoundaryCount: workflowScopePreview ? (workflowPreview?.boundary.length ?? 0) : 0,
                  })}</span>
                </button>
                <input
                  type="checkbox"
                  aria-label="显示用地红线图层"
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
                      aria-label={`${locked ? '解锁' : '锁定'}用地红线图层`}
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
                  {placedItemsNeedsRedlineHint({
                    boundaryCount: plan.boundary.length,
                    searchArea,
                    previewBoundaryCount: workflowScopePreview ? (workflowPreview?.boundary.length ?? 0) : 0,
                  }) ? (
                    <div style={{ paddingLeft: 30, opacity: 0.7, fontSize: PLANNING_TYPOGRAPHY.hint }}>
                      还没画红线——物件库 → 区域 → 用地红线
                    </div>
                  ) : plan.boundary.length > 0 ? (
                    renderOneplanItemRow({
                      key: 'layer-entity-boundary',
                      testId: 'layer-entity-boundary',
                      label: `用地红线（${plan.boundary.length} 点）`,
                      active: false,
                      onClick: () => {
                        const cx = plan.boundary.reduce((s, p) => s + p.x, 0) / plan.boundary.length;
                        const cy = plan.boundary.reduce((s, p) => s + p.y, 0) / plan.boundary.length;
                        centerViewOn({ x: cx, y: cy });
                      },
                      title: '点击定位到红线',
                      icon: <BoundarySwatch size={16} />,
                    })
                  ) : (
                    renderOneplanItemRow({
                      key: 'layer-entity-visible-range',
                      testId: 'layer-entity-visible-range',
                      label: (workflowScopePreview && (workflowPreview?.boundary.length ?? 0) >= 3)
                        ? `候选活动范围（${workflowPreview!.boundary.length} 点）`
                        : (searchArea?.label || '地图上的活动范围'),
                      active: false,
                      onClick: () => {
                        const preview = workflowScopePreview && (workflowPreview?.boundary.length ?? 0) >= 3
                          ? workflowPreview!.boundary
                          : null;
                        const anchor = plan.anchor;
                        const overlay = !preview && searchArea && searchArea.kind !== 'line' && anchor
                          ? searchArea.polygon.map(([lng, lat]) => lngLatToEnu(lng, lat, anchor.lng, anchor.lat))
                          : null;
                        const pts = preview ?? overlay;
                        if (!pts?.length) return;
                        centerViewOn({
                          x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
                          y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
                        });
                      },
                      title: '点击定位到地图上的活动范围；核对后写入用地红线',
                      icon: <BoundarySwatch size={16} />,
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
            onWheel={stopPanelWheel}
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
                                label: plan.boundary.length > 0 ? '用地红线（重画）' : '用地红线',
                                active: mode === 'boundary',
                                onClick: () => armOrDisarm(mode === 'boundary', () => startAreaTool('boundary')),
                                title: '沿用地单击加顶点，闭合后替换旧红线',
                                icon: <BoundarySwatch size={22} />,
                              })}
                              {/* 2026-11-15 用户指令：先圈一块比场地大的「大陆」，框外压暗。 */}
                              {renderOneplanItemRow({
                                key: 'catalog-scope',
                                testId: 'catalog-scope',
                                label: (plan.designScope ?? []).length >= 3 ? '重拖设计范围' : '拖出设计范围',
                                active: mode === 'scope',
                                onClick: () => armOrDisarm(mode === 'scope', () => startAreaTool('scope')),
                                title: '按住拖一个矩形当设计范围：框外压暗，流线可以走在场地外、范围里',
                                icon: <ScopeSwatch size={22} />,
                              })}
                              {plan.boundary.length >= 3 && renderOneplanItemRow({
                                key: 'catalog-scope-expand',
                                testId: 'catalog-scope-expand',
                                label: `按场地外扩 ${DEFAULT_SCOPE_MARGIN_M} m`,
                                active: false,
                                onClick: () => {
                                  if (readOnly) return;
                                  // 手画十几点太贵：先给一个精确可用的外框，再拖顶点微调。
                                  // 矩形口径：取场地外接矩形四周各外扩，永远 4 个角。
                                  const next = expandRect(plan.boundary, DEFAULT_SCOPE_MARGIN_M);
                                  commitPlan({ ...planRef.current, designScope: next });
                                  setMode('view');
                                  // 生成即框住：刚生成的范围如果大半在视口外，压暗区会盖满屏幕，看着像没画。
                                  focusDesignScope(next);
                                  setEditMessage(`已按场地外接矩形外扩 ${DEFAULT_SCOPE_MARGIN_M} m（约 ${Math.round(scopeAreaM2(next))} m²）；要改就点「重拖设计范围」。`);
                                },
                                title: '各边外扩 20 m 直接生成设计范围，不用手画顶点',
                                icon: <ScopeSwatch size={22} plus />,
                              })}
                              {/* 2026-11-16 用户指令：这一行「定位到设计范围」去掉——同样的功能挪到右轨那颗
                                  焦点钮（#tool-focus）：圈了设计范围就框到范围，没圈还是回到场地取景。
                                  左栏不再重复摆一行只能动视图、不能改范围的条目。 */}
                              {(plan.designScope ?? []).length >= 3 && renderOneplanItemRow({
                                key: 'catalog-scope-clear',
                                testId: 'catalog-scope-clear',
                                label: '清除设计范围',
                                active: false,
                                onClick: () => {
                                  if (readOnly) return;
                                  commitPlan({ ...planRef.current, designScope: [] });
                                  setMode('view');
                                  setEditMessage('设计范围已清除：框外不再压暗。');
                                },
                                title: '去掉外框与蒙版（用地红线、分区、流线都不受影响）',
                                icon: <span aria-hidden style={{ width: 22, height: 22, flex: '0 0 auto', borderRadius: 6, background: 'rgba(255,255,255,0.08)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35)' }} />,
                              })}
                              {planZoneSemantics.map(s => {
                                const zoneActive = mode === 'zone' && zoneSemantic === s;
                                return renderOneplanItemRow({
                                key: `zone-${s}`,
                                testId: `catalog-zone-${s}`,
                                label: planZoneSemanticLabels[s],
                                active: zoneActive,
                                onClick: () => armOrDisarm(zoneActive, () => { setZoneSemantic(s); startAreaTool('zone'); }),
                                icon: <span aria-hidden style={{ width: 22, height: 22, flex: '0 0 auto', borderRadius: 6, background: PLANNING_ZONE_COLORS[s], boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.55)' }} />,
                              });
                              })}
                            </div>
                          )}
                          {renderOneplanSubgroupHeader({ sectionId: 'areas', key: '入口和通道图标', label: '入口和通道图标', count: libraryEntranceIcons.length + 1, icon: 'door-open' })}
                          {openLibrarySubgroups.includes('areas:入口和通道图标') && (
                            <>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {NODE_KIND_OPTIONS.map(option => {
                                  const nodeActive = mode === 'node' && nodeKind === option.kind;
                                  return renderOneplanItemRow({
                                    key: `node-${option.kind}`,
                                    testId: `catalog-node-${option.kind}`,
                                    label: option.label,
                                    active: nodeActive,
                                    onClick: () => armOrDisarm(nodeActive, () => { nodeKindRef.current = option.kind; setNodeKind(option.kind); draw(); startAreaTool('node'); }),
                                    icon: nodeKindToolIcon(option.kind),
                                  });
                                })}
                              </div>
                              {renderOneplanStickerRows(libraryEntranceIcons)}
                            </>
                          )}
                          {renderOneplanSubgroupHeader({ sectionId: 'areas', key: '路线', label: '路线', count: planRouteKinds.length, icon: 'route' })}
                          {openLibrarySubgroups.includes('areas:路线') && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {planRouteKinds.map(k => {
                                const routeActive = mode === 'route' && routeKind === k && !routePresetRef.current;
                                return renderOneplanItemRow({
                                key: `route-${k}`,
                                testId: `catalog-route-${k}`,
                                label: planRouteKindLabels[k],
                                active: routeActive,
                                onClick: () => armOrDisarm(routeActive, () => { routeKindRef.current = k; setRouteKind(k); draw(); startAreaTool('route'); }),
                                icon: <span aria-hidden style={{ width: 22, height: 22, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ width: 16, height: 5, borderRadius: 3, background: PLANNING_ROUTE_KIND_COLORS[k] }} /></span>,
                              });
                              })}
                            </div>
                          )}
                        </>
                      )}

                      {/* 2026-11-16 用户：车与「基础设施」同级、单独一行；行内是图标素材 */}
                      {renderOneplanGroupHeader({ id: 'vehicles', label: CAR_ROW_LABEL, count: VEHICLE_TYPES.length + libraryVehicleIcons.length, icon: 'truck' })}
                      {openLibrarySections.includes('vehicles') && (
                        <>
                          {/* 2026-11-17 #118 补录入 UI：规划车辆（落进 plan.vehicles，挂得上动线就巡游）。 */}
                          {renderOneplanSubgroupHeader({ sectionId: 'vehicles', key: 'plan-vehicles', label: PLAN_VEHICLE_ROW_LABEL, count: VEHICLE_TYPES.length })}
                          {openLibrarySubgroups.includes('vehicles:plan-vehicles') && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {VEHICLE_TYPES.map(type => renderOneplanItemRow({
                                key: `plan-vehicle-${type.id}`,
                                testId: `catalog-plan-vehicle-${type.id}`,
                                label: type.name,
                                active: mode === 'vehicle' && vehicleType === type.id,
                                onClick: () => armOrDisarm(mode === 'vehicle' && vehicleType === type.id, () => startVehicleType(type.id as PlanVehicle['type'])),
                                icon: <span aria-hidden style={{ width: 22, height: 22, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ width: 16, height: 8, borderRadius: 3, background: PLANNING_ROUTE_KIND_COLORS.vehicle }} /></span>,
                              }))}
                            </div>
                          )}
                          {/* 车素材：物料库物件（落成 facility），与上面的规划车辆不是一回事。 */}
                          {libraryVehicleIcons.length > 0 && renderOneplanStickerRows(libraryVehicleIcons)}
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

                      {/* 3. 工作人员 → 9 个岗位行（OnePlan Workforce 图标；主题色走物件库同一张调色板，同岗位永远同色） */}
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
                              onClick: () => armOrDisarm(mode === 'worker' && workerRole === role, () => startLaborRole(role)),
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
                                    background: workerRoleColor(role) ?? libraryEntryColor({ slug: sticker.slug }),
                                    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.28)',
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
              <LibraryFooterIcon size={PLANNING_ICON_SIZES.legend} aria-hidden color={PLANNING_SURFACE.panelText} />
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
            body: measureZone ?? <div style={{ opacity: 0.6, fontSize: PLANNING_TYPOGRAPHY.panel }}>只读浏览时不能测量。</div>,
          },
          {
            key: 'annotate',
            label: '标注',
            accent: PLANNING_LAYER_COLORS.annotate,
            count: levelView.annotations?.length ?? 0,
            testId: 'outdoor-inspector-card-annotate',
            body: annotateZone ?? <div style={{ opacity: 0.6, fontSize: PLANNING_TYPOGRAPHY.panel }}>只读浏览时不能标注。</div>,
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
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, padding: '12px 4px', textAlign: 'left', color: PLANNING_TEXT.muted }}>
                  {/* 2026-11-16 用户拍板「按第 1 条改」：删掉 5 个类型 chip，只留一句点选提示 + 打开物件库。
                      属性卡只负责“看/改选中物件的属性”；画/放这类创建入口归左栏物件库，不再在这里再开一份。 */}
                  <span style={{ fontSize: PLANNING_TYPOGRAPHY.panel, lineHeight: 1.6 }}>在图上点选物件，就能查看和修改它的属性。</span>
                  {!readOnly && (
                    <button
                      type="button"
                      data-testid="outdoor-inspector-open-library"
                      className="sc-empty-chip"
                      // 物件库是左栅「添加物件」页签，宿主不在画布内：发事件请左栅切过去，
                      // 与既有 `scendance:focus-object` 同一套跨组件做法（画布不持有左栅状态）。
                      onClick={() => window.dispatchEvent(new CustomEvent('scendance:open-outdoor-library'))}
                    >
                      打开物件库
                    </button>
                  )}
                </div>
              ),
          },
        ];
        const visible = cards.filter(card => inspectorPanels[card.key] && (card.key !== 'selection' || selectionPanelOn));
        if (visible.length === 0) {
          // 收起态不再画画布内浮条（入口在右轨圆钮，属性随选中实体自动浮出）。
          return null;
        }
        // 2026-11-12「3D 的时候也要可编辑」：接管态传了 inspectorHostId 时卡片 portal 出
        // 隐藏覆盖层出镜；2D 卡内无宿主，原地渲染不变。
        return (
          <PanelPortal host={inspectorPanelHost}>
          <div
            ref={inspectorPanelRef}
            data-testid="outdoor-inspector-stack"
            data-plan-panel=""
            onWheel={stopPanelWheel}
            onPointerDown={onInspectorPanelPointerDown}
            onPointerMove={onInspectorPanelPointerMove}
            onPointerUp={onInspectorPanelPointerUp}
            onPointerCancel={onInspectorPanelPointerUp}
            style={inspectorStackStyle(inspectorPanelPos)}
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
                  className={`sc-outdoor-toolcard${card.key === 'annotate' ? ' sc-outdoor-toolcard--annotate' : ''}`}
                  data-anchored={card.key === 'annotate' && annotateAnchor ? 'above-tool' : undefined}
                  onWheel={stopPanelWheel}
                  style={inspectorCardStyle({ key: card.key, annotateAnchor })}
                  onMouseDown={stopPanelMouse}
                  onMouseUp={stopPanelMouse}
                  onDoubleClick={stopPanelMouse}
                >
                  {card.key === 'annotate' && (
                    <div
                      data-testid="outdoor-inspector-card-annotate-head"
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 6px 2px 10px' }}
                    >
                      <span aria-hidden style={{ width: 12, height: 12, flex: '0 0 auto', borderRadius: 999, background: card.accent }} />
                      <span style={{ fontWeight: 600, letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>{card.label}</span>
                      {card.count > 0 && (
                        <span
                          aria-hidden
                          style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: withAlphaHex(card.accent, 0.14), color: card.accent, fontSize: PLANNING_TYPOGRAPHY.hint, fontWeight: 600, lineHeight: '18px', textAlign: 'center' }}
                        >
                          {card.count}
                        </span>
                      )}
                      <button
                        type="button"
                        data-testid="outdoor-inspector-card-annotate-close"
                        aria-label="关闭标注卡片"
                        title="关闭标注"
                        onClick={() => {
                          setInspectorPanel('annotate', false);
                          if (mode === 'note' || mode === 'shape') setMode('view');
                          setAnnotateNotice(null);
                        }}
                        className="sc-outdoor-toolcard-btn"
                        style={{ marginLeft: 'auto', cursor: 'pointer', width: 24, height: 24, flex: '0 0 auto', borderRadius: 7, display: 'grid', placeItems: 'center', color: '#3f4448' }}
                      >
                        <MaterialSymbol name="close" size={16} />
                      </button>
                    </div>
                  )}
                  {card.key !== 'annotate' && (
                  <div data-inspector-header="" onClickCapture={onInspectorPanelHeaderClickCapture} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 6px 6px 8px', cursor: 'grab' }}>
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
                          style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: withAlphaHex(card.accent, 0.14), color: card.accent, fontSize: PLANNING_TYPOGRAPHY.hint, fontWeight: 600, lineHeight: '18px', textAlign: 'center' }}
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
                  )}
                  {(!collapsed || card.key === 'annotate') && (
                    <div style={inspectorCardBodyStyle({ key: card.key })}>{card.body}</div>
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
