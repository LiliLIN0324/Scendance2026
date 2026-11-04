import { describe, expect, it } from 'vitest';
import { HUMAN_ALPHABET, HUMAN_ID_LENGTH, humanRecipeId, recipeIdToLabel } from './recipe-display';
import { recipeHash as recipeHashOfRecipe, type Recipe } from './recipe';
import { deriveSeededVariants, recipeHash as promptRecipeHash } from './recipe-proposal';

describe('humanRecipeId', () => {
  it('同 hash 两次映射结果一致（确定性）', () => {
    const hash = 'a3f9c2e1';
    expect(humanRecipeId(hash)).toBe(humanRecipeId(hash));
    expect(humanRecipeId(hash)).toBe(humanRecipeId(hash.toLowerCase()));
  });

  it('输出长度恒为 5 位，哪怕 hash 更短或更长', () => {
    expect(humanRecipeId('').length).toBe(5);
    expect(humanRecipeId('a').length).toBe(5);
    expect(humanRecipeId('a3f9c2e1b7d4').length).toBe(5);
    expect(humanRecipeId('deadbeef').length).toBe(5);
  });

  it('输出绝不含易混字符 0/O/1/I', () => {
    const samples = ['00000', 'fffff', 'abcdef12', '10a2f9', 'deadbeef', 'cafe', 'b00b', 'i'.repeat(8)];
    for (const hash of samples) {
      const id = humanRecipeId(hash);
      expect(id).toHaveLength(5);
      for (const ch of id) {
        expect('0O1I').not.toContain(ch);
      }
    }
  });

  it('只取 hash 前 5 个 hex 字符；第 6 位及以后不影响结果', () => {
    const prefix = 'a3f9c';
    expect(humanRecipeId(prefix + '2e1')).toBe(humanRecipeId(prefix + '000'));
    expect(humanRecipeId(prefix + 'ffff')).toBe(humanRecipeId(prefix));
  });

  it('逐 hex 字符映射到 HUMAN_ALPHABET[0..15]', () => {
    // hex '0' → 索引 0 → 'A'；'f' → 索引 15 → 'R'（字母表前 16 位内）。
    expect(humanRecipeId('00000')).toBe('AAAAA');
    expect(humanRecipeId('fffff')).toBe('RRRRR');
    // 边界：索引 15 对应 HUMAN_ALPHABET 第 16 个字符。
    expect(HUMAN_ALPHABET[15]).toBe('R');
  });

  it('真实 recipeHash(Recipe) 的输出可稳定映射出 5 位编号', () => {
    const recipe: Recipe = {
      activity: 'banquet', widthM: 12, depthM: 8,
      indoorOutdoor: 'indoor', headcount: 80, style: 'modern', seed: 42,
    };
    const h = recipeHashOfRecipe(recipe);
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    const id = humanRecipeId(h);
    expect(id).toHaveLength(5);
    expect(id).toBe(humanRecipeId(h));
  });

  it('deriveSeededVariants 派生的 3 个 seed → prompt hash → 编号互不相同', () => {
    const seeds = deriveSeededVariants(7, 3);
    expect(seeds).toHaveLength(3);
    const ids = seeds.map(seed => humanRecipeId(promptRecipeHash({ seed, prompt: 'banquet-12x8-80p' })));
    // 三个候选 seed 应当散开，编号不撞车。
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toHaveLength(5);
  });
});

describe('recipeIdToLabel', () => {
  it('把 5 位编号包成「方案 #XXXX」', () => {
    expect(recipeIdToLabel('A7F3K')).toBe('方案 #A7F3K');
  });

  it('HUMAN_ID_LENGTH 与实际取位一致', () => {
    expect(HUMAN_ID_LENGTH).toBe(5);
  });
});
