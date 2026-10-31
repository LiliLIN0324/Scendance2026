'use client';

import { Camera, ChevronUp, CloudRain, Crosshair, Eye, Footprints, Grid, LayoutTemplate, MousePointer2, Package, Ruler, Satellite, Sparkles, Sun, Trees, Users, X } from 'lucide-react';
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
import { EnvironmentPreview } from './environment-preview';
import { GeneratedItemLibrary } from './generated-item-library';
import { OnlineModelLibrary } from './online-model-library';
import { ScenePresetsPanel } from './scene-presets-panel';
import { StructuralPropertiesPanel } from './structural-properties-panel';
import type { SplatPreviewState } from '../hooks/use-splat-preview';
import type { CatalogPlacementGuard } from '../lib/catalog-placement-guard';
import type { CameraPreset, CatalogItem, RoomLayout, Weather } from '../lib/types';
import type { BackendSession } from '@/lib/backend-session';
import './workbench-shelf.css';

interface LibraryProps {
  controller?: BackendSession;
  openTabRequest?: { serial: number; tab: 'materials' | 'presets' | 'environment' | 'generated' };
  onClose?(): void;
  capturePlacement?(): CatalogPlacementGuard;
  onLoadPreset(layout: RoomLayout): void;
  placeCatalogItem(item: CatalogItem, position?: { x: number; z: number }): string;
  /** 「环境预览」这一档的内容：3DGS 场景由画布那条独立渲染栈负责画。 */
  environment?: { preview: SplatPreviewState; onStart(assetId: string): void; onStop(): void };
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
  // 默认比最低点多留一行，缩略图才看得出是啥；拖高只是让图更大。
  return { min: compact ? 150 : 176, default: compact ? 150 : 212, max: Math.max(compact ? 262 : 288, Math.round(window.innerHeight * 0.62)) };
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

export function ShelfGrip({ shelfRef }: { shelfRef: RefObject<HTMLElement | null> }): JSX.Element {
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
  const { min, max } = height ? shelfBounds() : { min: 212, max: 212 };

  return <div
    ref={gripRef}
    className="sc-shelf-grip"
    role="separator"
    aria-orientation="horizontal"
    aria-label="调整物料库高度"
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

export function ScendanceLibrary({ placeCatalogItem, controller, onLoadPreset, openTabRequest, onClose, capturePlacement, environment }: LibraryProps): JSX.Element {
  const { layout, activeFloor } = useRoomEditor();
  const { selectOnly } = useSelection();
  const [tab, setTab] = useState<'materials' | 'generated' | 'environment' | 'presets'>('materials');
  const hostRef = useRef<HTMLElement>(null);
  const handledOpenRequest = useRef<number | null>(null);
  const atLimit = materialCount(activeFloor.items) >= editorItemLimit(layout);

  useEffect(() => {
    if (!openTabRequest || openTabRequest.serial === handledOpenRequest.current) return;
    handledOpenRequest.current = openTabRequest.serial;
    setTab(openTabRequest.tab);
  }, [openTabRequest]);

  const addMaterial = (item: CatalogItem) => {
    if (atLimit) return;
    // 放置只选中、不掀属性面板：要看尺寸/颜色得双击画面里那件物料。
    const id = placeCatalogItem(item);
    if (id) selectOnly(id, { keepPanel: true });
  };

  return <aside ref={hostRef} className="sc-library sc-compact-shelf" aria-label="场地工具">
    <ShelfGrip shelfRef={hostRef}/>
    <div className="sc-library-body">
      <nav className="sc-library-rail" role="tablist" aria-label="物料面板">
        <button type="button" role="tab" aria-selected={tab === 'materials'} className={tab === 'materials' ? 'is-active' : ''} aria-label="物料库" title="物料库" onClick={() => setTab('materials')}><Package size={24} aria-hidden="true"/></button>
        <button type="button" role="tab" aria-selected={tab === 'generated'} className={tab === 'generated' ? 'is-active' : ''} aria-label="生成物件" title="生成物件" onClick={() => setTab('generated')}><Sparkles size={24} aria-hidden="true"/></button>
        {environment && <button type="button" role="tab" aria-selected={tab === 'environment'} className={tab === 'environment' ? 'is-active' : ''} aria-label="环境预览" title="环境预览" onClick={() => setTab('environment')}><Trees size={24} aria-hidden="true"/></button>}
        <button type="button" role="tab" aria-selected={tab === 'presets'} className={tab === 'presets' ? 'is-active' : ''} aria-label="场景模板" title="场景模板" onClick={() => setTab('presets')}><LayoutTemplate size={24} aria-hidden="true"/></button>
        <span className="sc-library-rail-spacer" aria-hidden="true"/>
        {onClose && <button type="button" className="sc-library-rail-close" aria-label="关闭物料库" title="关闭" onClick={onClose}><X size={20} aria-hidden="true"/></button>}
      </nav>
      <div className="sc-library-content">
        <div className="sc-library-materials" hidden={tab !== 'materials'}>
          <OnlineModelLibrary {...(controller ? { controller } : {})} {...(capturePlacement ? { capturePlacement } : {})} {...(atLimit ? { limitMessage: `已达到 ${editorItemLimit(layout)} 件物料上限，请先删除部分物料。` } : {})} disabled={atLimit} onAdd={addMaterial}/>
        </div>
        {tab === 'generated' && <div className="sc-library-generated">
          <GeneratedItemLibrary disabled={atLimit} onAdd={addMaterial}/>
        </div>}
        {tab === 'environment' && environment && <div className="sc-library-generated">
          <EnvironmentPreview preview={environment.preview} onStart={environment.onStart} onStop={environment.onStop}/>
        </div>}
        {tab === 'presets' && <div className="sc-library-presets">
          <ScenePresetsPanel layout={layout} onApply={onLoadPreset}/>
          {layout.backendSceneV2 && <div className="sc-preset-utilities">
            <details><summary>已建空间的结构微调</summary><StructuralPropertiesPanel/></details>
          </div>}
        </div>}
      </div>
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
  onApplyPreset(preset: CameraPreset): void;
  onFit(): void;
  onZoom(direction: '+' | '-'): void;
  /**
   * Exports the current view as a PNG. In 3D the chosen preset frame and
   * resolution multiplier are applied for the capture only; in 2D the plan is
   * exported at its current resolution.
   */
  onExportImage?(options: { view: 'current' | CameraPreset; scale: number }): Promise<boolean> | void;
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
const ANGLE_PRESETS: ReadonlyArray<{ id: CameraPreset; label: string }> = [
  { id: 'iso', label: '整体' },
  { id: 'top', label: '俯视' },
  { id: 'front', label: '人视' },
];
const EXPORT_VIEWS: ReadonlyArray<{ id: 'current' | CameraPreset; label: string }> = [
  { id: 'current', label: '跟随当前' },
  ...ANGLE_PRESETS,
];
const EXPORT_SCALES: ReadonlyArray<{ scale: number; label: string }> = [
  { scale: 1, label: '标清 1×' },
  { scale: 2, label: '高清 2×' },
  { scale: 3, label: '超清 3×' },
];

/** Design: canvas-right vertical 14-key circular column (v2.4). */
export function ScendanceViewTools({ onApplyPreset, onFit, onZoom, onExportImage, showAtmosphere = true, onLighting }: ViewToolsProps): JSX.Element {
  const { view, setView, toggle, history, layout, actions } = useRoomEditor();
  const [preset, setPreset] = useState<CameraPreset>('iso');
  const [viewOpen, setViewOpen] = useState(false);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [lightingOpen, setLightingOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportView, setExportView] = useState<'current' | CameraPreset>('current');
  const [exportScale, setExportScale] = useState(2);
  const [exporting, setExporting] = useState(false);
  const [atmosphereOpen, setAtmosphereOpen] = useState(false);
  // 氛围条默认收起成一颗「氛围」：真开了漫游/人群/雨雪/非正午就展开，别让人找不到关掉它的地方。
  const atmosphereShown = atmosphereOpen || view.walkthroughMode || view.showNpcs || view.weather !== 'clear' || (view.timeOfDay ?? 12) !== 12;
  const satelliteVenue = isMapOutdoorLayout(layout) || layout.satelliteGroundRef !== undefined || isSatelliteGroundImage(layout.floorPlanImage);
  const satelliteOn = satelliteGroundWanted(layout);
  const [satelliteBusy, setSatelliteBusy] = useState(false);
  const [satelliteMiss, setSatelliteMiss] = useState<'key' | 'place' | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const satelliteRequest = useRef(0);
  const satelliteAttempt = useRef('');
  const busyTimer = useRef(0);
  const satelliteTip = satelliteMiss === 'key' ? '卫星参考·需高德 Key' : satelliteMiss === 'place' ? '卫星参考·未定位' : '卫星参考';
  const releaseBusy = useCallback((mine: number) => {
    window.clearTimeout(busyTimer.current);
    if (satelliteRequest.current === mine) setSatelliteBusy(false);
  }, []);
  const fillSatellite = useCallback((startedId: string, startedName: string, mine: number) => {
    const source = layoutRef.current;
    setSatelliteBusy(true);
    window.clearTimeout(busyTimer.current);
    // 挂起的补拉不能把钮一直占住；到点仍未结束就放开，开关本身不看 busy。
    busyTimer.current = window.setTimeout(() => releaseBusy(mine), 12000);
    void ensureSatelliteGround(source).then(patch => {
      if (mine !== satelliteRequest.current) return;
      const current = layoutRef.current;
      if ((current.id ?? '') !== startedId || current.name !== startedName || current.satelliteGroundRef === false) return;
      setSatelliteMiss(satelliteMissReason(current, patch, readAmapKeys()));
      if (!patch) return;
      actions.applyLayout(applySatelliteGroundPatch(current, patch));
      setView(next => ({ ...next, showReferenceImage: true, referenceImageOpacity: patch.floorPlanOpacity }));
    }).finally(() => releaseBusy(mine));
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
    fillSatellite(layout.id ?? '', layout.name, mine);
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
    fillSatellite(current.id ?? '', current.name, satelliteRequest.current);
  };
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const atmosphereMenuRef = useRef<HTMLDivElement>(null);
  const selectActive = !view.measurementMode && !view.drawWallMode && !view.drawZoneMode && !view.walkthroughMode;
  const choosePreset = (next: CameraPreset) => {
    setView(current => ({ ...current, view2D: false, walkthroughMode: false }));
    onApplyPreset(next);
    setPreset(next);
    setViewOpen(false);
  };
  const chooseSelect = () => {
    setView(current => ({ ...current, measurementMode: false, drawWallMode: false, drawZoneMode: false, walkthroughMode: false }));
  };
  const setWalkthrough = (on: boolean) => {
    setView(current => ({
      ...current,
      walkthroughMode: on,
      ...(on ? { view2D: false, measurementMode: false, drawWallMode: false } : {}),
    }));
  };
  const activeTime = TIME_PRESETS.find(entry => Math.abs(entry.hour - view.timeOfDay) < 0.6);
  const runExport = async () => {
    if (!onExportImage || exporting) return;
    setExporting(true);
    try {
      await onExportImage({ view: exportView, scale: exportScale });
    } finally {
      setExporting(false);
      setExportOpen(false);
      setViewOpen(false);
    }
  };
  useEffect(() => {
    if (!viewOpen && !atmosphereShown && !weatherOpen && !timeOpen && !lightingOpen) return undefined;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      const el = event.target as HTMLElement | null;
      if (viewOpen && viewMenuRef.current && !viewMenuRef.current.contains(target)) { setViewOpen(false); setExportOpen(false); }
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
      if (event.key === 'Escape') { setViewOpen(false); setAtmosphereOpen(false); setWeatherOpen(false); setTimeOpen(false); setLightingOpen(false); setExportOpen(false); }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [viewOpen, weatherOpen, timeOpen, lightingOpen, atmosphereShown]);

  return (
    /* T-VISUAL-CHROME-2：右缘竖排圆钮列（参考图 04-final-flat），次要功能收进弹出菜单。 */
    <nav id="tool-column" className="sc-view-tools sc-canvas-rail sc-tool-column" aria-label="工具" onWheel={event => event.stopPropagation()}>
      <button type="button" id="tool-select" data-tip="选择" aria-label="选择：点击物料并框选" aria-pressed={selectActive} className={selectActive ? 'is-active' : ''} onClick={chooseSelect}>
        <MousePointer2 size={24}/>
      </button>
      <span className="sc-tool-sep" aria-hidden="true"/>
      <button type="button" id="tool-2d3d" data-tip="平面 / 立体" aria-label="2D / 3D" aria-pressed={!view.view2D} className={!view.view2D ? 'is-active' : ''} onClick={() => { if (view.walkthroughMode) setView(current => ({ ...current, walkthroughMode: false })); toggle('view2D'); }}>
        <span className="sc-rail-2d">{view.view2D ? '2D' : '3D'}</span>
      </button>
      <button type="button" id="tool-fit" data-tip="看全场" aria-label="看全场" disabled={view.view2D} onClick={onFit}>
        <Crosshair size={24}/>
      </button>
      <button type="button" id="tool-dims" data-tip="尺寸" aria-label="尺寸标注" aria-pressed={view.showMeasurements} className={view.showMeasurements ? 'is-active' : ''} onClick={() => toggle('showMeasurements')}>
        <Ruler size={24}/>
      </button>
      {satelliteVenue && <button type="button" id="tool-satellite" data-tip={satelliteTip} aria-label={satelliteOn ? `卫星参考底图，已打开。${SATELLITE_GROUND_LABEL}` : `卫星参考底图，已关闭。${SATELLITE_GROUND_LABEL}`} aria-pressed={satelliteOn} aria-busy={satelliteBusy} className={satelliteOn ? 'is-active' : ''} onClick={turnSatellite}>
        <Satellite size={24}/>
      </button>}
      <span className="sc-tool-sep" aria-hidden="true"/>
      <div className="sc-tool-menu" ref={viewMenuRef}>
        <button type="button" id="tool-view" data-tip="视图" aria-label="视图与更多工具" aria-haspopup="menu" aria-expanded={viewOpen} aria-controls="tool-view-menu" className={viewOpen ? 'is-active' : ''} onClick={() => { setViewOpen(open => !open); setExportOpen(false); setWeatherOpen(false); setTimeOpen(false); setLightingOpen(false); }}>
          <Eye size={24}/>
        </button>
        {viewOpen && <div id="tool-view-menu" className="sc-tool-pop sc-more-pop" role="menu" aria-label="视图与更多工具">
          {!exportOpen ? <>
            <span className="sc-tool-menu-label" role="presentation">视角</span>
            {ANGLE_PRESETS.map(entry => <button type="button" key={entry.id} role="menuitemradio" aria-checked={!view.view2D && preset === entry.id} className={!view.view2D && preset === entry.id ? 'is-active' : ''} onClick={() => choosePreset(entry.id)}>{entry.label}</button>)}
            <span className="sc-more-sep" aria-hidden="true"/>
            <button type="button" id="tool-undo" role="menuitem" disabled={!history.canUndo} onClick={history.undo}>撤销</button>
            <button type="button" id="tool-redo" role="menuitem" disabled={!history.canRedo} onClick={history.redo}>重做</button>
            <button type="button" id="tool-zoom-out" role="menuitem" disabled={view.view2D} onClick={() => onZoom('-')}>缩小</button>
            <button type="button" id="tool-zoom-in" role="menuitem" disabled={view.view2D} onClick={() => onZoom('+')}>放大</button>
            <span className="sc-more-sep" aria-hidden="true"/>
            <button type="button" id="tool-grid" role="menuitemcheckbox" aria-checked={view.snapToGrid} className={view.snapToGrid ? 'is-active' : ''} onClick={() => toggle('snapToGrid')}><Grid size={16}/><span>网格吸附</span></button>
            <span className="sc-more-sep" aria-hidden="true"/>
            {onExportImage && <button type="button" id="tool-export" role="menuitem" aria-haspopup="dialog" aria-expanded={exportOpen} onClick={() => setExportOpen(true)}><Camera size={16}/><span>导出效果图</span></button>}
          </> : <div className="sc-more-export sc-export-pop" role="dialog" aria-label="导出效果图选项">
            <button type="button" className="sc-more-back" onClick={() => setExportOpen(false)}>← 导出效果图</button>
            <div className="sc-export-group" role="group" aria-label="导出视角">
              <span>视角</span>
              <div className="sc-export-options">
                {EXPORT_VIEWS.map(entry => <button type="button" key={entry.id} className={exportView === entry.id ? 'is-active' : ''} aria-pressed={exportView === entry.id} onClick={() => setExportView(entry.id)}>{entry.label}</button>)}
              </div>
            </div>
            <div className="sc-export-group" role="group" aria-label="导出画质">
              <span>画质</span>
              <div className="sc-export-options">
                {EXPORT_SCALES.map(entry => <button type="button" key={entry.scale} className={exportScale === entry.scale ? 'is-active' : ''} aria-pressed={exportScale === entry.scale} disabled={view.view2D} onClick={() => setExportScale(entry.scale)}>{entry.label}</button>)}
              </div>
            </div>
            <button type="button" className="sc-export-cta" disabled={exporting} onClick={() => { void runExport(); }}>
              {exporting ? '正在导出…' : '导出 PNG'}
            </button>
          </div>}
        </div>}
      </div>
      {showAtmosphere && <span className="sc-tool-sep" aria-hidden="true"/>}
      {showAtmosphere && <div className="sc-tool-menu" ref={atmosphereMenuRef}>
        <button type="button" id="tool-atmosphere" data-tip="氛围" aria-label="氛围：漫游、人群、天气与时段" aria-haspopup="menu" aria-expanded={atmosphereShown} aria-controls="sc-atmosphere-group" className={atmosphereShown ? 'is-active' : ''} onClick={() => { setAtmosphereOpen(open => !open); setViewOpen(false); setWeatherOpen(false); setTimeOpen(false); setLightingOpen(false); }}>
          <Sun size={24}/>
        </button>
        {atmosphereShown && <div id="sc-atmosphere-group" className="sc-tool-pop sc-more-pop sc-atmosphere-group" role="menu" aria-label="氛围">
          <span className="sc-tool-menu-label" role="presentation">氛围</span>
          <button type="button" id="tool-walk" role="menuitemcheckbox" aria-checked={view.walkthroughMode} className={view.walkthroughMode ? 'is-active' : ''} onClick={() => setWalkthrough(!view.walkthroughMode)}><Footprints size={16}/><span>漫游</span></button>
          <button type="button" id="tool-crowd" role="menuitemcheckbox" aria-checked={view.showNpcs} className={view.showNpcs ? 'is-active' : ''} disabled={view.view2D} onClick={() => toggle('showNpcs')}><Users size={16}/><span>人群</span></button>
          <span className="sc-more-sep" aria-hidden="true"/>
          <button type="button" id="tool-weather" role="menuitem" aria-haspopup="listbox" aria-expanded={weatherOpen} onClick={() => { setWeatherOpen(open => !open); setTimeOpen(false); }}>
            {view.weather === 'clear' ? <Sun size={16}/> : <CloudRain size={16}/>}
            <span>{WEATHER_OPTIONS.find(option => option.id === view.weather)?.label ?? '天气'}</span>
          </button>
          {weatherOpen && <div className="sc-tool-pop sc-more-pop" role="listbox" aria-label="室外天气选项" style={{ top: 'auto', right: 'calc(100% + 8px)' }}>
            {WEATHER_OPTIONS.map(option => <button type="button" key={option.id} role="option" aria-selected={view.weather === option.id} className={view.weather === option.id ? 'is-active' : ''} onClick={() => { setView(current => ({ ...current, weather: option.id })); setWeatherOpen(false); }}>{option.label}</button>)}
          </div>}
          <button type="button" id="tool-time" role="menuitem" aria-haspopup="listbox" aria-expanded={timeOpen} onClick={() => { setTimeOpen(open => !open); setWeatherOpen(false); }}>
            <Sun size={16}/>
            <span>{activeTime?.title ?? '时段'}</span>
          </button>
          {timeOpen && <div className="sc-tool-pop sc-more-pop" role="listbox" aria-label="室外时段选项" style={{ top: 'auto', right: 'calc(100% + 8px)' }}>
            {TIME_PRESETS.map(entry => <button type="button" key={entry.label} role="option" aria-label={`室外时段 ${entry.title}`} aria-selected={activeTime?.label === entry.label} className={activeTime?.label === entry.label ? 'is-active' : ''} onClick={() => { setView(current => ({ ...current, timeOfDay: entry.hour })); setTimeOpen(false); }}>{entry.title}</button>)}
          </div>}

          <span className="sc-more-sep" aria-hidden="true"/>
          <button type="button" id="tool-lighting" role="menuitem" aria-haspopup="listbox" aria-expanded={lightingOpen} onClick={() => { setLightingOpen(open => !open); setWeatherOpen(false); setTimeOpen(false); }}>
            <Sun size={16}/>
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
        aria-label={open ? '收起物料库' : '展开物料库'}
        aria-expanded={open}
        aria-controls="workbench-material-shelf"
        onClick={onToggle}
      >
        <span className="sc-materials-label">物料</span>
        <ChevronUp className="sc-materials-chevron" size={16} aria-hidden="true"/>
      </button>
    </div>
  );
}
