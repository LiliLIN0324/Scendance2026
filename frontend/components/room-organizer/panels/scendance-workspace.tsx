'use client';

import { Boxes, Camera, Grid, Layers, Maximize2, Minus, MousePointer2, Plus, Redo2, Undo2, X } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useRoomEditor, useSelection } from '../contexts';
import { editorItemLimit } from '../lib/scene-presets';
import { materialCount } from '../lib/structural-layout';
import { OnlineModelLibrary } from './online-model-library';
import { SceneLayersPanel } from './scene-layers-panel';
import { ScenePresetsPanel } from './scene-presets-panel';
import { StructuralPropertiesPanel } from './structural-properties-panel';
import type { CatalogPlacementGuard } from '../lib/catalog-placement-guard';
import type { CameraPreset, CatalogItem, RoomLayout } from '../lib/types';
import type { BackendSession } from '@/lib/backend-session';

interface LibraryProps {
  controller?: BackendSession;
  openTabRequest?: { serial: number; tab: 'materials' | 'presets' | 'layers' };
  onClose?(): void;
  capturePlacement?(): CatalogPlacementGuard;
  onLighting?(value: NonNullable<RoomLayout['backendLighting']>): void;
  onPreviewMovement?(layout: RoomLayout | null): void;
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

export function ScendanceLibrary({ placeCatalogItem, onLighting, controller, onLoadPreset, onPreviewMovement, openTabRequest, onClose, capturePlacement }: LibraryProps): JSX.Element {
  const { layout, activeFloor } = useRoomEditor();
  const { selectOnly } = useSelection();
  const [tab, setTab] = useState<'materials' | 'presets' | 'layers'>('materials');
  const handledOpenRequest = useRef<number | null>(null);
  const atLimit = materialCount(activeFloor.items) >= editorItemLimit(layout);

  useEffect(() => {
    if (!openTabRequest || openTabRequest.serial === handledOpenRequest.current) return;
    handledOpenRequest.current = openTabRequest.serial;
    setTab(openTabRequest.tab);
  }, [openTabRequest]);

  const addMaterial = (item: CatalogItem) => {
    if (atLimit) return;
    const id = placeCatalogItem(item);
    if (id) selectOnly(id);
  };

  return <aside className="sc-library" aria-label="场地工具">
    <div className="sc-library-heading">
      <div className="sc-library-tabs" role="tablist" aria-label="工作台面板">
        {([['materials', '物料库'], ['presets', '场景模板'], ['layers', '图层']] as const).map(([key, label]) =>
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'is-active' : ''} onClick={() => setTab(key)}>{label}</button>)}
      </div>
      {onClose && <button type="button" className="sc-icon-button" aria-label="关闭素材架" title="关闭素材架" onClick={onClose}><X size={17}/></button>}
    </div>
    <div className="sc-library-content">
      <div className="sc-library-materials" hidden={tab !== 'materials'}>
        {atLimit && <p className="sc-warning">已达到 {editorItemLimit(layout)} 件物料上限，请先删除部分物料。</p>}
        <OnlineModelLibrary {...(controller ? { controller } : {})} {...(capturePlacement ? { capturePlacement } : {})} disabled={atLimit} onAdd={addMaterial}/>
      </div>
      {tab === 'layers' && <SceneLayersPanel {...(controller ? { controller } : {})} {...(onPreviewMovement ? { onPreview: onPreviewMovement } : {})}/>}
      {tab === 'presets' && <>
        <ScenePresetsPanel layout={layout} onApply={onLoadPreset}/>
        <label className="sc-field">灯光氛围<select aria-label="灯光氛围" value={layout.backendLighting??'warm'} onChange={event=>onLighting?.(event.target.value as NonNullable<RoomLayout['backendLighting']>)}><option value="neutral">明亮自然</option><option value="warm">温暖聚会</option><option value="cool">冷调展览</option></select></label>
        {layout.backendSceneV2 && <details><summary>已建空间的结构微调</summary><StructuralPropertiesPanel/></details>}
      </>}
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
  onApplyPreset(preset: CameraPreset): void;
  onFit(): void;
  onZoom(direction: '+' | '-'): void;
  onScreenshot?(): void;
}

export function ScendanceViewTools({ onApplyPreset, onFit, onZoom, onScreenshot, materialsOpen = false, onToggleMaterials, materialsButtonRef }: ViewToolsProps): JSX.Element {
  const { view, setView, toggle, history } = useRoomEditor();
  const [preset, setPreset] = useState<CameraPreset>('iso');
  const choosePreset = (next: CameraPreset) => { setView(current => ({ ...current, view2D: false })); onApplyPreset(next); setPreset(next); };
  return <div className="sc-view-tools" aria-label="视角与编辑工具">
    {onToggleMaterials && <div className="sc-tool-group"><button type="button" ref={materialsButtonRef} title={materialsOpen ? '收起素材架' : '打开素材架'} aria-label={materialsOpen ? '收起素材架' : '打开素材架'} aria-expanded={materialsOpen} aria-controls="workbench-material-shelf" className={materialsOpen ? 'is-active' : ''} onClick={onToggleMaterials}><Boxes size={16}/><span>素材</span></button></div>}
    <div className="sc-tool-group"><button type="button" title="撤销 Ctrl / ⌘ Z" aria-label="撤销" disabled={!history.canUndo} onClick={history.undo}><Undo2 size={17}/></button><button type="button" title="重做 Ctrl / ⌘ Shift Z" aria-label="重做" disabled={!history.canRedo} onClick={history.redo}><Redo2 size={17}/></button>{onScreenshot&&<button type="button" title="导出当前画面" aria-label="导出当前画面" onClick={onScreenshot}><Camera size={16}/><span>画面</span></button>}</div>
    <div className="sc-tool-group sc-view-tabs"><button type="button" className={!view.view2D && preset === 'iso' ? 'is-active' : ''} onClick={() => choosePreset('iso')}><Layers size={15}/>整体</button><button type="button" className={!view.view2D && preset === 'top' ? 'is-active' : ''} onClick={() => choosePreset('top')}>俯视</button><button type="button" className={!view.view2D && preset === 'front' ? 'is-active' : ''} onClick={() => choosePreset('front')}>客户视角</button><button type="button" className={view.view2D ? 'is-active' : ''} onClick={() => toggle('view2D')}>2D</button></div>
    <div className="sc-tool-group"><button type="button" title="缩小" aria-label="缩小" onClick={() => onZoom('-')} disabled={view.view2D}><Minus size={16}/></button><button type="button" title="适应场地" aria-label="适应场地" onClick={onFit} disabled={view.view2D}><Maximize2 size={16}/></button><button type="button" title="放大" aria-label="放大" onClick={() => onZoom('+')} disabled={view.view2D}><Plus size={16}/></button></div>
    <div className="sc-tool-group"><button type="button" title="网格吸附" aria-label="网格吸附" aria-pressed={view.snapToGrid} className={view.snapToGrid ? 'is-active' : ''} onClick={() => toggle('snapToGrid')}><Grid size={16}/></button><button type="button" title="显示尺寸" aria-label="显示尺寸" aria-pressed={view.showMeasurements} className={view.showMeasurements ? 'is-active' : ''} onClick={() => toggle('showMeasurements')}><MousePointer2 size={16}/></button></div>
  </div>;
}
