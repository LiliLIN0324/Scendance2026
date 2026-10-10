'use client';

import { Image as ImageIcon } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { DEFAULT_FLOOR_PLAN_OPACITY } from '../lib/constants';
import { readImageAsDataUrl } from '../lib/file-io';
import type { RoomLayout, ViewSettings } from '../lib/types';
import './reference-image-controls.css';

interface Props {
  layout: RoomLayout; view: ViewSettings; ready: boolean; notice: string;
  onShow(value: boolean): void; onOpacity(value: number): void; onLegacyUpload(value: string): void;
  onReview(): void; onReload(): void; reviewButtonRef?: RefObject<HTMLButtonElement>;
}

export function ReferenceImageControls({ layout, view, ready, notice, onShow, onOpacity, onLegacyUpload, onReview, onReload, reviewButtonRef }: Props): JSX.Element {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const live = useRef(layout); live.current = layout;
  const operation = useRef(0), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; operation.current++; }; }, []);
  useEffect(() => { operation.current++; setBusy(false); setError(''); }, [layout.id]);
  const v2 = !!layout.backendSceneV2;
  const available = v2 ? ready : !!layout.floorPlanImage;
  const opacity = view.referenceImageOpacity ?? layout.floorPlanOpacity ?? DEFAULT_FLOOR_PLAN_OPACITY;
  async function upload(file: File): Promise<void> {
    const base = layout, token = ++operation.current;
    setError(''); setBusy(true);
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('请选择10MB以内的PNG、JPG或WebP平面图。');
      const url = await readImageAsDataUrl(file);
      await new Promise<void>((resolve, reject) => { const image = new Image(); image.onload = () => image.naturalWidth > 0 && image.naturalHeight > 0 ? resolve() : reject(new Error('图片无法读取。')); image.onerror = () => reject(new Error('图片无法读取，请重新选择有效的平面图。')); image.src = url; });
      if (!alive.current || token !== operation.current) return;
      if (live.current !== base) throw new Error('读取期间场景已变化，旧图保持原样，请重新选择。');
      onLegacyUpload(url); onShow(true);
    } catch (caught) { if (alive.current && token === operation.current) setError(caught instanceof Error ? caught.message : '图片读取失败，旧图保持原样。'); }
    finally { if (alive.current && token === operation.current) setBusy(false); }
  }
  return <details className="sc-reference-image"><summary><ImageIcon size={15}/>参考底图</summary><div className="sc-reference-image-body">
    <strong>{v2 ? '图纸与当前设计对应' : '示意底图'}</strong>
    <p>{notice}</p>
    {!v2 && <label className="sc-reference-upload">{busy ? '正在读取图片…' : layout.floorPlanImage ? '更换示意平面图' : '上传示意平面图'}<input aria-label="上传示意平面图" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }}/></label>}
    <label className="sc-reference-check"><input type="checkbox" aria-label="显示参考底图" checked={view.showReferenceImage !== false} disabled={!available || busy} onChange={event => onShow(event.target.checked)}/>显示参考底图</label>
    <label>底图透明度 {Math.round(opacity * 100)}%<input aria-label="底图透明度" type="range" min="0" max="1" step="0.05" value={opacity} disabled={!available || busy} onChange={event => onOpacity(Number(event.target.value))}/></label>
    {v2 ? <button ref={reviewButtonRef} type="button" onClick={onReview}>选择图纸并核对对应</button> : <p>旧图按场地宽深示意放置，不代表已标定或实测准确。</p>}
    {v2 && <button type="button" className="sc-reference-reload" onClick={onReload}>重新读取本机资料</button>}
    <small>隐藏只改变显示，保留图片和对应记录。换设备时，请在活动备份中勾选“包含图纸、照片与对应点”。</small>
    {error && <p role="alert">{error}</p>}
  </div></details>;
}
