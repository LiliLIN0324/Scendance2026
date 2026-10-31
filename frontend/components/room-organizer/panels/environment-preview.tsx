'use client';

import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { listAholoAssets } from '../lib/aholo-assets';
import { DEMO_WORLD_SCENE_ID, listShippedAssets, shippedImageUrl } from '../lib/shipped-assets';
import type { SplatPreviewState } from '../hooks/use-splat-preview';

type SceneCard = { assetId: string; name: string; image?: string };

/**
 * 「环境预览」：先列仓库留档的 3DGS 场景，再列本机这次取回的，点一下把它铺成 3D 视图的背景。
 * 场地壳体只在预览那几帧让位，退出即复原；卡片认的是资产号或本站路径，不是那条会过期的云链接。
 */
export function EnvironmentPreview({ preview, onStart, onStop }: {
  preview: SplatPreviewState;
  onStart(assetId: string): void;
  onStop(): void;
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

  return <>
    {preview.status !== 'idle' && <p className="sc-note sc-material-note" role="status">
      {preview.status === 'loading' && <>正在取回「{preview.name}」<Loader2 className="cr-spin" size={14}/>{preview.progress === undefined ? '…' : ` ${Math.round(preview.progress * 100)}%`}</>}
      {preview.status === 'ready' && <>正在预览「{preview.name}」· {(preview.splats ?? 0).toLocaleString('zh-CN')} 个高斯点</>}
      {preview.status === 'error' && <span className="sc-warning">「{preview.name}」预览失败：{preview.error}</span>}
      {preview.status !== 'error' && <button type="button" className="sc-button" onClick={onStop}>退出预览</button>}
    </p>}
    {scenes.length === 0
      ? <p className="sc-note sc-material-empty">还没有本场观感包。在左轨「观感」·「场地重建」真成功取回后会出现在这里；下方仓库项标「样例·非本场」，勿冒充本场。</p>
      : <div className="sc-material-rail" role="group" aria-label="环境预览">
        {scenes.map(scene => <button type="button" key={scene.assetId} className="sc-material-card"
          disabled={busy} aria-pressed={scene.assetId === preview.assetId && preview.status !== 'idle'}
          onClick={() => onStart(scene.assetId)} aria-label={`预览${scene.name}`} title={`${scene.name}\n点击作为环境预览`}>
          <span className="sc-material-preview">
            {scene.image
              // eslint-disable-next-line @next/next/no-img-element
              && <img className="sc-material-thumb" src={scene.image} alt="" draggable={false} loading="lazy" decoding="async"/>}
            {!scene.image && <span className="sc-material-thumb-empty">{busy && scene.assetId === preview.assetId ? <Loader2 className="cr-spin" size={14}/> : '▦'}</span>}
          </span>
          <span className="sc-material-name">{scene.name}</span>
        </button>)}
      </div>}
  </>;
}
