import { describe, expect, it } from 'vitest';
import { buildBom } from './plan-bom';
import { buildQuoteHtml } from './quote-document';

const bom = () => buildBom([
  { name: '折叠椅 <A>', templateId: 'chair', modelOverride: 'chair-a', size: { width: 0.55, depth: 0.53 }, unitPrice: 88 },
  { name: '圆桌', templateId: 'table', modelOverride: 'table-a', size: { width: 1, depth: 1 } },
]);

describe('报价单 HTML', () => {
  it('自带样式与明细，不依赖外链', () => {
    const html = buildQuoteHtml({ projectName: '周末市集', bom: bom() });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<style>');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain('周末市集');
  });

  it('金额与未定价分开呈现', () => {
    const html = buildQuoteHtml({ projectName: '周末市集', bom: bom() });
    expect(html).toContain('¥88.00');
    expect(html).toContain('1 件未定价');
    expect(html).toContain('¥88.00');
  });

  it('用户文本做 HTML 转义', () => {
    const html = buildQuoteHtml({ projectName: 'A&B <script>', bom: bom() });
    expect(html).toContain('A&amp;B &lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('折叠椅 &lt;A&gt;');
  });

  it('生成时间与备注可带可不带', () => {
    const withMeta = buildQuoteHtml({ projectName: 'X', bom: bom(), generatedAt: '2026-11-17', note: '暂估' });
    expect(withMeta).toContain('生成时间：2026-11-17');
    expect(withMeta).toContain('暂估');
    expect(buildQuoteHtml({ projectName: 'X', bom: bom() })).not.toContain('生成时间');
  });

  it('客户 / 有效期 / 报价人进入抬头，并转义', () => {
    const html = buildQuoteHtml({
      projectName: '秋季发布会',
      bom: bom(),
      client: '星河 <品牌部>',
      preparedBy: '幕景 & 策划',
      validUntil: '2026-12-31',
    });
    expect(html).toContain('客户：星河 &lt;品牌部&gt;');
    expect(html).toContain('报价人：幕景 &amp; 策划');
    expect(html).toContain('有效期至：2026-12-31');
    expect(buildQuoteHtml({ projectName: 'X', bom: bom() })).not.toContain('客户：');
  });
});
