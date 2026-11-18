/**
 * C1（2026-11-18 拍板 A）：后端资产 id 与物料库 slug 严格分离。
 *
 * 口径：
 * - `sourceAssetId` 只承载后端资产 id；迁移器只从 `FurnitureItem.assetId` 直通，
 *   绝不从 slug 反推，也不把 slug 拼进这个字段；
 * - `modelOverride` 只承载物料库 slug；任何 UUID 一律不落（`generated:` 前缀仍是 slug）；
 * - G1 不把 `sourceAssetId` 收紧成 UUID（那是 G2 的动作），这里只守「UUID 不当 slug」这一侧。
 *
 * 纯函数、无 IO；调用点在 `plan-facility-migration` 与物料卡落位。
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 后端资产 id（UUID）判定；只用于区分命名空间，不用于收紧契约。 */
export function looksLikeBackendAssetId(value: string | undefined | null): boolean {
  return UUID_PATTERN.test((value ?? '').trim());
}

/** 物料库 slug：1–160 字符且不是 UUID。 */
export function isLibraryModelSlug(value: string | undefined | null): boolean {
  const trimmed = (value ?? '').trim();
  return trimmed.length >= 1 && trimmed.length <= 160 && !UUID_PATTERN.test(trimmed);
}

/** 取第一个合法 slug；UUID、空串、超长一律丢弃，不回落猜测。 */
export function firstModelSlug(...candidates: Array<string | undefined | null>): string | undefined {
  for (const candidate of candidates) {
    if (isLibraryModelSlug(candidate)) return candidate!.trim();
  }
  return undefined;
}
