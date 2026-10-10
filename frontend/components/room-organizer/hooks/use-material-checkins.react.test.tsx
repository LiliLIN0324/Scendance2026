// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { materialCheckinLedgerSchema } from '../../../../supabase/functions/_shared/material-checkin-contract';
import { mergeStoredMaterialCheckins, readMaterialCheckins } from '../../../lib/material-checkin-storage';
import { useMaterialCheckins, type MaterialCheckinState } from './use-material-checkins';

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
function View({ projectId = 'house-a', enabled = true }: { projectId?: string; enabled?: boolean }) {
  state = useMaterialCheckins({ projectId, enabled, prepareWrite: prepare });
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
  it('reports a failed read and can explicitly retry without inventing an empty ledger', async () => {
    vi.mocked(readMaterialCheckins).mockRejectedValueOnce(new Error('原账无法读取'));
    render(<View/>); await waitFor(() => expect(state.error).toBe('原账无法读取'));
    expect(state.ready).toBe(false); expect(state.ledger).toBeUndefined();
    act(() => state.retry()); await waitFor(() => expect(state.ready).toBe(true)); expect(state.error).toBeNull();
  });
});
