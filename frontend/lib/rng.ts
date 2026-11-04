/**
 * M6-RNG 层：确定性随机数 + seed 雪崩 + Provenance 溯源标记。
 *
 * 纯函数模块，仅依赖运行时 JS 标准库（Math / TextEncoder）。
 * 目的：让「同 seed 复算同布局」和「相邻 seed 产出的 rng 流不长得像」同时成立。
 */

/**
 * mulberry32 —— 标准 32 位 PRNG，同 seed 产出完全相同的 [0,1) 浮点流。
 * 参考: https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a (32 位) 单串哈希，返回无符号 32 位整数。 */
function fnv1a(input: string): number {
  let h = 2166136261;
  const bytes = new TextEncoder().encode(input);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * seedAvalanche —— 把 (seed, salt) 混合成一个全新的 31 位正整数。
 *
 * 关键性质：相邻 seed（如 7 与 8）即便用同一个 salt，产出的新 seed 也要
 * 在整个 31 位空间里均匀散开，不能「长得像」。实现上先用 FNV-1a 把
 * seed 的 4 个大端字节和 salt 的 UTF-8 字节全部喂进去，再用
 * Murmur3 末尾的三个混合常量做一次 avalanche 收尾。
 *
 * 返回值范围: [0, 2^31 - 1]，保证后续 mulberry32 能直接吃。
 */
export function seedAvalanche(seed: number, salt: string): number {
  const s = seed >>> 0;
  // 4 个大端字节 + salt，喂进 FNV-1a
  const joined = [
    (s >>> 24) & 0xff,
    (s >>> 16) & 0xff,
    (s >>> 8) & 0xff,
    s & 0xff,
  ].join(',') + '|' + salt;
  let h = fnv1a(joined);
  // Murmur3 avalanche finalizer
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) & 0x7fffffff;
}

/**
 * randomSeed —— 仅当调用方缺 seed 时兜底用，测试里禁止调用。
 * 取 [0, 2^31) 的整数，避免与 seedAvalanche 输出值域打架。
 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/**
 * Provenance —— 一个家具实例是谁放进去的、用哪个 opId / seed / recipeId 放的。
 *
 * 设计原则：
 *  - 纯 TS 层类型，运行时零代码；
 *  - 在 FurnitureItem 上以可选字段存在，不进必填面，不破坏既有构造；
 *  - source: 'human' 用户拖放 / 'ai' AI 提议 / 'procedural' 脚本化生成。
 */
export interface Provenance {
  source: 'human' | 'ai' | 'procedural';
  opId: string;
  seed?: number;
  recipeId?: string;
}
