import { describe, expect, it } from 'vitest';
import { backendSceneToLayout, layoutToBackendScene } from '@/components/room-organizer/lib/backend-adapter';
import { addAssetToLayout, assetPreviewScene, intentStorageKey, readGenerationIntent, saveGenerationIntent, validAssetSize, type AuthorizedAsset } from './assets-api';
import type { Scene } from '../../supabase/functions/_shared/domain';

const scene: Scene = { schemaVersion: 1, venue: { shape: 'rectangle', width: 12, depth: 10, height: 3, entrances: [] }, objects: [], camera: 'overview', lighting: 'neutral' };
const asset: AuthorizedAsset = { id: '10000000-0000-4000-8000-000000000001', name: '木椅', source: 'polyhaven', url: 'https://example.supabase.co/storage/signed/model.glb' };
const size = { width: 1, depth: .8, height: 1.5 };

describe('generation intent recovery', () => {
  it('persists the original request and separates accounts and backend projects', () => {
    const map = new Map<string, string>();
    const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
    const key = intentStorageKey('api-1', 'user-1');
    const intent = { requestId: crypto.randomUUID(), prompt: '木制沙龙椅' };
    saveGenerationIntent(storage, key, intent);
    expect(readGenerationIntent(storage, key)).toEqual(intent);
    expect(readGenerationIntent(storage, intentStorageKey('api-2', 'user-1'))).toBeNull();
    expect(readGenerationIntent(storage, intentStorageKey('api-1', 'user-2'))).toBeNull();
  });
  it('restores complete image and texture intents and rejects partial references',()=>{
    const intent={requestId:crypto.randomUUID(),prompt:'Oak chair',kind:'texture' as const,referenceImageAssetId:crypto.randomUUID(),sourceAssetId:crypto.randomUUID()};
    expect(readGenerationIntent({getItem:()=>JSON.stringify(intent)},'key')).toEqual(intent);
    expect(()=>readGenerationIntent({getItem:()=>JSON.stringify({...intent,referenceImageAssetId:undefined})},'key')).toThrow('无法读取');
  });
  it('refuses to forget an unreadable or unstorable intent', () => {
    expect(() => readGenerationIntent({ getItem: () => '{invalid' }, 'key')).toThrow('无法读取上一次');
    expect(() => saveGenerationIntent({ getItem: () => null, setItem: () => {} }, 'key', { requestId: crypto.randomUUID(), prompt: 'chair' })).toThrow('无法保存生成请求编号');
  });
});

describe('authorized model placement', () => {
  it('keeps stable asset IDs, original materials and meters without mutating the current layout', () => {
    const original = backendSceneToLayout(scene);
    const next = addAssetToLayout(original, asset, size);
    expect(original.floors[0].items).toHaveLength(0);
    const object = layoutToBackendScene(next).objects[0];
    expect(object).toMatchObject({ materialId: 'asset', assetId: asset.id, size, color: '#ffffff', position: { x: 6, z: 5 } });
    expect(next.floors[0].items[0]).toMatchObject({ glbUrl: asset.url, source: 'public_library', name: asset.name });
    expect(assetPreviewScene(asset, size).objects[0].size).toEqual(size);
  });
  it('rejects unsupported dimensions and objects outside the room', () => {
    expect(validAssetSize({ ...size, width: NaN })).toBe(false);
    expect(() => addAssetToLayout(backendSceneToLayout(scene), asset, { ...size, height: 4 })).toThrow('超出当前场地');
    expect(() => addAssetToLayout(backendSceneToLayout(scene), asset, { ...size, width: 0.01 })).toThrow('有效米制尺寸');
  });
  it('enforces the backend 50 object limit when adding another model', () => {
    const full = { ...scene, objects: Array.from({ length: 50 }, () => ({ ...assetPreviewScene(asset, size).objects[0], id: crypto.randomUUID() })) };
    expect(() => addAssetToLayout(backendSceneToLayout(full), asset, size)).toThrow('后端校验');
  });
});
