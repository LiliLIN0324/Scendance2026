'use client';

/**
 * 户外 2D 规划覆盖层（P2-e · 融进 3D 页面框架）：**本组件只负责画布本体**——
 * 满幅 OutdoorPlanCanvas + 引导 + 分享弹窗，再无任何自造按钮/顶条/侧栏。
 * 其余功能全部 portal 进主产品 3D 页面**现有的框架锚点**（由 room-organizer 渲染）：
 * - `#outdoor-panel-host-layers` / `#outdoor-panel-host-info`：主产品左栏卡片里的两个
 *   卡片宿主（图层栈与编辑 / 规划信息，画布浮窗经 PanelPortal 进去）；
 * - `#outdoor-tools-dock`：主产品右侧工具排位置（sc-editor-dock 内，同款
 *   sc-view-tools/sc-canvas-rail 框架），挂图源循环 / 导出 / 引导三枚钮。
 * 开关由左轨「户外规划」钮 toggle；活动名/保存态归主产品原位（左栏活动卡/左轨 foot）。
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import OutdoorPlanCanvas, {
  type CanvasBasemapSource,
  type OutdoorPlanCanvasHandle,
} from '@/components/room-organizer/components/outdoor-plan-canvas';
import OutdoorPlan3D, { type OutdoorPlan3DApi } from '@/components/room-organizer/components/outdoor-plan-3d';
import type { PlanViewport } from '@/components/room-organizer/lib/outdoor-plan-canvas';
import { enuToLngLat } from '@/components/room-organizer/lib/outdoor-plan-canvas';
import { GuideBubble, useGuide } from '@/components/room-organizer/components/outdoor-plan-interactions';
import { GUIDE_STEPS } from '@/components/room-organizer/lib/site-plan-guide';
import { OutdoorDeliveryPanel } from '@/components/room-organizer/components/outdoor-delivery-panel';
import { planOverviewStats } from '@/components/room-organizer/lib/site-plan-measure';
import { readPlanGroundSource, writePlanGroundSource } from '@/components/room-organizer/lib/plan-basemap-source';
import { downloadPlanCsv } from '@/components/room-organizer/lib/site-plan-csv';
import { downloadPlanPng, composePlanPng } from '@/components/room-organizer/lib/site-plan-png';
import { buildShareLink } from '@/components/room-organizer/lib/site-plan-share';
import { printPlanDeck } from '@/components/room-organizer/lib/site-plan-pdf';
import { downloadPlanGeoJson } from '@/components/room-organizer/lib/site-plan-geojson';
import PlanPlaceSearch from '@/components/room-organizer/components/plan-place-search';
import { normalizePlanFacilityFootprints } from '@/components/room-organizer/lib/facility-footprint-lock';
import { fetchPlaceShape } from '@/components/room-organizer/lib/place-area';
import type { BackendSession } from '@/lib/backend-session';
import { OutdoorFacilityGenerate } from './outdoor-facility-generate';
import { useAgentOptional } from '@/components/room-organizer/panels/agent-panel';
import { PLANNING_SURFACE } from '@/lib/outdoor-plan-tokens';
import {
  createStarterOutdoorPlan,
  DEFAULT_OUTDOOR_PLAN_ANCHOR,
  readOutdoorPlanView,
  readOutdoorProjectRecord,
  saveOutdoorPlanView,
  saveOutdoorProjectRecord,
} from '@/components/room-organizer/lib/outdoor-project-store';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { DisplayUnit } from '../lib/types';
import type { PlanSceneObject } from '@/components/room-organizer/lib/plan-item-bridge';

/** 图源循环顺序（右下图标钮弹出面板选图源）。 */
const SOURCE_CYCLE: { id: CanvasBasemapSource; label: string }[] = [
  { id: 'osm', label: 'OSM 街道' },
  { id: 'carto-light', label: 'Carto 浅色' },
  { id: 'carto-dark', label: 'Carto 深色' },
  { id: 'amap-satellite', label: '高德卫星' },
  { id: 'amap-streets', label: '高德街道' },
  { id: 'amap-streets-labels', label: '高德街道注记' },
  { id: 'vec', label: '天地图矢量' },
  { id: 'img', label: '天地图影像' },
];

const AUTOSAVE_DEBOUNCE_MS = 400;
const GUIDE_STORAGE_KEY = 'outdoor-plan-guide-v1';
/** 本地活动没有稳定 id 时的兜底草稿槽（单草稿；云项目 id 恒走按项目隔离）。 */
const LOCAL_DRAFT_SLOT = 'local-draft';

export type OutdoorSaveState = { state: 'idle' | 'saving' | 'saved'; savedAt: string | null } | null;

export interface OutdoorPlanOverlayProps {
  /** 草稿归属：layout.id（云项目 id 或本地活动 uuid）；null 落固定兜底槽。 */
  projectId: string | null;
  /** 活动点位（sceneAnchor/mapLngLat，GCJ-02）：仅用于底图初始定位，不写进 plan.anchor。 */
  anchor?: { lng: number; lat: number } | null;
  activityName?: string | null;
  /** 保存态上报：room-organizer 据此在左轨 foot（主产品保存态原位）显示户外草稿状态。 */
  onSaveStateChange?: (next: OutdoorSaveState) => void;
  /** P2-g：undo/redo 可用态上报（室内工具排撤销/重做钮启用态）。 */
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
  /** 2026-11-12 B1 选择工具：2D 画布绘制/浏览模式上报（右栏工具排「选择」钮按下态）。 */
  onModeChange?: (mode: 'view' | 'select') => void;
  /** 2026-11-12 三张卡拆开：测量 / 标注 / 属性 各自展开态上报（右轨三枚圆钮的按下态）。 */
  onInspectorChange?: (state: { openTabs: Record<'measure' | 'annotate' | 'selection', boolean> }) => void;
  /** P2-g：计划变更上报（2D 边界 → 3D 场地壳体联动用；含初次载入的那一帧）。 */
  onPlanChange?: (plan: SitePlanData) => void;
  /** 2026-11-11 图层：活动层切换上报（3D 地面图层据此只镜像当前层；含初次载入的初始层）。 */
  onActiveLevelChange?: (levelId: string) => void;
  /**
   * P2-g 反向播种：3D 已圈好的场地（`layout.backendVenue`）投影成的起步平面。
   * 只在**该槽位还没有户外草稿**时使用；有草稿时草稿优先（用户自己画过的东西不覆盖）。
   */
  seedPlan?: SitePlanData | null;
  /**
   * 2026-11-11 统一视图：室内 3D 场景的落位（物料 + 场地实景扫描）投影到户外 2D 画布。
   * 只读展示层——透传给 OutdoorPlanCanvas，不参与命中测试/交互。
   */
  sceneObjects?: readonly PlanSceneObject[] | undefined;
  /** 受控视角：同一份规划的 2D 地图 / 3D 场地，只换看法，功能不变。 */
  view?: '2d' | '3d';
  /**
   * 2026-11-12 接管态保活隐藏：全屏 OutdoorPlan3D 接管画布时，本覆盖层**保持挂载**
   * （2D 画布编辑桥 pointerFromPlan 要用它的句柄与布局），但它自己的 2D 画面/浮层
   * 必须真正不可见、不可点。只在外层包 div 上设 visibility:hidden 不够——内层画布
   * 容器按 `view` 又写了 visibility:visible，会把隐藏顶掉，2D 画面直接盖住 3D。
   */
  dormant?: boolean;
  /**
   * 2026-11-12 用户指令「3D 的时候也要可编辑」：右轨三张工具卡的出镜宿主 id，
   * 接管态由 room-organizer 提供（透传给画布，portal 出隐藏覆盖层）；2D 态不传。
   */
  inspectorHostId?: string;
  /** 清单/读数显示单位；工程底稿仍存米。缺省米。 */
  lengthUnit?: DisplayUnit;
  /**
   * V-5b/c（2026-11-13）：属性卡「模型」区的生成/上传入口外发（透传给 OutdoorPlanCanvas）。
   * room-organizer 侧接线：记 facility 链接 + 预填左栏物料生成框（仍须确认额度）；
   * 提交成功后画布轮询回填候选首位。只读分享页等不传，按钮缺省 no-op。
   */
  controller?: BackendSession | undefined;
}

/** P2-g：覆盖层对外命令句柄（room-organizer 的室内工具排通用钮转发到这里）。 */
export interface OutdoorPlanOverlayHandle {
  /** 缩放一档（与滚轮同源）。 */
  zoomBy(direction: 1 | -1): void;
  /**
   * 2026-11-12 接管态编辑桥：把覆盖层里活着的 2D 画布句柄交给全屏 OutdoorPlan3D
   * （canvasApiRef），左键物件手势走同一条 pointerFromPlan 管线；覆盖层未挂载时 null。
   */
  getCanvasApi(): OutdoorPlanCanvasHandle | null;
  /** 业务层画布截图 dataURL（无画布时 null）。 */
  captureImage(): string | null;
  /** 按当前 plan 导出 PNG（与右侧导出菜单的 PNG 同一口径）；无 plan 时返回 false。 */
  exportPng(): boolean;
  undo(): void;
  redo(): void;
  /** 2026-11-12 B1 选择工具：切 2D 画布浏览/选择模式（右栏工具排「选择」钮转发）。 */
  setCanvasMode(mode: 'view' | 'select'): void;
  /** 2026-11-12 测量/标注收进右轨圆钮：开/关「工具与属性」浮窗并切页签（右轨圆钮转发）。 */
  setInspector(open: boolean, tab?: 'measure' | 'annotate' | 'selection'): void;
}

const OutdoorPlanOverlay = forwardRef<OutdoorPlanOverlayHandle, OutdoorPlanOverlayProps>(function OutdoorPlanOverlay({
  projectId,
  anchor,
  activityName,
  onSaveStateChange,
  onHistoryChange,
  onModeChange,
  onInspectorChange,
  onPlanChange,
  onActiveLevelChange,
  seedPlan,
  sceneObjects,
  view: controlledView,
  dormant = false,
  inspectorHostId,
  lengthUnit = 'm',
  controller,
}: OutdoorPlanOverlayProps, ref): JSX.Element {
  const agent = useAgentOptional();
  const canvasApiRef = useRef<OutdoorPlanCanvasHandle | null>(null);
  const plan3dApiRef = useRef<OutdoorPlan3DApi | null>(null);
  const slotId = projectId || LOCAL_DRAFT_SLOT;
  // 初始读已存的图源偏好；早先这里硬编码 'osm'，mount 后写回偏好时会把用户选过的源冲掉。
  const [source, setSource] = useState<CanvasBasemapSource>(() => readPlanGroundSource());
  const [plan, setPlan] = useState<SitePlanData | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [shareOpen, setShareOpen] = useState(false);
  const guide = useGuide(GUIDE_STORAGE_KEY);
  // 底图选择面板：对齐 OnePlan 的 Select a map —— 画布右下角一枚「底图」钮 + 弹出列表，
  // 不再把「OSM」这种图源缩写塞进室内工具排里让人猜。
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  // 2026-11-11 用户拍板：户外默认铺真地图（起步计划自带预置锚点）；纸面格网降级为
  // 用户显式「隐藏底图」的形态。geoHidden = true 时切纸面，业务图层不受影响。
  const [geoHidden, setGeoHidden] = useState(false);
  // 2D 画布始终挂载（左栏图层/测量/标注都 portal 到它上面）。
  // 切到 3D：把当前 2D 地图按同一中心斜起来（OutdoorPlan3D），不是跳到另一套工作台场景。
  const [uncontrolledView, setUncontrolledView] = useState<'2d' | '3d'>(() => controlledView ?? readOutdoorPlanView(slotId) ?? '2d');
  const view = controlledView ?? uncontrolledView;
  const [mapView, setMapView] = useState<PlanViewport | null>(null);
  const captureMapView = () => {
    const next = canvasApiRef.current?.getView();
    if (next && next.canvasW > 0 && next.canvasH > 0) setMapView(next);
  };
  const viewSlotRef = useRef(slotId);
  useEffect(() => {
    if (controlledView !== undefined) return;
    if (viewSlotRef.current === slotId) return;
    viewSlotRef.current = slotId;
    setUncontrolledView(readOutdoorPlanView(slotId) ?? '2d');
  }, [slotId, controlledView]);
  useEffect(() => { saveOutdoorPlanView(slotId, view); }, [slotId, view]);
  useEffect(() => {
    if (view !== '3d') return undefined;
    const frame = requestAnimationFrame(captureMapView);
    return () => cancelAnimationFrame(frame);
  // 只在切进 3D 时拍一次视口；编辑规划时不要改 mapView，否则整场 3D 会重建、镜头被重置。
  }, [view]);

  // 搜地点（用户 m04938 / m05472）：左上角「和地图 App 一样」的搜索框，组件本体在
  // `plan-place-search.tsx`（2D 工作台与编辑器内嵌覆盖层共用同一份）。
  // 定位钉只是视图辅助（不改 plan / anchor），点「清除」即撤钉。
  const [generateTarget, setGenerateTarget] = useState<{ facilityId: string; facilityName: string; kind: 'text' | 'image' } | null>(null);
  const [placePin, setPlacePin] = useState<{ lng: number; lat: number; label: string } | null>(null);
  // 2026-11-12 用户要求「给相关的选区，而不是一个居中的点」：行政区边界（视图辅助，不改 plan）。
  // kind: 'line' = 道路等开放折线选区（2026-11-13「点道路=道路选区」）。
  const [placeArea, setPlaceArea] = useState<{ polygon: [number, number][]; label: string; kind?: 'area' | 'line' } | null>(null);
  // 点击 POI 后挖真实占地轮廓的序号尺：防止新选中被旧请求的迟到结果覆盖。
  const shapeSeqRef = useRef(0);
  // 2026-11-12 用户拍板：挖形期间给「正在圈范围…」小提示——Overpass 忙时要排队
  // 30~50 秒，不提示用户会以为点了没反应；挖到/挖不到/换目标/清除都会收掉。
  const [shapeLoading, setShapeLoading] = useState(false);

  // P4-d：把平面选的底图记成「三维地面也用这张」的偏好，切图源时同步。
  useEffect(() => {
    writePlanGroundSource(source);
  }, [source]);

  // 载入本机草稿：室内活动第一次开户外面用起步矩形（同户外项目口径）。
  // P2-g：没有草稿但有 3D 场地时，按 3D 壳体的轮廓起稿（同一个场地的两个视图）。
  const seedPlanRef = useRef<SitePlanData | null | undefined>(seedPlan);
  seedPlanRef.current = seedPlan;
  // 2026-11-11 默认锚点：旧草稿没锚点、活动也从未定位过（seedPlan/anchor 都没有）时，
  // 一次性补预置锚点（平湖秋月，source 'preset'）并经 autosave 落盘——真地图开箱即用。
  // 活动本身有位置（seedPlan 已带 anchor / anchor prop 存在）则不动草稿，维持「不虚构」纪律。
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  useEffect(() => {
    setGenerateTarget(null);
    const record = readOutdoorProjectRecord(slotId);
    // #51 方案甲：载入即吸附设施权威宽高比（幂等），anchor 缺省分支在规整结果上继续。
    const loaded = normalizePlanFacilityFootprints(
      record?.plan ?? seedPlanRef.current ?? createStarterOutdoorPlan(),
    );
    if (!loaded.anchor && !anchorRef.current) {
      setPlan({ ...loaded, anchor: DEFAULT_OUTDOOR_PLAN_ANCHOR });
      return;
    }
    setPlan(loaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotId]);

  // SitePlanData 是户外唯一正源。seedPlan 只在初次载入时播种；
  // 不能把 3D 壳体镜像反过来重播种（会清空刚确认的设施/流线，且把真边界缩成 100m）。

  // 保存管线：同户外项目工作台（400ms 防抖 + 卸载 flush）；状态经 onSaveStateChange
  // 上报给 room-organizer，在左轨 foot（主产品保存态原位）显示。
  const planRef = useRef<SitePlanData | null>(plan);
  planRef.current = plan;
  // V-2d/V-3c：把「应用流线/应用区域」的画布入口与当前 plan 读取口注册给 chat agent——
  // 气泡确认后 provider 调这里；plan 经 ref 每帧取最新，注册一次终身有效。
  useEffect(() => {
    agent?.registerRouteBridge?.({
      applyVenue: (anchor, boundary) => {
        const applied = canvasApiRef.current?.applyVenue(anchor, boundary) ?? false;
        if (applied) {
          setPlacePin(null); setPlaceArea(null);
          const geos = boundary.map(point => enuToLngLat(point.x, point.y, anchor.lng, anchor.lat));
          canvasApiRef.current?.focusBounds([
            Math.min(...geos.map(p => p.lng)), Math.min(...geos.map(p => p.lat)),
            Math.max(...geos.map(p => p.lng)), Math.max(...geos.map(p => p.lat)),
          ]);
        }
        return applied;
      },
      previewVenuePoint: place => { setPlacePin({ lng: place.lng, lat: place.lat, label: place.name }); setPlaceArea(null); canvasApiRef.current?.focusLngLat(place.lng, place.lat, 17); },
      clearVenuePreview: () => { setPlacePin(null); setPlaceArea(null); },
      cancelVenueBoundary: () => canvasApiRef.current?.setMode('view'),
      inspectFacility: id => canvasApiRef.current?.inspectFacility(id) ?? false,
      beginVenueBoundary: anchor => canvasApiRef.current?.beginVenueBoundary(anchor) ?? false,
      applyRoutes: (routes, nodes) => canvasApiRef.current?.applyRoutes(routes, nodes) ?? false,
      applyZoneProposal: (zones, facilities, routes, nodes) => canvasApiRef.current?.applyZoneProposal(zones, facilities, routes, nodes) ?? false,
      getPlan: () => planRef.current,
    });
    return () => agent?.registerRouteBridge?.(null);
  }, [agent]);
  const pendingSaveRef = useRef<number | null>(null);
  const flushSave = useCallback(() => {
    const current = planRef.current;
    if (current == null) return;
    const record = readOutdoorProjectRecord(slotId);
    saveOutdoorProjectRecord({
      v: 1,
      projectId: slotId,
      name: activityName?.trim() || record?.name || '户外规划',
      createdAt: record?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plan: current,
    });
    setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    setSaveState('saved');
  }, [slotId, activityName]);
  useEffect(() => {
    if (plan == null) return;
    setSaveState('saving');
    const timer = window.setTimeout(() => {
      pendingSaveRef.current = null;
      flushSave();
    }, AUTOSAVE_DEBOUNCE_MS);
    pendingSaveRef.current = timer;
    return () => { window.clearTimeout(timer); };
  }, [plan, flushSave]);
  useEffect(() => () => {
    if (pendingSaveRef.current !== null) flushSave();
  }, [flushSave]);
  useEffect(() => {
    onSaveStateChange?.({ state: saveState, savedAt });
  }, [saveState, savedAt, onSaveStateChange]);

  const shareLink = plan
    ? buildShareLink(
      { planId: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '99999999-9999-4999-8999-999999999999',
        projectId: slotId === LOCAL_DRAFT_SLOT ? '88888888-8888-4888-8888-888888888888' : slotId,
        revision: 1, updatedAt: new Date().toISOString(), data: plan },
      typeof window === 'undefined' ? '' : window.location.origin,
      '/plan-share',
    )
    : '';

  function exportPlanPng(): boolean {
    const current = planRef.current;
    if (!current) return false;
    const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas');
    const planCanvas = canvases[canvases.length - 1];
    if (!planCanvas) return false;
    downloadPlanPng({ plan: current, planCanvas, revision: 1, dpi: 300 });
    return true;
  }

  // P2-g：对外命令句柄（室内工具排的撤销/重做/缩放/导出转发到这里）。
  // 不写依赖数组：每帧重建，句柄永远拿到当帧闭包（内部读的都是 ref/最新 state）。
  useImperativeHandle(ref, () => ({
    zoomBy: (direction: 1 | -1) => {
      if (view === '3d') plan3dApiRef.current?.zoomBy(direction);
      else canvasApiRef.current?.zoomBy(direction);
    },
    getCanvasApi: () => canvasApiRef.current,
    captureImage: () => canvasApiRef.current?.captureImage() ?? null,
    exportPng: () => exportPlanPng(),
    undo: () => canvasApiRef.current?.undo(),
    redo: () => canvasApiRef.current?.redo(),
    setCanvasMode: (mode: 'view' | 'select') => canvasApiRef.current?.setMode(mode),
  setInspector: (open: boolean, tab?: 'measure' | 'annotate' | 'selection') => canvasApiRef.current?.setInspector(open, tab),
  }));

  // P2-g：计划变更上报（2D 边界 → 3D 场地壳体联动的入口；初次载入也报一次）。
  useEffect(() => {
    if (plan) onPlanChange?.(plan);
  }, [plan, onPlanChange]);

  const exportStem = activityName?.trim() || 'outdoor-plan';

  function printDeck(): void {
    if (!plan) return;
    const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas');
    const planCanvas = canvases[canvases.length - 1];
    const pngCanvas = planCanvas ? composePlanPng({ plan, planCanvas, revision: 1, dpi: 72 }) : undefined;
    printPlanDeck(
      { planId: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '99999999-9999-4999-8999-999999999999',
        projectId: slotId === LOCAL_DRAFT_SLOT ? '88888888-8888-4888-8888-888888888888' : slotId,
        revision: 1, updatedAt: new Date().toISOString(), data: plan },
      pngCanvas?.toDataURL('image/png'),
    );
  }

  const overview = plan ? planOverviewStats(plan) : null;
  const summaryMeta = overview
    ? `${Math.round(overview.boundaryAreaM2).toLocaleString('zh-CN')} m² · 分区 ${overview.zoneCount} · 设施 ${overview.facilityCount}`
    : '';

  const deliveryHandlers = {
    onExportPng: () => exportPlanPng(),
    onExportCsv: () => { if (plan) downloadPlanCsv(plan, exportStem, lengthUnit); },
    onExportGeoJson: () => { if (plan) downloadPlanGeoJson(plan, exportStem); },
    onPrintDeck: printDeck,
  };

  const currentSource = SOURCE_CYCLE.find(s => s.id === source) ?? SOURCE_CYCLE[0];
  // 3D 接管态（dormant）下本覆盖层只是「保活的编辑桥」：2D 画面、浮层、切换钮全部不出镜。
  const canvasHidden = dormant || view === '3d';

  return (
    <div
      data-testid="outdoor-overlay"
      data-view={view}
      style={{ position: 'absolute', inset: 0, zIndex: 30, background: dormant ? 'transparent' : 'var(--sc-surface, #ffffff)', color: 'var(--sc-ink, #141416)', ...(dormant ? { visibility: 'hidden' as const, pointerEvents: 'none' as const } : {}) }}
    >
      {generateTarget && <OutdoorFacilityGenerate
        key={`${slotId}:${generateTarget.facilityId}:${generateTarget.kind}`}
        target={generateTarget} projectId={slotId} controller={controller} onClose={() => setGenerateTarget(null)} />}
      {!dormant && guide.activeStep && (
        <GuideBubble
          step={guide.activeStep}
          stepIndex={GUIDE_STEPS.indexOf(guide.activeStep)}
          totalSteps={GUIDE_STEPS.length}
          onComplete={() => guide.complete(guide.activeStep as (typeof GUIDE_STEPS)[number])}
          onDismiss={guide.dismiss}
        />
      )}
      {plan && (
        <div style={{ position: 'absolute', inset: 0, visibility: canvasHidden ? 'hidden' : 'visible', pointerEvents: canvasHidden ? 'none' : 'auto' }}>
          <OutdoorPlanCanvas
            generationProjectId={slotId}
            ref={canvasApiRef}
            plan={plan}
            source={source}
            // 2026-11-11 用户拍板：户外默认有地理锚点（起步计划自带预置锚点、旧草稿一次性回填），
            // 默认铺真地图；「隐藏底图」钮把纸面平面底（P4-b）变成用户显式选择的形态，
            // 业务图层在两种形态下照常叠加。
            base={geoHidden ? 'floor' : 'map'}
            onPlanChange={setPlan}
            onVenueBoundaryApplied={agent?.manualOutdoorVenueApplied}
            {...(onHistoryChange ? { onHistoryChange } : {})}
            {...(onModeChange ? { onModeChange: mode => onModeChange(mode === 'select' ? 'select' : 'view') } : {})}
            {...(onInspectorChange ? { onInspectorChange } : {})}
            {...(inspectorHostId ? { inspectorHostId } : {})}
            panelsHostId="outdoor-panel-host-layers"
            infoPanelHostId="outdoor-panel-host-info"
            libraryPanelHostId="outdoor-panel-host-library"
            levelsHostId="outdoor-panel-host-levels"
            measureHostId="outdoor-panel-host-measure"
            annotateHostId="outdoor-panel-host-annotate"
            onActiveLevelChange={onActiveLevelChange}
            sceneObjects={sceneObjects}
            {...(placePin ? { searchPin: placePin } : {})}
            {...(placeArea ? { searchArea: placeArea } : {})}
            {...(agent?.routeProposal ? { routeProposal: agent.routeProposal } : {})}
            {...(agent?.zoneProposal ? { zoneProposal: agent.zoneProposal } : {})}
            {...(agent?.flowSimActive ? { flowSimRoutes: plan?.routes ?? null } : null)}
            generationController={controller}
            onOpenMaterialGenerate={(facilityId, kind) => {
              const facility = plan.facilities.find(item => item.id === facilityId);
              if (facility) setGenerateTarget({ facilityId, facilityName: facility.name, kind });
            }}
            {...(anchor ? { initialView: { lng: anchor.lng, lat: anchor.lat } } : {})}
          />
        </div>
      )}
      {plan && view === '3d' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
          <OutdoorPlan3D plan={plan} source={source} sceneObjects={sceneObjects} apiRef={plan3dApiRef} canvasApiRef={canvasApiRef} {...(mapView ? { mapView } : {})} />
        </div>
      )}
      {/* 搜地点（用户 m04938 / m05472）：左上角，和地图 App 一样。
          选中只把视图飞过去并落一枚定位钉，不改 plan / anchor。 */}
      {plan && (
        <PlanPlaceSearch
          testIdPrefix="outdoor-place-search"
          near={plan?.anchor ? { lng: plan.anchor.lng, lat: plan.anchor.lat } : null}
          onPickArea={area => {
            // 选区：只换视图（框住这片地），定位钉让位给边界，避免两种标记叠在一起。
            shapeSeqRef.current += 1; // 新选区使旧的 POI 挖形结果过期。
            setShapeLoading(false); // 行政区边界是现成的，没有挖形在途。
            setPlacePin(null);
            setPlaceArea({ polygon: area.polygon, label: `${area.name} · ${area.level}` });
            canvasApiRef.current?.focusBounds(area.bounds);
            plan3dApiRef.current?.focusLngLat(area.lng, area.lat);
          }}
          onPick={place => {
            setPlaceArea(null);
            setPlacePin({ lng: place.lng, lat: place.lat, label: place.name });
            canvasApiRef.current?.focusLngLat(place.lng, place.lat, 17);
            plan3dApiRef.current?.focusLngLat(place.lng, place.lat);
            // 2026-11-12（像高德一样点地名框出范围）：钉先落地，后台去 OSM 挖
            // 这个地点的真实占地。Overpass 忙时要排队几十秒，所以给足预算且
            // 失败静默保留钉，不打断交互。
            const seq = shapeSeqRef.current + 1;
            shapeSeqRef.current = seq;
            setShapeLoading(true);
            // 2026-11-13 用户「到底要怎么样能转出来选区」：上游公共镜像间歇抽风
            // （本机/CF 都会断），一次点击自动重试三轮（间隔 9s）——坏窗口里
            // 命中率翻几倍；期间「正在圈范围…」提示持续在，换目标/清除即停。
            const attemptShapeFetch = (attempt: number) => {
              void fetchPlaceShape(place.name, {
                near: { lng: place.lng, lat: place.lat },
              }).then(shape => {
                if (shapeSeqRef.current !== seq) return; // 期间换了目标：loading 归新目标管
                if (!shape && attempt < 2) {
                  window.setTimeout(() => attemptShapeFetch(attempt + 1), 9000);
                  return;
                }
                setShapeLoading(false);
                if (!shape) return;
                // 2026-11-13 用户拍板：出框后钉不撤——挪到范围正中继续挂着
                // （高德同款：蓝框 + 中心定位钉带名称胶囊）；选区顶部标签让位给这枚钉。
                const [west, south, east, north] = shape.bounds;
                setPlacePin({ lng: (west + east) / 2, lat: (south + north) / 2, label: place.name });
                setPlaceArea({
                  polygon: shape.polygon,
                  label: `${shape.name} · ${shape.kind === 'line' ? '线路' : '范围'}`,
                  ...(shape.kind === 'line' ? { kind: 'line' as const } : {}),
                });
                canvasApiRef.current?.focusBounds(shape.bounds);
              }).catch(() => {
                if (shapeSeqRef.current === seq && attempt < 2) {
                  window.setTimeout(() => attemptShapeFetch(attempt + 1), 9000);
                  return;
                }
                if (shapeSeqRef.current === seq) setShapeLoading(false);
              });
            };
            attemptShapeFetch(0);
          }}
          onClear={() => { shapeSeqRef.current += 1; setShapeLoading(false); setPlacePin(null); setPlaceArea(null); }}
        />
      )}
      {/* 2026-11-12 用户拍板：挖形期间的小提示（Overpass 排队 30~50s，别让用户以为点了没反应）。
          与画布白底名称胶囊同范式；只压 2D 画面，3D/接管态不出镜。 */}
      {shapeLoading && !canvasHidden && (
        <div
          data-testid="outdoor-shape-loading"
          className="sc-shape-loading-pill"
          style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 4 }}
        >
          正在圈范围…
        </div>
      )}
      {/* 右上角唯一交付入口：打开统一交付面板（分享 / 导出 / 发布都在面板内）。
          左下只留 2D/3D 胶囊（由 room-organizer 独立挂载），本覆盖层不再放相机 / 分享快捷钮。 */}
      {plan && (
        <button
          type="button"
          id="tool-outdoor-share"
          data-testid="outdoor-share"
          aria-label="分享与导出本方案"
          data-tip="分享 / 导出方案"
          onClick={() => setShareOpen(true)}
          style={{
            position: 'absolute',
            top: 16,
            right: 72,
            zIndex: 4,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 34,
            width: 34,
            borderRadius: 999,
            border: '1px solid #e4e4e7',
            background: '#ffffff',
            color: '#141416',
            cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(20, 20, 22, 0.10)',
            fontFamily: 'inherit',
            pointerEvents: 'auto',
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 15V3" />
            <path d="m7 8 5-5 5 5" />
            <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
          </svg>
        </button>
      )}
      {/* 右下：底图选择（OnePlan 的 Select a map）+ 隐藏底图 + 重看引导。
          2026-11-11 用户指令：整簇往右挪（right 80→24），贴近画布右缘；
          只动右下簇，右上交付簇的 right:80 是给 3D 楼层切换芯片让位的，不动。 */}
      <div
        style={{ position: 'absolute', right: 24, bottom: 16, zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}
      >
        {mapPickerOpen && (
          <div
            data-testid="outdoor-map-picker-panel"
            role="radiogroup"
            aria-label="选择底图"
            style={{
              width: 252,
              borderRadius: 14,
              background: PLANNING_SURFACE.panelBg,
              border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
              boxShadow: '0 12px 32px rgba(20, 20, 22, 0.18)',
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              fontFamily: 'inherit',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: PLANNING_SURFACE.panelText, padding: '2px 4px 4px' }}>选择底图</div>
            {SOURCE_CYCLE.map(option => {
              const active = option.id === source;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`map-source-${option.id}`}
                  onClick={() => { setSource(option.id); setGeoHidden(false); setMapPickerOpen(false); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '7px 9px',
                    borderRadius: 9,
                    border: `1px solid ${active ? PLANNING_SURFACE.selectedBorder : 'transparent'}`,
                    background: active ? PLANNING_SURFACE.selectedBg : 'transparent',
                    color: PLANNING_SURFACE.panelText,
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                  }}
                >
                  <span>{option.label}</span>
                  {active && <span style={{ fontSize: 11, opacity: 0.85 }}>当前</span>}
                </button>
              );
            })}
            {/* 2026-11-11：与室内地图类型菜单的「关闭底图」同语义——切纸面平面底（geoHidden）。 */}
            <button
              type="button"
              data-testid="map-picker-toggle-geo"
              onClick={() => { setGeoHidden(value => !value); setMapPickerOpen(false); }}
              style={{
                marginTop: 2,
                padding: '7px 9px',
                borderRadius: 9,
                border: `1px solid ${geoHidden ? PLANNING_SURFACE.selectedBorder : 'transparent'}`,
                background: geoHidden ? PLANNING_SURFACE.selectedBg : PLANNING_SURFACE.fieldBg,
                color: PLANNING_SURFACE.panelText,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
                width: '100%',
              }}
            >
              {geoHidden ? '恢复底图 · 真地图' : '关闭底图 · 纸面模式'}
            </button>
            {/* 2026-11-11：重看引导收进面板（原右下 ？ 钮按用户指令撤并）。 */}
            <button
              type="button"
              data-testid="map-picker-restart-guide"
              onClick={() => { guide.restart(); setMapPickerOpen(false); }}
              style={{
                padding: '6px 9px',
                borderRadius: 9,
                border: 'none',
                background: 'transparent',
                color: PLANNING_SURFACE.panelText,
                fontSize: 11,
                opacity: 0.75,
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
                width: '100%',
              }}
            >
              重看首次开图引导
            </button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* 2026-11-11 用户拍板：底部只留一枚图标钮（OnePlan 侧样）；隐藏底图/重看引导收进面板行。 */}
          <button
            type="button"
            id="tool-outdoor-source"
            data-testid="outdoor-source-cycle"
            aria-label={`底图：${currentSource.label}${geoHidden ? '（当前纸面）' : ''}（点选图源/关闭底图/重看引导）`}
            aria-expanded={mapPickerOpen}
            aria-haspopup="dialog"
            data-tip={`底图${geoHidden ? ' · 已关闭' : ` · ${currentSource.label}`}`}
            onClick={() => setMapPickerOpen(value => !value)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 34,
              height: 34,
              borderRadius: 999,
              border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
              background: PLANNING_SURFACE.panelBg,
              color: PLANNING_SURFACE.panelText,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(20, 20, 22, 0.10)',
              fontFamily: 'inherit',
            }}
          >
            <span aria-hidden style={{ opacity: 0.75 }}>{geoHidden ? '▢' : '◱'}</span>
          </button>
        </div>
      </div>
      {plan && (
        <OutdoorDeliveryPanel
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          activityName={activityName?.trim() || ''}
          summaryMeta={summaryMeta}
          shareLink={shareLink}
          handlers={deliveryHandlers}
        />
      )}
    </div>
  );
});

export default OutdoorPlanOverlay;

