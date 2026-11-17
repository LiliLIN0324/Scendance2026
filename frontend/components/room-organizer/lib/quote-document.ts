/**
 * 报价单导出（2026-11-17 v5）。
 *
 * 物料清单能算金额之后，客户要的是一张可以直接发出去的报价单。
 * 这里生成**自包含 HTML**（内联样式、无外链），浏览器「打印 → 另存为 PDF」即为成品；
 * 不引入 PDF 库，也不假装已经生成 PDF 字节。
 *
 * 纯函数：输入 BOM 与标题，输出 HTML 字符串。
 */

import { bomToCsv, materialLabel, type PlanBom } from './plan-bom';

export interface QuoteInput {
  projectName: string;
  bom: PlanBom;
  /** 客户名称（报价单抬头）。 */
  client?: string;
  /** 报价人 / 公司。 */
  preparedBy?: string;
  /** 报价有效期文案，如 2026-12-31。 */
  validUntil?: string;
  /** 生成时间文案（不传则不显示）。 */
  generatedAt?: string;
  /** 备注，例如「价格为暂估，最终以合同为准」。 */
  note?: string;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function buildQuoteHtml(input: QuoteInput): string {
  const { bom, projectName } = input;
  const priced = bom.total - bom.unpricedCount;
  const rows = bom.lines
    .map((line, index) => {
      const unit = line.unitPrice === null ? '未定价' : `¥${line.unitPrice.toFixed(2)}`;
      const subtotal = line.subtotal === null ? '—' : `¥${line.subtotal.toFixed(2)}`;
      return `<tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(line.name)}</td>
      <td>${line.width} × ${line.depth}</td>
      <td>${escapeHtml(materialLabel(line.material))}</td>
      <td class="num">${line.count}</td>
      <td class="num">${unit}</td>
      <td class="num">${subtotal}</td>
    </tr>`;
    })
    .join('\n');
  const metaParts = [
    input.client ? `客户：${escapeHtml(input.client)}` : '',
    input.preparedBy ? `报价人：${escapeHtml(input.preparedBy)}` : '',
    input.validUntil ? `有效期至：${escapeHtml(input.validUntil)}` : '',
    input.generatedAt ? `生成时间：${escapeHtml(input.generatedAt)}` : '',
    `合计 ${bom.total} 件`,
    `${bom.kinds} 种规格`,
    `已定价 ${priced} 件`,
  ].filter(Boolean);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(projectName)} · 物料报价单</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; margin: 32px; color: #141416; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #6b7280; font-size: 12px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 8px 6px; text-align: left; }
  th { background: #f8faf8; font-weight: 600; }
  .num { text-align: right; }
  tfoot td { font-weight: 600; border-top: 2px solid #141416; }
  .note { margin-top: 16px; color: #6b7280; font-size: 12px; }
  @media print { body { margin: 12mm; } }
</style>
</head>
<body>
  <h1>${escapeHtml(projectName)} · 物料报价单</h1>
  <div class="meta">${metaParts.join(' · ')}</div>
  <table>
    <thead>
      <tr><th>#</th><th>物料</th><th>规格 (m)</th><th>材质</th><th class="num">数量</th><th class="num">单价</th><th class="num">小计</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="4">合计</td>
        <td class="num">${bom.total}</td>
        <td class="num">${bom.unpricedCount > 0 ? `${bom.unpricedCount} 件未定价` : ''}</td>
        <td class="num">¥${bom.totalAmount.toFixed(2)}</td>
      </tr>
    </tfoot>
  </table>
  <p class="note">${escapeHtml(input.note ?? '未定价项不按 0 元计，需补齐单价后再出正式报价。')}</p>
</body>
</html>`;
}

/** 报价明细的 CSV（给财务 / Excel）；与清单 CSV 同口径。 */
export function buildQuoteCsv(bom: PlanBom): string {
  return bomToCsv(bom);
}
