import { describe, expect, it } from 'vitest';
import { ACTIVITY_RECIPES, matchRecipes, renderRecipes, type ActivityRecipe } from '../supabase/functions/_shared/agent-recipes.ts';

const kinds = (brief: string) => matchRecipes(brief).map(recipe => recipe.kind);
const only = (brief: string): ActivityRecipe => {
  const [first] = matchRecipes(brief);
  if (!first) throw new Error(`没有命中任何配方：${brief}`);
  return first;
};

describe('brief 命中哪一类配方', () => {
  it('亲子活动排第一', () => {
    expect(only('给亲子活动做一块场地').kind).toBe('family');
  });

  it('老人 / 适老 两种说法都落到适老休憩区', () => {
    expect(kinds('给老人做休憩区')).toContain('elder');
    expect(only('给老人做休憩区').kind).toBe('elder');
    expect(kinds('适老化座椅')).toContain('elder');
    expect(only('适老化座椅').kind).toBe('elder');
  });

  it('周末市集命中市集', () => {
    expect(only('办个周末市集').kind).toBe('market');
  });

  it('空 brief 兜底为通用配方', () => {
    expect(kinds('')).toEqual(['generic']);
    expect(kinds('   ')).toEqual(['generic']);
  });

  it('亲子市集返回两条，且人群类配方排在前面', () => {
    const result = matchRecipes('亲子市集');
    expect(result).toHaveLength(2);
    expect(result.map(recipe => recipe.kind)).toEqual(['family', 'market']);
  });
});

describe('渲染成提示词片段', () => {
  it('硬判据的每一条 id 都出现在输出里', () => {
    const recipe = only('给亲子活动做一块场地');
    const text = renderRecipes([recipe]);
    for (const rule of recipe.hardRules) expect(text).toContain(`[${rule.id}]`);
    expect(text.startsWith('【配方·')).toBe(true);
    expect(text).toContain('本质：');
    expect(text).toContain('分区：');
    expect(text).toContain('完成判据：');
  });

  it('预算 300 字符时仍不超长，且硬判据一条不少', () => {
    const recipe = only('给亲子活动做一块场地');
    const text = renderRecipes([recipe], { maxChars: 300 });
    expect(text.length).toBeLessThanOrEqual(300);
    for (const rule of recipe.hardRules) expect(text).toContain(`[${rule.id}]`);
  });
});

describe('配方数据本身的完整性', () => {
  it('七类配方都在，且每类判据条数够用', () => {
    expect(ACTIVITY_RECIPES.map(recipe => recipe.kind)).toEqual([
      'family', 'elder', 'market', 'stage', 'camp', 'exhibition', 'generic',
    ]);
    for (const recipe of ACTIVITY_RECIPES) {
      expect(recipe.hardRules.length).toBeGreaterThanOrEqual(4);
      expect(recipe.softRules.length).toBeGreaterThanOrEqual(3);
      expect(recipe.antiPatterns.length).toBeGreaterThanOrEqual(3);
      expect(recipe.completionChecks.length).toBeGreaterThanOrEqual(3);
      expect(recipe.aliases.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('所有格数都是正整数', () => {
    for (const recipe of ACTIVITY_RECIPES) {
      for (const rule of [...recipe.hardRules, ...recipe.softRules]) {
        expect(Number.isInteger(rule.cells)).toBe(true);
        expect(rule.cells).toBeGreaterThan(0);
      }
    }
  });

  it('分区占比合计为 100', () => {
    for (const recipe of ACTIVITY_RECIPES) {
      expect(recipe.zones.reduce((sum, zone) => sum + zone.share, 0)).toBe(100);
    }
  });
});
