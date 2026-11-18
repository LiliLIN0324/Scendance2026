import { describe, expect, it } from 'vitest';
import { planFacilitySchema } from '../../../../supabase/functions/_shared/site-plan';
import {
  arrangeAholoSheet,
  arrangeGeneratePrompt,
  buildArrangeChoicePage,
  buildGeneratedArrangeChoice,
  offerGeneratedArrangeChoice,
  type ArrangeChoiceModel,
} from './arrange-choices';
import { capabilityForSlug } from './prop-capabilities';

const boundary = [
  { x: 0, y: 0 },
  { x: 12, y: 0 },
  { x: 12, y: 8 },
  { x: 0, y: 8 },
];

const models: ArrangeChoiceModel[] = [
  { slug: 'stool', name: '纹身师工作凳', width: 0.555, depth: 0.53, kind: 'seat' },
  { slug: 'chair', name: '礼堂椅', width: 0.62, depth: 0.6, kind: 'seat' },
  { slug: 'bench', name: '长凳', width: 1.8, depth: 0.45, kind: 'seat' },
  { slug: 'sofa', name: '三人沙发', width: 2.2, depth: 0.9, kind: 'seat' },
  { slug: 'atm', name: 'ATM', width: 0.9, depth: 0.7, kind: 'operate' },
  { slug: 'column', name: '装饰柱', width: 0.4, depth: 0.4, kind: 'none' },
];

let seq = 0;
const ids = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`;
};

describe('语义三选一', () => {
  it('观礼要能坐时给出三款，礼堂椅排在纹身凳前面', () => {
    const result = buildArrangeChoicePage({
      text: '12 把椅子，观礼要能坐，留 1 米通道，椅子用深木',
      boundary,
      models,
      ids,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.choices.map(choice => choice.slug)).toEqual(['chair', 'bench', 'stool']);
    expect(result.choices[0]!.reason).toContain('场景匹配');
    expect(result.choices[2]!.reason).toContain('用途不相关');
    expect(result.message).toContain('给了 3 个方案');
    expect(result.message).toContain('材质保持原样');
    const picked = result.choices[0]!;
    expect(picked.facilities).toHaveLength(12);
    expect(picked.facilities.every(item => planFacilitySchema.safeParse(item).success)).toBe(true);
    expect(picked.facilities.every(item => item.templateId === 'chair' && item.modelOverride === 'chair')).toBe(true);
    expect(picked.facilities.every(item => !('materialPreset' in item) && !('unitPrice' in item))).toBe(true);
    const front = Math.min(...picked.facilities.map(item => item.position.y - item.size.depth / 2));
    expect(front).toBeGreaterThanOrEqual(1);
  });

  it('换一批给出下一页，排完就停在说明上', () => {
    const wide = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 16 },
      { x: 0, y: 16 },
    ];
    const first = buildArrangeChoicePage({ text: '12 把椅子要能坐', boundary: wide, models, ids });
    const second = buildArrangeChoicePage({ text: '12 把椅子要能坐', boundary: wide, models, page: 1, ids });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.choices.map(choice => choice.slug)).toEqual(['chair', 'bench', 'sofa']);
    expect(second.choices.map(choice => choice.slug)).toEqual(['stool']);
    const done = buildArrangeChoicePage({ text: '12 把椅子要能坐', boundary: wide, models, page: 2, ids });
    expect(done).toEqual({ ok: false, message: '没有更多可换的款。', keepCurrent: true, reason: 'empty' });
  });

  it('听不出能力、缺数量、没边界时不编坐标', () => {
    expect(buildArrangeChoicePage({ text: '把这几个改成金属', boundary, models, ids })).toMatchObject({
      ok: false,
      keepCurrent: false,
    });
    expect(buildArrangeChoicePage({ text: '要能坐', boundary, models, ids }).ok).toBe(false);
    const missing = buildArrangeChoicePage({ text: '摆几把椅子', boundary, models, ids });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.message).toContain('30 人');
    const open = buildArrangeChoicePage({ text: '12 把椅子要能坐', boundary: [], models, ids });
    expect(open).toEqual({ ok: false, message: '先画场地边界，再按需求排道具。', keepCurrent: false, reason: 'boundary' });
  });

  it('能力对不上就不出货', () => {
    const result = buildArrangeChoicePage({
      text: '放 2 个自助取号机',
      boundary,
      models: models.filter(model => model.kind !== 'operate'),
      ids,
    });
    expect(result).toEqual({ ok: false, message: '物料库里没有满足这个能力的模型。', keepCurrent: false, reason: 'empty' });
  });

  it('大块红线上，选中的设施旁边才放这 12 把，不贴在南缘', () => {
    const wide = [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 80 },
      { x: 0, y: 80 },
    ];
    const focus = { x: 40, y: 40, width: 2.3, depth: 2.2 };
    const result = buildArrangeChoicePage({
      text: '要能坐 12 把',
      boundary: wide,
      models,
      focus,
      ids,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const chairs = result.choices[0]!.facilities;
    expect(chairs).toHaveLength(12);
    const ys = chairs.map(item => item.position.y);
    expect(Math.min(...ys)).toBeGreaterThan(20);
    const nearest = Math.min(...chairs.map(item => Math.hypot(item.position.x - focus.x, item.position.y - focus.y)));
    expect(nearest).toBeLessThan(12);
    const xs = [...chairs.map(item => item.position.x)].sort((a, b) => a - b);
    expect(xs[1]! - xs[0]!).toBeCloseTo(0.62 + 0.6);
    for (const chair of chairs) {
      expect(chair.position.x).toBeGreaterThan(0);
      expect(chair.position.x).toBeLessThan(80);
      expect(chair.position.y).toBeGreaterThan(0);
      expect(chair.position.y).toBeLessThan(80);
    }
  });

  it('能力表里的纹身凳是可坐，观礼时排在礼堂椅后面', () => {
    const stool = capabilityForSlug('tattoo-and-piercing-studio-artists-stool-4b12a1fb');
    expect(stool?.kind).toBe('seat');
    const result = buildArrangeChoicePage({
      text: '8 把椅子，观礼要能坐',
      boundary,
      models: [
        {
          slug: 'tattoo-and-piercing-studio-artists-stool-4b12a1fb',
          name: '纹身师工作凳',
          width: 0.555,
          depth: 0.53,
          kind: stool?.kind ?? 'none',
        },
        { slug: 'hall-chair', name: '礼堂椅', width: 0.62, depth: 0.6, kind: 'seat' },
      ],
      ids,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.choices[0]!.slug).toBe('hall-chair');
  });

  it('目录缩略图和模板跟着候选走，没有图就是空字符串', () => {
    const result = buildArrangeChoicePage({
      text: '要能坐 12 把',
      boundary,
      models: [
        {
          slug: 'hot-air-balloon-festival-folding-camp-chair-ba5bb3d0',
          name: '热气球营地折叠椅',
          width: 0.48,
          depth: 0.49,
          kind: 'seat',
          thumb: '/showcase/assets/library/thumb/hot-air-balloon-festival-folding-camp-chair-ba5bb3d0.webp',
        },
      ],
      ids,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.choices[0]).toMatchObject({
      thumb: '/showcase/assets/library/thumb/hot-air-balloon-festival-folding-camp-chair-ba5bb3d0.webp',
      templateId: 'chair',
    });
    const bare = buildArrangeChoicePage({
      text: '要能坐 12 把',
      boundary,
      models: [{ slug: 'chair', name: '礼堂椅', width: 0.62, depth: 0.6, kind: 'seat' }],
      ids,
    });
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    expect(bare.choices[0]!.thumb).toBe('');
  });

  it('Aholo 生成的一款排在最前，点它用的是这款的尺寸和 slug', () => {
    const generated: ArrangeChoiceModel = {
      slug: 'generated:4475964',
      name: '一把能坐的椅子',
      width: 0.5,
      depth: 0.5,
      kind: 'none',
    };
    const result = buildArrangeChoicePage({
      text: '要能坐 12 把',
      boundary,
      models,
      pinned: generated,
      ids,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.choices[0]).toMatchObject({
      slug: 'generated:4475964',
      name: '一把能坐的椅子',
      reason: 'Aholo 生成',
      templateId: 'chair',
      thumb: '',
    });
    expect(result.choices[0]!.facilities).toHaveLength(12);
    expect(result.choices[0]!.facilities.every(item => item.modelOverride === 'generated:4475964')).toBe(true);
    expect(result.choices[0]!.facilities.every(item => item.size.width === 0.5 && item.size.depth === 0.5)).toBe(true);
    const plain = buildArrangeChoicePage({ text: '要能坐 12 把', boundary, models, ids });
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    expect(result.choices.slice(1).map(choice => choice.slug)).toEqual(plain.choices.map(choice => choice.slug));
    const alone = buildGeneratedArrangeChoice({ text: '要能坐 12 把', boundary, model: generated, ids });
    expect(alone?.slug).toBe('generated:4475964');
    expect(offerGeneratedArrangeChoice(
      result.choices.slice(1),
      result.choices[0]!,
    ).map(choice => choice.slug)).toEqual(['generated:4475964', 'chair', 'bench', 'sofa']);
  });

  it('生成入口只准备描述，不带提交', () => {
    expect(arrangeGeneratePrompt('要能坐 12 把')).toBe('一把能坐的椅子');
    expect(arrangeGeneratePrompt('接待 4 个')).toBe('一件可以接待交谈的桌台');
    expect(arrangeGeneratePrompt('放 2 个自助取号机')).toBe('一台自助设备');
    const sheet = arrangeAholoSheet('要能坐 12 把', { id: 'booth-1', name: '  马戏团售票亭 1  ' });
    expect(sheet).toEqual({
      task: 'model',
      scope: 'facility',
      source: 'text',
      facility: { id: 'booth-1', name: '马戏团售票亭 1' },
      prompt: '一把能坐的椅子',
    });
  });
});
