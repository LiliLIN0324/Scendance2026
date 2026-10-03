import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneApiError } from '../../client/scene-client';
import { getBackendConfig } from './backend-session';
import { publicationSchema, readShare, shareErrorMessage, shareTokenFromHash } from './share-api';

const token = 'a'.repeat(64);
const id = '50000000-0000-4000-8000-000000000001';
const config = getBackendConfig({ url: 'https://scene.example', anonKey: 'public-test-key' });
const payload = () => ({
  publicationId: id, name: '客户方案', revision: 4, createdAt: '2026-10-02T12:00:00Z',
  scene: {
    schemaVersion: 1, camera: 'overview', lighting: 'neutral',
    venue: { shape: 'rectangle', width: 12, depth: 10, height: 3, entrances: [], floorplanAssetId: id },
    objects: [{ id, materialId: 'chair', position: { x: 2, z: 3 }, rotation: 90, size: { width: .5, depth: .5, height: .8 }, color: '#abcdef', locked: false, notes: '内部备注' }],
  },
  materials: [{ materialId: 'chair', assetId: null, name: '椅子', size: { width: .5, depth: .5, height: .8 }, color: '#abcdef', notice: '', quantity: 1, notes: '内部备注' }],
  assets: [{ id, name: '模型', url: 'https://scene.example/model.glb?token=short-lived', expiresIn: 300, source: 'polyhaven', sourceUrl: 'https://polyhaven.com/a/table', license: { id: 'CC0-1.0' } }],
});

afterEach(() => vi.unstubAllGlobals());

describe('customer publication contract', () => {
  it('reads the token only from a complete fragment value', () => {
    expect(shareTokenFromHash(`#${token}`)).toBe(token);
    expect(shareTokenFromHash(`?token=${token}`)).toBeNull();
    expect(shareTokenFromHash('#invalid')).toBeNull();
  });

  it('sends an anonymous no-store POST and strips internal scene and material fields', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload())));
    vi.stubGlobal('fetch', fetcher);
    const result = await readShare(token, config);
    expect(fetcher).toHaveBeenCalledWith('https://scene.example/functions/v1/scene-api/share/read', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), cache: 'no-store',
    });
    expect(result.scene.objects[0].notes).toBe('');
    expect(result.scene.venue).not.toHaveProperty('floorplanAssetId');
    expect(result.materials[0]).not.toHaveProperty('notes');
    expect(JSON.stringify(result)).not.toContain('内部备注');
  });

  it('accepts omitted public notes and reports invalid asset responses without leaking URLs', async () => {
    const data = payload();
    Reflect.deleteProperty(data.scene.objects[0], 'notes');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(data))).mockResolvedValueOnce(new Response(JSON.stringify({ ...data, assets: [{ ...data.assets[0], url: 'javascript:alert(1)' }] }))));
    expect((await readShare(token, config)).scene.objects[0].notes).toBe('');
    await expect(readShare(token, config)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('reads registered shared-library models through the publication signed URL and retains provenance', async () => {
    const data = payload();
    const asset = {
      ...data.assets[0], source: 'upload', sourceUrl: 'https://3dassets.dev/assets/table-01',
      license: { id: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: '3D Assets' },
      url: 'https://scene.example/storage/v1/object/sign/scene-assets/model.glb?token=temporary-signature',
      storagePath: 'private-owner/model.glb', metadata: { catalog: 'scendance-v041' },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...data, assets: [asset] }))));
    const result = await readShare(token, config);
    expect(result.assets[0].url).toBe(asset.url);
    expect(result.assets[0].sourceUrl).toBe(asset.sourceUrl);
    expect(result.assets[0].license?.id).toBe('CC0-1.0');
    expect(result.assets[0]).not.toHaveProperty('storagePath');
    expect(result.assets[0]).not.toHaveProperty('metadata');
  });

  it('rejects invalid tokens before sending a request and surfaces revocation distinctly', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'SHARE_NOT_FOUND' } }), { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(readShare('#invalid', config)).rejects.toMatchObject({ code: 'SHARE_NOT_FOUND' });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(readShare(token, config)).rejects.toMatchObject({ code: 'SHARE_NOT_FOUND' });
    expect(shareErrorMessage(new SceneApiError('SHARE_NOT_FOUND', 404, null))).toContain('已撤销');
    expect(shareErrorMessage(new Error(`Network ${token}`))).not.toContain(token);
  });

  it('permits a publish URL only when its token is in the fragment and matches the response', () => {
    const published = { shareId: id, publicationId: id, revision: 4, createdAt: '2026-10-02T12:00:00Z', token, url: `https://app.example/view/#${token}` };
    expect(publicationSchema.safeParse(published).success).toBe(true);
    for (const url of [`https://app.example/view/?token=${token}`, `https://app.example/view/#${'b'.repeat(64)}`, `javascript:alert(1)#${token}`, `https://user:password@app.example/view/#${token}`]) {
      expect(publicationSchema.safeParse({ ...published, url }).success).toBe(false);
    }
  });
});
