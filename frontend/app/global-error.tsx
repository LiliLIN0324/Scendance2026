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
        <style>{`
          .sc-global-recovery{box-sizing:border-box;margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 24% 18%,#fff9,transparent 60%),#f1f3f6;color:#2b2b2b;font-family:'Helvetica Neue',Arial,'PingFang SC','Microsoft YaHei',sans-serif}
          .sc-global-recovery-card{max-width:440px;box-sizing:border-box;padding:32px;border-radius:20px;border:1px solid #ffffffc4;background:linear-gradient(145deg,#ffffff70,transparent 45%),#ffffffc2;box-shadow:0 12px 36px #24313e10,inset 0 1px 0 #fff,inset 0 0 0 1px #ffffff52;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
          .sc-global-recovery-title{margin:0 0 12px;font-size:22px;font-weight:600;line-height:1.4;letter-spacing:-.045em}
          .sc-global-recovery-copy{margin:0 0 20px;color:#59636d;font-size:13px;line-height:1.8}
          .sc-global-recovery button{appearance:none;cursor:pointer;border:1px solid #2b2b2b;border-radius:8px;padding:10px 16px;background:#2b2b2b;color:#fff;font-family:inherit;font-size:12px;font-weight:500;transition:background 160ms cubic-bezier(.22,1,.36,1),transform 160ms cubic-bezier(.22,1,.36,1)}
          .sc-global-recovery button:focus-visible{outline:2px solid #0a5f5c;outline-offset:3px}
          .sc-global-recovery button:active{transform:translateY(1px)}
          @media(hover:hover) and (pointer:fine){.sc-global-recovery button:hover{background:#414141}}
          @supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.sc-global-recovery-card{background:#f8f9fb}}
          @media(prefers-reduced-motion:reduce){.sc-global-recovery button{transition:none}.sc-global-recovery button:active{transform:none}}
          @media(max-width:600px){.sc-global-recovery-card{padding:24px}}
        `}</style>
      </head>
      <body className="sc-global-recovery">
        <div className="sc-global-recovery-card">
          <p className="sc-global-recovery-title">
            {chunkFailure ? '页面加载失败' : '工作台暂时遇到问题'}
          </p>
          <p className="sc-global-recovery-copy">
            {chunkFailure
              ? '部分页面文件未能加载，请重新加载。已保存的本地草稿不会被删除。'
              : resetProblem ??
                '工作台暂时无法打开。“开始新方案”会先尝试在本机保留草稿副本；若备份失败，会显示具体提示。'}
          </p>
          {/* After a failed move this page holds the only copy: no button that
              would reload it away until the user has downloaded it. */}
          {!lostRaw && (
          <button
            type="button"
            onClick={chunkFailure ? retryChunkLoad : resetSavedLayout}
          >
            {chunkFailure ? '重新加载' : '保留备份，开始新方案'}
          </button>
          )}
          {lostRaw && (
            <button
              type="button"
              onClick={() => downloadRawLayout(lostRaw, 'scendance-layout.json')}
            >
              下载本地草稿
            </button>
          )}
        </div>
      </body>
    </html>
  );
}
