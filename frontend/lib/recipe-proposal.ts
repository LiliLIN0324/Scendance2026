/**
 * M1-B 配方入提议层：把 AI 对话/brief 里的原始输入打包成 Recipe，
 * 并基于同一基准 Recipe 派生出多个候选 seed，使「同一句话换 seed 出多版」
 * 成为可纯函数测试的行为。
 *
 * 纯函数模块，仅依赖同目录的 recipe.ts，不接 UI、不碰 room-organizer。
 */

import { nextVariant, recipeHash, type Recipe } from './recipe';

/** 从 AI 对话/brief 解析出的原始输入（还没打包成 Recipe）。 */
export interface RecipeBrief {
  activity: 'banquet' | 'conference' | 'popup' | 'classroom' | 'wedding' | 'custom';
  widthM: number;
  depthM: number;
  /** 缺省 'indoor'。 */
  indoorOutdoor?: 'indoor' | 'outdoor';
  headcount: number;
  /** 缺省 'modern'。 */
  style?: string;
  /** 缺省随机（Date.now() % 100000）；测试中显式传入以保证可复现。 */
  seed?: number;
  region?: string;
}

/** 一次提议派生出来的多版配方（base + variants）。 */
export interface RecipeProposal {
  /** 基准配方（用户给的 seed 或随机 seed）。 */
  base: Recipe;
  /** base 的 8 位 hex hash。 */
  baseHash: string;
  /** base 的派生候选版本：nextVariant(base, base.seed+1)、nextVariant(base, base.seed+2)。 */
  variants: Recipe[];
  /** 每个 variant 的 hash，与 variants 等长。 */
  variantHashes: string[];
}

/**
 * 把 brief 打包成 RecipeProposal：base + 2 个 variants。
 *
 * 缺省值：
 *  - indoorOutdoor 缺省为 'indoor'
 *  - style 缺省为 'modern'
 *  - seed 缺省为 Date.now() % 100000（测试里显式传 seed 以保证可复现）
 *  - region 缺省时整键省略，不进入 Recipe
 */
export function buildRecipeProposal(brief: RecipeBrief): RecipeProposal {
  const indoorOutdoor = brief.indoorOutdoor ?? 'indoor';
  const style = brief.style ?? 'modern';
  const seed = brief.seed ?? (Date.now() % 100000);

  const base: Recipe = {
    activity: brief.activity,
    widthM: brief.widthM,
    depthM: brief.depthM,
    indoorOutdoor,
    headcount: brief.headcount,
    style,
    seed,
  };
  if (brief.region !== undefined) base.region = brief.region;

  const variants = deriveVariants(base, 2);
  const variantHashes = variants.map((v) => recipeHash(v));

  return {
    base,
    baseHash: recipeHash(base),
    variants,
    variantHashes,
  };
}

/**
 * 从已有 Recipe 再派生 N 个变体（默认 2 个）。
 * 每个变体除 seed 外与 base 全等，seed 分别为 base.seed + i，i = 1..count。
 */
export function deriveVariants(base: Recipe, count: number = 2): Recipe[] {
  const out: Recipe[] = [];
  for (let i = 1; i <= count; i++) {
    out.push(nextVariant(base, base.seed + i));
  }
  return out;
}
