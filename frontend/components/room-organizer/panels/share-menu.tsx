'use client';

/**
 * 画布工具轨上的唯一「分享」。
 * 信息架构借 Excalidraw（MIT）的分享对话框：一条链接轨，旁边是带走资料。
 * 组件是自写的，不搬 Excalidraw / oddeNova / Plane 的源码。
 */
import { Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export interface ShareMenuActions {
  /** 冻一版本机方案页并给出可打开的 URL。 */
  onIssueReviewLink(): Promise<{ url: string }>;
  /** 打开既有的完整活动交接确认，不切执行模式。 */
  onExportHandoff(): void;
  /** 打开既有的云项目 / 素材库，不新开路由。 */
  onOpenMaterials(): void;
  /** 到场清单抽屉。调用方不得因此把 workbenchMode 设成 delivery。 */
  onOpenChecklist(): void;
}

export function ShareMenu({ actions, openRequest = 0, closeSignal = 0 }: {
  actions?: ShareMenuActions;
  /** 旧「评审」入口改道时递增，用来把菜单打开。 */
  openRequest?: number;
  /** 别的工具菜单打开时递增，用来把分享收起。 */
  closeSignal?: number;
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const seenOpen = useRef(openRequest);
  const seenClose = useRef(closeSignal);

  useEffect(() => {
    if (openRequest === seenOpen.current) return;
    seenOpen.current = openRequest;
    if (openRequest > 0) setOpen(true);
  }, [openRequest]);

  useEffect(() => {
    if (closeSignal === seenClose.current) return;
    seenClose.current = closeSignal;
    setOpen(false);
  }, [closeSignal]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const issue = async () => {
    if (!actions || busy) {
      setNotice(actions ? '' : '分享还没接到工作台。');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const result = await actions.onIssueReviewLink();
      setUrl(result.url);
      const copied = await copyText(result.url);
      setNotice(copied ? '链接已复制。同一浏览器打开即可评论。' : '链接已生成。请从框里手动复制。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '评审链接没有生成。');
    } finally {
      setBusy(false);
    }
  };

  const copyIssued = async () => {
    if (!url) return;
    const copied = await copyText(url);
    setNotice(copied ? '链接已复制。' : '复制没成功，请从框里手动复制。');
  };

  return <div className="sc-tool-menu" ref={rootRef}>
    <button type="button" id="tool-share" data-tip="分享" aria-label="分享" aria-haspopup="dialog" aria-expanded={open} aria-controls="tool-share-menu" className={open ? 'is-active' : ''} onClick={() => setOpen(current => !current)}>
      <Share2 size={24} aria-hidden="true"/>
    </button>
    {open && <div id="tool-share-menu" className="sc-tool-pop sc-share-menu" role="dialog" aria-label="分享">
      <p className="sc-share-kicker">给对方看</p>
      <button type="button" disabled={busy} onClick={() => { void issue(); }}>{busy ? '正在生成链接…' : '发评审链接'}</button>
      <p>对方打开只读方案页后留言。收藏和状态球以后再标出要审的项目，这一步先把链接发出去。</p>
      {url && <>
        <label>评审链接
          <input readOnly value={url} aria-label="评审链接" onFocus={event => event.currentTarget.select()}/>
        </label>
        <button type="button" onClick={() => { void copyIssued(); }}>复制链接</button>
        <a href={url} target="_blank" rel="noopener noreferrer">打开对方所见</a>
      </>}
      {notice && <p role="status">{notice}</p>}
      <span className="sc-more-sep" aria-hidden="true"/>
      <p className="sc-share-kicker">带走资料</p>
      <button type="button" onClick={() => { actions?.onExportHandoff(); setOpen(false); }}>导出交接</button>
      <button type="button" onClick={() => { actions?.onOpenMaterials(); setOpen(false); }}>打开资料</button>
      <span className="sc-more-sep" aria-hidden="true"/>
      <button type="button" onClick={() => { actions?.onOpenChecklist(); setOpen(false); }}>到场清单</button>
      <p>评审链接和评论存在这台浏览器。导出交接、资料库用的是工作台里已有的入口。</p>
    </div>}
  </div>;
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* 选中输入框，让人自己复制 */ }
  return false;
}
