import { describe, expect, it } from 'vitest';
import { AUDIENCE_TAGS, briefExtractResponseSchema, briefSlotSchema } from '../../supabase/functions/_shared/brief-extract-contract';

/**
 * brief-extract contract：zod 形状是「前后端唯一事实源」，任何字段缺失/非法都要在 schema 层被拒。
 * 这里只覆盖新增的 audienceTags / proactiveReply，硬槽用例既有测试已覆盖。
 */
describe('briefSlotSchema — audienceTags', () => {
  it('合法枚举值都通过', () => {
    for (const tag of AUDIENCE_TAGS) {
      const parsed = briefSlotSchema.safeParse({ audienceTags: [tag] });
      expect(parsed.success, tag).toBe(true);
    }
  });

  it('空数组合法（没有受众信号就是空数组）', () => {
    const parsed = briefSlotSchema.safeParse({ audienceTags: [] });
    expect(parsed.success).toBe(true);
  });

  it('缺省字段合法（模型省略 key 也认）', () => {
    const parsed = briefSlotSchema.safeParse({ event: '发布会' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.audienceTags).toBeUndefined();
  });

  it('非法枚举值（如 senior / old）被拒', () => {
    expect(briefSlotSchema.safeParse({ audienceTags: ['senior'] }).success).toBe(false);
    expect(briefSlotSchema.safeParse({ audienceTags: ['old'] }).success).toBe(false);
    expect(briefSlotSchema.safeParse({ audienceTags: ['elderly', 'senior'] }).success).toBe(false);
  });

  it('非数组被拒（字符串/对象/数字都不行）', () => {
    expect(briefSlotSchema.safeParse({ audienceTags: 'elderly' }).success).toBe(false);
    expect(briefSlotSchema.safeParse({ audienceTags: { 0: 'elderly' } }).success).toBe(false);
    expect(briefSlotSchema.safeParse({ audienceTags: 1 }).success).toBe(false);
  });
});

describe('briefSlotSchema — proactiveReply', () => {
  it('字符串合法（中文人话建议）', () => {
    const parsed = briefSlotSchema.safeParse({
      proactiveReply: '主通道按 1.5m 留轮椅宽度，要不要我直接在 2D 上帮你把签到区和休息区圈出来？',
    });
    expect(parsed.success).toBe(true);
  });

  it('null 合法（没话可说）', () => {
    const parsed = briefSlotSchema.safeParse({ proactiveReply: null });
    expect(parsed.success).toBe(true);
  });

  it('缺省合法（模型省略 key）', () => {
    const parsed = briefSlotSchema.safeParse({ event: '发布会' });
    expect(parsed.success).toBe(true);
  });

  it('数字/对象/数组被拒', () => {
    expect(briefSlotSchema.safeParse({ proactiveReply: 123 }).success).toBe(false);
    expect(briefSlotSchema.safeParse({ proactiveReply: { text: 'hi' } }).success).toBe(false);
    expect(briefSlotSchema.safeParse({ proactiveReply: ['hi'] }).success).toBe(false);
  });

  it('超长被拒（>600 字防模型输出失控）', () => {
    const long = '啊'.repeat(601);
    expect(briefSlotSchema.safeParse({ proactiveReply: long }).success).toBe(false);
    const ok = '啊'.repeat(600);
    expect(briefSlotSchema.safeParse({ proactiveReply: ok }).success).toBe(true);
  });
});

describe('briefSlotSchema — mobilityAssistance（elderly ≠ mobilityAssistance 红线）', () => {
  it('true/false 布尔都合法', () => {
    expect(briefSlotSchema.safeParse({ mobilityAssistance: true }).success).toBe(true);
    expect(briefSlotSchema.safeParse({ mobilityAssistance: false }).success).toBe(true);
  });

  it('缺省合法（模型省略 key，等价于 false）', () => {
    const parsed = briefSlotSchema.safeParse({ event: '发布会' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.mobilityAssistance).toBeUndefined();
  });

  it('非布尔被拒（字符串/数字/null 字符串都不行）', () => {
    expect(briefSlotSchema.safeParse({ mobilityAssistance: 'yes' }).success).toBe(false);
    expect(briefSlotSchema.safeParse({ mobilityAssistance: 1 }).success).toBe(false);
    expect(briefSlotSchema.safeParse({ mobilityAssistance: null }).success).toBe(false);
    expect(briefSlotSchema.safeParse({ mobilityAssistance: {} }).success).toBe(false);
  });
});

describe('briefExtractResponseSchema — 整体响应', () => {
  it('extraction 为 null 合法（后端禁用模型时返回 enabled:false）', () => {
    const parsed = briefExtractResponseSchema.safeParse({ enabled: false, extraction: null });
    expect(parsed.success).toBe(true);
  });

  it('新字段随 extraction 一并带过：elderly + mobilityAssistance=false + 确认式问句', () => {
    const parsed = briefExtractResponseSchema.safeParse({
      enabled: true,
      extraction: {
        event: '答谢晚宴',
        headcount: 120,
        audienceTags: ['elderly'],
        mobilityAssistance: false,
        proactiveReply: '长辈里有需要助行器/行动不便的吗？有的话我按 1.5m 通道留，没有按普通 1.2m 也够。要不要我先把签到区和休息区圈出来？',
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.extraction?.audienceTags).toEqual(['elderly']);
      expect(parsed.data.extraction?.mobilityAssistance).toBe(false);
      // 红线：elderly 但 mobilityAssistance=false 时，文案不得断言「轮椅通道 1.5m」
      expect(parsed.data.extraction?.proactiveReply).toContain('1.2m');
      expect(parsed.data.extraction?.proactiveReply).toContain('助行器');
    }
  });

  it('档位 1：mobilityAssistance=true 时文案带 1.5m 硬建议', () => {
    const parsed = briefExtractResponseSchema.safeParse({
      enabled: true,
      extraction: {
        audienceTags: ['elderly'],
        mobilityAssistance: true,
        proactiveReply: '主通道按 1.5m 留轮椅宽度，签到台前先空 2m 排队缓冲。要不要我直接在 2D 上帮你把签到区和休息区圈出来？',
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.extraction?.mobilityAssistance).toBe(true);
      expect(parsed.data.extraction?.proactiveReply).toContain('1.5m');
    }
  });
});
