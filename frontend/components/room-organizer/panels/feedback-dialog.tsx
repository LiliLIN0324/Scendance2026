'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../hooks/use-dialog-focus';

const ISSUES_URL = 'https://github.com/LiliLIN0324/Scendance2026/issues/new';

export interface FeedbackPlanContext {
  name: string;
  place: '户外' | '室内';
  boundary: string;
  canvas: string;
}

export function FeedbackDialog({
  open,
  onClose,
  plan,
  onCapturePlan,
}: {
  open: boolean;
  onClose: () => void;
  plan?: FeedbackPlanContext;
  onCapturePlan?: () => Promise<string | null> | string | null;
}): JSX.Element | null {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState('');
  const [includePlan, setIncludePlan] = useState(true);
  const [includeShot, setIncludeShot] = useState(true);
  const [includeBrowser, setIncludeBrowser] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useDialogFocus(open, panelRef, { initialFocusRef: closeRef, onEscape: onClose, trap: true });

  useEffect(() => {
    if (!open) return;
    setError('');
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  async function submit(): Promise<void> {
    const note = text.trim();
    if (!note) {
      setError('先写一下遇到的情况和预期。');
      return;
    }
    setBusy(true);
    setError('');
    const lines = [note, ''];
    if (includePlan && plan) {
      lines.push('---', '当前方案', `方案：${plan.name}`, `场地：${plan.place}`, `红线：${plan.boundary}`, `画布：${plan.canvas}`);
    }
    if (includeShot) {
      let saved = false;
      try {
        const data = await onCapturePlan?.();
        if (data && data.startsWith('data:image/')) {
          const anchor = document.createElement('a');
          anchor.href = data;
          anchor.download = 'scendance-canvas.png';
          anchor.click();
          saved = true;
        }
      } catch {
        saved = false;
      }
      lines.push('', saved
        ? '画布截图已下载到本机（只含规划画布）。Issue 链接放不下图片，请把刚下载的文件拖进这条 issue。'
        : '这次没有截到规划画布。若需要画面，请自行截一张规划画布再拖进 issue。');
    }
    if (includeBrowser && typeof navigator !== 'undefined') {
      lines.push('', '浏览器', navigator.userAgent, `语言 ${navigator.language}`, `视口 ${window.innerWidth}×${window.innerHeight}`);
    }
    const body = lines.join('\n').slice(0, 6000);
    const title = note.replace(/\s+/g, ' ').slice(0, 80) || '反馈';
    const url = `${ISSUES_URL}?${new URLSearchParams({ title, body }).toString()}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setBusy(false);
    onClose();
  }

  return createPortal(
    <div
      className="sc-mini-backdrop"
      role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="sc-mini-dialog sc-feedback-dialog" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="sc-mini-head">
          <h2 id={titleId}>发送反馈</h2>
          <button ref={closeRef} type="button" className="sc-mini-close" aria-label="关闭反馈" onClick={onClose}>×</button>
        </div>
        <p className="sc-mini-copy">有问题、想法，或现场和方案对不上，都可以写。提交后会开到 GitHub Issues，方便按条目跟进。</p>
        <textarea
          aria-label="反馈内容"
          rows={5}
          placeholder="请描述遇到的情况，以及你预期会怎样。"
          value={text}
          onChange={event => setText(event.target.value)}
        />
        <label className="sc-mini-check">
          <input type="checkbox" checked={includePlan} onChange={event => setIncludePlan(event.target.checked)} />
          <span><strong>附上当前方案信息</strong><small>方案名称、户外或室内、红线与画布状态，便于复现。不含账号或密钥。</small></span>
        </label>
        <label className="sc-mini-check">
          <input type="checkbox" checked={includeShot} onChange={event => setIncludeShot(event.target.checked)} />
          <span><strong>附上当前画布截图</strong><small>只截规划画布。图片会先下载，再到 issue 里附上。</small></span>
        </label>
        <label className="sc-mini-check">
          <input type="checkbox" checked={includeBrowser} onChange={event => setIncludeBrowser(event.target.checked)} />
          <span><strong>附上浏览器信息</strong><small>可选，用来排查显示或操作异常。</small></span>
        </label>
        {error ? <p className="sc-account-error" role="alert">{error}</p> : null}
        <div className="sc-mini-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="button" className="sc-mini-primary" disabled={busy} onClick={() => { void submit(); }}>提交到 GitHub</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
