/**
 * 2026-11-16 轮次 11 合并收口时丢了这两个实现，origin/main 因此 tsc 失败、无法出包。
 *
 * 语义（见 outdoor-plan-overlay 调用点）：对话停在「搜索目标地点」阶段时，用户在画布左上角
 * 搜到并点选的地点应当被当作对那句「找场地」的回答，送进对话的候选确认卡；其它阶段保持
 * 「只看一眼」，不打断分区/流线。
 */
export function answersPlaceRequest(
  stage: string | undefined,
  name: string,
  search: (query: string) => void,
): boolean {
  const trimmed = name.trim();
  if (stage !== 'place' || !trimmed) return false;
  search(trimmed);
  return true;
}
