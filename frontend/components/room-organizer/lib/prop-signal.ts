/**
 * 物料判定用的文本信号（2026-11-17「三个真问题」之基础件）。
 *
 * 为什么单独一层：旧判定把整条 slug（`场景名-道具名-哈希`）丢进 `includes`，
 * 于是 `portable` 命中 `table`、`tracked` 命中 `rack`、`festival-stage-…` 命中 `stage`，
 * 51 件物料的动作是场景名替道具决定的（见 `prop-interaction-audit.test.ts`）。
 *
 * 这里只做两件事：
 * - `objectSlugTokens()`：只取 slug 尾部 3 个词（物件段），场景名前缀与哈希不参与判定；
 * - `hasAnyToken()` / `hasAnyText()`：英文按整词比，中文按子串比（中文没有词边界）。
 *
 * 纯函数，零 three / React 依赖。
 */

/** slug 里属于「物件名」的尾部词数：`…-festival-stage-cable-ramp-hash` → cable/ramp/哈希。 */
const OBJECT_TOKEN_WINDOW = 3;

function splitSlug(ref: string): string[] {
  return ref.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * slug 的物件段词（小写、整词）。
 * 只留尾部 4 个 token：场景名前缀（`live-music-venue-and-festival-stage`）不再冒充道具类型。
 */
export function objectSlugTokens(ref: string | undefined): string[] {
  if (!ref) return [];
  return splitSlug(ref).slice(-OBJECT_TOKEN_WINDOW);
}

/** slug 的物件段里是否有这些词（整词相等；`tracked` 不再命中 `rack`）。 */
export function hasAnyToken(ref: string | undefined, tokens: readonly string[]): boolean {
  if (!ref || tokens.length === 0) return false;
  const wanted = new Set(tokens);
  return objectSlugTokens(ref).some(token => wanted.has(token));
}

/** 名称（中文为主）是否含这些字；英文词也走子串，但只用于名称，不用 slug。 */
export function hasAnyText(text: string | undefined, tokens: readonly string[]): boolean {
  if (!text) return false;
  return tokens.some(token => text.includes(token));
}
