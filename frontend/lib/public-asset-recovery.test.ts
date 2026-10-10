import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearGlbAssetCache,
  getGlbAssetSource,
  getGlbAssetState,
} from '../components/room-organizer/three/glb-assets';
import { ensureRecoverableGlbAsset, publicAssetLocalUrl } from './public-asset-recovery';

const PUBLIC_ASSET_ID = '6a4e04d0-57a7-528b-863c-41ee15c91fa7';
const PUBLIC_ALIAS = 'https://cdn.3dassets.dev/assets/39459/v1/model.glb';
const LOCAL_URL = '/showcase/assets/library/model/beach-surf-and-paddle-kit-folding-beach-chair-68794f97.glb';
const MERGED_SHA256 = 'eb631b23a79b71a6f20e779d7441b3ef19f5f29192ab25d168065324950af3f6';
const STORAGE_ORIGIN = 'https://supabase.example.test';
const OLD_STORAGE_ORIGIN = 'https://legacy.supabase.example.test';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_ASSET_ID = '7a000000-0000-4000-8000-000000000001';
const GLB_PATH = '../../assets/library/model/beach-surf-and-paddle-kit-folding-beach-chair-68794f97.glb';

function realGlb(): ArrayBuffer {
  const bytes = Uint8Array.from(readFileSync(new URL(GLB_PATH, import.meta.url)));
  return bytes.buffer;
}

function storageUrl(
  assetId: string,
  sha256 = MERGED_SHA256,
  ownerId = OWNER_ID,
  origin = STORAGE_ORIGIN,
  token = 'recovery-token',
): string {
  return `${origin}/storage/v1/object/sign/scene-assets/${ownerId}/${assetId}/${sha256}.glb?token=${token}`;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function readyResponse(): Response {
  return new Response(realGlb(), { status: 200 });
}

function expectParsedAsset(key: string): void {
  expect(getGlbAssetState(key)).toMatchObject({ status: 'ready' });
  const source = getGlbAssetSource(key);
  expect(source).toBeDefined();
  expect(source?.getObjectByProperty('isMesh', true)).toBeDefined();
}

afterEach(() => {
  clearGlbAssetCache();
  vi.restoreAllMocks();
});

describe('public asset recovery', () => {
  it('recovers a known uppercase UUID from the canonical signed path while retaining the original cache key', async () => {
    const originalId = PUBLIC_ASSET_ID.toUpperCase();
    const originalUrl = storageUrl(PUBLIC_ASSET_ID);
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = requestUrl(input);
      calls.push(url);
      if (url === originalUrl) return new Response(null, { status: 403 });
      if (url === LOCAL_URL) return readyResponse();
      throw new Error(`unexpected fetch: ${url}`);
    });

    await ensureRecoverableGlbAsset(originalId, originalId, originalUrl, STORAGE_ORIGIN);

    expectParsedAsset(originalId);
    expect(getGlbAssetState(PUBLIC_ASSET_ID).status).toBe('idle');
    expect(publicAssetLocalUrl(originalId)).toBe(LOCAL_URL);
    expect(publicAssetLocalUrl(UNKNOWN_ASSET_ID.toUpperCase())).toBeUndefined();
    expect(publicAssetLocalUrl(`${originalId}-opaque`)).toBeUndefined();
    expect(calls).toEqual([originalUrl, LOCAL_URL]);
  });

  it('maps only the registered public asset ID to its shipped local GLB', () => {
    expect(publicAssetLocalUrl(PUBLIC_ASSET_ID)).toBe(LOCAL_URL);
    expect(publicAssetLocalUrl(UNKNOWN_ASSET_ID)).toBeUndefined();
    expect(publicAssetLocalUrl()).toBeUndefined();
  });

  it('keeps a successful custom URL and does not probe the local fallback', async () => {
    const key = 'public-asset-custom-success';
    const customUrl = 'https://storage.example.test/custom/model.glb?token=still-valid';
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = requestUrl(input);
      calls.push(url);
      if (url === customUrl) return readyResponse();
      throw new Error(`unexpected fetch: ${url}`);
    });

    await ensureRecoverableGlbAsset(key, PUBLIC_ASSET_ID, customUrl, STORAGE_ORIGIN);

    expect(calls).toEqual([customUrl]);
    expectParsedAsset(key);
  });

  it('recovers a known public asset after the exact CDN alias returns 401', async () => {
    const key = 'public-asset-alias-recovery';
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = requestUrl(input);
      calls.push(url);
      if (url === PUBLIC_ALIAS) return new Response(null, { status: 401 });
      if (url === LOCAL_URL) return readyResponse();
      throw new Error(`unexpected fetch: ${url}`);
    });

    await ensureRecoverableGlbAsset(key, PUBLIC_ASSET_ID, PUBLIC_ALIAS, STORAGE_ORIGIN);

    expect(calls).toEqual([PUBLIC_ALIAS, LOCAL_URL]);
    expectParsedAsset(key);
  });

  it('recovers a known public asset after an exact trusted storage URL returns 403', async () => {
    const key = 'public-asset-storage-recovery';
    const privateUrl = storageUrl(PUBLIC_ASSET_ID);
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = requestUrl(input);
      calls.push(url);
      if (url === privateUrl) return new Response(null, { status: 403 });
      if (url === LOCAL_URL) return readyResponse();
      throw new Error(`unexpected fetch: ${url}`);
    });

    await ensureRecoverableGlbAsset(key, PUBLIC_ASSET_ID, privateUrl, STORAGE_ORIGIN);

    expect(calls).toEqual([privateUrl, LOCAL_URL]);
    expectParsedAsset(key);
  });

  it('uses the local GLB directly when a known public asset has no loading URL', async () => {
    const key = 'public-asset-no-url';
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = requestUrl(input);
      calls.push(url);
      if (url === LOCAL_URL) return readyResponse();
      throw new Error(`unexpected fetch: ${url}`);
    });

    await ensureRecoverableGlbAsset(key, PUBLIC_ASSET_ID, undefined, STORAGE_ORIGIN);

    expect(calls).toEqual([LOCAL_URL]);
    expectParsedAsset(key);
  });

  it.each([
    ['wrong hash', storageUrl(PUBLIC_ASSET_ID, `f${MERGED_SHA256.slice(1)}`), STORAGE_ORIGIN],
    ['wrong asset ID path', storageUrl(UNKNOWN_ASSET_ID), STORAGE_ORIGIN],
    ['invalid owner path', storageUrl(PUBLIC_ASSET_ID, MERGED_SHA256, 'invalid-owner'), STORAGE_ORIGIN],
    ['wrong storage host', storageUrl(PUBLIC_ASSET_ID, MERGED_SHA256, OWNER_ID, 'https://evil.example.test'), STORAGE_ORIGIN],
    ['missing trusted storage origin', storageUrl(PUBLIC_ASSET_ID), undefined],
    ['arbitrary custom private URL', 'https://storage.example.test/private/model.glb?token=private-token', STORAGE_ORIGIN],
    ['empty token', storageUrl(PUBLIC_ASSET_ID, MERGED_SHA256, OWNER_ID, STORAGE_ORIGIN, ''), STORAGE_ORIGIN],
    ['cross-environment storage host', storageUrl(PUBLIC_ASSET_ID, MERGED_SHA256, OWNER_ID, OLD_STORAGE_ORIGIN), STORAGE_ORIGIN],
  ] as const)('does not recover from an invalid 403 URL shape for %s', async (_label, url, storageOrigin) => {
    const key = `public-asset-negative-${_label}`;
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const requested = requestUrl(input);
      calls.push(requested);
      if (requested === url) return new Response(null, { status: 403 });
      return readyResponse();
    });

    await expect(ensureRecoverableGlbAsset(key, PUBLIC_ASSET_ID, url, storageOrigin)).rejects.toThrow();
    expect(calls).toEqual([url]);
  });

  it.each([UNKNOWN_ASSET_ID, UNKNOWN_ASSET_ID.toUpperCase()])('does not recover unknown private asset %s even when its URL shape is trusted', async originalId => {
    const key = 'private-unknown-asset';
    const privateUrl = storageUrl(UNKNOWN_ASSET_ID);
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = requestUrl(input);
      calls.push(url);
      if (url === privateUrl) return new Response(null, { status: 403 });
      return readyResponse();
    });

    await expect(ensureRecoverableGlbAsset(key, originalId, privateUrl, STORAGE_ORIGIN)).rejects.toThrow();
    expect(calls).toEqual([privateUrl]);
  });

  it.each([
    ['HTTP 404', async () => new Response(null, { status: 404 })],
    ['network error', async () => { throw new TypeError('network down'); }],
    ['cancel', async () => { throw new DOMException('The operation was aborted.', 'AbortError'); }],
    ['invalid GLB', async () => new Response(new TextEncoder().encode('not a GLB 2.0'), { status: 200 })],
  ] as const)('does not recover after an original %s failure', async (label, failure) => {
    const key = `public-asset-failure-${label}`;
    const privateUrl = storageUrl(PUBLIC_ASSET_ID);
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = requestUrl(input);
      calls.push(url);
      if (url === privateUrl) return failure();
      return readyResponse();
    });

    await expect(ensureRecoverableGlbAsset(key, PUBLIC_ASSET_ID, privateUrl, STORAGE_ORIGIN)).rejects.toThrow();
    expect(calls).toEqual([privateUrl]);
  });
});
