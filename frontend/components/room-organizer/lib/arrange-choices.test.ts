import { describe, expect, it } from 'vitest';
import { planFacilitySchema } from '../../../../supabase/functions/_shared/site-plan';
import { buildArrangeChoicePage, type ArrangeChoiceModel } from './arrange-choices';
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
});
