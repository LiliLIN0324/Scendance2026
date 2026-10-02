'use client';

import { ImagePlus, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../hooks/use-dialog-focus';
import './venue-photos-panel.css';

export interface VenuePhoto { id: string; name: string; url: string }
interface Props {
  images: readonly VenuePhoto[];
  addImages(files: FileList | null): Promise<void>;
  removeImage(id: string): void;
}

export function VenuePhotosPanel({ images, addImages, removeImage }: Props): JSX.Element {
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

  return <section ref={panel} className="vp-photos" aria-label="现场照片">
    <div className="cr-label">现场照片 <span>最多 3 张 · 每张 5 MB</span></div>
    <input type="file" ref={input} hidden accept="image/png,image/jpeg,image/webp" multiple onChange={event => { void addImages(event.target.files); event.target.value = ''; }}/>
    <button className="cr-upload" type="button" onClick={() => input.current?.click()} disabled={images.length >= 3}>
      <ImagePlus size={23}/><strong>{images.length >= 3 ? '已添加 3 张现场照片' : '上传现场照片'}</strong><span>PNG / JPG / WebP</span>
    </button>
    {images.length > 0 && <div className="vp-thumbnails">{images.map(image => <figure key={image.id}>
      <button type="button" className="vp-thumbnail" aria-label={`放大 ${image.name}`} onClick={() => setExpandedId(image.id)}>
        {/* Blob URLs are decoded locally and cannot use Next's remote image optimization. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.url} alt={`现场照片：${image.name}`}/>
      </button>
      <button className="vp-remove" type="button" aria-label={`移除 ${image.name}`} onClick={() => removeImage(image.id)}><X size={13}/></button>
      <figcaption title={image.name}>{image.name}</figcaption>
    </figure>)}</div>}
    <p className="cr-hint">选填。记录门窗、柱子与固定设施。目前仅本机预览，尚不识别场地；尺寸请在“场地”中填写，刷新后需重选照片。</p>
    {expanded && portalRoot && createPortal(<div className="vp-lightbox" onPointerDown={event => { if (event.target === event.currentTarget) setExpandedId(null); }}>
      <div ref={dialog} className="vp-dialog" role="dialog" aria-modal="true" aria-label={`现场照片预览：${expanded.name}`} tabIndex={-1}>
        <header><strong>{expanded.name}</strong><button ref={close} type="button" aria-label="关闭照片预览" onClick={() => setExpandedId(null)}><X size={20}/></button></header>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={expanded.url} alt={`放大现场照片：${expanded.name}`}/>
        <p>仅在本机查看 · 图片尚未提交给模型</p>
      </div>
    </div>, portalRoot)}
  </section>;
}
