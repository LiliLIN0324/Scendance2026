'use client';

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react';

/**
 * 左轨「创作」的同一页：两张冷石卡片。
 * 第一张只做入口和本地预览，不提交场地重建。
 * 第二张在卡片上切换文生 / 图生并提交，不再打开另一层生成窗口。
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

export type CreationModelMode = 'text' | 'image';

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

function CubeMark(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <path d="M7 1.7 12.1 4.5 7 7.3 1.9 4.5Z" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" />
      <path d="M1.9 4.5 7 7.3v4.9L1.9 9.4Z" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" />
      <path d="M12.1 4.5 7 7.3v4.9l5.1-2.8Z" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" />
    </svg>
  );
}

function FrameMark({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <rect x="1.6" y="2.3" width="10.8" height="9.4" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.1 9.4 5.5 7l1.7 1.6L9.3 6.4 11 8.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function PreviewFloor(): JSX.Element {
  return (
    <svg className="gs-create-floor" viewBox="0 0 320 168" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <ellipse cx="160" cy="122" rx="84" ry="15" fill="rgba(20,20,22,0.07)" />
      <g fill="none" stroke="#D5D7DC" strokeWidth="1">
        <path d="M18 156 160 74 302 156" />
        <path d="M68 156 160 74 252 156" />
        <path d="M112 156 160 74 208 156" />
        <path d="M36 136h248" />
        <path d="M64 116h192" />
        <path d="M94 98h132" />
      </g>
    </svg>
  );
}

export function CreationEntry({
  mode,
  onMode,
  prompt,
  onPrompt,
  photoName,
  referenceReady,
  onPickReference,
  onGenerate,
  busy,
  generateDisabled,
  generateTitle,
  credit,
  onCredit,
  notice,
  blockReason,
}: {
  mode: CreationModelMode;
  onMode: (mode: CreationModelMode) => void;
  prompt: string;
  onPrompt: (value: string) => void;
  photoName: string;
  referenceReady: boolean;
  onPickReference: (file: File | undefined) => void;
  onGenerate: () => void;
  busy: boolean;
  generateDisabled: boolean;
  generateTitle?: string;
  credit: boolean;
  onCredit: (value: boolean) => void;
  notice: string;
  blockReason: string;
}): JSX.Element {
  const itemsRef = useRef<VenuePreview[]>([]);
  const [items, setItems] = useState<VenuePreview[]>([]);
  const [mediaNotice, setMediaNotice] = useState('');
  const [broken, setBroken] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const hero = items[items.length - 1] ?? null;
  const imageMode = mode === 'image';

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
    if (rejected && accepted.length) setMediaNotice('有的文件不是照片或视频，已跳过。');
    else if (rejected) setMediaNotice('请选择照片或视频。');
    else setMediaNotice('');
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>): void => {
    adopt(event.target.files);
    event.target.value = '';
  };

  const onPromptKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing || event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    onGenerate();
  };

  const onDropReference = (event: DragEvent<HTMLLabelElement>): void => {
    event.preventDefault();
    setDragOver(false);
    onPickReference(event.dataTransfer.files?.[0]);
  };

  const showImage = Boolean(hero && hero.kind === 'image' && hero.url && !broken);
  const showVideo = Boolean(hero && hero.kind === 'video' && hero.url && !broken);

  return (
    <div className="gs-create" data-testid="creation-entry">
      <article className="gs-create-card is-recon" aria-labelledby="creation-recon-title">
        <p className="gs-create-kicker"><span className="gs-create-mark" aria-hidden="true"><CameraMark /></span>实地重建</p>
        <h2 id="creation-recon-title">重建真实场地</h2>
        <p className="gs-create-lead">拍摄现场，或上传已有的照片、视频。</p>
        <p className="gs-create-chip">完成后进入空间</p>
        <div className={`gs-create-stage${hero ? ' has-media' : ''}`} data-testid="creation-recon-stage">
          {!hero ? <PreviewFloor /> : null}
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
        {mediaNotice ? <p className="gs-create-note" role="status">{mediaNotice}</p> : null}
      </article>

      <article className="gs-create-card is-model" aria-labelledby="creation-model-title">
        <p className="gs-create-kicker"><span className="gs-create-mark" aria-hidden="true"><CubeMark /></span>生成 3D</p>
        <h2 id="creation-model-title">生成 3D 模型</h2>
        <p className="gs-create-lead">{imageMode ? '上传一张参考图，生成可布置的模型。' : '描述一件要放进场地的物件。'}</p>
        <p className="gs-create-chip">完成后放进物料</p>
        <div className="gs-create-switch" role="group" aria-label="生成方式">
          <button type="button" aria-pressed={!imageMode} onClick={() => onMode('text')}>
            <span className="gs-create-t" aria-hidden="true">T</span>
            文生 3D
          </button>
          <button type="button" aria-pressed={imageMode} onClick={() => onMode('image')}>
            <FrameMark />
            图生 3D
          </button>
        </div>
        {imageMode ? (
          <label
            className={`gs-create-drop${photoName ? ' has-file' : ''}${dragOver ? ' is-over' : ''}`}
            data-testid="creation-image-drop"
            onDragOver={event => { event.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDropReference}
          >
            <input
              type="file"
              accept="image/png,image/jpeg,.png,.jpg,.jpeg"
              className="gs-create-file-input"
              disabled={busy}
              onChange={event => { onPickReference(event.target.files?.[0]); event.target.value = ''; }}
            />
            <FrameMark size={22} />
            <span className="gs-create-drop-text">
              <strong>{photoName || '选一张参考图，或拖进来'}</strong>
              <small>{photoName ? (referenceReady ? '已上传' : '正在上传…') : '照片即可，主体清楚'}</small>
            </span>
          </label>
        ) : (
          <textarea
            className="gs-create-prompt"
            rows={3}
            maxLength={200}
            aria-label="描述"
            value={prompt}
            placeholder="一句话描述物件，如：一把户外折叠椅"
            onChange={event => onPrompt(event.target.value)}
            onKeyDown={onPromptKey}
          />
        )}
        <div className="gs-create-submit">
          <button
            type="button"
            className="gs-create-go"
            data-testid="creation-generate"
            disabled={generateDisabled}
            title={generateTitle}
            onClick={onGenerate}
          >
            {busy ? '提交中…' : '生成'}
          </button>
          <label className="gs-create-credit">
            <input type="checkbox" checked={credit} disabled={busy} onChange={event => onCredit(event.target.checked)} />
            消耗额度
          </label>
        </div>
        {notice ? <p className="gs-create-note" role="status">{notice}</p> : null}
        {blockReason ? <p className="gs-create-note gs-create-note--warn" data-testid="creation-block-reason">{blockReason}</p> : null}
      </article>
    </div>
  );
}
