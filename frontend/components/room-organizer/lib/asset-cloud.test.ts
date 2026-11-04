// @vitest-environment jsdom
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type { RoomLayout } from './types';

const localA = '11111111-1111-4111-8111-111111111111';
const localB = '22222222-2222-4222-8222-222222222222';
const cloudA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REGISTRY = 'scendance:aholo-assets';

function seed(...ids: string[]) {
  const records = ids.map(assetId => ({ assetId, kind: 'glb', name: `本机模型 ${assetId.slice(0, 4)}`, bytes: 32, savedAt: Date.now(), taskid: `task-${assetId.slice(0, 4)}` }));
  localStorage.setItem(REGISTRY, JSON.stringify(records));
}

function layoutWith(...assetIds: string[]): RoomLayout {
  return {
    floors: [{
      id: 'ground', name: '一层', floorColor: '#fff',
      items: assetIds.map((assetId, index) => ({ id: `item-${index}`, name: `物料 ${index + 1}`, type: 'glb-asset', assetId, glbUrl: `http://127.0.0.1:3199/asset/${assetId}.glb` })),
    }],
  } as unknown as RoomLayout;
}

function localFetch() {
  return vi.fn(async () => new Response(new Uint8Array(32), { status: 200 }));
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('local asset cloud state and retry', () => {
  it('moves local → uploading → uploaded and exposes the cloud id map', async () => {
    seed(localA);
    let fileStarted!: () => void;
    const started = new Promise<void>(resolve => { fileStarted = resolve; });
    const uploader = vi.fn((_file: Blob, _meta: unknown, onProgress?: (loaded: number, total: number) => void) => {
      onProgress?.(16, 32);
      fileStarted();
      return new Promise<never>(() => {});
    });
    const cloud = await import('./asset-cloud');
    void cloud.syncLocalAsset(localA, uploader, { fetchImpl: localFetch() as unknown as typeof fetch });
    await started;
    expect(cloud.assetCloudStateOf(localA)).toMatchObject({ state: 'uploading', progress: 0.5 });
  });

  it('retries a retryable failure and persists the uploaded mapping', async () => {
    seed(localA);
    const uploader = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), { status: 503 }))
      .mockResolvedValueOnce({ id: cloudA, byteSize: 32, sha256: 'a'.repeat(64) });
    const cloud = await import('./asset-cloud');
    await cloud.syncLocalAsset(localA, uploader, { fetchImpl: localFetch() as unknown as typeof fetch, retryDelaysMs: [0] });
    expect(uploader).toHaveBeenCalledTimes(2);
    expect(cloud.assetCloudStateOf(localA)).toMatchObject({ state: 'uploaded', cloudAssetId: cloudA });
    expect(cloud.cloudAssetIdMap()).toEqual({ [localA]: cloudA });
    expect(JSON.parse(localStorage.getItem('scendance:asset-cloud-v1')!)[localA]).toMatchObject({ state: 'uploaded', cloudAssetId: cloudA });
  });

  it('keeps the local copy and records an explicit failed state when upload is rejected', async () => {
    seed(localA);
    const uploader = vi.fn().mockRejectedValue(Object.assign(new Error('模型校验未通过'), { status: 422 }));
    const cloud = await import('./asset-cloud');
    await expect(cloud.syncLocalAsset(localA, uploader, { fetchImpl: localFetch() as unknown as typeof fetch, retryDelaysMs: [0] })).rejects.toThrow('模型校验未通过');
    expect(uploader).toHaveBeenCalledTimes(1);
    expect(cloud.assetCloudStateOf(localA)).toMatchObject({ state: 'failed', error: '模型校验未通过' });
    const registry = JSON.parse(localStorage.getItem(REGISTRY)!);
    expect(registry.map((asset: { assetId: string }) => asset.assetId)).toContain(localA);
  });

  it('does not upload the same local file twice', async () => {
    seed(localA);
    const uploader = vi.fn().mockResolvedValue({ id: cloudA, byteSize: 32, sha256: 'b'.repeat(64) });
    const cloud = await import('./asset-cloud');
    const fetchImpl = localFetch() as unknown as typeof fetch;
    const first = await cloud.syncLocalAsset(localA, uploader, { fetchImpl, retryDelaysMs: [0] });
    const second = await cloud.syncLocalAsset(localA, uploader, { fetchImpl, retryDelaysMs: [0] });
    expect(first.id).toBe(cloudA);
    expect(second.reused).toBe(true);
    expect(uploader).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns an explicit failure instead of silently dropping an unsynced layout asset', async () => {
    seed(localA, localB);
    const uploader = vi.fn()
      .mockResolvedValueOnce({ id: cloudA, byteSize: 32, sha256: 'c'.repeat(64) })
      .mockRejectedValueOnce(Object.assign(new Error('断网了'), { status: 0 }));
    const cloud = await import('./asset-cloud');
    const prepared = await cloud.prepareLayoutAssetsForCloud(layoutWith(localA, localB), uploader, { fetchImpl: localFetch() as unknown as typeof fetch, retryDelaysMs: [0] });
    expect(prepared.assetIdMap).toEqual({ [localA]: cloudA });
    expect(prepared.localAssetIds).toEqual(new Set([localA, localB]));
    expect(prepared.failures).toHaveLength(1);
    expect(prepared.failures[0]).toMatchObject({ localAssetId: localB, state: 'failed', name: '本机模型 2222' });
  });

  it('labels all four states for the UI', async () => {
    const cloud = await import('./asset-cloud');
    expect(cloud.assetCloudLabel('local')).toBe('本机');
    expect(cloud.assetCloudLabel('uploading', 0.4)).toBe('上传中 40%');
    expect(cloud.assetCloudLabel('uploaded')).toBe('已上云');
    expect(cloud.assetCloudLabel('failed')).toBe('上传失败');
  });
});
