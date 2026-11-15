'use client';
import { downloadOutdoorPlanDraft } from '../lib/outdoor-plan-handoff';

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

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import OutdoorPlanCanvas, {
  type CanvasBasemapSource,
  type OutdoorPlanCanvasHandle,
} from '@/components/room-organizer/components/outdoor-plan-canvas';
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
import { usePlaceShapeLookup } from '../hooks/use-place-shape-lookup';
import type { BackendSession } from '@/lib/backend-session';
import { createOutdoorMapContext,type OutdoorEvidenceHighlight } from '../lib/outdoor-map-context';
import { restoreOutdoorLibraryModels } from '../lib/outdoor-personal-library';
import { boundaryKey } from '../lib/outdoor-agent-contract';
import { loadFacilityModelCandidates } from '../lib/plan-facility-models';
import { findGeneratedFacilityModel,listGeneratedFacilityModels } from '../lib/facility-generated-models';
import { openGenerationSheet } from '../lib/generation-sheet';
import { useAgentOptional } from '@/components/room-organizer/panels/agent-panel';
import { PLANNING_SURFACE, PLANNING_TYPOGRAPHY } from '@/lib/outdoor-plan-tokens';
import {
  createStarterOutdoorPlan,
  DEFAULT_OUTDOOR_PLAN_ANCHOR,
  readOutdoorProjectRecord,
  saveOutdoorProjectRecord,
} from '@/components/room-organizer/lib/outdoor-project-store';
import { createDemoOutdoorPlan } from '@/components/room-organizer/lib/outdoor-demo-plan';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { DisplayUnit } from '../lib/types';
import type { PlanSceneObject } from '@/components/room-organizer/lib/plan-item-bridge';

/** 图源循环顺序（左下「图层」入口选图源）。方格内为示意地图画面（非真实瓦片预览）。 */
const SOURCE_CYCLE: { id: CanvasBasemapSource; label: string; featured?: boolean }[] = [
  { id: 'osm', label: 'OSM 街道' },
  { id: 'carto-light', label: 'Carto 浅色' },
  { id: 'carto-dark', label: 'Carto 深色', featured: true },
  { id: 'amap-satellite', label: '高德卫星', featured: true },
  { id: 'amap-streets', label: '高德街道', featured: true },
  { id: 'amap-streets-labels', label: '高德街道注记' },
  { id: 'vec', label: '天地图矢量' },
  { id: 'img', label: '天地图影像' },
];

/** 每枚底图缩略方格的示意画面：街道路网 / 卫星碎拼 / 深色路网 / 矢量蓝灰 四种模板配色。 */
function SourceThumb({ id }: { id: CanvasBasemapSource }) {
  const palette: Record<CanvasBasemapSource, { bg: string; road: string; block: string; mode: 'street' | 'satellite' | 'dark' | 'vector' }> = {
    'amap-streets': { bg: '#E9F1E6', road: '#FFFFFF', block: '#CFE3C8', mode: 'street' },
    'amap-satellite': { bg: '#5E7A52', road: '#E8E4D6', block: '#4A6247', mode: 'satellite' },
    'carto-dark': { bg: '#2B2F36', road: '#6A707C', block: '#363B45', mode: 'dark' },
    osm: { bg: '#EAF3E4', road: '#FFFFFF', block: '#D8E8D0', mode: 'street' },
    'carto-light': { bg: '#F3F1EC', road: '#FFFFFF', block: '#E3DFD5', mode: 'street' },
    'amap-streets-labels': { bg: '#EDF3EE', road: '#FFFFFF', block: '#DCEAE6', mode: 'street' },
    vec: { bg: '#EAF0F6', road: '#D4DCE6', block: '#DDE7F0', mode: 'vector' },
    img: { bg: '#4E6B55', road: '#6B805E', block: '#3E5A46', mode: 'satellite' },
  };
  const p = palette[id];
  return (
    <svg viewBox="0 0 48 48" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="48" height="48" fill={p.bg} />
      {p.mode === 'street' || p.mode === 'vector' ? (
        <>
          <path d="M0 30 L20 26 L48 32" stroke={p.road} strokeWidth="4" fill="none" />
          <path d="M18 0 L22 48" stroke={p.road} strokeWidth="3" fill="none" />
          <rect x="4" y="4" width="12" height="9" rx="2" fill={p.block} />
          <rect x="30" y="30" width="14" height="10" rx="2" fill={p.block} />
          <rect x="32" y="6" width="9" height="7" rx="2" fill={p.block} opacity=".7" />
        </>
      ) : p.mode === 'dark' ? (
        <>
          <path d="M0 28 L24 22 L48 28" stroke={p.road} strokeWidth="3" fill="none" />
          <path d="M20 0 L26 48" stroke={p.road} strokeWidth="2.5" fill="none" />
          <rect x="5" y="5" width="13" height="10" rx="2" fill={p.block} />
          <rect x="30" y="30" width="13" height="10" rx="2" fill={p.block} />
        </>
      ) : (
        <>
          <path d="M6 0 L18 18 L12 34 L22 48" stroke={p.block} strokeWidth="7" fill="none" opacity=".7" />
          <path d="M28 4 L40 16 L34 32 L44 46" stroke={p.road} strokeWidth="2.5" fill="none" opacity=".8" />
          <circle cx="14" cy="12" r="4" fill={p.block} />
          <circle cx="34" cy="38" r="5" fill={p.block} />
        </>
      )}
    </svg>
  );
}

/** 常态入口直选的三枚高频底图（顺序：街道 / 卫星 / 深色），其余图源收进展开面板。 */
const FEATURED_SOURCES = ['amap-streets', 'amap-satellite', 'carto-dark']
  .map(id => SOURCE_CYCLE.find(o => o.id === id))
  .filter((o): o is NonNullable<typeof o> => Boolean(o));

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
  onModeChange?: (mode: string) => void;
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
  onViewChange?:(view:'2d'|'3d')=>void;
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
  /** 2026-11-14 舞台合成截图（底图瓦片+业务层，封面口径）；无画布时 null。 */
  captureStageImage(): string | null;
  /** 按当前 plan 导出 PNG（与右侧导出菜单的 PNG 同一口径）；无 plan 时返回 false。 */
  exportPng(): boolean;
  /** 导出物料清单 CSV（单位跟随 lengthUnit）；无 plan 时不动作。 */
  exportCsv(): void;
  /** 导出场地几何 GeoJSON；无 plan 时不动作。 */
  exportGeoJson(): void;
  /** 导出 PDF 演示稿（打印排版）；无 plan 时不动作。 */
  exportPdf(): void;
  undo(): void;
  redo(): void;
  /** 2026-11-12 B1 选择工具：切 2D 画布浏览/选择模式（右栏工具排「选择」钮转发）。 */
  setCanvasMode(mode: 'view' | 'select'): void;
  /** 2026-11-15 测量直进：直接切画布编辑模式（measure / view 等）。 */
  setToolMode(mode: string): void;
  /** 2026-11-15 测量直进：切距离/面积/路径（工具条小标转发）。 */
  setMeasureKind(kind: 'distance' | 'area' | 'path'): void;
  /** 读取当前测量模式（工具条小标回显图标用）。 */
  getMeasureKind(): 'distance' | 'area' | 'path';
  /** 2026-11-15 户外网格吸附开关：开=对齐网格，关=自由摆放。 */
  setSnapOn(on: boolean): void;
  /** 2026-11-12 测量/标注收进右轨圆钮：开/关「工具与属性」浮窗并切页签（右轨圆钮转发）。 */
  setInspector(open: boolean, tab?: 'measure' | 'annotate' | 'selection'): void;
  /** 指北针 2D 态：复位视图到场地边界外框，缺边界则回锚点居中。 */
  focusVenue(): void;
  /** 2026-11-16：把视野框到设计范围（右下焦点钮在圈了范围时改派这里）。 */
  focusDesignScope(): void;
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
  dormant = false,
  inspectorHostId,
  lengthUnit = 'm',
  controller,
  onViewChange,
}: OutdoorPlanOverlayProps, ref): JSX.Element {
  const agent = useAgentOptional();
  // 2026-11-13（用户指令）：在 chat 里搜地点，地图左上角的「搜地点」框要同步出同一批候选，
  // 两处检索口径一致，不用在地图框里再输入一遍。这里只做只读同步：
  // 地图框里选中仍然只是「飞过去 + 落钉」，不改 plan / anchor；真要锚定场地走对话里的确认卡。
  const venueSearchSync = useMemo(() => {
    const pick = agent?.venuePick;
    if (!pick || !pick.query.trim() || pick.loading) return null;
    return { query: pick.query, hits: pick.candidates };
  }, [agent?.venuePick?.query, agent?.venuePick?.candidates, agent?.venuePick?.loading]);
  const canvasApiRef = useRef<OutdoorPlanCanvasHandle | null>(null);
  const slotId = projectId || LOCAL_DRAFT_SLOT;
  // 初始读已存的图源偏好；早先这里硬编码 'osm'，mount 后写回偏好时会把用户选过的源冲掉。
  const [source, setSource] = useState<CanvasBasemapSource>(() => readPlanGroundSource());
  const [plan, setPlan] = useState<SitePlanData | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [shareOpen, setShareOpen] = useState(false);
  const guide = useGuide(GUIDE_STORAGE_KEY);
  const [guideHidden, setGuideHidden] = useState(false);
  const showGuide = !dormant && !guideHidden && Boolean(guide.activeStep);
  useEffect(() => {
    if (!showGuide) return;
    const hideOnOutsideAction = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[data-guide-anchor]')) return;
      setGuideHidden(true);
    };
    // Capture window events so map gestures and tools rendered through portals also count.
    window.addEventListener('pointerdown', hideOnOutsideAction, true);
    window.addEventListener('wheel', hideOnOutsideAction, { capture: true, passive: true });
    window.addEventListener('click', hideOnOutsideAction, true);
    window.addEventListener('input', hideOnOutsideAction, true);
    return () => {
      window.removeEventListener('pointerdown', hideOnOutsideAction, true);
      window.removeEventListener('wheel', hideOnOutsideAction, true);
      window.removeEventListener('click', hideOnOutsideAction, true);
      window.removeEventListener('input', hideOnOutsideAction, true);
    };
  }, [showGuide]);
  // 底图选择面板：对齐 OnePlan 的 Select a map —— 画布右下角一枚「底图」钮 + 弹出列表，
  // 不再把「OSM」这种图源缩写塞进室内工具排里让人猜。
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  // 2026-11-15 Google 图层范式：常态只露折叠钮；指针进入入口区域才浮出高频缩略竖列，移出收回。
  const [layerHover, setLayerHover] = useState(false);
  // 折叠钮与浮层之间留有间隙：离开后延迟收起，指针横穿间隙进入浮层时立即取消，避免移动途中浮层消失。
  const layerHoverTimer = useRef<number | null>(null);
  // 2026-11-11 用户拍板：户外默认铺真地图（起步计划自带预置锚点）；纸面格网降级为
  // 用户显式「隐藏底图」的形态。geoHidden = true 时切纸面，业务图层不受影响。
  const [geoHidden, setGeoHidden] = useState(false);
  // 2D 画布始终挂载（左栏图层/测量/标注都 portal 到它上面）。
  // 3D 场地由壳体全屏 OutdoorPlan3D 唯一接管；本覆盖层只保留 2D 画布编辑桥，不再自挂 3D 实例。

  // 搜地点（用户 m04938 / m05472）：左上角「和地图 App 一样」的搜索框，组件本体在
  // `plan-place-search.tsx`（2D 工作台与编辑器内嵌覆盖层共用同一份）。
  // 定位钉只是视图辅助（不改 plan / anchor），点「清除」即撤钉。
  const [placePin, setPlacePin] = useState<{ lng: number; lat: number; label: string } | null>(null);
  // 2026-11-12 用户要求「给相关的选区，而不是一个居中的点」：行政区边界（视图辅助，不改 plan）。
  // kind: 'line' = 道路等开放折线选区（2026-11-13「点道路=道路选区」）。
  const [placeArea, setPlaceArea] = useState<{ polygon: [number, number][]; label: string; kind?: 'area' | 'line' } | null>(null);
  const { loading: shapeLoading, start: lookupPlaceShape, cancel: cancelPlaceShape } = usePlaceShapeLookup(slotId, (shape, name) => {
    const [west, south, east, north] = shape.bounds;
    setPlacePin({ lng: (west + east) / 2, lat: (south + north) / 2, label: name });
    setPlaceArea({ polygon: shape.polygon, label: `${shape.name} · ${shape.kind === 'line' ? '线路' : '范围'}`,
      ...(shape.kind === 'line' ? { kind: 'line' as const } : {}) });
    canvasApiRef.current?.focusBounds(shape.bounds);
  }, JSON.stringify(plan?.boundary ?? []));

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
    cancelPlaceShape(); setPlacePin(null); setPlaceArea(null);
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
  const mapContextRef=useRef(createOutdoorMapContext());
  const [evidenceHighlights,setEvidenceHighlights]=useState<OutdoorEvidenceHighlight[]>([]);
  useEffect(()=>{mapContextRef.current.invalidate();setEvidenceHighlights([]);},[slotId]);
  const flowRef=useRef(agent?.outdoorWorkflow);flowRef.current=agent?.outdoorWorkflow;
  const viewChangeRef=useRef(onViewChange);viewChangeRef.current=onViewChange;
  const planRef = useRef<SitePlanData | null>(plan);
  planRef.current = plan;
  // V-2d/V-3c：把「应用流线/应用区域」的画布入口与当前 plan 读取口注册给 chat agent——
  // 气泡确认后 provider 调这里；plan 经 ref 每帧取最新，注册一次终身有效。
  useEffect(() => {
    agent?.registerRouteBridge?.({
      projectId:()=>slotId,
      exportPlanDraft:(expected,context)=>{const current=canvasApiRef.current?.getEditVisuals().plan??planRef.current;if(!current||JSON.stringify(current)!==expected)return false;downloadOutdoorPlanDraft(current,slotId,context);return true;},
      beginDrawing:kind=>{if(!canvasApiRef.current)return false;canvasApiRef.current.setMode(kind);return true;},
      applyPlan:(next,expected)=>{const ok=canvasApiRef.current?.applyWorkflowPlan(next,expected)??false;if(ok){setPlacePin(null);setPlaceArea(null);}return ok;},
      selectedIds:()=>canvasApiRef.current?.getSelectedIds()??[],
      previewBoundary: (anchor, boundary) => {
        setPlacePin(null);
        setPlaceArea(null);
        if (!boundary.length) return;
        const points = boundary.map(point => enuToLngLat(point.x, point.y, anchor.lng, anchor.lat));
        const lngs = points.map(point => point.lng);
        const lats = points.map(point => point.lat);
        canvasApiRef.current?.focusBounds([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]);
      },
      setView:next=>{viewChangeRef.current?.(next);},
      models:async id=>{const f=(canvasApiRef.current?.getEditVisuals().plan??planRef.current)?.facilities.find(f=>f.id===id);if(!f)return[];const result=await loadFacilityModelCandidates([f.templateId]);const own=listGeneratedFacilityModels(id,slotId);const current=f.modelOverride?findGeneratedFacilityModel(f.modelOverride):null;if(current&&current.projectId===slotId&&!own.some(m=>m.slug===current.slug))own.unshift(current);return[...own.map(m=>({slug:m.slug,name:m.name,source:'此设施已有/上传模型',width:m.width,depth:m.depth,height:m.height})),...(result.get(f.templateId)??[]).map(m=>({slug:m.slug,name:m.name,source:'现有公共物料库',width:m.width,depth:m.depth,height:m.height}))].slice(0,5);},
      openGenerate:(id,kind)=>{const f=(canvasApiRef.current?.getEditVisuals().plan??planRef.current)?.facilities.find(f=>f.id===id);if(!f)return false;openGenerationSheet({task:'model',scope:'facility',source:kind,facility:{id,name:f.name}});return true;},
      openUpload:id=>canvasApiRef.current?.openFacilityUpload(id)??false,
      mapContext:async signal=>{const p=canvasApiRef.current?.getEditVisuals().plan??planRef.current;if(!p)throw new Error('当前活动尚未载入');return mapContextRef.current.load(slotId,p,canvasApiRef.current?.getSelectedIds()??[],flowRef.current?.state.confirmedBoundary===boundaryKey(p),signal);},
      proposeZones:(p,brief)=>mapContextRef.current.zones(p,brief),
      roadNetwork:()=>mapContextRef.current.roads(),
      proposeSpatialEdit:(turn,p)=>mapContextRef.current.spatial(turn,p),
      validateCurrentReferences:refs=>mapContextRef.current.validateReferences(refs),
      validateMapPlan:(base,next)=>mapContextRef.current.validate(base,next),
      highlightReferences:refs=>setEvidenceHighlights(mapContextRef.current.highlights(refs)),
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
      applyWorkers: workers => canvasApiRef.current?.applyWorkers(workers) ?? false,
      applyMeasurements: measurements => canvasApiRef.current?.applyMeasurements(measurements) ?? false,
      applyAnnotations: annotations => canvasApiRef.current?.applyAnnotations(annotations) ?? false,
      getLevels: () => canvasApiRef.current?.getLevels() ?? [],
      setActiveLevel: levelId => canvasApiRef.current?.setActiveLevel(levelId) ?? false,
      addFacility: facility => canvasApiRef.current?.addFacility(facility) ?? false,
      removeFacility: id => canvasApiRef.current?.removeFacility(id) ?? false,
      updateFacility: (id, patch) => canvasApiRef.current?.updateFacility(id, patch) ?? false,
      getPlan: () => canvasApiRef.current?.getEditVisuals().plan ?? planRef.current,
    });
    return () => agent?.registerRouteBridge?.(null);
  }, [agent,slotId]);
  const libraryAssetSignature=JSON.stringify(plan?.facilities.filter(f=>f.sourceAssetId).map(f=>[f.id,f.sourceAssetId,f.modelOverride])??[]);
  useEffect(()=>{const p=planRef.current;if(!p)return;const request=new AbortController();void restoreOutdoorLibraryModels(controller??null,slotId,p,request.signal).catch(()=>{/* unavailable models stay visibly unavailable; no generated fallback */});return()=>request.abort();},[slotId,controller,libraryAssetSignature]);
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
    if (layerHoverTimer.current !== null) window.clearTimeout(layerHoverTimer.current);
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
      canvasApiRef.current?.zoomBy(direction);
    },
    getCanvasApi: () => canvasApiRef.current,
    captureImage: () => canvasApiRef.current?.captureImage() ?? null,
    captureStageImage: () => canvasApiRef.current?.captureStageImage() ?? null,
    exportPng: () => exportPlanPng(),
    exportCsv: () => { if (plan) downloadPlanCsv(plan, exportStem, lengthUnit); },
    exportGeoJson: () => { if (plan) downloadPlanGeoJson(plan, exportStem); },
    exportPdf: () => printDeck(),
    undo: () => canvasApiRef.current?.undo(),
    redo: () => canvasApiRef.current?.redo(),
    setCanvasMode: (mode: 'view' | 'select') => canvasApiRef.current?.setMode(mode),
    setToolMode: (mode: string) => canvasApiRef.current?.setMode(mode),
    setMeasureKind: (kind: 'distance' | 'area' | 'path') => canvasApiRef.current?.setMeasureKind(kind),
    getMeasureKind: () => canvasApiRef.current?.getMeasureKind() ?? 'distance',
    setSnapOn: (on: boolean) => canvasApiRef.current?.setSnapOn(on),
  setInspector: (open: boolean, tab?: 'measure' | 'annotate' | 'selection') => canvasApiRef.current?.setInspector(open, tab),
  focusVenue: () => {
    const current = planRef.current;
    if (!current?.anchor) return;
    const { lng, lat } = current.anchor;
    if (current.boundary && current.boundary.length >= 3) {
      const geos = current.boundary.map(point => enuToLngLat(point.x, point.y, lng, lat));
      const lngs = geos.map(g => g.lng);
      const lats = geos.map(g => g.lat);
      canvasApiRef.current?.focusBounds([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]);
    } else {
      canvasApiRef.current?.focusLngLat(lng, lat);
    }
  },
  focusDesignScope: () => {
    // 2026-11-16 用户指令：左栏「定位到设计范围」那行已经删了，同样的事改由右轨焦点钮发起。
    // 只框视图、不改 plan；没范围时画布内部静默不动，调用方自己回落。
    canvasApiRef.current?.focusDesignScope();
  },
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

  // #81：一键载入内置示范场景（7 岗位 · 5 设施 · 矩形边界），替代过去靠脚本注入的一次性测试场景。
  // 覆写当前平面后经既有 setPlan 链路自动上报 3D 镜像、400ms 防抖落盘。
  const loadDemoPlan = () => {
    const demo = createDemoOutdoorPlan();
    setPlacePin(null);
    setPlaceArea(null);
    setPlan(demo);
    if (demo.anchor && demo.boundary.length > 0) {
      const geos = demo.boundary.map(point => enuToLngLat(point.x, point.y, demo.anchor!.lng, demo.anchor!.lat));
      canvasApiRef.current?.focusBounds([
        Math.min(...geos.map(p => p.lng)), Math.min(...geos.map(p => p.lat)),
        Math.max(...geos.map(p => p.lng)), Math.max(...geos.map(p => p.lat)),
      ]);
    }
  };

  const currentSource = SOURCE_CYCLE.find(s => s.id === source) ?? SOURCE_CYCLE[0];
  // 3D 接管态（dormant）下本覆盖层只是「保活的编辑桥」：2D 画面、浮层、切换钮全部不出镜。
  const canvasHidden = dormant;

  return (
    <div
      data-testid="outdoor-overlay"
      style={{ position: 'absolute', inset: 0, zIndex: 30, background: dormant ? 'transparent' : 'var(--sc-surface, #ffffff)', color: 'var(--sc-ink, #141416)', ...(dormant ? { visibility: 'hidden' as const, pointerEvents: 'none' as const } : {}) }}
    >
      {/* 2026-11-15：属性卡不再自己开一张原位生成表单，统一进「生成」面板（见 GenerationSheetHost）。 */}
      {showGuide && guide.activeStep && (
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
            {...(onModeChange ? { onModeChange: mode => onModeChange(mode) } : {})}
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
            workflowPreview={agent?.outdoorWorkflow?.proposal?.next??null}
            workflowScopePreview={agent?.outdoorWorkflow?.proposal?.kind === 'scope'}
            mapEditHighlight={agent?.outdoorWorkflow?.appliedHighlight ?? null}
            evidenceHighlights={evidenceHighlights}
            {...(agent?.zoneProposal ? { zoneProposal: agent.zoneProposal } : {})}
            {...(agent?.flowSimActive ? { flowSimRoutes: plan?.routes ?? null } : null)}
            generationController={controller}
            {...(anchor ? { initialView: { lng: anchor.lng, lat: anchor.lat } } : {})}
          />
        </div>
      )}
      {/* 搜地点（用户 m04938 / m05472）：左上角，和地图 App 一样。
          选中只把视图飞过去并落一枚定位钉，不改 plan / anchor。 */}
      {plan && (
        <PlanPlaceSearch
          testIdPrefix="outdoor-place-search"
          {...(venueSearchSync ? { sync: venueSearchSync } : {})}
          near={plan?.anchor ? { lng: plan.anchor.lng, lat: plan.anchor.lat } : null}
          onPickArea={area => {
            // 选区：只换视图（框住这片地），定位钉让位给边界，避免两种标记叠在一起。
            cancelPlaceShape(); // Includes the pending retry and in-flight request.
            setPlacePin(null);
            setPlaceArea({ polygon: area.polygon, label: `${area.name} · ${area.level}` });
            canvasApiRef.current?.focusBounds(area.bounds);
          }}
          onPick={place => {
            setPlaceArea(null);
            setPlacePin({ lng: place.lng, lat: place.lat, label: place.name });
            canvasApiRef.current?.focusLngLat(place.lng, place.lat, 17);
            // Pin immediately. Retries, abort, and the centered outline stay on this project/place.
            lookupPlaceShape(place.name, { lng: place.lng, lat: place.lat });
          }}
          onClear={() => { cancelPlaceShape(); setPlacePin(null); setPlaceArea(null); }}
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
      {/* 2026-11-15 旧独立分享/导出钮退役：分享、导出、发布统一收进右上工具簇的 ShareMenu 面板，
          本覆盖层不再自摆快捷钮。OutdoorDeliveryPanel 仅保留为面板挂载宿主，不再由此处按钮打开。 */}
      {/* 2026-11-15 底图切换（Google 地图「图层」范式）：左下常态露三枚高频底图缩略直选，
          第四格「展开」进完整底图面板（缩略网格 + 纸面模式 + 重看引导）。 */}
      {/* #81：内置示范场景一键载入（7 岗位 · 5 设施）；覆写当前平面，经 autosave 落盘。 */}
      {plan && (
        <button
          type="button"
          id="tool-outdoor-demo"
          data-testid="outdoor-load-demo"
          aria-label="载入内置示范场景"
          data-tip="载入示范场景（7 岗位 · 5 设施，覆盖当前平面）"
          onClick={loadDemoPlan}
          style={{
            position: 'absolute',
            top: 16,
            right: 112,
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
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="8.5" cy="9" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="15.5" cy="14.5" r="1.4" fill="currentColor" stroke="none" />
            <path d="M3 15.5h5M15.5 9H21" />
          </svg>
        </button>
      )}
      {/* 右下：底图选择（OnePlan 的 Select a map）+ 隐藏底图 + 重看引导。
          2026-11-11 用户指令：整簇往右挪（right 80→24），贴近画布右缘；
          只动右下簇，右上交付簇的 right:80 是给 3D 楼层切换芯片让位的，不动。 */}
      <div
        style={{ position: 'absolute', left: 24, bottom: 20, zIndex: 4, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}
      >
        {mapPickerOpen && (
          <div
            data-testid="outdoor-map-picker-panel"
            role="radiogroup"
            aria-label="选择底图"
            style={{
              width: 288,
              borderRadius: 14,
              background: PLANNING_SURFACE.panelBg,
              border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
              boxShadow: '0 12px 32px rgba(20, 20, 22, 0.18)',
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              fontFamily: 'inherit',
            }}
          >
            <div style={{ fontSize: PLANNING_TYPOGRAPHY.panel, fontWeight: 700, color: PLANNING_SURFACE.panelText }}>选择底图</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {SOURCE_CYCLE.map(option => {
                const active = !geoHidden && option.id === source;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    data-testid={`map-source-${option.id}`}
                    onClick={() => { setSource(option.id); setGeoHidden(false); setMapPickerOpen(false); }}
                    style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    <span
                      aria-hidden="true"
                      style={{ height: 46, borderRadius: 10, border: `2px solid ${active ? PLANNING_SURFACE.selectedBorder : PLANNING_SURFACE.panelBorder}`, overflow: 'hidden', background: '#fff', boxSizing: 'border-box' }}
                    >
                      <SourceThumb id={option.id} />
                    </span>
                    <span style={{ fontSize: PLANNING_TYPOGRAPHY.row, color: active ? PLANNING_SURFACE.panelText : PLANNING_SURFACE.panelText, fontWeight: active ? 600 : 400, textAlign: 'center', whiteSpace: 'nowrap', opacity: active ? 1 : 0.72 }}>
                      {option.label}
                    </span>
                  </button>
                );
              })}
              {/* 纸面模式：与底图同列的一格，勾选即隐藏真地图、切平面格网底。 */}
              <button
                type="button"
                data-testid="map-picker-toggle-geo"
                aria-pressed={geoHidden}
                onClick={() => { setGeoHidden(value => !value); setMapPickerOpen(false); }}
                style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    height: 46, borderRadius: 10, boxSizing: 'border-box',
                    border: `2px solid ${geoHidden ? PLANNING_SURFACE.selectedBorder : PLANNING_SURFACE.panelBorder}`,
                    background: '#ffffff',
                    backgroundImage: 'linear-gradient(#e4e4e7 1px, transparent 1px), linear-gradient(90deg, #e4e4e7 1px, transparent 1px)',
                    backgroundSize: '14px 14px',
                  }}
                />
                <span style={{ fontSize: PLANNING_TYPOGRAPHY.row, color: PLANNING_SURFACE.panelText, fontWeight: geoHidden ? 600 : 400, textAlign: 'center', whiteSpace: 'nowrap', opacity: geoHidden ? 1 : 0.72 }}>
                  纸面模式
                </span>
              </button>
            </div>
            {/* 2026-11-11：重看引导收进面板（原右下 ？ 钮按用户指令撤并）。 */}
            <button
              type="button"
              data-testid="map-picker-restart-guide"
              onClick={() => { guide.restart(); setGuideHidden(false); setMapPickerOpen(false); }}
              style={{
                padding: '6px 9px',
                borderRadius: 9,
                border: 'none',
                background: 'transparent',
                color: PLANNING_SURFACE.panelText,
                fontSize: PLANNING_TYPOGRAPHY.row,
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
        {/* 图层入口（Google 折叠-悬停范式）：常态一枚折叠钮；指针进入区域在右侧浮出高频缩略竖列，移出收回；点展开格进完整底图面板。 */}
        <div
          onMouseEnter={() => {
            if (layerHoverTimer.current !== null) { window.clearTimeout(layerHoverTimer.current); layerHoverTimer.current = null; }
            setLayerHover(true);
          }}
          onMouseLeave={() => {
            layerHoverTimer.current = window.setTimeout(() => setLayerHover(false), 140);
          }}
          style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 10 }}
        >
          <button
            type="button"
            id="tool-outdoor-source"
            data-testid="outdoor-source-cycle"
            aria-label={`底图：${currentSource.label}${geoHidden ? '（当前纸面）' : ''}（点击在街道与卫星地图之间切换）`}
            data-tip={`底图${geoHidden ? ' · 已关闭' : ` · ${currentSource.label}`} · 点击切换街道/卫星`}
            onClick={() => {
              // 折叠卡直切：街道 ↔ 卫星互切；完整图源面板走悬停竖列里的「展开」格。
              const toSatellite = !(source === 'amap-satellite' && !geoHidden);
              setSource(toSatellite ? 'amap-satellite' : 'amap-streets');
              setGeoHidden(false);
            }}
            style={{
              position: 'relative',
              width: 64,
              height: 72,
              borderRadius: 12,
              border: `2px solid ${PLANNING_SURFACE.panelBorder}`,
              overflow: 'hidden',
              padding: 0,
              background: PLANNING_SURFACE.fieldBg,
              cursor: 'pointer',
              fontFamily: 'inherit',
              boxShadow: '0 4px 14px rgba(20, 20, 22, 0.18)',
            }}
          >
            <span aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'block' }}>
              {geoHidden ? (
                <svg viewBox="0 0 48 48" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                  <rect width="48" height="48" fill="#F4F5F7" />
                  <path d="M0 16h48M0 32h48M16 0v48M32 0v48" stroke="#D7D9DE" strokeWidth="1" />
                </svg>
              ) : (
                <SourceThumb id={source} />
              )}
            </span>
            <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 6px 6px', background: 'linear-gradient(180deg, rgba(20,20,22,0) 0%, rgba(20,20,22,0.72) 100%)', color: '#ffffff', fontSize: 10, fontWeight: 600, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {geoHidden ? '纸面' : currentSource.label}
            </span>
          </button>

          {layerHover && (
            <div
              style={{
                position: 'absolute',
                left: 'calc(100% + 10px)',
                bottom: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                alignItems: 'stretch',
                padding: 8,
                background: PLANNING_SURFACE.panelBg,
                border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
                borderRadius: 14,
                boxShadow: '0 8px 24px rgba(20, 20, 22, 0.14)',
                zIndex: 5,
              }}
            >
              {FEATURED_SOURCES.map(option => {
                const active = !geoHidden && option.id === source;
                return (
                  <button
                    key={option.id}
                    type="button"
                    data-testid={`map-source-${option.id}-entry`}
                    aria-label={`底图：${option.label}`}
                    aria-pressed={active}
                    onClick={() => { setSource(option.id); setGeoHidden(false); }}
                    style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, width: 116, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 36, height: 36, borderRadius: 8, boxSizing: 'border-box', overflow: 'hidden', flex: 'none',
                        border: `2px solid ${active ? PLANNING_SURFACE.selectedBorder : PLANNING_SURFACE.panelBorder}`,
                      }}
                    >
                      <SourceThumb id={option.id} />
                    </span>
                    <span style={{ fontSize: PLANNING_TYPOGRAPHY.row, color: PLANNING_SURFACE.panelText, fontWeight: active ? 600 : 400, textAlign: 'left', whiteSpace: 'nowrap', opacity: active ? 1 : 0.72 }}>
                      {option.label}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                aria-label="展开更多图层"
                onClick={() => { setMapPickerOpen(true); setLayerHover(false); }}
                style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, width: 116, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 36, height: 36, borderRadius: 8, boxSizing: 'border-box', flex: 'none',
                    border: '2px dashed #d4d4d8',
                    background: PLANNING_SURFACE.fieldBg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: `${PLANNING_SURFACE.panelText}99`,
                  }}
                >
                  <span style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 6px)', gap: 4 }}>
                    {[0, 1, 2, 3].map(i => <span key={i} style={{ width: 6, height: 6, borderRadius: 2, background: `${PLANNING_SURFACE.panelText}66` }} />)}
                  </span>
                </span>
                <span style={{ fontSize: PLANNING_TYPOGRAPHY.row, color: `${PLANNING_SURFACE.panelText}99`, textAlign: 'left', whiteSpace: 'nowrap' }}>展开</span>
              </button>
            </div>
          )}
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

