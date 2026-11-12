import { describe, expect, it, vi } from 'vitest';
import {
  BasemapTileCache,
  ancestorTileCrop,
  paintBasemapTiles,
} from './plan-tile-cache';

/** 可控的假 Image：设置 src 后手动触发 onload/onerror。 */
function fakeImageFactory() {
  const created: { src: string; fireLoad: () => void; fireError: () => void }[] = [];
  const createImage = () => {
    const state = { src: '' };
    const img = {
      crossOrigin: '' as string | null,
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };
    Object.defineProperty(img, 'src', {
      get: () => state.src,
      set: (value: string) => {
        state.src = value;
        created.push({
          src: value,
          fireLoad: () => img.onload?.(),
          fireError: () => img.onerror?.(),
        });
      },
    });
    return img as unknown as HTMLImageElement;
  };
  return { created, createImage };
}

describe('ancestorTileCrop', () => {
  it('一级祖先把四格合成一格，左上角子块裁剪在原图左上', () => {
    expect(ancestorTileCrop(15, 100, 50, 1, 256)).toEqual({
      zoom: 14,
      x: 50,
      y: 25,
      sx: 0,
      sy: 0,
      size: 128,
    });
  });

  it('奇数坐标落在祖先的右半/下半，裁剪原点相应偏移', () => {
    expect(ancestorTileCrop(15, 101, 51, 1, 256)).toEqual({
      zoom: 14,
      x: 50,
      y: 25,
      sx: 128,
      sy: 128,
      size: 128,
    });
  });

  it('两级祖先裁剪边长是 1/4，层级也退两级', () => {
    const crop = ancestorTileCrop(16, 104, 52, 2, 256);
    expect(crop.zoom).toBe(14);
    expect(crop.x).toBe(26);
    expect(crop.y).toBe(13);
    expect(crop.size).toBe(64);
    expect(crop.sx).toBe(0);
  });

  it('不会退到负层级', () => {
    expect(ancestorTileCrop(1, 0, 0, 4, 256).zoom).toBe(0);
  });
});

describe('BasemapTileCache', () => {
  it('同一 URL 只创建一张 Image，就绪前 get 返回 null，就绪后返回图片', () => {
    const { created, createImage } = fakeImageFactory();
    const cache = new BasemapTileCache({ createImage });
    const onReady = vi.fn();
    cache.load('a.png', onReady);
    cache.load('a.png', onReady);
    expect(created).toHaveLength(1);
    expect(cache.get('a.png')).toBeNull();
    created[0]!.fireLoad();
    expect(cache.get('a.png')).not.toBeNull();
    expect(onReady).toHaveBeenCalledTimes(2);
  });

  it('加载失败会记录 error，并回调监听者让其结算（否则 3D 瓦片队列会永久 pending）', () => {
    const { created, createImage } = fakeImageFactory();
    const cache = new BasemapTileCache({ createImage });
    const onReady = vi.fn();
    cache.load('bad.png', onReady);
    created[0]!.fireError();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(cache.get('bad.png')).toBeNull();
    expect(cache.status('bad.png')).toBe('error');
    expect(cache.stats.errors).toBe(1);
  });

  it('失败的瓦片再次 load 会重试（最多 3 次），成功后就绪', () => {
    const { created, createImage } = fakeImageFactory();
    const cache = new BasemapTileCache({ createImage });
    cache.load('flaky.png', () => {});
    created[0]!.fireError();
    const retry = vi.fn();
    cache.load('flaky.png', retry);
    created[1]!.fireLoad();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(cache.get('flaky.png')).not.toBeNull();
    // 用尽重试后不再重发请求：首次 + 2 次重试 = 3 次 src 赋值。
    const before = created.length;
    cache.load('dead.png', () => {});
    created[before]!.fireError();
    cache.load('dead.png', () => {});
    created[before + 1]!.fireError();
    cache.load('dead.png', () => {});
    created[before + 2]!.fireError();
    cache.load('dead.png', () => {});
    expect(created.length).toBe(before + 3);
    expect(cache.status('dead.png')).toBe('error');
  });

  it('已就绪的 URL 再次 load 时同步回调，不重复发请求', () => {
    const { created, createImage } = fakeImageFactory();
    const cache = new BasemapTileCache({ createImage });
    cache.load('a.png', () => {});
    created[0]!.fireLoad();
    const again = vi.fn();
    cache.load('a.png', again);
    expect(again).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
  });

  it('超过上限按插入顺序淘汰最旧的', () => {
    const { created, createImage } = fakeImageFactory();
    const cache = new BasemapTileCache({ max: 2, createImage });
    cache.load('a.png', () => {});
    cache.load('b.png', () => {});
    created[0]!.fireLoad();
    created[1]!.fireLoad();
    cache.load('c.png', () => {});
    expect(cache.has('a.png')).toBe(false);
    expect(cache.has('c.png')).toBe(true);
    expect(cache.size).toBe(2);
  });

  it('clear 后回到空缓存', () => {
    const { created, createImage } = fakeImageFactory();
    const cache = new BasemapTileCache({ createImage });
    cache.load('a.png', () => {});
    created[0]!.fireLoad();
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a.png')).toBeNull();
  });
});

describe('paintBasemapTiles', () => {
  interface DrawCall { img: unknown; args: number[] }

  function makeCtx() {
    const calls: DrawCall[] = [];
    const ctx = {
      drawImage: (img: unknown, ...args: number[]) => {
        calls.push({ img, args });
      },
    } as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
  }

  it('当前层级命中缓存时每层各画一次', () => {
    const { created, createImage } = fakeImageFactory();
    const cache = new BasemapTileCache({ createImage });
    cache.load('z15.png', () => {});
    created[0]!.fireLoad();
    const { ctx, calls } = makeCtx();
    // 视口中心落在这块瓦片的右下角：瓦片左上角正好贴视口原点。
    const result = paintBasemapTiles({
      ctx,
      cache,
      zoom: 15,
      centerPx: 256,
      centerPy: 256,
      cssW: 512,
      cssH: 512,
      tileSize: 256,
      tiles: [{ x: 0, y: 0 }],
      urlsFor: () => ['z15.png'],
      onDirty: () => {},
    });
    expect(result.drawn).toBe(1);
    expect(result.fallback).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual([0, 0, 256, 256]);
  });

  it('视图级别超过图源上限时，按上限级取瓦片并等比放大（overzoom）', () => {
    const { created, createImage } = fakeImageFactory();
    const cache = new BasemapTileCache({ createImage });
    cache.load('z19.png', () => {});
    created[0]!.fireLoad();
    const { ctx, calls } = makeCtx();
    const asked: number[] = [];
    const result = paintBasemapTiles({
      ctx,
      cache,
      // 视图 z21，图源只到 z19：一张 z19 瓦片应被放大 4 倍（256 → 1024）。
      zoom: 21,
      tileZoom: 19,
      centerPx: 512,
      centerPy: 512,
      cssW: 1024,
      cssH: 1024,
      tileSize: 256,
      tiles: [{ x: 0, y: 0 }],
      urlsFor: (zoom: number) => {
        asked.push(zoom);
        return ['z19.png'];
      },
      onDirty: () => {},
    });
    expect(asked).toContain(19);
    expect(result.drawn).toBe(1);
    expect(calls[0]!.args).toEqual([0, 0, 1024, 1024]);
  });

  it('当前层级缺失但有祖先缓存时，用祖先子区域放大兜底并排入加载', () => {
    const { created, createImage } = fakeImageFactory();
    const cache = new BasemapTileCache({ createImage });
    cache.load('z14.png', () => {});
    created[0]!.fireLoad();
    const { ctx, calls } = makeCtx();
    const urlsFor = (zoom: number) => [`z${zoom}.png`];
    // 把 (101, 51) 这块瓦片摆到视口左上角，确保它没有被「视口外」裁掉。
    const result = paintBasemapTiles({
      ctx,
      cache,
      zoom: 15,
      centerPx: 102 * 256,
      centerPy: 52 * 256,
      cssW: 512,
      cssH: 512,
      tileSize: 256,
      tiles: [{ x: 101, y: 51 }],
      urlsFor,
      onDirty: () => {},
    });
    expect(result.fallback).toBe(1);
    expect(calls).toHaveLength(1);
    // 祖先 z14 里对应子块原点在右下半（sx/sy = 128），放大到整格。
    expect(calls[0]!.args.slice(0, 4)).toEqual([128, 128, 128, 128]);
    // 目标矩形 = 该瓦片在视口里的位置（左上角）。
    expect(calls[0]!.args.slice(4)).toEqual([0, 0, 256, 256]);
    // 当前层级瓦片也已排队加载
    expect(cache.has('z15.png')).toBe(true);
  });

  it('完全没有缓存时只排队、不画，并计入 pending', () => {
    const { createImage } = fakeImageFactory();
    const cache = new BasemapTileCache({ createImage });
    const { ctx, calls } = makeCtx();
    const result = paintBasemapTiles({
      ctx,
      cache,
      zoom: 15,
      centerPx: 0,
      centerPy: 0,
      cssW: 512,
      cssH: 512,
      tileSize: 256,
      tiles: [{ x: 0, y: 0 }],
      urlsFor: zoom => [`z${zoom}.png`],
      onDirty: () => {},
    });
    expect(calls).toHaveLength(0);
    expect(result.pending).toBe(1);
    expect(cache.has('z15.png')).toBe(true);
  });

  it('视口外的瓦片直接跳过', () => {
    const { created, createImage } = fakeImageFactory();
    const cache = new BasemapTileCache({ createImage });
    cache.load('z15.png', () => {});
    created[0]!.fireLoad();
    const { ctx, calls } = makeCtx();
    const result = paintBasemapTiles({
      ctx,
      cache,
      zoom: 15,
      centerPx: 0,
      centerPy: 0,
      cssW: 512,
      cssH: 512,
      tileSize: 256,
      tiles: [{ x: -20, y: -20 }],
      urlsFor: () => ['z15.png'],
      onDirty: () => {},
    });
    expect(calls).toHaveLength(0);
    expect(result.drawn).toBe(0);
  });

  it('双层图源（底图 + 注记）各画一遍', () => {
    const { created, createImage } = fakeImageFactory();
    const cache = new BasemapTileCache({ createImage });
    cache.load('base.png', () => {});
    cache.load('note.png', () => {});
    created[0]!.fireLoad();
    created[1]!.fireLoad();
    const { ctx, calls } = makeCtx();
    const result = paintBasemapTiles({
      ctx,
      cache,
      zoom: 15,
      centerPx: 0,
      centerPy: 0,
      cssW: 512,
      cssH: 512,
      tileSize: 256,
      tiles: [{ x: 0, y: 0 }],
      urlsFor: () => ['base.png', 'note.png'],
      onDirty: () => {},
    });
    expect(result.drawn).toBe(2);
    expect(calls).toHaveLength(2);
  });
});