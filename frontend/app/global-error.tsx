'use client';

import { useEffect, useState } from 'react';
import {
  clearChunkReloadGuard,
  isChunkLoadError,
  reloadOnceForChunkError,
} from '../components/room-organizer/lib/chunk-reload';
import { downloadRawLayout, readStoredLayoutRaw, resetStoredLayout } from '../components/room-organizer/lib/persistence';

// Global error boundary — catches errors thrown in the root layout itself (and
// in app/error.tsx), so it must render its own <html>/<body>. Starting fresh
// keeps a copy of the saved house first, like app/error.tsx (#336).
//
// The styles live inline on purpose: this boundary can render when the app's
// stylesheet never loaded, so it carries its own flat tokens (#2026 redesign).

const pageStyles = `
  .sc-global-error{box-sizing:border-box;margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#f4f5f7;color:#141416;font-family:'Helvetica Neue',Arial,'PingFang SC','Microsoft YaHei',sans-serif}
  .sc-global-error-card{display:grid;justify-items:center;gap:8px;max-width:440px;box-sizing:border-box;text-align:center}
  .sc-global-error-icon{display:grid;place-items:center;height:32px;color:#b4443c}
  .sc-global-error-title{margin:0;font-size:20px;line-height:28px;font-weight:600;letter-spacing:-.01em}
  .sc-global-error-copy{margin:0;max-width:400px;color:#71767e;font-size:13px;line-height:22px}
  .sc-global-error-acts{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px;margin-top:8px}
  .sc-global-error button{appearance:none;cursor:pointer;height:34px;padding:0 16px;border-radius:8px;font-family:inherit;font-size:13px;font-weight:500}
  .sc-global-error-primary{border:1px solid #141416;background:#141416;color:#fff}
  .sc-global-error-primary:hover{background:#2a2c31}
  .sc-global-error-ghost{border:0;background:transparent;color:#71767e;padding:0 12px}
  .sc-global-error-ghost:hover{background:#eceef0;color:#55585f}
  .sc-global-error button:focus-visible{outline:2px solid #55585f;outline-offset:2px}
  @media(prefers-reduced-motion:reduce){.sc-global-error button{transition:none}}
`;

export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }): JSX.Element {
  useEffect(() => {
    // One automatic reload per session via the shared pc-chunk-reload guard —
    // see app/error.tsx: an unguarded reload looped forever on a persistently
    // missing chunk and made the recovery UI unreachable (#143).
    reloadOnceForChunkError(error);
  }, [error]);

  // A persistent chunk failure is a deploy problem, not a corrupt save; keep
  // the user's layout and offer a plain retry instead (#143).
  const chunkFailure = isChunkLoadError(error);
  const retryChunkLoad = () => {
    clearChunkReloadGuard();
    window.location.reload();
  };

  const [resetProblem, setResetProblem] = useState<string | null>(null);
  // Read before the reset: on a failed move this is the only copy left.
  const [lostRaw, setLostRaw] = useState<string | null>(null);
  const resetSavedLayout = () => {
    const raw = readStoredLayoutRaw();
    const outcome = resetStoredLayout();
    // Nothing stored (or storage unreadable): nothing to lose, just reload.
    if (outcome === 'refused' && raw === null) {
      window.location.reload();
      return;
    }
    if (outcome === 'refused') {
      setResetProblem('浏览器无法保存备份，原草稿未删除。请释放存储空间或允许本站使用存储后重试。');
      return;
    }
    if (outcome === 'lost') {
      setLostRaw(raw);
      setResetProblem('浏览器存储失败，请在离开此页前下载当前草稿。');
      return;
    }
    // Hard reload rather than the soft `reset()`: the layout is a module-level
    // Zustand singleton, so a soft remount would keep the crash-causing layout
    // in memory and re-crash. A full reload re-evaluates the module fresh.
    window.location.reload();
  };

  return (
    <html lang="zh-CN">
      <head>
        <style>{pageStyles}</style>
      </head>
      <body className="sc-global-error">
        <div className="sc-global-error-card">
          <span className="sc-global-error-icon" aria-hidden>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
          </span>
          <h1 className="sc-global-error-title">
            {chunkFailure ? '页面加载失败' : '工作台暂时遇到问题'}
          </h1>
          <p className="sc-global-error-copy">
            {chunkFailure
              ? '部分页面文件未能加载，请重新加载。已保存的本地草稿不会被删除。'
              : resetProblem ??
                '工作台暂时无法打开。“开始新方案”会先尝试在本机保留草稿副本；若备份失败，会显示具体提示。'}
          </p>
          {/* After a failed move this page holds the only copy: no button that
              would reload it away until the user has downloaded it. */}
          <div className="sc-global-error-acts">
            {!lostRaw && (
              <button
                type="button"
                className="sc-global-error-primary"
                onClick={chunkFailure ? retryChunkLoad : resetSavedLayout}
              >
                {chunkFailure ? '重新加载' : '保留备份，开始新方案'}
              </button>
            )}
            {lostRaw && (
              <button
                type="button"
                className="sc-global-error-primary"
                onClick={() => downloadRawLayout(lostRaw, 'scendance-layout.json')}
              >
                下载本地草稿
              </button>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}