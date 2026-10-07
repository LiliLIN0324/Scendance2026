import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import libraryAssetIds from '../../../../assets/library/asset-ids.json';
import { handoffSchema } from '../../../../supabase/functions/_shared/delivery-contract';
import { eventOperationsSchema } from '../../../../supabase/functions/_shared/event-operations-contract';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { backendSceneToLayout, layoutToBackendScene } from './backend-adapter';
import { downloadLayoutAsJson, readLayoutFromFile } from './file-io';
import { MAX_LAYOUT_JSON_BYTES } from './schema';
import { prepareDeliveryAssets } from './scene-delivery';
import { createFurnitureModel } from '../three/furniture-builders';
import { clearGlbAssetCache, disposeOwnedModel, getGlbAssetState } from '../three/glb-assets';
import type { BackendSession } from '../../../lib/backend-session';
import type { RoomLayout } from './types';

const archivedAssetId = '70000000-0000-4000-8000-000000000001';
const fakeLoadingUrl = 'https://storage.example.test/private/model.glb?token=FAKE_EXPORT_TOKEN';
const publicUrl = 'https://cdn.3dassets.dev/assets/39459/v1/model.glb';
const publicAssetId = libraryAssetIds[publicUrl];

afterEach(() => { clearGlbAssetCache(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function downloadedJson(layout: RoomLayout): Promise<string> {
  vi.useFakeTimers();
  let output: Blob | undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { output = blob as Blob; return 'blob:fake-download'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('document', { createElement: () => ({ click: vi.fn() }) });
  downloadLayoutAsJson(layout);
  return output!.text();
}

describe('editable JSON export', () => {
  it('downloads and reopens complete activity metadata at the root and in design variants', async () => {
    const eventOperations = eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [{
      id: 'a1000000-0000-4000-8000-000000000001', title: '现场签到', phase: 'event', objectIds: [],
      plannedStartAt: '2026-10-09T09:00:00+08:00', plannedEndAt: '2026-10-09T09:30:00+08:00',
      actualStartedAt: '2026-10-09T09:05:00+08:00', actualFinishedAt: '2026-10-09T09:35:00+08:00',
      ownerName: '签到团队', contractorName: '执行团队', acceptance: '到场签到记录核对',
      status: 'accepted', evidenceNote: '已人工核对签到记录', evidenceUrls: ['https://example.com/signin'],
      reviewedBasis: `sha256:${'a'.repeat(64)}`,
    }] });
    const variant = makeLayout({ eventOperations });
    const layout = makeLayout({ eventOperations,
      designBook: { activeId: 'v1', variants: [{ id: 'v1', name: '方案', layout: variant }] } });
    const original = JSON.stringify(layout);
    const json = await downloadedJson(layout);
    const reopened = await readLayoutFromFile(new File([json], 'rehearsal.json'));
    expect(reopened.eventOperations).toEqual(eventOperations);
    expect(reopened.designBook!.variants[0]!.layout.eventOperations).toEqual(eventOperations);
    expect(JSON.stringify(layout)).toBe(original);
  });
  it('omits archived loading credentials from the actual download and nested design snapshots', async () => {
    const handoff = handoffSchema.parse({ ownerName: '现场负责人', acceptance: '摆放核对', evidenceNote: '本地执行记录' });
    const item = makeItem({ type: 'glb-asset', materialId: 'asset', assetId: archivedAssetId,
      glbUrl: fakeLoadingUrl, handoff, position: { x: 2, z: -1 }, rotation: 0.5 });
    const variant = makeLayout({ floors: [makeFloor({ items: [item] })] });
    const layout = makeLayout({ floors: variant.floors,
      designBook: { activeId: 'v1', variants: [{ id: 'v1', name: '保存方案', layout: variant }] } });
    const original = JSON.stringify(layout);
    const json = await downloadedJson(layout);
    expect(json).not.toContain('FAKE_EXPORT_TOKEN');
    expect(json).not.toContain('storage.example.test');
    const file = new File([json], 'layout.json', { type: 'application/json' });
    const reopened = await readLayoutFromFile(file);
    const { glbUrl: _loadingUrl, ...portableItem } = item;
    expect(reopened.floors[0].items[0]).toEqual(portableItem);
    expect(reopened.designBook!.variants[0].layout.floors[0].items[0]).toEqual(portableItem);
    expect(JSON.stringify(layout)).toBe(original);
  });

  it('uses trusted public asset URLs and preserves local models without trusting a public source label', async () => {
    const publicItem = makeItem({ id: 'public', type: 'glb-asset', assetId: publicAssetId,
      source: 'public_library', glbUrl: fakeLoadingUrl });
    const stablePublic = makeItem({ ...publicItem, id: 'stable', glbUrl: publicUrl });
    const spoofedPublic = makeItem({ ...publicItem, id: 'unknown', assetId: archivedAssetId });
    const local = makeItem({ id: 'local', type: 'glb-asset', source: 'local_sample', glbUrl: '/assets/models/table.glb' });
    const standalone = makeItem({ id: 'standalone', type: 'glb-asset', glbUrl: 'https://example.test/public/model.glb' });
    const layout = makeLayout({ floors: [makeFloor({ items: [publicItem, stablePublic, spoofedPublic, local, standalone] })] });
    const json = await downloadedJson(layout);
    const reopened = await readLayoutFromFile(new File([json], 'layout.json'));
    expect(reopened.floors[0].items[0]).toEqual({ ...publicItem, glbUrl: publicUrl });
    expect(reopened.floors[0].items[1]).toEqual(stablePublic);
    expect(reopened.floors[0].items[2]).not.toHaveProperty('glbUrl');
    expect(reopened.floors[0].items.slice(3)).toEqual([local, standalone]);
    expect(json).not.toContain('FAKE_EXPORT_TOKEN');
    expect(publicItem.glbUrl).toBe(fakeLoadingUrl);
  });

  it('reopens by asset ID, shows unavailable models honestly and uses the existing reauthorisation path', async () => {
    const layout = backendSceneToLayout({
      schemaVersion: 1,
      venue: { width: 8, depth: 6, height: 3, shape: 'rectangle', entrances: [] },
      objects: [{ id: '80000000-0000-4000-8000-000000000001', assetId: archivedAssetId,
        materialId: 'asset', position: { x: 2, z: 1 }, rotation: 30,
        size: { width: 1.6, depth: 0.9, height: 0.75 }, color: '#ffffff', locked: false, notes: '' }],
      camera: 'overview', lighting: 'neutral',
    }, { assetUrls: { [archivedAssetId]: fakeLoadingUrl } });
    const json = await downloadedJson(layout);
    vi.useRealTimers();
    const reopened = await readLayoutFromFile(new File([json], 'layout.json'));
    expect(layoutToBackendScene(reopened).objects[0].assetId).toBe(archivedAssetId);
    expect(reopened.floors[0].items[0]).not.toHaveProperty('glbUrl');
    const placeholder = createFurnitureModel(THREE, reopened.floors[0].items[0], false);
    expect(placeholder.userData.glbStatus).toBe('idle');
    expect(placeholder.name).toContain('模型待加载');
    disposeOwnedModel(placeholder);
    const fetcher = vi.spyOn(globalThis, 'fetch');
    await expect(prepareDeliveryAssets(reopened)).rejects.toThrow('模型尚未加载');
    expect(fetcher).not.toHaveBeenCalled();

    const renewedUrl = 'https://storage.example.test/private/model.glb?token=FAKE_RENEWED_TOKEN';
    const authorizeAsset = vi.fn().mockResolvedValue({ url: renewedUrl });
    const controller = { getSnapshot: () => ({ user: { id: 'fake-user' } }), authorizeAsset } as unknown as BackendSession;
    fetcher.mockResolvedValue(new Response(new Uint8Array(readFileSync('../assets/models/table.glb')).buffer));
    await prepareDeliveryAssets(reopened, controller);
    expect(authorizeAsset).toHaveBeenCalledWith(archivedAssetId);
    expect(fetcher).toHaveBeenCalledWith(renewedUrl, expect.objectContaining({ credentials: 'omit' }));
    expect(getGlbAssetState(archivedAssetId).status).toBe('ready');
    expect(reopened.floors[0].items[0]).not.toHaveProperty('glbUrl');
    expect(layout.floors[0].items[0].glbUrl).toBe(fakeLoadingUrl);
  });
});

describe('readLayoutFromFile', () => {
  it('reads a layout file', async () => {
    const layout = makeLayout({ name: 'Imported' });
    const file = new File([JSON.stringify(layout, null, 2)], 'house.json', { type: 'application/json' });
    await expect(readLayoutFromFile(file)).resolves.toEqual(layout);
  });

  it('refuses a file over the size budget without reading it (#332)', async () => {
    const text = vi.fn(() => Promise.resolve('{}'));
    const huge = { size: MAX_LAYOUT_JSON_BYTES + 1, text } as unknown as File;
    await expect(readLayoutFromFile(huge)).rejects.toThrow(/far larger than any house layout/);
    expect(text).not.toHaveBeenCalled();
  });

  it('still refuses a file that is not a layout', async () => {
    const file = new File(['{"name":"x"}'], 'x.json');
    await expect(readLayoutFromFile(file)).rejects.toThrow(/does not match/);
  });
});
