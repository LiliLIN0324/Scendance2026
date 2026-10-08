/** Countable-unit input only; the shared ledger contract validates the completed record. */
export function parseCheckinQuantity(input: string): number | null {
  const value = input.trim();
  if (!value) return null;
  if (!/^\d+$/.test(value)) throw new Error('数量请填写非负整数；留空表示未知。');
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity)) throw new Error('数量超过可安全记录的范围。');
  return quantity;
}
