import { describe, expect, it } from 'vitest';
import { describeModelFailure } from './turn-failure-diag';

describe('理解失败的编号与提示', () => {
  it('给出可复制的编号行，含分流与失败终态', () => {
    const view = describeModelFailure('这次没懂这句。', 1_700_000_000_000);
    expect(view.diag).toContain('turn t-');
    expect(view.diag).toContain('route=conversation');
    expect(view.diag).toContain('term=failed');
    expect(view.diag).toContain('code=model_notice');
    expect(view.diag.split('\n')).toHaveLength(1);
  });

  it('提示说的是能做的动作，带同一编号的说法', () => {
    const view = describeModelFailure('这次没懂这句。', 1000);
    expect(view.hint).toContain('重试');
    expect(view.hint).toContain('编号');
  });

  it('空提示回落到一句话，不显示空白卡片', () => {
    const view = describeModelFailure('   ', 1000);
    expect(view.text).toBe('这次没听懂这句。');
  });

  it('同一毫秒各失败一次，编号也不同（不会两件事共用一个号）', () => {
    const a = describeModelFailure('x', 2000);
    const b = describeModelFailure('x', 2000);
    expect(a.diag).not.toBe(b.diag);
  });

  it('编号里不含原话', () => {
    const view = describeModelFailure('在杭州植物园玉泉鱼跃周边做两日市集', 3000);
    expect(view.diag).not.toContain('玉泉');
    expect(view.text).toContain('玉泉');
  });
});
