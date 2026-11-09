import { describe, expect, it, vi } from 'vitest';
import { handleTdtTiles } from '../../../../functions/api/tdt-tiles';
import { isTdtTileLayer, parseTileCoord, tdtLayerBase, tdtTileUrl } from '../../../../functions/api/tdt-env';

describe('pages tdt tiles functions', () => {
  it('serves a vector tile and keeps the key out of the response', async () => {
    const tile = new Uint8Array(256).fill(0x89);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input);
      expect(href).toContain('tianditu.gov.cn/vec_w/wmts');
      expect(href).toContain('LAYER=vec');
      expect(href).toContain('TILEMATRIXSET=w');
      expect(href).toContain('TILECOL=3372');
      expect(href).toContain('TILEROW=1690');
      expect(href).toContain('TILEMATRIX=12');
      expect(href).toContain('tk=secret-key');
      return new Response(tile, { status: 200, headers: { 'content-type': 'image/png' } });
    });
    const response = await handleTdtTiles(
      new Request('https://scendance.lilicoding.space/api/tdt-tiles?layer=vec_w&z=12&x=3372&y=1690'),
      { TDT_KEY: 'secret-key' },
      fetchImpl as typeof fetch,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(new TextDecoder().decode(await response.arrayBuffer())).not.toContain('secret-key');
  });

  it('pairs annotation layers by the same projection suffix', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => new Response(new Uint8Array(300).fill(1), { status: 200, headers: { 'content-type': 'image/png' } }));
    const response = await handleTdtTiles(
      new Request('https://scendance.lilicoding.space/api/tdt-tiles?layer=cva_w&z=12&x=3372&y=1690'),
      { TDT_KEY: 'secret-key' },
      fetchImpl as typeof fetch,
    );
    expect(response.status).toBe(200);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('cva_w/wmts');
    expect(String(fetchImpl.mock.calls[0][0])).toContain('LAYER=cva');
  });

  it('rejects unknown layers and out-of-range coords before any upstream call', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const badLayer = await handleTdtTiles(
      new Request('https://scendance.lilicoding.space/api/tdt-tiles?layer=ter_w&z=12&x=1&y=1'),
      { TDT_KEY: 'k' },
      fetchImpl,
    );
    expect(badLayer.status).toBe(400);
    const badX = await handleTdtTiles(
      new Request('https://scendance.lilicoding.space/api/tdt-tiles?layer=vec_w&z=12&x=99999&y=1'),
      { TDT_KEY: 'k' },
      fetchImpl,
    );
    expect(badX.status).toBe(400);
    const badZ = await handleTdtTiles(
      new Request('https://scendance.lilicoding.space/api/tdt-tiles?layer=vec_w&z=22&x=1&y=1'),
      { TDT_KEY: 'k' },
      fetchImpl,
    );
    expect(badZ.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses tiles when the server key is missing', async () => {
    const response = await handleTdtTiles(
      new Request('https://scendance.lilicoding.space/api/tdt-tiles?layer=img_w&z=12&x=1&y=1'),
      {},
      vi.fn() as typeof fetch,
    );
    expect(response.status).toBe(503);
  });

  it('falls back to a placeholder tile after both hosts fail', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => new Response('nope', { status: 404 }));
    const response = await handleTdtTiles(
      new Request('https://scendance.lilicoding.space/api/tdt-tiles?layer=img_w&z=12&x=1&y=1'),
      { TDT_KEY: 'secret-key' },
      fetchImpl as typeof fetch,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-tdt-fallback')).toBe('placeholder');
    expect(response.headers.get('content-type')).toBe('image/svg+xml');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const first = String(fetchImpl.mock.calls[0][0]);
    const second = String(fetchImpl.mock.calls[1][0]);
    expect(first).not.toBe(second); // 两台主机轮询
  });

  it('composes wmts url helpers with host rotation and layer bases', () => {
    expect(isTdtTileLayer('vec_w')).toBe(true);
    expect(isTdtTileLayer('img_w')).toBe(true);
    expect(isTdtTileLayer('vec_c')).toBe(false); // 4326 后缀不放开
    expect(isTdtTileLayer(null)).toBe(false);
    expect(tdtLayerBase('cia_w')).toBe('cia');
    expect(parseTileCoord('12', '3372', '1690')).toEqual({ z: 12, x: 3372, y: 1690 });
    expect(parseTileCoord('12', '4096', '1690')).toBeNull(); // x 越界
    expect(parseTileCoord('2', '1', '1')).toBeNull(); // z 下限
    expect(parseTileCoord('a', '1', '1')).toBeNull();
    const url = tdtTileUrl('img_w', 3, 1, 2, 'k', 5);
    expect(url).toContain('https://t5.tianditu.gov.cn/img_w/wmts');
    expect(url).toContain('LAYER=img');
    expect(url).toContain('TILEMATRIXSET=w');
  });
});
