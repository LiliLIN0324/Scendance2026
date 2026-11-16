/**
 * 2026-11-16 轮次 11 合并收口时丢了这个实现，origin/main 因此 tsc 失败、无法出包。
 *
 * 「预览分区」卡片上的「搜地点」把焦点交回画布左上角的搜地点输入框：不自动填、不自动搜，
 * 只让用户能接着打字。找不到输入框（面板收起/尚未挂载）时返回 false，调用方不需要报错。
 */
export function focusPlaceSearch(): boolean {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid="outdoor-place-search-input"]',
  );
  if (!input) return false;
  input.focus();
  input.select();
  return true;
}
