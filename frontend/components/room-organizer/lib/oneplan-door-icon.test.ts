import { describe, expect, it } from 'vitest';
import { entranceIconItems } from './oneplan-catalog';
import { CURATED_MANIFEST_ASSETS, libraryEntries } from './oneplan-library';
import { libraryFootprint } from './oneplan-library-size';

const category = '活动区域·流线与通行 / 出入口与通行图标';

const doorFootprint = (slug: string) => libraryFootprint({ slug, kind: 'icon', categoryZh: category, viewBox: '0 0 24 24' });

describe('门图标进库', () => {
  it('六种门都在「入口和通道图标」组里', () => {
    const entries = libraryEntries([]);
    const group = entranceIconItems(entries).map(entry => entry.slug);
    expect(group).toEqual(
      expect.arrayContaining(['door', 'double-door', 'sliding-door', 'revolving-door', 'roller-shutter', 'folding-door']),
    );
    const names = entranceIconItems(entries)
      .filter(entry => group.includes(entry.slug))
      .map(entry => entry.nameZh);
    expect(names).toEqual(expect.arrayContaining(['门', '双开门', '推拉门', '旋转门', '卷帘门', '折叠门']));
  });

  it('每种门都有自己的素材文件，不共用一张图标', () => {
    const paths = CURATED_MANIFEST_ASSETS.filter(item => /door|shutter/.test(item.slug)).map(item => item.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path.startsWith('/oneplan-icons/icon/')).toBe(true);
    expect(paths).toEqual(expect.arrayContaining(['/oneplan-icons/icon/door.svg', '/oneplan-icons/icon/roller-shutter.svg']));
  });

  it('默认占地是门的大小，不是 10 米通行区', () => {
    const single = doorFootprint('door');
    expect(single.width).toBeCloseTo(1.2, 5);
    expect(single.depth).toBeLessThanOrEqual(0.25);
    expect(doorFootprint('double-door').width).toBeCloseTo(2.4, 5);
    expect(doorFootprint('sliding-door').width).toBeCloseTo(2.4, 5);
    expect(doorFootprint('folding-door').width).toBeCloseTo(2, 5);
    expect(doorFootprint('roller-shutter').width).toBeCloseTo(3, 5);
    expect(doorFootprint('revolving-door').width).toBeCloseTo(1.8, 5);
  });

  it('所有门的占地都远小于分类回落值 10 米', () => {
    for (const slug of ['door', 'double-door', 'sliding-door', 'revolving-door', 'roller-shutter', 'folding-door']) {
      expect(doorFootprint(slug).width).toBeLessThan(4);
    }
  });

  it('闸机之类的 gate 走同一套门尺寸', () => {
    expect(doorFootprint('turnstile-gate').width).toBeCloseTo(1.2, 5);
  });

  it('不加 curated 时清单里没有门（避免把手绘素材混进清单断言）', () => {
    const entries = libraryEntries([], { curated: false });
    expect(entries.some(entry => entry.slug === 'door')).toBe(false);
  });
});
