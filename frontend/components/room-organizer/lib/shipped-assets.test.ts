import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isPackagedGlbUrl } from './glb-url';
import { SHIPPED_ASSETS, findShippedAsset, listShippedAssets, shippedAssetUrl, shippedImageUrl } from './shipped-assets';

const ARCHIVE = fileURLToPath(new URL('../../../../assets/generated', import.meta.url));
/** 清单按「物件 / 场景」记，货架按文件后缀记，两种说法在这里对齐。 */
const KIND: Record<string, string> = { model: 'glb', scene: 'spz' };

/** 清单是人写的那一份，表是代码读的那一份；两边对不上就说明有人只改了一头。 */
function archiveManifest(): { assets: { name: string; kind: string; file: string; bytes: number }[] } {
  return JSON.parse(readFileSync(`${ARCHIVE}/manifest.json`, 'utf8')) as never;
}

describe('仓库留档的生成素材', () => {
  it('每一条都能在磁盘上找到，字节数和清单一致', () => {
    expect(SHIPPED_ASSETS.length).toBeGreaterThan(0);
    for (const asset of SHIPPED_ASSETS) {
      expect(statSync(`${ARCHIVE}/${asset.path}`).size, asset.path).toBe(asset.bytes);
      if (asset.image) expect(statSync(`${ARCHIVE}/${asset.image}`).size, asset.image).toBeGreaterThan(0);
    }
  });

  it('表与 assets/generated/manifest.json 说的是同一批东西', () => {
    const manifest = archiveManifest().assets;
    expect(manifest.map(row => `${KIND[row.kind ?? ''] ?? row.kind} ${row.file}`)).toEqual(
      SHIPPED_ASSETS.map(asset => `${asset.kind} ${asset.path}`));
    for (const row of manifest) {
      const asset = SHIPPED_ASSETS.find(item => item.path === row.file);
      expect(asset?.name, row.file).toBe(row.name);
      expect(asset?.bytes, row.file).toBe(row.bytes);
    }
  });

  it('地址是随网站发布的同源路径，所以图纸保存时不会被当成会过期的链接剪掉', () => {
    for (const asset of SHIPPED_ASSETS) {
      expect(shippedAssetUrl(asset), asset.assetId).toBe(`/showcase/assets/generated/${asset.path}`);
      expect(isPackagedGlbUrl(shippedAssetUrl(asset)), asset.assetId).toBe(true);
    }
  });

  it('物件与场景各归各的格子，认资产号也认得回来', () => {
    expect(listShippedAssets('glb').every(asset => asset.kind === 'glb')).toBe(true);
    expect(listShippedAssets('spz').every(asset => asset.kind === 'spz')).toBe(true);
    const table = listShippedAssets('glb')[0];
    expect(findShippedAsset(table.assetId)).toBe(table);
    expect(findShippedAsset('4165e104-e2c1-4f5e-b2a4-46602bf9f932')).toBeUndefined();
    expect(findShippedAsset(undefined)).toBeUndefined();
    expect(shippedImageUrl(table)).toBe(`/showcase/assets/generated/${table.image}`);
  });
});
