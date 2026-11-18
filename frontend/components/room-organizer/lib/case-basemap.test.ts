import { describe, expect, it } from 'vitest';
import { caseBasemapTiles } from './case-basemap';

/**
 * 案例卡底图（2026-11-18 用户：「经典案例卡片背后加底图」）。
 *
 * 这里只钉住「卡片不会开天窗、也不会把地面贴错地方」这几条：
 * 取哪类源、瓦片数有没有失控、瓦片矩形是否真的盖住案例范围。
 */

/** Victoria 内港（Scotiabank 冰球日案）；境外 → 全球卫星。 */
const VICTORIA = { lng: -123.370099, lat: 48.423153 };

/** 杭州西湖（境内 → 高德卫星网格）。 */
const HANGZHOU = { lng: 120.141306, lat: 30.2545 };

function square(half: number) {
  return { minX: -half, minY: -half, maxX: half, maxY: half };
}

describe('caseBasemapTiles（案例卡底图取瓦片）', () => {
  it('境外案例走 Esri 全球卫星，瓦片地址带行列号', () => {
    const map = caseBasemapTiles({ anchor: VICTORIA, bounds: square(120) });
    expect(map).not.toBeNull();
    expect(map!.source).toBe('esri-satellite');
    expect(map!.credit).toBe('© Esri');
    expect(map!.tiles[0].url).toContain('server.arcgisonline.com/ArcGIS/rest/services/World_Imagery');
    // World_Imagery 的路径是 /{z}/{y}/{x}：层级、行、列都得是整数，不能留占位符。
    expect(map!.tiles[0].url).toMatch(/tile\/\d+\/\d+\/\d+$/);
  });

  it('境内案例走高德卫星（GCJ-02 网格，与锚点同口径）', () => {
    const map = caseBasemapTiles({ anchor: HANGZHOU, bounds: square(120) });
    expect(map).not.toBeNull();
    expect(map!.source).toBe('amap-satellite');
    expect(map!.credit).toBe('© 高德');
    expect(map!.tiles[0].url).toContain('webst01.is.autonavi.com');
  });

  it('一张卡最多四块瓦片，层级落在 13–18', () => {
    for (const half of [30, 80, 200, 400]) {
      const map = caseBasemapTiles({ anchor: VICTORIA, bounds: square(half) });
      expect(map).not.toBeNull();
      expect(map!.tiles.length).toBeLessThanOrEqual(4);
      expect(map!.zoom).toBeGreaterThanOrEqual(13);
      expect(map!.zoom).toBeLessThanOrEqual(18);
    }
  });

  it('瓦片矩形盖住案例范围（线稿不会落到图外）', () => {
    for (const half of [30, 120, 260]) {
      const bounds = square(half);
      const map = caseBasemapTiles({ anchor: VICTORIA, bounds })!;
      const left = Math.min(...map.tiles.map(tile => tile.rect.x));
      const right = Math.max(...map.tiles.map(tile => tile.rect.x + tile.rect.width));
      const bottom = Math.min(...map.tiles.map(tile => tile.rect.y));
      const top = Math.max(...map.tiles.map(tile => tile.rect.y + tile.rect.height));
      // 容差 2%：ENU↔经纬度用的是本地近似投影，瓦片角点反算会有米级误差。
      const slack = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.02;
      expect(left).toBeLessThanOrEqual(bounds.minX + slack);
      expect(right).toBeGreaterThanOrEqual(bounds.maxX - slack);
      expect(bottom).toBeLessThanOrEqual(bounds.minY + slack);
      expect(top).toBeGreaterThanOrEqual(bounds.maxY - slack);
    }
  });

  it('范围越大层级越粗（同一锚点单调不增）', () => {
    const small = caseBasemapTiles({ anchor: VICTORIA, bounds: square(30) })!;
    const large = caseBasemapTiles({ anchor: VICTORIA, bounds: square(400) })!;
    expect(small.zoom).toBeGreaterThan(large.zoom);
  });

  it('锚点缺失或几何退化时返回 null（调用方保留原来的浅色底）', () => {
    expect(caseBasemapTiles({ anchor: null, bounds: square(100) })).toBeNull();
    expect(caseBasemapTiles({ anchor: { lng: Number.NaN, lat: 48 }, bounds: square(100) })).toBeNull();
    expect(caseBasemapTiles({
      anchor: VICTORIA,
      bounds: { minX: 10, minY: 10, maxX: 10, maxY: 10 },
    })).toBeNull();
  });
});
