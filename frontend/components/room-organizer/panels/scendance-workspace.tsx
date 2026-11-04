'use client';

import { Boxes, ChevronUp, Loader2, X } from '@/components/solid-icons';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useRoomEditor, useSelection } from '../contexts';
import {
  SATELLITE_GROUND_LABEL,
  applySatelliteGroundPatch,
  ensureSatelliteGround,
  hideSatelliteGround,
  isMapOutdoorLayout,
  isSatelliteGroundImage,
  readAmapKeys,
  satelliteGroundWanted,
  satelliteImageAligned,
  satelliteMissReason,
} from '../lib/amap-venue';
import { editorItemLimit } from '../lib/scene-presets';
import { materialCount } from '../lib/structural-layout';
import { requestWalkPointerLock } from '../lib/walk-engage';
import { LocalGlbImport } from './local-glb-import';
import { MaterialSymbol } from './material-symbol';
import { OnlineModelLibrary } from './online-model-library';
import { ShareMenu, type ShareMenuActions } from './share-menu';
import type { CatalogPlacementGuard } from '../lib/catalog-placement-guard';
import type { CameraPreset, CatalogItem, FurnitureItem, RoomLayout, Weather } from '../lib/types';
import { MAX_FLOORS } from '../lib/constants';
import type { SplatDisplayMode } from '../three/splat-preview';
import type { BackendSession } from '@/lib/backend-session';
import './workbench-shelf.css';

interface LibraryProps {
  controller?: BackendSession;
  onClose?(): void;
  capturePlacement?(): CatalogPlacementGuard;
  placeCatalogItem(item: CatalogItem, position?: { x: number; z: number }): string;
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

export function ScendanceLibrary({ placeCatalogItem, controller, onClose, capturePlacement, variant = 'shelf' }: LibraryProps & {
  /** shelf = 画布底部抽屉；card = 嵌进 Agent 面板，不要拖拽条。 */
  variant?: 'shelf' | 'card';
}): JSX.Element {
  const { layout, activeFloor, actions, history } = useRoomEditor();
  const { selectOnly } = useSelection();
  const hostRef = useRef<HTMLElement>(null);
  const atLimit = materialCount(activeFloor.items) >= editorItemLimit(layout);
  const card = variant === 'card';

  const addMaterial = (item: CatalogItem) => {
    if (atLimit) return;
    // 放置只选中、不掀属性面板：要看尺寸/颜色得双击画面里那件物料。
    const id = placeCatalogItem(item);
    if (id) selectOnly(id, { keepPanel: true });
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
            <OnlineModelLibrary cardMode {...(controller ? { controller } : {})} {...(capturePlacement ? { capturePlacement } : {})} {...(atLimit ? { limitMessage: `已达到 ${editorItemLimit(layout)} 件物料上限，请先删除部分物料。` } : {})} disabled={atLimit} onAdd={addMaterial} onAddSet={addStyleSet} importSlot={importSlot} roomSize={{ width: layout.width, depth: layout.height }}/>
          </div>
        </div>
        : <div className="sc-library-content">
          <div className="sc-library-materials">
            <OnlineModelLibrary {...(controller ? { controller } : {})} {...(capturePlacement ? { capturePlacement } : {})} {...(atLimit ? { limitMessage: `已达到 ${editorItemLimit(layout)} 件物料上限，请先删除部分物料。` } : {})} disabled={atLimit} onAdd={addMaterial} importSlot={importSlot}/>
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
  onApplyPreset(preset: CameraPreset): void;
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
 * 三个机位是同一层切换，所以右轨只放一颗钮：图标就是当前机位，点一下换下一个。
 * 顺序按「先看整体、再看平面、最后看立面」排，初次点开落到俯视这种最常用的检查机位。
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
function FloorTriangle({ direction }: { direction: 'up' | 'down' }): JSX.Element {
  const path = direction === 'up'
    ? 'M12 3.2c-2.6 0-5.2 4.5-7.1 8.4-1.8 3.6-.2 6.2 3.5 6.2h7.2c3.7 0 5.3-2.6 3.5-6.2C17.2 7.7 14.6 3.2 12 3.2Z'
    : 'M12 20.8c2.6 0 5.2-4.5 7.1-8.4 1.8-3.6.2-6.2-3.5-6.2H8.4c-3.7 0-5.3 2.6-3.5 6.2 1.9 3.9 4.5 8.4 7.1 8.4Z';
  return <svg aria-hidden="true" className={`sc-floor-triangle is-${direction}`} viewBox="0 0 24 24" focusable="false"><path d={path}/></svg>;
}
function presetAt(preset: CameraPreset) {
  const entry = ANGLE_PRESETS.find(candidate => candidate.id === preset) ?? ANGLE_PRESETS[0];
  return { current: entry, next: ANGLE_PRESETS[(ANGLE_PRESETS.indexOf(entry) + 1) % ANGLE_PRESETS.length] };
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
export function ScendanceViewTools({ onApplyPreset, onZoom, onExportImage, onCaptureImage, onExportAlbum, showAtmosphere = true, onLighting, sceneMoveEnabled = false, sceneMoveMode = 'off', onSceneMoveModeChange, environmentView = 'gaussian', environmentViewEnabled = false, onEnvironmentViewChange, layoutLocked = false, shareActions, shareOpenRequest = 0 }: ViewToolsProps): JSX.Element {
  const sceneMoveActive = sceneMoveMode !== 'off';
  const { view, setView, toggle, history, layout, activeFloorIndex, actions } = useRoomEditor();
  const [preset, setPreset] = useState<CameraPreset>('iso');
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
  // 第一人称走进场是右轨一级圆钮，不收进氛围，也不收进省略号。
  const atmosphereShown = atmosphereOpen || view.showNpcs || view.weather !== 'clear' || (view.timeOfDay ?? 12) !== 12;
  const satelliteVenue = isMapOutdoorLayout(layout) || layout.satelliteGroundRef !== undefined || isSatelliteGroundImage(layout.floorPlanImage);
  const satelliteOn = satelliteGroundWanted(layout);
  const [satelliteBusy, setSatelliteBusy] = useState(false);
  const [satelliteMiss, setSatelliteMiss] = useState<'key' | 'place' | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const satelliteRequest = useRef(0);
  const satelliteAttempt = useRef('');
  const busyTimer = useRef(0);
  const satelliteTip = satelliteMiss === 'key' ? '卫星贴地·需高德 Key' : satelliteMiss === 'place' ? '卫星贴地·未定位' : '卫星贴地';
  const releaseBusy = useCallback((mine: number) => {
    window.clearTimeout(busyTimer.current);
    if (satelliteRequest.current === mine) setSatelliteBusy(false);
  }, []);
  const fillSatellite = useCallback((startedId: string, startedName: string, mine: number, showBusy: boolean) => {
    const source = layoutRef.current;
    window.clearTimeout(busyTimer.current);
    // 进场自动补图不占钮。只有人点开时才亮 busy，并且到点或结束一定放开。
    if (showBusy) {
      setSatelliteBusy(true);
      busyTimer.current = window.setTimeout(() => releaseBusy(mine), 12000);
    } else {
      setSatelliteBusy(false);
    }
    void ensureSatelliteGround(source).then(patch => {
      if (mine !== satelliteRequest.current) return;
      const current = layoutRef.current;
      if ((current.id ?? '') !== startedId || current.name !== startedName || current.satelliteGroundRef === false) return;
      setSatelliteMiss(satelliteMissReason(current, patch, readAmapKeys()));
      if (!patch) return;
      actions.applyLayout(applySatelliteGroundPatch(current, patch));
      setView(next => ({ ...next, showReferenceImage: true, referenceImageOpacity: patch.floorPlanOpacity }));
    }).finally(() => { if (showBusy) releaseBusy(mine); });
  }, [actions, releaseBusy, setView]);
  useEffect(() => () => { window.clearTimeout(busyTimer.current); }, []);
  useEffect(() => {
    if (!satelliteOn || satelliteImageAligned(layout.floorPlanImage)) return undefined;
    // 已经有一张非卫星的底图时不要自动盖掉；人点开卫星开关才换。
    // 旧的 location/zoom 卫星图没有经纬度范围，要重拉，否则贴地会对不齐。
    if (layout.floorPlanImage && !isSatelliteGroundImage(layout.floorPlanImage)) return undefined;
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
    if (satelliteImageAligned(current.floorPlanImage)) {
      actions.applyLayout({ ...current, satelliteGroundRef: true, floorPlanOpacity: current.floorPlanOpacity ?? 0.78 });
      setView(next => ({ ...next, showReferenceImage: true, referenceImageOpacity: current.floorPlanOpacity ?? 0.78 }));
      return;
    }
    actions.applyLayout({ ...current, satelliteGroundRef: true, floorPlanOpacity: current.floorPlanOpacity ?? 0.78 });
    fillSatellite(current.id ?? '', current.name, satelliteRequest.current, true);
  };
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const atmosphereMenuRef = useRef<HTMLDivElement>(null);
  const selectActive = view.selectMode && !view.measurementMode && !view.drawWallMode && !view.drawZoneMode && !view.walkthroughMode;
  const selectTip = selectActive
    ? '移动局部物体 · 激活中，再点一次退出'
    : view.selectMode ? '移动局部物体 · 已启用，点一下切回' : '移动局部物体 · 未启用，点一下启用';
  const { current: angleNow, next: angleNext } = presetAt(preset);
  const choosePreset = (next: CameraPreset) => {
    setView(current => ({ ...current, view2D: false, walkthroughMode: false }));
    onApplyPreset(next);
    setPreset(next);
  };
  const cyclePreset = () => choosePreset(angleNext.id);
  const changeVisibleFloor = (delta: -1 | 1) => {
    const next = activeFloorIndex + delta;
    if (next < 0) return;
    if (next >= layout.floors.length) {
      if (delta !== 1 || layout.floors.length >= MAX_FLOORS) return;
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
  // 选择钮是真开关：第二次点击把 selectMode 关掉（画布只浏览、不抓物料）；
  // 从别的工具点回来时，顺手把那件工具停掉。
  const toggleSelect = () => {
    // Object movement and whole-scene movement are exclusive modes.
    onSceneMoveModeChange?.('off');
    setView(current => {
      const active = current.selectMode && !current.measurementMode && !current.drawWallMode && !current.drawZoneMode && !current.walkthroughMode;
      return active
        ? { ...current, selectMode: false }
        : { ...current, selectMode: true, measurementMode: false, drawWallMode: false, drawZoneMode: false, walkthroughMode: false };
    });
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
    if (!onExportImage) return;
    setExporting(true);
    try {
      await onExportImage({ view: exportView, scale: exportScale });
    } finally {
      setExporting(false);
      setExportOpen(false);
    }
  };
  useEffect(() => {
    if (!exportOpen && !atmosphereShown && !weatherOpen && !timeOpen && !lightingOpen) return undefined;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      const el = event.target as HTMLElement | null;
      if (exportOpen && exportMenuRef.current && !exportMenuRef.current.contains(target)) setExportOpen(false);
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
      if (event.key === 'Escape') { setAtmosphereOpen(false); setWeatherOpen(false); setTimeOpen(false); setLightingOpen(false); setExportOpen(false); }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [exportOpen, weatherOpen, timeOpen, lightingOpen, atmosphereShown]);

  return (
    /* 圆钮贴在画布右上角。所有工具都是一级钮，没有省略号菜单；只有导出还带一层选项弹层。 */
    <nav id="tool-column" className="sc-view-tools sc-canvas-rail sc-tool-column" aria-label="工具" onWheel={event => event.stopPropagation()}>
      <div className="sc-floor-switcher" role="group" aria-label={`楼层切换，当前第 ${activeFloorIndex + 1} 层`}>
        <span className="sc-floor-switcher-label" aria-hidden="true">{activeFloorIndex + 1}F</span>
        <div className="sc-floor-switcher-arrows">
          <button type="button" aria-label={activeFloorIndex < layout.floors.length - 1 ? `切换到第 ${activeFloorIndex + 2} 层` : layout.floors.length < MAX_FLOORS ? `新建并切换到第 ${activeFloorIndex + 2} 层` : '已经是最高层'} title={activeFloorIndex < layout.floors.length - 1 ? `切换到第 ${activeFloorIndex + 2} 层` : layout.floors.length < MAX_FLOORS ? `新建并切换到第 ${activeFloorIndex + 2} 层` : '已经是最高层'} disabled={activeFloorIndex >= MAX_FLOORS - 1 || (activeFloorIndex >= layout.floors.length - 1 && layout.floors.length >= MAX_FLOORS)} onClick={() => changeVisibleFloor(1)}>
            <FloorTriangle direction="up"/>
          </button>
          <button type="button" aria-label={activeFloorIndex > 0 ? `切换到第 ${activeFloorIndex} 层` : '已经是底层'} title={activeFloorIndex > 0 ? `切换到第 ${activeFloorIndex} 层` : '已经是底层'} disabled={activeFloorIndex <= 0} onClick={() => changeVisibleFloor(-1)}>
            <FloorTriangle direction="down"/>
          </button>
        </div>
      </div>
      <ShareMenu {...(shareActions ? { actions: shareActions } : {})} layout={layout} openRequest={shareOpenRequest} closeSignal={shareClose}/>
      <span className="sc-tool-sep" aria-hidden="true"/>
      {sceneMoveEnabled && <button type="button" id="tool-move-scene" data-tip={sceneMoveMode === 'off' ? '移动整体场景' : sceneMoveMode === 'gizmo' ? '移动整体场景 · 坐标轴 · 再点切无轴' : '移动整体场景 · 无轴 · 再点完成'} aria-label={sceneMoveMode === 'off' ? '移动整体场景' : sceneMoveMode === 'gizmo' ? '切换到无轴移动' : '完成移动整体场景'} aria-pressed={sceneMoveActive} className={sceneMoveActive ? 'is-active' : ''} onClick={() => onSceneMoveModeChange?.(sceneMoveMode === 'off' ? 'gizmo' : sceneMoveMode === 'gizmo' ? 'numeric' : 'off')}>
        <MoveSceneIcon />
      </button>}
      <button type="button" id="tool-select" data-tip={selectTip} aria-label={selectTip} aria-pressed={selectActive} className={selectActive ? 'is-active' : view.selectMode ? '' : 'is-off'} onClick={toggleSelect}>
        <MaterialSymbol name="near_me" />
      </button>
      <span className="sc-tool-sep" aria-hidden="true"/>
      <button type="button" id="tool-2d3d" data-tip="平面 / 立体" aria-label="2D / 3D" aria-pressed={!view.view2D} className={!view.view2D ? 'is-active' : ''} onClick={() => { onSceneMoveModeChange?.('off'); if (view.walkthroughMode) setView(current => ({ ...current, walkthroughMode: false })); toggle('view2D'); }}>
        <MaterialSymbol name={view.view2D ? 'view_compact' : 'view_in_ar'} />
      </button>
      {environmentViewEnabled && onEnvironmentViewChange && <span className="sc-tool-sep" aria-hidden="true"/>}
      {environmentViewEnabled && onEnvironmentViewChange && <button type="button" id="tool-environment-view" data-tip={environmentView === 'gaussian' ? '切换到识别轮廓' : '切换到高斯实景'} aria-label={environmentView === 'gaussian' ? '切换到识别轮廓' : '切换到高斯实景'} aria-pressed={environmentView === 'footprint'} className={environmentView === 'footprint' ? 'is-active' : ''} onClick={() => {
        const next = environmentView === 'gaussian' ? 'footprint' : 'gaussian';
        if (next === 'footprint') onSceneMoveModeChange?.('off');
        onEnvironmentViewChange(next);
      }}>
        <MaterialSymbol name="layers" />
      </button>}
      {environmentViewEnabled && onEnvironmentViewChange && <span className="sc-tool-sep" aria-hidden="true"/>}
      <button type="button" id="tool-walk" data-tip={view.walkthroughMode ? '退出漫游' : '进入漫游'} aria-label={view.walkthroughMode ? '退出漫游' : '进入漫游'} aria-pressed={view.walkthroughMode} className={view.walkthroughMode ? 'is-active is-walk' : 'is-walk'} onClick={() => setWalkthrough(!view.walkthroughMode)}>
        <MaterialSymbol name="footprint" />
        <span className="sc-walk-label" aria-hidden="true">{view.walkthroughMode ? '退出漫游' : '第一人称走进场'}</span>
      </button>
      <button type="button" id="tool-preset" data-tip={`视角：${angleNow.label} · 点一下切到${angleNext.label}`} aria-label={`视角切换：当前${angleNow.label}，点击切到${angleNext.label}`} onClick={cyclePreset}>
        <MaterialSymbol name={angleNow.symbol} />
      </button>
      <button type="button" id="tool-dims" data-tip="尺寸（单位 m）" aria-label="尺寸标注" aria-pressed={view.showMeasurements} className={view.showMeasurements ? 'is-active' : ''} onClick={() => toggle('showMeasurements')}>
        <MaterialSymbol name="straighten" />
      </button>
      <button type="button" id="tool-grid" data-tip="网格吸附" aria-label="网格吸附" aria-pressed={view.snapToGrid} className={view.snapToGrid ? 'is-active' : ''} onClick={() => toggle('snapToGrid')}>
        <MaterialSymbol name={view.snapToGrid ? 'center_focus_strong' : 'grid_3x3'} />
      </button>
      {/* 户外/地图圈画与 isMapOutdoorLayout 同一扇门；室内矩形不显示。人关掉后 satelliteGroundRef=false 仍留着这颗钮。 */}
      {satelliteVenue && <button type="button" id="tool-satellite" data-tip={satelliteTip} aria-label={satelliteOn ? `卫星贴地，已打开。${SATELLITE_GROUND_LABEL}` : `卫星贴地，已关闭。${SATELLITE_GROUND_LABEL}`} aria-pressed={satelliteOn} aria-busy={satelliteBusy} className={satelliteOn ? 'is-active' : ''} onClick={turnSatellite}>
        <MaterialSymbol name="satellite" />
      </button>}
      <span className="sc-tool-sep" aria-hidden="true"/>
      <button type="button" id="tool-undo" data-tip="撤销" aria-label="撤销" disabled={layoutLocked || !history.canUndo} onClick={history.undo}>
        <MaterialSymbol name="undo" />
      </button>
      <button type="button" id="tool-redo" data-tip="重做" aria-label="重做" disabled={layoutLocked || !history.canRedo} onClick={history.redo}>
        <MaterialSymbol name="redo" />
      </button>
      <span className="sc-tool-sep" aria-hidden="true"/>
      <button type="button" id="tool-zoom-out" data-tip="缩小" aria-label="缩小" disabled={view.view2D} onClick={() => onZoom('-')}>
        <MaterialSymbol name="iconpark_zoom_out_solid" />
      </button>
      <button type="button" id="tool-zoom-in" data-tip="放大" aria-label="放大" disabled={view.view2D} onClick={() => onZoom('+')}>
        <MaterialSymbol name="iconpark_zoom_in_solid" />
      </button>
      {onExportImage && <div className="sc-tool-menu" ref={exportMenuRef}>
        <button type="button" id="tool-export" data-tip="导出效果图" aria-label="导出效果图" aria-haspopup="dialog" aria-expanded={exportOpen} aria-controls="tool-export-panel" className={exportOpen ? 'is-active' : ''} onClick={() => { quietShare(); setExportOpen(open => !open); setAtmosphereOpen(false); setWeatherOpen(false); setTimeOpen(false); setLightingOpen(false); }}>
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
        <button type="button" id="tool-atmosphere" data-tip="氛围" aria-label="氛围：人群、天气与时段" aria-haspopup="menu" aria-expanded={atmosphereShown} aria-controls="sc-atmosphere-group" className={atmosphereShown ? 'is-active' : ''} onClick={() => { quietShare(); setAtmosphereOpen(open => !open); setWeatherOpen(false); setTimeOpen(false); setLightingOpen(false); }}>
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
