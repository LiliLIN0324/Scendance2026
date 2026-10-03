'use client';

import { Copy, Lock, RotateCcw, Trash2, Unlock, X } from 'lucide-react';
import { useState } from 'react';
import { useRoomEditor, useSelection } from '../contexts';
import { onlineModelThumb } from '../lib/online-models';
import { editorItemLimit } from '../lib/scene-presets';
import { MaterialGlyph, NumberField } from './scendance-workspace';
import type { FurnitureItem } from '../lib/types';

export interface ItemContextPopoverProps {
  hasCollision: boolean;
  onRemove(id: string): void;
  onDuplicate(id: string): void;
  onRotate(id: string): void;
  onToggleCameraBracket(id: string): void;
  onClose(): void;
}

const COLORS = ['#375B4B', '#78958B', '#B5C3B2', '#C9B89D', '#DDD9CA', '#EDEAE1', '#B98067', '#404748'];

/**
 * Keep the public-library origin for both older CDN drafts and registered assets.
 */
export function catalogItemOrigin(item: Pick<FurnitureItem, 'source' | 'glbUrl' | 'assetId' | 'glbNode'>): string {
  if (item.glbNode) return '场景预设物件';
  if (item.source === 'public_library') return '云端模型资产';
  if (item.glbUrl) return item.assetId ? '云端模型资产' : '本地 GLB 验证样例';
  return '内置活动物料';
}

/**
 * The summary picture. An online model has a real render on the CDN; a vector glyph is
 * only a stand-in, and for a white-coloured model it was nearly invisible on the light
 * panel. Falls back to the glyph when there is no catalogue thumbnail or it fails.
 */
function SelectedPreview({ item }: { item: FurnitureItem }): JSX.Element {
  const [failed, setFailed] = useState(false);
  const thumb = item.source === 'public_library' ? onlineModelThumb(item.glbUrl, item.assetId) : '';
  if (!thumb || failed) return <MaterialGlyph materialId={item.materialId} color={item.color}/>;
  // A catalogue thumbnail straight from the CDN; next/image cannot optimise a remote URL here.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="sc-selected-thumb" src={thumb} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)}/>;
}

export function ItemContextPopover(props: ItemContextPopoverProps): JSX.Element {
  const { layout, actions, pushColor, activeFloor } = useRoomEditor();
  const { selectedItem: item } = useSelection();
  if (!item) return <></>;
  const locked = item.locked === true;
  const position = item.position ?? { x: 0, z: 0 };
  const rotation = ((item.rotation ?? 0) * 180 / Math.PI % 360 + 360) % 360;
  return <aside className="sc-properties" aria-label={`${item.name}属性`}>
    <header><div><span className="sc-eyebrow">OBJECT PROPERTIES</span><h2>物料属性</h2></div><button type="button" className="sc-icon-button" onClick={props.onClose} aria-label="关闭物料属性"><X size={17}/></button></header>
    <div className="sc-properties-content">
      <div className="sc-selected-summary"><div><SelectedPreview item={item}/></div><strong>{item.name}</strong><span>{catalogItemOrigin(item)}</span></div>
      <button type="button" className={`sc-lock-button ${locked ? 'is-locked' : ''}`} aria-pressed={locked} onClick={() => actions.setLocked(item.id, !locked)}>{locked ? <Lock size={15}/> : <Unlock size={15}/>}<span>{locked ? '已锁定 · 点击解锁' : '允许编辑 · 点击锁定'}</span></button>
      {props.hasCollision && <p className="sc-warning">物料可能重叠或超出场地，请检查位置。</p>}
      <section><h3>位置与角度</h3><div className="sc-dimension-grid">
        <NumberField label="X / m" value={position.x} min={-100} max={100} disabled={locked} onChange={value => actions.moveItem(item.id, value, position.z)}/>
        <NumberField label="Y / m" value={item.elevation ?? 0} min={item.glbNode ? -100 : 0} max={item.glbNode ? 100 : 30} disabled={locked || !!item.venueEntranceId || !!item.structuralOpeningId || !!item.structuralColumnId} onChange={value => actions.updateItem(item.id, { elevation: value })}/>
        <NumberField label="Z / m" value={position.z} min={-100} max={100} disabled={locked} onChange={value => actions.moveItem(item.id, position.x, value)}/>
      </div><div className="sc-property-actions">
        <NumberField label="旋转 / °" value={rotation} min={0} max={360} step={15} disabled={locked} onChange={value => actions.setRotation(item.id, value * Math.PI / 180)}/>
        <button type="button" className="sc-button" disabled={locked} onClick={() => props.onRotate(item.id)}><RotateCcw size={15}/>旋转 90°</button>
      </div></section>
      {item.glbUrl
        ? <p className="sc-note">该模型保留自身材质，暂不支持改色。</p>
        : <section><h3>物料颜色 <input type="color" aria-label="物料颜色" value={item.color} disabled={locked} onChange={event => { actions.setColor(item.id, event.target.value); pushColor(event.target.value); }}/></h3><div className="sc-color-swatches">{COLORS.map(color => <button type="button" key={color} style={{ background: color }} aria-label={`颜色 ${color}`} aria-pressed={item.color.toUpperCase() === color} disabled={locked} onClick={() => { actions.setColor(item.id, color); pushColor(color); }}/>)}</div></section>}
      <section><h3>物料备注</h3><textarea className="sc-notes" aria-label="物料备注" placeholder="例如：预留电源 / 实物待确认" maxLength={500} disabled={locked} value={item.notes ?? ''} onChange={event => actions.updateItem(item.id, { notes: event.target.value })}/></section>
      <div className="sc-property-actions"><button type="button" className="sc-button" disabled={activeFloor.items.length >= editorItemLimit(layout)} onClick={() => props.onDuplicate(item.id)}><Copy size={15}/>复制</button></div>
      <button type="button" className="sc-delete-button" disabled={locked} onClick={() => props.onRemove(item.id)}><Trash2 size={15}/>删除物料</button>
    </div>
  </aside>;
}
