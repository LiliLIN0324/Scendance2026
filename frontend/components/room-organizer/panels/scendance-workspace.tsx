'use client';

import { Boxes, Camera, ChevronDown, CloudRain, Footprints, Grid, Maximize2, Minus, Plus, Redo2, Ruler, Sun, Undo2, Users, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useRoomEditor, useSelection } from '../contexts';
import { editorItemLimit } from '../lib/scene-presets';
import { materialCount } from '../lib/structural-layout';
import { OnlineModelLibrary } from './online-model-library';
import { ScenePresetsPanel } from './scene-presets-panel';
import { StructuralPropertiesPanel } from './structural-properties-panel';
import type { CatalogPlacementGuard } from '../lib/catalog-placement-guard';
import type { CameraPreset, CatalogItem, RoomLayout, Weather } from '../lib/types';
import type { BackendSession } from '@/lib/backend-session';
import './workbench-shelf.css';

interface LibraryProps {
  controller?: BackendSession;
  openTabRequest?: { serial: number; tab: 'materials' | 'presets' };
  onClose?(): void;
  capturePlacement?(): CatalogPlacementGuard;
  onLighting?(value: NonNullable<RoomLayout['backendLighting']>): void;
  onLoadPreset(layout: RoomLayout): void;
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

export function ScendanceLibrary({ placeCatalogItem, onLighting, controller, onLoadPreset, openTabRequest, onClose, capturePlacement }: LibraryProps): JSX.Element {
  const { layout, activeFloor } = useRoomEditor();
  const { selectOnly } = useSelection();
  const [tab, setTab] = useState<'materials' | 'presets'>('materials');
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
    <div className="sc-library-heading">
      <div className="sc-library-tabs" role="tablist" aria-label="工作台面板">
        {([['materials', '物料库'], ['presets', '场景模板']] as const).map(([key, label]) =>
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'is-active' : ''} onClick={() => setTab(key)}>{label}</button>)}
      </div>
      {onClose && <button type="button" className="sc-icon-button" aria-label="关闭物料库" title="关闭物料库" onClick={onClose}><X size={17}/></button>}
    </div>
    <div className="sc-library-content">
      <div className="sc-library-materials" hidden={tab !== 'materials'}>
        <OnlineModelLibrary {...(controller ? { controller } : {})} {...(capturePlacement ? { capturePlacement } : {})} {...(atLimit ? { limitMessage: `已达到 ${editorItemLimit(layout)} 件物料上限，请先删除部分物料。` } : {})} disabled={atLimit} onAdd={addMaterial}/>
      </div>
      {tab === 'presets' && <div className="sc-library-presets">
        <ScenePresetsPanel layout={layout} onApply={onLoadPreset}/>
        <div className="sc-preset-utilities">
          <label className="sc-field">现场灯光<select aria-label="现场灯光" value={layout.backendLighting??'warm'} onChange={event=>onLighting?.(event.target.value as NonNullable<RoomLayout['backendLighting']>)}><option value="neutral">明亮自然</option><option value="warm">温暖聚会</option><option value="cool">冷调展览</option></select></label>
          {layout.backendSceneV2 && <details><summary>已建空间的结构微调</summary><StructuralPropertiesPanel/></details>}
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
  /** Layout mode only: 足迹 / 人群 / 天气 / 时间 (design group 4). */
  showAtmosphere?: boolean;
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
export function ScendanceViewTools({ onApplyPreset, onFit, onZoom, onExportImage, showAtmosphere = true }: ViewToolsProps): JSX.Element {
  const { view, setView, toggle, history } = useRoomEditor();
  const [preset, setPreset] = useState<CameraPreset>('iso');
  const [angleOpen, setAngleOpen] = useState(false);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportView, setExportView] = useState<'current' | CameraPreset>('current');
  const [exportScale, setExportScale] = useState(2);
  const [exporting, setExporting] = useState(false);
  const angleMenuRef = useRef<HTMLDivElement>(null);
  const weatherMenuRef = useRef<HTMLDivElement>(null);
  const timeMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const choosePreset = (next: CameraPreset) => {
    setView(current => ({ ...current, view2D: false, walkthroughMode: false }));
    onApplyPreset(next);
    setPreset(next);
    setAngleOpen(false);
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
    }
  };
  useEffect(() => {
    if (!angleOpen && !weatherOpen && !timeOpen && !exportOpen) return undefined;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (angleOpen && angleMenuRef.current && !angleMenuRef.current.contains(target)) setAngleOpen(false);
      if (weatherOpen && weatherMenuRef.current && !weatherMenuRef.current.contains(target)) setWeatherOpen(false);
      if (timeOpen && timeMenuRef.current && !timeMenuRef.current.contains(target)) setTimeOpen(false);
      if (exportOpen && exportMenuRef.current && !exportMenuRef.current.contains(target)) setExportOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setAngleOpen(false); setWeatherOpen(false); setTimeOpen(false); setExportOpen(false); }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [angleOpen, weatherOpen, timeOpen, exportOpen]);

  return (<>
    <nav id="tool-column" className="sc-view-tools sc-canvas-rail sc-tool-column" aria-label="视角与编辑工具" onWheel={event => event.stopPropagation()}>
      <div className="sc-tool-group" role="group" aria-label="编辑历史与画面">
        <button type="button" id="tool-undo" aria-label="撤销" data-tip="撤销" disabled={!history.canUndo} onClick={history.undo}><Undo2 size={17}/></button>
        <button type="button" id="tool-redo" aria-label="重做" data-tip="重做" disabled={!history.canRedo} onClick={history.redo}><Redo2 size={17}/></button>
        {onExportImage && <div className="sc-tool-menu" ref={exportMenuRef}>
          <button type="button" id="tool-export" aria-label="导出效果图" data-tip="导出效果图" aria-haspopup="dialog" aria-expanded={exportOpen} className={exportOpen ? 'is-active' : ''} onClick={() => { setExportOpen(open => !open); setAngleOpen(false); setWeatherOpen(false); setTimeOpen(false); }}>
            <Camera size={16}/>
          </button>
          {exportOpen && <div className="sc-tool-pop sc-export-pop" role="dialog" aria-label="导出效果图选项">
            <strong className="sc-export-title">导出效果图</strong>
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
            {view.view2D && <small className="sc-export-note">2D 平面按当前分辨率导出</small>}
          </div>}
        </div>}
      </div>
      <span className="sc-tool-sep" aria-hidden="true"/>
      <div className="sc-tool-group" role="group" aria-label="场地视角">
        <div className="sc-tool-menu" ref={angleMenuRef}>
          <button type="button" id="tool-angle" data-tip="视角" aria-label="视角：整体 / 俯视 / 人视" aria-haspopup="listbox" aria-expanded={angleOpen} className={!view.view2D || angleOpen ? 'is-active' : ''} onClick={() => { setAngleOpen(open => !open); setWeatherOpen(false); setTimeOpen(false); }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
            <ChevronDown className="sc-tool-caret" size={8} aria-hidden="true"/>
          </button>
          {angleOpen && <div className="sc-tool-pop" role="listbox" aria-label="视角选项">
            {ANGLE_PRESETS.map(entry => <button type="button" key={entry.id} role="option" aria-label={entry.label} aria-selected={!view.view2D && preset === entry.id} className={!view.view2D && preset === entry.id ? 'is-active' : ''} onClick={() => choosePreset(entry.id)}>{entry.label}</button>)}
          </div>}
        </div>
        <button type="button" id="tool-2d3d" data-tip="平面 / 立体" aria-label="2D / 3D" aria-pressed={view.view2D} className={view.view2D ? 'is-active' : ''} onClick={() => { if (view.walkthroughMode) setView(current => ({ ...current, walkthroughMode: false })); toggle('view2D'); }}>
          <span className="sc-rail-2d">{view.view2D ? '2D' : '3D'}</span>
        </button>
      </div>
      <span className="sc-tool-sep" aria-hidden="true"/>
      <div className="sc-tool-group" role="group" aria-label="场地辅助">
        <button type="button" id="tool-grid" data-tip="对齐网格" aria-label="网格吸附" aria-pressed={view.snapToGrid} className={view.snapToGrid ? 'is-active' : ''} onClick={() => toggle('snapToGrid')}><Grid size={16}/></button>
        <button type="button" id="tool-dims" data-tip="标注尺寸" aria-label="显示尺寸" aria-pressed={view.showMeasurements} className={view.showMeasurements ? 'is-active' : ''} onClick={() => toggle('showMeasurements')}><Ruler size={16}/></button>
        <button type="button" id="tool-fullscreen" data-tip="看全场" aria-label="全屏" onClick={onFit} disabled={view.view2D}><Maximize2 size={16}/></button>
        <button type="button" id="tool-zoom-out" data-tip="看更大范围" aria-label="缩小" onClick={() => onZoom('-')} disabled={view.view2D}><Minus size={16}/></button>
        <button type="button" id="tool-zoom-in" data-tip="拉近看细节" aria-label="放大" onClick={() => onZoom('+')} disabled={view.view2D}><Plus size={16}/></button>
      </div>
    </nav>
    {showAtmosphere && <div className="sc-atmosphere-strip">
        <div className="sc-tool-group sc-atmosphere-group" role="group" aria-label="氛围">
          <button type="button" id="tool-walk" title="按走动的足迹漫游场地" aria-pressed={view.walkthroughMode} className={view.walkthroughMode ? 'is-active' : ''} onClick={() => setWalkthrough(!view.walkthroughMode)}><Footprints size={14}/><span>漫游</span></button>
          <button type="button" id="tool-crowd" title="场地里的人数示意" aria-pressed={view.showNpcs} className={view.showNpcs ? 'is-active' : ''} disabled={view.view2D} onClick={() => toggle('showNpcs')}><Users size={14}/><span>人群</span></button>
          <div className="sc-tool-menu" ref={weatherMenuRef}>
            <button type="button" id="tool-weather" title="室外天气" aria-expanded={weatherOpen} className={view.weather !== 'clear' || weatherOpen ? 'is-active' : ''} onClick={() => { setWeatherOpen(open => !open); setAngleOpen(false); setTimeOpen(false); }}>
              {view.weather === 'clear' ? <Sun size={14}/> : <CloudRain size={14}/>}
              <span>{WEATHER_OPTIONS.find(option => option.id === view.weather)?.label ?? '天气'}</span>
              <ChevronDown className="sc-tool-caret" size={9} aria-hidden="true"/>
            </button>
            {weatherOpen && <div className="sc-tool-pop" role="listbox" aria-label="室外天气选项">
              {WEATHER_OPTIONS.map(option => <button type="button" key={option.id} role="option" aria-selected={view.weather === option.id} className={view.weather === option.id ? 'is-active' : ''} onClick={() => { setView(current => ({ ...current, weather: option.id })); setWeatherOpen(false); }}>{option.label}</button>)}
            </div>}
          </div>
          <div className="sc-tool-menu" ref={timeMenuRef}>
            <button type="button" id="tool-time" title="一天中的时段" aria-expanded={timeOpen} className={timeOpen ? 'is-active' : ''} onClick={() => { setTimeOpen(open => !open); setAngleOpen(false); setWeatherOpen(false); }}>
              <Sun size={14}/>
              <span>{activeTime?.title ?? '时段'}</span>
              <ChevronDown className="sc-tool-caret" size={9} aria-hidden="true"/>
            </button>
            {timeOpen && <div className="sc-tool-pop" role="listbox" aria-label="室外时段选项">
              {TIME_PRESETS.map(entry => <button type="button" key={entry.label} role="option" aria-label={`室外时段 ${entry.title}`} aria-selected={activeTime?.label === entry.label} className={activeTime?.label === entry.label ? 'is-active' : ''} onClick={() => { setView(current => ({ ...current, timeOfDay: entry.hour })); setTimeOpen(false); }}>{entry.title}</button>)}
            </div>}
          </div>
        </div>
      </div>}
    </>
  );
}

/** Design: bottom-center 「物料库 ▴」 drawer handle. */
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
        <Boxes size={14} aria-hidden="true"/>
        <span>物料库</span>
        <ChevronDown size={14} aria-hidden="true" style={{ transform: open ? 'rotate(0deg)' : 'rotate(180deg)' }}/>
      </button>
    </div>
  );
}
