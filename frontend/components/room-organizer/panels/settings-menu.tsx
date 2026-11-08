'use client';

/**
 * 画布左下角「设置」：切回官网、购买重建次数、新手指引与 GitHub。
 */
import { BookOpen, Home, Scan, Settings } from '@/components/solid-icons';
import { useEffect, useRef, useState, type RefObject } from 'react';

const HOME_URL = '/introduction';
const GETTING_STARTED_URL = '/guide';
const PRICING_URL = '/pricing';
const GITHUB_URL = 'https://github.com/LiliLIN0324/Scendance2026';

function GithubMark(): JSX.Element {
  return <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>;
}

export function SettingsMenu({ buttonRef }: { buttonRef?: RefObject<HTMLButtonElement> }): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return <div className="sc-tool-menu sc-rail-settings-wrap" ref={rootRef}>
    <button ref={buttonRef} type="button" className={`sc-rail-settings${open ? ' is-active' : ''}`} aria-label="设置" data-tip="设置" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(current => !current)}>
      <Settings size={22} aria-hidden="true"/>
    </button>
    {open && <div className="sc-tool-pop sc-settings-pop" role="dialog" aria-label="设置">
      {/* 官网是站内页面，同页返回落地页；其余三条去外部网站，另开标签。 */}
      <a className="sc-settings-link" href={HOME_URL}>
        <Home size={15} aria-hidden="true"/><span>切回官网</span>
      </a>
      <span className="sc-more-sep" aria-hidden="true"/>
      <a className="sc-settings-link" href={PRICING_URL}>
        <Scan size={15} aria-hidden="true"/><span>购买重建次数</span>
      </a>
      <a className="sc-settings-link" href={GETTING_STARTED_URL} target="_blank" rel="noopener noreferrer">
        <BookOpen size={15} aria-hidden="true"/><span>新手指引</span>
      </a>
      <a className="sc-settings-link" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
        <GithubMark/><span>GitHub</span>
      </a>
    </div>}
  </div>;
}
