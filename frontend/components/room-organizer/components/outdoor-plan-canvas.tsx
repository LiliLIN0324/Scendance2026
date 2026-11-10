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
 * - 测量模式三类型：距离（两点自动固定）/ 面积（近首点闭合或「完成测量」）/
 *   路径（双击或「完成测量」提交）；草稿期实时读数跟指针（临时测量，Esc 丢弃）；
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

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultLayerVisibility,
  drawAccessLayer,
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
  drawWorkerLayer,
  drawZoneLayer,
  enuToLngLat,
  isLayerVisible,
  planMetersPerPixel,
  planPixelToPoint,
  planPointToPixel,
  type LayerVisibility,
  type PlanViewport,
} from '../lib/outdoor-plan-canvas';
import {
  PLAN_CONFLICT_CATEGORY_LABELS,
  planConflictIssues,
  type PlanConflictIssue,
} from '../lib/site-plan-conflicts';
import {
  PLAN_ISSUE_LIST_LIMIT,
  PLAN_MIN_VERTEX_GAP_M,
  PLAN_RING_MAX_VERTICES,
  buildZone,
  checkBoundaryRing,
  defaultZoneColor,
  moveRingVertex,
  planPointDistanceM,
  planRingSelfIntersects,
  planZoneIssues,
  type PlanZoneIssue,
} from '../lib/site-plan-editing';
import {
  PLAN_FACILITY_TEMPLATES,
  buildFacility,
  facilityContainsPoint,
  facilityFootprintRing,
  facilityPlacementIssues,
  findFacilityTemplate,
  planFacilityIssues,
  type PlanFacilityIssue,
} from '../lib/site-plan-facilities';
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
  workerRoleSummary,
  workerZoneSummary,
  type PlanNodeIssue,
  type PlanWorkerIssue,
} from '../lib/site-plan-routes';
import {
  PLAN_MEASURE_MAX_VERTICES,
  buildMeasurement,
  formatAreaM2,
  formatLengthM,
  measureValue,
  planOverviewStats,
  type PlanMeasureKind,
} from '../lib/site-plan-measure';
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
  publicSourceTileUrl,
  tdtProbeTileUrl,
  visibleTileGrid,
  type ProbePublicSource,
  type TdtProbeLayer,
} from '../lib/tdt-probe';
import { planningIcon } from './outdoor-plan-icons';
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

export type CanvasBasemapSource = TdtProbeLayer | ProbePublicSource;

interface View {
  lng: number;
  lat: number;
  zoom: number;
}

export interface OutdoorPlanCanvasProps {
  plan: SitePlanData;
  /** 图源：默认 OSM 街道（公开免费）。天地图两档待 key。 */
  source?: CanvasBasemapSource;
  initialView?: Partial<View>;
  /** 图层可见性（受控模式）；缺省全开、组件内开关直接生效。 */
  visibility?: LayerVisibility;
  onVisibilityChange?: (next: LayerVisibility) => void;
  onViewChange?: (next: View) => void;
  /** H2-b：编辑提交回调（边界更新/顶点移动/新增分区/分区样式）。不传则只读浏览。 */
  onPlanChange?: (plan: SitePlanData) => void;
}

const TILE = 256;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const isTdt = (s: CanvasBasemapSource): s is TdtProbeLayer => s === 'vec' || s === 'img';

const LAYER_ORDER: readonly ['boundary', 'zone', 'facility', 'route', 'worker', 'access', 'measure'] = ['boundary', 'zone', 'facility', 'route', 'worker', 'access', 'measure'];

/** 顶点手柄的命中半径（CSS px），与 drawBoundaryLayer 的手柄绘制半径一致。 */
const VERTEX_HANDLE_HIT_PX = 10;
/** 首顶点闭合热区半径（CSS px），与 drawDraftLayer 的闭合圆圈一致。 */
const DRAFT_CLOSE_HIT_PX = 10;
/** 区分「单击加顶点」与「拖拽平移」的位移阈值（CSS px）。 */
const CLICK_MAX_MOVE_PX = 4;
/** 出入口节点命中/吸附半径（CSS px）：点选与动线端点吸附共用。 */
const NODE_HIT_PX = 11;
/** 人员点位命中半径（CSS px）。 */
const WORKER_HIT_PX = 9;
/** 路线折线命中半径（CSS px）：点到段距离。 */
const ROUTE_HIT_PX = 8;
/** undo 栈深度上限（评审稿「撤销和恢复均保留有效引用」；快照体积小，30 步足够）。 */
const UNDO_LIMIT = 30;

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
};
const INVENTORY_KIND_COLORS: Record<PlanInventoryKind, string> = {
  zone: PLANNING_LAYER_COLORS.zone,
  facility: PLANNING_LAYER_COLORS.facility,
  route: PLANNING_LAYER_COLORS.route,
  node: PLANNING_LAYER_COLORS.node,
  worker: PLANNING_LAYER_COLORS.worker,
  measurement: PLANNING_LAYER_COLORS.measure,
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

export default function OutdoorPlanCanvas({
  plan,
  source = 'osm',
  initialView,
  visibility,
  onVisibilityChange,
  onViewChange,
  onPlanChange,
}: OutdoorPlanCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const planCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({
    lng: initialView?.lng ?? (plan.anchor?.lng ?? 120.141306),
    lat: initialView?.lat ?? (plan.anchor?.lat ?? 30.2545),
    zoom: initialView?.zoom ?? 16,
  });
  const sourceRef = useRef<CanvasBasemapSource>(source);
  const planRef = useRef<SitePlanData>(plan);
  const panRef = useRef<{ x: number; y: number }>();
  const layerStateRef = useRef<LayerVisibility>(visibility ?? defaultLayerVisibility());

  // H2-b 编辑状态（state 供渲染面板，ref 供稳定 draw() 读取）。
  const modeRef = useRef<PlanningEditMode>('view');
  const draftRef = useRef<PlanPoint[]>([]);
  const previewRingRef = useRef<PlanPoint[] | null>(null);
  const dragVertexRef = useRef<number | null>(null);
  const downPxRef = useRef<{ x: number; y: number } | null>(null);
  const issuesRef = useRef<PlanZoneIssue[]>([]);
  // H2-c 设施放置：待放模板、幽灵位置、选中设施。
  const facilityTemplateRef = useRef<string | null>(null);
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
  const workerRoleRef = useRef('安保');
  const workerCountRef = useRef(1);
  const selectedRouteRef = useRef<string | null>(null);
  const selectedNodeRef = useRef<string | null>(null);
  const selectedWorkerRef = useRef<string | null>(null);
  const nodeIssuesRef = useRef<PlanNodeIssue[]>([]);
  const workerIssuesRef = useRef<PlanWorkerIssue[]>([]);
  const dragNodeRef = useRef<{ id: string; moved: boolean } | null>(null);
  const nodeDragPreviewRef = useRef<{ node: PlanNode; routes: PlanRoute[] } | null>(null);
  const historyRef = useRef<SitePlanData[]>([]);
  // H3-a 测量：类型、草稿、指针（临时读数）。
  const measureKindRef = useRef<PlanMeasureKind>('distance');
  const measureDraftRef = useRef<PlanPoint[]>([]);
  const measureCursorRef = useRef<PlanPoint | null>(null);
  // H3-b 冲突/缺失：可定位标记（规则检查输出，恒在业务层之上）。
  const conflictIssuesRef = useRef<PlanConflictIssue[]>([]);

  const [view, setView] = useState<View>({ ...viewRef.current });
  const [dragging, setDragging] = useState(false);
  const [layerState, setLayerState] = useState<LayerVisibility>(visibility ?? defaultLayerVisibility());
  const [panelOpen, setPanelOpen] = useState(true);
  const [mode, setModeState] = useState<PlanningEditMode>('view');
  const [zoneSemantic, setZoneSemantic] = useState<PlanningZoneSemantic>('audience');
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<PlanZoneIssue[]>([]);
  const [facilityTemplateId, setFacilityTemplateId] = useState<string | null>(null);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(null);
  const [facilityIssues, setFacilityIssues] = useState<PlanFacilityIssue[]>([]);
  const [routeKind, setRouteKind] = useState<PlanningRouteKind>('pedestrian');
  const [routeOneWay, setRouteOneWay] = useState(false);
  const [routeDraftCount, setRouteDraftCount] = useState(0);
  const [nodeKind, setNodeKind] = useState<PlanNode['kind']>('entry');
  const [workerRole, setWorkerRole] = useState('安保');
  const [workerCount, setWorkerCount] = useState(1);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [nodeIssues, setNodeIssues] = useState<PlanNodeIssue[]>([]);
  const [workerIssues, setWorkerIssues] = useState<PlanWorkerIssue[]>([]);
  const [historyCount, setHistoryCount] = useState(0);
  const [measureKind, setMeasureKind] = useState<PlanMeasureKind>('distance');
  const [measureDraftCount, setMeasureDraftCount] = useState(0);
  const [conflictIssues, setConflictIssues] = useState<PlanConflictIssue[]>([]);
  // H3-c 规划信息面板：页签、开关、筛选与提示消息（面板自带 status 行，只读也可用）。
  const [infoOpen, setInfoOpen] = useState(true);
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
    measureDraftRef.current = [];
    measureCursorRef.current = null;
    dragNodeRef.current = null;
    nodeDragPreviewRef.current = null;
    setRouteDraftCount(0);
    setMeasureDraftCount(0);
    setModeState(next);
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

  /** 编辑提交：undo 栈推入旧快照（上限 UNDO_LIMIT），再同步 ref 与父级。 */
  function commitPlan(next: SitePlanData) {
    historyRef.current.push(planRef.current);
    if (historyRef.current.length > UNDO_LIMIT) historyRef.current.shift();
    setHistoryCount(historyRef.current.length);
    planRef.current = next;
    onPlanChange?.(next);
  }

  /** 撤销（Ctrl+Z / 面板按钮）：弹出栈顶恢复；选中实体可能随撤销消失，全清选中。 */
  function undoPlan() {
    const prev = historyRef.current.pop();
    if (!prev) return;
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

  useEffect(() => {
    planRef.current = plan;
    issuesRef.current = planZoneIssues(plan);
    setIssues(issuesRef.current);
    facilityIssuesRef.current = planFacilityIssues(plan);
    setFacilityIssues(facilityIssuesRef.current);
    nodeIssuesRef.current = planNodeIssues(plan);
    setNodeIssues(nodeIssuesRef.current);
    workerIssuesRef.current = planWorkerIssues(plan);
    setWorkerIssues(workerIssuesRef.current);
    conflictIssuesRef.current = planConflictIssues(plan);
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
    const current = planRef.current;
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
    const centerPx = (v.lng + 180) / 360 * world;
    const latRad = v.lat * Math.PI / 180;
    const centerPy = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * world;
    const grid = visibleTileGrid(v.lng, v.lat, v.zoom, cssW, cssH);
    grid.tiles.forEach(({ x, y }) => {
      const left = x * TILE - centerPx + cssW / 2;
      const top = y * TILE - centerPy + cssH / 2;
      const drawTile = (url: string) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => baseCtx.drawImage(img, left, top, TILE, TILE);
        img.src = url;
      };
      if (isTdt(activeSource)) {
        const pair = tdtProbeTileUrl(activeSource, v.zoom, x, y);
        drawTile(pair.base);
        drawTile(pair.annotation);
      } else {
        drawTile(publicSourceTileUrl(activeSource, v.zoom, x, y));
      }
    });

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
      drawZoneLayer(
        { ctx: planCtx, viewport },
        current.zones.map(zone => ({ ...zone, warning: warningZoneIds.has(zone.id) })),
      );
    }
    if (isLayerVisible(vis, 'facility')) {
      const warningFacilityIds = new Set(
        facilityIssuesRef.current.filter(i => i.issue.code === 'out-of-boundary').map(i => i.facilityId),
      );
      drawFacilityLayer(
        { ctx: planCtx, viewport },
        current.facilities.map(f => ({ ...f, warning: warningFacilityIds.has(f.id) })),
        { selectedId: selectedFacilityRef.current },
      );
    }
    if (isLayerVisible(vis, 'route')) {
      drawRouteLayer(
        { ctx: planCtx, viewport },
        routes.map(r => ({ ...r, selected: r.id === selectedRouteRef.current })),
      );
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
    }
    // H3-a 固定测量标注（测量图层在最上层；隐藏测量层不影响数据与统计）。
    if (isLayerVisible(vis, 'measure')) {
      drawMeasureLayer({ ctx: planCtx, viewport }, current.measurements ?? []);
    }

    // H3-b 冲突/缺失可定位标记：规则检查输出，恒画在业务层之上（不随图层隐藏），
    // 点击命中判定由组件按同半径处理（定位到关联动线）。
    drawConflictMarkers({ ctx: planCtx, viewport }, conflictIssuesRef.current);

    // 3) 绘制草稿（画边界/画分区）：≥3 点后闭合预览；形状非法（自交）画红色。
    const activeMode = modeRef.current;
    if (activeMode === 'boundary' || activeMode === 'zone') {
      const draftPoints = draftRef.current;
      if (draftPoints.length > 0) {
        const draftColor = activeMode === 'zone' ? defaultZoneColor(zoneSemanticRef.current) : PLANNING_LAYER_COLORS.boundary;
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
    if (activeMode === 'node' && nodeGhostRef.current) {
      const names = { entry: '入口', exit: '出口', both: '出入口' } as const;
      drawNodeGhost({ ctx: planCtx, viewport }, nodeKindRef.current, names[nodeKindRef.current], nodeGhostRef.current);
    }

    // 5) 设施放置幽灵（H2-c）：跟随指针的占地预览，越界变红；叠加在所有图层之上。
    if (activeMode === 'facility' && ghostPointRef.current && facilityTemplateRef.current) {
      const template = findFacilityTemplate(facilityTemplateRef.current);
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
  }, []);

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
      if (event.key !== 'Escape') return;
      if (modeRef.current === 'view') return;
      setMode('view');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function currentViewport(): PlanViewport {
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

  function eventPlanPoint(event: { clientX: number; clientY: number }): { px: { x: number; y: number }; pt: PlanPoint } | null {
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
    commitView({ ...v, zoom: clamp(v.zoom + dir, 3, 18) });
  }

  /** 图层栈开关：切换某层可见并回传（受控/非受控均生效）。 */
  function setLayerVisible(kind: PlanningLayerKind, visible: boolean) {
    const next = { ...layerState, [kind]: visible };
    setLayerState(next);
    layerStateRef.current = next;
    onVisibilityChange?.(next);
    draw();
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
      const name = `${planZoneSemanticLabels[semantic]} ${current.zones.length + 1}`;
      const result = buildZone({ semantic, name, polygon: draftPoints }, current.boundary, current.zones);
      if (!result.ok) {
        setEditMessage(result.issue.message);
        return;
      }
      commitPlan({ ...current, zones: [...current.zones, result.value] });
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
    draw();
  }

  /** 在面板点选模板（也可直接拖拽到画布）：记录待放模板，幽灵随鼠标。 */
  function pickFacilityTemplate(templateId: string) {
    facilityTemplateRef.current = templateId;
    setFacilityTemplateId(templateId);
    setEditMessage(null);
    draw();
  }

  function placeFacilityAt(pt: PlanPoint) {
    const templateId = facilityTemplateRef.current;
    if (!templateId) {
      setEditMessage('先在面板点选一个设施模板。');
      return;
    }
    const template = findFacilityTemplate(templateId);
    if (!template) {
      setEditMessage(`设施模板「${templateId}」不存在。`);
      return;
    }
    const current = planRef.current;
    const result = buildFacility({ templateId, position: pt }, current.boundary, current.facilities);
    if (!result.ok) {
      setEditMessage(result.issue.message);
      return;
    }
    commitPlan({ ...current, facilities: [...current.facilities, result.value] });
    selectFacility(result.value.id);
    const hint = result.issues && result.issues.length > 0 ? `，注意：${result.issues.map(i => i.message).join('；')}` : '';
    setEditMessage(`已放置「${result.value.name}」，继续单击放置或 Esc 结束${hint}`);
  }

  function updateFacility(id: string, patch: Partial<Pick<PlanFacility, 'name' | 'notes'>>) {
    // 空名会让 plan 过不了契约校验：改名时忽略空值。
    if (patch.name !== undefined && patch.name.trim().length === 0) return;
    const current = planRef.current;
    commitPlan({ ...current, facilities: current.facilities.map(f => (f.id === id ? { ...f, ...patch } : f)) });
  }

  function deleteFacility(id: string) {
    const current = planRef.current;
    commitPlan({ ...current, facilities: current.facilities.filter(f => f.id !== id) });
    selectFacility(null);
    setEditMessage('设施已删除。');
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

  /** 命中检测：最近的出入口节点（NODE_HIT_PX 内），无则 null。 */
  function nearestNodeIdAt(px: { x: number; y: number }): string | null {
    let best: { id: string; d: number } | null = null;
    for (const n of planRef.current.nodes) {
      const pt = planPointToPixel(n.position, currentViewport());
      const d = Math.hypot(pt.x - px.x, pt.y - px.y);
      if (d <= NODE_HIT_PX && (best === null || d < best.d)) best = { id: n.id, d };
    }
    return best?.id ?? null;
  }

  /** 命中检测：最近的人员点位（WORKER_HIT_PX 内），无则 null。 */
  function nearestWorkerIdAt(px: { x: number; y: number }): string | null {
    let best: { id: string; d: number } | null = null;
    for (const w of planRef.current.workers) {
      const pt = planPointToPixel(w.position, currentViewport());
      const d = Math.hypot(pt.x - px.x, pt.y - px.y);
      if (d <= WORKER_HIT_PX && (best === null || d < best.d)) best = { id: w.id, d };
    }
    return best?.id ?? null;
  }

  /** 命中检测：最近的路线折线（ROUTE_HIT_PX 内的点到段距离），无则 null。 */
  function nearestRouteIdAt(px: { x: number; y: number }): string | null {
    let best: { id: string; d: number } | null = null;
    for (const r of planRef.current.routes) {
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

  /** 动线端点吸附：SNAP 距离内的最近节点，返回 {nodeId, position} 或 null。 */
  function snapNodeAt(pt: PlanPoint): { nodeId: string; position: PlanPoint } | null {
    const vp = currentViewport();
    const metersPerPx = planMetersPerPixel(vp);
    const snapM = NODE_HIT_PX * metersPerPx;
    let best: { nodeId: string; position: PlanPoint; d: number } | null = null;
    for (const n of planRef.current.nodes) {
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
    const startSnap = snapNodeAt(draftPoints[0]!);
    const endSnap = snapNodeAt(draftPoints[draftPoints.length - 1]!);
    const points = draftPoints.map((p, i) => {
      if (i === 0 && startSnap) return startSnap.position;
      if (i === draftPoints.length - 1 && endSnap && endSnap.nodeId !== startSnap?.nodeId) return endSnap.position;
      return p;
    });
    const result = buildRoute(
      {
        kind: routeKindRef.current,
        name: `${planRouteKindLabels[routeKindRef.current]}动线 ${current.routes.length + 1}`,
        points,
        oneWay: routeOneWayRef.current,
        ...(startSnap ? { startNodeId: startSnap.nodeId } : {}),
        ...(endSnap && endSnap.nodeId !== startSnap?.nodeId ? { endNodeId: endSnap.nodeId } : {}),
      },
      current.nodes,
    );
    if (!result.ok) {
      setEditMessage(result.issue.message);
      return;
    }
    commitPlan({ ...current, routes: [...current.routes, result.value] });
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
      name: `${names[nodeKindRef.current]} ${current.nodes.length + 1}`,
      position: { x: pt.x, y: pt.y },
      notes: '',
    };
    commitPlan({ ...current, nodes: [...current.nodes, node] });
    selectNode(node.id);
    setEditMessage(`已放置「${node.name}」，继续单击放置或 Esc 结束。`);
  }

  /** 布人员模式单击：岗位/人数取面板值，落点自动归属分区；连续放置。 */
  function placeWorkerAt(pt: PlanPoint) {
    const current = planRef.current;
    const result = buildWorker(
      { role: workerRoleRef.current, count: workerCountRef.current, position: pt },
      current.boundary,
      current.zones,
    );
    if (!result.ok) {
      setEditMessage(result.issue.message);
      return;
    }
    commitPlan({ ...current, workers: [...current.workers, result.value] });
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
        ? '面积测量至少要 3 个点：单击加顶点，点回起点或点「完成测量」闭合。'
        : kind === 'distance'
          ? '距离测量需要 2 个点。'
          : '路径测量至少要 2 个点：单击加路径点，双击或点「完成测量」提交。');
      return;
    }
    const current = planRef.current;
    const existing = current.measurements ?? [];
    const result = buildMeasurement({
      kind,
      name: `${planMeasurementKindLabels[kind]} ${existing.length + 1}`,
      points: draft,
    });
    if (!result.ok) {
      setEditMessage(result.issue.message);
      return;
    }
    commitPlan({ ...current, measurements: [...existing, result.value] });
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

  /** 清单行 → 地图：居中锚点 + 选中实体（分区/测量无选中态，仅居中）。 */
  function locateRow(row: PlanInventoryRow) {
    centerViewOn(row.anchor);
    if (row.kind === 'facility') {
      selectRoute(null);
      selectNode(null);
      selectWorker(null);
      selectFacility(row.id);
    } else if (row.kind === 'route') {
      selectRoute(row.id);
    } else if (row.kind === 'node') {
      selectNode(row.id);
    } else if (row.kind === 'worker') {
      selectWorker(row.id);
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

  function handleStageMouseDown(event: React.MouseEvent) {
    const activeMode = modeRef.current;
    const hit = eventPlanPoint(event);
    if (activeMode === 'view') {
      // H2-d：浏览模式按住出入口节点即拖动（引用路线端点随动），不启动平移。
      if (hit) {
        const nodeId = nearestNodeIdAt(hit.px);
        if (nodeId) {
          dragNodeRef.current = { id: nodeId, moved: false };
          downPxRef.current = hit.px;
          setDragging(true);
          return;
        }
      }
      panRef.current = { x: event.clientX, y: event.clientY };
      downPxRef.current = hit ? hit.px : null;
      setDragging(true);
      return;
    }
    if (!hit) return;
    downPxRef.current = hit.px;
    if (activeMode === 'boundary-vertex') {
      dragVertexRef.current = nearestBoundaryVertexIndex(hit.px);
    }
  }

  function handleStageMouseMove(event: React.MouseEvent) {
    const activeMode = modeRef.current;
    if (activeMode === 'view') {
      // H2-d：拖动出入口节点 → 引用路线端点随动预览（松手提交）。
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
      const result = moveRingVertex(previewRingRef.current ?? planRef.current.boundary, dragVertexRef.current, hit.pt);
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
    // H3-a：测量临时读数跟指针。
    if (activeMode === 'measure') {
      const hit = eventPlanPoint(event);
      if (!hit) return;
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
  }

  function handleStageMouseUp(event: React.MouseEvent) {
    const activeMode = modeRef.current;
    if (activeMode === 'view') {
      const down = downPxRef.current;
      downPxRef.current = null;
      panRef.current = undefined;
      setDragging(false);
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
          const hitNode = nearestNodeIdAt(hit.px);
          if (hitNode) { selectNode(hitNode); setInfoTab('inventory'); return; }
          const hitWorker = nearestWorkerIdAt(hit.px);
          if (hitWorker) { selectWorker(hitWorker); setInfoTab('inventory'); return; }
          const hitRoute = nearestRouteIdAt(hit.px);
          if (hitRoute) { selectRoute(hitRoute); setInfoTab('inventory'); return; }
          const hitFacility = [...planRef.current.facilities].reverse().find(f => facilityContainsPoint(hit.pt, f));
          selectFacility(hitFacility ? hitFacility.id : null);
          if (hitFacility) setInfoTab('inventory');
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
    // 绘制模式：位移小于阈值的抬起才算单击加顶点。
    const hit = eventPlanPoint(event);
    const down = downPxRef.current;
    downPxRef.current = null;
    if (!hit || !down) return;
    if (Math.hypot(hit.px.x - down.x, hit.px.y - down.y) > CLICK_MAX_MOVE_PX) return;
    handleDrawClick(hit.px, hit.pt);
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
    measureCursorRef.current = null;
    // 节点拖动中离开画布：预览不提交，回弹原位。
    dragNodeRef.current = null;
    nodeDragPreviewRef.current = null;
    draw();
  }

  const readOnly = !onPlanChange;
  // H2-c/H2-d/H3-b：冲突标记 + 分区 + 设施 + 节点（未连接）+ 人员（越界）问题合并成一张可读清单。
  // 冲突条目按状态着色（冲突红/缺失橙/待核实灰，tokens 同源），其余实体问题沿用默认色。
  const conflictTextColors: Record<PlanConflictIssue['status'], string> = {
    conflict: PLANNING_CONFLICT_COLORS.conflict,
    missing: PLANNING_CONFLICT_COLORS.missing,
    unverified: PLANNING_CONFLICT_COLORS.unverified,
  };
  const combinedIssues: { key: string; text: string; color?: string }[] = [
    ...conflictIssues.map(item => ({
      key: `c-${item.key}`,
      text: `${item.status === 'conflict' ? '⚠' : item.status === 'missing' ? '缺' : '核'} ${PLAN_CONFLICT_CATEGORY_LABELS[item.category]}：${item.message}`,
      color: conflictTextColors[item.status],
    })),
    ...issues.map((item, i) => ({ key: `z-${item.zoneId}-${item.issue.code}-${i}`, text: `${item.zoneName}：${item.issue.message}`, color: undefined })),
    ...facilityIssues.map((item, i) => ({ key: `f-${item.facilityId}-${i}`, text: `${item.facilityName}：${item.issue.message}` })),
    ...nodeIssues.map((item, i) => ({ key: `n-${item.nodeId}-${i}`, text: `出入口「${item.nodeName}」：${item.issue.message}` })),
    ...workerIssues.map((item, i) => ({ key: `w-${item.workerId}-${i}`, text: `人员「${item.workerRole}」：${item.issue.message}` })),
  ];
  const selectedFacility = selectedFacilityId ? plan.facilities.find(f => f.id === selectedFacilityId) ?? null : null;
  const selectedRoute = selectedRouteId ? plan.routes.find(r => r.id === selectedRouteId) ?? null : null;
  const selectedNode = selectedNodeId ? plan.nodes.find(n => n.id === selectedNodeId) ?? null : null;
  const selectedWorker = selectedWorkerId ? plan.workers.find(w => w.id === selectedWorkerId) ?? null : null;
  const zoneSummaryRows = workerZoneSummary(plan);
  const roleSummaryRows = workerRoleSummary(plan);

  /* ---------------- H3-c 规划信息面板（全部现算） ---------------- */
  const overviewStats = planOverviewStats(plan);
  const visibleCounts = {
    zone: layerState.zone ? plan.zones.length : 0,
    facility: layerState.facility ? plan.facilities.length : 0,
    route: layerState.route ? plan.routes.length : 0,
    node: layerState.access ? plan.nodes.length : 0,
    worker: layerState.worker ? plan.workers.length : 0,
    measurement: layerState.measure ? (plan.measurements ?? []).length : 0,
  };
  const inventoryRows = buildPlanInventory(plan);
  const filteredInventoryRows = filterPlanInventory(inventoryRows, { kind: invKind, zone: invZone, issuesOnly: invIssuesOnly });
  const legendGroups = buildPlanLegend(plan);
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
    (row.kind === 'facility' && row.id === selectedFacilityId)
    || (row.kind === 'route' && row.id === selectedRouteId)
    || (row.kind === 'node' && row.id === selectedNodeId)
    || (row.kind === 'worker' && row.id === selectedWorkerId);
  // 面板内点击不再冒泡到画布（否则勾选/选模板/点按钮会在面板对应画布位置误加草稿点或放置实体）。
  const stopPanelMouse = (event: React.MouseEvent) => event.stopPropagation();
  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    right: PLANNING_SPACING.sm,
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
  // H3-c 规划信息面板（左栏常驻）：与右栏编辑面板同源样式，互不遮挡。
  const infoPanelStyle: React.CSSProperties = {
    position: 'absolute',
    left: PLANNING_SPACING.sm,
    top: PLANNING_SPACING.sm,
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
    maxHeight: 'calc(100% - 16px)',
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
      onDoubleClick={event => {
        // H2-d：画动线模式下双击提交；H3-a：测量模式下双击提交（面积/路径）。
        if (modeRef.current === 'route') {
          event.preventDefault();
          finishRoute();
        } else if (modeRef.current === 'measure') {
          event.preventDefault();
          finishMeasure();
        }
      }}
      onWheel={e => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1 : -1); }}
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
        if (modeRef.current !== 'facility' || !facilityTemplateRef.current) return;
        event.preventDefault();
        const hit = eventPlanPoint(event);
        if (!hit) return;
        placeFacilityAt(hit.pt);
      }}
    >
      <canvas ref={baseCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-label="底图瓦片层" />
      <canvas ref={planCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} aria-label="户外规划业务图层" />

      {/* H3-c 规划信息面板（左栏常驻）：总览 / 清单 / 问题 / 图例，只读也可用。 */}
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
                  分区 {visibleCounts.zone} · 设施 {visibleCounts.facility} · 动线 {visibleCounts.route} · 出入口 {visibleCounts.node} · 人员 {visibleCounts.worker} · 测量 {visibleCounts.measurement}
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
                    {(['zone', 'facility', 'route', 'node', 'worker', 'measurement'] as PlanInventoryKind[]).map(kind => (
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
                    {plan.zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input type="checkbox" checked={invIssuesOnly} onChange={event => setInvIssuesOnly(event.target.checked)} />
                    只看问题
                  </label>
                </div>
                <div data-testid="inventory-count" style={{ marginTop: PLANNING_SPACING.xs, opacity: 0.75 }}>
                  共 {filteredInventoryRows.length} 行 / 全案 {inventoryRows.length} 行
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
                      const Icon = planningIcon(entry.icon);
                      return (
                        <div key={entry.label} data-testid="legend-entry" style={{ display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs, marginTop: 2 }}>
                          <Icon size={PLANNING_ICON_SIZES.legend} color={entry.swatch} strokeWidth={2} />
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

      <div style={panelStyle} onMouseDown={stopPanelMouse} onMouseUp={stopPanelMouse} onDoubleClick={stopPanelMouse}>
        <button
          type="button"
          onClick={() => setPanelOpen(open => !open)}
          style={{ all: 'unset', cursor: 'pointer', fontWeight: 600, display: 'block', width: '100%' }}
          aria-expanded={panelOpen}
        >
          图层栈与编辑 {panelOpen ? '▾' : '▸'}
        </button>
        {panelOpen && (
          <>
            {LAYER_ORDER.map(kind => {
              const LayerIcon = planningIcon(PLANNING_LAYER_ICONS[kind]);
              return (
                <label key={kind} style={{ display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.xs, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={layerState[kind]}
                    onChange={event => setLayerVisible(kind, event.target.checked)}
                  />
                  <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: PLANNING_LAYER_COLORS[kind], display: 'inline-block' }} />
                  <LayerIcon size={PLANNING_ICON_SIZES.tool} color={PLANNING_LAYER_COLORS[kind]} aria-hidden />
                  {PLANNING_LABELS[kind]}
                </label>
              );
            })}

            {/* H2-d 人员汇总（评审稿「自动汇总」）：只读也可查；隐藏人员层不影响这里的统计。 */}
            {plan.workers.length > 0 && (
              <>
                <div style={sectionTitle}>人员汇总（共 {plan.workers.reduce((s, w) => s + w.count, 0)} 人 / {plan.workers.length} 点）</div>
                <div data-testid="worker-zone-summary" style={{ lineHeight: 1.6 }}>
                  {zoneSummaryRows.map(row => (
                    <div key={row.zoneId ?? '__orphan__'}>{row.zoneName}：{row.total} 人 · {row.posts} 点</div>
                  ))}
                </div>
                <div data-testid="worker-role-summary" style={{ lineHeight: 1.6, opacity: 0.85 }}>
                  {roleSummaryRows.map(row => (
                    <div key={row.role}>{row.role} {row.total} 人（{row.posts} 点）</div>
                  ))}
                </div>
              </>
            )}

            {!readOnly && (
              <>
                <div style={sectionTitle}>编辑</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: PLANNING_SPACING.xs }}>
                  {(Object.keys(PLANNING_EDIT_MODE_LABELS) as PlanningEditMode[]).map(m => {
                    const ModeIcon = planningIcon(PLANNING_EDIT_MODE_ICONS[m]);
                    return (
                      <button
                        key={m}
                        type="button"
                        style={modeButtonStyle(mode === m)}
                        aria-pressed={mode === m}
                        onClick={() => setMode(m)}
                      >
                        <ModeIcon size={PLANNING_ICON_SIZES.tool} aria-hidden />
                        {PLANNING_EDIT_MODE_LABELS[m]}
                      </button>
                    );
                  })}
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
                {mode === 'zone' && (
                  <label style={{ ...zoneRowStyle, justifyContent: 'space-between' }}>
                    分区语义
                    <select
                      aria-label="分区语义"
                      value={zoneSemantic}
                      onChange={event => setZoneSemantic(event.target.value as PlanningZoneSemantic)}
                      style={selectStyle}
                    >
                      {planZoneSemantics.map(s => (
                        <option key={s} value={s}>{planZoneSemanticLabels[s]}</option>
                      ))}
                    </select>
                  </label>
                )}
                <div style={{ marginTop: PLANNING_SPACING.xs, opacity: 0.75, lineHeight: 1.5 }}>
                  {mode === 'boundary' && '单击加顶点，点回起点或再点首点闭合；Esc 取消。'}
                  {mode === 'boundary-vertex' && '拖动绿色手柄调整顶点；非法位置自动吸附回去。'}
                  {mode === 'zone' && '圈出分区后点回起点闭合，自交会被拒绝。'}
                  {mode === 'facility' && (facilityTemplateId ? '画布上移动鼠标预览占地，单击放置；也可直接拖模板进来；Esc 取消。' : '先点选下方模板，或直接把模板拖到画布上。')}
                  {mode === 'route' && '单击加路径点，双击或点「完成动线」提交；端点靠近出入口会自动连接；Esc 取消。'}
                  {mode === 'measure' && (measureKind === 'distance'
                    ? '单击两点，第 2 点自动固定距离；读数跟指针；Esc 取消。'
                    : measureKind === 'area'
                      ? '圈出区域后点回起点或点「完成测量」闭合固定面积；Esc 取消。'
                      : '单击加路径点，双击或点「完成测量」提交；Esc 取消。')}
                  {mode === 'node' && '单击放置出入口节点，可连续放置；Esc 取消。'}
                  {mode === 'worker' && '单击布置人员点位，落点在分区内会自动归属；Esc 取消。'}
                  {mode === 'view' && '拖拽平移，滚轮缩放；单击冲突标记/出入口/人员/动线/设施可定位或选中；拖动出入口，关联动线端点随动。'}
                </div>

                {mode === 'route' && (
                  <div style={{ marginTop: PLANNING_SPACING.xs }}>
                    <label style={zoneRowStyle}>
                      动线类型
                      <select
                        aria-label="动线类型"
                        value={routeKind}
                        onChange={event => {
                          routeKindRef.current = event.target.value as PlanningRouteKind;
                          setRouteKind(routeKindRef.current);
                          draw();
                        }}
                        style={selectStyle}
                      >
                        {planRouteKinds.map(k => (
                          <option key={k} value={k}>{planRouteKindLabels[k]}</option>
                        ))}
                      </select>
                      <span aria-hidden style={{ width: 10, height: 4, borderRadius: 2, background: PLANNING_ROUTE_KIND_COLORS[routeKind], display: 'inline-block' }} />
                    </label>
                    <label style={zoneRowStyle}>
                      <input
                        type="checkbox"
                        aria-label="单向动线"
                        checked={routeOneWay}
                        onChange={event => {
                          routeOneWayRef.current = event.target.checked;
                          setRouteOneWay(event.target.checked);
                        }}
                      />
                      单向（沿线画方向箭头）
                    </label>
                    <button
                      type="button"
                      data-testid="route-finish"
                      disabled={routeDraftCount < 2}
                      style={{ ...modeButtonStyle(false), marginTop: PLANNING_SPACING.xs, opacity: routeDraftCount < 2 ? 0.5 : 1 }}
                      onClick={() => finishRoute()}
                    >
                      完成动线（{routeDraftCount} 点）
                    </button>
                  </div>
                )}

                {mode === 'node' && (
                  <div style={{ marginTop: PLANNING_SPACING.xs }}>
                    <div style={{ ...sectionTitle, marginTop: 0 }}>节点类型</div>
                    {(['entry', 'exit', 'both'] as const).map(k => (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={nodeKind === k}
                        style={{ ...modeButtonStyle(nodeKind === k), display: 'block', width: '100%', textAlign: 'left', marginTop: PLANNING_SPACING.xs }}
                        onClick={() => { nodeKindRef.current = k; setNodeKind(k); }}
                      >
                        {k === 'entry' ? '入口' : k === 'exit' ? '出口' : '出入口（两用）'}
                      </button>
                    ))}
                  </div>
                )}

                {mode === 'worker' && (
                  <div style={{ marginTop: PLANNING_SPACING.xs }}>
                    <label style={zoneRowStyle}>
                      岗位
                      <input
                        aria-label="人员岗位"
                        value={workerRole}
                        maxLength={60}
                        onChange={event => { workerRoleRef.current = event.target.value; setWorkerRole(event.target.value); }}
                        style={{ flex: 1, minWidth: 0, background: PLANNING_SURFACE.fieldBg, color: PLANNING_SURFACE.panelText, border: `1px solid ${PLANNING_SURFACE.panelBorder}`, borderRadius: PLANNING_RADIUS.sm, fontSize: PLANNING_TYPOGRAPHY.row, padding: '2px 4px' }}
                      />
                    </label>
                    <label style={zoneRowStyle}>
                      人数
                      <input
                        aria-label="人员人数"
                        type="number"
                        min={1}
                        max={9999}
                        value={workerCount}
                        onChange={event => {
                          const next = Math.max(1, Math.min(9999, Math.floor(Number(event.target.value) || 1)));
                          workerCountRef.current = next;
                          setWorkerCount(next);
                        }}
                        style={{ width: 64, background: PLANNING_SURFACE.fieldBg, color: PLANNING_SURFACE.panelText, border: `1px solid ${PLANNING_SURFACE.panelBorder}`, borderRadius: PLANNING_RADIUS.sm, fontSize: PLANNING_TYPOGRAPHY.row, padding: '2px 4px' }}
                      />
                    </label>
                  </div>
                )}

                {mode === 'measure' && (
                  <div style={{ marginTop: PLANNING_SPACING.xs }}>
                    <div style={{ ...sectionTitle, marginTop: 0 }}>测量类型</div>
                    {(['distance', 'area', 'path'] as const).map(k => (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={measureKind === k}
                        style={{ ...modeButtonStyle(measureKind === k), display: 'block', width: '100%', textAlign: 'left', marginTop: PLANNING_SPACING.xs }}
                        onClick={() => {
                          measureKindRef.current = k;
                          setMeasureKind(k);
                          // 换类型清草稿：距离/面积/路径点数口径不同，不跨类型续用。
                          measureDraftRef.current = [];
                          measureCursorRef.current = null;
                          setMeasureDraftCount(0);
                          setEditMessage(null);
                          draw();
                        }}
                      >
                        {planMeasurementKindLabels[k]}
                      </button>
                    ))}
                    {measureKind !== 'distance' && (
                      <button
                        type="button"
                        data-testid="measure-finish"
                        disabled={measureKind === 'area' ? measureDraftCount < 3 : measureDraftCount < 2}
                        style={{
                          ...modeButtonStyle(false),
                          marginTop: PLANNING_SPACING.xs,
                          opacity: (measureKind === 'area' ? measureDraftCount < 3 : measureDraftCount < 2) ? 0.5 : 1,
                        }}
                        onClick={() => finishMeasure()}
                      >
                        完成测量（{measureDraftCount} 点）
                      </button>
                    )}
                    {(plan.measurements?.length ?? 0) > 0 && (
                      <>
                        <div style={sectionTitle}>固定测量（{plan.measurements!.length}）</div>
                        {plan.measurements!.map(m => (
                          <div key={m.id} data-testid="measure-list-item" style={{ ...zoneRowStyle, justifyContent: 'space-between' }}>
                            <span style={{ flex: 1, minWidth: 0, opacity: 0.9 }}>
                              {m.name} = {m.kind === 'area' ? formatAreaM2(measureValue(m)) : formatLengthM(measureValue(m))}
                            </span>
                            <button
                              type="button"
                              aria-label={`删除测量「${m.name}」`}
                              style={modeButtonStyle(false)}
                              onClick={() => deleteMeasurement(m.id)}
                            >
                              删除
                            </button>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}

                {mode === 'facility' && (
                  <div style={{ marginTop: PLANNING_SPACING.xs }}>
                    <div style={{ ...sectionTitle, marginTop: 0 }}>设施模板</div>
                    {PLAN_FACILITY_TEMPLATES.map(t => (
                      <button
                        key={t.templateId}
                        type="button"
                        draggable
                        data-testid={`facility-template-${t.templateId}`}
                        title={t.note}
                        aria-pressed={facilityTemplateId === t.templateId}
                        onDragStart={event => {
                          event.dataTransfer.setData('text/plain', t.templateId);
                          event.dataTransfer.effectAllowed = 'copy';
                          pickFacilityTemplate(t.templateId);
                        }}
                        onClick={() => pickFacilityTemplate(t.templateId)}
                        style={{ ...modeButtonStyle(facilityTemplateId === t.templateId), display: 'block', width: '100%', textAlign: 'left', marginTop: PLANNING_SPACING.xs }}
                      >
                        {t.name} · {t.width}×{t.depth}m
                      </button>
                    ))}
                  </div>
                )}

                {plan.zones.length > 0 && (
                  <>
                    <div style={sectionTitle}>分区样式</div>
                    {plan.zones.map(zone => (
                      <div key={zone.id} style={{ marginTop: PLANNING_SPACING.xs, borderTop: `1px solid ${PLANNING_SURFACE.fieldBg}`, paddingTop: PLANNING_SPACING.xs }}>
                        <div style={zoneRowStyle}>
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
                  </>
                )}

                {selectedFacility && (
                  <>
                    <div style={sectionTitle}>已选中设施</div>
                    <div style={zoneRowStyle}>
                      <input
                        aria-label="选中设施名称"
                        value={selectedFacility.name}
                        maxLength={60}
                        onChange={event => updateFacility(selectedFacility.id, { name: event.target.value })}
                        style={{ flex: 1, minWidth: 0, background: PLANNING_SURFACE.fieldBg, color: PLANNING_SURFACE.panelText, border: `1px solid ${PLANNING_SURFACE.panelBorder}`, borderRadius: PLANNING_RADIUS.sm, fontSize: PLANNING_TYPOGRAPHY.row, padding: '2px 4px' }}
                      />
                    </div>
                    <div style={{ marginTop: PLANNING_SPACING.xs, opacity: 0.75 }}>
                      {selectedFacility.size.width}×{selectedFacility.size.depth} m · 旋转 {Math.round(selectedFacility.rotationDeg)}° · {selectedFacility.templateId}
                    </div>
                    <div style={{ display: 'flex', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.xs }}>
                      <button
                        type="button"
                        data-testid="facility-delete"
                        style={modeButtonStyle(false)}
                        onClick={() => deleteFacility(selectedFacility.id)}
                      >
                        删除设施
                      </button>
                      <button type="button" style={modeButtonStyle(false)} onClick={() => selectFacility(null)}>
                        取消选择
                      </button>
                    </div>
                  </>
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
                        {plan.zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
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

                {combinedIssues.length > 0 && (
                  <>
                    <div style={{ ...sectionTitle, color: PLANNING_SURFACE.dangerText }}>问题提示（{combinedIssues.length} 条）</div>
                    <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.6 }}>
                      {combinedIssues.slice(0, PLAN_ISSUE_LIST_LIMIT).map(item => (
                        <li key={item.key} style={item.color ? { color: item.color } : undefined}>{item.text}</li>
                      ))}
                    </ul>
                    {combinedIssues.length > PLAN_ISSUE_LIST_LIMIT && <div style={{ opacity: 0.7 }}>其余 {combinedIssues.length - PLAN_ISSUE_LIST_LIMIT} 条从略。</div>}
                  </>
                )}

                <div role="status" aria-live="polite" style={{ marginTop: PLANNING_SPACING.sm, minHeight: 16, color: editMessage ? PLANNING_SURFACE.warnText : 'transparent' }}>
                  {editMessage ?? '·'}
                </div>
              </>
            )}

            <div style={{ marginTop: PLANNING_SPACING.sm, opacity: 0.75, fontSize: PLANNING_TYPOGRAPHY.hint }}>缩放 z{view.zoom}{readOnly ? ' · 只读浏览' : ''}</div>
          </>
        )}
      </div>
    </div>
  );
}
