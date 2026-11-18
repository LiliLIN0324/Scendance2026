'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ArrowRight } from '@/components/solid-icons';
import { ConcreteFoldingChair, ConcreteWayfindingSign } from './creation-previews';

/**
 * 左轨「创作」打开后的同一页：三张冷石卡片。
 * 第一张只做入口和本地预览，不提交场地重建。
 * 「开始创作」交给已有的文生 / 图生窗口，参考图也只在那个窗口里选。
 */

const VENUE_MEDIA_EXT = /\.(jpe?g|png|webp|mp4|m4v|mov|qt|insv)$/i;

/** 照片和视频同一个口。insv 能收，界面上不出现任何品牌名。 */
export const VENUE_MEDIA_ACCEPT = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.mp4',
  '.m4v',
  '.mov',
  '.qt',
  '.insv',
].join(',');

export function isVenueMediaFile(file: File): boolean {
  if (VENUE_MEDIA_EXT.test(file.name)) return true;
  const type = file.type.toLowerCase();
  return type === 'image/jpeg' || type === 'image/jpg' || type === 'image/pjpeg'
    || type === 'image/png' || type === 'image/webp'
    || type === 'video/mp4' || type === 'video/quicktime' || type === 'video/x-m4v';
}

type VenueMediaKind = 'image' | 'video' | 'file';

interface VenuePreview {
  id: string;
  name: string;
  kind: VenueMediaKind;
  url: string;
}

function venueMediaKind(file: File): VenueMediaKind {
  const name = file.name.toLowerCase();
  if (name.endsWith('.insv')) return 'file';
  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(name)) return 'image';
  if (file.type.startsWith('video/') || /\.(mp4|m4v|mov|qt)$/i.test(name)) return 'video';
  return 'file';
}

function previewUrl(file: File, kind: VenueMediaKind): string {
  if (kind === 'file' || typeof URL.createObjectURL !== 'function') return '';
  return URL.createObjectURL(file);
}

function CameraMark(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <path d="M2.2 4.5h1.6l.7-1.2h4.9l.7 1.2h1.7a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H2.2a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="7" cy="7.7" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ImageMark(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <rect x="1.6" y="2.3" width="10.8" height="9.4" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.1 9.4 5.5 7l1.7 1.6L9.3 6.4 11 8.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function CreationEntry({ onStartText, onStartImage }: {
  onStartText: () => void;
  onStartImage: () => void;
}): JSX.Element {
  const itemsRef = useRef<VenuePreview[]>([]);
  const [items, setItems] = useState<VenuePreview[]>([]);
  const [notice, setNotice] = useState('');
  const [broken, setBroken] = useState(false);
  const hero = items[items.length - 1] ?? null;

  useEffect(() => () => {
    for (const item of itemsRef.current) {
      if (item.url) URL.revokeObjectURL(item.url);
    }
  }, []);

  useEffect(() => { setBroken(false); }, [hero?.url, hero?.id]);

  const adopt = (list: FileList | null): void => {
    const picked = list ? Array.from(list) : [];
    if (!picked.length) return;
    const accepted = picked.filter(isVenueMediaFile);
    for (const item of itemsRef.current) {
      if (item.url) URL.revokeObjectURL(item.url);
    }
    const next = accepted.map((file, index) => {
      const kind = venueMediaKind(file);
      return { id: `${index}-${file.name}-${file.size}-${file.lastModified}`, name: file.name, kind, url: previewUrl(file, kind) };
    });
    itemsRef.current = next;
    setItems(next);
    const rejected = picked.length - accepted.length;
    if (rejected && accepted.length) setNotice('有的文件不是照片或视频，已跳过。');
    else if (rejected) setNotice('请选择照片或视频。');
    else setNotice('');
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>): void => {
    adopt(event.target.files);
    event.target.value = '';
  };

  const showImage = Boolean(hero && hero.kind === 'image' && hero.url && !broken);
  const showVideo = Boolean(hero && hero.kind === 'video' && hero.url && !broken);

  return (
    <div className="gs-create" data-testid="creation-entry">
      <article className="gs-create-card is-recon" aria-labelledby="creation-recon-title">
        <p className="gs-create-kicker"><CameraMark />实地重建</p>
        <h2 id="creation-recon-title">重建真实场地</h2>
        <p className="gs-create-lead">拍摄现场，或上传已有的照片、视频。</p>
        <div className={`gs-create-stage${hero ? ' has-media' : ''}`} data-testid="creation-recon-stage">
          {showImage ? (
            // 本地预览是 blob: 地址，next/image 优化不了。
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hero!.url} alt={hero!.name} onError={() => setBroken(true)} />
          ) : null}
          {showVideo ? (
            <video src={hero!.url} controls playsInline preload="metadata" aria-label={hero!.name} onError={() => setBroken(true)} />
          ) : null}
          {hero && !showImage && !showVideo ? <p className="gs-create-file">{hero.name}</p> : null}
          {!hero ? (
            <p className="gs-create-empty">
              重建后在这里预览
              <small>现场照片或视频都可以</small>
            </p>
          ) : null}
          {items.length > 1 ? <span className="gs-create-count">已选 {items.length} 个</span> : null}
        </div>
        <div className="gs-create-row">
          <label className="gs-create-btn gs-create-shoot">
            拍摄现场
            <input className="gs-create-file-input" type="file" accept={VENUE_MEDIA_ACCEPT} capture="environment" multiple onChange={onPick} />
          </label>
          <label className="gs-create-btn gs-create-upload">
            上传照片或视频
            <input className="gs-create-file-input" type="file" accept={VENUE_MEDIA_ACCEPT} multiple onChange={onPick} />
          </label>
        </div>
        {notice ? <p className="gs-create-note" role="status">{notice}</p> : null}
      </article>

      <article className="gs-create-card" aria-labelledby="creation-text-title">
        <p className="gs-create-kicker"><span className="gs-create-aa" aria-hidden="true">Aa</span>文生 3D</p>
        <h2 id="creation-text-title">文字生成 3D 模型</h2>
        <p className="gs-create-lead">描述一件要放进场地的物件。</p>
        <div className="gs-create-stage">
          <ConcreteFoldingChair />
          <p className="gs-create-caption">三维示意，不是生成结果</p>
        </div>
        <button type="button" className="gs-create-go" data-testid="generation-venue-start-text" onClick={onStartText}>
          开始创作
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </article>

      <article className="gs-create-card" aria-labelledby="creation-image-title">
        <p className="gs-create-kicker"><ImageMark />图生 3D</p>
        <h2 id="creation-image-title">图片生成 3D 模型</h2>
        <p className="gs-create-lead">上传一张参考图，生成可布置的模型。</p>
        <div className="gs-create-stage">
          <ConcreteWayfindingSign />
          <p className="gs-create-caption">三维示意，不是生成结果</p>
        </div>
        <button type="button" className="gs-create-go" data-testid="generation-venue-start-image" onClick={onStartImage}>
          开始创作
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </article>
    </div>
  );
}
