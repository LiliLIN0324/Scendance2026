'use client';

import { useEffect, useRef, useState } from 'react';
import { publicationSchema, shareErrorMessage, shareSummarySchema, type Publication, type ShareSummary } from '@/lib/share-api';
import type { BackendSession } from '@/lib/backend-session';
import '@/app/share.css';

export function PublicationPanel({ controller, projectId, revision, dirty }: {
  controller: BackendSession; projectId: string; revision: number; dirty: boolean;
}): JSX.Element {
  const [shares, setShares] = useState<ShareSummary[] | null>(null);
  const [publication, setPublication] = useState<Publication | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const epoch = useRef(0);
  const pending = useRef(false);

  useEffect(() => {
    const current = ++epoch.current;
    pending.current = true;
    setBusy(true); setShares(null); setPublication(null); setMessage('');
    void controller.businessRequest<unknown>(`/projects/${projectId}/shares`).then(result => {
      if (current === epoch.current) setShares(shareSummarySchema.array().parse(result));
    }).catch(error => { if (current === epoch.current) setMessage(shareErrorMessage(error)); })
      .finally(() => { if (current === epoch.current) { pending.current = false; setBusy(false); } });
    return () => { epoch.current += 1; };
  }, [controller, projectId]);

  async function run(action: (current: number) => Promise<void>): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    const current = epoch.current;
    setBusy(true); setMessage('');
    try { await action(current); }
    catch (error) { if (current === epoch.current) setMessage(shareErrorMessage(error)); }
    finally { if (current === epoch.current) { pending.current = false; setBusy(false); } }
  }

  return <section className="sc-publication" aria-labelledby="sc-publication-title">
    <div className="sc-share-heading"><h3 id="sc-publication-title">客户分享</h3><span>云端版本 {revision}</span></div>
    <p>发布后生成独立的只读方案。后续编辑不会改变已发布版本，内部备注不会展示。</p>
    {dirty && <p className="sc-share-notice">当前有未保存修改，请先保存再发布。</p>}
    <div className="sc-share-actions">
      <button type="button" disabled={busy || dirty} onClick={() => void run(async current => {
        const result = publicationSchema.parse(await controller.businessRequest<unknown>(`/projects/${projectId}/publish`, 'POST', { expectedRevision: revision }));
        if (current !== epoch.current) return;
        setPublication(result);
        setShares(previous => [shareSummarySchema.parse({ ...result, revokedAt: null }), ...(previous ?? [])]);
        setMessage('已发布。请复制并保存链接，关闭面板后无法找回原链接。');
      })}>{busy ? '正在处理…' : `发布版本 ${revision}`}</button>
      <button type="button" disabled={busy} onClick={() => void run(async current => {
        const result = shareSummarySchema.array().parse(await controller.businessRequest<unknown>(`/projects/${projectId}/shares`));
        if (current === epoch.current) setShares(result);
      })}>刷新分享列表</button>
    </div>
    {publication && <div className="sc-share-link">
      <label>新发布的客户链接<input aria-label="客户分享链接" readOnly value={publication.url} onFocus={event => event.currentTarget.select()} /></label>
      <div className="sc-share-actions">
        <button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(publication.url); setMessage('链接已复制。'); }
          catch { setMessage('无法自动复制，请选中上方链接手动复制。'); }
        }}>复制链接</button>
        <a href={publication.url} target="_blank" rel="noopener noreferrer">打开只读方案 ↗</a>
      </div>
    </div>}
    {message && <p className="sc-share-notice" role="status">{message}</p>}
    {shares === null ? <p>正在读取分享记录；读取失败可点击刷新。</p> : shares.length === 0 ? <p>还没有发布过此项目。</p> : <ul className="sc-share-list">
      {[...shares].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(share => <li key={share.shareId}>
        <div><strong>版本 {share.revision}</strong><small>{new Date(share.createdAt).toLocaleString('zh-CN')} · {share.revokedAt ? '已撤销' : '可访问'}</small></div>
        <button type="button" disabled={busy || !!share.revokedAt} aria-label={`撤销版本 ${share.revision} 的分享`} onClick={() => void run(async current => {
          await controller.businessRequest(`/projects/${projectId}/shares/${share.shareId}`, 'DELETE');
          if (current !== epoch.current) return;
          setShares(previous => previous?.map(item => item.shareId === share.shareId ? { ...item, revokedAt: new Date().toISOString() } : item) ?? null);
          setPublication(previous => previous?.shareId === share.shareId ? null : previous);
          setMessage('链接已撤销。已经下载的内容无法收回，已签发的模型地址最多仍可使用 5 分钟。');
        })}>{share.revokedAt ? '已撤销' : '撤销'}</button>
      </li>)}
    </ul>}
    <p className="sc-share-footnote">已有链接不会再次显示。若未保存链接，可撤销旧分享并重新发布。</p>
  </section>;
}
