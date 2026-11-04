/**
 * 第9批 UI：把 8/10 位 hex 配方哈希（recipe.ts 的 recipeHash(Recipe) 返回 8 位，
 * recipe-proposal.ts 的 recipeHash(PromptHashInput) 返回 10 位）压缩成策划师能
 * 口头说、能写在白板上的 5 位「人话编号」。
 *
 * 设计要点：
 *  - 纯函数，不依赖 react / zustand / three；
 *  - 同 hash 必同 id（取 hash 前 5 个 hex 字符，确定性映射）；
 *  - 编号只由 HUMAN_ALPHABET 取字符，去掉易混字符 0/O/1/I，避免电话里听错；
 *  - 不直接把技术 hash 暴露给用户（opId / 长 sha256 不进这个映射）。
 */

/**
 * 32 位人话字符表：字母表去掉 I/O，数字去掉 0/1，剩下 24 字母 + 8 数字。
 * hex 字符取值 0..15，只会用到前 16 个字符（A..Q），但保留 32 位以便未来扩位。
 */
export const HUMAN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 人话编号长度：固定 5 位。 */
export const HUMAN_ID_LENGTH = 5;

/**
 * 把一个 hex hash（任意长度，通常 8/10 位）转成 5 位人话编号。
 *
 * 规则：取 hash 前 5 个 hex 字符（0-f），每字符 parseInt(c,16) 得到 0..15，
 * 再用 HUMAN_ALPHABET[索引] 取字符。hash 不足 5 位时缺省按 '0' 处理（→ 'A'），
 * 保证输出恒为 5 位且不含 0/O/1/I。
 */
export function humanRecipeId(hash: string): string {
  const out: string[] = [];
  for (let i = 0; i < HUMAN_ID_LENGTH; i++) {
    const ch = hash[i] ?? '0';
    const idx = parseInt(ch, 16);
    // 非 hex 字符（如 '' 已兜底）按 0 处理，绝不抛错。
    const safe = Number.isFinite(idx) ? idx & 0xf : 0;
    out.push(HUMAN_ALPHABET[safe] ?? 'A');
  }
  return out.join('');
}

/**
 * 把 5 位人话编号包成策划师在卡片上看到的标签：「方案 #A7F3K」。
 * 输入非法（长度不对、含易混字符）时直接原样包一层，不做静默改写。
 */
export function recipeIdToLabel(id: string): string {
  return `方案 #${id}`;
}
