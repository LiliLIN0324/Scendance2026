'use client';

import { ImagePlus, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../hooks/use-dialog-focus';
import './venue-photos-panel.css';
import type { SourceKind } from '@/lib/source-storage';

export interface VenuePhoto { id: string; name: string; url: string; kind?: SourceKind; width?:number; height?:number; blob?:Blob; assetId?:string; uploadedKind?:SourceKind }
interface Props {
  images: readonly VenuePhoto[];
  addImages(files: FileList | null): Promise<void>;
  removeImage(id: string): void;
  onKindChange?(id:string,kind:SourceKind):void;
}

export function VenuePhotosPanel({ images, addImages, removeImage, onKindChange }: Props): JSX.Element {
  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expanded = images.find(image => image.id === expandedId) ?? null;
  // The material drawer uses backdrop-filter/transform and clips overflow.
  // Render above that drawer while retaining the editor's hidden ancestor
  // when the user returns to the introduction.
  const portalRoot = panel.current?.closest('.sc-workbench') ?? panel.current?.parentElement;
  useDialogFocus(!!expanded, dialog, { initialFocusRef: close, trap: true, onEscape: () => setExpandedId(null) });

  return <section ref={panel} className="vp-photos" aria-label="图纸与现场照片">
    <div className="cr-label">图纸与现场照片 <span>最多 12 张 · 每张 5 MB</span></div>
    <input type="file" ref={input} hidden accept="image/png,image/jpeg,image/webp" multiple onChange={event => { void addImages(event.target.files); event.target.value = ''; }}/>
    <button className="cr-upload" type="button" onClick={() => input.current?.click()} disabled={images.length >= 12}>
      <ImagePlus size={23}/><strong>{images.length >= 12 ? '已添加 12 张资料' : '上传图纸或现场照片'}</strong><span>PNG / JPG / WebP</span>
    </button>
    {images.length > 0 && <div className="vp-thumbnails">{images.map(image => <figure key={image.id}>
      <button type="button" className="vp-thumbnail" aria-label={`放大 ${image.name}`} onClick={() => setExpandedId(image.id)}>
        {/* Blob URLs are decoded locally and cannot use Next's remote image optimization. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.url} alt={`${image.kind==='floorplan'?'平面图':'现场照片'}：${image.name}`}/>
      </button>
      <button className="vp-remove" type="button" aria-label={`移除 ${image.name}`} onClick={() => removeImage(image.id)}><X size={13}/></button>
      <figcaption title={image.name}>{image.name}</figcaption>{onKindChange&&<select aria-label={`${image.name} 的资料类型`} value={image.kind??'photo'} onChange={event=>onKindChange(image.id,event.target.value as SourceKind)}><option value="floorplan">平面图</option><option value="photo">现场照片</option></select>}
    </figure>)}</div>}
    <p className="cr-hint">自动建议资料类型，可逐张纠正。图片保存在本机；连接项目并生成时会上传至私有存储，用于识别。每张最长边 4096 像素。</p>
    {expanded && portalRoot && createPortal(<div className="vp-lightbox" onPointerDown={event => { if (event.target === event.currentTarget) setExpandedId(null); }}>
      <div ref={dialog} className="vp-dialog" role="dialog" aria-modal="true" aria-label={`${expanded.kind==='floorplan'?'平面图':'现场照片'}预览：${expanded.name}`} tabIndex={-1}>
        <header><strong>{expanded.name}</strong><button ref={close} type="button" aria-label="关闭照片预览" onClick={() => setExpandedId(null)}><X size={20}/></button></header>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={expanded.url} alt={`放大${expanded.kind==='floorplan'?'平面图':'现场照片'}：${expanded.name}`}/>
        <p>{expanded.assetId?'已上传项目私有存储':'本机资料 · 生成时提交模型'}</p>
      </div>
    </div>, portalRoot)}
  </section>;
}
