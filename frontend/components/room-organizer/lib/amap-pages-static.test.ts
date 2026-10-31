import { describe, expect, it, vi } from 'vitest';
import { handleAmapGeocode } from '../../../../functions/api/amap-geocode';
import { handleAmapStatic } from '../../../../functions/api/amap-static';

describe('pages amap functions', () => {
  it('serves a satellite image and keeps the key out of the response', async () => {
    const tile = new Uint8Array(180);
    tile[0] = 0xff;
    tile[1] = 0xd8;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes('restapi.amap.com/v3/staticmap')) {
        expect(href).toContain('key=secret-key');
        return new Response(new Uint8Array(100), { status: 200, headers: { 'content-type': 'image/jpeg' } });
      }
      expect(href).toContain('appmaptile?style=6');
      expect(href).not.toContain('secret-key');
      return new Response(tile, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    });
    const response = await handleAmapStatic(
      new Request('https://scendance.lilicoding.space/api/amap-static?location=120.54,30.40&zoom=16&x-ref=satellite-ground-ref'),
      { AMAP_STATIC_KEY: 'secret-key' },
      fetchImpl as typeof fetch,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(new TextDecoder().decode(await response.arrayBuffer())).not.toContain('secret-key');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('crops the satellite to the drawn bounds with north at the top', async () => {
    const draws: { x: number; y: number; w: number; h: number }[] = [];
    let canvasW = 0;
    let canvasH = 0;
    class FakeCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        canvasW = width;
        canvasH = height;
      }
      getContext() {
        return { drawImage: (_bitmap: unknown, x: number, y: number, w: number, h: number) => { draws.push({ x, y, w, h }); } };
      }
      async convertToBlob() {
        const bytes = new Uint8Array(180);
        bytes[0] = 0xff;
        bytes[1] = 0xd8;
        return new Blob([bytes], { type: 'image/jpeg' });
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeCanvas);
    vi.stubGlobal('createImageBitmap', async () => ({ close() {} }));
    const tile = new Uint8Array(180);
    tile[0] = 0xff;
    tile[1] = 0xd8;
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(tile, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    });
    try {
      const response = await handleAmapStatic(
        new Request('https://scendance.lilicoding.space/api/amap-static?west=120.53&south=30.40&east=120.55&north=30.405&x-ref=satellite-ground-ref'),
        { AMAP_STATIC_KEY: 'secret-key' },
        fetchImpl as typeof fetch,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/jpeg');
      expect(canvasW).toBeGreaterThan(canvasH * 1.5);
      expect(draws.length).toBeGreaterThan(0);
      expect(Math.min(...draws.map(draw => draw.x))).toBeLessThanOrEqual(0);
      expect(Math.min(...draws.map(draw => draw.y))).toBeLessThanOrEqual(0);
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.every(url => url.includes('style=6'))).toBe(true);
      expect(urls[0]).not.toContain('secret-key');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not fall back to a centered square when the drawn bounds cannot be rendered', async () => {
    const response = await handleAmapStatic(
      new Request('https://scendance.lilicoding.space/api/amap-static?west=120.53&south=30.40&east=120.54&north=30.41&x-ref=satellite-ground-ref'),
      { AMAP_STATIC_KEY: 'secret-key' },
      vi.fn() as typeof fetch,
    );
    expect(response.status).toBe(502);
  });

  it('rejects a satellite request without the reference mark', async () => {
    const response = await handleAmapStatic(
      new Request('https://scendance.lilicoding.space/api/amap-static?location=120.54,30.40&zoom=16'),
      { AMAP_STATIC_KEY: 'secret-key' },
      vi.fn() as typeof fetch,
    );
    expect(response.status).toBe(400);
  });

  it('geocodes a place name and returns only lng/lat', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('key=secret-key');
      expect(String(input)).toContain(encodeURIComponent('盐官潮乐之城'));
      return new Response(JSON.stringify({ pois: [{ location: '120.54,30.405' }] }), { status: 200 });
    });
    const response = await handleAmapGeocode(
      new Request('https://scendance.lilicoding.space/api/amap-geocode?keywords=' + encodeURIComponent('盐官潮乐之城')),
      { AMAP_KEY: 'secret-key' },
      fetchImpl as typeof fetch,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ lng: 120.54, lat: 30.405 });
  });

  it('refuses geocode when the server key is missing', async () => {
    const response = await handleAmapGeocode(
      new Request('https://scendance.lilicoding.space/api/amap-geocode?keywords=盐官潮乐之城'),
      {},
      vi.fn() as typeof fetch,
    );
    expect(response.status).toBe(503);
  });
});
