'use client';

import { ArrowLeftRight, Eye, Loader2, Mountain } from '@/components/solid-icons';
import { useMemo, useState } from 'react';
import { DEMO_WORLD_SCENE_ID, listShippedAssets, shippedImageUrl } from '../lib/shipped-assets';
import { MaterialThumb } from './material-thumb';
import type { SplatPreviewState } from '../hooks/use-splat-preview';
import type { StoredEnvironment } from '../lib/environment-preference';

type SceneCard = { assetId: string; name: string; image?: string; sample?: boolean };

/** Project-level collection of scanned spaces; each scan keeps its own floor and transform. */
export function EnvironmentPreview({ preview, current, environments, floors, onSelect, onRemove, onSetFloor, onClear, gallery, thumbnails, onPreview }: {
  preview: SplatPreviewState;
  current: StoredEnvironment | null;
  environments: readonly StoredEnvironment[];
  floors: readonly Readonly<{ id: string; name: string }>[];
  onSelect(assetId: string, name: string): void;
  onRemove(assetId: string): void;
  onSetFloor(assetId: string, floorIndex: number): void;
  onClear(): void;
  gallery?: boolean;
  thumbnails?: Readonly<Record<string, string>>;
  onPreview?(assetId: string, name: string): void;
}): JSX.Element {
  const scenes = useMemo<SceneCard[]>(() => {
    // 这里只放演示场景：用户自己的实景扫描统一在空间卡的「真实场地」里选，避免两处重复。
    return listShippedAssets('spz').map(asset => {
      const image = shippedImageUrl(asset);
      const sample = asset.assetId === DEMO_WORLD_SCENE_ID || asset.assetId === 'shipped-small-launch-hall';
      return { assetId: asset.assetId, name: asset.name, ...(image ? { image } : {}), ...(sample ? { sample: true } : {}) };
    });
  }, []);
  const busy = preview.status === 'loading';
  const currentId = current?.assetId ?? '';
  // 显隐/Solo 是纯本地查看状态：隐藏行只在面板里变暗、不参与 Solo 隔离；
  // 不写进 StoredEnvironment、不碰渲染管线（SuperSplat 行语言，Audit §4.4 红线）。
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [soloId, setSoloId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('scendance.scene-source-photos.v1') ?? '{}') ?? {}; }
    catch { return {}; }
  });
  const [photoError, setPhotoError] = useState('');
  const savePhoto = async (assetId: string, file: File) => {
    setPhotoError('');
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (context) context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      if (!context) throw new Error('图片无法读取');
      const next = { ...JSON.parse(localStorage.getItem('scendance.scene-source-photos.v1') ?? '{}'), [assetId]: canvas.toDataURL('image/jpeg', 0.78) };
      localStorage.setItem('scendance.scene-source-photos.v1', JSON.stringify(next));
      setPhotos(next);
    } catch { setPhotoError('封面保存失败，请换一张 JPG 或 PNG 后重试。'); }
  };
  const toggleHidden = (assetId: string) => setHiddenIds(current => {
    const next = new Set(current);
    if (next.has(assetId)) next.delete(assetId); else next.add(assetId);
    return next;
  });
  const toggleSolo = (assetId: string) => setSoloId(current => (current === assetId ? null : assetId));
  const currentScene = scenes.find(scene => scene.assetId === currentId);
  const currentName = currentScene?.name ?? current?.name ?? '';
  if (gallery) return environments.length ? <>{photoError && <p role="alert">{photoError}</p>}<ul className="sc-project-gallery" aria-label="项目中的空间场景">
    {[...environments].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')).map(environment => {
      const scene = scenes.find(entry => entry.assetId === environment.assetId);
      const name = scene?.name ?? environment.name;
      const photo = photos[environment.assetId] ?? scene?.image;
      const cloudPreview = thumbnails?.[environment.assetId];
      const image = photo ?? cloudPreview;
      const active = environment.assetId === currentId;
      const loading = busy && preview.assetId === environment.assetId;
      const failed = preview.status === 'error' && preview.assetId === environment.assetId;
      const floorIndex = Math.max(0, Math.min(floors.length - 1, environment.floorIndex ?? 0));
      return <li key={environment.assetId}>
        <button type="button" className="sc-project-gallery-preview" aria-label={`预览 ${name}`} aria-pressed={active}
          onClick={() => (onPreview ?? onSelect)(environment.assetId, name)}>
          <span className="sc-project-gallery-cover">
            {image ? <MaterialThumb key={image} src={image}/> : <span className="sc-project-gallery-placeholder"><Mountain size={24} aria-hidden="true"/>打开 3D 预览</span>}
            {photo && cloudPreview && <span className="sc-project-gallery-hover"><MaterialThumb src={cloudPreview}/><small>高斯场景预览</small></span>}
            {(loading || failed || active) && <small>{loading ? '加载中' : failed ? '加载失败' : '当前场景'}</small>}
          </span>
          <strong title={name}>{name}</strong>
        </button>
        <details className="sc-project-gallery-settings">
          <summary aria-label={`管理 ${name}`}>···</summary>
          <div>
            <label className="sc-project-gallery-upload">{photo ? '更换实拍封面' : '添加实拍封面'}
              <input type="file" accept="image/jpeg,image/png,image/webp" aria-label={`${name}实拍封面`}
                onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void savePhoto(environment.assetId, file); }}/>
            </label>
            <label>楼层 <select aria-label={`${name}所在楼层`} value={floorIndex}
              onChange={event => onSetFloor(environment.assetId, Number(event.currentTarget.value))}>
              {floors.map((floor, index) => <option key={floor.id} value={index}>{index + 1}F</option>)}
            </select></label>
            <button type="button" aria-label={`移除${name}`} onClick={() => onRemove(environment.assetId)}>移除</button>
          </div>
        </details>
      </li>;
    })}
  </ul></> : <p className="sc-note">本活动还没有场景。可以从本机扫描或示例加入。</p>;
  return <>
    <div className="sc-space-section-head">
      <Mountain size={15} aria-hidden="true"/><h3>空间场景</h3><small>{environments.length} 个</small>
      <details className="sc-env-switch">
        <summary aria-label="添加场景" title="添加场景"><ArrowLeftRight size={14} aria-hidden="true"/></summary>
        <ul className="sc-env-switch-menu" role="menu" aria-label="可添加的场景">
          {scenes.map(scene => {
            const placed = environments.some(entry => entry.assetId === scene.assetId);
            return <li key={scene.assetId}>
              <button type="button" role="menuitemcheckbox" aria-checked={placed} onClick={() => onSelect(scene.assetId, scene.name)}>
                <span className="sc-env-switch-thumb">{scene.image ? <MaterialThumb src={scene.image}/> : <span className="sc-material-thumb-empty">▦</span>}</span>
                <span className="sc-env-switch-name">{scene.name}</span>
                {placed ? <span className="sc-env-switch-tag">已加入</span> : scene.sample && <span className="sc-env-switch-tag">样例</span>}
              </button>
            </li>;
          })}
          {environments.length > 0 && <li className="sc-env-switch-foot"><button type="button" onClick={onClear}>清空项目中的场景</button></li>}
          <li className="sc-env-switch-note">这里只列演示场景；自己的实景扫描在下方「真实场地」里选。</li>
        </ul>
      </details>
    </div>
    {environments.length > 0 ? <ul className="sc-env-scenes" aria-label="项目中的空间场景">
      {environments.map((environment, index) => {
        const scene = scenes.find(entry => entry.assetId === environment.assetId);
        const name = scene?.name ?? environment.name;
        const floorIndex = Math.min(floors.length - 1, environment.floorIndex ?? 0);
        const loading = busy && preview.assetId === environment.assetId;
        const failed = preview.status === 'error' && preview.assetId === environment.assetId;
        const hidden = hiddenIds.has(environment.assetId);
        const dimmed = hidden || (soloId !== null && soloId !== environment.assetId);
        return <li key={environment.assetId} className={[
          environment.assetId === currentId ? 'is-current' : '',
          dimmed ? 'is-dimmed' : '',
        ].filter(Boolean).join(' ')}>
          <button type="button" className="sc-env-scene-pick" aria-pressed={environment.assetId === currentId} onClick={() => onSelect(environment.assetId, name)}>
            <span className="sc-env-preview">
              {scene?.image ? <MaterialThumb src={scene.image}/> : <span className="sc-material-thumb-empty">{loading ? <Loader2 className="cr-spin" size={14}/> : '▦'}</span>}
            </span>
            <span className="sc-env-meta"><strong title={name}>{name}</strong><small>{loading ? `正在加载${preview.progress === undefined ? '' : ` ${Math.round(preview.progress * 100)}%`}` : failed ? '加载失败，可重新打开' : `${floorIndex + 1}F${index === 0 ? ' · 当前' : ''}`}</small></span>
          </button>
          <select aria-label={`${name}所在楼层`} value={floorIndex} onChange={event => onSetFloor(environment.assetId, Number(event.currentTarget.value))}>
            {floors.map((floor, floorNumber) => <option key={floor.id} value={floorNumber}>{floorNumber + 1}F</option>)}
          </select>
          <button type="button" className="sc-env-scene-eye" aria-label={hidden ? `显示${name}` : `隐藏${name}`} aria-pressed={!hidden} title={hidden ? '显示' : '隐藏'} onClick={() => toggleHidden(environment.assetId)}>
            <Eye size={14} aria-hidden="true"/>
          </button>
          <button type="button" className={`sc-env-scene-solo${soloId === environment.assetId ? ' is-on' : ''}`} aria-pressed={soloId === environment.assetId} title="只看这一个" onClick={() => toggleSolo(environment.assetId)}>Solo</button>
          <button type="button" className="sc-env-scene-remove" aria-label={`移除${name}`} title="移除场景" onClick={() => onRemove(environment.assetId)}>×</button>
        </li>;
      })}
    </ul> : <div className="sc-lib-empty"><Mountain size={14} aria-hidden="true"/><span>添加一个场景开始布置</span></div>}
    {current && <div className="sc-env-active-caption" role="status">正在编辑：{currentName}</div>}
  </>;
}
