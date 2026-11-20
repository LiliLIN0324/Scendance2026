'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { BootSkeleton } from '@/components/workspace-shell';
import { inspectRestoreStartup, type RestoreStartupState } from '@/lib/restore-startup';

/** Mount outside the editor and all persistence providers. This component never clears a marker. */
export function RestoreStartupGate({ children, getStorage }: {
  children: ReactNode;
  /** Injectable only for testing and embedding; the default is the browser's localStorage. */
  getStorage?: () => Storage | null;
}) {
  const pathname = usePathname();
  const [checked, setChecked] = useState<{ source: typeof getStorage; value: RestoreStartupState } | null>(null);
  const inspect = () => ({ source: getStorage, value: inspectRestoreStartup(getStorage ?? (() => window.localStorage)) });
  useEffect(() => { setChecked(inspect()); }, [getStorage]);
  useEffect(() => {
    const blocked = !!checked && checked.source === getStorage && checked.value.status === 'blocked';
    (window as unknown as { __pcRecoveryGateReady?: boolean }).__pcRecoveryGateReady = blocked;
    return () => { (window as unknown as { __pcRecoveryGateReady?: boolean }).__pcRecoveryGateReady = false; };
  }, [checked, getStorage]);
  // 核对完成前不能挂载子树；占位沿用工作台骨架屏，避免首屏出现裸文本。
  if (!checked || checked.source !== getStorage) return <BootSkeleton />;
  const state = checked.value;
  const safePath = (pathname ?? '').replace(/\/$/, '');
  if (state.status === 'blocked' && ['/auth', '/auth/callback', '/reset-password', '/view'].includes(safePath)) return <>{children}</>;
  if (state.status === 'blocked') return <section role="alert" aria-label="本机恢复待核对">
    <h1>本机资料需要核对</h1>
    <p>{state.reason === 'pending' ? '上次恢复还没核对完。' : state.reason === 'completed' ? '恢复记录还需核对。' : '读不到本机恢复记录。'}</p>
    <p>编辑和导出已暂停。核对入口还没开放。</p>
    <p>请保留备份。</p>
    <button type="button" onClick={() => setChecked(inspect())}>重新检查</button>
  </section>;
  return <>{children}</>;
}
