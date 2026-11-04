'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { readShare, shareErrorMessage, shareTokenFromHash, type SharedSnapshot } from '@/lib/share-api';
import { readShareSnapshotHash, shareSnapshotErrorMessage, SHARE_SNAPSHOT_HASH_PREFIX, type ShareSnapshot } from '@/lib/share-snapshot';
import '../share.css';

const ScenePreview = dynamic(() => import('@/components/business/scene-preview').then(module => module.ScenePreview), { ssr: false, loading: () => <p>正在准备三维预览…</p> });
const LayoutPreview = dynamic(() => import('@/components/business/layout-preview').then(module => module.LayoutPreview), { ssr: false, loading: () => <p>正在准备三维预览…</p> });

export default function SharedViewPage(): JSX.Element {
  const [snapshot, setSnapshot] = useState<SharedSnapshot | null>(null);
  const [localSnapshot, setLocalSnapshot] = useState<ShareSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [expiresAt, setExpiresAt] = useState(0);
  const [expired, setExpired] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const current = ++request.current;
      const hash = window.location.hash;
      setSnapshot(null); setLocalSnapshot(null); setError(''); setBusy(true); setExpired(false);
      // A URL-carried snapshot needs no backend: decode the hash and render the
      // same layout the workbench just had.
      if (hash.startsWith(SHARE_SNAPSHOT_HASH_PREFIX)) {
        const result = await readShareSnapshotHash(hash);
        if (!active || current !== request.current) return;
        if (result.ok) setLocalSnapshot(result.snapshot);
        else setError(shareSnapshotErrorMessage(result.reason));
        setBusy(false);
        return;
      }
      const token = shareTokenFromHash(hash);
      if (!token) { setError('分享链接不完整，请使用发布者提供的完整链接。'); setBusy(false); return; }
      try {
        const result = await readShare(token);
        if (!active || current !== request.current) return;
        setSnapshot(result);
        setExpiresAt(Date.now() + Math.min(300, ...result.assets.map(asset => asset.expiresIn)) * 1000);
      } catch (failure) {
        if (active && current === request.current) setError(shareErrorMessage(failure));
      } finally { if (active && current === request.current) setBusy(false); }
    };
    void load();
    window.addEventListener('hashchange', load);
    return () => { active = false; request.current += 1; window.removeEventListener('hashchange', load); };
  }, [refresh]);
  useEffect(() => {
    if (!snapshot) return;
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, expiresAt - Date.now()));
    const check = () => { if (Date.now() >= expiresAt) setExpired(true); };
    document.addEventListener('visibilitychange', check);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', check); };
  }, [snapshot, expiresAt]);
  const assetUrls = useMemo(() => Object.fromEntries(snapshot?.assets.map(asset => [asset.id, asset.url]) ?? []), [snapshot]);
  const assetNames = useMemo(() => Object.fromEntries(snapshot?.assets.map(asset => [asset.id, asset.name]) ?? []), [snapshot]);
  const localAssetUrls = useMemo(() => Object.fromEntries(localSnapshot?.assets.map(asset => [asset.id, asset.url]) ?? []), [localSnapshot]);

  return <main className="sc-share-page">
    <header className="sc-share-masthead"><span>幕景 <small>Scendance</small></span><span>{localSnapshot ? '只读 3D 方案' : '客户只读方案'}</span></header>
    {busy ? <section className="sc-share-state" role="status"><h1>正在打开方案</h1><p>正在读取发布版本与模型资源…</p></section> : error ? <section className="sc-share-state" role="alert"><h1>暂时无法查看方案</h1><p>{error}</p><button type="button" onClick={() => setRefresh(value => value + 1)}>重试</button></section> : localSnapshot ? <>
      <div className="sc-share-title">
        <div>
          <p>只读 · 不可编辑 · {localSnapshot.scene.objects} 件物件</p>
          <h1>{localSnapshot.name}</h1>
          <p>{new Date(localSnapshot.createdAt).toLocaleString('zh-CN')} · {localSnapshot.scene.width} × {localSnapshot.scene.depth} 米</p>
        </div>
      </div>
      <LayoutPreview layout={localSnapshot.layout} assetUrls={localAssetUrls} name={localSnapshot.name} initialView={localSnapshot.camera === 'top' || localSnapshot.camera === 'front' ? localSnapshot.camera : 'iso'}/>
      <p className="sc-share-footnote">此链接自带方案快照，无需登录或密码即可打开，可离线查看；页面只读、不可编辑，不连接云端发布记录。模型为布置效果参考，实物规格以最终确认为准。</p>
    </> : snapshot && <>
      <div className="sc-share-title"><div><p>已发布 · 版本 {snapshot.revision}</p><h1>{snapshot.name}</h1><p>{new Date(snapshot.createdAt).toLocaleString('zh-CN')} · {snapshot.scene.venue.width} × {snapshot.scene.venue.depth} 米</p></div><button type="button" onClick={() => setRefresh(value => value + 1)}>刷新模型资源</button></div>
      {expired && <p className="sc-share-notice" role="status">资源授权已到期；已载入的模型仍可查看。重新加载模型前，请刷新资源以检查链接状态。</p>}
      <ScenePreview scene={snapshot.scene} assetUrls={assetUrls} assetNames={assetNames} />
      <section className="sc-share-materials" aria-labelledby="sc-share-materials-title">
        <div className="sc-share-heading"><h2 id="sc-share-materials-title">物料清单</h2><span>共 {snapshot.materials.reduce((total, item) => total + item.quantity, 0)} 件</span></div>
        {snapshot.materials.length === 0 ? <p>此方案暂无物料。</p> : <div className="sc-share-table-scroll"><table><thead><tr><th scope="col">物料</th><th scope="col">尺寸（宽 × 深 × 高 / 米）</th><th scope="col">颜色</th><th scope="col">数量</th></tr></thead><tbody>
          {snapshot.materials.map((item, index) => <tr key={index}><td>{item.name}{item.notice && <small>{item.notice}</small>}</td><td>{item.size.width} × {item.size.depth} × {item.size.height}</td><td><span className="sc-share-color" style={{ backgroundColor: item.color }} />{item.color}</td><td>{item.quantity}</td></tr>)}
        </tbody></table></div>}
      </section>
      {snapshot.assets.length > 0 && <details className="sc-share-sources"><summary>模型来源与许可</summary><ul>{snapshot.assets.map(asset => <li key={asset.id}>
        <strong>{asset.name}</strong> · {asset.sourceUrl ? <a href={asset.sourceUrl} target="_blank" rel="noopener noreferrer">{asset.license?.attribution ?? asset.source}</a> : asset.source}
        {asset.license?.url ? <> · <a href={asset.license.url} target="_blank" rel="noopener noreferrer">{asset.license.id ?? '提供商许可条款'}</a></> : asset.license?.id ? <> · {asset.license.id}</> : null}
      </li>)}</ul></details>}
      <p className="sc-share-footnote">此页面展示固定的发布版本，后续编辑不会改变当前方案。模型为布置效果参考，实物规格以最终确认为准。</p>
    </>}
  </main>;
}
