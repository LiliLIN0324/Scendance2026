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
import { answersPlaceRequest } from '../lib/outdoor-place-handover';
import { loadFacilityModelCandidates } from '../lib/plan-facility-models';
import { findGeneratedFacilityModel,listGeneratedFacilityModels } from '../lib/facility-generated-models';
import { openGenerationSheet } from '../lib/generation-sheet';
import { useAgentOptional } from '@/components/room-organizer/panels/agent-panel';
import { Layers3, X } from 'lucide-react';
import {
  createStarterOutdoorPlan,
  DEFAULT_OUTDOOR_PLAN_ANCHOR,
  outdoorPlanStorageKey,
  readOutdoorProjectRecord,
  readOutdoorProjectRecordDetailed,
  saveOutdoorProjectRecord,
} from '@/components/room-organizer/lib/outdoor-project-store';
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

/** 地图详情面板的第一组：对应 Google Maps 的「默认 / 卫星 / 深色」。 */
const PRIMARY_MAP_SOURCES: { id: CanvasBasemapSource; label: string }[] = [
  { id: 'amap-streets', label: '默认' },
  { id: 'amap-satellite', label: '卫星' },
  { id: 'carto-dark', label: '深色' },
];

/** 268px 宽的面板一列只有 72px；长名保留原意但改用更短的标签，避免被省略号截断。 */
const MORE_MAP_LABELS: Record<string, string> = {
  'amap-streets-labels': '高德注记',
};

/** 其余可用图源放在「更多底图」组里，避免把 8 种图源平铺成一整面墙。 */
const MORE_MAP_SOURCES = SOURCE_CYCLE
  .filter(option => !PRIMARY_MAP_SOURCES.some(primary => primary.id === option.id))
  .map(option => ({ id: option.id, label: MORE_MAP_LABELS[option.id] ?? option.label }));

/** 悬停竖列里的高频底图（上一版结构）：地图 / 卫星 / 深色，其余走「展开」。 */
const FEATURED_SOURCES: { id: CanvasBasemapSource; label: string }[] = [
  { id: 'amap-streets', label: '地图' },
  { id: 'amap-satellite', label: '卫星' },
  { id: 'carto-dark', label: '深色' },
];

function MapDetailsPanel({ source, geoHidden, onPickSource, onTogglePaper, onClose }: {
  source: CanvasBasemapSource;
  geoHidden: boolean;
  onPickSource: (id: CanvasBasemapSource) => void;
  onTogglePaper: () => void;
  onClose: () => void;
}) {
  const sourceTile = ({ id, label }: { id: CanvasBasemapSource; label: string }) => {
    const active = !geoHidden && id === source;
    return (
      <button
        key={id}
        type="button"
        role="radio"
        aria-checked={active}
        aria-label={`底图：${label}`}
        data-testid={`map-source-${id}`}
        onClick={() => onPickSource(id)}
        className="oc-map-details__source"
      >
        <span className="oc-map-details__thumb" aria-hidden="true">
          <SourceThumb id={id} />
        </span>
        <span className="oc-map-details__name">{label}</span>
      </button>
    );
  };

  return (
    <div
      id="outdoor-map-details"
      data-testid="outdoor-map-picker-panel"
      role="dialog"
      aria-label="地图详情"
      className="oc-map-details"
    >
      <div className="oc-map-details__head">
        <span className="oc-map-details__title">地图详情</span>
        <button
          type="button"
          data-testid="map-picker-close"
          aria-label="关闭地图详情"
          className="oc-map-details__close"
          onClick={onClose}
        >
          <X size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      <div className="oc-map-details__body">
        <div className="oc-map-details__section">
          <div className="oc-map-details__label">地图类型</div>
          <div className="oc-map-details__grid" role="radiogroup" aria-label="地图类型">
            {PRIMARY_MAP_SOURCES.map(sourceTile)}
          </div>
        </div>
        <div className="oc-map-details__section">
          <div className="oc-map-details__label">更多底图</div>
          <div className="oc-map-details__grid" role="radiogroup" aria-label="更多底图">
            {MORE_MAP_SOURCES.map(sourceTile)}
            <button
              type="button"
              role="radio"
              aria-checked={geoHidden}
              aria-label="纸面模式"
              data-testid="map-picker-toggle-geo"
              onClick={onTogglePaper}
              className="oc-map-details__source"
            >
              <span className="oc-map-details__thumb oc-map-details__thumb--paper" aria-hidden="true" />
              <span className="oc-map-details__name">纸面模式</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

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
  /** 2026-11-12 三张卡拆开：测量 / 标注 / 属性 各自展开态上报（右轨三枚圆钮的按下态）。
   *  2026-11-17：测量/标注互斥，属性独立。 */
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
  /** 焦点钮：复位视图到场地边界外框，缺边界则回锚点居中。罗盘回正北不走这里。 */
  focusVenue(): void;
  /** 2026-11-16：把视野框到设计范围（右下焦点钮在圈了范围时改派这里）。 */
  focusDesignScope(): void;
  /** 2D 罗盘方位角（弧度，与 3D getBearing 同号）。 */
  getBearing(): number;
  /** 2D 罗盘转角。正值让北在屏幕上顺时针转。 */
  orbitByDelta(deltaTheta: number): void;
  /** 2D 罗盘回正北：只清方位角，不改视口中心。框选场地仍走 focusVenue。 */
  resetNorth(): void;
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
  /** P0 加载三态：loading=正在读本机草稿；error=草稿存在但坏了，禁止静默播种覆盖。 */
  const [planLoad, setPlanLoad] = useState<{ status: 'loading' | 'ready' | 'error'; message: string }>({ status: 'loading', message: '' });
  const [planLoadAttempt, setPlanLoadAttempt] = useState(0);
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
  // 2026-11-16 用户指令：恢复上一版竖排手感——常态一枚「图层」缩略钮；鼠标悬停（或手机点按）
  // 在右侧浮出竖列；点竖列末尾的「展开」才进入完整「地图详情」，X 关掉后只剩图层钮。
  const [layerStripOpen, setLayerStripOpen] = useState(false);
  const layerHoverTimer = useRef<number | null>(null);
  const layerDockRef = useRef<HTMLDivElement | null>(null);
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
  /**
   * 2026-11-16 线上实测卡点：对话停在「搜索目标地点」时，用户在画布左上角搜到的地点只会飞视图、落钉，
   * 对话不接手，户外主线就断在这——两边各搜各的，谁也不知道对方找到了什么。
   * 这里把这次选点当成对那句「找场地」的回答，直接送进对话的候选确认卡（仍要用户点候选才算确认，
   * 不自动锚定场地）；其它阶段保持原来的「只看一眼」语义，不打断分区/流线工作。
   */
  const handOverPlaceToChat = (name: string) =>
    answersPlaceRequest(agent?.outdoorWorkflow.state.stage, name, query => agent?.searchOutdoorVenue(query));

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
    const result = readOutdoorProjectRecordDetailed(slotId);
    if (result.rawPresent && (result.error !== null || result.planInvalid)) {
      const reason = result.planInvalid
        ? '草稿里的方案数据没通过结构校验（可能是旧版本或字段损坏）。'
        : result.error === 'json'
          ? '草稿 JSON 无法解析。'
          : result.error === 'envelope'
            ? '草稿信封版本或项目 ID 不匹配。'
            : '草稿缺少名称/时间等元信息。';
      setPlan(null);
      setPlanLoad({ status: 'error', message: `${reason} 已停止自动载入，原草稿没有被覆盖。` });
      return;
    }
    setPlanLoad({ status: 'ready', message: '' });
    // #51 方案甲：载入即吸附设施权威宽高比（幂等），anchor 缺省分支在规整结果上继续。
    const loaded = normalizePlanFacilityFootprints(
      result.record?.plan ?? seedPlanRef.current ?? createStarterOutdoorPlan(),
    );
    if (!loaded.anchor && !anchorRef.current) {
      setPlan({ ...loaded, anchor: DEFAULT_OUTDOOR_PLAN_ANCHOR });
      return;
    }
    setPlan(loaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotId, planLoadAttempt]);

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
  // 快捷条只在鼠标悬停/点按时展开；点外面或 Esc 收起（完整面板仍只认 X）。
  useEffect(() => {
    if (!layerStripOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (layerDockRef.current?.contains(event.target as Node)) return;
      setLayerStripOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLayerStripOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [layerStripOpen]);
  // 完整「地图详情」是模态浮层：Esc 或点画布都能关；标题与 X 固定，不随面板内容滚动。
  useEffect(() => {
    if (!mapPickerOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (layerDockRef.current?.contains(event.target as Node)) return;
      setMapPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      setMapPickerOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [mapPickerOpen]);
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
  getBearing: () => canvasApiRef.current?.getBearing() ?? 0,
  orbitByDelta: (deltaTheta: number) => { canvasApiRef.current?.orbitByDelta(deltaTheta); },
  resetNorth: () => { canvasApiRef.current?.resetNorth(); },
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

  /** 损坏草稿的显式恢复：先把原始 JSON 备份到同 key 的 :broken-时间戳，再落空白方案。 */
  function startBlankAfterLoadError(): void {
    const base = normalizePlanFacilityFootprints(seedPlanRef.current ?? createStarterOutdoorPlan());
    const next = !base.anchor && !anchorRef.current ? { ...base, anchor: DEFAULT_OUTDOOR_PLAN_ANCHOR } : base;
    try {
      const key = outdoorPlanStorageKey(slotId);
      const raw = window.localStorage.getItem(key);
      if (raw) window.localStorage.setItem(`${key}:broken-${Date.now()}`, raw);
    } catch {
      // 备份写不进去（配额/隐私模式）就不强推覆盖；用户可先复制原草稿再试。
      return;
    }
    setPlan(next);
    setPlanLoad({ status: 'ready', message: '' });
  }

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
      {planLoad.status !== 'ready' && !dormant && (
        <div
          role={planLoad.status === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          aria-label="方案载入状态"
          style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'grid', placeItems: 'center', background: 'var(--sc-surface, #ffffff)', padding: 24 }}
        >
          {planLoad.status === 'loading' ? (
            <p style={{ margin: 0, fontSize: 13, opacity: 0.72 }}>正在读取本机方案…</p>
          ) : (
            <div style={{ maxWidth: 440, display: 'grid', gap: 10 }}>
              <strong style={{ fontSize: 15 }}>方案载入失败</strong>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, opacity: 0.78 }}>{planLoad.message}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => { setPlanLoad({ status: 'loading', message: '' }); setPlanLoadAttempt(value => value + 1); }}
                  style={{ border: '1px solid rgba(0,0,0,0.2)', background: 'transparent', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 13 }}
                >
                  重试读取
                </button>
                <button
                  type="button"
                  onClick={startBlankAfterLoadError}
                  style={{ border: '1px solid rgba(0,0,0,0.2)', background: 'transparent', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 13 }}
                >
                  备份原草稿并用空白方案继续
                </button>
              </div>
            </div>
          )}
        </div>
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
            onVenueBoundaryCanceled={agent?.manualOutdoorVenueCanceled}
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
            handOverPlaceToChat(area.name);
          }}
          onPick={place => {
            setPlaceArea(null);
            setPlacePin({ lng: place.lng, lat: place.lat, label: place.name });
            canvasApiRef.current?.focusLngLat(place.lng, place.lat, 17);
            // Pin immediately. Retries, abort, and the centered outline stay on this project/place.
            lookupPlaceShape(place.name, { lng: place.lng, lat: place.lat });
            handOverPlaceToChat(place.name);
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
      {/* 2026-11-16 用户指令：左下只保留一枚「图层」缩略钮；点开是「地图详情」面板，
          面板盖住地图和入口，关闭只走右上角 X，关掉后回到这一枚图层钮。 */}
      <div
        ref={layerDockRef}
        className="oc-layer-dock"
        onMouseEnter={() => {
          if (layerHoverTimer.current !== null) { window.clearTimeout(layerHoverTimer.current); layerHoverTimer.current = null; }
          setLayerStripOpen(true);
        }}
        onMouseLeave={() => {
          if (layerHoverTimer.current !== null) window.clearTimeout(layerHoverTimer.current);
          layerHoverTimer.current = window.setTimeout(() => setLayerStripOpen(false), 160);
        }}
        onFocus={() => setLayerStripOpen(true)}
        style={{ position: 'absolute', left: 24, bottom: 'var(--oc-layer-bottom, 20px)', zIndex: mapPickerOpen ? 20 : 4, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}
      >
        {mapPickerOpen ? (
          <MapDetailsPanel
            source={source}
            geoHidden={geoHidden}
            onPickSource={id => { setSource(id); setGeoHidden(false); }}
            onTogglePaper={() => setGeoHidden(value => !value)}
            onClose={() => setMapPickerOpen(false)}
          />
        ) : (
          <>
            <button
              type="button"
              id="tool-outdoor-source"
              data-testid="outdoor-source-cycle"
              aria-label={`图层，当前底图 ${currentSource.label}${geoHidden ? '（纸面）' : ''}`}
              aria-expanded={layerStripOpen}
              aria-pressed={layerStripOpen}
              aria-controls="outdoor-layer-strip"
              data-tip="图层 · 悬停或点按快速换底图"
              onClick={() => setLayerStripOpen(true)}
              className="oc-layer-entry"
            >
              <span className="oc-layer-entry__thumb" aria-hidden="true">
                <SourceThumb id="amap-satellite" />
              </span>
              <span className="oc-layer-entry__caption">
                <Layers3 size={16} strokeWidth={1.8} aria-hidden="true" />
                <span>图层</span>
              </span>
            </button>
            {layerStripOpen && (
              <div
                id="outdoor-layer-strip"
                data-testid="outdoor-layer-strip"
                role="group"
                aria-label="快速切换底图"
                className="oc-layer-strip"
              >
                {FEATURED_SOURCES.map(option => {
                  const active = !geoHidden && source === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      data-testid={option.id === 'amap-streets' ? 'map-strip-current' : `map-strip-${option.id}`}
                      aria-label={`底图：${option.label}`}
                      aria-pressed={active}
                      className="oc-layer-strip__row"
                      onClick={() => { setSource(option.id); setGeoHidden(false); }}
                    >
                      <span className="oc-layer-strip__thumb" aria-hidden="true">
                        <SourceThumb id={option.id} />
                      </span>
                      <span className="oc-layer-strip__label">{option.label}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  data-testid="map-strip-expand"
                  aria-label="展开地图详情"
                  aria-haspopup="dialog"
                  aria-controls="outdoor-map-details"
                  className="oc-layer-strip__row"
                  onClick={() => { setLayerStripOpen(false); setMapPickerOpen(true); }}
                >
                  <span className="oc-layer-strip__thumb oc-layer-strip__thumb--expand" aria-hidden="true">
                    <span className="oc-layer-strip__grid">
                      {[0, 1, 2, 3].map(i => <i key={i} />)}
                    </span>
                  </span>
                  <span className="oc-layer-strip__label">展开</span>
                </button>
              </div>
            )}
          </>
        )}
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

