'use client';

import { Boxes, ChevronUp, Loader2, X } from '@/components/solid-icons';
import { Check, Hand } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { useRoomEditor, useSelection } from '../contexts';
import {
  SATELLITE_GROUND_LABEL,
  applySatelliteGroundPatch,
  basemapCoversGroundPlane,
  ensurePlanGround,
  ensureSatelliteGround,
  hideSatelliteGround,
  isMapOutdoorLayout,
  isPlaceholderSatellite,
  isPlanGroundImage,
  isSatelliteGroundImage,
  readAmapKeys,
  satelliteGroundWanted,
  satelliteImageAligned,
  satelliteMissReason,
} from '../lib/amap-venue';
import {
  PLAN_GROUND_SOURCES,
  readPlanGroundSource,
  subscribePlanGroundSource,
  writePlanGroundSource,
} from '../lib/plan-basemap-source';
import { basemapSourceAttribution, PUBLIC_SOURCE_SPECS } from '../lib/tdt-probe';
import {
  GROUND_BASEMAP_LAYERS,
  activeGroundBasemap,
  groundBasemapStyleOf,
  type GroundBasemapStyle,
} from '../lib/ground-basemap';
import { researchAreaWith } from '../lib/research-area';
import { editorItemLimit } from '../lib/scene-presets';
import { materialCount } from '../lib/structural-layout';
import { requestWalkPointerLock } from '../lib/walk-engage';
import { LocalGlbImport } from './local-glb-import';
import { MaterialSymbol } from './material-symbol';
import { OUTDOOR_TOOL_ICONS } from '../components/outdoor-tool-icons';
import { OnlineModelLibrary } from './online-model-library';
import { MaterialCreateCell } from './material-create-cell';
import { LibraryChat } from './library-chat';
import { ShareMenu, type ShareMenuActions } from './share-menu';
import type { CatalogPlacementBatchGuard, CatalogPlacementGuard, CatalogPlacementResult } from '../lib/catalog-placement-guard';
import type { CameraPreset, CatalogItem, FurnitureItem, RoomLayout, Weather } from '../lib/types';
import { MAX_FLOORS } from '../lib/constants';
import type { SplatDisplayMode } from '../three/splat-preview';
import type { BackendSession } from '@/lib/backend-session';
import './workbench-shelf.css';

interface LibraryProps {
  controller?: BackendSession;
  onClose?(): void;
  capturePlacement?(): CatalogPlacementGuard;
  capturePlacementBatch?(): CatalogPlacementBatchGuard;
  placeCatalogItem(item: CatalogItem, position?: { x: number; z: number }): string;
  placeCatalogItemResult?(item: CatalogItem): CatalogPlacementResult;
  /** 2026-11-12 统一放置流程：点物料进「待放置」（点哪放哪，同户外），不再直接落正中。 */
  onArmCatalogItem?(item: CatalogItem): void;
}

export function MaterialGlyph({ materialId, color = 'currentColor' }: { materialId?: string | undefined; color?: string }): JSX.Element {
  return <svg viewBox="0 0 72 58" width="72" height="58" fill="none" aria-hidden="true" style={{ color }}>
    {materialId === 'chair' ? <><path d="M23 9h26v23H23z" fill="currentColor" opacity=".3"/><path d="M23 9h26v23H23zM21 33h30v8H21zM25 41v11m22-11v11M25 24v9m22-9v9" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round"/></> :
      materialId === 'table' || materialId === 'reception' ? <><path d="M11 19h50v15H11z" fill="currentColor" opacity=".25"/><path d="M11 19h50v15H11zM16 34v18m40-18v18" stroke="currentColor" strokeWidth="2.4"/>{materialId === 'reception' && <path d="M19 35h34v14H19z" fill="currentColor" opacity=".3"/>}</> :
      materialId === 'decoration' ? <><path d="M27 37h20l-4 16H31z" fill="currentColor" opacity=".3"/><path d="M36 37V12m0 15C16 25 18 12 19 10c12 0 17 8 17 17Zm0 4c16 0 21-11 17-18-10 0-16 9-17 18ZM27 37h20l-4 16H31z" stroke="currentColor" strokeWidth="2.3" strokeLinejoin="round"/></> :
      materialId === 'carpet' ? <><path d="m9 34 34-18 21 13-34 20Z" fill="currentColor" opacity=".28"/><path d="m9 34 34-18 21 13-34 20Z" stroke="currentColor" strokeWidth="2.4"/><path d="m19 34 24-12 11 7-24 13Z" stroke="currentColor" strokeWidth="1.4"/></> :
      <><path d="M15 9h42v36H15z" fill="currentColor" opacity=".24"/><path d="M15 9h42v36H15zM22 45v8m28-8v8" stroke="currentColor" strokeWidth="2.4"/>{materialId === 'display' && <path d="M15 21h42M15 33h42" stroke="currentColor" strokeWidth="2"/>}{materialId === 'partition' && <path d="M29 9v36M43 9v36" stroke="currentColor" strokeWidth="1.5"/>}</>}
  </svg>;
}

const SHELF_HEIGHT_KEY = 'scendance-shelf-height';

function shelfBounds() {
  const compact = window.innerHeight < 580 || window.innerWidth <= 640;
  // 一排卡片的高度：标签条 + 缩略图 + 名字。拖高只是让图更大。
  return { min: compact ? 132 : 156, default: compact ? 140 : 180, max: Math.max(compact ? 262 : 288, Math.round(window.innerHeight * 0.62)) };
}

function clampShelfHeight(value: number): number {
  const { min, max } = shelfBounds();
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * The drawer is a grid row sized by `--sc-shelf-height`, and the stage itself
 * declares that variable, so the drag has to paint on the stage rather than here.
 */
function paintShelfHeight(host: HTMLElement, grip: HTMLElement | null, px: number): void {
  host.style.setProperty('--sc-shelf-height', `${px}px`);
  grip?.setAttribute('aria-valuetext', `物料库高度 ${px} 像素`);
}

export function ShelfGrip({ shelfRef, label = '调整物料库高度' }: { shelfRef: RefObject<HTMLElement | null>; label?: string }): JSX.Element {
  const [height, setHeight] = useState(0);
  const gripRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; from: number; live: number } | null>(null);
  const host = useCallback(() => shelfRef.current?.closest<HTMLElement>('.sc-canvas-stage') ?? document.documentElement, [shelfRef]);

  useEffect(() => {
    const stored = window.localStorage.getItem(SHELF_HEIGHT_KEY);
    const parsed = stored ? Number(stored) : NaN;
    setHeight(clampShelfHeight(Number.isFinite(parsed) ? parsed : shelfBounds().default));
  }, []);
  useEffect(() => { if (height) paintShelfHeight(host(), gripRef.current, height); }, [height, host]);
  useEffect(() => {
    const onResize = () => setHeight(current => (current ? clampShelfHeight(current) : current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const settle = (next: number) => {
    setHeight(next);
    window.localStorage.setItem(SHELF_HEIGHT_KEY, String(next));
  };
  const { min, max } = height ? shelfBounds() : { min: 156, max: 156 };

  return <div
    ref={gripRef}
    className="sc-shelf-grip"
    role="separator"
    aria-orientation="horizontal"
    aria-label={label}
    tabIndex={0}
    aria-valuenow={height || min}
    aria-valuemin={min}
    aria-valuemax={max}
    onPointerDown={event => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { y: event.clientY, from: height || min, live: height || min };
    }}
    onPointerMove={event => {
      if (!drag.current) return;
      drag.current.live = clampShelfHeight(drag.current.from - (event.clientY - drag.current.y));
      paintShelfHeight(host(), gripRef.current, drag.current.live);
    }}
    onPointerUp={() => { if (drag.current) { settle(drag.current.live); drag.current = null; } }}
    onPointerCancel={() => { if (drag.current) { setHeight(drag.current.live); drag.current = null; } }}
    onDoubleClick={() => settle(shelfBounds().default)}
    onKeyDown={event => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        settle(clampShelfHeight((height || min) + (event.key === 'ArrowUp' ? 24 : -24)));
      } else if (event.key === 'Home') { event.preventDefault(); settle(min); }
      else if (event.key === 'End') { event.preventDefault(); settle(max); }
    }}
  ><span aria-hidden="true"/></div>;
}

export function ScendanceLibrary({ placeCatalogItem, placeCatalogItemResult, onArmCatalogItem, controller, onClose, capturePlacement, capturePlacementBatch, variant = 'shelf', walkRoles = [] }: LibraryProps & {
  /** shelf = 画布底部抽屉；card = 嵌进 Agent 面板，不要拖拽条。 */
  variant?: 'shelf' | 'card';
  /** 左侧只负责选角色；进出漫游统一走右侧 `tool-walk`。 */
  walkRoles?: readonly { id: string; name: string; image: string; walkable: boolean; note?: string; crowdType?: string; selected: boolean; onSelect(): void }[];
}): JSX.Element {
  const { layout, activeFloor, actions, history } = useRoomEditor();
  const { selectOnly } = useSelection();
  const hostRef = useRef<HTMLElement>(null);
  const atLimit = materialCount(activeFloor.items) >= editorItemLimit(layout);
  const card = variant === 'card';

  const addMaterial = (item: CatalogItem):CatalogPlacementResult => {
    if (atLimit) return {status:'failed',message:'当前场景物料已满，请先腾出位置。'};
    // 放置只选中、不掀属性面板：要看尺寸/颜色得双击画面里那件物料。
    const result = placeCatalogItemResult?.(item) ?? (()=>{const id=placeCatalogItem(item);return id?{status:'placed' as const,id}:{status:'pending' as const};})();
    if (result.status==='placed') selectOnly(result.id, { keepPanel: true });
    return result;
  };

  // 风格套整组一次落盘：一次提交、一次撤销，不按件走放置动画。
  const addStyleSet = (items: FurnitureItem[]) => {
    if (atLimit || items.length === 0) return;
    if (materialCount(activeFloor.items) + items.length > editorItemLimit(layout)) return;
    history.commitNow();
    actions.addItems(items);
    const first = items[0];
    if (first) selectOnly(first.id, { keepPanel: true });
  };

  // 本机 GLB：桌面上能拖到这一格，手机上点同一格选文件；导入后自动选中并落进画布。
  const importSlot = <LocalGlbImport variant={card ? 'card' : 'tile'} disabled={atLimit} onAdd={addMaterial}/>;

  return <aside ref={hostRef} className={`sc-library sc-compact-shelf${card ? ' is-card' : ''}`} aria-label="物料库">
    {!card && <div className="sc-shelf-top">
      <ShelfGrip shelfRef={hostRef}/>
      {onClose && <button type="button" className="sc-library-rail-close" aria-label="关闭物料库" title="关闭" onClick={onClose}><X size={16} aria-hidden="true"/></button>}
    </div>}
    <div className="sc-library-body">
      {card
        ? <div className="sc-library-content">
          <div className="sc-library-materials">
            <OnlineModelLibrary cardMode {...(controller ? { controller } : {})} {...(capturePlacement ? { capturePlacement } : {})} {...(capturePlacementBatch ? { capturePlacementBatch } : {})} renderedLayout={layout} {...(atLimit ? { limitMessage: `已达到 ${editorItemLimit(layout)} 件物料上限，请先删除部分物料。` } : {})} disabled={atLimit} onAdd={addMaterial} onAddSet={addStyleSet} {...(onArmCatalogItem ? { onArmCatalogItem } : {})} importSlot={importSlot} roomSize={{ width: layout.width, depth: layout.height }}
              createSlot={<LibraryChat title="物料库"><MaterialCreateCell variant="chat" importSlot={importSlot} {...(controller ? { controller } : {})}/></LibraryChat>}
              walkRoles={walkRoles}/>
          </div>
        </div>
        : <div className="sc-library-content">
          <div className="sc-library-materials">
            <OnlineModelLibrary {...(controller ? { controller } : {})} {...(capturePlacement ? { capturePlacement } : {})} {...(capturePlacementBatch ? { capturePlacementBatch } : {})} renderedLayout={layout} {...(atLimit ? { limitMessage: `已达到 ${editorItemLimit(layout)} 件物料上限，请先删除部分物料。` } : {})} disabled={atLimit} onAdd={addMaterial} importSlot={importSlot}/>
          </div>
        </div>}
    </div>
  </aside>;
}

export function NumberField({ label, value, min = 0.01, max = 50, step = 0.1, disabled = false, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; disabled?: boolean; onChange(value: number): void }): JSX.Element {
  return <label className="sc-field">{label}<input type="number" aria-label={label} min={min} max={max} step={step} value={Math.round(value * 1000) / 1000} disabled={disabled} onChange={event => { const next = event.target.valueAsNumber; if (Number.isFinite(next) && next >= min && next <= max) onChange(next); }}/></label>;
}

interface ViewToolsProps {
  materialsOpen?: boolean;
  onToggleMaterials?(): void;
  materialsButtonRef?: RefObject<HTMLButtonElement>;
  /** Layout mode only: 足迹 / 人群 / 天气 / 时间 / 现场灯光 (design group 4). */
  showAtmosphere?: boolean;
  onLighting?(value: NonNullable<RoomLayout['backendLighting']>): void;
  /** Gaussian scenes can be moved as one unit, separately from item selection. */
  sceneMoveEnabled?: boolean;
  sceneMoveMode?: 'off' | 'gizmo' | 'numeric';
  onSceneMoveModeChange?(mode: 'off' | 'gizmo' | 'numeric'): void;
  environmentView?: SplatDisplayMode;
  environmentViewEnabled?: boolean;
  onEnvironmentViewChange?(mode: SplatDisplayMode): void;
  onZoom(direction: '+' | '-'): void;
  /**
   * Exports the current view as a PNG. In 3D the chosen preset frame and
   * resolution multiplier are applied for the capture only; in 2D the plan is
   * exported at its current resolution.
   */
  onExportImage?(options: { view: 'current' | CameraPreset; scale: number }): Promise<boolean> | void;
  /** 导出前的同一帧预览；返回 PNG data URL，编码不出来给 null。 */
  onCaptureImage?(options: { view: 'current' | CameraPreset; scale: number }): Promise<string | null>;
  /** 机位册：顺序导出全部预设机位与离线图册 HTML。2D 视图不提供。 */
  onExportAlbum?(options: { scale: number }): Promise<{ ok: boolean; count: number } | void> | void;
  /** 评审 / 执行不撤销、不重做布置。 */
  layoutLocked?: boolean;
  /** 工具轨唯一分享入口。不传时菜单仍可打开，动作提示未接入。 */
  shareActions?: ShareMenuActions;
  /** 旧评审入口改道时递增。 */
  shareOpenRequest?: number;
  /**
   * P4-c 交付簇合并：户外平面画布打开时，发布钮已经和「导出/分享」一起摆在画布右上，
   * 工具轨这一份隐藏，避免同一个动作两个入口（用户反馈「导出 分享 发布 应该是一起的」）。
   */
  publishHidden?: boolean;
  /** 进出漫游的唯一入口（room-organizer 的 startWalk）；不传时退回本组件的开关。 */
  onToggleWalkthrough?(on: boolean): void;
  /**
   * P2-g 户外 2D 画布接管：非空时，撤销/重做/缩放/导出四组通用钮改由户外画布执行
   * （室内 3D 的布局历史与相机原样保活，关掉户外即恢复）。null/缺省＝纯室内行为。
   */
  outdoorActions?: {
    canUndo: boolean;
    canRedo: boolean;
    undo(): void;
    redo(): void;
    zoomBy(direction: 1 | -1): void;
    /** 导出 PNG：户外走 2D 规划快照（不抓 3D 帧），无 plan 时返回 false。 */
    exportPng?(): boolean;
    /** 覆盖层当前视角：2D 地图 / 3D 场地是同一份规划的两种看法，工具排始终走规划画布。 */
    view?: '2d' | '3d';
    setCanvasView?(view: '2d' | '3d'): void;
    /** 2026-11-12 三张卡拆开：测量 / 标注 / 属性 各自一张卡，这里给出各自的展开态（右轨按下态）。 */
    inspectorTabs?: Record<'measure' | 'annotate' | 'selection', boolean>;
    setInspector?(tab: 'measure' | 'annotate' | 'selection'): void;
    /** 2026-11-12 B1 选择工具：2D 画布浏览/选择模式（「选择」钮按下态与切换；S/H 快捷键同源）。 */
    canvasMode?: 'view' | 'select';
    setCanvasMode?(mode: 'view' | 'select'): void;
  } | null;
  /**
   * GeoGround（2026-11-12）：主画布 3D 地面由户外计划的地理瓦片接管时置真。
   * 「卫星贴地 / 地图类型」两钮管的是室内高德静态贴地，此时没有可管的东西
   * （且会显示「未定位」误导），与户外态同一扇门隐藏。
   */
  geoGroundActive?: boolean;
}

const WEATHER_OPTIONS: ReadonlyArray<{ id: Weather; label: string }> = [
  { id: 'clear', label: '晴朗' },
  { id: 'rain', label: '降雨' },
  { id: 'snow', label: '降雪' },
];

const LIGHTING_OPTIONS = [
  { id: 'neutral' as const, label: '明亮自然' },
  { id: 'warm' as const, label: '温暖聚会' },
  { id: 'cool' as const, label: '冷调展览' },
];
const TIME_PRESETS: ReadonlyArray<{ label: string; hour: number; title: string }> = [
  { label: '日', hour: 12, title: '正午' },
  { label: '昏', hour: 18, title: '黄昏' },
  { label: '夜', hour: 21, title: '夜晚' },
];
/**
 * 成图可选的固定机位：顺序按「先看整体、再看平面、最后看立面」排。
 * 只用于导出效果图的视角选择与机位册，右轨不再放轮换按钮。
 */
const ANGLE_PRESETS: ReadonlyArray<{ id: CameraPreset; label: string; symbol: string }> = [
  { id: 'iso', label: '整体', symbol: 'explore' },
  { id: 'top', label: '俯视', symbol: 'grid_on' },
  // 正面机位是环绕预设，不是走进去。人视这个名字会让人以为已经是第一人称。
  { id: 'front', label: '正面机位', symbol: 'crop_square' },
];
function MoveSceneIcon(): JSX.Element {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v18M3 12h18M12 3l-2 2m2-2 2 2m-2 16-2-2m2 2 2-2M3 12l2-2m-2 2 2 2m16-2-2-2m2 2-2 2"/>
  </svg>;
}
// 网格吸附：井字轮廓两态同构，开启时在右下象限压一颗落点块；状态由按钮 is-active 底色/字色承接。
function GridSnapIcon({ active }: { active: boolean }): JSX.Element {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 8.8 H18.5 M5.5 15.2 H18.5 M8.8 5.5 V18.5 M15.2 5.5 V18.5" />
      {active && <rect x="12.7" y="12.7" width="4.6" height="4.6" rx="1" fill="currentColor" stroke="none" />}
    </svg>
  );
}
function FloorTriangle({ direction }: { direction: 'up' | 'down' }): JSX.Element {
  const path = direction === 'up'
    ? 'M12 3.2c-2.6 0-5.2 4.5-7.1 8.4-1.8 3.6-.2 6.2 3.5 6.2h7.2c3.7 0 5.3-2.6 3.5-6.2C17.2 7.7 14.6 3.2 12 3.2Z'
    : 'M12 20.8c2.6 0 5.2-4.5 7.1-8.4 1.8-3.6.2-6.2-3.5-6.2H8.4c-3.7 0-5.3 2.6-3.5 6.2 1.9 3.9 4.5 8.4 7.1 8.4Z';
  return <svg aria-hidden="true" className={`sc-floor-triangle is-${direction}`} viewBox="0 0 24 24" focusable="false"><path d={path}/></svg>;
}
const EXPORT_VIEWS: ReadonlyArray<{ id: 'current' | CameraPreset; label: string; symbol: string }> = [
  { id: 'current', label: '跟随当前', symbol: 'photo_camera' },
  ...ANGLE_PRESETS,
];
// 成图尺寸固定从 1920×1080 起算（不再跟着窗口大小走），1× 就是交付默认值。
const EXPORT_SCALES: ReadonlyArray<{ scale: number; label: string; hint: string }> = [
  { scale: 1, label: '1080p', hint: '1920×1080' },
  { scale: 2, label: '4K', hint: '3840×2160' },
  { scale: 3, label: '6K', hint: '5760×3240' },
];

/** Design: canvas-right vertical 14-key circular column (v2.4). */
export function ScendanceViewTools({ onZoom, onExportImage, onCaptureImage, onExportAlbum, showAtmosphere = true, onLighting, sceneMoveEnabled = false, sceneMoveMode = 'off', onSceneMoveModeChange, environmentView = 'gaussian', environmentViewEnabled = false, onEnvironmentViewChange, layoutLocked = false, shareActions, shareOpenRequest = 0, publishHidden = false, onToggleWalkthrough, outdoorActions = null, geoGroundActive = false }: ViewToolsProps): JSX.Element {
  // P2-g：户外模式＝这四组通用钮改派给规划画布；室内历史/相机一概不动。
  // 3D 场地只是同一份规划的倾斜视角，不是预览，撤销/缩放/导出仍走规划。
  const outdoor = outdoorActions;
  const sceneMoveActive = sceneMoveMode !== 'off';
  const { view, setView, toggle, history, layout, activeFloorIndex, actions } = useRoomEditor();
  const outdoorEditing = outdoor != null;
  // 2026-11-13 定稿：户外 2D/3D 胶囊挪到画布左下动作簇（room-organizer 独立挂载），右轨不再放户外切换钮；
  // 这里只剩纯室内场景的平面/立体兜底切换。
  const showing3D = !view.view2D;
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [lightingOpen, setLightingOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportView, setExportView] = useState<'current' | CameraPreset>('current');
  const [exportScale, setExportScale] = useState(1);
  const [exportMode, setExportMode] = useState<'single' | 'album'>('single');
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewToken = useRef(0);
  const [shareClose, setShareClose] = useState(0);
  const quietShare = () => setShareClose(value => value + 1);
  const [atmosphereOpen, setAtmosphereOpen] = useState(false);
  // 氛围条默认收起成一颗「氛围」：真开了人群/雨雪/非正午就展开，别让人找不到关掉它的地方。
  // 第一人称漫游是右轨一级圆钮，不收进氛围，也不收进省略号。
  const atmosphereShown = atmosphereOpen || view.showNpcs || view.weather !== 'clear' || (view.timeOfDay ?? 12) !== 12;
  const satelliteVenue = isMapOutdoorLayout(layout) || layout.satelliteGroundRef !== undefined || isSatelliteGroundImage(layout.floorPlanImage);
  const satelliteOn = satelliteGroundWanted(layout);
  const [satelliteBusy, setSatelliteBusy] = useState(false);
  const [satelliteMiss, setSatelliteMiss] = useState<'key' | 'place' | null>(null);
  const [mapTypeOpen, setMapTypeOpen] = useState(false);
  const [mapMiss, setMapMiss] = useState(false);
  // 2026-11-11 用户指令：选择钮改 OnePlan 画布工具菜单（点钮开弹层：抓手 H / 选择 S）。
  const [selectMenuOpen, setSelectMenuOpen] = useState(false);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const satelliteRequest = useRef(0);
  const satelliteAttempt = useRef('');
  const busyTimer = useRef(0);
  const basemapStyleRef = useRef<GroundBasemapStyle>(groundBasemapStyleOf(layout.floorPlanImage));
  const activeBasemap = activeGroundBasemap(layout);
  const satelliteTip = satelliteMiss === 'key' ? '卫星贴地·需高德 Key' : satelliteMiss === 'place' ? '卫星贴地·未定位' : '卫星贴地';
  const mapTip = mapMiss
    ? '地图类型·这一层暂时拉不到，仍显示上一张'
    : activeBasemap
      ? `地图类型：${activeBasemap.label} · ${activeBasemap.provider}`
      : '地图类型';
  useEffect(() => {
    if (satelliteBusy) return;
    basemapStyleRef.current = groundBasemapStyleOf(layout.floorPlanImage);
  }, [layout.floorPlanImage, satelliteBusy]);
  const releaseBusy = useCallback((mine: number) => {
    window.clearTimeout(busyTimer.current);
    if (satelliteRequest.current === mine) setSatelliteBusy(false);
  }, []);
  const fillSatellite = useCallback((
    startedId: string,
    startedName: string,
    mine: number,
    showBusy: boolean,
    style?: GroundBasemapStyle,
    syncResearch = false,
  ) => {
    const source = layoutRef.current;
    const wanted = style ?? basemapStyleRef.current;
    window.clearTimeout(busyTimer.current);
    // 进场自动补图不占钮。只有人点开时才亮 busy，并且到点或结束一定放开。
    if (showBusy) {
      setSatelliteBusy(true);
      busyTimer.current = window.setTimeout(() => releaseBusy(mine), 26000);
    } else {
      setSatelliteBusy(false);
    }
    void (async () => {
      // P4-d：三维地面优先铺二维那张地图（OSM / Carto，跟随平面右下角的底图选择）。
      // 只有「自动补图 / 贴地开关」这条无 style 的路径才换自绘图；人显式点「地图类型」
      // 选高德街道/卫星档位时，仍按档位去拉高德静态图。
      if (style === undefined) {
        const planGround = await ensurePlanGround(source, readPlanGroundSource());
        if (planGround) return planGround;
      }
      return ensureSatelliteGround(source, wanted);
    })().then(patch => {
      if (mine !== satelliteRequest.current) return;
      const current = layoutRef.current;
      if ((current.id ?? '') !== startedId || current.name !== startedName || current.satelliteGroundRef === false) return;
      setSatelliteMiss(satelliteMissReason(current, patch, readAmapKeys()));
      if (!patch) {
        if (syncResearch || satelliteImageAligned(current.floorPlanImage)) setMapMiss(true);
        return;
      }
      // 占位 SVG 只是「别让地面停在素色」的兜底。本来已有对齐真图（或人在换层）时，
      // 拉不到就留着旧图并亮 mapMiss，不能拿占位图当成切换成功。
      if (isPlaceholderSatellite(patch.floorPlanImage) && (syncResearch || satelliteImageAligned(current.floorPlanImage))) {
        basemapStyleRef.current = groundBasemapStyleOf(current.floorPlanImage);
        setMapMiss(true);
        return;
      }
      setMapMiss(false);
      let next = applySatelliteGroundPatch(current, patch);
      // 调研底图铺在壳体下面。人换了地图类型时一起换，避免圈内是路网、圈外仍是卫星。
      // 静态预置图与像素一一对应，researchAreaWith 会原样返回。
      if (syncResearch && current.researchArea) {
        next = { ...next, researchArea: researchAreaWith(current.researchArea, { style: wanted }) };
      }
      actions.applyLayout(next);
      setView(viewNext => ({ ...viewNext, showReferenceImage: true, referenceImageOpacity: patch.floorPlanOpacity }));
    }).finally(() => { if (showBusy) releaseBusy(mine); });
  }, [actions, releaseBusy, setView]);
  useEffect(() => () => { window.clearTimeout(busyTimer.current); }, []);
  useEffect(() => {
    // 窄边旧图虽然对齐，但只盖住场地中间一块。没铺满户外地面就重拉。
    if (!satelliteOn || (satelliteImageAligned(layout.floorPlanImage) && basemapCoversGroundPlane(layout))) return undefined;
    // 已经有一张非卫星的底图时不要自动盖掉；人点开卫星开关才换。
    // 旧的 location/zoom 卫星图没有经纬度范围，要重拉，否则贴地会对不齐。
    if (layout.floorPlanImage && !isSatelliteGroundImage(layout.floorPlanImage) && !isPlanGroundImage(layout.floorPlanImage)) return undefined;
    const token = `${layout.id ?? ''}|${layout.name}|${layout.floorPlanImage ?? ''}|${layout.mapGroundPolygon?.length ?? 0}`;
    if (satelliteAttempt.current === token) return undefined;
    satelliteAttempt.current = token;
    const mine = ++satelliteRequest.current;
    fillSatellite(layout.id ?? '', layout.name, mine, false);
    return () => {
      if (satelliteRequest.current !== mine) return;
      satelliteRequest.current += 1;
      if (satelliteAttempt.current === token) satelliteAttempt.current = '';
      window.clearTimeout(busyTimer.current);
      setSatelliteBusy(false);
    };
  }, [satelliteOn, layout.id, layout.name, layout.floorPlanImage, layout.mapGroundPolygon, fillSatellite]);
  const turnSatellite = () => {
    const current = layoutRef.current;
    satelliteRequest.current += 1;
    window.clearTimeout(busyTimer.current);
    setSatelliteBusy(false);
    if (satelliteOn) {
      actions.applyLayout(hideSatelliteGround(current));
      return;
    }
    if (satelliteImageAligned(current.floorPlanImage) && basemapCoversGroundPlane(current)) {
      actions.applyLayout({ ...current, satelliteGroundRef: true, floorPlanOpacity: current.floorPlanOpacity ?? 0.78 });
      setView(next => ({ ...next, showReferenceImage: true, referenceImageOpacity: current.floorPlanOpacity ?? 0.78 }));
      return;
    }
    actions.applyLayout({ ...current, satelliteGroundRef: true, floorPlanOpacity: current.floorPlanOpacity ?? 0.78 });
    fillSatellite(current.id ?? '', current.name, satelliteRequest.current, true);
  };
  const chooseBasemap = (style: GroundBasemapStyle) => {
    const current = layoutRef.current;
    basemapStyleRef.current = style;
    setMapTypeOpen(false);
    setMapMiss(false);
    const token = `${current.id ?? ''}|${current.name}|${current.floorPlanImage ?? ''}|${current.mapGroundPolygon?.length ?? 0}`;
    satelliteAttempt.current = token;
    satelliteRequest.current += 1;
    window.clearTimeout(busyTimer.current);
    setSatelliteBusy(false);
    const already = satelliteImageAligned(current.floorPlanImage)
      && groundBasemapStyleOf(current.floorPlanImage) === style
      && basemapCoversGroundPlane(current);
    const research = current.researchArea ? researchAreaWith(current.researchArea, { style }) : undefined;
    const researchChanged = !!research && research.imageUrl !== current.researchArea?.imageUrl;
    if (already) {
      if (current.satelliteGroundRef === true && !researchChanged) return;
      actions.applyLayout({
        ...current,
        satelliteGroundRef: true,
        floorPlanOpacity: current.floorPlanOpacity ?? 0.78,
        ...(researchChanged && research ? { researchArea: research } : {}),
      });
      setView(next => ({ ...next, showReferenceImage: true, referenceImageOpacity: current.floorPlanOpacity ?? 0.78 }));
      return;
    }
    actions.applyLayout({
      ...current,
      satelliteGroundRef: true,
      floorPlanOpacity: current.floorPlanOpacity ?? 0.78,
    });
    fillSatellite(current.id ?? '', current.name, satelliteRequest.current, true, style, true);
  };
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const atmosphereMenuRef = useRef<HTMLDivElement>(null);
  const mapTypeMenuRef = useRef<HTMLDivElement>(null);
  // 2026-11-12 用户指令：GeoGround 态补回「地图切换」——主 3D 瓦片图源与户外 2D 同一份偏好联动。
  const groundSource = useSyncExternalStore(subscribePlanGroundSource, readPlanGroundSource, () => 'amap-streets' as (typeof PLAN_GROUND_SOURCES)[number]);
  const [groundSourceOpen, setGroundSourceOpen] = useState(false);
  const groundSourceMenuRef = useRef<HTMLDivElement>(null);
  const selectMenuRef = useRef<HTMLDivElement>(null);
  // 2026-11-12 B2：户外态的抓手/选择走 2D 画布的 canvasMode（outdoor 转发），室内沿用 selectMode——
  // 同一个下拉管两套画布，✓ 与图标跟随当前画布的真实模式。
  const outdoorSelectOn = outdoor?.canvasMode === 'select';
  const canvasSelectOn = outdoor != null ? outdoorSelectOn : view.selectMode;
  const selectActive = canvasSelectOn && (outdoor != null || (!view.measurementMode && !view.drawWallMode && !view.drawZoneMode && !view.walkthroughMode));
  const canvasToolTip = `画布工具：${outdoor != null ? (outdoorSelectOn ? '选择设施' : '抓手浏览') : view.selectMode ? '选择物体' : '抓手浏览'}中 · 点击切换（H 抓手 / S 选择）`;
  const addFloorBlocked = !!layout.backendSceneV2 && activeFloorIndex >= layout.floors.length - 1;
  const floorBlockMessage = '当前结构场景暂不支持新增、删除或调整楼层。';
  const changeVisibleFloor = (delta: -1 | 1) => {
    const next = activeFloorIndex + delta;
    if (next < 0) return;
    if (next >= layout.floors.length) {
      if (delta !== 1 || layout.floors.length >= MAX_FLOORS || layout.backendSceneV2) return;
      // The up control doubles as “add next storey” at the top of the stack.
      // addFloor creates a clean floor and makes it active in one history step.
      actions.addFloor();
    } else {
      actions.setActiveFloorIndex(next);
    }
    // Inspect one storey at a time and cut the roof away so the selected level
    // stays visible from the orbit camera.
    setView(current => ({ ...current, showAllFloors: false, wallDisplay: 'cutaway' }));
  };
  // 2026-11-11 OnePlan 画布工具菜单：抓手 = 画布只浏览不抓物料（selectMode off）；
  // 选择 = 移动局部物体（顺手把互斥工具停掉）。点菜单项或按 H / S 都走这里。
  // 2026-11-12 B2：户外态转发 2D 画布 canvasMode（抓手=view、选择=select），室内分支原样。
  const chooseHandTool = () => {
    setSelectMenuOpen(false);
    if (outdoor?.setCanvasMode) {
      outdoor.setCanvasMode('view');
      return;
    }
    // Object movement and whole-scene movement are exclusive modes.
    onSceneMoveModeChange?.('off');
    setView(current => ({ ...current, selectMode: false }));
  };
  const chooseSelectTool = () => {
    setSelectMenuOpen(false);
    if (outdoor?.setCanvasMode) {
      outdoor.setCanvasMode('select');
      return;
    }
    onSceneMoveModeChange?.('off');
    setView(current => ({ ...current, selectMode: true, measurementMode: false, drawWallMode: false, drawZoneMode: false, walkthroughMode: false }));
  };
  const setWalkthrough = (on: boolean) => {
    if (on) onSceneMoveModeChange?.('off');
    setView(current => ({
      ...current,
      walkthroughMode: on,
      ...(on ? { view2D: false, measurementMode: false, drawWallMode: false } : {}),
    }));
    // Same click as the button: the browser only grants pointer lock during
    // this gesture. Waiting for the walk hook's effect drops the gesture.
    if (on) requestWalkPointerLock();
  };
  // 进出漫游统一走 room-organizer 的入口（场景未就绪拦截、整景区自动进场地）；不传才退回本地开关。
  const toggleWalk = onToggleWalkthrough ?? setWalkthrough;
  const activeTime = TIME_PRESETS.find(entry => Math.abs(entry.hour - view.timeOfDay) < 0.6);
  // 打开导出卡先抓同一帧做预览；换机位再抓一次。画质只影响确认后的成图，预览不重抓。
  useEffect(() => {
    if (!exportOpen || !onCaptureImage) {
      setPreview(null);
      setPreviewing(false);
      return undefined;
    }
    const token = ++previewToken.current;
    setPreviewing(true);
    void onCaptureImage({ view: exportView, scale: 1 }).then(url => {
      if (previewToken.current !== token) return;
      setPreview(url);
      setPreviewing(false);
    });
    return () => { if (previewToken.current === token) previewToken.current += 1; };
  }, [exportOpen, exportView, onCaptureImage]);
  const runExport = async () => {
    if (exporting) return;
    if (exportMode === 'album') {
      if (!onExportAlbum || view.view2D) return;
      setExporting(true);
      try {
        await onExportAlbum({ scale: exportScale });
      } finally {
        setExporting(false);
        setExportOpen(false);
      }
      return;
    }
    if (!onExportImage && !(outdoorEditing && outdoor?.exportPng)) return;
    setExporting(true);
    try {
      // 仅在 2D 地图编辑时导出规划快照；3D 抓工作台三维帧。
      if (outdoorEditing && outdoor?.exportPng) outdoor.exportPng();
      else if (onExportImage) await onExportImage({ view: exportView, scale: exportScale });
    } finally {
      setExporting(false);
      setExportOpen(false);
    }
  };
  useEffect(() => {
    if (!exportOpen && !atmosphereShown && !weatherOpen && !timeOpen && !lightingOpen && !mapTypeOpen && !groundSourceOpen && !selectMenuOpen) return undefined;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      const el = event.target as HTMLElement | null;
      if (exportOpen && exportMenuRef.current && !exportMenuRef.current.contains(target)) setExportOpen(false);
      if (mapTypeOpen && mapTypeMenuRef.current && !mapTypeMenuRef.current.contains(target)) setMapTypeOpen(false);
      if (groundSourceOpen && groundSourceMenuRef.current && !groundSourceMenuRef.current.contains(target)) setGroundSourceOpen(false);
      if (selectMenuOpen && selectMenuRef.current && !selectMenuRef.current.contains(target)) setSelectMenuOpen(false);
      if (atmosphereMenuRef.current && !atmosphereMenuRef.current.contains(target)) {
        setAtmosphereOpen(false); setWeatherOpen(false); setTimeOpen(false); setLightingOpen(false);
      } else if (atmosphereMenuRef.current) {
        const inAtmo = atmosphereMenuRef.current.contains(target);
        if (weatherOpen && inAtmo && el && !(el.closest('#tool-weather') || el.closest('[aria-label="室外天气选项"]'))) setWeatherOpen(false);
        if (timeOpen && inAtmo && el && !(el.closest('#tool-time') || el.closest('[aria-label="室外时段选项"]'))) setTimeOpen(false);
        if (lightingOpen && inAtmo && el && !(el.closest('#tool-lighting') || el.closest('[aria-label="现场灯光选项"]'))) setLightingOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setAtmosphereOpen(false); setWeatherOpen(false); setTimeOpen(false); setLightingOpen(false); setExportOpen(false); setMapTypeOpen(false); setSelectMenuOpen(false); }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [exportOpen, weatherOpen, timeOpen, lightingOpen, atmosphereShown, mapTypeOpen, selectMenuOpen]);

  // 2026-11-11 画布工具快捷键（OnePlan 同款）：H 抓手 / S 选择；漫游 WASD 与输入框中不抢键。
  // 每次渲染重挂（无 deps），保证闭包拿到最新的 view/choose 函数，开销可忽略。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key !== 'h' && key !== 's') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (view.walkthroughMode) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      if (key === 'h') chooseHandTool();
      else chooseSelectTool();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    /* 圆钮贴在画布右上角。所有工具都是一级钮，没有省略号菜单；只有导出还带一层选项弹层。 */
    <nav id="tool-column" className="sc-view-tools sc-canvas-rail sc-tool-column" aria-label="工具" onWheel={event => event.stopPropagation()}>
      <div className="sc-floor-switcher" role="group" aria-label={`楼层切换，当前第 ${activeFloorIndex + 1} 层`}>
        {addFloorBlocked && <span role="note" style={{ maxWidth: 140, padding: '4px 6px', borderRadius: 6, background: '#F4F5F7', color: '#4A7C59', fontSize: 11, lineHeight: 1.3 }}>{floorBlockMessage}</span>}
        <span className="sc-floor-switcher-label" aria-hidden="true">{activeFloorIndex + 1}F</span>
        <div className="sc-floor-switcher-arrows">
          <button type="button" aria-label={addFloorBlocked ? floorBlockMessage : activeFloorIndex < layout.floors.length - 1 ? `切换到第 ${activeFloorIndex + 2} 层` : layout.floors.length < MAX_FLOORS ? `新建并切换到第 ${activeFloorIndex + 2} 层` : '已经是最高层'} title={addFloorBlocked ? floorBlockMessage : activeFloorIndex < layout.floors.length - 1 ? `切换到第 ${activeFloorIndex + 2} 层` : layout.floors.length < MAX_FLOORS ? `新建并切换到第 ${activeFloorIndex + 2} 层` : '已经是最高层'} disabled={addFloorBlocked || activeFloorIndex >= MAX_FLOORS - 1 || (activeFloorIndex >= layout.floors.length - 1 && layout.floors.length >= MAX_FLOORS)} onClick={() => changeVisibleFloor(1)}>
            <FloorTriangle direction="up"/>
          </button>
          <button type="button" aria-label={activeFloorIndex > 0 ? `切换到第 ${activeFloorIndex} 层` : '已经是底层'} title={activeFloorIndex > 0 ? `切换到第 ${activeFloorIndex} 层` : '已经是底层'} disabled={activeFloorIndex <= 0} onClick={() => changeVisibleFloor(-1)}>
            <FloorTriangle direction="down"/>
          </button>
        </div>
      </div>
      {!(publishHidden || outdoorEditing) && (<>
        <ShareMenu {...(shareActions ? { actions: shareActions } : {})} layout={layout} lengthUnit={view.lengthUnit} openRequest={shareOpenRequest} closeSignal={shareClose}/>
        <span className="sc-tool-sep" aria-hidden="true"/>
      </>)}
      {sceneMoveEnabled && <button type="button" id="tool-move-scene" data-tip={sceneMoveMode === 'off' ? '移动整体场景' : sceneMoveMode === 'gizmo' ? '移动整体场景 · 坐标轴 · 再点切无轴' : '移动整体场景 · 无轴 · 再点完成'} aria-label={sceneMoveMode === 'off' ? '移动整体场景' : sceneMoveMode === 'gizmo' ? '切换到无轴移动' : '完成移动整体场景'} aria-pressed={sceneMoveActive} className={sceneMoveActive ? 'is-active' : ''} onClick={() => onSceneMoveModeChange?.(sceneMoveMode === 'off' ? 'gizmo' : sceneMoveMode === 'gizmo' ? 'numeric' : 'off')}>
        <MoveSceneIcon />
      </button>}
      {/* 2026-11-11 用户指令：OnePlan 画布工具菜单——按钮图标随当前工具（抓手/选择），
          点开弹层两行（图标 + 名称 + 快捷键徽标 + ✓ 当前项），H/S 快捷键直达。 */}
      <div className="sc-tool-menu" ref={selectMenuRef}>
        <button type="button" id="tool-select" data-tip={canvasToolTip} aria-label={canvasToolTip} aria-pressed={selectActive} aria-haspopup="menu" aria-expanded={selectMenuOpen} aria-controls="tool-select-panel" className={selectActive ? 'is-active' : canvasSelectOn ? '' : 'is-off'} onClick={() => { setSelectMenuOpen(open => !open); setMapTypeOpen(false); setExportOpen(false); setAtmosphereOpen(false); setWeatherOpen(false); setTimeOpen(false); setLightingOpen(false); }}>
          {canvasSelectOn ? <MaterialSymbol name="near_me" /> : <Hand size={20} strokeWidth={2} />}
        </button>
        {selectMenuOpen && <div id="tool-select-panel" className="sc-tool-pop" role="menu" aria-label="画布工具">
          <button type="button" role="menuitemradio" aria-checked={!canvasSelectOn} className={`sc-canvas-tool-row${!canvasSelectOn ? ' is-active' : ''}`} onClick={chooseHandTool}>
            <Hand size={15} strokeWidth={2} />
            <span>抓手工具</span>
            <span className="sc-tool-key" aria-hidden="true">H</span>
            {!canvasSelectOn && <Check size={14} strokeWidth={2.5} className="sc-tool-check" />}
          </button>
          <button type="button" role="menuitemradio" aria-checked={canvasSelectOn} className={`sc-canvas-tool-row${canvasSelectOn ? ' is-active' : ''}`} onClick={chooseSelectTool}>
            <MaterialSymbol name="near_me" size={15} />
            <span>选择工具</span>
            <span className="sc-tool-key" aria-hidden="true">S</span>
            {canvasSelectOn && <Check size={14} strokeWidth={2.5} className="sc-tool-check" />}
          </button>
        </div>}
      </div>
      <span className="sc-tool-sep" aria-hidden="true"/>
      {/* 2026-11-13 定稿：户外 2D/3D 切换统一走左下动作簇胶囊（见 room-organizer），右轨这颗钮只在
          纯室内场景兜底平面/立体；有户外计划时不出镜。aria-pressed 如实报当前是否 3D。 */}
      {!outdoorEditing && (
        <button type="button" id="tool-2d3d" data-tip={showing3D ? '当前 3D 场景 · 切到 2D 平面' : '当前 2D 平面 · 切到 3D 场景'} aria-label={showing3D ? '当前 3D 场景，点击切到 2D 平面' : '当前 2D 平面，点击切到 3D 场景'} aria-pressed={showing3D} className="is-active" onClick={() => { onSceneMoveModeChange?.('off'); if (view.walkthroughMode) setView(current => ({ ...current, walkthroughMode: false })); toggle('view2D'); }}>
          <MaterialSymbol name={showing3D ? 'view_in_ar' : 'view_compact'} />
        </button>
      )}
      {/* 2026-11-12 三张卡拆开（用户指令）：测量 / 标注 / 属性 各一张卡，圆钮按下态各自独立。 */}
      {outdoor?.setInspector && <button type="button" id="tool-measure" data-tip="测量" aria-label="测量" aria-pressed={outdoor.inspectorTabs?.measure === true} className={outdoor.inspectorTabs?.measure === true ? 'is-active' : ''} onClick={() => outdoor.setInspector?.('measure')}>
        <MaterialSymbol name={OUTDOOR_TOOL_ICONS.measure} />
      </button>}
      {outdoor?.setInspector && <button type="button" id="tool-annotate" data-tip="标注" aria-label="标注" aria-pressed={outdoor.inspectorTabs?.annotate === true} className={outdoor.inspectorTabs?.annotate === true ? 'is-active' : ''} onClick={() => outdoor.setInspector?.('annotate')}>
        <MaterialSymbol name={OUTDOOR_TOOL_ICONS.annotate} />
      </button>}
      {outdoor?.setInspector && <button type="button" id="tool-selection" data-tip="属性" aria-label="属性" aria-pressed={outdoor.inspectorTabs?.selection === true} className={outdoor.inspectorTabs?.selection === true ? 'is-active' : ''} onClick={() => outdoor.setInspector?.('selection')}>
        <MaterialSymbol name={OUTDOOR_TOOL_ICONS.selection} />
      </button>}
      {environmentViewEnabled && onEnvironmentViewChange && <span className="sc-tool-sep" aria-hidden="true"/>}
      {environmentViewEnabled && onEnvironmentViewChange && <button type="button" id="tool-environment-view" data-tip={environmentView === 'gaussian' ? '切换到识别轮廓' : '切换到高斯实景'} aria-label={environmentView === 'gaussian' ? '切换到识别轮廓' : '切换到高斯实景'} aria-pressed={environmentView === 'footprint'} className={environmentView === 'footprint' ? 'is-active' : ''} onClick={() => {
        const next = environmentView === 'gaussian' ? 'footprint' : 'gaussian';
        if (next === 'footprint') onSceneMoveModeChange?.('off');
        onEnvironmentViewChange(next);
      }}>
        <MaterialSymbol name="layers" />
      </button>}
      {environmentViewEnabled && onEnvironmentViewChange && <span className="sc-tool-sep" aria-hidden="true"/>}
      <button type="button" id="tool-walk" aria-label={view.walkthroughMode ? '退出漫游' : '第一人称漫游'} aria-pressed={view.walkthroughMode} className={view.walkthroughMode ? 'is-active is-walk' : 'is-walk'} onClick={() => toggleWalk(!view.walkthroughMode)}>
        <MaterialSymbol name="footprint" />
        <span className="sc-walk-label" aria-hidden="true">{view.walkthroughMode ? '退出漫游' : '第一人称漫游'}</span>
      </button>
      <button type="button" id="tool-grid" data-tip="网格吸附" aria-label="网格吸附" aria-pressed={view.snapToGrid} className={view.snapToGrid ? 'is-active' : ''} onClick={() => toggle('snapToGrid')}>
        <GridSnapIcon active={view.snapToGrid} />
      </button>
      {/* 户外/地图圈画与 isMapOutdoorLayout 同一扇门；室内矩形不显示。人关掉后 satelliteGroundRef=false 仍留着这颗钮。
          户外规划（含 3D 场地）时隐藏工作台「地图类型」：底图入口只在覆盖层右下角。
          GeoGround（计划瓦片接管主 3D 地面）：「卫星贴地」没有可管的东西继续隐藏；
          「地图切换」2026-11-12 用户指令补回——直接切 GeoGround 瓦片图源，与户外 2D 底图同一份偏好联动。 */}
      {geoGroundActive && !outdoorEditing && <div className="sc-tool-menu" ref={groundSourceMenuRef}>
        <button
          type="button"
          id="tool-ground-source"
          data-tip={`地图切换 · ${PUBLIC_SOURCE_SPECS[groundSource].label}`}
          aria-label={`地图切换，当前 ${PUBLIC_SOURCE_SPECS[groundSource].label}，点选图源`}
          aria-haspopup="dialog"
          aria-expanded={groundSourceOpen}
          aria-controls="tool-ground-source-panel"
          className={groundSourceOpen ? 'is-active' : ''}
          onClick={() => { quietShare(); setGroundSourceOpen(open => !open); setExportOpen(false); setMapTypeOpen(false); setAtmosphereOpen(false); setWeatherOpen(false); setTimeOpen(false); setLightingOpen(false); }}
        >
          <MaterialSymbol name="map" />
        </button>
        {groundSourceOpen && <div id="tool-ground-source-panel" className="sc-tool-pop sc-map-type-pop" role="dialog" aria-label="地图切换">
          <span className="sc-map-type-title">地图切换</span>
          <div role="listbox" aria-label="地理瓦片图源">
            {PLAN_GROUND_SOURCES.map(src => {
              const selected = src === groundSource;
              const spec = PUBLIC_SOURCE_SPECS[src];
              return (
                <button
                  type="button"
                  key={src}
                  role="option"
                  aria-selected={selected}
                  className={`sc-map-type-row${selected ? ' is-active' : ''}`}
                  onClick={() => { writePlanGroundSource(src); setGroundSourceOpen(false); }}
                >
                  <span className="sc-map-type-copy">
                    <strong>{spec.label}</strong>
                    <small>与户外 2D 底图联动</small>
                  </span>
                  <span className="sc-map-type-provider">{spec.attribution}</span>
                </button>
              );
            })}
          </div>
          <span className="sc-map-type-note">{basemapSourceAttribution(groundSource)} · 3D 地面与户外 2D 底图同源联动</span>
        </div>}
      </div>}
      {satelliteVenue && !outdoorEditing && !geoGroundActive && <div className="sc-tool-menu" ref={mapTypeMenuRef}>
        <button type="button" id="tool-map-type" data-tip={mapTip} aria-label={mapTip} aria-haspopup="dialog" aria-expanded={mapTypeOpen} aria-controls="tool-map-type-panel" aria-busy={satelliteBusy} className={mapTypeOpen ? 'is-active' : ''} onClick={() => { quietShare(); setMapTypeOpen(open => !open); setExportOpen(false); setAtmosphereOpen(false); setWeatherOpen(false); setTimeOpen(false); setLightingOpen(false); }}>
          <MaterialSymbol name="map" />
        </button>
        {mapTypeOpen && <div id="tool-map-type-panel" className="sc-tool-pop sc-map-type-pop" role="dialog" aria-label="地图类型">
          <span className="sc-map-type-title">地图类型</span>
          <div role="listbox" aria-label="地面底图">
            {GROUND_BASEMAP_LAYERS.map(layer => {
              const selected = !!activeBasemap && activeBasemap.id === layer.id;
              return <button type="button" key={layer.id} role="option" aria-selected={selected} className={`sc-map-type-row${selected ? ' is-active' : ''}`} onClick={() => chooseBasemap(layer.style)}>
                <span className={`sc-map-type-thumb is-${layer.kind === 'satellite' ? 'satellite' : layer.style === 8 ? 'labels' : 'street'}`} aria-hidden="true"/>
                <span className="sc-map-type-copy">
                  <strong>{layer.label}</strong>
                  <small>{layer.detail}</small>
                </span>
                <span className="sc-map-type-provider">{layer.provider}</span>
              </button>;
            })}
          </div>
          {satelliteOn && <button type="button" className="sc-map-type-off" onClick={() => { setMapTypeOpen(false); turnSatellite(); }}>关闭底图</button>}
          <span className="sc-map-type-note">底图 © 高德地图 · 仅作参照，不可作重建素材</span>
        </div>}
      </div>}
      {satelliteVenue && !outdoorEditing && !geoGroundActive && <button type="button" id="tool-satellite" data-tip={satelliteTip} aria-label={satelliteOn ? `卫星贴地，已打开。${SATELLITE_GROUND_LABEL}` : `卫星贴地，已关闭。${SATELLITE_GROUND_LABEL}`} aria-pressed={satelliteOn} aria-busy={satelliteBusy} className={satelliteOn ? 'is-active' : ''} onClick={turnSatellite}>
        <MaterialSymbol name="satellite" />
      </button>}
      <span className="sc-tool-sep" aria-hidden="true"/>
      <button type="button" id="tool-undo" data-tip={outdoorEditing ? '撤销（平面编辑）' : '撤销'} aria-label="撤销" disabled={outdoorEditing ? !outdoor!.canUndo : (layoutLocked || !history.canUndo)} onClick={outdoorEditing ? () => outdoor!.undo() : history.undo}>
        <MaterialSymbol name="undo" />
      </button>
      <button type="button" id="tool-redo" data-tip={outdoorEditing ? '重做（平面编辑）' : '重做'} aria-label="重做" disabled={outdoorEditing ? !outdoor!.canRedo : (layoutLocked || !history.canRedo)} onClick={outdoorEditing ? () => outdoor!.redo() : history.redo}>
        <MaterialSymbol name="redo" />
      </button>
      <span className="sc-tool-sep" aria-hidden="true"/>
      <button type="button" id="tool-zoom-out" data-tip="缩小" aria-label="缩小" disabled={outdoorEditing ? false : view.view2D} onClick={() => (outdoorEditing ? outdoor!.zoomBy(-1) : onZoom('-'))}>
        <MaterialSymbol name="iconpark_zoom_out_solid" />
      </button>
      <button type="button" id="tool-zoom-in" data-tip="放大" aria-label="放大" disabled={outdoorEditing ? false : view.view2D} onClick={() => (outdoorEditing ? outdoor!.zoomBy(1) : onZoom('+'))}>
        <MaterialSymbol name="iconpark_zoom_in_solid" />
      </button>
      {onExportImage && !outdoorEditing && <div className="sc-tool-menu" ref={exportMenuRef}>
        <button type="button" id="tool-export" data-tip="导出效果图" aria-label="导出效果图" aria-haspopup="dialog" aria-expanded={exportOpen} aria-controls="tool-export-panel" className={exportOpen ? 'is-active' : ''} onClick={() => { quietShare(); setExportOpen(open => !open); setMapTypeOpen(false); setAtmosphereOpen(false); setWeatherOpen(false); setTimeOpen(false); setLightingOpen(false); }}>
          <MaterialSymbol name="photo_camera" />
        </button>
        {exportOpen && <div id="tool-export-panel" className="sc-tool-pop sc-export-pop" role="dialog" aria-label="导出效果图选项">
          <span className="sc-export-title">导出效果图</span>
          <div className="sc-export-preview" role="img" aria-label={preview ? '效果图预览' : '效果图预览还没出来'}>
            {previewing ? <Loader2 size={18} className="cr-spin" aria-hidden="true"/> : preview ? <img src={preview} alt=""/> : <MaterialSymbol name="photo_camera" size={18} />}
          </div>
          <div className="sc-export-options" role="group" aria-label="导出视角">
            {EXPORT_VIEWS.map(entry => <button type="button" key={entry.id} className={exportMode === 'single' && exportView === entry.id ? 'is-active' : ''} aria-label={entry.label} title={entry.label} aria-pressed={exportMode === 'single' && exportView === entry.id} onClick={() => { setExportView(entry.id); setExportMode('single'); }}><MaterialSymbol name={entry.symbol} size={16} /></button>)}
            {onExportAlbum && <button type="button" aria-label="机位册" title={view.view2D ? '机位册需在 3D 视图使用' : '机位册：整体、俯视、正面、对角，另附离线图册'} aria-pressed={exportMode === 'album'} className={exportMode === 'album' ? 'is-active' : ''} disabled={view.view2D} onClick={() => setExportMode(mode => mode === 'album' ? 'single' : 'album')}><MaterialSymbol name="photo_library" size={16} /></button>}
          </div>
          <div className="sc-export-options" role="group" aria-label="导出画质">
            {EXPORT_SCALES.map(entry => <button type="button" key={entry.scale} className={exportScale === entry.scale ? 'is-active' : ''} aria-label={`${entry.hint}（${entry.label}）`} title={`${entry.hint}（${entry.label}）`} aria-pressed={exportScale === entry.scale} disabled={view.view2D && entry.scale !== 1} onClick={() => setExportScale(entry.scale)}>{entry.label}</button>)}
          </div>
          <button type="button" className="sc-export-cta" disabled={exporting} onClick={() => { void runExport(); }}>
            {exporting ? '正在导出…' : exportMode === 'album' ? '导出机位册' : '导出 PNG'}
          </button>
        </div>}
      </div>}
      {showAtmosphere && <span className="sc-tool-sep" aria-hidden="true"/>}
      {showAtmosphere && <div className="sc-tool-menu" ref={atmosphereMenuRef}>
        <button type="button" id="tool-atmosphere" data-tip="氛围" aria-label="氛围：人群、天气与时段" aria-haspopup="menu" aria-expanded={atmosphereShown} aria-controls="sc-atmosphere-group" className={atmosphereShown ? 'is-active' : ''} onClick={() => { quietShare(); setAtmosphereOpen(open => !open); setMapTypeOpen(false); setWeatherOpen(false); setTimeOpen(false); setLightingOpen(false); }}>
          <MaterialSymbol name="sunny" />
        </button>
        {atmosphereShown && <div id="sc-atmosphere-group" className="sc-tool-pop sc-more-pop sc-atmosphere-group" role="menu" aria-label="氛围">
          <span className="sc-tool-menu-label" role="presentation">氛围</span>
          <button type="button" id="tool-crowd" role="menuitemcheckbox" title="约 3 人从主入口沿通道走进场，避开家具。不移动相机" aria-checked={view.showNpcs} className={view.showNpcs ? 'is-active' : ''} disabled={view.view2D} onClick={() => toggle('showNpcs')}><MaterialSymbol name="groups" size={16}/><span>人群</span></button>
          <span className="sc-more-sep" aria-hidden="true"/>
          <button type="button" id="tool-weather" role="menuitem" aria-haspopup="listbox" aria-expanded={weatherOpen} onClick={() => { setWeatherOpen(open => !open); setTimeOpen(false); }}>
            <MaterialSymbol name={view.weather === 'clear' ? 'sunny' : 'rainy'} size={16}/>
            <span>{WEATHER_OPTIONS.find(option => option.id === view.weather)?.label ?? '天气'}</span>
          </button>
          {weatherOpen && <div className="sc-tool-pop sc-more-pop" role="listbox" aria-label="室外天气选项" style={{ top: 'auto', right: 'calc(100% + 8px)' }}>
            {WEATHER_OPTIONS.map(option => <button type="button" key={option.id} role="option" aria-selected={view.weather === option.id} className={view.weather === option.id ? 'is-active' : ''} onClick={() => { setView(current => ({ ...current, weather: option.id })); setWeatherOpen(false); }}>{option.label}</button>)}
          </div>}
          <button type="button" id="tool-time" role="menuitem" aria-haspopup="listbox" aria-expanded={timeOpen} onClick={() => { setTimeOpen(open => !open); setWeatherOpen(false); }}>
            <MaterialSymbol name="light_mode" size={16}/>
            <span>{activeTime?.title ?? '时段'}</span>
          </button>
          {timeOpen && <div className="sc-tool-pop sc-more-pop" role="listbox" aria-label="室外时段选项" style={{ top: 'auto', right: 'calc(100% + 8px)' }}>
            {TIME_PRESETS.map(entry => <button type="button" key={entry.label} role="option" aria-label={`室外时段 ${entry.title}`} aria-selected={activeTime?.label === entry.label} className={activeTime?.label === entry.label ? 'is-active' : ''} onClick={() => { setView(current => ({ ...current, timeOfDay: entry.hour })); setTimeOpen(false); }}>{entry.title}</button>)}
          </div>}

          <span className="sc-more-sep" aria-hidden="true"/>
          <button type="button" id="tool-lighting" role="menuitem" aria-haspopup="listbox" aria-expanded={lightingOpen} onClick={() => { setLightingOpen(open => !open); setWeatherOpen(false); setTimeOpen(false); }}>
            <MaterialSymbol name="wb_sunny" size={16}/>
            <span>{LIGHTING_OPTIONS.find(option => option.id === (layout.backendLighting ?? 'neutral'))?.label ?? '现场灯光'}</span>
          </button>
          {lightingOpen && <div className="sc-tool-pop sc-more-pop" role="listbox" aria-label="现场灯光选项" style={{ top: 'auto', right: 'calc(100% + 8px)' }}>
            {LIGHTING_OPTIONS.map(option => <button type="button" key={option.id} role="option" aria-selected={(layout.backendLighting ?? 'neutral') === option.id} className={(layout.backendLighting ?? 'neutral') === option.id ? 'is-active' : ''} onClick={() => { onLighting?.(option.id); setLightingOpen(false); }}>{option.label}</button>)}
          </div>}
        </div>}
      </div>}
    </nav>
  );
}

/** Design: bottom full-width MATERIALS handle (reference 04-final-flat) — a hairline bar, not a floating pill. */
export function MaterialDrawerHandle({ open, onToggle, buttonRef }: { open: boolean; onToggle(): void; buttonRef?: RefObject<HTMLButtonElement> }): JSX.Element {
  return (
    <div className={`sc-material-drawer-bar${open ? ' is-open' : ''}`}>
      <button
        type="button"
        ref={buttonRef}
        id="material-drawer-handle"
        className={`sc-material-drawer-handle${open ? ' is-active' : ''}`}
        title={open ? '收起物料库' : '展开物料库'}
        data-tip={open ? '收起物料库' : '展开物料库'}
        aria-label={open ? '收起物料库' : '展开物料库'}
        aria-expanded={open}
        aria-controls="workbench-material-shelf"
        onClick={onToggle}
      >
        <Boxes size={20} aria-hidden="true"/>
        <ChevronUp className="sc-materials-chevron" size={16} aria-hidden="true"/>
      </button>
    </div>
  );
}
