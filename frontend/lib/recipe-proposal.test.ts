import { describe, expect, it } from 'vitest';
import { recipeHash } from './recipe';
import {
  buildRecipeProposal,
  deriveVariants,
  type RecipeBrief,
} from './recipe-proposal';

/** 一份最小可用的 brief：所有测试都在此基础上局部改写。 */
const baseBrief: RecipeBrief = {
  activity: 'banquet',
  widthM: 12,
  depthM: 8,
  headcount: 80,
  seed: 42,
};

describe('buildRecipeProposal', () => {
  it('1. 同 brief 同 seed → baseHash 相同（确定性）', () => {
    const a = buildRecipeProposal(baseBrief);
    const b = buildRecipeProposal(baseBrief);
    expect(a.baseHash).toBe(b.baseHash);
    expect(a.variantHashes).toEqual(b.variantHashes);
  });

  it('2. 不同 seed → baseHash 不同', () => {
    const a = buildRecipeProposal({ ...baseBrief, seed: 42 });
    const b = buildRecipeProposal({ ...baseBrief, seed: 100 });
    expect(a.baseHash).not.toBe(b.baseHash);
  });

  it('3. variants 长度 = 2（默认），每个 variant 的 hash 与 baseHash 不同', () => {
    const proposal = buildRecipeProposal(baseBrief);
    expect(proposal.variants).toHaveLength(2);
    expect(proposal.variantHashes).toHaveLength(2);
    for (const h of proposal.variantHashes) {
      expect(h).not.toBe(proposal.baseHash);
    }
  });

  it('4. variants 除 seed 外其他字段与 base 全等', () => {
    const proposal = buildRecipeProposal(baseBrief);
    for (const v of proposal.variants) {
      expect(v.activity).toBe(proposal.base.activity);
      expect(v.widthM).toBe(proposal.base.widthM);
      expect(v.depthM).toBe(proposal.base.depthM);
      expect(v.indoorOutdoor).toBe(proposal.base.indoorOutdoor);
      expect(v.headcount).toBe(proposal.base.headcount);
      expect(v.style).toBe(proposal.base.style);
      expect(v.seed).not.toBe(proposal.base.seed);
    }
  });

  it("5. indoorOutdoor/style 缺省时填默认值 'indoor'/'modern'", () => {
    const brief: RecipeBrief = {
      activity: 'conference',
      widthM: 10,
      depthM: 6,
      headcount: 30,
      seed: 7,
    };
    const proposal = buildRecipeProposal(brief);
    expect(proposal.base.indoorOutdoor).toBe('indoor');
    expect(proposal.base.style).toBe('modern');
  });

  it('6. deriveVariants(base, 3) 返回 3 个变体，seed 分别为 base.seed+1/+2/+3', () => {
    const proposal = buildRecipeProposal(baseBrief);
    const variants = deriveVariants(proposal.base, 3);
    expect(variants).toHaveLength(3);
    expect(variants[0].seed).toBe(proposal.base.seed + 1);
    expect(variants[1].seed).toBe(proposal.base.seed + 2);
    expect(variants[2].seed).toBe(proposal.base.seed + 3);
  });

  it('7. region 缺省时 Recipe 上没有 region 键', () => {
    const proposal = buildRecipeProposal(baseBrief);
    expect('region' in proposal.base).toBe(false);
    for (const v of proposal.variants) {
      expect('region' in v).toBe(false);
    }

    // 反向：显式给 region 时进入 base 并被 nextVariant 继承
    const withRegion = buildRecipeProposal({ ...baseBrief, region: 'zh-Hangzhou' });
    expect(withRegion.base.region).toBe('zh-Hangzhou');
    for (const v of withRegion.variants) {
      expect(v.region).toBe('zh-Hangzhou');
    }
  });

  it('base.seed 与 variants seed 关系为 base.seed+1 / base.seed+2', () => {
    const proposal = buildRecipeProposal(baseBrief);
    expect(proposal.variants[0].seed).toBe(baseBrief.seed! + 1);
    expect(proposal.variants[1].seed).toBe(baseBrief.seed! + 2);
  });

  it('variantHashes 与 variants 顺序一一对应（与独立 recipeHash 一致）', () => {
    const proposal = buildRecipeProposal(baseBrief);
    proposal.variants.forEach((v, i) => {
      expect(proposal.variantHashes[i]).toBe(recipeHash(v));
    });
  });

  it('deriveVariants 默认 count=2', () => {
    const proposal = buildRecipeProposal(baseBrief);
    const defaultVariants = deriveVariants(proposal.base);
    expect(defaultVariants).toHaveLength(2);
  });
});
