// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalWriteLeaseProvider, useLocalWriteLease } from './local-write-lease-provider';
import type { LocalWriteLease } from '@/lib/local-write-lease';

function deferred<T>() { let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; }
function fakeLease() {
  const listeners=new Set<()=>void>();let valid=true;
  const lease={assertWritable(){if(!valid)throw new Error('失效');},onLost(fn:()=>void){listeners.add(fn);return ()=>listeners.delete(fn);},release:vi.fn().mockResolvedValue(undefined)} as unknown as LocalWriteLease;
  return {lease,lose(){valid=false;for(const fn of listeners)fn();}};
}
function Editor({onUnmount}:{onUnmount:()=>void}) {
  const lease=useLocalWriteLease();const [text,setText]=useState('');
  useEffect(()=>()=>onUnmount(),[onUnmount]);
  return <label>草稿<input aria-label="草稿" value={text} onChange={event=>setText(event.target.value)}/><button onClick={()=>lease.assertWritable()}>保存</button></label>;
}
afterEach(()=>cleanup());
describe('local write lease provider',()=>{
  it('服务端和等待期间不挂载编辑器，只有取得租约后才开放',async()=>{
    const pending=deferred<LocalWriteLease>(),manager={acquire:()=>pending.promise},unmount=vi.fn();
    expect(renderToString(<LocalWriteLeaseProvider manager={manager}><Editor onUnmount={unmount}/></LocalWriteLeaseProvider>)).toContain('正在核对');
    render(<LocalWriteLeaseProvider manager={manager}><Editor onUnmount={unmount}/></LocalWriteLeaseProvider>);
    expect(screen.queryByLabelText('草稿')).toBeNull();
    const acquired=fakeLease();await act(async()=>pending.resolve(acquired.lease));
    expect(screen.getByLabelText('草稿')).toBeTruthy();
  });
  it('竞争失败时显示只读并允许重试，不启动写入组件',async()=>{
    const acquired=fakeLease(),manager={acquire:vi.fn().mockRejectedValueOnce(new Error('另一窗口正在编辑')).mockResolvedValue(acquired.lease)};
    render(<LocalWriteLeaseProvider manager={manager}><Editor onUnmount={vi.fn()}/></LocalWriteLeaseProvider>);
    expect((await screen.findByRole('alert')).textContent).toContain('另一窗口正在编辑');expect(screen.queryByLabelText('草稿')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'重新核对编辑权'}));await screen.findByLabelText('草稿');expect(manager.acquire).toHaveBeenCalledTimes(2);
  });
  it('失锁后保留原草稿 DOM、禁止交互并明确提示只读',async()=>{
    const acquired=fakeLease(),manager={acquire:async()=>acquired.lease},unmount=vi.fn();
    render(<LocalWriteLeaseProvider manager={manager}><Editor onUnmount={unmount}/></LocalWriteLeaseProvider>);
    const input=await screen.findByLabelText('草稿') as HTMLInputElement;
    fireEvent.change(input,{target:{value:'未保存的真实草稿'}});
    act(()=>acquired.lose());
    expect(screen.getByRole('alert').textContent).toContain('保存已暂停');
    expect((screen.getByLabelText('草稿') as HTMLInputElement).value).toBe('未保存的真实草稿');
    expect(screen.getByLabelText('草稿').closest('[inert]')).not.toBeNull();expect(unmount).not.toHaveBeenCalled();
  });
  it('失锁后重试失败也保留未保存草稿',async()=>{
    const acquired=fakeLease(),manager={acquire:vi.fn().mockResolvedValueOnce(acquired.lease).mockRejectedValueOnce(new Error('其他窗口仍在编辑'))},unmount=vi.fn();
    render(<LocalWriteLeaseProvider manager={manager}><Editor onUnmount={unmount}/></LocalWriteLeaseProvider>);
    fireEvent.change(await screen.findByLabelText('草稿'),{target:{value:'重要草稿'}});act(()=>acquired.lose());
    fireEvent.click(screen.getByRole('button',{name:'重新核对编辑权'}));
    await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('其他窗口仍在编辑'));
    expect((screen.getByLabelText('草稿') as HTMLInputElement).value).toBe('重要草稿');expect(unmount).not.toHaveBeenCalled();
  });
  it('组件卸载后迟到的租约会释放而不会启动编辑器',async()=>{
    const pending=deferred<LocalWriteLease>(),manager={acquire:()=>pending.promise},acquired=fakeLease(),unmount=vi.fn();
    const view=render(<LocalWriteLeaseProvider manager={manager}><Editor onUnmount={unmount}/></LocalWriteLeaseProvider>);view.unmount();
    await act(async()=>pending.resolve(acquired.lease));await waitFor(()=>expect(acquired.lease.release).toHaveBeenCalledOnce());
    expect(unmount).not.toHaveBeenCalled();
  });
});
