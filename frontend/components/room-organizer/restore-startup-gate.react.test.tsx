// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESTORE_JOURNAL_MARKER } from '@/lib/restore-journal';
import { inspectRestoreStartup } from '@/lib/restore-startup';
import { RestoreStartupGate } from './restore-startup-gate';
const pathState=vi.hoisted(()=>({path:'/'}));
vi.mock('next/navigation',()=>({usePathname:()=>pathState.path}));

afterEach(()=>{cleanup();localStorage.clear();pathState.path='/';});
function Editor({mounted}:{mounted:()=>void}) { mounted();return <div>编辑器与自动保存</div>; }

describe('restore startup gate',()=>{
  it('服务端或首次检查前不挂载编辑器',()=>{
    const mounted=vi.fn();
    expect(renderToString(<RestoreStartupGate><Editor mounted={mounted}/></RestoreStartupGate>)).toContain('正在核对');
    expect(mounted).not.toHaveBeenCalled();
  });
  it('无标记时检查通过后才挂载',()=>{
    const mounted=vi.fn();render(<RestoreStartupGate><Editor mounted={mounted}/></RestoreStartupGate>);
    expect(screen.getByText('编辑器与自动保存')).toBeTruthy();expect(mounted).toHaveBeenCalled();
  });
  it('标记存在时阻断编辑器，重新检查也不会清除标记',()=>{
    localStorage.setItem(RESTORE_JOURNAL_MARKER,JSON.stringify({version:1,id:'restore-1'}));
    const mounted=vi.fn();render(<RestoreStartupGate><Editor mounted={mounted}/></RestoreStartupGate>);
    expect(screen.getByRole('alert').textContent).toContain('上次恢复尚未核对完成');
    fireEvent.click(screen.getByRole('button',{name:'重新检查'}));
    expect(mounted).not.toHaveBeenCalled();expect(localStorage.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
  });
  it.each(['/auth','/auth/callback','/reset-password','/view'])('恢复待核对时只允许指定的只读或认证路由 %s',path=>{
    pathState.path=path;localStorage.setItem(RESTORE_JOURNAL_MARKER,JSON.stringify({version:1,id:'restore-1'}));
    const mounted=vi.fn();render(<RestoreStartupGate><Editor mounted={mounted}/></RestoreStartupGate>);
    expect(mounted).toHaveBeenCalled();expect(localStorage.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
  });
  it.each(['/','/editor','/auth/callback/other','/view/private','/settings'])('非白名单路由 %s 不能挂载',path=>{
    pathState.path=path;localStorage.setItem(RESTORE_JOURNAL_MARKER,JSON.stringify({version:1,id:'restore-1'}));
    const mounted=vi.fn();render(<RestoreStartupGate><Editor mounted={mounted}/></RestoreStartupGate>);
    expect(mounted).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toBeTruthy();
    expect((window as unknown as {__pcRecoveryGateReady?:boolean}).__pcRecoveryGateReady).toBe(true);
  });
  it('进入恢复核对页后 watchdog 就绪信号会在卸载时清除',()=>{
    localStorage.setItem(RESTORE_JOURNAL_MARKER,JSON.stringify({version:1,id:'restore-1'}));
    const view=render(<RestoreStartupGate><div>编辑器</div></RestoreStartupGate>);
    expect((window as unknown as {__pcRecoveryGateReady?:boolean}).__pcRecoveryGateReady).toBe(true);
    view.unmount();expect((window as unknown as {__pcRecoveryGateReady?:boolean}).__pcRecoveryGateReady).toBe(false);
  });
  it('完成标记仍冻结并告知完成记录待核对',()=>{
    localStorage.setItem(RESTORE_JOURNAL_MARKER,JSON.stringify({version:1,id:'restore-1',state:'completed',direction:'apply',digest:'a'.repeat(64)}));
    const mounted=vi.fn();render(<RestoreStartupGate><Editor mounted={mounted}/></RestoreStartupGate>);
    expect(screen.getByRole('alert').textContent).toContain('完成记录仍需核对');expect(mounted).not.toHaveBeenCalled();
  });
  it('损坏标记、无法获得或读取存储均阻断，保留原标记',()=>{
    localStorage.setItem(RESTORE_JOURNAL_MARKER,'damaged');
    expect(inspectRestoreStartup(()=>localStorage)).toEqual({status:'blocked',reason:'unreadable'});
    expect(inspectRestoreStartup(()=>null)).toEqual({status:'blocked',reason:'unreadable'});
    const failing={getItem:()=>{throw new Error('blocked');}} as unknown as Storage;
    const mounted=vi.fn();render(<RestoreStartupGate getStorage={()=>failing}><Editor mounted={mounted}/></RestoreStartupGate>);
    expect(screen.getByRole('alert').textContent).toContain('无法读取或识别');expect(mounted).not.toHaveBeenCalled();
    expect(localStorage.getItem(RESTORE_JOURNAL_MARKER)).toBe('damaged');
  });
});
