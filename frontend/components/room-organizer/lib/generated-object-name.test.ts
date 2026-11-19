import { describe, expect, it } from 'vitest';
import {
  GENERATED_OBJECT_NAME_MAX,
  generatedObjectName,
  generatedObjectNotes,
} from './generated-object-name';

describe('生成物件短名', () => {
  it('整段提示词只取冒号前的主体', () => {
    expect(
      generatedObjectName(
        '户外折叠椅 1：铝合金折叠框架，藏青色厚棉布坐垫靠背，座高 45 厘米，展开尺寸约 45×50×88 厘米，四脚带黑色防滑脚垫，可折叠收纳。',
      ),
    ).toBe('户外折叠椅');
  });

  it('去列表序号、动词与首个量词', () => {
    expect(generatedObjectName('1. 市集摊位：3×3 米，白色顶棚')).toBe('市集摊位');
    expect(generatedObjectName('① 签到台')).toBe('签到台');
    expect(generatedObjectName('生成一个户外折叠椅')).toBe('户外折叠椅');
    expect(generatedObjectName('一把户外折叠椅，铝合金框架')).toBe('户外折叠椅');
  });

  it('尺寸前缀不是名字', () => {
    expect(generatedObjectName('3 米高的主舞台')).toBe('主舞台');
    expect(generatedObjectName('180×80 的桌子')).toBe('桌子');
  });

  it('短名原样保留，长名按上限截断', () => {
    expect(generatedObjectName('白色圆桌')).toBe('白色圆桌');
    const long = generatedObjectName('户外折叠椅铝合金折叠框架藏青色厚棉布坐垫靠背');
    expect(Array.from(long)).toHaveLength(GENERATED_OBJECT_NAME_MAX + 1);
    expect(long.endsWith('…')).toBe(true);
  });

  it('颜色材质类定语是属性，剥掉后只剩物件名', () => {
    expect(
      generatedObjectName('白色与浅绿配色的婚礼路引花牌：细金色立杆配小花器，插白色洋桔梗'),
    ).toBe('婚礼路引花牌');
    expect(generatedObjectName('白色与浅绿配色的婚礼宴会桌花，圆形花艺底座')).toBe('婚礼宴会桌花');
    expect(generatedObjectName('红色木质的椅子')).toBe('椅子');
  });

  it('参与词名的颜色和真正的所属关系不动', () => {
    expect(generatedObjectName('白色圆桌')).toBe('白色圆桌');
    expect(generatedObjectName('新娘的手捧花')).toBe('新娘的手捧花');
    expect(generatedObjectName('木质路牌支架')).toBe('木质路牌支架');
  });

  it('空输入回退到业务兜底名', () => {
    expect(generatedObjectName('   ', '图片物料')).toBe('图片物料');
    expect(generatedObjectName('：铝合金框架')).toBe('生成物件');
  });
});

describe('生成描述留档', () => {
  const base = '复用我的物料库真实模型与米制尺寸；保留已确认通道/门口。';

  it('短名丢掉的规格原文进备注，且保留 Agent 的签名前缀', () => {
    const prompt =
      '户外折叠椅 1：铝合金折叠框架，藏青色厚棉布坐垫靠背，座高 45 厘米，展开尺寸约 45×50×88 厘米，四脚带黑色防滑脚垫，可折叠收纳。';
    const notes = generatedObjectNotes(prompt, base);
    expect(notes.startsWith(base)).toBe(true);
    expect(notes).toContain('生成描述：');
    expect(notes).toContain('铝合金折叠框架');
  });

  it('名字本身就是短名时不重复记一遍', () => {
    expect(generatedObjectNotes('白色圆桌', base)).toBe(base);
  });
});
