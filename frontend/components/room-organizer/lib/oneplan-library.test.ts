import { describe, expect, it } from 'vitest';
import {
  LIBRARY_TEMPLATE_PREFIX,
  groupLibraryEntries,
  isLibraryTemplateId,
  libraryEntries,
  libraryEntryFromAsset,
  libraryFootprint,
  libraryFacilityTemplate,
  libraryStickerFor,
  libraryTemplateId,
  parseLibraryTemplateId,
  searchLibraryEntries,
  type OneplanManifestAsset,
} from './oneplan-library';

const asset = (over: Partial<OneplanManifestAsset>): OneplanManifestAsset => ({
  path: '/oneplan-icons/icon/tent.svg',
  kind: 'icon',
  slug: 'tent',
  name_zh: '帐篷',
  name_en: 'Tent',
  category_zh: '设施物料',
  category_en: 'Infrastructure',
  ...over,
});

describe('oneplan-library', () => {
  it('只把 icon / scale-fg / area 当可选物件（scale-bg、categories 只是底形与分类图标）', () => {
    const entries = libraryEntries([
      asset({}),
      asset({ kind: 'scale-fg', slug: 'van' }),
      asset({ kind: 'area', slug: 'crowd', name_zh: '人群面域' }),
      asset({ kind: 'scale-bg', slug: 'van' }),
      asset({ kind: 'categories', slug: 'infrastructure' }),
    ]);
    expect(entries.map(e => e.id)).toEqual(['icon:tent', 'scale:van', 'area:crowd']);
  });

  it('清单条目 → 库条目：中英名、分类、默认占地与 3D 低模种类', () => {
    const entry = libraryEntryFromAsset(asset({ slug: 'tent-3x3-sub', name_zh: '后勤帐篷' }));
    expect(entry).not.toBeNull();
    expect(entry!.kind).toBe('icon');
    expect(entry!.nameZh).toBe('后勤帐篷');
    expect(entry!.nameEn).toBe('Tent');
    expect(entry!.categoryZh).toBe('设施物料');
    // slug 含 tent → 3D 用帐篷低模，默认占地 3×3
    expect(entry!.propKind).toBe('tent');
    expect([entry!.width, entry!.depth]).toEqual([3, 3]);
    expect(entry!.sticker).toEqual({ kind: 'icon', slug: 'tent-3x3-sub', icon: 'shapes' });
  });

  it('缺中文名回落到英文名、再回落到 slug；缺分类归到「未分类」', () => {
    const entry = libraryEntryFromAsset({ path: '', kind: 'scale-fg', slug: 'marshall-unknown', name_en: 'Marshal' });
    expect(entry!.nameZh).toBe('Marshal');
    expect(entry!.nameEn).toBe('Marshal');
    expect(entry!.categoryZh).toBe('未分类');
    const bare = libraryEntryFromAsset({ path: '', kind: 'icon', slug: 'lonely-slug' });
    expect(bare!.nameZh).toBe('lonely-slug');
  });

  it('templateId 带 oneplan: 前缀，可解析回 kind/slug，且不属于内置模板', () => {
    const entry = libraryEntryFromAsset(asset({ kind: 'scale-fg', slug: 'stage' }))!;
    const templateId = libraryTemplateId(entry);
    expect(templateId).toBe(`${LIBRARY_TEMPLATE_PREFIX}scale:stage`);
    expect(isLibraryTemplateId(templateId)).toBe(true);
    expect(isLibraryTemplateId('tent-3x3')).toBe(false);
    expect(parseLibraryTemplateId(templateId)).toEqual({ kind: 'scale', slug: 'stage' });
    expect(parseLibraryTemplateId('tent-3x3')).toBeNull();
    expect(parseLibraryTemplateId('oneplan:bogus:stage')).toBeNull();
    expect(parseLibraryTemplateId('oneplan:scale:')).toBeNull();
  });

  it('库条目 → 设施模板：尺寸/名称进模板，画布放置立刻有真实尺度', () => {
    const entry = libraryEntryFromAsset(asset({ slug: 'food-truck-6x2.5', name_zh: '餐车' }))!;
    const template = libraryFacilityTemplate(entry);
    expect(template.templateId).toBe('oneplan:icon:food-truck-6x2.5');
    expect(template.name).toBe('餐车');
    expect([template.width, template.depth]).toEqual([6, 2.5]);
    // 2D 画布贴纸：内置模板返回 null，库模板返回真贴纸
    expect(libraryStickerFor(template.templateId)).toEqual({ kind: 'icon', slug: 'food-truck-6x2.5', icon: 'shapes' });
    expect(libraryStickerFor('tent-3x3')).toBeNull();
  });

  it('搜索命中中文名 / 英文名 / slug（大小写不敏感，空串返回全部）', () => {
    const entries = libraryEntries([
      asset({}),
      asset({ slug: 'toilets-temporary', name_zh: '临时卫生间', name_en: 'Toilets (Temporary)' }),
      asset({ kind: 'scale-fg', slug: 'police-car', name_zh: '警车', name_en: 'Police car' }),
    ]);
    expect(searchLibraryEntries(entries, '临时').map(e => e.slug)).toEqual(['toilets-temporary']);
    expect(searchLibraryEntries(entries, 'POLICE').map(e => e.slug)).toEqual(['police-car']);
    expect(searchLibraryEntries(entries, ' tent ').map(e => e.slug)).toEqual(['tent']);
    expect(searchLibraryEntries(entries, '').length).toBe(3);
    expect(searchLibraryEntries(entries, 'zzz')).toEqual([]);
  });

  it('分组：面域组排最前，其余按件数降序，组内按中文名排序', () => {
    const entries = libraryEntries([
      asset({ slug: 'b', name_zh: '乙', category_zh: '设施物料' }),
      asset({ slug: 'a', name_zh: '甲', category_zh: '设施物料' }),
      asset({ kind: 'area', slug: 'crowd', name_zh: '人群', category_zh: '面域' }),
      asset({ slug: 'c', name_zh: '丙', category_zh: '车辆' }),
    ]);
    const groups = groupLibraryEntries(entries);
    expect(groups.map(g => g.category)).toEqual(['面域', '设施物料', '车辆']);
    // 组内顺序按中文名排（这里只断言「已排序」，不把具体排序结果写死——Node 的 ICU 数据会变）。
    const names = groups[1]!.items.map(e => e.nameZh);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')));
  });

  it('同一 slug 在 icon / scale-fg 下是两件不同物件（id 不冲突）', () => {
    const entries = libraryEntries([
      asset({ kind: 'icon', slug: 'stage' }),
      asset({ kind: 'scale-fg', slug: 'stage' }),
    ]);
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map(e => e.id)).size).toBe(2);
    expect(new Set(entries.map(e => libraryTemplateId(e))).size).toBe(2);
  });

  it('比例尺轿车按真实车长落图，座椅不再写成 2×2', () => {
    const car = libraryEntryFromAsset(asset({
      kind: 'scale-fg',
      slug: 'car',
      name_zh: '轿车',
      category_zh: '车辆',
      viewBox: '0 0 24 11',
    }))!;
    expect(car.width).toBe(4.5);
    expect(car.depth).toBe(2.1);

    const rotated = libraryEntryFromAsset(asset({
      kind: 'scale-fg',
      slug: 'bus-rotated',
      name_zh: '巴士（旋转）',
      category_zh: '车辆',
      viewBox: '0 0 5.2 24',
    }))!;
    expect(rotated.width).toBe(2.6);
    expect(rotated.depth).toBe(12);

    const chair = libraryEntryFromAsset(asset({
      kind: 'scale-fg',
      slug: 'chair',
      name_zh: '椅子',
      category_zh: '家具',
      viewBox: '0 0 20 24',
    }))!;
    expect(chair.width).toBe(0.5);
    expect(chair.depth).toBe(0.6);

    const cone = libraryEntryFromAsset(asset({
      slug: 'cone',
      name_zh: '锥桶',
      category_zh: '交通管理',
    }))!;
    expect([cone.width, cone.depth]).toEqual([0.4, 0.4]);

    const unknownIcon = libraryEntryFromAsset({ path: '', kind: 'icon', slug: 'lonely-slug' })!;
    expect([unknownIcon.width, unknownIcon.depth]).toEqual([1.2, 1.2]);
  });

  it('libraryFootprint 不把 viewBox 数字当成米', () => {
    const size = libraryFootprint({
      slug: 'shipping-container',
      kind: 'scale-fg',
      viewBox: '0 0 24 10',
    });
    expect(size.width).toBe(6.1);
    expect(size.depth).toBe(2.5);
  });
});
