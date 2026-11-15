import { describe, expect, it, vi } from 'vitest';
import { handleCartoTiles } from '../../../../functions/api/carto-tiles';
import {
  CARTO_TILE_MAX_ZOOM,
  CARTO_WATERMARK_SHA256,
  cartoKeyFromEnv,
  cartoKeyNamesPresent,
  cartoTileUrl,
  isCartoTileStyle,
  parseCartoTileCoord,
} from '../../../../functions/api/carto-env';

const URL_BASE = 'https://scendance.lilicoding.space/api/carto-tiles';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

describe('pages carto tiles functions', () => {
  it('serves a tile and keeps the key out of the response', async () => {
    const tile = new Uint8Array(4096).fill(0x89);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input);
      expect(href).toContain('basemaps.cartocdn.com/light_all/15/27315/13489.png');
      expect(href).toContain('key=secret-key');
      return new Response(tile, { status: 200, headers: { 'content-type': 'image/png' } });
    });
    const response = await handleCartoTiles(
      new Request(`${URL_BASE}?style=light&z=15&x=27315&y=13489`),
      { CARTO_KEY: 'secret-key' },
      fetchImpl as typeof fetch,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400');
    const body = new TextDecoder('latin1').decode(await response.arrayBuffer());
    expect(body).not.toContain('secret-key');
  });

  it('rejects unknown styles and bad coords before any upstream call', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const badStyle = await handleCartoTiles(
      new Request(`${URL_BASE}?style=streets&z=15&x=1&y=1`),
      { CARTO_KEY: 'k' },
      fetchImpl,
    );
    expect(badStyle.status).toBe(400);
    const badX = await handleCartoTiles(
      new Request(`${URL_BASE}?style=dark&z=15&x=32768&y=1`),
      { CARTO_KEY: 'k' },
      fetchImpl,
    );
    expect(badX.status).toBe(400);
    const missing = await handleCartoTiles(
      new Request(`${URL_BASE}?style=dark&z=15&x=1`),
      { CARTO_KEY: 'k' },
      fetchImpl,
    );
    expect(missing.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses tiles when the server key is missing', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const response = await handleCartoTiles(
      new Request(`${URL_BASE}?style=light&z=15&x=1&y=1`),
      {},
      fetchImpl,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get('x-carto-fallback')).toBe('nokey');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports which env names this deployment can see, never their values', async () => {
    const response = await handleCartoTiles(
      new Request(`${URL_BASE}?probe=1`),
      { NEXT_PUBLIC_CARTO_KEY: 'leak-me-not' },
      vi.fn() as unknown as typeof fetch,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(text).not.toContain('leak-me-not');
    expect(JSON.parse(text)).toEqual({
      configured: true,
      names: { CARTO_KEY: false, CARTO_API_KEY: false, NEXT_PUBLIC_CARTO_KEY: true },
    });
  });

  it('falls back to a placeholder tile when upstream fails', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => new Response('nope', { status: 403 }));
    const response = await handleCartoTiles(
      new Request(`${URL_BASE}?style=dark&z=15&x=1&y=1`),
      { CARTO_KEY: 'secret-key' },
      fetchImpl as typeof fetch,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-carto-fallback')).toBe('upstream-403');
    expect(response.headers.get('content-type')).toBe('image/svg+xml');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('treats the Carto watermark image as a failure instead of a basemap', async () => {
    // 真实水印图 2–3 KB；这里用同尺寸假图 + 注入的哈希模拟「200 但内容是水印」。
    const fake = new Uint8Array(2049).fill(0x42);
    const hash = await sha256Hex(fake);
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) =>
      new Response(fake, { status: 200, headers: { 'content-type': 'image/png' } }));
    const response = await handleCartoTiles(
      new Request(`${URL_BASE}?style=dark&z=15&x=1&y=1`),
      { CARTO_KEY: 'revoked-key' },
      fetchImpl as typeof fetch,
      { light: [], dark: [hash] },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-carto-fallback')).toBe('invalid-key');
    expect(response.headers.get('content-type')).toBe('image/svg+xml');
  });

  it('ships a sha256 fingerprint for both Carto styles', () => {
    expect(CARTO_WATERMARK_SHA256.light).toHaveLength(1);
    expect(CARTO_WATERMARK_SHA256.dark).toHaveLength(1);
    for (const hash of [...CARTO_WATERMARK_SHA256.light, ...CARTO_WATERMARK_SHA256.dark]) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('composes url and coord helpers', () => {
    expect(isCartoTileStyle('light')).toBe(true);
    expect(isCartoTileStyle('dark')).toBe(true);
    expect(isCartoTileStyle('streets')).toBe(false);
    expect(isCartoTileStyle(null)).toBe(false);
    expect(parseCartoTileCoord('15', '27315', '13489')).toEqual({ z: 15, x: 27315, y: 13489 });
    expect(parseCartoTileCoord(String(CARTO_TILE_MAX_ZOOM), '1', '1')).toEqual({ z: CARTO_TILE_MAX_ZOOM, x: 1, y: 1 });
    expect(parseCartoTileCoord(String(CARTO_TILE_MAX_ZOOM + 1), '1', '1')).toBeNull();
    expect(parseCartoTileCoord('15', '32768', '1')).toBeNull(); // x >= 2^15
    expect(parseCartoTileCoord(null, '1', '1')).toBeNull();
    expect(parseCartoTileCoord('', '1', '1')).toBeNull();
    expect(parseCartoTileCoord('abc', '1', '1')).toBeNull();
    expect(cartoTileUrl('dark', 3, 1, 2, 'k')).toBe('https://a.basemaps.cartocdn.com/dark_all/3/1/2.png?key=k');
    expect(cartoKeyFromEnv({ CARTO_KEY: ' a ' })).toBe('a');
    expect(cartoKeyFromEnv({ CARTO_API_KEY: 'alias' })).toBe('alias');
    expect(cartoKeyFromEnv({ NEXT_PUBLIC_CARTO_KEY: 'b' })).toBe('b');
    expect(cartoKeyFromEnv({})).toBe('');
    expect(cartoKeyNamesPresent({ CARTO_KEY: 'k' })).toEqual({
      CARTO_KEY: true,
      CARTO_API_KEY: false,
      NEXT_PUBLIC_CARTO_KEY: false,
    });
  });
});
