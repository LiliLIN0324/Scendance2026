import { describe, expect, it } from 'vitest';
import { planFacilitySchema } from '../../../../supabase/functions/_shared/site-plan';
import { arrangePreviewKind, buildArrangePreview, type ArrangeCatalogueItem, type ArrangePreviewSource } from './arrange-preview';

const boundary = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 14 },
  { x: 0, y: 14 },
];

const catalogue: ArrangeCatalogueItem[] = [
  { slug: 'market-stall-2m', name: '市集摊位棚', width: 2, depth: 2, bucket: 'exhibition' },
  { slug: 'folding-chair', name: '折叠椅', width: 0.55, depth: 0.53, bucket: 'seating' },
  { slug: 'round-table', name: '圆餐桌', width: 1.2, depth: 1.2, bucket: 'tables' },
  { slug: 'freezer', name: '单门立式冷冻柜', width: 0.6, depth: 0.6, bucket: 'tables' },
];

let seq = 0;
const ids = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`;
};

const source = (extra?: Partial<ArrangePreviewSource>): ArrangePreviewSource => ({
  boundary,
  facilities: [
    { name: '主舞台', templateId: 'stage-platform-8x6', position: { x: 10, y: 2.5 }, size: { width: 8, depth: 3 } },
  ],
  ...extra,
});

describe('落位预览', () => {
  it('听不出布置就不排', () => {
    expect(arrangePreviewKind('把这几个改成金属')).toBeNull();
    const result = buildArrangePreview('把这几个改成金属', source(), catalogue, ids);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('8 个摊位');
  });

  it('8 个摊位留 2.4 米通道：预览不改原方案，两列朝向通道', () => {
    const plan = source();
    const before = plan.facilities;
    const result = buildArrangePreview('8 个摊位，留 2.4 米通道', plan, catalogue, ids);
    expect(plan.facilities).toBe(before);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facilities).toHaveLength(8);
    expect(result.label).toBe('摊位 8 个');
    expect(result.message).toContain('两侧');
    expect(result.facilities.slice(0, 4).every(item => item.rotationDeg === 90)).toBe(true);
    expect(result.facilities.slice(4).every(item => item.rotationDeg === 270)).toBe(true);
    const left = result.facilities.filter(item => item.rotationDeg === 90).map(item => item.position.x + 1);
    const right = result.facilities.filter(item => item.rotationDeg === 270).map(item => item.position.x - 1);
    expect(Math.min(...right) - Math.max(...left)).toBeCloseTo(2.4);
    for (const facility of result.facilities) {
      expect(planFacilitySchema.safeParse(facility).success).toBe(true);
      expect(facility.templateId).toBe('booth-2x2');
      expect(facility.modelOverride).toBe('market-stall-2m');
      expect(facility.size).toEqual({ width: 2, depth: 2 });
    }
    const committed = [...plan.facilities, ...result.facilities];
    expect(committed).toHaveLength(9);
    expect(plan.facilities).toHaveLength(1);
  });

  it('单侧一排：同一条 x，摊口都朝通道；排不下就明说', () => {
    const result = buildArrangePreview('5 个摊位，单侧一排，留 2.2 米通道', source(), catalogue, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facilities).toHaveLength(5);
    expect(result.message).toContain('单侧');
    expect(new Set(result.facilities.map(item => item.position.x)).size).toBe(1);
    expect(result.facilities.every(item => item.rotationDeg === 90)).toBe(true);
    const overflow = buildArrangePreview('6 个摊位，单侧一排，留 2.2 米通道', source(), catalogue, ids);
    expect(overflow).toEqual({ ok: false, message: '边界放不下 6 个摊位。' });
  });

  it('建筑挡住一侧时，预览把摊位让到另一侧', () => {
    const result = buildArrangePreview('4 个摊位，留 2.4 米通道', source({
      buildings: [{ points: [{ x: 11, y: 0.5 }, { x: 13.4, y: 0.5 }, { x: 13.4, y: 13.5 }, { x: 11, y: 13.5 }] }],
    }), catalogue, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facilities.every(item => item.rotationDeg === 90)).toBe(true);
    expect(result.facilities.every(item => item.position.x < 10)).toBe(true);
  });

  it('观礼区有舞台时面向舞台，确认前不写入原设施列表', () => {
    const plan = source();
    const result = buildArrangePreview('12 人观礼，留 2 米通道', plan, catalogue, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facilities).toHaveLength(12);
    expect(result.facilities.every(item => item.rotationDeg === 180)).toBe(true);
    expect(result.facilities.every(item => item.templateId === 'chair' && item.modelOverride === 'folding-chair')).toBe(true);
    expect(result.message).toContain('面向舞台');
    expect(Math.min(...result.facilities.map(item => item.position.y - item.size.depth / 2))).toBeGreaterThanOrEqual(2.5 + 3 / 2 + 2);
    expect(plan.facilities).toHaveLength(1);
  });

  it('6 组 4 人一桌：桌椅都过契约，桌子不是冷冻柜', () => {
    const result = buildArrangePreview('6 组洽谈，4 人一桌，留 2 米通道', source(), catalogue, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tables = result.facilities.filter(item => item.templateId === 'table');
    const seats = result.facilities.filter(item => item.templateId === 'chair');
    expect(tables).toHaveLength(6);
    expect(seats).toHaveLength(24);
    expect(tables.every(item => item.name === '圆餐桌' && item.modelOverride === 'round-table')).toBe(true);
    expect(result.facilities.every(item => planFacilitySchema.safeParse(item).success)).toBe(true);
  });

  it('句子没写通道时，用方案里的净宽和摊位间距', () => {
    const custom = buildArrangePreview('8 个摊位', source(), catalogue, ids, { aisleClearM: 3.2, boothSpacingM: 1.2 });
    const builtin = buildArrangePreview('8 个摊位', source(), catalogue, ids);
    expect(custom.ok && builtin.ok).toBe(true);
    if (!custom.ok || !builtin.ok) return;
    const gap = (items: typeof custom.facilities) => {
      const left = items.filter(item => item.rotationDeg === 90).map(item => item.position.x + item.size.depth / 2);
      const right = items.filter(item => item.rotationDeg === 270).map(item => item.position.x - item.size.depth / 2);
      return Math.min(...right) - Math.max(...left);
    };
    expect(gap(custom.facilities)).toBeCloseTo(3.2);
    expect(gap(builtin.facilities)).toBeCloseTo(2.4);
    expect(custom.facilities[1]!.position.y - custom.facilities[0]!.position.y).toBeCloseTo(2 + 1.2);
  });

  it('没边界时说明原因，不编一套坐标', () => {
    const result = buildArrangePreview('8 个摊位，留 2.4 米通道', source({ boundary: [] }), catalogue, ids);
    expect(result).toEqual({ ok: false, message: '先画场地边界，再排场景。' });
  });
});
