/**
 * M1-A 配方层：把「活动 + 场地 + 人数 + 风格 + 随机种子」五要素固化为
 * 可序列化的 Recipe，并提供稳定哈希 recipeHash()。
 *
 * 纯函数模块，不依赖 zustand / three.js / 任何运行时文件。
 * 目标：同一句话重说一遍，算出同一个 hash，支撑「同配方复算同结果」。
 */

/** 活动类型。 */
export type ActivityKind = 'banquet' | 'conference' | 'popup' | 'classroom' | 'wedding' | 'custom';

/** 场地形状。 */
export type VenueShape = 'rectangle' | 'polygon';

/**
 * 配方：五要素 + 可选区域/形状。
 * 同一份 Recipe 应当始终复算出同一套布局。
 */
export interface Recipe {
  /** 活动类型。 */
  activity: ActivityKind;
  /** 场地宽度（米，矩形用；polygon 时可仅给外接估计）。 */
  widthM: number;
  /** 场地深度（米）。 */
  depthM: number;
  indoorOutdoor: 'indoor' | 'outdoor';
  /** 人数。 */
  headcount: number;
  /** 风格 key，沿用现有 ThemeKey 思路的字符串字面量联合。 */
  style: string;
  /** 随机种子；同 seed 复算同结果。 */
  seed: number;
  /** 区域/方言，可选，进 hash。 */
  region?: string;
  /** 场地形状。 */
  venueShape?: VenueShape;
}

/** 固定键序：序列化与哈希的唯一依据，不随对象插入顺序漂移。 */
const KEY_ORDER = [
  'activity',
  'widthM',
  'depthM',
  'indoorOutdoor',
  'headcount',
  'style',
  'seed',
  'region',
  'venueShape',
] as const;

type RecipeKey = (typeof KEY_ORDER)[number];

/**
 * 数字规范化：
 *  - 保留 6 位小数（Math.round(x * 1e6) / 1e6）
 *  - -0 归 0（JS 中 -0 === 0 为 true，直接返回 0）
 */
function normalizeNumber(x: number): number {
  if (x === 0) return 0;
  return Math.round(x * 1e6) / 1e6;
}

/**
 * 序列化：稳定、按键名排序、数字规范化。
 * region / venueShape 缺省时整键省略（undefined 同样省略）。
 */
export function recipeToJSON(recipe: Recipe): string {
  const parts: string[] = [];
  for (const key of KEY_ORDER) {
    const value = recipe[key as RecipeKey];
    if (value === undefined) continue;
    if (typeof value === 'number') {
      parts.push(`${JSON.stringify(key)}:${normalizeNumber(value)}`);
    } else {
      parts.push(`${JSON.stringify(key)}:${JSON.stringify(value)}`);
    }
  }
  return `{${parts.join(',')}}`;
}

/**
 * 稳定哈希：基于规范化 JSON 的 FNV-1a（32 位）。
 * offset basis = 2166136261，prime = 16777619。
 * 对 UTF-8 字节逐字节累加，返回 8 位小写十六进制字符串。
 */
export function recipeHash(recipe: Recipe): string {
  const json = recipeToJSON(recipe);
  const bytes = new TextEncoder().encode(json);
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 用 seed 派生下一个配方：
 * 同 activity / venue / headcount / style，只换 seed。
 * 未传 variantSeed 时默认 seed + 1。
 */
export function nextVariant(recipe: Recipe, variantSeed?: number): Recipe {
  const nextSeed = variantSeed ?? recipe.seed + 1;
  const next: Recipe = {
    activity: recipe.activity,
    widthM: recipe.widthM,
    depthM: recipe.depthM,
    indoorOutdoor: recipe.indoorOutdoor,
    headcount: recipe.headcount,
    style: recipe.style,
    seed: nextSeed,
  };
  if (recipe.region !== undefined) next.region = recipe.region;
  if (recipe.venueShape !== undefined) next.venueShape = recipe.venueShape;
  return next;
}
