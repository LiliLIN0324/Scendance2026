// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import {
  clearGlbAssetCache,
  getGlbAssetSource,
  getGlbAssetState,
} from '../three/glb-assets';
import { useGlbAssets } from './use-glb-assets';
import type { FurnitureItem, RoomLayout } from '../lib/types';

const PUBLIC_ASSET_ID = '6a4e04d0-57a7-528b-863c-41ee15c91fa7';
const UNKNOWN_ASSET_ID = '70000000-0000-4000-8000-000000000001';
const STORAGE_ORIGIN = 'https://supabase.example.test';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const SHA256 = 'eb631b23a79b71a6f20e779d7441b3ef19f5f29192ab25d168065324950af3f6';
const LOCAL_URL = '/showcase/assets/library/model/beach-surf-and-paddle-kit-folding-beach-chair-68794f97.glb';
const LOCAL_GLB = '../../../../assets/library/model/beach-surf-and-paddle-kit-folding-beach-chair-68794f97.glb';
type AssetFixture = { assetId: string; source?: NonNullable<FurnitureItem['source']>; glbUrl?: string };

function realGlb(): ArrayBuffer {
  const bytes = Uint8Array.from(readFileSync(new URL(LOCAL_GLB, import.meta.url)));
  return bytes.buffer;
}

function storageUrl(assetId = PUBLIC_ASSET_ID, token = 'expired'): string {
  return `${STORAGE_ORIGIN}/storage/v1/object/sign/scene-assets/${OWNER_ID}/${assetId}/${SHA256}.glb?token=${token}`;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function response(buffer = realGlb()): Response {
  return new Response(buffer, { status: 200 });
}

function assetLayout(item: Parameters<typeof makeItem>[0]): RoomLayout {
  return makeLayout({ floors: [makeFloor({ items: [makeItem(item)] })] });
}

function fixtureItem(id: string, fixture: AssetFixture): Parameters<typeof makeItem>[0] {
  return {
    id,
    type: 'glb-asset',
    assetId: fixture.assetId,
    ...(fixture.source === undefined ? {} : { source: fixture.source }),
    ...(fixture.glbUrl === undefined ? {} : { glbUrl: fixture.glbUrl }),
  };
}

async function waitForStatus(result: { current: { status: string } }, status: 'ready' | 'error'): Promise<void> {
  await waitFor(() => expect(result.current.status).toBe(status));
}

function expectReady(key: string): void {
  expect(getGlbAssetState(key).status).toBe('ready');
  expect(getGlbAssetSource(key)).toBeDefined();
  expect(getGlbAssetSource(key)?.getObjectByProperty('isMesh', true)).toBeDefined();
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', STORAGE_ORIGIN);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  cleanup();
  clearGlbAssetCache();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('useGlbAssets — public model recovery', () => {
  it('recovers a known public asset from its shipped GLB after the signed URL returns 403', async () => {
    const signedUrl = storageUrl();
    const item = makeItem({
      id: 'chair-public',
      type: 'glb-asset',
      assetId: PUBLIC_ASSET_ID,
      source: 'public_library',
      glbUrl: signedUrl,
    });
    const layout = assetLayout(item);
    const originalItem = layout.floors[0]!.items[0];
    const calls: string[] = [];
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = requestUrl(input);
      calls.push(url);
      if (url === signedUrl) return new Response(null, { status: 403 });
      if (url === LOCAL_URL) return response();
      throw new Error(`unexpected fetch: ${url}`);
    });

    const tab = renderHook(() => {
      useGlbAssets(layout);
      return getGlbAssetState(PUBLIC_ASSET_ID);
    });
    await waitForStatus(tab.result, 'ready');

    expectReady(PUBLIC_ASSET_ID);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([signedUrl, LOCAL_URL]);
    expect(layout.floors[0]!.items[0]).toBe(originalItem);
    expect(originalItem).toMatchObject({ assetId: PUBLIC_ASSET_ID, glbUrl: signedUrl });
  });

  const negativeCases: readonly { label: string; item: AssetFixture; failedUrl: string }[] = [
    {
      label: 'known public ID with a private custom URL',
      item: { assetId: PUBLIC_ASSET_ID, source: 'public_library' as const, glbUrl: 'https://private.example.test/custom/model.glb?token=private' },
      failedUrl: 'https://private.example.test/custom/model.glb?token=private',
    },
    {
      label: 'unknown private asset',
      item: { assetId: UNKNOWN_ASSET_ID, glbUrl: storageUrl(UNKNOWN_ASSET_ID) },
      failedUrl: storageUrl(UNKNOWN_ASSET_ID),
    },
    {
      label: 'private ID spoofed as public',
      item: { assetId: UNKNOWN_ASSET_ID, source: 'public_library' as const, glbUrl: storageUrl(UNKNOWN_ASSET_ID, 'spoof') },
      failedUrl: storageUrl(UNKNOWN_ASSET_ID, 'spoof'),
    },
  ];

  it.each(negativeCases)('does not fall back after a 403 for $label', async ({ item, failedUrl }, index) => {
    const itemId = `asset-negative-${index}`;
    const cacheKey = item.assetId ?? item.glbUrl ?? itemId;
    const layout = assetLayout(fixtureItem(itemId, item));
    const calls: string[] = [];
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = requestUrl(input);
      calls.push(url);
      if (url === failedUrl) return new Response(null, { status: 403 });
      throw new Error(`unexpected fallback fetch: ${url}`);
    });

    const tab = renderHook(() => {
      useGlbAssets(layout);
      return getGlbAssetState(cacheKey);
    });
    await waitForStatus(tab.result, 'error');

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([failedUrl]);
    expect(getGlbAssetSource(cacheKey)).toBeUndefined();
  });

  const successCases: readonly { label: string; item: AssetFixture; customUrl: string | undefined }[] = [
    {
      label: 'known public ID with a valid custom URL',
      item: { assetId: PUBLIC_ASSET_ID, source: 'public_library' as const, glbUrl: 'https://private.example.test/custom/model.glb?token=valid' },
      customUrl: 'https://private.example.test/custom/model.glb?token=valid',
    },
    {
      label: 'known public ID with no loading URL',
      item: { assetId: PUBLIC_ASSET_ID, source: 'public_library' as const },
      customUrl: undefined,
    },
  ];

  it.each(successCases)('uses the custom URL or local URL as selected for $label', async ({ item, customUrl }, index) => {
    const itemId = `asset-success-${index}`;
    const cacheKey = item.assetId ?? item.glbUrl ?? itemId;
    const layout = assetLayout(fixtureItem(itemId, item));
    const originalItem = layout.floors[0]!.items[0];
    const calls: string[] = [];
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = requestUrl(input);
      calls.push(url);
      if (customUrl && url === customUrl) return response();
      if (!customUrl && url === LOCAL_URL) return response();
      throw new Error(`unexpected fetch: ${url}`);
    });

    const tab = renderHook(() => {
      useGlbAssets(layout);
      return getGlbAssetState(cacheKey);
    });
    await waitForStatus(tab.result, 'ready');

    expectReady(cacheKey);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([customUrl ?? LOCAL_URL]);
    expect(layout.floors[0]!.items[0]).toBe(originalItem);
    expect(originalItem?.assetId).toBe(PUBLIC_ASSET_ID);
    expect(originalItem?.glbUrl).toBe(customUrl);
  });
});
