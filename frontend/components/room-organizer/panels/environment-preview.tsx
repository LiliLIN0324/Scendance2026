'use client';

import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { listAholoAssets } from '../lib/aholo-assets';
import { DEMO_WORLD_SCENE_ID, listShippedAssets, shippedImageUrl } from '../lib/shipped-assets';
import { MaterialThumb } from './material-thumb';
import type { SplatPreviewState } from '../hooks/use-splat-preview';
import type { StoredEnvironment } from '../lib/environment-preference';

type SceneCard = { assetId: string; name: string; image?: string };

/**
 * 「环境」：先列仓库留档的 3DGS 场景，再列本机这次取回的。
 * 点一张就把它设为本场环境并记住；同一个项目再打开时自动挂回，
 * 不想用时按「不用环境」摘掉，壳体随即恢复。
 */
export function EnvironmentPreview({ preview, current, onSelect, onClear }: {
  preview: SplatPreviewState;
  current: StoredEnvironment | null;
  onSelect(assetId: string, name: string): void;
  onClear(): void;
}): JSX.Element {
  const scenes = useMemo<SceneCard[]>(() => {
    const shipped = listShippedAssets('spz').map(asset => {
      const image = shippedImageUrl(asset);
      const sample = asset.assetId === DEMO_WORLD_SCENE_ID || asset.assetId === 'shipped-small-launch-hall';
      const name = sample ? `${asset.name}（样例·非本场）` : asset.name;
      return { assetId: asset.assetId, name, ...(image ? { image } : {}) };
    });
    const local = listAholoAssets().filter(asset => asset.kind !== 'glb')
      .map(asset => ({ assetId: asset.assetId, name: asset.name }));
    return [...shipped, ...local];
  }, []);
  const busy = preview.status === 'loading';
  const currentId = current?.assetId ?? '';
  return <>
    {preview.status === 'loading' && <p className="sc-note sc-material-note" role="status">
      正在取回「{preview.name}」<Loader2 className="cr-spin" size={14}/>{preview.progress === undefined ? '…' : ` ${Math.round(preview.progress * 100)}%`}
    </p>}
    {preview.status === 'ready' && currentId && currentId === preview.assetId && <p className="sc-note sc-material-note" role="status">
      当前环境：「{preview.name}」· {(preview.splats ?? 0).toLocaleString('zh-CN')} 个高斯点
      <button type="button" className="sc-button" onClick={onClear}>不用环境</button>
    </p>}
    {preview.status === 'error' && <p className="sc-note sc-material-note" role="status">
      <span className="sc-warning">「{preview.name}」没挂上：{preview.error}</span>
      {currentId && currentId === preview.assetId && <button type="button" className="sc-button" onClick={onClear}>不用环境</button>}
    </p>}
    {scenes.length === 0
      ? <p className="sc-note sc-material-empty">还没有本场环境包。从地图采集单完成重建并取回后会出现在这里；下方仓库项标「样例·非本场」，勿冒充本场。</p>
      : <div className="sc-material-rail" role="group" aria-label="环境">
        {scenes.map(scene => <button type="button" key={scene.assetId} className="sc-material-card"
          disabled={busy} aria-pressed={scene.assetId === currentId}
          onClick={() => onSelect(scene.assetId, scene.name)} aria-label={`设为环境${scene.name}`} title={`${scene.name}\n设为本场环境，跟项目一起保留`}>
          <span className="sc-material-preview">
            {scene.image
              ? <MaterialThumb src={scene.image}/>
              : <span className="sc-material-thumb-empty">{busy && scene.assetId === preview.assetId ? <Loader2 className="cr-spin" size={14}/> : '▦'}</span>}
          </span>
          <span className="sc-material-name">{scene.name}</span>
        </button>)}
      </div>}
  </>;
}
