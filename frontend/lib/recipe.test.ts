import { describe, expect, it } from 'vitest';
import { nextVariant, recipeHash, recipeToJSON, type Recipe } from './recipe';

/** 基础配方：所有测试的对照基准。 */
const base: Recipe = {
  activity: 'banquet',
  widthM: 12,
  depthM: 8,
  indoorOutdoor: 'indoor',
  headcount: 80,
  style: 'modern',
  seed: 42,
};

describe('recipeHash / recipeToJSON', () => {
  it('同配方两次哈希相等，序列化结果一致', () => {
    expect(recipeHash(base)).toBe(recipeHash({ ...base }));
    expect(recipeToJSON(base)).toBe(recipeToJSON({ ...base }));
  });

  it('对象键插入顺序不同，序列化与哈希均相同', () => {
    const reordered: Recipe = {
      seed: 42,
      style: 'modern',
      headcount: 80,
      indoorOutdoor: 'indoor',
      depthM: 8,
      widthM: 12,
      activity: 'banquet',
    };
    expect(recipeToJSON(reordered)).toBe(recipeToJSON(base));
    expect(recipeHash(reordered)).toBe(recipeHash(base));
  });

  it('任一关键字段（activity / widthM / headcount / style / seed）变化，哈希必变', () => {
    const cases: Array<[string, Partial<Recipe>]> = [
      ['activity', { activity: 'conference' }],
      ['widthM', { widthM: 13 }],
      ['headcount', { headcount: 81 }],
      ['style', { style: 'rustic' }],
      ['seed', { seed: 43 }],
    ];
    for (const [label, patch] of cases) {
      const modified = { ...base, ...patch };
      expect(recipeHash(modified), `修改 ${label} 后哈希应不同`).not.toBe(recipeHash(base));
    }
  });

  it('1e-6 内的数字差异被归一化，-0 与 0 哈希相同', () => {
    const withSmallDelta: Recipe = { ...base, widthM: 10.0000001 };
    const rounded: Recipe = { ...base, widthM: 10 };
    expect(recipeHash(withSmallDelta)).toBe(recipeHash(rounded));

    const negZero: Recipe = { ...base, widthM: -0 as unknown as number };
    const posZero: Recipe = { ...base, widthM: 0 };
    expect(recipeHash(negZero)).toBe(recipeHash(posZero));
  });

  it('nextVariant 除 seed 外字段全等，且哈希不同', () => {
    const next = nextVariant(base);
    expect(next.activity).toBe(base.activity);
    expect(next.widthM).toBe(base.widthM);
    expect(next.depthM).toBe(base.depthM);
    expect(next.indoorOutdoor).toBe(base.indoorOutdoor);
    expect(next.headcount).toBe(base.headcount);
    expect(next.style).toBe(base.style);
    expect(next.seed).toBe(base.seed + 1);
    expect(recipeHash(next)).not.toBe(recipeHash(base));
  });

  it('nextVariant 可显式指定 variantSeed', () => {
    const next = nextVariant(base, 100);
    expect(next.seed).toBe(100);
    expect(recipeHash(next)).not.toBe(recipeHash(base));
  });

  it('region / venueShape 缺省与显式 undefined 行为一致（都不进 JSON）', () => {
    const omitted: Recipe = { ...base };
    // exactOptionalPropertyTypes 下显式 undefined 需绕过类型系统；运行时行为仍需覆盖。
    const explicitUndefined = { ...base, region: undefined, venueShape: undefined } as unknown as Recipe;
    expect(recipeToJSON(omitted)).toBe(recipeToJSON(explicitUndefined));
    expect(recipeHash(omitted)).toBe(recipeHash(explicitUndefined));
  });

  it('region / venueShape 显式赋值时进入 JSON 并影响哈希', () => {
    const withRegion: Recipe = { ...base, region: 'zh-Hangzhou' };
    const withShape: Recipe = { ...base, venueShape: 'polygon' };
    expect(recipeToJSON(withRegion)).toContain('region');
    expect(recipeToJSON(withShape)).toContain('venueShape');
    expect(recipeHash(withRegion)).not.toBe(recipeHash(base));
    expect(recipeHash(withShape)).not.toBe(recipeHash(base));
  });
});
