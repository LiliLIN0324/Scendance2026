import { describe, expect, it } from 'vitest';
import { parseFollowUpOptions, segmentBubbleBlocks, splitBubbleLines } from './bubble-text';

describe('splitBubbleLines', () => {
  it('keeps plain text as one line', () => {
    expect(splitBubbleLines('已记下你确认的信息；如有其他要求可以继续补充。')).toEqual([
      '已记下你确认的信息；如有其他要求可以继续补充。',
    ]);
  });

  it('splits explicit newlines', () => {
    expect(splitBubbleLines('第一行\n第二行')).toEqual(['第一行', '第二行']);
  });

  it('splits inline numbered risk items into separate lines', () => {
    const text = '主要有以下风险需人工核验：1. 空间拥挤：人均约1㎡。 2. 疏散安全：仅留一条主过道。 3. 动线受限：讲师位走动困难。';
    expect(splitBubbleLines(text)).toEqual([
      '主要有以下风险需人工核验：',
      '1. 空间拥挤：人均约1㎡。',
      '2. 疏散安全：仅留一条主过道。',
      '3. 动线受限：讲师位走动困难。',
    ]);
  });

  it('does not split decimal sizes like 1.8 米', () => {
    const text = '课桌 1.8 米长，人均约 0.24㎡，无法摆下圆桌。';
    expect(splitBubbleLines(text)).toEqual([text]);
  });
});

describe('segmentBubbleBlocks', () => {
  it('keeps plain text as a single text block', () => {
    expect(segmentBubbleBlocks('已记下你确认的信息；如有其他要求可以继续补充。')).toEqual([
      { kind: 'text', text: '已记下你确认的信息；如有其他要求可以继续补充。' },
    ]);
  });

  it('groups consecutive numbered items into one list block', () => {
    const text = '主要有以下风险需人工核验：1. 空间拥挤：人均约1㎡。 2. 疏散安全：仅留一条主过道。 3. 动线受限：讲师位走动困难。';
    expect(segmentBubbleBlocks(text)).toEqual([
      { kind: 'text', text: '主要有以下风险需人工核验：' },
      { kind: 'list', items: ['1. 空间拥挤：人均约1㎡。', '2. 疏散安全：仅留一条主过道。', '3. 动线受限：讲师位走动困难。'] },
    ]);
  });

  it('splits list blocks when prose sits between items', () => {
    expect(segmentBubbleBlocks('1. 第一件。\n补充说明。\n2. 第二件。')).toEqual([
      { kind: 'list', items: ['1. 第一件。'] },
      { kind: 'text', text: '补充说明。' },
      { kind: 'list', items: ['2. 第二件。'] },
    ]);
  });

  it('treats bullet lines as list items but keeps decimal sizes as prose', () => {
    expect(splitBubbleLines('课桌 1.8 米长')).toEqual(['课桌 1.8 米长']);
    expect(segmentBubbleBlocks('- 座椅不足\n- 过道偏窄')).toEqual([
      { kind: 'list', items: ['- 座椅不足', '- 过道偏窄'] },
    ]);
  });
});

describe('parseFollowUpOptions', () => {
  it('splits an A-or-B question into two fillable options', () => {
    const text = '您希望我按可实现的合理人数重新规划，还是先探索其他场地尺寸？';
    expect(parseFollowUpOptions(text)).toEqual(['按可实现的合理人数重新规划', '先探索其他场地尺寸']);
  });

  it('reads quoted alternatives', () => {
    const text = '这样对吗？回复「确认」或「不对」。';
    expect(parseFollowUpOptions(text)).toEqual([]);
  });

  it('returns empty for a plain yes/no question without alternatives', () => {
    expect(parseFollowUpOptions('需要我帮你探索其他布局方案吗？')).toEqual([]);
  });

  it('returns empty when the last sentence is not a question', () => {
    expect(parseFollowUpOptions('建议考虑更换更大场地或大幅减少人数。')).toEqual([]);
  });
});
