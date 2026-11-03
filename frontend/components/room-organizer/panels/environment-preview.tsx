'use client';

import { ArrowLeftRight, Loader2, Mountain } from 'lucide-react';
import { useMemo } from 'react';
import { listAholoAssets } from '../lib/aholo-assets';
import { DEMO_WORLD_SCENE_ID, listShippedAssets, shippedImageUrl } from '../lib/shipped-assets';
import { MaterialThumb } from './material-thumb';
import type { SplatPreviewState } from '../hooks/use-splat-preview';
import type { StoredEnvironment } from '../lib/environment-preference';

type SceneCard = { assetId: string; name: string; image?: string; sample?: boolean };

/**
 * 「环境」：卡片里只有当前的一张 + 名称 + 右上角切换，不再夹带对话气泡或状态说明。
 * 带「样例」角标的是仓库样例：缩略图只是目录示意，不代表本场实拍。
 */
export function EnvironmentPreview({ preview, current, onSelect, onClear }: {
  preview: SplatPreviewState;
  current: StoredEnvironment | null;
  onSelect(assetId: string, name: string): void;
  onClear(): void;
  onShowVector?(): void;
}): JSX.Element {
  const scenes = useMemo<SceneCard[]>(() => {
    const shipped = listShippedAssets('spz').map(asset => {
      const image = shippedImageUrl(asset);
      const sample = asset.assetId === DEMO_WORLD_SCENE_ID || asset.assetId === 'shipped-small-launch-hall';
      return { assetId: asset.assetId, name: asset.name, ...(image ? { image } : {}), ...(sample ? { sample: true } : {}) };
    });
    const local = listAholoAssets().filter(asset => asset.kind !== 'glb')
      .map(asset => ({ assetId: asset.assetId, name: asset.name }));
    return [...shipped, ...local];
  }, []);
  const busy = preview.status === 'loading';
  const currentId = current?.assetId ?? '';
  const currentScene = scenes.find(scene => scene.assetId === currentId);
  const currentName = currentScene?.name ?? current?.name ?? '';
  const failed = preview.status === 'error' && currentId === preview.assetId;
  return <>
    <div className="sc-space-section-head">
      <Mountain size={15} aria-hidden="true"/><h3>环境</h3><small>本场观感</small>
      {/* 说明与切换收成一个控件：样例说明放进切换菜单底部，不再单独占一个 ⓘ。 */}
      <details className="sc-env-switch">
        <summary aria-label="切换环境" title="切换环境"><ArrowLeftRight size={14} aria-hidden="true"/></summary>
        <ul className="sc-env-switch-menu" role="menu" aria-label="其它环境">
          {scenes.length === 0 && <li><span className="sc-env-switch-empty">还没有别的环境</span></li>}
          {scenes.map(scene => <li key={scene.assetId}>
            <button type="button" role="menuitemradio" aria-checked={scene.assetId === currentId} disabled={busy} onClick={() => onSelect(scene.assetId, scene.name)}>
              <span className="sc-env-switch-thumb">{scene.image ? <MaterialThumb src={scene.image}/> : <span className="sc-material-thumb-empty">▦</span>}</span>
              <span className="sc-env-switch-name">{scene.name}</span>
              {scene.sample && <span className="sc-env-switch-tag">样例</span>}
            </button>
          </li>)}
          {current && <li className="sc-env-switch-foot"><button type="button" onClick={onClear}>不用环境</button></li>}
          <li className="sc-env-switch-note">带「样例」的是仓库样例，不是本场实拍。</li>
        </ul>
      </details>
    </div>
    {currentId
      ? <button type="button" className="sc-env-current" disabled={busy} onClick={() => currentScene && onSelect(currentScene.assetId, currentScene.name)} aria-label={`当前环境${currentName}`} title={`${currentName}\n当前环境`}>
        <span className="sc-env-preview">
          {currentScene?.image ? <MaterialThumb src={currentScene.image}/> : <span className="sc-material-thumb-empty">{busy ? <Loader2 className="cr-spin" size={14}/> : '▦'}</span>}
          {currentScene?.sample && <span className="sc-material-sample">样例</span>}
        </span>
        <span className="sc-env-meta">
          <strong title={currentName}>{currentName}</strong>
          <small>{failed ? '没挂上，换个环境再试' : currentScene?.sample ? '样例 · 非本场实拍' : '当前环境'}</small>
        </span>
      </button>
      : <div className="sc-lib-empty"><Mountain size={14} aria-hidden="true"/><span>还没有选择环境</span></div>}
  </>;
}
