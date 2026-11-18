'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatBuildInfo, readBuildInfo } from '@/lib/build-info';
import { useDialogFocus } from '../hooks/use-dialog-focus';

const HOME_URL = '/introduction';
const GITHUB_URL = 'https://github.com/LiliLIN0324/Scendance2026';

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  useDialogFocus(open, panelRef, { initialFocusRef: closeRef, onEscape: onClose, trap: true });
  if (!open || typeof document === 'undefined') return null;

  const info = readBuildInfo();
  const versionLine = info.version ? info.version : '版本未写入这次构建';
  const commitLine = info.commit ? info.commit : '提交未写入这次构建';

  async function copyVersion(): Promise<void> {
    const text = formatBuildInfo(info);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return createPortal(
    <div className="sc-mini-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sc-mini-dialog sc-about-dialog" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="sc-about-title" tabIndex={-1}>
        <button ref={closeRef} type="button" className="sc-mini-close" aria-label="关闭关于" onClick={onClose}>×</button>
        <h2 id="sc-about-title">Scendance</h2>
        <p className="sc-about-line">活动场地规划工作台</p>
        <p className="sc-about-brand">幕景宇宙</p>
        <nav className="sc-about-links" aria-label="产品链接">
          <a href={HOME_URL}>产品官网</a>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub 仓库</a>
        </nav>
        <button type="button" className="sc-about-copy" onClick={() => { void copyVersion(); }}>
          {copied ? '已复制' : '复制版本信息'}
          <small>{versionLine} · {commitLine}</small>
        </button>
      </div>
    </div>,
    document.body,
  );
}
