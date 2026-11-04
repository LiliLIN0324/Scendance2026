import { describe, expect, it } from 'vitest';
import { mulberry32, seedAvalanche, randomSeed, type Provenance } from './rng';

describe('mulberry32', () => {
  it('1. 同 seed 两次产出完全相同的前 10 个数', () => {
    const a = mulberry32(20240607);
    const b = mulberry32(20240607);
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b());
    }
  });

  it('2. 不同 seed 产出的流不同（前 20 个里至少有 1 个不同）', () => {
    const a = mulberry32(111);
    const b = mulberry32(222);
    let diffs = 0;
    for (let i = 0; i < 20; i++) {
      if (a() !== b()) diffs++;
    }
    expect(diffs).toBeGreaterThan(0);
  });

  it('3. 输出落在 [0, 1) 范围内', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('seedAvalanche', () => {
  it('4. 同 (seed, salt) 两次结果相等（确定性）', () => {
    expect(seedAvalanche(7, 'a')).toBe(seedAvalanche(7, 'a'));
  });

  it('5. 相邻 seed 不同 salt → 结果不同，且流不相似（相邻相减绝对值均值 > 0.2）', () => {
    const seedA = seedAvalanche(7, 'v2');
    const seedB = seedAvalanche(8, 'v2');
    expect(seedA).not.toBe(seedB);

    const ra = mulberry32(seedA);
    const rb = mulberry32(seedB);
    let sumAbs = 0;
    const N = 100;
    for (let i = 0; i < N; i++) {
      sumAbs += Math.abs(ra() - rb());
    }
    expect(sumAbs / N).toBeGreaterThan(0.2);
  });

  it('6. 不同 salt → 不同结果（salt 真的参与混合）', () => {
    expect(seedAvalanche(7, 'v2')).not.toBe(seedAvalanche(7, 'v3'));
  });

  it('7. 输出落在 [0, 2^31) 正整数域', () => {
    for (const s of [0, 1, 7, 12345, 0x7fffffff]) {
      const v = seedAvalanche(s, 'salt');
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 31);
    }
  });
});

describe('randomSeed', () => {
  it('8. 返回 [0, 2^31) 整数（运行时调用，测试里仅验证值域）', () => {
    const v = randomSeed();
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(2 ** 31);
  });
});

describe('Provenance 类型（仅 TS 层，运行时零代码）', () => {
  it('9. 可以构造一个满足 Provenance 形状的对象（compile-time 断言）', () => {
    const p: Provenance = { source: 'ai', opId: 'op-1', seed: 7, recipeId: 'ab12cd34' };
    expect(p.source).toBe('ai');
    expect(p.seed).toBe(7);
  });

  it('10. Provenance 缺省字段可省（source/opId 之外全可选）', () => {
    const p: Provenance = { source: 'human', opId: 'op-2' };
    expect(p.seed).toBeUndefined();
    expect(p.recipeId).toBeUndefined();
  });
});
