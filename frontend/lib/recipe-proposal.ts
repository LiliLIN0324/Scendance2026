/**
 * M1-B 配方入提议层：把 AI 对话/brief 里的原始输入打包成 Recipe，
 * 并基于同一基准 Recipe 派生出多个候选 seed，使「同一句话换 seed 出多版」
 * 成为可纯函数测试的行为。
 *
 * 纯函数模块，仅依赖同目录的 recipe.ts，不接 UI、不碰 room-organizer。
 */

import { nextVariant, recipeHash as recipeHashOfRecipe, type Recipe } from './recipe';
import { seedAvalanche } from './rng';

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
  const variantHashes = variants.map((v) => recipeHashOfRecipe(v));

  return {
    base,
    baseHash: recipeHashOfRecipe(base),
    variants,
    variantHashes,
  };
}

/**
 * M6 扩展输入：把「seed + prompt + 可选 density + 可选 fingerprint」打成
 * 一个 10 位 hex 的 prompt 级 hash，用于在对话/brief 层识别「同一意图」。
 *
 * 与 recipe.ts 的 recipeHash(Recipe) 不同：后者 hash 一份结构化 Recipe，
 * 本函数 hash 一段原始 prompt 字符串 + 旋钮值，供上层在还没构造 Recipe
 * 之前就先算一个稳定指纹。
 */
export interface PromptHashInput {
  seed: number;
  prompt: string;
  density?: number;
  fingerprint?: string;
}

/** 内部 FNV-1a 32 位。 */
function fnv1aOf(input: string): number {
  let h = 2166136261;
  const bytes = new TextEncoder().encode(input);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * prompt 级 recipeHash：同输入两次必同 hash；任何一字段改变 → hash 变。
 * 返回 10 位 hex（前 2 位取自第二个 salt 通道的高 8 位，后 8 位取自主通道）。
 */
export function recipeHash(input: PromptHashInput): string {
  const parts: string[] = [
    `seed=${input.seed | 0}`,
    `prompt=${input.prompt}`,
  ];
  if (input.density !== undefined) parts.push(`d=${input.density}`);
  if (input.fingerprint !== undefined) parts.push(`fp=${input.fingerprint}`);
  const joined = parts.join('|');
  const h1 = fnv1aOf(joined);
  const h2 = fnv1aOf(joined + '::prompt-salt');
  const top2 = ((h2 >>> 24) & 0xff).toString(16).padStart(2, '0');
  const low8 = h1.toString(16).padStart(8, '0');
  return (top2 + low8).slice(0, 10);
}

/**
 * 以 seed 为根派生 count 个互不相似的 rng 起点。
 *  - 第 0 个恒为 seed 本身；
 *  - 第 i 个（i>=1）= seedAvalanche(seed, 'v'+(i+1))。
 * 相邻 seed 用不同 salt 打散，保证产出的 rng 流不会「长得像」。
 */
export function deriveSeededVariants(seed: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    if (i === 0) {
      out.push(seed);
    } else {
      out.push(seedAvalanche(seed, `v${i + 1}`));
    }
  }
  return out;
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
