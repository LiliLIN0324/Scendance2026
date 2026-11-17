/**
 * 项目级价格书（2026-11-17 v5）。
 *
 * 上一版单价只能逐件填，新拖进来的同款不带价。价格书解决「一次定价、全项目复用」：
 * - `priceModel` 写回 plan.priceBook；
 * - 新放置（一句话布置 / 套装 / 换款）按 slug 自动带价；
 * - 清价时从书里移除，不留 0 元假价。
 *
 * 纯函数，零 three / 零 React。
 */

export type PriceBook = Readonly<Record<string, number>>;

/** 写入 / 清除一个型号的价格；null = 删除（未定价）。 */
export function withModelPrice(
  book: PriceBook | undefined,
  slug: string,
  price: number | null,
): PriceBook {
  const next: Record<string, number> = { ...(book ?? {}) };
  if (price === null || !Number.isFinite(price) || price < 0) delete next[slug];
  else next[slug] = price;
  return next;
}

/** 查型号单价；没有就 null，不返回 0。 */
export function priceForModel(book: PriceBook | undefined, slug: string | null | undefined): number | null {
  if (!slug || !book) return null;
  const price = book[slug];
  return typeof price === 'number' && Number.isFinite(price) ? price : null;
}

/** 新放置时带入价格：只补空缺，不覆盖用户已手填的值。 */
export function inheritPrice<T extends { modelOverride?: string | undefined; unitPrice?: number | undefined }>(
  facility: T,
  book: PriceBook | undefined,
): T & { unitPrice?: number | undefined } {
  if (typeof facility.unitPrice === 'number') return facility;
  const price = priceForModel(book, facility.modelOverride);
  return price === null ? facility : { ...facility, unitPrice: price };
}
