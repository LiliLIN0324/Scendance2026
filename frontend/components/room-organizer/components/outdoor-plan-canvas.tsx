'use client';

/**
 * 户外 2D 规划满铺画布组件（H2-a 基础 + H2-b 编辑交互）。
 *
 * 组合方式：底图（公开源/天地图瓦片，复用 tdt-probe 工具）+ 六类业务图层
 * （outdoor-plan-canvas 纯函数）+ 内嵌图层栈开关与编辑面板。独立组件，不动 `room-organizer.tsx`。
 *
 * H2-b 编辑模式（编辑规则全部在 site-plan-editing 纯函数层，组件只做接线）：
 * - 浏览：拖拽平移、滚轮缩放；单击设施命中即选中，空白处点击取消选中。
 * - 画边界：单击加顶点、近首点闭合提交；自交/重合/面积不足拒绝并给原因，Esc 取消草稿。
 * - 编辑边界：拖动顶点实时校验，非法移动吸附回上一个合法位置，松手提交。
 * - 画分区：选语义后圈区提交（语义默认色/透明度）；自交/退化阻止提交，越界与重叠放行但出提示。
 * 分区颜色/透明度/命名可在面板内直接编辑（契约可选字段 opacity，0.05–0.6 区间）。
 *
 * H2-c 设施模板拖放（放置规则在 site-plan-facilities 纯函数层）：
 * - 「放设施」模式下面板出模板目录；点选模板后幽灵占地跟随鼠标（占地预览，越界变红），
 *   单击提交、可连续放置；从模板按钮拖拽（HTML5 DnD）到画布 dragover/drop 同样生效；
 * - Esc 取消放置回浏览；放置即选中（白圈高亮 + 面板改名/删除），越界设施出红虚线警示与问题条目。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultLayerVisibility,
  drawAccessLayer,
  drawBoundaryLayer,
  drawDraftLayer,
  drawFacilityGhost,
  drawFacilityLayer,
  drawRouteLayer,
  drawWorkerLayer,
  drawZoneLayer,
  isLayerVisible,
  planPixelToPoint,
  planPointToPixel,
  type LayerVisibility,
  type PlanViewport,
} from '../lib/outdoor-plan-canvas';
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
  publicSourceTileUrl,
  tdtProbeTileUrl,
  visibleTileGrid,
  type ProbePublicSource,
  type TdtProbeLayer,
} from '../lib/tdt-probe';
import {
  PLANNING_EDIT_MODE_LABELS,
  PLANNING_LABELS,
  PLANNING_LAYER_COLORS,
  PLANNING_RADIUS,
  PLANNING_SPACING,
  PLANNING_ZONE_COLORS,
  PLANNING_ZONE_OPACITY,
  type PlanningEditMode,
  type PlanningLayerKind,
  type PlanningZoneSemantic,
} from '@/lib/outdoor-plan-tokens';
import {
  planZoneSemanticLabels,
  planZoneSemantics,
  type PlanFacility,
  type PlanPoint,
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

const LAYER_ORDER: readonly ['boundary', 'zone', 'facility', 'route', 'worker', 'access'] = ['boundary', 'zone', 'facility', 'route', 'worker', 'access'];

/** 顶点手柄的命中半径（CSS px），与 drawBoundaryLayer 的手柄绘制半径一致。 */
const VERTEX_HANDLE_HIT_PX = 10;
/** 首顶点闭合热区半径（CSS px），与 drawDraftLayer 的闭合圆圈一致。 */
const DRAFT_CLOSE_HIT_PX = 10;
/** 区分「单击加顶点」与「拖拽平移」的位移阈值（CSS px）。 */
const CLICK_MAX_MOVE_PX = 4;

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

  function setMode(next: PlanningEditMode) {
    modeRef.current = next;
    draftRef.current = [];
    previewRingRef.current = null;
    dragVertexRef.current = null;
    facilityTemplateRef.current = null;
    ghostPointRef.current = null;
    setFacilityTemplateId(null);
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

  /** 编辑提交：先同步 ref（连续操作读现值），再回传父级。 */
  function commitPlan(next: SitePlanData) {
    planRef.current = next;
    onPlanChange?.(next);
  }

  useEffect(() => {
    planRef.current = plan;
    issuesRef.current = planZoneIssues(plan);
    setIssues(issuesRef.current);
    facilityIssuesRef.current = planFacilityIssues(plan);
    setFacilityIssues(facilityIssuesRef.current);
    // 选中设施被外层删掉时静默取消选中，避免面板悬挂引用。
    if (selectedFacilityRef.current && !plan.facilities.some(f => f.id === selectedFacilityRef.current)) {
      selectedFacilityRef.current = null;
      setSelectedFacilityId(null);
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
    const viewport: PlanViewport = { lng: v.lng, lat: v.lat, zoom: v.zoom, canvasW: cssW, canvasH: cssH };
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
    if (isLayerVisible(vis, 'route')) drawRouteLayer({ ctx: planCtx, viewport }, current.routes);
    if (isLayerVisible(vis, 'worker')) drawWorkerLayer({ ctx: planCtx, viewport }, current.workers);
    if (isLayerVisible(vis, 'access')) drawAccessLayer({ ctx: planCtx, viewport }, current.nodes);

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

    // 4) 设施放置幽灵（H2-c）：跟随指针的占地预览，越界变红；叠加在所有图层之上。
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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (modeRef.current === 'view') return;
      setMode('view');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function currentViewport(): PlanViewport {
    const stage = stageRef.current;
    return {
      lng: viewRef.current.lng,
      lat: viewRef.current.lat,
      zoom: viewRef.current.zoom,
      canvasW: stage?.clientWidth ?? 0,
      canvasH: stage?.clientHeight ?? 0,
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
    const dLat = -dy / w * (360 / (2 * Math.PI)) * Math.cos(latRad);
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

  function handleStageMouseDown(event: React.MouseEvent) {
    const activeMode = modeRef.current;
    if (activeMode === 'view') {
      panRef.current = { x: event.clientX, y: event.clientY };
      const hit = eventPlanPoint(event);
      downPxRef.current = hit ? hit.px : null;
      setDragging(true);
      return;
    }
    const hit = eventPlanPoint(event);
    if (!hit) return;
    downPxRef.current = hit.px;
    if (activeMode === 'boundary-vertex') {
      dragVertexRef.current = nearestBoundaryVertexIndex(hit.px);
    }
  }

  function handleStageMouseMove(event: React.MouseEvent) {
    const activeMode = modeRef.current;
    if (activeMode === 'view') {
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
    }
  }

  function handleStageMouseUp(event: React.MouseEvent) {
    const activeMode = modeRef.current;
    if (activeMode === 'view') {
      const down = downPxRef.current;
      downPxRef.current = null;
      panRef.current = undefined;
      setDragging(false);
      // H2-c：浏览模式单击命中设施即选中，空白处点击取消选中。
      if (down && onPlanChange) {
        const hit = eventPlanPoint(event);
        if (hit && Math.hypot(hit.px.x - down.x, hit.px.y - down.y) <= CLICK_MAX_MOVE_PX) {
          const hitFacility = [...planRef.current.facilities].reverse().find(f => facilityContainsPoint(hit.pt, f));
          selectFacility(hitFacility ? hitFacility.id : null);
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
    draw();
  }

  const readOnly = !onPlanChange;
  // H2-c：分区问题 + 设施问题合并成一张可读清单（各自有序，合计限量展示）。
  const combinedIssues = [
    ...issues.map((item, i) => ({ key: `z-${item.zoneId}-${item.issue.code}-${i}`, text: `${item.zoneName}：${item.issue.message}` })),
    ...facilityIssues.map((item, i) => ({ key: `f-${item.facilityId}-${i}`, text: `${item.facilityName}：${item.issue.message}` })),
  ];
  const selectedFacility = selectedFacilityId ? plan.facilities.find(f => f.id === selectedFacilityId) ?? null : null;
  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    right: PLANNING_SPACING.sm,
    top: PLANNING_SPACING.sm,
    zIndex: 3,
    background: 'rgba(24, 34, 48, 0.92)',
    border: '1px solid #35485f',
    borderRadius: PLANNING_RADIUS.md,
    padding: `${PLANNING_SPACING.sm}px ${PLANNING_SPACING.md}px`,
    color: '#e7edf5',
    fontSize: 12,
    minWidth: 168,
    maxWidth: 240,
    pointerEvents: 'auto',
    maxHeight: 'calc(100% - 16px)',
    overflowY: 'auto',
  };
  const sectionTitle: React.CSSProperties = { marginTop: PLANNING_SPACING.sm, marginBottom: PLANNING_SPACING.xs, fontWeight: 600, opacity: 0.9 };
  const modeButtonStyle = (active: boolean): React.CSSProperties => ({
    all: 'unset',
    cursor: 'pointer',
    padding: '3px 7px',
    borderRadius: PLANNING_RADIUS.sm,
    border: '1px solid #35485f',
    background: active ? '#2f4a3c' : 'transparent',
    color: '#e7edf5',
    fontSize: 11,
  });
  const zoneRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.xs };

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

      <div style={panelStyle}>
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
            {LAYER_ORDER.map(kind => (
              <label key={kind} style={{ display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.xs, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={layerState[kind]}
                  onChange={event => setLayerVisible(kind, event.target.checked)}
                />
                <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: PLANNING_LAYER_COLORS[kind], display: 'inline-block' }} />
                {PLANNING_LABELS[kind]}
              </label>
            ))}

            {!readOnly && (
              <>
                <div style={sectionTitle}>编辑</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: PLANNING_SPACING.xs }}>
                  {(Object.keys(PLANNING_EDIT_MODE_LABELS) as PlanningEditMode[]).map(m => (
                    <button
                      key={m}
                      type="button"
                      style={modeButtonStyle(mode === m)}
                      aria-pressed={mode === m}
                      onClick={() => setMode(m)}
                    >
                      {PLANNING_EDIT_MODE_LABELS[m]}
                    </button>
                  ))}
                </div>
                {mode === 'zone' && (
                  <label style={{ ...zoneRowStyle, justifyContent: 'space-between' }}>
                    分区语义
                    <select
                      aria-label="分区语义"
                      value={zoneSemantic}
                      onChange={event => setZoneSemantic(event.target.value as PlanningZoneSemantic)}
                      style={{ background: '#24334a', color: '#e7edf5', border: '1px solid #35485f', borderRadius: PLANNING_RADIUS.sm, fontSize: 11 }}
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
                  {mode === 'view' && '拖拽平移，滚轮缩放；单击设施可选中。'}
                </div>

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
                      <div key={zone.id} style={{ marginTop: PLANNING_SPACING.xs, borderTop: '1px solid #24334a', paddingTop: PLANNING_SPACING.xs }}>
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
                            style={{ flex: 1, minWidth: 0, background: '#24334a', color: '#e7edf5', border: '1px solid #35485f', borderRadius: PLANNING_RADIUS.sm, fontSize: 11, padding: '2px 4px' }}
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
                        style={{ flex: 1, minWidth: 0, background: '#24334a', color: '#e7edf5', border: '1px solid #35485f', borderRadius: PLANNING_RADIUS.sm, fontSize: 11, padding: '2px 4px' }}
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

                {combinedIssues.length > 0 && (
                  <>
                    <div style={{ ...sectionTitle, color: '#e8a3a3' }}>问题提示（{combinedIssues.length} 条）</div>
                    <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.6 }}>
                      {combinedIssues.slice(0, PLAN_ISSUE_LIST_LIMIT).map(item => (
                        <li key={item.key}>{item.text}</li>
                      ))}
                    </ul>
                    {combinedIssues.length > PLAN_ISSUE_LIST_LIMIT && <div style={{ opacity: 0.7 }}>其余 {combinedIssues.length - PLAN_ISSUE_LIST_LIMIT} 条从略。</div>}
                  </>
                )}

                <div role="status" aria-live="polite" style={{ marginTop: PLANNING_SPACING.sm, minHeight: 16, color: editMessage ? '#ffd88a' : 'transparent' }}>
                  {editMessage ?? '·'}
                </div>
              </>
            )}

            <div style={{ marginTop: PLANNING_SPACING.sm, opacity: 0.75 }}>缩放 z{view.zoom}{readOnly ? ' · 只读浏览' : ''}</div>
          </>
        )}
      </div>
    </div>
  );
}
