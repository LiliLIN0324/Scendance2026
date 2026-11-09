// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { materialCheckinLedgerSchema } from '../../../../supabase/functions/_shared/material-checkin-contract';
import { mergeStoredMaterialCheckins, readMaterialCheckins } from '../../../lib/material-checkin-storage';
import { useMaterialCheckins, type MaterialCheckinState } from './use-material-checkins';
import { createLocalWriteLeaseManager, type LocalWriteCapability } from '../../../lib/local-write-lease';

vi.mock('../../../lib/material-checkin-storage', async original => ({ ...await original<typeof import('../../../lib/material-checkin-storage')>(),
  readMaterialCheckins: vi.fn(), mergeStoredMaterialCheckins: vi.fn() }));
const ledger = (projectId: string) => materialCheckinLedgerSchema.parse({ projectId, dataKind: 'rehearsal' });
const channels: Channel[] = [];
class Channel {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage = vi.fn(); close = vi.fn();
  constructor() { channels.push(this); }
}
let state: MaterialCheckinState;
const prepare = vi.fn(async () => () => {});
function View({ projectId = 'house-a', enabled = true, capability }: { projectId?: string; enabled?: boolean; capability?: LocalWriteCapability }) {
  state = useMaterialCheckins({ projectId, enabled, prepareWrite: prepare, ...(capability ? {writeCapability:capability} : {}) });
  return <output>{state.ready ? state.ledger?.projectId ?? '无点验' : state.error ?? '读取中'}</output>;
}
beforeEach(() => {
  vi.clearAllMocks(); channels.length = 0; vi.stubGlobal('BroadcastChannel', Channel);
  prepare.mockResolvedValue(() => {});
  vi.mocked(readMaterialCheckins).mockImplementation(async projectId => ledger(projectId));
  vi.mocked(mergeStoredMaterialCheckins).mockImplementation(async (_projectId, value, guard) => { guard?.(); return value; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('material checkin view lifecycle', () => {
  it('ignores a previous project read arriving after another project is active', async () => {
    let finish!: (value: ReturnType<typeof ledger>) => void;
    vi.mocked(readMaterialCheckins).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<View/>); view.rerender(<View projectId="house-b"/>);
    await waitFor(() => expect(state.ledger?.projectId).toBe('house-b'));
    await act(async () => { finish(ledger('house-a')); });
    expect(state.ledger?.projectId).toBe('house-b'); expect(channels[0].close).toHaveBeenCalledOnce();
  });
  it('does not reuse an old ready snapshot after A to B to A or read data in cloud mode', async () => {
    const view = render(<View/>); await waitFor(() => expect(state.ready).toBe(true));
    let finish!: (value: ReturnType<typeof ledger>) => void;
    view.rerender(<View projectId="house-b"/>); await waitFor(() => expect(state.ledger?.projectId).toBe('house-b'));
    vi.mocked(readMaterialCheckins).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    view.rerender(<View/>); expect(state.ready).toBe(false); expect(state.ledger).toBeUndefined();
    await act(async () => { finish(ledger('house-a')); }); await waitFor(() => expect(state.ready).toBe(true));
    const reads = vi.mocked(readMaterialCheckins).mock.calls.length;
    view.rerender(<View enabled={false}/>); expect(state.ledger).toBeUndefined(); expect(state.loading).toBe(false);
    expect(readMaterialCheckins).toHaveBeenCalledTimes(reads);
  });
  it('refreshes on local focus and matching cross-tab notifications only', async () => {
    render(<View/>); await waitFor(() => expect(state.ready).toBe(true));
    await act(async () => { channels[0].onmessage?.({ data: 'other-project' }); });
    expect(readMaterialCheckins).toHaveBeenCalledTimes(1);
    await act(async () => { channels[0].onmessage?.({ data: 'house-a' }); });
    expect(readMaterialCheckins).toHaveBeenCalledTimes(2);
    await act(async () => { fireEvent.focus(window); }); expect(readMaterialCheckins).toHaveBeenCalledTimes(3);
  });
  it('keeps a committed save successful even when the notification channel fails', async () => {
    render(<View/>); await waitFor(() => expect(state.ready).toBe(true));
    channels[0].postMessage.mockImplementation(() => { throw new Error('closed'); });
    await act(async () => { await state.onSave(ledger('house-a')); });
    expect(state.ready).toBe(true); expect(state.saving).toBe(false); expect(state.ledger?.projectId).toBe('house-a');
  });
  it('blocks a late save after scope changes and rejects repeated submission while pending', async () => {
    let release!: () => void; prepare.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(() => {}); }));
    const view = render(<View/>); await waitFor(() => expect(state.ready).toBe(true));
    let pending!: Promise<void>;
    act(() => { pending = state.onSave(ledger('house-a')); });
    await expect(state.onSave(ledger('house-a'))).rejects.toThrow('正在保存');
    view.rerender(<View projectId="house-b"/>); await waitFor(() => expect(state.ledger?.projectId).toBe('house-b'));
    await act(async () => { release(); await expect(pending).rejects.toThrow('项目已切换'); });
    expect(state.ledger?.projectId).toBe('house-b');
  });
  it('排队准备期间失锁，不触发写入且保留点验输入和未确认提示', async () => {
    const locks={request(_name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){return callback({name:'writer'});}} as unknown as LockManager;
    vi.stubGlobal('navigator',{locks});const manager=createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage});const lease=await manager.acquire();
    let resume!:(guard:()=>void)=>void;prepare.mockImplementationOnce(()=>new Promise(resolve=>{resume=resolve;}));
    render(<View capability={lease.capability}/>);await waitFor(()=>expect(state.ready).toBe(true));
    const proposal=ledger('house-a'),original=structuredClone(proposal);let pending!:Promise<void>;
    act(()=>{pending=state.onSave(proposal);});await lease.release();
    await act(async()=>{resume(()=>{});await expect(pending).rejects.toThrow('点验未能确认保存');});
    expect(proposal).toEqual(original);expect(state.ledger?.projectId).toBe('house-a');expect(mergeStoredMaterialCheckins).not.toHaveBeenCalled();
  });
  it('接入过 capability 后失去凭证不降级为无保护写入',async()=>{
    const locks={request(_name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){return callback({name:'writer'});}} as unknown as LockManager;
    vi.stubGlobal('navigator',{locks});const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
    const view=render(<View capability={lease.capability}/>);await waitFor(()=>expect(state.ready).toBe(true));
    view.rerender(<View/>);const proposal=ledger('house-a'),original=structuredClone(proposal);
    await act(async()=>{await expect(state.onSave(proposal)).rejects.toThrow('点验未能确认保存');});
    expect(prepare).not.toHaveBeenCalled();expect(mergeStoredMaterialCheckins).not.toHaveBeenCalled();expect(proposal).toEqual(original);await lease.release();
  });
  it('保存排队时 capability 被替换会拒绝原请求',async()=>{
    const locks={request(_name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){return callback({name:'writer'});}} as unknown as LockManager;
    vi.stubGlobal('navigator',{locks});const manager=createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage});const a=await manager.acquire(),b=await manager.acquire();
    let resume!:(guard:()=>void)=>void;prepare.mockImplementationOnce(()=>new Promise(resolve=>{resume=resolve;}));
    const view=render(<View capability={a.capability}/>);await waitFor(()=>expect(state.ready).toBe(true));let pending!:Promise<void>;
    act(()=>{pending=state.onSave(ledger('house-a'));});view.rerender(<View capability={b.capability}/>);
    await act(async()=>{resume(()=>{});await expect(pending).rejects.toThrow('编辑权已变化');});
    expect(mergeStoredMaterialCheckins).not.toHaveBeenCalled();await a.release();await b.release();
  });
  it('reports a failed read and can explicitly retry without inventing an empty ledger', async () => {
    vi.mocked(readMaterialCheckins).mockRejectedValueOnce(new Error('原账无法读取'));
    render(<View/>); await waitFor(() => expect(state.error).toBe('原账无法读取'));
    expect(state.ready).toBe(false); expect(state.ledger).toBeUndefined();
    act(() => state.retry()); await waitFor(() => expect(state.ready).toBe(true)); expect(state.error).toBeNull();
  });
});
