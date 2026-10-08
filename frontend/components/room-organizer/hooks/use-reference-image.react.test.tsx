// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveReferenceImage } from '@/lib/reference-image';
import { listStoredSources, readSourceForm, subscribeSourceChanges, type StoredSource } from '@/lib/source-storage';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { layoutGeometryScene } from '../lib/structural-layout';
import { useReferenceImage } from './use-reference-image';

vi.mock('@/lib/reference-image', () => ({ resolveReferenceImage: vi.fn() }));
vi.mock('@/lib/source-storage', () => ({ listStoredSources: vi.fn(), readSourceForm: vi.fn(), subscribeSourceChanges: vi.fn() }));

class ControlledImage {
  static instances: ControlledImage[] = [];
  naturalWidth = 0; naturalHeight = 0;
  onload: (() => void) | null = null; onerror: (() => void) | null = null;
  src = '';
  constructor() { ControlledImage.instances.push(this); }
  load(width = 200, height = 100) { this.naturalWidth = width; this.naturalHeight = height; this.onload?.(); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}
function v2(scope: string) {
  const base = makeLayout({ id: scope });
  return { ...base, backendSceneV2: layoutGeometryScene(base) };
}
function source(scope = 'A', id = `${scope}-source`): StoredSource {
  return { id, scope, name: '独立测试原图', kind: 'floorplan', width: 200, height: 100,
    blob: new Blob(['test image pixels'], { type: 'image/png' }) };
}

describe('read-only main canvas reference source', () => {
  const objectUrl = vi.fn<(blob: Blob) => string>(), revokeUrl = vi.fn();
  let subscriptions: Map<string, () => void>;
  beforeEach(() => {
    vi.clearAllMocks(); ControlledImage.instances = []; subscriptions = new Map();
    vi.stubGlobal('Image', ControlledImage);
    let nextUrl = 0;
    objectUrl.mockImplementation(() => `blob:reference-test-${++nextUrl}`);
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: objectUrl, revokeObjectURL: revokeUrl }));
    vi.mocked(listStoredSources).mockResolvedValue([source()]);
    vi.mocked(readSourceForm).mockResolvedValue({ registration: 'test applied basis' });
    vi.mocked(subscribeSourceChanges).mockImplementation((scope, callback) => {
      subscriptions.set(scope, callback); return () => { if (subscriptions.get(scope) === callback) subscriptions.delete(scope); };
    });
    vi.mocked(resolveReferenceImage).mockImplementation((_layout, sources) => sources[0]
      ? { status: 'ready', notice: '测试已对应', source: sources[0], imageToWorld: [0.05, 0, 0, 0.08, 0, 0] }
      : { status: 'needs-review', notice: '没有原图对应依据' });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it.each(['sources', 'form'] as const)('does not turn a failed %s read into a ready default', async failed => {
    if (failed === 'sources') vi.mocked(listStoredSources).mockRejectedValueOnce(new Error('read refused'));
    else vi.mocked(readSourceForm).mockRejectedValueOnce(new Error('read refused'));
    const { result } = renderHook(() => useReferenceImage(v2('A')));
    await waitFor(() => expect(result.current.notice).toContain('读取失败'));
    expect(result.current.ready).toBe(false); expect(result.current.layer).toBeUndefined();
    expect(resolveReferenceImage).not.toHaveBeenCalled(); expect(objectUrl).not.toHaveBeenCalled();
  });

  it('returns a layer only after decoding the actual source dimensions and revokes it on unmount', async () => {
    const selected = source(); vi.mocked(listStoredSources).mockResolvedValueOnce([selected]);
    const { result, unmount } = renderHook(() => useReferenceImage(v2('A')));
    await waitFor(() => expect(ControlledImage.instances).toHaveLength(1));
    expect(result.current.ready).toBe(false); expect(result.current.layer).toBeUndefined();
    act(() => ControlledImage.instances[0].load());
    expect(result.current.layer).toMatchObject({ url: 'blob:reference-test-1', pixelWidth: 200, pixelHeight: 100 });
    expect(objectUrl).toHaveBeenCalledWith(selected.blob);
    unmount(); expect(revokeUrl).toHaveBeenCalledWith('blob:reference-test-1');
  });

  it.each(['dimensions', 'decode'] as const)('refuses the layer after a %s failure', async failure => {
    const { result, unmount } = renderHook(() => useReferenceImage(v2('A')));
    await waitFor(() => expect(ControlledImage.instances).toHaveLength(1));
    act(() => failure === 'dimensions' ? ControlledImage.instances[0].load(201, 100) : ControlledImage.instances[0].onerror?.());
    expect(result.current.layer).toBeUndefined(); expect(result.current.ready).toBe(false);
    expect(result.current.notice).toContain(failure === 'dimensions' ? '实际尺寸' : '无法读取');
    unmount(); expect(revokeUrl).toHaveBeenCalledWith('blob:reference-test-1');
  });

  it('rejects old reads and image callbacks through A to B to A, without reviving revoked URLs', async () => {
    const pending: ReturnType<typeof deferred<StoredSource[]>>[] = [];
    vi.mocked(listStoredSources).mockImplementation(() => { const value = deferred<StoredSource[]>(); pending.push(value); return value.promise; });
    const { result, rerender, unmount } = renderHook(({ layout }) => useReferenceImage(layout), { initialProps: { layout: v2('A') } });
    rerender({ layout: v2('B') }); rerender({ layout: v2('A') });
    await act(async () => { pending[0].resolve([source('A', 'old-A')]); pending[1].resolve([source('B', 'old-B')]); });
    expect(ControlledImage.instances).toHaveLength(0);
    await act(async () => pending[2].resolve([source('A', 'new-A')]));
    const oldA = ControlledImage.instances[0], lateA = oldA.onload;
    rerender({ layout: v2('B') });
    expect(revokeUrl).toHaveBeenCalledWith('blob:reference-test-1');
    await act(async () => pending[3].resolve([source('B', 'new-B')]));
    const oldB = ControlledImage.instances[1], lateB = oldB.onload;
    rerender({ layout: v2('A') });
    expect(revokeUrl).toHaveBeenCalledWith('blob:reference-test-2');
    await act(async () => pending[4].resolve([source('A', 'final-A')]));
    act(() => { oldA.naturalWidth = oldB.naturalWidth = 200; oldA.naturalHeight = oldB.naturalHeight = 100; lateA?.(); lateB?.(); });
    expect(result.current.ready).toBe(false); expect(result.current.layer).toBeUndefined();
    act(() => ControlledImage.instances[2].load());
    expect(result.current.layer?.url).toBe('blob:reference-test-3');
    unmount(); expect(revokeUrl).toHaveBeenCalledWith('blob:reference-test-3');
    expect(subscriptions.size).toBe(0);
  });

  it('reads updated sources after a committed source notification', async () => {
    const { result } = renderHook(() => useReferenceImage(v2('A')));
    await waitFor(() => expect(ControlledImage.instances).toHaveLength(1));
    act(() => ControlledImage.instances[0].load());
    const next = source('A', 'replacement'); vi.mocked(listStoredSources).mockResolvedValue([next]);
    await act(async () => subscriptions.get('A')?.());
    expect(listStoredSources).toHaveBeenCalledTimes(2);
    expect(result.current.layer).toBeUndefined(); expect(revokeUrl).toHaveBeenCalledWith('blob:reference-test-1');
    act(() => ControlledImage.instances[1].load());
    expect(result.current.layer?.url).toBe('blob:reference-test-2');
  });
});
