import { describe, it, expect } from 'vitest';
import {
  GENERATED_OBJECT_NAME_MAX,
  generatedObjectName,
  generatedObjectNotes,
} from '../supabase/functions/_shared/generated-object-name.ts';

/**
 * Worker 归档用这一份实现；前端通过 re-export 使用同一份。
 * 这条测试守住「入库的名字不是整段提示词」。
 */
describe('generated object name (worker archive)', () => {
  it('takes the subject before the colon instead of storing the whole spec', () => {
    expect(
      generatedObjectName(
        '户外折叠椅 1：铝合金折叠框架，藏青色厚棉布坐垫靠背，座高 45 厘米，展开尺寸约 45×50×88 厘米，四脚带黑色防滑脚垫，可折叠收纳。',
      ),
    ).toBe('户外折叠椅');
  });

  it('keeps short names and bounds long ones', () => {
    expect(generatedObjectName('白色圆桌')).toBe('白色圆桌');
    const long = generatedObjectName('户外折叠椅铝合金折叠框架藏青色厚棉布坐垫靠背');
    expect(Array.from(long)).toHaveLength(GENERATED_OBJECT_NAME_MAX + 1);
    expect(long.endsWith('…')).toBe(true);
  });

  it('strips colour and material qualifiers so the library name is the object', () => {
    expect(
      generatedObjectName('白色与浅绿配色的婚礼路引花牌：细金色立杆配小花器，插白色洋桔梗'),
    ).toBe('婚礼路引花牌');
    expect(generatedObjectName('白色与浅绿配色的婚礼宴会桌花，圆形花艺底座')).toBe('婚礼宴会桌花');
    expect(generatedObjectName('红色木质的椅子')).toBe('椅子');
  });

  it('keeps qualifiers that belong to the object name or are a real relation', () => {
    expect(generatedObjectName('白色圆桌')).toBe('白色圆桌');
    expect(generatedObjectName('新娘的手捧花')).toBe('新娘的手捧花');
    expect(generatedObjectName('木质路牌支架')).toBe('木质路牌支架');
  });

  it('falls back instead of inventing a name for empty input', () => {
    expect(generatedObjectName('   ', '生成模型')).toBe('生成模型');
    expect(generatedObjectName('：铝合金框架')).toBe('生成物件');
  });

  it('keeps the full prompt in notes only when the short name dropped something', () => {
    const base = '复用我的物料库真实模型与米制尺寸。';
    expect(generatedObjectNotes('户外折叠椅 1：铝合金框架', base)).toContain('生成描述：');
    expect(generatedObjectNotes('白色圆桌', base)).toBe(base);
  });
});
