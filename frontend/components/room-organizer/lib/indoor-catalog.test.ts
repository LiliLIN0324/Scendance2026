import { describe, expect, it } from 'vitest';
import { INDOOR_ROW_LABEL, INDOOR_SLUG_ORDER, indoorItems, isIndoorEntry, withoutIndoor } from './indoor-catalog';
import { libraryFootprint } from './oneplan-library-size';
import type { LibraryEntry } from './oneplan-library';

function entry(slug: string, kind: LibraryEntry['kind'] = 'icon', nameZh = slug, categoryZh = '设施物料 / 构筑物'): LibraryEntry {
  return {
    id: `${kind}:${slug}`,
    slug,
    kind,
    sticker: { kind: 'icon', slug, icon: 'tent' },
    nameZh,
    nameEn: slug,
    categoryZh,
    width: 1,
    depth: 1,
    propKind: 'misc',
  } as LibraryEntry;
}

describe('室内段（用户四轮收敛后的口径）', () => {
  it('段名是「室内」：楼梯、电梯、墙体、窗户，再跟六个门型', () => {
    expect(INDOOR_ROW_LABEL).toBe('室内');
    expect(INDOOR_SLUG_ORDER).toEqual([
      'stairs', 'elevator', 'wall', 'window',
      'door', 'double-door', 'sliding-door', 'revolving-door', 'roller-shutter', 'folding-door',
    ]);
  });

  it('门算室内：门是建筑构件，不是通行图标', () => {
    expect(isIndoorEntry(entry('door'))).toBe(true);
    expect(isIndoorEntry(entry('double-door'))).toBe(true);
    expect(isIndoorEntry(entry('sliding-door'))).toBe(true);
    expect(isIndoorEntry(entry('revolving-door'))).toBe(true);
    expect(isIndoorEntry(entry('roller-shutter'))).toBe(true);
    expect(isIndoorEntry(entry('folding-door'))).toBe(true);
  });

  it('入口、出口、通道、闸门、储物柜、拱门这些通行符号不算室内', () => {
    for (const slug of ['entrance', 'exit', 'in-out', 'walkway', 'vehicle-gate', 'exit-gate', 'entrance-gate', 'storage-locker', 'balloon-arch']) {
      expect(isIndoorEntry(entry(slug))).toBe(false);
    }
    expect(isIndoorEntry(entry('tent'))).toBe(false);
    expect(isIndoorEntry(entry('portable-toilet'))).toBe(false);
  });

  it('同一 slug 只出一件：楼梯取带占地的 scale 版，不把两版都列一遍', () => {
    const items = indoorItems([
      entry('stairs', 'scale', '楼梯'),
      entry('stairs', 'scale', '楼梯'),
      entry('elevator', 'icon', '电梯'),
    ]);
    expect(items.map(item => `${item.slug}:${item.kind}`)).toEqual(['stairs:scale', 'elevator:icon']);
  });

  it('库里的顺序不影响树的顺序，缺的条目直接跳过、不占空位', () => {
    const items = indoorItems([
      entry('window', 'icon', '窗户'),
      entry('tent', 'icon', '帐篷'),
      entry('wall', 'icon', '墙体'),
    ]);
    expect(items.map(item => item.slug)).toEqual(['wall', 'window']);
  });

  it('withoutIndoor 把门从入口组挑走，其余通行图标原样留下', () => {
    const entrance = [
      entry('entrance', 'icon', '入口', '活动区域·流线与通行 / 出入口与通行图标'),
      entry('door', 'icon', '门', '活动区域·流线与通行 / 出入口与通行图标'),
      entry('roller-shutter', 'icon', '卷帘门', '活动区域·流线与通行 / 出入口与通行图标'),
      entry('entrance-gate', 'icon', '入口闸门', '活动区域·流线与通行 / 出入口与通行图标'),
    ];
    expect(withoutIndoor(entrance).map(item => item.slug)).toEqual(['entrance', 'entrance-gate']);
  });

  it('一件都没有时返回空数组，不造占位条目', () => {
    expect(indoorItems([entry('tent'), entry('yurt')])).toEqual([]);
    expect(indoorItems([])).toEqual([]);
  });

  it('占地按真实尺寸：楼梯 2.5×1.3，电梯 2.2×2.0（不再落到「流线」的 10 m）', () => {
    const stairs = libraryFootprint({ slug: 'stairs', kind: 'scale', viewBox: '0 0 24 12' });
    expect(stairs).toEqual({ width: 2.5, depth: 1.3 });
    const elevator = libraryFootprint({
      slug: 'elevator',
      kind: 'icon',
      categoryZh: '活动区域·流线与通行 / 出入口与通行图标',
    });
    expect(elevator).toEqual({ width: 2.2, depth: 2 });
  });
});
