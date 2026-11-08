'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
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
  if (!checked || checked.source !== getStorage) return <div role="status">正在核对本机恢复状态，请稍候。</div>;
  const state = checked.value;
  const safePath = (pathname ?? '').replace(/\/$/, '');
  if (state.status === 'blocked' && ['/auth', '/auth/callback', '/reset-password', '/view'].includes(safePath)) return <>{children}</>;
  if (state.status === 'blocked') return <section role="alert" aria-label="本机恢复待核对">
    <h1>本机资料需要核对</h1>
    <p>{state.reason === 'pending' ? '检测到上次恢复尚未核对完成。' : state.reason === 'completed' ? '上次恢复已记录完成，但完成记录仍需核对。' : '无法读取或识别本机恢复记录。'}</p>
    <p>编辑和导出已暂停。请保留当前浏览器资料与原备份文件；不要删除本机数据。恢复核对功能尚未开放。</p>
    <button type="button" onClick={() => setChecked(inspect())}>重新检查</button>
  </section>;
  return <>{children}</>;
}
