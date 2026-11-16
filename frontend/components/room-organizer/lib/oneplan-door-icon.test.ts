import { describe, expect, it } from 'vitest';
import { entranceIconItems } from './oneplan-catalog';
import { CURATED_MANIFEST_ASSETS, libraryEntries } from './oneplan-library';
import { libraryFootprint } from './oneplan-library-size';

describe('门图标进库', () => {
  it('手工登记的「门」出现在「入口和通道图标」组里', () => {
    const entries = libraryEntries([]);
    const door = entries.find(entry => entry.slug === 'door');
    expect(door).toBeTruthy();
    expect(door!.nameZh).toBe('门');
    const group = entranceIconItems(entries).map(entry => entry.slug);
    expect(group).toContain('door');
  });

  it('门有自己的素材文件路径，不是借用别的图标', () => {
    const asset = CURATED_MANIFEST_ASSETS.find(item => item.slug === 'door');
    expect(asset?.path).toBe('/oneplan-icons/icon/door.svg');
    expect(asset?.category_zh).toContain('出入口与通行图标');
  });

  it('默认占地是一扇门的大小，不是 10 米通行区', () => {
    const size = libraryFootprint({
      slug: 'door',
      kind: 'icon',
      categoryZh: '活动区域·流线与通行 / 出入口与通行图标',
      viewBox: '0 0 24 24',
    });
    expect(size.width).toBeCloseTo(1.2, 5);
    // 占地至少 0.1 m 起步，取整后是 0.2；关键是不能落到 10 m 那条回落。
    expect(size.depth).toBeLessThanOrEqual(0.25);
  });

  it('闸机之类的 gate 走同一套门尺寸，不会落到 10 米那条回落', () => {
    const size = libraryFootprint({
      slug: 'turnstile-gate',
      kind: 'icon',
      categoryZh: '活动区域·流线与通行 / 出入口与通行图标',
      viewBox: '0 0 24 24',
    });
    expect(size.width).toBeCloseTo(1.2, 5);
  });

  it('不加 curated 时清单里没有门（避免把手绘素材混进清单断言）', () => {
    const entries = libraryEntries([], { curated: false });
    expect(entries.some(entry => entry.slug === 'door')).toBe(false);
  });
});
