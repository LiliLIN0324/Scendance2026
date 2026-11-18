/**
 * 物料清单（BOM）内核（2026-11-17 v2）。
 *
 * 排完道具只解决「摆得下」，成熟产品还要回答「用了什么、多少、什么规格、多少钱」。
 * 本模块把 plan 里的设施聚合成可交付的清单：
 * - 同型号 + 同尺寸 + 同材质 合并计数；
 * - 没有单价的行明确标注「未定价」，不编造金额；
 * - 输出 Markdown / CSV，前端可直接展示 / 复制 / 另存。
 *
 * 纯函数，零 three / 零 React，便于测试与复用。
 * 材质列只做清单里的可读标签；3D 材质替换不在这一层。
 */

export interface BomFacility {
  name: string;
  templateId: string;
  modelOverride?: string | undefined;
  size: { width: number; depth: number };
  materialPreset?: string | undefined;
  /** 人工填写的单价（元）；缺省=未定价。 */
  unitPrice?: number | undefined;
}

export interface BomLine {
  /** 聚合键：型号 + 尺寸 + 材质。 */
  key: string;
  name: string;
  slug: string | null;
  templateId: string;
  width: number;
  depth: number;
  material: string | null;
  count: number;
  /** 单价（元）；null = 未定价。 */
  unitPrice: number | null;
  /** 小计（元）；未定价为 null。 */
  subtotal: number | null;
}

export interface PlanBom {
  lines: BomLine[];
  /** 总件数。 */
  total: number;
  /** 规格种数（聚合后行数）。 */
  kinds: number;
  /** 已定价部分金额（元）；全部未定价时为 0。 */
  totalAmount: number;
  /** 未定价件数。 */
  unpricedCount: number;
  /** 清单必须显式说明未定价项，不能把缺价当成 0 元。 */
  unpriced: true;
}

/** 清单材质列的显示名。未知 id 原样返回，不编造一种材质。 */
const MATERIAL_LABELS: Readonly<Record<string, string>> = {
  oak: '浅木',
  walnut: '深木',
  metal: '黑金属',
  steel: '拉丝钢',
  fabric: '布艺',
  glass: '玻璃',
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** 按型号 + 尺寸 + 材质聚合；排序稳定，便于人读与对比。 */
export function buildBom(facilities: readonly BomFacility[]): PlanBom {
  const map = new Map<string, BomLine>();
  for (const facility of facilities) {
    const slug = facility.modelOverride ?? null;
    const material = facility.materialPreset ?? null;
    const unitPrice = typeof facility.unitPrice === 'number' ? facility.unitPrice : null;
    const width = round2(facility.size.width);
    const depth = round2(facility.size.depth);
    const key = `${slug ?? facility.name}|${width}x${depth}|${material ?? 'original'}|${unitPrice ?? 'unpriced'}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.subtotal = existing.unitPrice === null ? null : existing.unitPrice * existing.count;
      continue;
    }
    map.set(key, {
      key,
      name: facility.name,
      slug,
      templateId: facility.templateId,
      width,
      depth,
      material,
      count: 1,
      unitPrice,
      subtotal: unitPrice,
    });
  }
  const lines = [...map.values()].sort((a, b) => {
    if (a.templateId !== b.templateId) return a.templateId.localeCompare(b.templateId);
    if (a.name !== b.name) return a.name.localeCompare(b.name, 'zh-Hans-CN');
    if (a.width !== b.width) return b.width - a.width;
    return (a.material ?? '').localeCompare(b.material ?? '');
  });
  const totalAmount = lines.reduce((sum, line) => sum + (line.subtotal ?? 0), 0);
  const unpricedCount = lines.reduce((sum, line) => sum + (line.unitPrice === null ? line.count : 0), 0);
  return {
    lines,
    total: lines.reduce((sum, line) => sum + line.count, 0),
    kinds: lines.length,
    totalAmount,
    unpricedCount,
    unpriced: true,
  };
}

export function materialLabel(id: string | null): string {
  if (!id) return '原样';
  return MATERIAL_LABELS[id] ?? id;
}

/** 价格表：按型号聚合（同款一次定价），混价时不给单一值。 */
export interface PriceRow {
  slug: string | null;
  name: string;
  count: number;
  unitPrice: number | null;
}

export function buildPriceTable(facilities: readonly BomFacility[]): PriceRow[] {
  const map = new Map<string, { row: PriceRow; prices: Set<number | null> }>();
  for (const facility of facilities) {
    const slug = facility.modelOverride ?? null;
    const key = slug ?? `name:${facility.name}`;
    const price = typeof facility.unitPrice === 'number' ? facility.unitPrice : null;
    const existing = map.get(key);
    if (existing) {
      existing.row.count += 1;
      existing.prices.add(price);
      continue;
    }
    map.set(key, { row: { slug, name: facility.name, count: 1, unitPrice: price }, prices: new Set([price]) });
  }
  return [...map.values()]
    .map(({ row, prices }) => ({ ...row, unitPrice: prices.size === 1 ? [...prices][0]! : null }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

/** 一次定价：把同型号的全部设施改成同一单价；null = 清回未定价。 */
export function applyModelPrice<T extends BomFacility>(
  facilities: readonly T[],
  slug: string,
  unitPrice: number | null,
): T[] {
  return facilities.map(facility => {
    if (facility.modelOverride !== slug) return facility;
    const next = { ...facility } as T & { unitPrice?: number };
    if (unitPrice === null) delete next.unitPrice;
    else next.unitPrice = unitPrice;
    return next;
  });
}

/** CSV 导出：给 Excel / 报价单用；字段含逗号/引号时按 RFC 4180 转义。 */
export function bomToCsv(bom: PlanBom): string {
  const escape = (value: string | number | null) => {
    const text = value === null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows: Array<Array<string | number | null>> = [
    ['物料', '规格(m)', '材质', '数量', '单价(元)', '小计(元)'],
  ];
  for (const line of bom.lines) {
    rows.push([
      line.name,
      `${line.width}x${line.depth}`,
      materialLabel(line.material),
      line.count,
      line.unitPrice,
      line.subtotal,
    ]);
  }
  rows.push(['合计', '', '', bom.total, '', bom.totalAmount]);
  return rows.map(row => row.map(escape).join(',')).join('\n');
}

export function bomToMarkdown(bom: PlanBom): string {
  if (bom.lines.length === 0) return '清单为空：先布置道具。';
  const rows = bom.lines.map((line, index) => {
    const size = `${line.width}×${line.depth}`;
    const unit = line.unitPrice === null ? '未定价' : `¥${line.unitPrice}`;
    const subtotal = line.subtotal === null ? '—' : `¥${line.subtotal}`;
    return `| ${index + 1} | ${line.name} | ${size} | ${materialLabel(line.material)} | ${line.count} | ${unit} | ${subtotal} |`;
  });
  return [
    '| # | 物料 | 规格 (m) | 材质 | 数量 | 单价 | 小计 |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    `合计 ${bom.total} 件 · ${bom.kinds} 种规格`,
    ...(bom.unpricedCount === bom.total
      ? ['', '> 价格：物料库暂无价格字段，本清单不含金额，未定价项不虚构单价。']
      : [
        '',
        bom.unpricedCount > 0
          ? `已定价金额 ¥${bom.totalAmount}（${bom.unpricedCount} 件未定价，未计入金额）`
          : `已定价金额 ¥${bom.totalAmount}`,
      ]),
  ].join('\n');
}
