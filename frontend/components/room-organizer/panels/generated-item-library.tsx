'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { listAholoAssets } from '../lib/aholo-assets';
import { loadStoredAholoCatalogItem } from '../lib/aholo-model-placement';
import { listShippedAssets, shippedImageUrl } from '../lib/shipped-assets';
import type { CatalogItem } from '../lib/types';

type ItemCard = { assetId: string; name: string; image?: string; shipped: boolean };

function cards(): ItemCard[] {
  const shipped = listShippedAssets('glb').map(asset => {
    const image = shippedImageUrl(asset);
    return { assetId: asset.assetId, name: asset.name, shipped: true, ...(image ? { image } : {}) };
  });
  const local = listAholoAssets().filter(asset => asset.kind === 'glb')
    .map(asset => ({ assetId: asset.assetId, name: asset.name, shipped: false }));
  return [...shipped, ...local];
}

/**
 * 物料库里的「生成物件」：先列仓库留档的那几件，再列本机这次落盘的。
 * 卡片认的是资产号或随网站发布的路径，不是那条会过期的云链接，所以重启后照样能再摆一次。
 */
export function GeneratedItemLibrary({ disabled = false, onAdd }: {
  disabled?: boolean;
  onAdd(item: CatalogItem): void;
}): JSX.Element {
  const [assets, setAssets] = useState<ItemCard[]>(cards);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function add(assetId: string, shipped: boolean) {
    if (disabled || busy) return;
    setBusy(assetId); setError('');
    try {
      const item = await loadStoredAholoCatalogItem(assetId);
      if (!alive.current) return;
      onAdd(item);
    } catch (failure) {
      if (!alive.current) return;
      setError(failure instanceof Error ? failure.message : String(failure));
      // 本机文件已经不在了，这张卡留着只会一直点不动；仓库留档的那几张不是能删掉的东西。
      if (!shipped) setAssets(current => current.filter(card => card.assetId !== assetId));
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  return <>
    {error && <p className="sc-warning sc-material-note" role="alert">{error}</p>}
    {assets.length === 0
      // 撤掉最后一张卡之后仍要说清为什么，否则失败看起来像「本来就没有」。
      ? <p className="sc-note sc-material-empty">本机还没有生成好的物件。在右栏「生成」写一句，或在左轨「观感」里图片建模，取回后会出现在这里。</p>
      : <div className="sc-material-rail" role="group" aria-label="生成物件">
        {assets.map(asset => <button type="button" key={asset.assetId} className="sc-material-card"
          disabled={disabled || busy !== null} onClick={() => void add(asset.assetId, asset.shipped)}
          aria-label={`添加${asset.name}`} title={`${asset.name}\n点击添加`}>
          <span className="sc-material-preview">
            {asset.image
              // eslint-disable-next-line @next/next/no-img-element
              && <img className="sc-material-thumb" src={asset.image} alt="" draggable={false} loading="lazy" decoding="async"/>}
            {!asset.image && <span className="sc-material-thumb-empty">{busy === asset.assetId ? <Loader2 className="cr-spin" size={14}/> : '◇'}</span>}
            {busy === asset.assetId && <span className="sc-material-add"><Loader2 className="cr-spin" size={12}/></span>}
          </span>
          <span className="sc-material-name">{asset.name}</span>
        </button>)}
      </div>}
  </>;
}
