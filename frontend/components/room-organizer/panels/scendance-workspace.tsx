'use client';

import { Grid, Layers, Maximize2, Minus, MousePointer2, Plus, Redo2, Undo2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useRoomEditor, useSelection } from '../contexts';
import { OnlineModelLibrary } from './online-model-library';
import type { CameraPreset, CatalogItem, RoomLayout } from '../lib/types';

interface LibraryProps {
  onLighting?(value: NonNullable<RoomLayout['backendLighting']>): void;
  creativePanel?: ReactNode;
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

export function ScendanceLibrary({ placeCatalogItem, creativePanel, onLighting }: LibraryProps): JSX.Element {
  const { layout, activeFloor, actions } = useRoomEditor();
  const { selectOnly } = useSelection();
  const [tab, setTab] = useState<'materials' | 'venue' | 'list'>('materials');
  const atLimit = activeFloor.items.length >= 50;

  const addMaterial = (item: CatalogItem) => {
    if (atLimit) return;
    const id = placeCatalogItem(item);
    if (id) selectOnly(id);
  };

  return <aside className="sc-library" aria-label="场地工具">
    <div className="sc-library-tabs" role="tablist" aria-label="工作台面板">
      {([['materials', '物料库'], ['venue', '场地'], ['list', '清单']] as const).map(([key, label]) =>
        <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'is-active' : ''} onClick={() => setTab(key)}>{label}</button>)}
    </div>
    <div key={tab} className="sc-library-content">
      {tab === 'materials' && <>
        {creativePanel}
        <div className="sc-section-heading"><div><h2>把想法放进场地</h2><p>点击下载并放入场地</p></div></div>
        {atLimit && <p className="sc-warning">已达到 50 件演示物料上限，请先删除部分物料。</p>}
        <OnlineModelLibrary disabled={atLimit} onAdd={addMaterial}/>
      </>}
      {tab === 'venue' && <>
        <div className="sc-section-heading"><div><h2>场地设置</h2><p>单层矩形 · 统一使用米制</p></div><Grid size={19}/></div>
        <label className="sc-field">项目名称<input value={layout.name} maxLength={80} onChange={event => actions.setName(event.target.value)} aria-label="项目名称"/></label>
        <div className="sc-dimension-grid">
          <NumberField label="宽度 / m" value={layout.width} min={2} max={100} onChange={actions.setWidth}/>
          <NumberField label="进深 / m" value={layout.height} min={2} max={100} onChange={actions.setHeight}/>
          <NumberField label="净高 / m" value={activeFloor.height ?? 3} min={2} max={10} onChange={actions.setStoreyHeight}/>
        </div>
        <div className="sc-area-card"><span>场地面积</span><strong>{(layout.width * layout.height).toFixed(1)} <small>m²</small></strong></div>
        <label className="sc-field sc-color-field">地面颜色<input type="color" aria-label="地面颜色" value={activeFloor.floorColor} onChange={event => actions.setFloorColor(event.target.value)}/></label>
        <label className="sc-field">灯光氛围<select aria-label="灯光氛围" value={layout.backendLighting??'warm'} onChange={event=>onLighting?.(event.target.value as NonNullable<RoomLayout['backendLighting']>)}><option value="neutral">明亮自然</option><option value="warm">温暖聚会</option><option value="cool">冷调展览</option></select></label>
        <p className="sc-note">实时作用于三维场景；随场景本地保存，连接云项目后使用现有 lighting 字段保存。</p>
        <p className="sc-note">当前版本提供矩形场地编辑。平面图标定与多边形编辑尚未接入。</p>
      </>}
      {tab === 'list' && <>
        <div className="sc-section-heading"><div><h2>场景物料</h2><p>选中一项，继续调整位置和规格</p></div><span className="sc-count">{activeFloor.items.length} 件</span></div>
        <div className="sc-object-list">{activeFloor.items.map(item => <button type="button" key={item.id} onClick={() => selectOnly(item.id)}><span className="sc-object-dot" style={{ background: item.color }}/><span><strong>{item.name}</strong><small>{item.width} × {item.depth} × {item.height} m</small></span><span>{item.locked ? '已锁定' : '可编辑'}</span></button>)}</div>
        {activeFloor.items.length === 0 && <p className="sc-note">场地还是空的，从物料库添加第一件物料吧。</p>}
      </>}
    </div>
  </aside>;
}

export function NumberField({ label, value, min = 0.01, max = 50, step = 0.1, disabled = false, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; disabled?: boolean; onChange(value: number): void }): JSX.Element {
  return <label className="sc-field">{label}<input type="number" aria-label={label} min={min} max={max} step={step} value={Math.round(value * 1000) / 1000} disabled={disabled} onChange={event => { const next = event.target.valueAsNumber; if (Number.isFinite(next) && next >= min && next <= max) onChange(next); }}/></label>;
}

interface ViewToolsProps {
  onApplyPreset(preset: CameraPreset): void;
  onFit(): void;
  onZoom(direction: '+' | '-'): void;
}

export function ScendanceViewTools({ onApplyPreset, onFit, onZoom }: ViewToolsProps): JSX.Element {
  const { view, setView, toggle, history } = useRoomEditor();
  const [preset, setPreset] = useState<CameraPreset>('iso');
  const choosePreset = (next: CameraPreset) => { setView(current => ({ ...current, view2D: false })); onApplyPreset(next); setPreset(next); };
  return <div className="sc-view-tools" aria-label="视角与编辑工具">
    <div className="sc-tool-group"><button type="button" title="撤销 Ctrl / ⌘ Z" aria-label="撤销" disabled={!history.canUndo} onClick={history.undo}><Undo2 size={17}/></button><button type="button" title="重做 Ctrl / ⌘ Shift Z" aria-label="重做" disabled={!history.canRedo} onClick={history.redo}><Redo2 size={17}/></button></div>
    <div className="sc-tool-group sc-view-tabs"><button type="button" className={!view.view2D && preset === 'iso' ? 'is-active' : ''} onClick={() => choosePreset('iso')}><Layers size={15}/>整体</button><button type="button" className={!view.view2D && preset === 'top' ? 'is-active' : ''} onClick={() => choosePreset('top')}>俯视</button><button type="button" className={!view.view2D && preset === 'front' ? 'is-active' : ''} onClick={() => choosePreset('front')}>客户视角</button><button type="button" className={view.view2D ? 'is-active' : ''} onClick={() => toggle('view2D')}>2D</button></div>
    <div className="sc-tool-group"><button type="button" title="缩小" aria-label="缩小" onClick={() => onZoom('-')} disabled={view.view2D}><Minus size={16}/></button><button type="button" title="适应场地" aria-label="适应场地" onClick={onFit} disabled={view.view2D}><Maximize2 size={16}/></button><button type="button" title="放大" aria-label="放大" onClick={() => onZoom('+')} disabled={view.view2D}><Plus size={16}/></button></div>
    <div className="sc-tool-group"><button type="button" title="网格吸附" aria-label="网格吸附" aria-pressed={view.snapToGrid} className={view.snapToGrid ? 'is-active' : ''} onClick={() => toggle('snapToGrid')}><Grid size={16}/></button><button type="button" title="显示尺寸" aria-label="显示尺寸" aria-pressed={view.showMeasurements} className={view.showMeasurements ? 'is-active' : ''} onClick={() => toggle('showMeasurements')}><MousePointer2 size={16}/></button></div>
  </div>;
}
