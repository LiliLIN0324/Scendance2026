import { describe, expect, it } from 'vitest';
import { applyModelPrice, bomToCsv, bomToMarkdown, buildBom, buildPriceTable, materialLabel } from './plan-bom';

const chair = (materialPreset?: string) => ({
  name: '折叠椅',
  templateId: 'chair',
  modelOverride: 'folding-chair',
  size: { width: 0.55, depth: 0.53 },
  ...(materialPreset ? { materialPreset } : {}),
});

describe('物料清单', () => {
  it('同型号同尺寸同材质合并计数，不同材质分行', () => {
    const bom = buildBom([chair(), chair(), chair('walnut'), { ...chair(), name: '圆桌', templateId: 'table', size: { width: 1, depth: 1 } }]);
    expect(bom.total).toBe(4);
    expect(bom.kinds).toBe(3);
    const folding = bom.lines.filter(line => line.name === '折叠椅');
    expect(folding).toHaveLength(2);
    expect(folding.find(line => line.material === 'walnut')?.count).toBe(1);
    expect(folding.find(line => line.material === null)?.count).toBe(2);
  });

  it('尺寸差异会拆行，并四舍五入到厘米', () => {
    const bom = buildBom([chair(), { ...chair(), size: { width: 0.551, depth: 0.53 } }]);
    expect(bom.lines).toHaveLength(1);
    expect(bom.lines[0]!.width).toBe(0.55);
    const other = buildBom([chair(), { ...chair(), size: { width: 0.8, depth: 0.53 } }]);
    expect(other.lines).toHaveLength(2);
  });

  it('清单明确标注未定价，不虚构金额', () => {
    const markdown = bomToMarkdown(buildBom([chair('walnut')]));
    expect(markdown).toContain('未定价');
    expect(markdown).not.toMatch(/¥|元/);
    expect(markdown).toContain('深木');
    expect(markdown).toContain('合计 1 件 · 1 种规格');
  });

  it('空清单给出可执行提示', () => {
    expect(bomToMarkdown(buildBom([]))).toContain('清单为空');
  });

  it('材质标签可读，未知 id 原样返回', () => {
    expect(materialLabel('oak')).toBe('浅木');
    expect(materialLabel(null)).toBe('原样');
    expect(materialLabel('mystery')).toBe('mystery');
  });

  it('填了单价才算金额，未定价分开统计', () => {
    const bom = buildBom([
      { ...chair(), unitPrice: 120 },
      { ...chair(), unitPrice: 120 },
      chair(),
    ]);
    expect(bom.totalAmount).toBe(240);
    expect(bom.unpricedCount).toBe(1);
    const markdown = bomToMarkdown(bom);
    expect(markdown).toContain('¥120');
    expect(markdown).toContain('已定价金额 ¥240');
    expect(markdown).toContain('1 件未定价');
  });

  it('同款不同价拆行，不把价格搅在一起', () => {
    const bom = buildBom([{ ...chair(), unitPrice: 100 }, { ...chair(), unitPrice: 120 }]);
    expect(bom.lines).toHaveLength(2);
    expect(bom.totalAmount).toBe(220);
  });
});

describe('价格表与导出', () => {
  const row = (slug: string, unitPrice?: number) => ({
    id: slug + String(unitPrice ?? 'x'),
    name: '折叠椅',
    templateId: 'chair',
    modelOverride: slug,
    size: { width: 0.55, depth: 0.53 },
    ...(unitPrice !== undefined ? { unitPrice } : {}),
  });

  it('按型号聚合，同款数量合并', () => {
    const rows = buildPriceTable([row('a'), row('a'), row('b')]);
    const a = rows.find(item => item.slug === 'a')!;
    expect(a.count).toBe(2);
    expect(a.unitPrice).toBeNull();
  });

  it('混价时不给单一值，避免误改', () => {
    const rows = buildPriceTable([row('a', 100), row('a', 120)]);
    expect(rows[0]!.unitPrice).toBeNull();
  });

  it('一次定价应用到同款全部设施，null 清回未定价', () => {
    const facilities = [row('a'), row('a'), row('b')];
    const priced = applyModelPrice(facilities, 'a', 120);
    expect(priced.filter(item => item.modelOverride === 'a').every(item => item.unitPrice === 120)).toBe(true);
    expect(priced.find(item => item.modelOverride === 'b')!.unitPrice).toBeUndefined();
    const cleared = applyModelPrice(priced, 'a', null);
    expect(cleared.every(item => item.unitPrice === undefined)).toBe(true);
  });

  it('CSV 合计行与逗号转义', () => {
    const bom = buildBom([{ ...chair(), name: '椅, 折叠', unitPrice: 99 }]);
    const csv = bomToCsv(bom);
    expect(csv.split('\n')[0]).toBe('物料,规格(m),材质,数量,单价(元),小计(元)');
    expect(csv).toContain('"椅, 折叠"');
    expect(csv.trim().split('\n').pop()).toBe('合计,,,1,,99');
  });
});
