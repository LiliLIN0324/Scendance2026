import { describe, expect, it } from 'vitest';
import { buildReviewReference, type ReviewReferenceInput } from './review-copy';

const full: ReviewReferenceInput = {
  name: '秋日品牌快闪', event: '品牌快闪', guests: 24, area: 108, items: 20,
  mustHave: '入口主视觉和试吃台', venueConditions: '室内 12 × 9 米，南侧有柱',
  style: '轻快、自然', palette: '暖米色 + 深绿', atmosphere: '傍晚暖光',
};
const forbidden = ['已发送', '已通知客户', '已通知甲方', '客户已确认', '云端协作已验收', '消防验收', '消防', '疏散', '无障碍', '合规', '验收通过'];

describe('review reference copy', () => {
  it('fills a readable summary from the current activity and scene', () => {
    const copy = buildReviewReference(full);
    expect(copy.summary).toContain('【方案简述参考 · 品牌快闪 · 24 人】');
    expect(copy.summary).toContain('本方案为“秋日品牌快闪”准备，约 108 ㎡，20 件物料。');
    expect(copy.summary).toContain('入口留拍照和缓冲位');
    expect(copy.summary).toContain('必须保留：入口主视觉和试吃台');
    expect(copy.summary).toContain('现场条件：室内 12 × 9 米，南侧有柱');
    expect(copy.summary).toContain('风格：轻快、自然');
    expect(copy.summary).toContain('配色：暖米色 + 深绿');
    expect(copy.summary).toContain('氛围：傍晚暖光');
    expect(copy.summary).toContain('实际尺寸、材质与数量以现场复核和最终确认为准');
    expect(copy.pending).toContain('【待确认参考】');
    expect(copy.pending).toContain('进场时间、用电位置与收银位置需确认。');
    expect(copy.pending).toContain('场地实测尺寸、入口净宽与可用层高。');
    expect(copy.pending).toContain('搭建、撤场与运输的责任分工。');
  });

  it('does not invent an area or item count when the scene has none', () => {
    const copy = buildReviewReference({ event: '工作坊', guests: 12, name: '', area: null, items: 0 });
    expect(copy.summary).toContain('本方案按当前活动布置。');
    expect(copy.summary).not.toContain('㎡');
    expect(copy.summary).not.toContain('件物料');
    expect(copy.summary).toContain('每位参与者有可操作的台面');
  });

  it('keeps optional fields out instead of printing empty labels', () => {
    const copy = buildReviewReference({ event: '其他活动', guests: 8 });
    for (const label of ['必须保留：', '现场条件：', '风格：', '配色：', '氛围：']) expect(copy.summary).not.toContain(label);
    expect(copy.summary).toContain('入口留缓冲');
  });

  it('ignores invalid headcounts rather than printing them', () => {
    expect(buildReviewReference({ ...full, guests: 0 }).summary).not.toContain('· 0 人】');
    expect(buildReviewReference({ ...full, guests: 12.5 }).summary).not.toContain('12.5 人');
  });

  it.each([
    ['婚礼聚会', '仪式、就餐、合影分区与上菜动线需与场地方确认。'],
    ['露营派对', '户外天气、地面固定与夜间照明用电需确认。'],
    ['工作坊', '插座、投影位置与讲师区视线需现场确认。'],
    ['小型黑客松', '工位电源、网络与夜间使用规则需确认。'],
    ['展览市集', '摊位尺寸、卸货口与主通道宽度需场地方确认。'],
    ['品牌快闪', '进场时间、用电位置与收银位置需确认。'],
    ['其他活动', '场地使用时间、用电与进场路线需确认。'],
  ])('gives %s its own first pending item', (event, pending) => {
    expect(buildReviewReference({ event, guests: 10 }).pending).toContain(pending);
  });

  it('keeps both fields within the panel limit and free of compliance or auto-send claims', () => {
    const copy = buildReviewReference({ ...full, mustHave: '很长'.repeat(300), venueConditions: '条件'.repeat(300), style: '风格'.repeat(300) });
    expect(copy.summary.length).toBeLessThanOrEqual(1000);
    expect(copy.pending.length).toBeLessThanOrEqual(1000);
    for (const word of forbidden) {
      expect(copy.summary).not.toContain(word);
      expect(copy.pending).not.toContain(word);
    }
  });

  it('does not mutate its input', () => {
    const input = { ...full };
    const before = JSON.stringify(input);
    buildReviewReference(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
