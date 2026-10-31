/** 左栏三态共用的宽度。默认等于现在的场地卡（320），拖边只在 240–480 之间。 */
export const LEFT_CARD_WIDTH_KEY = 'scendance.leftCardWidth';
export const LEFT_CARD_WIDTH_DEFAULT = 320;
export const LEFT_CARD_WIDTH_MIN = 240;
export const LEFT_CARD_WIDTH_MAX = 480;

export function clampLeftCardWidth(value: number): number {
  if (!Number.isFinite(value)) return LEFT_CARD_WIDTH_DEFAULT;
  return Math.min(LEFT_CARD_WIDTH_MAX, Math.max(LEFT_CARD_WIDTH_MIN, Math.round(value)));
}

export function parseLeftCardWidth(raw: string | null): number {
  if (raw == null || raw.trim() === '') return LEFT_CARD_WIDTH_DEFAULT;
  const value = Number(raw);
  if (!Number.isFinite(value)) return LEFT_CARD_WIDTH_DEFAULT;
  return clampLeftCardWidth(value);
}
