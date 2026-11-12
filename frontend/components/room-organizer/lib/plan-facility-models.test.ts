import { describe, expect, it } from 'vitest';

import { registerPackEntries, type LibraryEntry } from './oneplan-library';
import { loadOnlineModels } from './online-models';
import { clearGeneratedFacilityModelsForTests, registerGeneratedFacilityModel } from './facility-generated-models';
import {
  facilityTemplateSlug,
  fitFacilityModel,
  loadFacilityModelCandidates,
  loadFacilityModelOverride,
  resolveFacilityModels,
  selectFacilityModel,
  selectFacilityModelOverride,
  type FacilityModelCandidate,
} from './plan-facility-models';

/** 内置 8 个模板（plan-facility-catalog / plan-footprint-geometry 里的旧模板）。 */
const LEGACY_TEMPLATES = [
  'booth-2x2',
  'tent-3x3',
  'medical-tent-4x3',
  'food-truck-6x2.5',
  'stage-platform-8x6',
  'toilet-2.4x1.2',
  'security-post-1.5x1.5',
  'trash-point-1.2x1.2',
];

function assertWellFormed(candidates: readonly FacilityModelCandidate[]): void {
  for (const candidate of candidates) {
    expect(candidate.slug).toBeTruthy();
    expect(candidate.name).toBeTruthy();
    expect(candidate.glbUrl).toContain(candidate.slug);
    expect(candidate.width).toBeGreaterThan(0);
    expect(candidate.depth).toBeGreaterThan(0);
    expect(candidate.height).toBeGreaterThan(0);
  }
}

describe('facilityTemplateSlug', () => {
  it('解析 oneplan 物件库模板的 slug', () => {
    expect(facilityTemplateSlug('oneplan:scale:tent')).toBe('tent');
    expect(facilityTemplateSlug('oneplan:icon:market-stall')).toBe('market-stall');
    expect(facilityTemplateSlug('oneplan:area:parking')).toBe('parking');
  });

  it('旧 8 个内置模板与非法 id 返回 null', () => {
    for (const templateId of LEGACY_TEMPLATES) {
      expect(facilityTemplateSlug(templateId)).toBeNull();
    }
    expect(facilityTemplateSlug('oneplan:unknown:tent')).toBeNull();
    expect(facilityTemplateSlug('')).toBeNull();
  });
});

describe('resolveFacilityModels', () => {
  it('帐篷模板至少命中一个真实模型', () => {
    const candidates = resolveFacilityModels('tent-3x3');
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    assertWellFormed(candidates);
    expect(candidates[0].glbUrl).toBe(
      '/showcase/assets/library/model/mountaineering-and-summit-expedition-base-camp-dome-te-e93b01ea.glb',
    );
  });

  it('舞台模板命中舞台模型', () => {
    const candidates = resolveFacilityModels('stage-platform-8x6');
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    assertWellFormed(candidates);
  });

  it('厕所、轿车、巴士、集装箱、座椅和本批补入物件命中对应模型', () => {
    const toilet = resolveFacilityModels('oneplan:scale:portable-toilet');
    expect(toilet[0]?.slug).toBe('hot-air-balloon-festival-portable-toilet-block-82a4faf8');
    expect(resolveFacilityModels('toilet-2.4x1.2')[0]?.slug).toBe(toilet[0]?.slug);
    expect(resolveFacilityModels('oneplan:scale:car')[0]?.slug).toBe(
      'car-park-and-road-vehicle-fleet-saloon-ad831b1f',
    );
    expect(resolveFacilityModels('oneplan:scale:bus')[0]?.slug).toBe(
      'bus-station-and-city-transit-city-bus-single-decker-ddf9a355',
    );
    expect(resolveFacilityModels('oneplan:scale:shipping-container')[0]?.slug).toBe(
      'long-haul-trucking-and-truck-stop-container-20ft-bc3beca3',
    );
    expect(resolveFacilityModels('oneplan:scale:chair')[0]?.slug).toBe(
      'bedroom-and-living-room-furniture-dining-chair-timber-b8b614f7',
    );
    expect(resolveFacilityModels('oneplan:scale:golf-cart')[0]?.slug).toBe(
      'golf-course-and-clubhouse-motorised-golf-cart-b754304d',
    );
    expect(resolveFacilityModels('oneplan:scale:ambulance')[0]?.slug).toBe(
      'fire-and-emergency-services-ambulance-f22ce1a5',
    );
    expect(resolveFacilityModels('oneplan:scale:bike-rack')[0]?.slug).toBe(
      'city-park-and-playground-bike-rack-c73abcbf',
    );
    expect(resolveFacilityModels('oneplan:scale:portable-cabin')[0]?.slug).toBe(
      'tool-hire-depot-and-plant-yard-tool-hire-depot-and-pla-fac914d0',
    );
    expect(resolveFacilityModels('oneplan:scale:wooden-chalet')[0]?.slug).toBe(
      'christmas-storybook-market-chalet-f8bf72ba',
    );
    expect(resolveFacilityModels('oneplan:scale:tractor')[0]?.slug).toBe(
      'arable-fields-and-farm-machinery-tracked-tractor-f59c2454',
    );
    expect(resolveFacilityModels('oneplan:icon:street-lamp')[0]?.slug).toBe(
      'bus-station-and-city-transit-street-lamp-2c6420cf',
    );
    expect(resolveFacilityModels('oneplan:icon:traffic-lights')[0]?.slug).toBe(
      'bus-station-and-city-transit-traffic-light-4b8313ca',
    );
    expect(resolveFacilityModels('oneplan:icon:temporary-lighting-tower')[0]?.slug).toBe(
      'tool-hire-depot-and-plant-yard-tool-hire-depot-and-pla-b7d1c941',
    );
    expect(resolveFacilityModels('oneplan:icon:fire-hydrant')[0]?.slug).toBe(
      'fire-and-emergency-services-fire-hydrant-09cb0c64',
    );
    assertWellFormed(toilet);
  });

  it('未映射的杂项不再落到储物箱', () => {
    expect(resolveFacilityModels('oneplan:icon:totally-unknown-prop')).toEqual([]);
  });

  it('帐篷模板不会匹配到舞台类模型', () => {
    const tentCandidates = resolveFacilityModels('oneplan:scale:tent');
    expect(tentCandidates.length).toBeGreaterThanOrEqual(1);
    for (const candidate of tentCandidates) {
      expect(candidate.slug).not.toContain('stage');
      expect(candidate.name).not.toContain('舞台');
    }
  });

  it('摊位模板与垃圾桶模板命中各自类别', () => {
    const booth = resolveFacilityModels('booth-2x2');
    expect(booth.length).toBeGreaterThanOrEqual(1);
    assertWellFormed(booth);
    const bin = resolveFacilityModels('trash-point-1.2x1.2');
    expect(bin.length).toBeGreaterThanOrEqual(1);
    assertWellFormed(bin);
  });

  it('未知模板不会抛错', () => {
    expect(() => resolveFacilityModels('totally-unknown-template')).not.toThrow();
  });

  describe('活动包物件（pack:）3D 素材绑定', () => {
    /** 造一条登记用的包物件条目（id/slug 取 packs.json 的真实形态）。 */
    function packEntry(packId: string, itemId: string, slug: string): LibraryEntry {
      return {
        id: `${packId}/${itemId}`,
        slug,
        kind: 'scale',
        sticker: { kind: 'scale', slug, icon: 'shapes' },
        nameZh: slug,
        nameEn: slug,
        categoryZh: '物件库扩展包 / 测试包',
        width: 2,
        depth: 2,
        propKind: 'misc',
        packId,
        packItemId: itemId,
      };
    }

    it('包 slug 命中物件库映射时自动继承（同命名空间回落）', () => {
      registerPackEntries([packEntry('biathlon', 'led-screen', 'large-screen')]);
      const candidates = resolveFacilityModels('pack:biathlon:led-screen');
      expect(candidates.length).toBeGreaterThanOrEqual(1);
      assertWellFormed(candidates);
      expect(candidates[0]?.slug).toBe('cinema-multiplex-and-foyer-cinema-screen-and-masking-92b7d56f');
    });

    it('包专属映射覆盖（打蜡车/戏台/补给站），未映射物件保持低模占位', () => {
      registerPackEntries([
        packEntry('biathlon', 'team-wax-truck', 'team-wax-truck'),
        packEntry('festival-cn', 'cn-opera-stage', 'cn-opera-stage'),
        packEntry('race', 'aid-station-200m', 'aid-station-200m'),
        packEntry('fairs', 'ferris-wheel', 'ferris-wheel'),
      ]);
      expect(resolveFacilityModels('pack:biathlon:team-wax-truck')[0]?.slug).toBe(
        'car-park-and-road-vehicle-fleet-box-truck-4574c765',
      );
      expect(resolveFacilityModels('pack:festival-cn:cn-opera-stage')[0]?.slug).toBe(
        'live-music-venue-and-festival-stage-stage-deck-module-b23478f5',
      );
      expect(resolveFacilityModels('pack:race:aid-station-200m')[0]?.slug).toBe(
        'medieval-monastery-and-scriptorium-trestle-table-2a0801e0',
      );
      // 没有同类实物模型的包物件（打蜡车之外的杂项）不乱配，保持占位。
      expect(resolveFacilityModels('pack:biathlon:unknown-prop')).toEqual([]);
    });

    it('游乐设施包物件经同命名空间回落命中真模型（2026-11-12 起摩天轮/飞椅/木马已入库）', () => {
      registerPackEntries([
        packEntry('fairs', 'ferris-wheel', 'ferris-wheel'),
        packEntry('christmas', 'ferris-wheel', 'ferris-wheel'),
        packEntry('fairs', 'chair-o-planes', 'chair-o-planes'),
        packEntry('fairs', 'carousel', 'carousel'),
      ]);
      const ferris = resolveFacilityModels('pack:fairs:ferris-wheel');
      expect(ferris[0]?.slug).toBe('theme-park-rides-and-coasters-theme-park-rides-and-coa-d18acb96');
      expect(ferris[0]?.name).toBe('摩天轮');
      expect(ferris[0]?.trueScale).toBe(true);
      // 同名物件在不同包里是两件独立物件，但同 slug 同命中。
      expect(resolveFacilityModels('pack:christmas:ferris-wheel')[0]?.slug).toBe(ferris[0]?.slug);
      expect(resolveFacilityModels('pack:fairs:chair-o-planes')[0]?.slug).toBe(
        'theme-park-rides-and-coasters-theme-park-rides-and-coa-8af0e6ab',
      );
      expect(resolveFacilityModels('pack:fairs:carousel')[0]?.slug).toBe(
        'theme-park-rides-and-coasters-theme-park-rides-and-coa-b3ccf619',
      );
      // 物件库同名 slug 同样命中。
      expect(resolveFacilityModels('oneplan:scale:ferris-wheel')[0]?.trueScale).toBe(true);
      assertWellFormed(ferris);
    });

    it('未登记的 pack: 模板不抛错也不命中', () => {
      registerPackEntries([]);
      expect(resolveFacilityModels('pack:cricket:dugout')).toEqual([]);
    });
  });
});

describe('fitFacilityModel / selectFacilityModel', () => {
  const truck: FacilityModelCandidate = {
    slug: 'car-park-and-road-vehicle-fleet-box-truck-4574c765',
    name: '卷帘门厢式货车',
    glbUrl: '/showcase/assets/library/model/car-park-and-road-vehicle-fleet-box-truck-4574c765.glb',
    width: 2.652,
    depth: 7.542,
    height: 3.484,
  };

  it('细长模型会转 90° 才塞得进占地', () => {
    const fit = fitFacilityModel(6, 2.5, truck);
    expect(fit.swap).toBe(true);
    expect(truck.depth * fit.scale).toBeLessThanOrEqual(6 + 1e-6);
    expect(truck.width * fit.scale).toBeLessThanOrEqual(2.5 + 1e-6);
    expect(fit.height).toBeCloseTo(truck.height * fit.scale, 6);
  });

  it('高度有上限：模型不会被撑到压不住场地', () => {
    const bin = resolveFacilityModels('trash-point-1.2x1.2')[0];
    const fit = fitFacilityModel(1.2, 1.2, bin);
    expect(fit.height).toBeLessThanOrEqual(Math.min(4, 1.2 * 1.2) + 1e-6);
    expect(fit.scale).toBeLessThanOrEqual(2.5);
  });

  it('真比例地标不吃高度上限：摩天轮按占地等比走，2D 画多大就多高', () => {
    const ferris = resolveFacilityModels('oneplan:scale:ferris-wheel')[0];
    expect(ferris?.trueScale).toBe(true);
    // 默认占地（约 8.7×16）：等比缩小到塞进占地，高度不受 4m 上限压缩。
    const fit = fitFacilityModel(8.7, 16, ferris);
    expect(fit.height).toBeCloseTo(ferris.height * fit.scale, 6);
    expect(fit.height).toBeGreaterThan(4);
    // 拉大到接近真尺寸：scale 到 1，显示 17.87m 高。
    const full = fitFacilityModel(19.657, 16.88, ferris);
    expect(full.scale).toBeCloseTo(1, 6);
    expect(full.height).toBeCloseTo(17.87, 3);
  });

  it('没有候选时返回 null，有候选时返回其中一个并带缩放信息', () => {
    expect(selectFacilityModel([], 3, 3)).toBeNull();
    const chosen = selectFacilityModel(resolveFacilityModels('tent-3x3'), 3, 3);
    expect(chosen).not.toBeNull();
    expect(chosen?.scale).toBeGreaterThan(0);
    expect(chosen?.height).toBeGreaterThan(0);
    expect(chosen?.glbUrl).toContain('.glb');
  });
});

describe('loadFacilityModelCandidates', () => {
  it('为每个模板给出候选，含内置映射且数量受限（V-5a 候选上限 5）', async () => {
    const templateIds = [...LEGACY_TEMPLATES, 'oneplan:scale:tent', 'oneplan:icon:market-stall'];
    const map = await loadFacilityModelCandidates(templateIds);
    for (const templateId of templateIds) {
      const candidates = map.get(templateId) ?? [];
      assertWellFormed(candidates);
      expect(candidates.length).toBeLessThanOrEqual(5);
      const slugs = candidates.map((item) => item.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
    expect((map.get('tent-3x3') ?? []).length).toBeGreaterThanOrEqual(1);
    expect((map.get('toilet-2.4x1.2') ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('V-5a：候选上限提到 5——内置 3 个帐篷候选 + 在线兜底最多补到 5，缩略图尽力带上', async () => {
    const tent = (await loadFacilityModelCandidates(['tent-3x3'])).get('tent-3x3') ?? [];
    expect(tent.length).toBeLessThanOrEqual(5);
    expect(tent.length).toBeGreaterThanOrEqual(3);
    // 在线索引在手时，内置候选也按 slug 补缩略图（V-5a 属性卡网格用）。
    const { models } = await loadOnlineModels();
    const thumbBySlug = new Map(models.filter((model) => model.thumb).map((model) => [model.slug, model.thumb]));
    for (const candidate of tent) {
      if (thumbBySlug.has(candidate.slug)) expect(candidate.thumb).toBe(thumbBySlug.get(candidate.slug));
    }
  });
});

describe('selectFacilityModelOverride / loadFacilityModelOverride (V-5a)', () => {
  const modelA: FacilityModelCandidate = {
    slug: 'test-model-a',
    name: '候选 A（小方桌）',
    glbUrl: '/showcase/assets/library/model/test-model-a.glb',
    width: 2,
    depth: 2,
    height: 2,
  };
  const modelB: FacilityModelCandidate = {
    slug: 'test-model-b',
    name: '候选 B（大亭子）',
    glbUrl: '/showcase/assets/library/model/test-model-b.glb',
    width: 10,
    depth: 10,
    height: 2,
  };

  it('override 命中候选时直接用它，不再按占地自动挑选位次', () => {
    const candidates = [modelA, modelB];
    // 自动挑选按占地贴合选 A；override 指定 B 就用 B。
    expect(selectFacilityModel(candidates, 3, 3)?.slug).toBe('test-model-a');
    const overridden = selectFacilityModelOverride(candidates, 'test-model-b', 3, 3);
    expect(overridden?.slug).toBe('test-model-b');
    expect(overridden?.glbUrl).toBe(modelB.glbUrl);
    expect(overridden?.scale).toBeGreaterThan(0);
    expect(overridden?.height).toBeGreaterThan(0);
  });

  it('override 不在候选列表（含空列表）时返回 null，调用方回退自动挑选', () => {
    expect(selectFacilityModelOverride([modelA, modelB], 'no-such-model', 3, 3)).toBeNull();
    expect(selectFacilityModelOverride([], 'test-model-a', 3, 3)).toBeNull();
    // 回退路径本身仍然可用。
    expect(selectFacilityModel([modelA], 3, 3)?.slug).toBe('test-model-a');
  });

  it('loadFacilityModelOverride：内置映射命中的 slug 直查可用', async () => {
    const slug = 'mountaineering-and-summit-expedition-base-camp-dome-te-e93b01ea';
    const resolved = await loadFacilityModelOverride(slug);
    expect(resolved?.glbUrl).toBe(`/showcase/assets/library/model/${slug}.glb`);
    expect(resolved?.name).toBe('大本营圆顶帐篷');
  });

  it('loadFacilityModelOverride：在线库里的 slug 全库直查；不存在的 slug 返回 null', async () => {
    const { models } = await loadOnlineModels();
    const builtinSlugs = new Set(
      [...LEGACY_TEMPLATES, 'oneplan:scale:tent', 'oneplan:icon:market-stall'].flatMap(
        (templateId) => resolveFacilityModels(templateId).map((candidate) => candidate.slug),
      ),
    );
    const onlineOnly = models.find((model) => !builtinSlugs.has(model.slug));
    if (onlineOnly) {
      const resolved = await loadFacilityModelOverride(onlineOnly.slug);
      expect(resolved?.slug).toBe(onlineOnly.slug);
      expect(resolved?.glbUrl).toBe(onlineOnly.glb);
    }
    expect(await loadFacilityModelOverride('definitely-not-a-real-slug-v5a')).toBeNull();
  });

  it('V-5b/c：生成/导入回填的候选（generated:*）优先于物料库解析；清掉后回 null', async () => {
    registerGeneratedFacilityModel({
      slug: 'generated:4475964',
      name: '生成舞台',
      glbUrl: 'http://127.0.0.1:3199/asset/xyz.glb',
      width: 6,
      depth: 4,
      height: 3,
      facilityId: 'facility-1',
      facilityName: '主舞台',
      createdAt: 0,
    });
    try {
      const resolved = await loadFacilityModelOverride('generated:4475964');
      expect(resolved?.glbUrl).toBe('http://127.0.0.1:3199/asset/xyz.glb');
      expect(resolved?.name).toBe('生成舞台');
    } finally {
      clearGeneratedFacilityModelsForTests();
    }
    expect(await loadFacilityModelOverride('generated:4475964')).toBeNull();
  });
});
